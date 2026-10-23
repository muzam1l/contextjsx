import { afterAll, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import * as zm from 'zod/mini';
import { defineApp, defineCommand } from 'contextjsx';
import { serve } from 'contextjsx/serve';
import { instructions } from 'contextjsx/emit';
import { app, status } from './fixtures/sample-app';

const closers: Array<() => Promise<void>> = [];
afterAll(async () => {
  for (const close of closers.reverse()) await close();
});

const script = new URL('./fixtures/serve-stdio.ts', import.meta.url).pathname;

const overHttp = async (served: Parameters<typeof serve>[0]) => {
  const { url, token, close } = await serve(served, { http: { port: 0 } });
  closers.push(close);
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url!), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  closers.push(() => client.close());
  return client;
};

const overStdio = async () => {
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(
    new StdioClientTransport({ command: 'bun', args: ['run', script], stderr: 'ignore' }),
  );
  closers.push(() => client.close());
  return client;
};

const texts = (result: Awaited<ReturnType<Client['callTool']>>) =>
  (result.content as Array<{ text: string }>).map(block => block.text);

test('tools are named by their path joined with /, nested namespaces included, under 1 s', async () => {
  const start = performance.now();
  const client = await overHttp(app);
  const { tools } = await client.listTools();
  const ms = performance.now() - start;
  expect(tools.map(tool => [tool.name, tool.description, tool.annotations?.readOnlyHint])).toEqual([
    ['status', 'Show the daemon status', true],
    ['task/run', 'Dispatch a task to an engine', false],
    ['task/list', 'List recent tasks', true],
    ['agent/integrations/list', 'List integrations of an agent', true],
    ['load_skill', 'Load a skill named in the server instructions; returns its full text', true],
  ]);
  expect(tools[1]!.inputSchema).toEqual({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'what to do' },
      engine: { type: 'string', description: 'engine name' },
      wait: { type: 'boolean', default: false },
    },
    required: ['prompt'],
  });
  expect(ms).toBeLessThan(1000);
});

test('a call runs the command, uses mcp.text and appends next hints', async () => {
  const client = await overHttp(app);
  const result = await client.callTool({
    name: 'task/run',
    arguments: { prompt: 'fix', engine: 'claude' },
  });
  expect(texts(result)).toEqual([
    'started t-3 on claude',
    'app task result t-3 --wait  # wait for the result',
  ]);
  expect(
    texts(await client.callTool({ name: 'agent/integrations/list', arguments: { agent: 'a1' } })),
  ).toEqual(['slack, linear for a1']);
  expect(texts(await client.callTool({ name: 'task/list', arguments: { limit: 1 } }))).toEqual([
    '[{"id":"t-0"}]',
  ]);
});

test('instructions are the app text, a blank line, then the namespace blocks', async () => {
  const client = await overHttp(app);
  expect(client.getInstructions()).toMatchSnapshot();
  expect(client.getInstructions()).toBe(instructions(app));
});

test('an app without instructions sends only the blocks, uncapped', async () => {
  const long = 'x'.repeat(5000);
  const client = await overHttp({ ...app, instructions: undefined, description: long });
  expect(client.getInstructions()).toBe(
    instructions({ ...app, instructions: undefined, description: long }),
  );
});

test('load_skill returns a JSX skill body', async () => {
  const client = await overHttp(app);
  const [body] = texts(
    await client.callTool({ name: 'load_skill', arguments: { name: 'app-tasks' } }),
  );
  expect(body).toBe(
    `## When to use\n\nThe user asks to run, list or wait for a task.\n\n## Rules\n\nNever retry a write after a timeout.`,
  );
});

test('load_skill returns a file skill without its frontmatter', async () => {
  const client = await overHttp(app);
  expect(
    texts(await client.callTool({ name: 'load_skill', arguments: { name: 'integrations' } })),
  ).toEqual(['# Integrations\n\nList them with `agent/integrations/list`, then pick one.']);
});

test('load_skill of an unknown name is an error result listing the skills', async () => {
  const client = await overHttp(app);
  const result = await client.callTool({ name: 'load_skill', arguments: { name: 'nope' } });
  expect(result.isError).toBe(true);
  expect(texts(result)).toEqual([
    [
      'Unknown skill "nope". Skills:',
      '- "app-tasks": Run coding tasks through app. Use when the user asks to dispatch or inspect a task.',
      '- "integrations": Connect an agent to Slack or Linear. Use when the user asks which integrations an agent has.',
    ].join('\n'),
  ]);
});

test('an app without skills has no load_skill tool', async () => {
  const client = await overHttp({ ...app, skills: [], namespaces: [] });
  expect((await client.listTools()).tools.map(tool => tool.name)).toEqual(['status']);
});

test('invalid arguments return the issues and the command schema', async () => {
  const client = await overHttp(app);
  const result = await client.callTool({ name: 'task/run', arguments: { engine: 1 } });
  expect(result.isError).toBe(true);
  const [text] = texts(result);
  expect(text).toStartWith('Invalid arguments for task/run:\n✖ Invalid input: expected string');
  expect(text).toContain('→ at prompt');
  expect(text).toContain(
    'Schema: {"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"prompt"',
  );
});

test('a thrown error is an error result with its message', async () => {
  const boom = { ...status, run: () => Promise.reject(new Error('daemon down')) };
  const client = await overHttp({ ...app, commands: [boom] });
  const result = await client.callTool({ name: 'status', arguments: {} });
  expect([result.isError, texts(result)]).toEqual([true, ['daemon down']]);
});

