import { randomUUID } from 'node:crypto';
import * as z from 'zod';
import type { App, Skill } from '../index';
import { cli, instructions, readSkill, walk, type Entry } from '../emit/index';
import { httpHandler, serveStdio, type McpTool, type Params, type Server } from './protocol';

/**
 * Serves MCP over stdio or HTTP with an optional host and port.
 */
export type Transport = 'stdio' | { http: { port?: number; host?: string } };

const text = (value: string) => ({ type: 'text' as const, text: value });
const failed = (value: string) => ({ content: [text(value)], isError: true });

// Claude Code maps every character outside this set to `_` in tool names.
const mapped = (name: string) => name.replace(/[^A-Za-z0-9_-]/g, '_');

function server(app: App): Server {
  const { commands, skills } = walk(app);
  const tools = new Map<string, Entry>();
  for (const entry of commands) {
    if (entry.command.mcp === false) continue;
    if (tools.has(entry.id))
      throw new Error(`contextjsx: two commands have the tool id "${entry.id}"`);
    tools.set(entry.id, entry);
  }

  const named = new Map<string, Skill>();
  for (const skill of skills) {
    const { name } = readSkill(skill);
    if (named.has(name)) throw new Error(`contextjsx: two skills are named "${name}"`);
    named.set(name, skill);
  }

  const seen = new Map<string, string>();
  for (const id of [...tools.keys(), ...(named.size ? ['load_skill'] : [])]) {
    const prev = seen.get(mapped(id));
    if (prev !== undefined)
      throw new Error(`contextjsx: tools "${prev}" and "${id}" both map to ${mapped(id)}`);
    seen.set(mapped(id), id);
  }

  const schemas = new Map<string, Params>();
  const schema = ({ id, command }: Entry) => {
    let json = schemas.get(id);
    if (!json)
      schemas.set(id, (json = z.toJSONSchema(z.object(command.args ?? {}), { io: 'input' })));
    return json;
  };

  const resources = [
    ...(app.resources ?? []).map(resource => ({
      uri: resource.uri,
      name: resource.name ?? resource.uri,
      description: resource.description,
      mimeType: resource.mimeType,
      read: () => resource.read(),
    })),
    ...[...tools.values()].map(({ id, path, command }) => ({
      uri: `${app.name}://help/${id}`,
      name: `help ${path.join(' ')}`,
      description: command.description,
      mimeType: 'text/plain',
      read: () => cli(app, command),
    })),
  ];

  const loadSkill: McpTool = {
    name: 'load_skill',
    description: 'Load a skill named in the server instructions; returns its full text',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'skill name' } },
      required: ['name'],
    },
    annotations: { readOnlyHint: true },
  };

  return {
    name: app.name,
    instructions: instructions(app),
    capabilities: resources.length ? { tools: {}, resources: {} } : { tools: {} },
    handlers: {
      'tools/list': () => ({
        tools: [
          ...[...tools.values()].map((entry): McpTool => ({
            name: entry.id,
            description: (entry.command.mcp || undefined)?.description ?? entry.command.description,
            inputSchema: schema(entry),
            annotations: { readOnlyHint: entry.command.access === 'read' },
          })),
          ...(named.size ? [loadSkill] : []),
        ],
      }),

      'tools/call': async (params, signal) => {
        const name = params.name as string;
        const args = (params.arguments ?? {}) as Params;

        if (name === 'load_skill' && named.size) {
          const skill = named.get(args.name as string);
          if (!skill)
            return failed(
              `Unknown skill ${JSON.stringify(args.name)}. Skills: ${[...named.keys()].join(', ')}`,
            );
          return { content: [text(readSkill(skill).text)] };
        }

        const entry = tools.get(name);
        if (!entry) throw Object.assign(new Error(`Unknown tool ${name}`), { code: -32602 });
        const { command } = entry;
        const parsed = z.object(command.args ?? {}).safeParse(args);
        if (!parsed.success)
          return failed(
            `Invalid arguments for ${name}:\n${z.prettifyError(parsed.error)}\n\nSchema: ${JSON.stringify(schema(entry))}`,
          );

        try {
          const result = await command.run(parsed.data, { signal });
          const body =
            command.mcp && command.mcp.text
              ? command.mcp.text(result)
              : typeof result === 'string'
                ? result
                : (JSON.stringify(result) ?? '');
          const next = command
            .next?.({ result, args: parsed.data })
            .map(hint => `${hint.usage}  # ${hint.blurb}`);
          return { content: [text(body), ...(next?.length ? [text(next.join('\n'))] : [])] };
        } catch (e) {
          return failed(String((e as Error)?.message ?? e));
        }
      },

      'resources/list': () => ({
        resources: resources.map(({ uri, name, description, mimeType }) => ({
          uri,
          name,
          description,
          ...(mimeType ? { mimeType } : {}),
        })),
      }),
      'resources/read': async params => {
        const resource = resources.find(r => r.uri === params.uri);
        if (!resource)
          throw Object.assign(new Error(`Unknown resource ${params.uri as string}`), {
            code: -32002,
          });
        return {
          contents: [
            {
              uri: resource.uri,
              ...(resource.mimeType ? { mimeType: resource.mimeType } : {}),
              text: await resource.read(),
            },
          ],
        };
      },
    },
  };
}

/**
 * Serves an app as an MCP server: one tool per command named by its path joined with `/`,
 * `load_skill` when the app has skills, help resources, and instructions followed by the app's index.
 * @param app - App to serve.
 * @param transport - Stdio, or loopback HTTP with a bearer token.
 * @returns A close function; for stdio, `done`, which resolves when stdin ends; for HTTP, the URL and bearer token.
 * @throws When two tool names collide after mapping to `[A-Za-z0-9_-]`, or two skills share a name.
 */
export async function serve(
  app: App,
  transport: Transport,
): Promise<{ url?: string; token?: string; done?: Promise<void>; close: () => Promise<void> }> {
  const mcp = server(app);
  if (transport === 'stdio') return serveStdio(mcp);

  const { host = '127.0.0.1', port = 0 } = transport.http;
  const token = randomUUID();
  const handle = httpHandler(mcp);
  const { createServer } = await import('node:http');
  const http = createServer((req, res) => {
    if (req.headers.authorization !== `Bearer ${token}`) {
      res.statusCode = 401;
      return res.end();
    }
    if ((req.url ?? '/').split('?')[0] !== `/${app.name}`) {
      res.statusCode = 404;
      return res.end();
    }
    handle(req, res);
  });
  await new Promise<void>((resolve, reject) => {
    http.once('error', reject);
    http.listen(port, host, () => {
      http.off('error', reject);
      resolve();
    });
  });
  const address = http.address() as { port: number };

  return {
    url: `http://${host.includes(':') ? `[${host}]` : host}:${address.port}/${app.name}`,
    token,
    close: () =>
      new Promise(resolve => {
        http.closeAllConnections();
        http.close(() => resolve());
      }),
  };
}
