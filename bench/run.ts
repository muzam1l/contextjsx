// Import time of each dist entry in Node, and serve connect plus tools/list over stdio and HTTP with the official client. Median of 5 runs.
import { execFileSync } from 'node:child_process';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { serve } from 'contextjsx/serve';
import { app } from '../test/fixtures/sample-app';

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1]!;
const script = new URL('../test/fixtures/serve-stdio.ts', import.meta.url).pathname;

const importMs = (entry: string) =>
  Number(
    execFileSync('node', [
      '--input-type=module',
      '-e',
      `const t = performance.now(); await import('${new URL(`../dist/${entry}.mjs`, import.meta.url).href}'); console.log(performance.now() - t);`,
    ]).toString(),
  );

async function stdio() {
  const t = performance.now();
  const client = new Client({ name: 'bench', version: '0' });
  await client.connect(
    new StdioClientTransport({ command: 'bun', args: ['run', script], stderr: 'ignore' }),
  );
  await client.listTools();
  const ms = performance.now() - t;
  await client.close();
  return ms;
}

async function http() {
  const { url, token, close } = await serve(app, { http: {} });
  const t = performance.now();
  const client = new Client({ name: 'bench', version: '0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url!), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  const { tools } = await client.listTools();
  const ms = performance.now() - t;
  const instructions = client.getInstructions() ?? '';
  await client.close();
  await close();
  return { ms, tools: tools.length, instructions: instructions.length };
}

const rows: string[] = [];
for (const entry of ['index', 'jsx-runtime', 'emit', 'serve'])
  rows.push(
    `${`node: import dist/${entry}.mjs`.padEnd(40)} ${median([1, 2, 3].map(() => importMs(entry))).toFixed(2)} ms`,
  );

const stdioMs: number[] = [];
const httpRuns: Awaited<ReturnType<typeof http>>[] = [];
for (let i = 0; i < 5; i++) {
  stdioMs.push(await stdio());
  httpRuns.push(await http());
}
rows.push(
  `${'serve stdio: spawn, connect, tools/list'.padEnd(40)} ${median(stdioMs).toFixed(1)} ms`,
  `${'serve HTTP: connect, tools/list'.padEnd(40)} ${median(httpRuns.map(r => r.ms)).toFixed(1)} ms   ${httpRuns[0]!.tools} tools, instructions ${httpRuns[0]!.instructions} chars`,
);
console.log(rows.join('\n'));
console.log('median of 5 runs, imports median of 3');
