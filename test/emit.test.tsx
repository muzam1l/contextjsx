import { expect, test } from 'bun:test';
import * as z from 'zod';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  cli,
  instructions,
  markdown,
  parse,
  ParseError,
  readSkill,
  resolve,
  run,
  skills,
  walk,
} from 'contextjsx/emit';
import {
  app,
  dispatch,
  filed,
  flowRun,
  integrationsList,
  large,
  login,
  status,
  taskList,
  taskRun,
  wide,
} from './fixtures/sample-app';

const bare = { ...app, namespaces: [] };

test('walk gives every command its path and a tool id joined with /', () => {
  const { commands, namespaces, skills } = walk(app);
  expect(commands.map(entry => entry.id)).toEqual([
    'status',
    'login',
    'task/run',
    'task/list',
    'agent/integrations/list',
  ]);
  expect(commands[4]).toEqual({
    path: ['agent', 'integrations', 'list'],
    id: 'agent/integrations/list',
    command: integrationsList,
  });
  expect(namespaces.map(entry => entry.path.join(' '))).toEqual([
    'task',
    'agent',
    'agent integrations',
  ]);
  expect(skills).toEqual([app.skills[0]!, filed]);
});

test('instructions render the app text, then the namespace blocks, nested ones indented, mcp: false left out', () => {
  expect(instructions({ ...app, instructions: undefined })).toBe(
    [
      'app: Runs coding tasks on engines',
      '  tools: status',
      '  skills: app-tasks',
      '  task: Run and inspect tasks',
      '    tools: run list',
      '  agent: Configure agents',
      '    integrations: Agent integrations',
      '      tools: list',
      '      skills: integrations',
    ].join('\n'),
  );
});

test('instructions of a 40-command app are under 50 lines and 10 ms', () => {
  instructions(large);
  const start = performance.now();
  const text = instructions(large);
  const ms = performance.now() - start;
  expect(text.split('\n').length).toBeLessThan(50);
  expect(ms).toBeLessThan(10);
});

test('readSkill keeps a plain string body as written', () => {
  expect(readSkill({ name: 'a', description: 'd', body: '# Title\n\n- one\n- two\n' }).text).toBe(
    '# Title\n\n- one\n- two',
  );
});

test('readSkill takes name and description from the file frontmatter, body without it', () => {
  expect(readSkill(filed)).toEqual({
    file: filed.file,
    name: 'integrations',
    description:
      'Connect an agent to Slack or Linear. Use when the user asks which integrations an agent has.',
    text: '# Integrations\n\nList them with `agent/integrations/list`, then pick one.',
  });
});

const skillFile = (content: string) => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'contextjsx-skill-')), 'SKILL.md');
  writeFileSync(file, content);
  return file;
};

test('readSkill reads single- and double-quoted frontmatter values', () => {
  const file = skillFile(`---\nname: "dq"\ndescription: 'it''s "quoted"'\n---\nBody\n`);
  expect(readSkill({ file })).toMatchObject({ name: 'dq', description: 'it\'s "quoted"' });
});

test('readSkill reads folded and literal block descriptions', () => {
  const folded =
    '---\nname: f\ndescription: >-\n  Connect an agent\n  to Slack.\n\n  Use when asked.\nlicense: MIT\n---\n';
  expect(readSkill({ file: skillFile(folded) }).description).toBe(
    'Connect an agent to Slack.\nUse when asked.',
  );
  const literal = '---\nname: l\ndescription: |\n  line one\n  line two\n---\n';
  expect(readSkill({ file: skillFile(literal) }).description).toBe('line one\nline two');
});

test('readSkill: the definition wins over the frontmatter', () => {
  const file = skillFile('---\nname: other\ndescription: theirs\n---\nBody\n');
  expect(readSkill({ file, name: 'mine' })).toMatchObject({
    name: 'mine',
    description: 'theirs',
    text: 'Body',
  });
});

test('readSkill throws when neither the definition nor the frontmatter gives a name and description', () => {
  const file = skillFile('No frontmatter\n');
  expect(readSkill({ file, name: 'n', description: 'd' }).text).toBe('No frontmatter');
  expect(() => readSkill({ file })).toThrow(`skill file ${file} needs a name and a description`);
});

