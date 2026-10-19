# contextjsx rules

Binding for every change. CLAUDE.md links here.

## What it is

One small library, two halves. Knows no product, engine or server.

Dev side: JSX prompts (`contextjsx`, `contextjsx/jsx-runtime`), typed definitions (`defineApp`, `defineNamespace`, `defineCommand` and friends on the root), projections to index, help, docs and skills (`contextjsx/emit`).

Model side: `contextjsx/serve` exposes an app as one MCP server: its commands as tools, its skills through `load_skill`, its instructions plus the namespace index.

## Design

- Trust boundary in prompts: `Data` escapes, everything else renders as written.
- One root, `defineApp`. The CLI app holds name, description, namespaces and commands; a model-facing app spreads it and adds `instructions` and `skills`.
- A command declares only its own word; its path comes from the namespaces it sits in. One walk of the app (`walk`) gives every consumer the path.
- Tool name is the path joined with `/`. Names that collide after mapping to `[A-Za-z0-9_-]` throw at start; skill names are unique.
- `serve` sends `instructions(app)`: the app's instructions, a blank line, then per namespace its description, tool names and skill names. No cap, never truncated.
- Skills over MCP through `load_skill(name)` only, inline JSX or a markdown `file`. No resources for skills.
- `serve` is a direct handler map: list, validate, run with `{ signal }`, text plus `next` hints; a returned MCP call-tool result passes as is. Invalid arguments return the issues and the schema. Large results are the client's concern.
- No registries, plugins, classes or single-implementation abstractions. Error classes may extend Error.

## Code

- TypeScript, ESM, strict, Node 20 output. Bun for dev only; no `Bun.*` in `src/`.
- Zero runtime dependencies in root (render, define, jsx runtime) and `emit`. `serve` imports zod only; its MCP server is our own (`src/serve/protocol.ts`).
- Layout: one folder per subpath with `index.ts`; top of `src/` holds only minimal core. tsdown entries are the single source of exports; package.json exports are generated.
- Infer types from literals. Three plain lines beat one clever helper. Inline what is used once. Comments one line, only where code cannot say it. Blank line between related blocks.
- Files up to 5000 lines, grouped by concern.
- Verify library APIs or docs. Never from memory.

## Tests and speed

- `bun test`, one file per module under `test/`, one test per rule, named in plain words. Fixtures under `test/fixtures/`.
- End to end over real libraries: the official MCP client against our server over stdio and HTTP, real zod, real `dist/` for exports. No mocks of shipped libraries.
- Exported functions that do work assert a time bound in their test, 10x local.
- Whole suite under 5 s. No work at import time.
- `bun run gate` (check, build, test, bench) green before any report. Report numbers.

## Process

- `.tmp/` is scratch, gitignored: design history, bench results, migration notes. Not library docs.
- No git write commands. No publish/push without asking first.
