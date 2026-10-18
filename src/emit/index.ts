import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { render } from '../index';
import type { App, Args, Command, Namespace, Node, Shape, Skill } from '../index';

const text = (node: Node) => (node == null ? '' : render(node));

/** A command with its full path and its tool id, the path joined with `/`. */
export type Entry = { path: string[]; id: string; command: Command };

/**
 * Walks an app once, in definition order: root commands, then each namespace before its commands and nested namespaces.
 * @param app - App to walk.
 * @returns Every command with its path and id, every namespace with its path, and every skill.
 */
export function walk(app: App) {
  const commands: Entry[] = [];
  const namespaces: Array<{ path: string[]; namespace: Namespace }> = [];
  const skills: Skill[] = [...(app.skills ?? [])];
  const add = (at: string[], list: Command[] = []) => {
    for (const command of list) {
      const path = [...at, command.name];
      commands.push({ path, id: path.join('/'), command });
    }
  };
  const visit = (at: string[], list: Namespace[] = []) => {
    for (const namespace of list) {
      const path = [...at, namespace.name];
      namespaces.push({ path, namespace });
      add(path, namespace.commands);
      skills.push(...(namespace.skills ?? []));
      visit(path, namespace.namespaces);
    }
  };
  add([], app.commands);
  visit([], app.namespaces);

  return { commands, namespaces, skills };
}

// Frontmatter `key: value` lines, plain or quoted, and `|` / `>` blocks of the indented lines below; nothing else of YAML.
function frontmatter(head: string) {
  const fields: Record<string, string> = {};
  const lines = head.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const [, key, value = ''] = /^([\w-]+):\s*(.*?)\s*$/.exec(lines[i]!) ?? [];
    if (!key) continue;
    const block = /^[|>][+-]?$/.test(value);
    const body: string[] = [];
    while (block && /^(\s|$)/.test(lines[i + 1] ?? 'end')) body.push(lines[++i]!.trim());
    const folded = body
      .join('\n')
      .replace(/([^\n])\n(?=[^\n])/g, '$1 ')
      .replace(/\n(\n+)/g, '$1');
    if (block) fields[key] = (value[0] === '|' ? body.join('\n') : folded).trim();
    else if (/^".*"$/.test(value)) fields[key] = JSON.parse(value) as string;
    else fields[key] = /^'.*'$/.test(value) ? value.slice(1, -1).replaceAll("''", "'") : value;
  }
  return fields;
}

/**
 * A skill with its body as text: JSX rendered, or a `file` read without its leading `---` frontmatter block.
 * A file's frontmatter `name` and `description` fill the ones the definition leaves out.
 * @param skill - Skill to read.
 * @returns The skill with `name`, `description` and `text` set.
 * @throws When a `file` skill has no name or description in either place.
 */
export function readSkill(
  skill: Skill,
): Skill & { name: string; description: string; text: string } {
  if (skill.file === undefined) return { ...skill, text: text(skill.body).trim() };

  const raw = readFileSync(skill.file, 'utf8');
  const front = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/.exec(raw);
  const fields = frontmatter(front?.[1] ?? '');
  const name = skill.name ?? fields.name;
  const description = skill.description ?? fields.description;
  if (!name || !description)
    throw new Error(`contextjsx: skill file ${String(skill.file)} needs a name and a description`);

  return { ...skill, name, description, text: raw.slice(front?.[0].length ?? 0).trim() };
}

// Classic `.describe()` and mini `z.describe()` both write zod's global registry.
const describe = (schema: Shape[string]) =>
  (
    globalThis as {
      __zod_globalRegistry?: { get(schema: object): { description?: string } | undefined };
    }
  ).__zod_globalRegistry?.get(schema)?.description ?? '';

function args(command: Command) {
  const all = Object.entries(command.args ?? {});
  const positional = command.cli?.positional ?? [];
  const ordered = [
    ...positional.flatMap(name => all.filter(([key]) => key === name)),
    ...all.filter(([key]) => !positional.includes(key)),
  ];

  // `plain` for the argument list; `token` for signatures, optional ones in brackets.
  return ordered.map(([name, schema]) => {
    const type = kind(schema);
    const flag =
      type !== 'boolean'
        ? `--${name} <${name}>`
        : defOf(schema).defaultValue === true
          ? `--no-${name}`
          : `--${name}`;
    const plain = positional.includes(name) ? `<${name}>` : flag;
    const bare = positional.includes(name) ? name : flag;
    return {
      token: schema._zod.optin ? `[${bare}]` : plain,
      plain,
      description: describe(schema),
    };
  });
}