test('skills emits one SKILL.md per skill that meets the Agent Skills rules', () => {
  const outDir = mkdtempSync(path.join(tmpdir(), 'contextjsx-skills-'));
  const files = skills(app, { outDir });
  const file = path.join(outDir, 'app-tasks', 'SKILL.md');
  expect(readdirSync(outDir).sort()).toEqual(['app-tasks', 'integrations']);
  expect(files[file]).toBe(readFileSync(file, 'utf8'));
  expect(skills(app)['app-tasks/SKILL.md']).toBe(files[file]);

  const content = files[file]!;
  const [, frontmatter = ''] = content.split(/^---$/m);
  const name = frontmatter.match(/^name: (.+)$/m)?.[1] ?? '';
  const description = JSON.parse(frontmatter.match(/^description: (.+)$/m)?.[1] ?? '""') as string;
  expect(name).toBe('app-tasks');
  expect(name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  expect(description.length).toBeGreaterThan(0);
  expect(description.length).toBeLessThanOrEqual(1024);

  for (const bad of ['', 'App', '-app', 'app-', 'a--b', 'a_b', 'x'.repeat(65)])
    expect(() => skills({ ...bare, skills: [{ name: bad, description: 'd' }] })).toThrow(
      'skill name',
    );
  expect(() => skills({ ...bare, skills: [{ name: 'ok', description: '' }] })).toThrow(
    'description',
  );
  for (const compatibility of ['', 'x'.repeat(501)])
    expect(() =>
      skills({ ...bare, skills: [{ name: 'ok', description: 'd', compatibility }] }),
    ).toThrow('compatibility must be 1 to 500 characters');
});

test('skills writes the spec frontmatter, the generated marker, then the body as written', () => {
  expect(skills(app)['app-tasks/SKILL.md']).toBe(
    [
      '---',
      'name: app-tasks',
      'description: "Run coding tasks through app. Use when the user asks to dispatch or inspect a task."',
      'license: "MIT"',
      'compatibility: "Needs the app binary on PATH."',
      'metadata:',
      '  "version": "1.0"',
      'allowed-tools: "Bash(app:*) Read"',
      '---',
      '',
      '<!-- Generated by contextjsx from definitions. Edit the source, not this file. -->',
      '',
      '## When to use',
      '',
      'The user asks to run, list or wait for a task.',
      '',
      '## Rules',
      '',
      'Never retry a write after a timeout.',
      '',
    ].join('\n'),
  );
  expect(
    skills({ ...bare, skills: [{ name: 'bare', description: 'd' }] }, { note: false }),
  ).toEqual({
    'bare/SKILL.md': '---\nname: bare\ndescription: "d"\n---\n',
  });
});
test('skills copies a file skill with regenerated frontmatter', () => {
  expect(skills(app, { note: false })['integrations/SKILL.md']).toBe(
    [
      '---',
      'name: integrations',
      'description: "Connect an agent to Slack or Linear. Use when the user asks which integrations an agent has."',
      '---',
      '',
      '# Integrations',
      '',
      'List them with `agent/integrations/list`, then pick one.',
      '',
    ].join('\n'),
  );
});

test('skills rejects two skills with the same name', () => {
  const twin = { name: 'integrations', description: 'd' };
  expect(() => skills({ ...app, skills: [twin] })).toThrow('two skills are named "integrations"');
});

test('cli renders help text for a command or a namespace, path from the app', () => {
  expect(cli(app, taskRun)).toMatchSnapshot();
  expect(cli(app, app.namespaces[0])).toMatchSnapshot();
  expect(cli(app, integrationsList)).toStartWith('agent integrations list <agent>\n');
  expect(cli(app, app.namespaces[1])).toContain('agent integrations: Agent integrations');
});

test('markdown renders a reference, one page per top-level namespace', () => {
  const outDir = mkdtempSync(path.join(tmpdir(), 'contextjsx-docs-'));
  const pages = markdown(app);
  expect(Object.keys(pages)).toEqual(['index.md', 'task.md', 'agent.md']);
  markdown(app, { outDir });
  expect(readdirSync(outDir).sort()).toEqual(['agent.md', 'index.md', 'task.md']);
  expect(Object.values(pages)).toMatchSnapshot();
});

test('markdown rejects namespaces whose pages collide', () => {
  const namespace = (name: string) => ({ name, description: 's', commands: [] });
  expect(() => markdown({ ...app, namespaces: [namespace('index')] })).toThrow(
    'the index page and namespace "index" both map to page index.md',
  );
  expect(() => markdown({ ...app, namespaces: [namespace('a'), namespace('a')] })).toThrow(
    'namespace "a" and namespace "a" both map to page a.md',
  );
});

const fails = (argv: string[]) => {
  try {
    parse(dispatch, argv);
  } catch (error) {
    expect(error).toBeInstanceOf(ParseError);
    return { message: (error as ParseError).message, arg: (error as ParseError).arg };
  }
  throw new Error('parse did not throw');
};

test('parse fills cli.positional names in order', () => {
  expect(parse(dispatch, ['fix', 'main'])).toEqual({ prompt: 'fix', target: 'main', wait: false });
  expect(parse(dispatch, ['fix'])).toEqual({ prompt: 'fix', wait: false });
});

test('parse reads a bare boolean flag as true and --x=false as false', () => {
  expect(parse(dispatch, ['p', '--wait']).wait).toBe(true);
  expect(parse(dispatch, ['p', '--wait=false']).wait).toBe(false);
});

test('parse reads --no-<flag> as false for any boolean flag', () => {
  const noted = {
    name: 'emit',
    description: 'Emit',
    args: { note: z.boolean().default(true), 'no-cache': z.boolean().default(false) },
    access: 'write' as const,
    run: () => 'ok',
  };
  expect(parse(noted, [])).toEqual({ note: true, 'no-cache': false });
  expect(parse(noted, ['--no-note'])).toEqual({ note: false, 'no-cache': false });
  expect(parse(noted, ['--no-cache'])).toEqual({ note: true, 'no-cache': true });
  expect(parse(dispatch, ['p', '--wait', '--no-wait']).wait).toBe(false);
  expect(() => parse(dispatch, ['p', '--no-engine'])).toThrow('Unknown option --no-engine');
  const help = cli({ name: 'x', description: 'X', commands: [noted] }, noted);
  expect(help).toStartWith('emit [--no-note] [--no-cache]\n');
});

test('parse treats an option after a value-taking option as a missing value', () => {
  expect(fails(['p', '--engine', '--wait'])).toEqual({
    message: 'Missing value for --engine',
    arg: 'engine',
  });
  expect(parse(dispatch, ['p', '--engine=--wait']).engine).toBe('--wait');
  expect(parse(dispatch, ['p', '--engine', '-']).engine).toBe('-');
});

test('parse accepts only true or false after = on a boolean flag', () => {
  expect(parse(dispatch, ['p', '--wait=true']).wait).toBe(true);
  expect(fails(['p', '--wait=garbage'])).toEqual({
    message: 'Invalid --wait value "garbage": expected true or false',
    arg: 'wait',
  });
});

test('parse reports inherited names like --toString as unknown options', () => {
  expect(fails(['p', '--toString']).message).toBe(
    'Unknown option --toString (use -- to pass literal text starting with -)',
  );
  expect(fails(['p', '--no-constructor']).arg).toBe('no-constructor');
});

test('parse collects a repeated array flag', () => {
  expect(parse(dispatch, ['p', '--add-dir', 'a', '--add-dir=b'])['add-dir']).toEqual(['a', 'b']);
});

test('parse reads a true-or-string flag as true when bare or before a flag, else as the string', () => {
  expect(parse(dispatch, ['p', '--server']).server).toBe(true);
  expect(parse(dispatch, ['p', '--server', '--wait'])).toMatchObject({ server: true, wait: true });
  expect(parse(dispatch, ['p', '--server', 'http://x']).server).toBe('http://x');
});

test('parse takes --name=value and --name value, and -- ends flag parsing', () => {
  expect(parse(dispatch, ['--engine=a=b', 'p']).engine).toBe('a=b');
  expect(parse(dispatch, ['p', '--engine', 'codex']).engine).toBe('codex');
  expect(parse(dispatch, ['p', '--', '--wait'])).toEqual({
    prompt: 'p',
    target: '--wait',
    wait: false,
  });
});

test('parse throws ParseError with a one-line message and the offending arg', () => {
  expect(fails(['p', '--nope'])).toEqual({
    message: 'Unknown option --nope (use -- to pass literal text starting with -)',
    arg: 'nope',
  });
  expect(fails(['--prompt', 'p']).arg).toBe('prompt');
  expect(fails(['p', '--engine'])).toEqual({
    message: 'Missing value for --engine',
    arg: 'engine',
  });
  expect(fails(['a', 'b', 'c', 'd'])).toEqual({ message: 'Unexpected arguments: c d', arg: 'c' });
  expect(fails([])).toEqual({ message: 'Missing prompt.', arg: 'prompt' });
  expect(fails(['p', '--limit', '0'])).toEqual({
    message: 'Invalid --limit value "0": Too small: expected number to be >0',
    arg: 'limit',
  });
});

test('parse gives a last array positional every remaining word', () => {
  expect(parse(flowRun, ['deploy', 'env=prod', '--wait', 'region=eu'])).toEqual({
    flow: 'deploy',
    inputs: ['env=prod', 'region=eu'],
    wait: true,
  });
  expect(parse(flowRun, ['deploy'])).toEqual({ flow: 'deploy' });
  expect(() => parse(flowRun, [])).toThrow('Missing flow.');
});

test('parse returns Args typed from the command', () => {
  const args: { prompt: string; wait: boolean; limit?: number | undefined } = parse(dispatch, [
    'p',
    '--limit',
    '3',
  ]);
  expect(args.limit).toBe(3);
  // @ts-expect-error not an argument of the command
  expect(args.nope).toBeUndefined();
});

test('parse of a 20-flag command, 1000 times, takes under 250 ms', () => {
  const argv = Array.from({ length: 20 }, (_, i) => [`--flag${i}`, `v${i}`]).flat();
  expect(Object.keys(parse(wide, argv))).toHaveLength(20);
  const start = performance.now();
  for (let i = 0; i < 1000; i++) parse(wide, argv);
  expect(performance.now() - start).toBeLessThan(250);
});

test('resolve walks argv to the longest command or namespace path', () => {
  expect(resolve(app, ['task', 'run', 'fix'])).toEqual({
    command: taskRun,
    path: ['task', 'run'],
    rest: ['fix'],
  });
  expect(resolve(app, ['status'])).toEqual({ command: status, path: ['status'], rest: [] });
  expect(resolve(app, ['task', 'nope'])).toEqual({
    namespace: app.namespaces[0]!,
    path: ['task'],
    rest: ['nope'],
  });
  expect(resolve(app, ['agent', 'integrations', 'list', 'a1'])).toEqual({
    command: integrationsList,
    path: ['agent', 'integrations', 'list'],
    rest: ['a1'],
  });
  expect(resolve(app, ['nope'])).toBeUndefined();
});

test('resolve honours namespace aliases and returns the real path', () => {
  const task = { ...app.namespaces[0]!, aliases: { ls: 'list' } };
  expect(resolve({ ...app, namespaces: [task] }, ['task', 'ls', '--limit', '2'])).toEqual({
    command: taskList,
    path: ['task', 'list'],
    rest: ['--limit', '2'],
  });
});

test('cli renders cli.env as an Environment table and markdown as a list', () => {
  const command = {
    ...status,
    cli: {
      env: [
        ['APP_TOKEN', 'API token'],
        ['APP_HOME', 'state directory'],
      ] as Array<[string, string]>,
    },
  };
  expect(cli(app, command)).toContain(
    'Environment:\n  APP_TOKEN  API token\n  APP_HOME   state directory',
  );
  expect(cli(app, command)).toStartWith('status\n');
  expect(markdown({ ...app, commands: [command] })['index.md']).toContain(
    'Environment:\n\n- `APP_TOKEN` API token\n- `APP_HOME` state directory',
  );
});

test('markdown names the main page with the index option', () => {
  expect(Object.keys(markdown(app, { index: 'cli.md' }))).toEqual([
    'cli.md',
    'task.md',
    'agent.md',
  ]);
  const namespace = { name: 'cli', description: 's', commands: [] };
  expect(() => markdown({ ...app, namespaces: [namespace] }, { index: 'cli.md' })).toThrow(
    'the index page and namespace "cli" both map to page cli.md',
  );
});

test('cli renders an app: name, description, then its commands and namespaces', () => {
  expect(cli(app)).toBe(
    [
      'app',
      'Runs coding tasks on engines',
      [
        'Commands:',
        '  status: Show the daemon status',
        '  login: Log in on this machine',
        '  task: Run and inspect tasks',
        '  agent: Configure agents',
      ].join('\n'),
    ].join('\n\n'),
  );
  expect(cli(app, login)).toContain('Log in on this machine');
});

const runs = async (argv: string[]) => {
  let out = '';
  let err = '';
  const code = await run(app, argv, { out: text => (out += text), err: text => (err += text) });
  return { code, out, err };
};

test('run prints help for a bare app, a bare namespace, and --help or -h before --', async () => {
  expect(await runs([])).toEqual({ code: 0, out: `${cli(app)}\n`, err: '' });
  expect(await runs(['--help'])).toEqual({ code: 0, out: `${cli(app)}\n`, err: '' });
  expect(await runs(['task'])).toEqual({
    code: 0,
    out: `${cli(app, app.namespaces[0])}\n`,
    err: '',
  });
  expect(await runs(['task', 'run', '-h'])).toEqual({
    code: 0,
    out: `${cli(app, taskRun)}\n`,
    err: '',
  });
  expect((await runs(['task', 'run', '--', '--help'])).out).toContain('"id": "t-6"');
});

test('run reports an unknown command with a help hint and exit code 1', async () => {
  expect(await runs(['nope'])).toEqual({
    code: 1,
    out: '',
    err: 'Unknown command nope\nHelp: app --help\n',
  });
  expect((await runs(['task', 'nope'])).err).toBe(
    'Unknown command task nope\nHelp: app task --help\n',
  );
});

test('run reports a ParseError with the command help hint and exit code 1', async () => {
  expect(await runs(['task', 'run', '--bogus'])).toEqual({
    code: 1,
    out: '',
    err: 'Unknown option --bogus (use -- to pass literal text starting with -)\nHelp: app task run --help\n',
  });
});

test('run prints a string result as is and any other value as JSON', async () => {
  expect(await runs(['status'])).toEqual({ code: 0, out: 'ok\n', err: '' });
  expect(await runs(['agent', 'integrations', 'list', 'a1'])).toEqual({
    code: 0,
    out: 'slack, linear for a1\n',
    err: '',
  });
  expect(await runs(['task', 'run', 'fix'])).toEqual({
    code: 0,
    out: `${JSON.stringify({ id: 't-3', engine: 'codex', wait: false }, null, 2)}\n`,
    err: '',
  });
});

test('run prints a thrown error and returns 1', async () => {
  const boom = { ...status, run: () => Promise.reject(new Error('daemon down')) };
  let err = '';
  const code = await run({ ...app, commands: [boom] }, ['status'], { err: text => (err += text) });
  expect([code, err]).toEqual([1, 'daemon down\n']);
});

test('run of a 40-command app routes and prints help in under 1 ms', async () => {
  const quiet = { out: () => {} };
  await run(large, ['group7', 'command4', '--help'], quiet);
  const start = performance.now();
  await run(large, ['group7', 'command4', '--help'], quiet);
  await run(large, ['group7', 'command4', 'x'], quiet);
  expect(performance.now() - start).toBeLessThan(1);
});

const note = '<!-- Generated by contextjsx from definitions. Edit the source, not this file. -->';

test('markdown and skills mark generated files by default', () => {
  for (const page of Object.values(markdown(app))) expect(page).toStartWith(`${note}\n\n# `);
  expect(skills(app)['app-tasks/SKILL.md']!.split('---\n')[2]).toStartWith(`\n${note}\n\n`);
  expect(skills(app)['integrations/SKILL.md']!.split('---\n')[2]).toStartWith(`\n${note}\n\n`);
});

test('note: false leaves the marker out of markdown and skills', () => {
  for (const page of Object.values(markdown(app, { note: false }))) expect(page).toStartWith('# ');
  expect(skills(app, { note: false })['app-tasks/SKILL.md']).not.toContain(
    'Generated by contextjsx',
  );
});
