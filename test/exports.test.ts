import { expect, test } from 'bun:test';
import pkg from '../package.json';

const names: Record<string, string[]> = {
  '.': [
    'jsx',
    'jsxs',
    'Fragment',
    'render',
    'Data',
    'Pre',
    'defineApp',
    'defineNamespace',
    'defineCommand',
    'defineSkill',
    'defineResource',
  ],
  './jsx-runtime': ['jsx', 'jsxs', 'Fragment'],
  './jsx-dev-runtime': ['jsxDEV', 'Fragment'],
  './emit': [
    'walk',
    'readSkill',
    'instructions',
    'cli',
    'markdown',
    'skills',
    'parse',
    'resolve',
    'run',
    'ParseError',
  ],
  './serve': ['serve'],
};

test('every subpath in dist exports its named functions', async () => {
  const dist = Object.entries(pkg.exports).filter(([k]) => k !== './package.json');
  expect(dist.map(([k]) => k).sort()).toEqual(Object.keys(names).sort());
  for (const [subpath, entry] of dist) {
    const mod = (await import(new URL(entry, new URL('../', import.meta.url)).href)) as Record<
      string,
      unknown
    >;
    for (const name of names[subpath]!)
      expect([subpath, name, typeof mod[name]]).toEqual([subpath, name, 'function']);
  }
});

test('zod is a required peer', () => {
  expect(pkg.peerDependencies.zod).toBe('^4.0.0');
  expect('peerDependenciesMeta' in pkg).toBe(false);
});

// Gzip bytes per entry, every local chunk it imports included; raise a number only with a reason.
const budgets: Record<string, number> = {
  emit: 5000,
  cli: 1350,
  serve: 7900,
  index: 1260,
  'jsx-runtime': 138,
  'jsx-dev-runtime': 225,
};

test('size budget: every dist file counts toward an entry, shared chunks included', async () => {
  const { gzipSync } = await import('node:zlib');
  const { readFileSync, readdirSync } = await import('node:fs');
  const dir = new URL('../dist/', import.meta.url);
  const read = (file: string) => readFileSync(new URL(file, dir), 'utf8');
  const counted = new Set<string>();
  for (const [name, max] of Object.entries(budgets)) {
    const files = new Set([`${name}.mjs`]);
    for (const file of files)
      for (const [, local] of read(file).matchAll(
        /(?:from|import)\s*["'`]\.\/([^"'`]+\.mjs)["'`]/g,
      ))
        files.add(local!);
    const gz = [...files].reduce((n, f) => n + gzipSync(read(f)).length, 0);
    for (const file of files) counted.add(file);
    expect([name, gz <= max ? 'ok' : `${gz} > ${max}`]).toEqual([name, 'ok']);
  }
  expect(readdirSync(dir).filter(f => f.endsWith('.mjs') && !counted.has(f))).toEqual([]);
});