const signature = (path: string[], command: Command) =>
  [...path, ...args(command).map(arg => arg.token)].join(' ');

const line = (path: string[], command: Command) =>
  `${signature(path, command)}: ${command.description}`;

const table = (rows: Array<[string, string]>) => {
  const width = Math.max(...rows.map(([left]) => left.length));
  return rows
    .map(([left, right]) => (right ? `  ${left.padEnd(width)}  ${right}` : `  ${left}`))
    .join('\n');
};

/**
 * What an MCP server sends as instructions: the app's own text, then one block per namespace with its description, tool names and skill names, nested namespaces indented.
 * Tools are command names; `mcp: false` commands are left out.
 * @param app - App whose instructions are rendered.
 * @returns The app text, a blank line, then lines like `flow: Run flows`, `  tools: run list`, `  skills: flows`.
 */
export function instructions(app: App): string {
  const head = app.instructions == null ? '' : render(app.instructions);
  return [head, blocks(app)].filter(Boolean).join('\n\n');
}

function blocks(app: App): string {
  const block = (pad: string, commands: Command[] = [], skills: Skill[] = []) => {
    const tools = commands.filter(command => command.mcp !== false).map(command => command.name);
    return [
      tools.length && `${pad}tools: ${tools.join(' ')}`,
      skills.length &&
        `${pad}skills: ${skills.map(skill => skill.name ?? readSkill(skill).name).join(' ')}`,
    ];
  };

  return [
    `${app.name}: ${app.description}`,
    ...block('  ', app.commands, app.skills),
    ...walk(app).namespaces.flatMap(({ path, namespace }) => {
      const pad = '  '.repeat(path.length);
      return [
        `${pad}${namespace.name}: ${namespace.description}`,
        ...block(`${pad}  `, namespace.commands, namespace.skills),
      ];
    }),
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Plain text for the host's CLI renderer.
 * @param app - App the target sits in; its walk gives the target's path.
 * @param target - Command or namespace whose help is rendered; omit for the app's own help.
 * @returns Plain-text usage, description and applicable details.
 */
export function cli(app: App, target?: Command | Namespace): string {
  const { commands, namespaces } = walk(app);
  const children = (at: string[], list: Command[] = [], nested: Namespace[] = []) => [
    ...list.map((command): [string, string] => [line([...at, command.name], command), '']),
    ...nested.map((namespace): [string, string] => [
      `${[...at, namespace.name].join(' ')}: ${namespace.description}`,
      '',
    ]),
  ];

  if (!target) {
    const rows = children([], app.commands, app.namespaces);
    return [app.name, app.description, rows.length && `Commands:\n${table(rows)}`]
      .filter(Boolean)
      .join('\n\n');
  }

  if ('commands' in target) {
    const at = namespaces.find(entry => entry.namespace === target)?.path ?? [target.name];
    const rows = children(at, target.commands, target.namespaces);
    return [
      at.join(' '),
      target.description,
      text(target.usage),
      rows.length && `Commands:\n${table(rows)}`,
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  const at = commands.find(entry => entry.command === target)?.path ?? [target.name];
  const list = args(target);
  const { cli } = target;

  return [
    signature(at, target),
    target.description,
    text(target.usage),
    list.length && `Arguments:\n${table(list.map(arg => [arg.plain, arg.description]))}`,
    target.access === 'read' && 'Read-only.',
    cli?.exit?.length &&
      `Exit codes:\n${table(cli.exit.map(([code, meaning]) => [String(code), meaning]))}`,
    cli?.env?.length && `Environment:\n${table(cli.env)}`,
    cli?.examples?.length && `Examples:\n${cli.examples.map(example => `  ${example}`).join('\n')}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * An argv word `parse` rejects; `arg` names the offending argument.
 */
export class ParseError extends Error {
  arg: string;
  constructor(message: string, arg: string) {
    super(message);
    this.name = 'ParseError';
    this.arg = arg;
  }
}

type Def = {
  type: string;
  defaultValue?: unknown;
  innerType?: Shape[string];
  in?: Shape[string];
  options?: Shape[string][];
  values?: unknown[];
};

const defOf = (schema: Shape[string]) => schema._zod.def as Def;

// The schema under optional, default and pipe wrappers; a union with `true` is a flag that may carry a value.
function kind(schema: Shape[string]) {
  let def = defOf(schema);
  while (def.innerType ?? def.in) def = defOf((def.innerType ?? def.in)!);
  if (def.type === 'union' && def.options?.some(option => defOf(option).values?.includes(true)))
    return 'maybe';
  return def.type;
}

/**
 * Parses argv against a command: `cli.positional` names in order, every other arg a `--name` flag.
 * A last positional with an array schema takes every remaining word.
 * @param command - Command whose `args` schemas shape and validate the result.
 * @param argv - Words after the command path.
 * @returns Arguments typed from the command.
 * @throws ParseError on an unknown flag, missing value, extra or missing positional, or a schema failure.
 */
export function parse<S extends Shape>(command: Command<S>, argv: string[]): Args<S> {
  const shape: Shape = command.args ?? {};
  const names: string[] = command.cli?.positional ?? [];
  const raw: Record<string, unknown> = {};
  const words: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const word = argv[i]!;
    if (word === '--') {
      words.push(...argv.slice(i + 1));
      break;
    }
    if (!word.startsWith('-') || word === '-') {
      words.push(word);
      continue;
    }

    const dash = word.startsWith('--') ? '--' : '-';
    const body = word.slice(dash.length);
    const eq = body.indexOf('=');
    const name = eq < 0 ? body : body.slice(0, eq);
    const own = (key: string) => (Object.hasOwn(shape, key) ? shape[key] : undefined);
    // `--no-<flag>` sets a boolean flag false, unless an arg is named `no-<flag>` itself.
    const negated = name.slice(3);
    const flag = own(negated);
    if (
      dash === '--' &&
      eq < 0 &&
      name.startsWith('no-') &&
      !own(name) &&
      !names.includes(negated) &&
      flag &&
      kind(flag) === 'boolean'
    ) {
      raw[negated] = false;
      continue;
    }
    const schema = names.includes(name) ? undefined : own(name);
    if (!schema)
      throw new ParseError(
        `Unknown option ${dash}${name} (use -- to pass literal text starting with -)`,
        name,
      );

    const type = kind(schema);
    let value = eq < 0 ? undefined : body.slice(eq + 1);
    if (type === 'boolean') {
      if (value !== undefined && value !== 'true' && value !== 'false')
        throw new ParseError(
          `Invalid ${dash}${name} value ${JSON.stringify(value)}: expected true or false`,
          name,
        );
      raw[name] = value !== 'false';
      continue;
    }
    if (value === undefined) {
      const next = argv[i + 1];
      // `-` alone and negative numbers are values; any other dash word is an option.
      const option =
        next !== undefined && next.startsWith('-') && next !== '-' && !/^-\d/.test(next);
      if (type === 'maybe' && (next === undefined || option)) {
        raw[name] = true;
        continue;
      }
      if (next === undefined || option)
        throw new ParseError(`Missing value for ${dash}${name}`, name);
      value = next;
      i++;
    }
    raw[name] = type === 'array' ? [...((raw[name] as string[] | undefined) ?? []), value] : value;
  }

  const last = names.at(-1);
  const rest = last !== undefined && kind(shape[last]!) === 'array';
  if (!rest && words.length > names.length) {
    const extra = words.slice(names.length);
    throw new ParseError(
      `Unexpected argument${extra.length > 1 ? 's' : ''}: ${extra.join(' ')}`,
      extra[0]!,
    );
  }
  names.forEach((name, i) => {
    if (i >= words.length) return;
    raw[name] = rest && name === last ? words.slice(i) : words[i];
  });
  const missing = names.find((name, i) => i >= words.length && !shape[name]?._zod.optin);
  if (missing) throw new ParseError(`Missing ${missing}.`, missing);

  const out: Record<string, unknown> = {};
  for (const [name, schema] of Object.entries(shape)) {
    const label = names.includes(name) ? name : `--${name}`;
    const result = schema['~standard'].validate(raw[name]);
    if (result instanceof Promise) throw new ParseError(`${label} has an async schema`, name);
    if (result.issues)
      throw new ParseError(
        raw[name] === undefined
          ? `Missing required ${label}.`
          : `Invalid ${label} value ${JSON.stringify(raw[name])}: ${result.issues[0]?.message}`,
        name,
      );
    if (result.value !== undefined) out[name] = result.value;
  }

  return out as Args<S>;
}

/**
 * Walks argv words against command and namespace paths, longest match first, namespace aliases included.
 * @param app - App whose commands and namespaces are matched.
 * @param argv - Words from the command line.
 * @returns The command or namespace matched, its path and the words after it, or undefined.
 */
export function resolve(
  app: App,
  argv: string[],
):
  | { command: Command; path: string[]; rest: string[] }
  | { namespace: Namespace; path: string[]; rest: string[] }
  | undefined {
  const { commands, namespaces } = walk(app);
  let found: ReturnType<typeof resolve>;
  let length = 0;
  const offer = (
    words: string[],
    target: { command: Command; path: string[] } | { namespace: Namespace; path: string[] },
  ) => {
    if (words.length <= length || !words.every((word, i) => argv[i] === word)) return;
    length = words.length;
    found = { ...target, rest: argv.slice(words.length) };
  };

  for (const { path, command } of commands) offer(path, { command, path });
  for (const { path, namespace } of namespaces) {
    for (const [alias, name] of Object.entries(namespace.aliases ?? {}))
      for (const command of namespace.commands)
        if (command.name === name) offer([...path, alias], { command, path: [...path, name] });
    offer(path, { namespace, path });
  }

  return found;
}

/**
 * Runs argv against an app: help, routing, parsing, the command, and its printed result.
 * `--help` or `-h` before `--`, a bare app name or a bare namespace prints help.
 * @param app - App whose commands and namespaces are routed.
 * @param argv - Words after the binary name.
 * @param io - `out` and `err` writers, defaulting to stdout and stderr.
 * @returns The exit code: 0 on success or help, 1 on an unknown command, bad argv or a thrown error.
 */
export async function run(
  app: App,
  argv: string[],
  io: { out?: (text: string) => void; err?: (text: string) => void } = {},
): Promise<number> {
  const out = io.out ?? (text => void process.stdout.write(text));
  const err = io.err ?? (text => void process.stderr.write(text));
  const end = argv.indexOf('--');
  const help = (end < 0 ? argv : argv.slice(0, end)).some(w => w === '--help' || w === '-h');
  const found = resolve(app, argv);
  const word = found ? found.rest[0] : argv[0];
  const hint = (path: string[]) => `Help: ${[app.name, ...path].join(' ')} --help`;

  if (!found || 'namespace' in found) {
    const path = found ? found.path : [];
    if (word !== undefined && !(help && word.startsWith('-'))) {
      err(`Unknown command ${[...path, word].join(' ')}\n${hint(path)}\n`);
      return 1;
    }
    out(`${cli(app, found?.namespace)}\n`);
    return 0;
  }

  const { command, path, rest } = found;
  if (help) {
    out(`${cli(app, command)}\n`);
    return 0;
  }
  try {
    const result: unknown = await command.run(parse(command, rest), {});
    if (result !== undefined)
      out(`${typeof result === 'string' ? result : JSON.stringify(result, null, 2)}\n`);
    return 0;
  } catch (e) {
    err(`${(e as Error).message}${e instanceof ParseError ? `\n${hint(path)}` : ''}\n`);
    return 1;
  }
}

function commandDoc({ path, command }: Entry): string {
  const list = args(command);
  const { cli } = command;

  return [
    `## \`${signature(path, command)}\``,
    command.description,
    text(command.usage),
    list.length &&
      list
        .map(arg => `- \`${arg.plain}\`${arg.description ? ` ${arg.description}` : ''}`)
        .join('\n'),
    cli?.exit?.length &&
      `Exit codes:\n\n${cli.exit.map(([code, meaning]) => `- \`${code}\` ${meaning}`).join('\n')}`,
    cli?.env?.length &&
      `Environment:\n\n${cli.env.map(([name, meaning]) => `- \`${name}\` ${meaning}`).join('\n')}`,
    cli?.examples?.length && `\`\`\`sh\n${cli.examples.join('\n')}\n\`\`\``,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Markdown reference: a main page plus one page per top-level namespace, nested namespaces as sections. Written to `outDir` when given.
 * @param app - App whose commands and namespaces are documented.
 * @param opts - `outDir` to write the pages into; `index` names the main page, default `index.md`; `note: false` drops the generated marker.
 * @returns Page contents keyed by relative filename, or by written path with `outDir`.
 */
export function markdown(app: App, opts: Emit & { index?: string } = {}): Record<string, string> {
  const main = opts.index ?? 'index.md';
  const mark = marker(opts);
  const { commands, namespaces } = walk(app);
  const under = (path: string[]) =>
    commands.filter(
      entry =>
        entry.path.length === path.length + 1 && path.every((word, i) => entry.path[i] === word),
    );
  const page = (namespace: Namespace) => `${namespace.name}.md`;
  const pages: Record<string, string> = {
    [main]: [
      mark,
      `# ${app.name}${commands.length ? ' CLI' : ''}`,
      app.description,
      app.namespaces?.length &&
        app.namespaces
          .map(namespace => `- [${namespace.name}](${page(namespace)}): ${namespace.description}`)
          .join('\n'),
      ...under([]).map(commandDoc),
    ]
      .filter(Boolean)
      .join('\n\n')
      .concat('\n'),
  };

  const owners = new Map([[main, 'the index page']]);
  for (const namespace of app.namespaces ?? []) {
    const file = page(namespace);
    const prev = owners.get(file);
    if (prev)
      throw new Error(
        `contextjsx: ${prev} and namespace "${namespace.name}" both map to page ${file}`,
      );
    owners.set(file, `namespace "${namespace.name}"`);
    const sections = namespaces
      .filter(entry => entry.path[0] === namespace.name && entry.path.length > 1)
      .flatMap(({ path, namespace: nested }) => [
        `## ${path.join(' ')}`,
        nested.description,
        text(nested.usage),
        ...under(path).map(commandDoc),
      ]);
    pages[file] = [
      mark,
      `# ${namespace.name}`,
      namespace.description,
      text(namespace.usage),
      ...under([namespace.name]).map(commandDoc),
      ...sections,
    ]
      .filter(Boolean)
      .join('\n\n')
      .concat('\n');
  }

  return write(pages, opts.outDir);
}

type Read = ReturnType<typeof readSkill>;

// Agent Skills spec: name 1-64 of a-z, 0-9 and single inner hyphens; description 1-1024; compatibility 1-500.
function validate(skill: Read) {
  if (skill.name.length > 64 || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(skill.name))
    throw new Error(
      `contextjsx: skill name "${skill.name}" must be 1 to 64 lowercase letters, digits and single hyphens`,
    );
  if (!skill.description || skill.description.length > 1024)
    throw new Error(`contextjsx: skill "${skill.name}" description must be 1 to 1024 characters`);
  const { compatibility } = skill;
  if (compatibility !== undefined && (!compatibility || compatibility.length > 500))
    throw new Error(`contextjsx: skill "${skill.name}" compatibility must be 1 to 500 characters`);
}

function skillText(app: App, skill: Read, mark: string | false): string {
  const q = (value: string) => JSON.stringify(value);
  const frontmatter = [
    `name: ${skill.name}`,
    `description: ${q(skill.description)}`,
    skill.license !== undefined && `license: ${q(skill.license)}`,
    skill.compatibility !== undefined && `compatibility: ${q(skill.compatibility)}`,
    skill.metadata &&
      `metadata:${Object.entries(skill.metadata)
        .map(([key, value]) => `\n  ${q(key)}: ${q(value)}`)
        .join('')}`,
    skill.allowedTools !== undefined && `allowed-tools: ${q(skill.allowedTools)}`,
  ];

  return [`---\n${frontmatter.filter(Boolean).join('\n')}\n---`, mark, skill.text]
    .filter(Boolean)
    .join('\n\n')
    .concat('\n');
}

/**
 * One `SKILL.md` per skill in the app and its namespaces, following the Agent Skills rules. Written to `outDir/<name>/` when given.
 * `file` skills are copied with their frontmatter cut and regenerated.
 * @param app - App whose skills are validated and emitted.
 * @param opts - `outDir` to write the skill folders into; `note: false` drops the generated marker.
 * @returns Contents keyed by `<name>/SKILL.md`, or by written path with `outDir`.
 * @throws When two skills share a name.
 */
export function skills(app: App, opts: Emit = {}): Record<string, string> {
  const files: Record<string, string> = {};

  for (const skill of walk(app).skills.map(readSkill)) {
    validate(skill);
    const file = `${skill.name}/SKILL.md`;
    if (files[file] !== undefined)
      throw new Error(`contextjsx: two skills are named "${skill.name}"`);
    files[file] = skillText(app, skill, marker(opts));
  }

  return write(files, opts.outDir);
}

/** Where emitted files go, omit to get the contents only; `note: false` drops the generated marker. */
export type Emit = { outDir?: string; note?: boolean };

const marker = (opts: Emit) =>
  opts.note !== false &&
  `<!-- Generated by contextjsx from definitions. Edit the source, not this file. -->`;

function write(files: Record<string, string>, outDir: string | undefined) {
  if (!outDir) return files;
  const out: Record<string, string> = {};
  for (const [file, content] of Object.entries(files)) {
    const full = path.join(outDir, file);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
    out[full] = content;
  }

  return out;
}
