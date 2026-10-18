<div align="center">

# contextjsx

**A tiny library for typed agent context, defined once, served everywhere.**

</div>

Composable JSX for prompts; type-safe commands, namespaces and skills. One definition, used in code or exported to CLI help, docs, SKILL.md and MCP.

## Install

```sh
bun add contextjsx    # or npm i contextjsx
```

Includes the `contextjsx` command line; `contextjsx --help` lists it.

## Parts

- **[Core](#core).** Prompts composed like UI in JSX, commands, namespaces and skills typed in code. _0.4 kB_
- **[Emit](#emit).** MCP instructions, CLI help, argv parsing, Markdown docs and skill files. _4.4 kB_
- **[Serve](#serve).** Your commands and skills as an MCP server. _3.5 kB_

## Core

### Prompts

Compose prompts from components, like UI.

```tsx
import { render, Data } from 'contextjsx';

const Access = ({ mode }: { mode: 'read' | 'write' }) => (
  <access>{mode === 'write' ? 'You may edit and push.' : 'Read only.'}</access>
);

export const system = render(
  <system>
    <Access mode={access} />
    <event source="slack">
      <Data>{message}</Data>
    </event>
  </system>,
);
```

Plain JSX, no React. Any tag name works. Built-in elements:

- `Data` escapes text from users or tools, so it can never break your prompt.
- `Pre` keeps whitespace and newlines as written.

Setup, two lines in tsconfig:

```json
{ "jsx": "react-jsx", "jsxImportSource": "contextjsx" }
```

Or per file, next to another JSX runtime:

```tsx
/** @jsxImportSource contextjsx */
```

### Define

Describe what your product can do, once.

```tsx
import * as z from 'zod';
import { defineApp, defineCommand, defineSkill } from 'contextjsx';

// `run` in the CLI, `run` as a tool.
const run = defineCommand({
  name: 'run',
  description: 'Dispatch a task',
  // The schema of the command's arguments and the tool's input.
  args: { prompt: z.string().describe('what to do') },
  // `read` becomes readOnlyHint.
  access: 'write',
  run: async ({ prompt }) => start(prompt),
});

const review = defineSkill({
  name: 'review',
  description: 'Review a change before merging',
  body: <>Read the diff, run the tests, list what would break.</>,
});

// One root: commands for the CLI, instructions and skills for models.
export const app = defineApp({
  name: 'app',
  description: 'Delegate coding tasks',
  commands: [run],
  skills: [review],
  instructions: 'Start work with run, then read results.',
});
```

`defineNamespace` groups commands and skills under a word (`task run`, tool `task/run`) and nests. A skill can also be a markdown file: `defineSkill({ file })`, its frontmatter giving name and description. `mcp: false` keeps a command off MCP.

## Emit

Generate the text your users and agents read, from that definition.

```sh
contextjsx emit ./app.ts --all --out .
```

Or in code:

```ts
import { instructions, cli, parse, markdown, skills } from 'contextjsx/emit';

// What your MCP server tells the model: your text, then its tools and skills.
const text = instructions(app);

// Help text for `run --help`.
const help = cli(app, run);

// Typed args from argv; throws ParseError naming the bad arg.
const { prompt } = parse(run, ['--prompt', 'fix the build']);

// index.md plus a page per namespace.
markdown(app, { outDir: './docs' });

// One SKILL.md per skill.
skills(app, { outDir: './skills' });
```

Without `outDir`, `markdown` and `skills` return the files as strings instead of writing them.

One call can be your whole CLI: help, parsing, the command, its output. The `contextjsx` bin is this line; its reference is [docs/cli.md](docs/cli.md).

```ts
process.exitCode = await run(app, process.argv.slice(2));
```

## Serve

Expose your commands and skills to other people's agents over MCP.

```sh
contextjsx serve ./app.ts
```

Or in code:

```ts
import { serve } from 'contextjsx/serve';

// The agent spawns you.
await serve(app, 'stdio');

// Or the agent connects to you.
const { url, token } = await serve(app, { http: {} });
```

Each command becomes a tool, `run` or `task/run`; your instructions and skills come along, loaded by the agent when it needs them.

## Develop

One command runs everything.

```sh
bun run gate    # build, tsc, lint, tests, benchmark
```

<p align="center">Licensed under MIT with ❤️</p>
