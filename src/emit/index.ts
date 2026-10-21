import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { render } from '../index';
import type { App, Args, Command, Namespace, Shape, Skill } from '../index';

/** `id` is the path joined with `/`. */
export type Entry = { path: string[]; id: string; command: Command };

/** Definition order: root commands, then each namespace before its commands and nested namespaces. */
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

/** A `file` skill is read without its frontmatter, which fills a missing `name` and `description`. */
export function readSkill(
  skill: Skill,
): Skill & { name: string; description: string; text: string } {
  if (skill.file === undefined) return { ...skill, text: render(skill.body) };

  const raw = readFileSync(skill.file, 'utf8');
  const front = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/.exec(raw);
  // `key: value` lines, plain or quoted, and `|` / `>` blocks of the indented lines below; nothing else of YAML.
  const fields: Record<string, string> = {};
  const lines = (front?.[1] ?? '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const [, key, value = ''] = /^([\w-]+):\s*(.*?)\s*$/.exec(lines[i]!) ?? [];
    if (!key) continue;
    const block = /^[|>][+-]?$/.test(value);
    const body: string[] = [];
    while (block && /^(\s|$)/.test(lines[i + 1] ?? 'end')) body.push(lines[++i]!.trim());
    if (block) {
      const text = body.join('\n');
      fields[key] = (
        value[0] === '|'
          ? text
          : text.replace(/([^\n])\n(?=[^\n])/g, '$1 ').replace(/\n(\n+)/g, '$1')
      ).trim();
    } else if (/^".*"$/.test(value)) fields[key] = JSON.parse(value) as string;
    else fields[key] = /^'.*'$/.test(value) ? value.slice(1, -1).replaceAll("''", "'") : value;
  }
  const name = skill.name ?? fields.name;
  const description = skill.description ?? fields.description;
  if (!name || !description)
    throw new Error(`contextjsx: skill file ${String(skill.file)} needs a name and a description`);

  return { ...skill, name, description, text: raw.slice(front?.[0].length ?? 0).trim() };
}

function args(command: Command) {
  // Classic `.describe()` and mini `z.describe()` both write zod's global registry.
  const registry = (
    globalThis as {
      __zod_globalRegistry?: { get(schema: object): { description?: string } | undefined };
    }
  ).__zod_globalRegistry;
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
      description: registry?.get(schema)?.description ?? '',
    };
  });
}

const signature = (path: string[], command: Command) =>
  [...path, ...args(command).map(arg => arg.token)].join(' ');

const table = (rows: Array<[string, string]>) => {
  const width = Math.max(...rows.map(([left]) => left.length));
  return rows
    .map(([left, right]) => (right ? `  ${left.padEnd(width)}  ${right}` : `  ${left}`))
    .join('\n');
};

/** The app's instructions, a blank line, then per namespace its description, tool names and skill names; `mcp: false` commands left out. The app's own description is `serverInfo.description`, not repeated here. */
export function instructions(app: App): string {
  const block = (pad: string, commands: Command[] = [], skills: Skill[] = []) => {
    const tools = commands.filter(command => command.mcp !== false).map(command => command.name);
    return [
      tools.length && `${pad}tools: ${tools.join(' ')}`,
      skills.length &&
        `${pad}skills: ${skills.map(skill => skill.name ?? readSkill(skill).name).join(' ')}`,
    ];
  };

  const index = [
    `${app.name}:`,
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

  return [render(app.instructions), index].filter(Boolean).join('\n\n');
}

/** Plain-text help for the app, or for a command or namespace in it. */
export function cli(app: App, target?: Command | Namespace): string {
  const { commands, namespaces } = walk(app);

  if (!target || 'commands' in target) {
    const at = target
      ? (namespaces.find(entry => entry.namespace === target)?.path ?? [target.name])
      : [];
    const { description, commands: list = [], namespaces: nested = [] } = target ?? app;
    const rows = [
      ...list.map((command): [string, string] => [
        `${signature([...at, command.name], command)}: ${command.description}`,
        '',
      ]),
      ...nested.map((namespace): [string, string] => [
        `${[...at, namespace.name].join(' ')}: ${namespace.description}`,
        '',
      ]),
    ];
    return [
      at.join(' ') || app.name,
      description,
      render(target?.usage),
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
    render(target.usage),
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

/** `cli.positional` names in order, every other arg a `--name` flag; a last array positional takes the rest. */
export function parse<S extends Shape>(command: Command<S>, argv: string[]): Args<S> {
  const shape: Shape = command.args ?? {};
  const names: string[] = command.cli?.positional ?? [];
  const raw: Record<string, unknown> = {};
  const words: string[] = [];
  const own = (key: string) => (Object.hasOwn(shape, key) ? shape[key] : undefined);

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

/** Longest command or namespace path that prefixes argv, namespace aliases included. */
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

/** `--help` or `-h` before `--`, a bare app or a bare namespace prints help; resolves to exit code 0 or 1. */
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
    render(command.usage),
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

/** A main page, default `index.md`, plus one page per top-level namespace with nested namespaces as sections. */
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
        render(nested.usage),
        ...under(path).map(commandDoc),
      ]);
    pages[file] = [
      mark,
      `# ${namespace.name}`,
      namespace.description,
      render(namespace.usage),
      ...under([namespace.name]).map(commandDoc),
      ...sections,
    ]
      .filter(Boolean)
      .join('\n\n')
      .concat('\n');
  }

  return write(pages, opts.outDir);
}

/** One `<name>/SKILL.md` per skill, validated against the Agent Skills spec; `file` frontmatter is regenerated. */
export function skills(app: App, opts: Emit = {}): Record<string, string> {
  const files: Record<string, string> = {};
  const q = (value: string) => JSON.stringify(value);

  for (const skill of walk(app).skills.map(readSkill)) {
    const { name, description, compatibility } = skill;
    if (name.length > 64 || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name))
      throw new Error(
        `contextjsx: skill name "${name}" must be 1 to 64 lowercase letters, digits and single hyphens`,
      );
    if (!description || description.length > 1024)
      throw new Error(`contextjsx: skill "${name}" description must be 1 to 1024 characters`);
    if (compatibility !== undefined && (!compatibility || compatibility.length > 500))
      throw new Error(`contextjsx: skill "${name}" compatibility must be 1 to 500 characters`);
    const file = `${name}/SKILL.md`;
    if (files[file] !== undefined) throw new Error(`contextjsx: two skills are named "${name}"`);

    const frontmatter = [
      `name: ${name}`,
      `description: ${q(description)}`,
      skill.license !== undefined && `license: ${q(skill.license)}`,
      compatibility !== undefined && `compatibility: ${q(compatibility)}`,
      skill.metadata &&
        `metadata:${Object.entries(skill.metadata)
          .map(([key, value]) => `\n  ${q(key)}: ${q(value)}`)
          .join('')}`,
      skill.allowedTools !== undefined && `allowed-tools: ${q(skill.allowedTools)}`,
    ];
    files[file] = [`---\n${frontmatter.filter(Boolean).join('\n')}\n---`, marker(opts), skill.text]
      .filter(Boolean)
      .join('\n\n')
      .concat('\n');
  }

  return write(files, opts.outDir);
}

/** Without `outDir`, returns contents only; `note: false` drops the generated marker. */
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
