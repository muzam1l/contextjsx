import { expect, test } from 'bun:test';
import * as z from 'zod';
import * as zm from 'zod/mini';
import { defineApp, defineCommand, defineSkill } from 'contextjsx';
import type { Args } from 'contextjsx';
import { cli, parse } from 'contextjsx/emit';
import { app, taskRun } from './fixtures/sample-app';

test('definitions are plain data with types inferred from the literal', async () => {
  const args: Args<NonNullable<typeof taskRun.args>> = { prompt: 'x', wait: true };
  const result = await taskRun.run(args, {});
  const id: string = result.id;
  expect(id).toBe('t-1');
  expect(app.namespaces[0]!.commands[0]).toBe(taskRun);
  expect(taskRun.next?.({ result, args })).toEqual([
    { usage: 'app task result t-1 --wait', blurb: 'wait for the result' },
  ]);

  defineCommand({
    name: 'a',
    description: 's',
    args: { a: z.string() },
    access: 'read',
    run: args => args.a,
    // @ts-expect-error positional names an unknown argument
    cli: { positional: ['b'] },
  });
  // @ts-expect-error access is required
  defineCommand({ name: 'a', description: 's', run: () => 1 });
});

test('a skill takes a body or a file, never both; name and description are optional only on a file', () => {
  defineSkill({ name: 'a', description: 'd', body: 'text' });
  defineSkill({ file: 'guide.md' });
  // @ts-expect-error body and file are exclusive
  defineSkill({ name: 'a', description: 'd', body: 'text', file: 'guide.md' });
  // @ts-expect-error an inline skill needs a name and a description
  defineSkill({ body: 'text' });
});

test('a full app spreads the CLI app and adds instructions and skills', () => {
  const base = defineApp({ name: 'x', description: 'X tool', commands: [taskRun] });
  const full = defineApp({ ...base, instructions: 'Use x.', skills: [] });
  expect(full.commands[0]).toBe(taskRun);
  expect(full.instructions).toBe('Use x.');
});

test('zod/mini shapes work through parse and cli', () => {
  const greet = defineCommand({
    name: 'greet',
    description: 'Greet someone',
    args: {
      name: zm.string().check(zm.describe('who to greet')),
      times: zm.optional(zm.coerce.number()),
      loud: zm._default(zm.boolean(), false),
    },
    access: 'read',
    cli: { positional: ['name'] },
    run: args => `${args.loud ? 'HI' : 'hi'} ${args.name} x${args.times ?? 1}`,
  });
  const args: { name: string; times?: number | undefined; loud: boolean } = parse(greet, [
    'ada',
    '--times',
    '2',
    '--loud',
  ]);
  expect(args).toEqual({ name: 'ada', times: 2, loud: true });
  const mini = defineApp({ name: 'mini', description: 'Mini shapes', commands: [greet] });
  expect(cli(mini, greet)).toContain('<name>           who to greet');
});
