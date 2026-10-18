import type { IncomingMessage, ServerResponse } from 'node:http';

export const PROTOCOL = '2025-11-25';
const VERSIONS = [PROTOCOL, '2025-06-18', '2025-03-26', '2024-11-05'];

type Id = string | number;
export type Params = Record<string, unknown>;
export type Message = {
  jsonrpc: '2.0';
  id?: Id;
  method?: string;
  params?: Params;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};
export type McpTool = {
  name: string;
  description?: string;
  inputSchema: Params;
  annotations?: { readOnlyHint?: boolean };
};
/** The signal aborts on `notifications/cancelled`. */
export type Handler = (params: Params, signal: AbortSignal) => unknown;
export type Server = {
  name: string;
  instructions?: string | undefined;
  capabilities: Params;
  handlers: Record<string, Handler>;
};

const failure = (id: Id | undefined, code: number, text: string): Message => ({
  jsonrpc: '2.0',
  ...(id === undefined ? {} : { id }),
  error: { code, message: text },
});

const valid = (msg: unknown): msg is Message => {
  if (typeof msg !== 'object' || msg === null || Array.isArray(msg)) return false;
  const { jsonrpc, method, id } = msg as Record<string, unknown>;
  return (
    jsonrpc === '2.0' &&
    (method === undefined || typeof method === 'string') &&
    (id === undefined || typeof id === 'string' || typeof id === 'number')
  );
};

const idOf = (msg: unknown) => {
  const id = (msg as { id?: unknown } | null)?.id;
  return typeof id === 'string' || typeof id === 'number' ? id : undefined;
};

/** `scope` keeps request ids of different sessions apart. */
export function dispatch(server: Server) {
  const sessions = new Map<string, Map<Id, AbortController>>();
  return async ({ id, method, params = {} }: Message, scope = ''): Promise<Message | undefined> => {
    if (method === undefined) return;
    if (id === undefined) {
      if (method === 'notifications/cancelled')
        sessions
          .get(scope)
          ?.get(params.requestId as Id)
          ?.abort();
      return;
    }
    let running = sessions.get(scope);
    if (!running) sessions.set(scope, (running = new Map<Id, AbortController>()));
    const ac = new AbortController();
    running.set(id, ac);
    try {
      if (method === 'initialize') {
        const asked = params.protocolVersion as string;
        const result = {
          protocolVersion: VERSIONS.includes(asked) ? asked : PROTOCOL,
          capabilities: server.capabilities,
          serverInfo: { name: server.name, version: '0' },
          ...(server.instructions ? { instructions: server.instructions } : {}),
        };
        return { jsonrpc: '2.0', id, result };
      }
      const handler =
        method === 'ping'
          ? () => ({})
          : Object.hasOwn(server.handlers, method)
            ? server.handlers[method]
            : undefined;
      if (!handler) return failure(id, -32601, `Method not found: ${method}`);
      return { jsonrpc: '2.0', id, result: await handler(params, ac.signal) };
    } catch (e) {
      const code = (e as { code?: unknown }).code;
      return failure(
        id,
        typeof code === 'number' ? code : -32603,
        String((e as Error)?.message ?? e),
      );
    } finally {
      running.delete(id);
      if (!running.size) sessions.delete(scope);
    }
  };
}

/** Streamable HTTP, POST and JSON only; authentication and routing stay with the caller. */
export function httpHandler(server: Server) {
  const handle = dispatch(server);
  const reply = (res: ServerResponse, status: number, body?: Message, session?: string) => {
    res.writeHead(status, {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(session ? { 'mcp-session-id': session } : {}),
      ...(status === 405 ? { allow: 'POST' } : {}),
    });
    res.end(body ? JSON.stringify(body) : undefined);
  };

  const run = async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== 'POST') return reply(res, 405);
    const { origin, host } = req.headers;
    if (origin !== undefined && origin !== `http://${host}`) return reply(res, 403);
    const version = req.headers['mcp-protocol-version'];
    if (typeof version === 'string' && !VERSIONS.includes(version))
      return reply(
        res,
        400,
        failure(undefined, -32600, `Unsupported protocol version: ${version}`),
      );

    let text = '';
    req.setEncoding('utf8');
    for await (const chunk of req as AsyncIterable<string>) text += chunk;
    let msg: unknown;
    try {
      msg = JSON.parse(text);
    } catch {
      return reply(res, 400, failure(undefined, -32700, 'Parse error'));
    }
    if (!valid(msg)) return reply(res, 400, failure(idOf(msg), -32600, 'Invalid request'));

    const initialize = msg.method === 'initialize' && msg.id !== undefined;
    const header = req.headers['mcp-session-id'];
    const session = initialize ? crypto.randomUUID() : typeof header === 'string' ? header : '';
    const out = await handle(msg, session).catch(() => failure(msg.id, -32603, 'Internal error'));
    if (!out) return reply(res, 202);
    reply(res, 200, out, initialize ? session : undefined);
  };
  return (req: IncomingMessage, res: ServerResponse) => {
    run(req, res).catch(() => res.destroy());
  };
}

/** Newline-delimited JSON; `done` resolves when stdin ends. */
export function serveStdio(server: Server) {
  const handle = dispatch(server);
  const write = (m: Message) => process.stdout.write(`${JSON.stringify(m)}\n`);
  const done = new Promise<void>(resolve => process.stdin.once('end', resolve));
  let buf = '';
  const onData = (chunk: string) => {
    buf += chunk;
    for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      let msg: unknown;
      try {
        msg = JSON.parse(line);
      } catch {
        write(failure(undefined, -32700, 'Parse error'));
        continue;
      }
      if (!valid(msg)) {
        write(failure(idOf(msg), -32600, 'Invalid request'));
        continue;
      }
      const { id } = msg;
      void handle(msg)
        .catch(() => (id === undefined ? undefined : failure(id, -32603, 'Internal error')))
        .then(out => out && write(out));
    }
  };
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', onData);
  return {
    close: async () => {
      process.stdin.off('data', onData);
      process.stdin.pause();
    },
    done,
  };
}
