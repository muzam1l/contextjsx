import { afterAll, beforeAll, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { dispatch, httpHandler, PROTOCOL, type Server } from '../src/serve/protocol';

let aborted = false;
const server: Server = {
  info: { name: 'echo', version: '0' },
  instructions: 'Echo things.',
  capabilities: { tools: {} },
  handlers: {
    'tools/list': () => ({ tools: [] }),
    slow: (_params, signal) =>
      new Promise(resolve =>
        signal.addEventListener('abort', () => {
          aborted = true;
          resolve({});
        }),
      ),
  },
};

let url = '';
const http = createServer(httpHandler(server));
beforeAll(async () => {
  await new Promise<void>(r => http.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${(http.address() as { port: number }).port}/`;
});
afterAll(() => new Promise<void>(r => http.close(() => r())));

const post = (body: string, headers: Record<string, string> = {}) =>
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body });

test('initialize answers the asked version, capabilities and instructions', async () => {
  const handle = dispatch(server);
  expect(
    await handle({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18' },
    }),
  ).toEqual({
    jsonrpc: '2.0',
    id: 1,
    result: {
      protocolVersion: '2025-06-18',
      capabilities: { tools: {} },
      serverInfo: { name: 'echo', version: '0' },
      instructions: 'Echo things.',
    },
  });
  const unknown = await handle({
    jsonrpc: '2.0',
    id: 2,
    method: 'initialize',
    params: { protocolVersion: '1999-01-01' },
  });
  expect((unknown?.result as { protocolVersion: string }).protocolVersion).toBe(PROTOCOL);
});

test('an unknown method is -32601', async () => {
  expect(await dispatch(server)({ jsonrpc: '2.0', id: 1, method: 'nope' })).toEqual({
    jsonrpc: '2.0',
    id: 1,
    error: { code: -32601, message: 'Method not found: nope' },
  });
});

test('notifications/cancelled aborts the running request of the same session', async () => {
  const handle = dispatch(server);
  const running = handle({ jsonrpc: '2.0', id: 7, method: 'slow' }, 's1');
  await handle(
    { jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 7 } },
    's2',
  );
  expect(aborted).toBe(false);
  await handle(
    { jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 7 } },
    's1',
  );
  await running;
  expect(aborted).toBe(true);
});

test('HTTP: GET is 405, a foreign origin 403, an unknown version 400, bad JSON 400', async () => {
  expect((await fetch(url)).status).toBe(405);
  expect((await post('{}', { origin: 'http://evil.example' })).status).toBe(403);
  expect((await post('{}', { 'mcp-protocol-version': '1999-01-01' })).status).toBe(400);
  const bad = await post('{');
  expect([bad.status, await bad.json()]).toEqual([
    400,
    { jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' } },
  ]);
});

test('HTTP: initialize sets a session id, a notification is 202', async () => {
  const init = await post(
    JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
  );
  expect(init.headers.get('mcp-session-id')).toMatch(/^[0-9a-f-]{36}$/);
  const note = await post(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }));
  expect(note.status).toBe(202);
});

test('stdio answers null and malformed messages with -32600 and keeps serving', () => {
  const script = new URL('./fixtures/serve-stdio.ts', import.meta.url).pathname;
  const input = [
    'null',
    '[1]',
    '{"jsonrpc":"2.0","id":1,"method":5}',
    '{"jsonrpc":"1.0","id":2,"method":"ping"}',
    '{"jsonrpc":"2.0","id":3,"method":"ping"}',
  ].join('\n');
  const r = spawnSync('bun', ['run', script], { input: `${input}\n`, encoding: 'utf8' });
  const invalid = { code: -32600, message: 'Invalid request' };
  expect(
    r.stdout
      .trim()
      .split('\n')
      .map(line => JSON.parse(line) as unknown),
  ).toEqual([
    { jsonrpc: '2.0', error: invalid },
    { jsonrpc: '2.0', error: invalid },
    { jsonrpc: '2.0', id: 1, error: invalid },
    { jsonrpc: '2.0', id: 2, error: invalid },
    { jsonrpc: '2.0', id: 3, result: {} },
  ]);
  expect([r.status, r.stderr]).toEqual([0, 'closed after stdin ended\n']);
});

test('HTTP answers a message that is not JSON-RPC 2.0 with 400 and -32600', async () => {
  const res = await post('{"jsonrpc":"1.0","id":1,"method":"ping"}');
  expect([res.status, await res.json()]).toEqual([
    400,
    { jsonrpc: '2.0', id: 1, error: { code: -32600, message: 'Invalid request' } },
  ]);
});

test('request ids 7 and "7" are cancelled separately', async () => {
  let stopped = false;
  const handle = dispatch({
    ...server,
    handlers: {
      wait: (_params, signal) =>
        new Promise(resolve => {
          signal.addEventListener('abort', () => (stopped = true));
          setTimeout(() => resolve({}), 20);
        }),
    },
  });
  const running = handle({ jsonrpc: '2.0', id: 7, method: 'wait' });
  await handle({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: '7' } });
  await running;
  expect(stopped).toBe(false);
});

test('inherited names like toString are method not found', async () => {
  expect(await dispatch(server)({ jsonrpc: '2.0', id: 1, method: 'toString' })).toEqual({
    jsonrpc: '2.0',
    id: 1,
    error: { code: -32601, message: 'Method not found: toString' },
  });
});