test('a returned string or plain object serves as one text block, even one shaped like content', async () => {
  const say = { ...status, run: () => 'up' };
  const dump = { ...status, name: 'dump', run: () => ({ content: [{ type: 'text', text: 42 }] }) };
  const client = await overHttp({ ...app, commands: [say, dump] });
  expect(await client.callTool({ name: 'status', arguments: {} })).toEqual({
    content: [{ type: 'text', text: 'up' }],
  });
  expect(await client.callTool({ name: 'dump', arguments: {} })).toEqual({
    content: [{ type: 'text', text: '{"content":[{"type":"text","text":42}]}' }],
  });
});

test('a returned MCP call-tool result serves as is, image block and isError included', async () => {
  const passed = {
    content: [
      { type: 'text' as const, text: 'shot failed' },
      { type: 'image' as const, data: 'iVBORw0KGgo=', mimeType: 'image/png' },
    ],
    structuredContent: { code: 7 },
    isError: true,
  };
  const proxy = { ...status, run: () => passed };
  const client = await overHttp({ ...app, commands: [proxy] });
  expect(await client.callTool({ name: 'status', arguments: {} })).toEqual(passed);
});

test('mcp: false commands are absent from tools, resources and instructions', async () => {
  const client = await overHttp(app);
  expect((await client.listTools()).tools.map(tool => tool.name)).not.toContain('login');
  expect((await client.listResources()).resources.map(r => r.uri)).not.toContain(
    'app://help/login',
  );
  expect(client.getInstructions()).not.toContain('login');
});

test('resources: app resources, then help per command at its / path', async () => {
  const client = await overHttp(app);
  const { resources } = await client.listResources();
  expect(resources.map(resource => resource.uri)).toEqual([
    'app://engines',
    'app://help/status',
    'app://help/task/run',
    'app://help/task/list',
    'app://help/agent/integrations/list',
  ]);
  expect((await client.readResource({ uri: 'app://engines' })).contents[0]).toMatchObject({
    text: 'codex\nclaude',
  });
  const help = await client.readResource({ uri: 'app://help/agent/integrations/list' });
  expect((help.contents[0] as { text: string }).text).toStartWith(
    'agent integrations list <agent>',
  );
});

test('zod/mini shapes give the schema and validate calls', async () => {
  const greet = defineCommand({
    name: 'greet',
    description: 'Greet someone',
    args: { name: zm.string().check(zm.describe('who to greet')) },
    access: 'read',
    run: args => `hi ${args.name}`,
  });
  const client = await overHttp(
    defineApp({ name: 'mini', description: 'Mini', commands: [greet] }),
  );
  expect((await client.listTools()).tools[0]!.inputSchema).toMatchObject({
    properties: { name: { type: 'string', description: 'who to greet' } },
    required: ['name'],
  });
  expect(texts(await client.callTool({ name: 'greet', arguments: { name: 'ada' } }))).toEqual([
    'hi ada',
  ]);
});

test('serve throws when two tool names collide after mapping to [A-Za-z0-9_-]', async () => {
  const clash = {
    ...app,
    commands: [{ ...status, name: 'task_run' }],
  };
  await expect(serve(clash, 'stdio')).rejects.toThrow(
    'tools "task_run" and "task/run" both map to task_run',
  );
  const skill = { ...app, commands: [{ ...status, name: 'load.skill' }] };
  await expect(serve(skill, 'stdio')).rejects.toThrow(
    'tools "load.skill" and "load_skill" both map to load_skill',
  );
});

test('serve throws when two commands share a tool id', async () => {
  const twice = { ...app, commands: [status, { ...status }] };
  await expect(serve(twice, 'stdio')).rejects.toThrow('two commands have the tool id "status"');
});

test('serve throws when two skills share a name', async () => {
  const twin = { ...app, skills: [{ name: 'integrations', description: 'd' }] };
  await expect(serve(twin, 'stdio')).rejects.toThrow('two skills are named "integrations"');
});

test('the official client lists and calls a / tool and load_skill over stdio, with instructions', async () => {
  const client = await overStdio();
  expect((await client.listTools()).tools.map(tool => tool.name)).toContain(
    'agent/integrations/list',
  );
  expect(
    texts(await client.callTool({ name: 'agent/integrations/list', arguments: { agent: 'a' } })),
  ).toEqual(['slack, linear for a']);
  expect(
    texts(await client.callTool({ name: 'load_skill', arguments: { name: 'integrations' } }))[0],
  ).toStartWith('# Integrations');
  expect(client.getInstructions()).toBe(instructions(app));
});

test('serve over stdio resolves done when stdin ends', () => {
  const r = spawnSync('bun', ['run', script], { input: '', encoding: 'utf8' });
  expect([r.status, r.stderr]).toEqual([0, 'closed after stdin ended\n']);
});

test('serve over HTTP rejects an unauthenticated request, a wrong path and a taken port', async () => {
  const { url, token, close } = await serve(app, { http: { port: 0 } });
  closers.push(close);
  expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/app$/);
  expect((await fetch(url!, { method: 'POST' })).status).toBe(401);
  const other = new URL('/other', url).href;
  const headers = { Authorization: `Bearer ${token}` };
  expect((await fetch(other, { method: 'POST', headers })).status).toBe(404);
  await expect(serve(app, { http: { port: Number(new URL(url!).port) } })).rejects.toThrow();
});

test('serverInfo carries the app description and spec fields, instructions stay separate', async () => {
  const client = await overHttp(
    defineApp({
      name: 'info',
      title: 'Info',
      version: '1.2.3',
      description: 'What the app does.',
      websiteUrl: 'https://example.com',
      instructions: 'How to use it.',
      commands: [],
    }),
  );
  expect(client.getServerVersion()).toEqual({
    name: 'info',
    title: 'Info',
    version: '1.2.3',
    description: 'What the app does.',
    websiteUrl: 'https://example.com',
  });
  expect(client.getInstructions()).toStartWith('How to use it.');
});
