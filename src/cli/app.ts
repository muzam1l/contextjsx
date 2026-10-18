import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as z from 'zod';
import { defineApp, defineCommand, type App } from 'contextjsx';
import { markdown, ParseError, skills } from 'contextjsx/emit';
import { serve } from 'contextjsx/serve';

async function importApp(file: string): Promise<App> {
  let mod: { default?: App };
  try {
    mod = (await import(pathToFileURL(path.resolve(file)).href)) as { default?: App };
  } catch (e) {
    if ((e as { code?: unknown }).code === 'ERR_UNKNOWN_FILE_EXTENSION')
      throw new Error(
        `Cannot import ${file}: Node ${process.version} has no loader for ${path.extname(file)}. Run with bun, or build it to .js.`,
      );
    throw e;
  }
  const app = mod.default;
  if (typeof app?.name !== 'string' || typeof app.description !== 'string')
    throw new Error(`${file} has no default export from defineApp.`);
  return app;
}

const serveApp = defineCommand({
  name: 'serve',
  description: 'Serve a definition file as an MCP server',
  args: {
    file: z.string().describe('module whose default export is a defineApp'),
    http: z.boolean().default(false).describe('serve on loopback HTTP instead of stdio'),
    port: z.coerce.number().int().min(0).max(65535).optional().describe('port, default any free'),
  },
  usage:
    'With --http, prints the URL and token as JSON; send `Authorization: Bearer <token>` to the URL.',
  access: 'write',
  cli: {
    positional: ['file'],
    examples: ['contextjsx serve ./app.ts', 'contextjsx serve ./dist/app.js --http'],
  },
  run: async args => {
    const app = await importApp(args.file);
    if (args.http) {
      const { url, token } = await serve(app, {
        http: args.port === undefined ? {} : { port: args.port },
      });
      return { url, token };
    }
    const { done, close } = await serve(app, 'stdio');
    await done;
    await close();
  },
});

const emit = defineCommand({
  name: 'emit',
  description: 'Write Markdown docs and SKILL.md files from a definition file',
  args: {
    file: z.string().describe('module whose default export is a defineApp'),
    out: z
      .string()
      .optional()
      .describe('writes `<out>/docs` and `<out>/skills`; without it, lists'),
    markdown: z.boolean().default(false).describe('write Markdown docs'),
    skills: z.boolean().default(false).describe('write SKILL.md files'),
    all: z.boolean().default(false).describe('write both'),
    index: z.string().optional().describe('main docs page, default index.md'),
    note: z.boolean().default(true).describe('generated marker, on by default'),
  },
  access: 'write',
  cli: {
    positional: ['file'],
    examples: [
      'contextjsx emit ./app.ts --all',
      'contextjsx emit ./app.ts --out . --all --index cli.md',
      'contextjsx emit ./app.ts --out . --skills --no-note',
    ],
  },
  run: async args => {
    const docs = args.all || args.markdown;
    const skillFiles = args.all || args.skills;
    if (!docs && !skillFiles) throw new ParseError('Choose --markdown, --skills or --all.', 'all');
    const app = await importApp(args.file);
    const { out } = args;
    const opts = (dir: string) => ({
      ...(out ? { outDir: path.join(out, dir) } : {}),
      ...(args.note ? {} : { note: false }),
    });
    const listed = (dir: string, files: Record<string, string>) =>
      Object.keys(files).map(file => (out ? file : path.join(dir, file)));
    const index = args.index === undefined ? {} : { index: args.index };

    return [
      ...(docs ? listed('docs', markdown(app, { ...opts('docs'), ...index })) : []),
      ...(skillFiles ? listed('skills', skills(app, opts('skills'))) : []),
    ].join('\n');
  },
});

/** contextjsx's own CLI, defined with contextjsx. */
export const app = defineApp({
  name: 'contextjsx',
  description: 'Serve a definition file as an MCP server, or write its docs and skills',
  commands: [serveApp, emit],
});

export default app;
