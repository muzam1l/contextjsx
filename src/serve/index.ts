import { randomUUID } from 'node:crypto';
import * as z from 'zod';
import type { App, Skill } from '../index';
import { cli, instructions, readSkill, walk, type Entry } from '../emit/index';
import { httpHandler, serveStdio, type McpTool, type Params, type Server } from './protocol';

export type Transport = 'stdio' | { http: { port?: number } };

const text = (value: string) => ({ type: 'text' as const, text: value });
const failed = (value: string) => ({ content: [text(value)], isError: true });

// Claude Code maps every character outside this set to `_` in tool names.
const mapped = (name: string) => name.replace(/[^A-Za-z0-9_-]/g, '_');

function server(app: App): Server {
  const { commands, skills } = walk(app);
  const tools = new Map<string, Entry>();
  for (const entry of commands) {
    if (entry.command.mcp === false) continue;
    if (tools.has(entry.id))
      throw new Error(`contextjsx: two commands have the tool id "${entry.id}"`);
    tools.set(entry.id, entry);
  }

  const skillsByName = new Map<string, Skill>();
  for (const skill of skills) {
    const { name } = readSkill(skill);
    if (skillsByName.has(name)) throw new Error(`contextjsx: two skills are named "${name}"`);
    skillsByName.set(name, skill);
  }

  const seen = new Map<string, string>();
  for (const id of [...tools.keys(), ...(skillsByName.size ? ['load_skill'] : [])]) {
    const prev = seen.get(mapped(id));
    if (prev !== undefined)
      throw new Error(`contextjsx: tools "${prev}" and "${id}" both map to ${mapped(id)}`);
    seen.set(mapped(id), id);
  }

  // Required fields of the MCP SDK CallToolResultSchema; a match is served as is.
  const toolResult = z.object({
    content: z.array(
      z.union([
        z.object({ type: z.literal('text'), text: z.string() }),
        z.object({ type: z.enum(['image', 'audio']), data: z.string(), mimeType: z.string() }),
        z.object({ type: z.literal('resource_link'), uri: z.string(), name: z.string() }),
        z.object({
          type: z.literal('resource'),
          resource: z.union([
            z.object({ uri: z.string(), text: z.string() }),
            z.object({ uri: z.string(), blob: z.string() }),
          ]),
        }),
      ]),
    ),
    isError: z.boolean().optional(),
  });

  const schemas = new Map<string, Params>();
  const schema = ({ id, command }: Entry) => {
    let json = schemas.get(id);
    if (!json)
      schemas.set(id, (json = z.toJSONSchema(z.object(command.args ?? {}), { io: 'input' })));
    return json;
  };

  const resources = [
    ...(app.resources ?? []).map(resource => ({
      uri: resource.uri,
      name: resource.name ?? resource.uri,
      description: resource.description,
      mimeType: resource.mimeType,
      read: () => resource.read(),
    })),
    ...[...tools.values()].map(({ id, path, command }) => ({
      uri: `${app.name}://help/${id}`,
      name: `help ${path.join(' ')}`,
      description: command.description,
      mimeType: 'text/plain',
      read: () => cli(app, command),
    })),
  ];

  return {
    info: {
      name: app.name,
      ...(app.title ? { title: app.title } : {}),
      version: app.version ?? '0',
      description: app.description,
      ...(app.websiteUrl ? { websiteUrl: app.websiteUrl } : {}),
      ...(app.icons?.length ? { icons: app.icons } : {}),
    },
    instructions: instructions(app),
    capabilities: resources.length ? { tools: {}, resources: {} } : { tools: {} },
    handlers: {
      'tools/list': () => ({
        tools: [
          ...[...tools.values()].map((entry): McpTool => ({
            name: entry.id,
            description: (entry.command.mcp || undefined)?.description ?? entry.command.description,
            inputSchema: schema(entry),
            annotations: { readOnlyHint: entry.command.access === 'read' },
          })),
          ...(skillsByName.size
            ? [
                {
                  name: 'load_skill',
                  description:
                    'Load a skill named in the server instructions; returns its full text',
                  inputSchema: {
                    type: 'object',
                    properties: { name: { type: 'string', description: 'skill name' } },
                    required: ['name'],
                  },
                  annotations: { readOnlyHint: true },
                },
              ]
            : []),
        ],
      }),

      'tools/call': async (params, signal) => {
        const name = params.name as string;
        const args = (params.arguments ?? {}) as Params;

        if (name === 'load_skill' && skillsByName.size) {
          const skill = skillsByName.get(args.name as string);
          if (!skill)
            return failed(
              [
                `Unknown skill ${JSON.stringify(args.name)}. Skills:`,
                ...[...skillsByName].map(
                  ([each, entry]) => `- ${JSON.stringify(each)}: ${readSkill(entry).description}`,
                ),
              ].join('\n'),
            );
          return { content: [text(readSkill(skill).text)] };
        }

        const entry = tools.get(name);
        if (!entry) throw Object.assign(new Error(`Unknown tool ${name}`), { code: -32602 });
        const { command } = entry;
        const parsed = z.object(command.args ?? {}).safeParse(args);
        if (!parsed.success)
          return failed(
            `Invalid arguments for ${name}:\n${z.prettifyError(parsed.error)}\n\nSchema: ${JSON.stringify(schema(entry))}`,
          );

        try {
          const result = await command.run(parsed.data, { signal });
          if (!(command.mcp || undefined)?.text && toolResult.safeParse(result).success)
            return result;
          const body =
            command.mcp && command.mcp.text
              ? command.mcp.text(result)
              : typeof result === 'string'
                ? result
                : (JSON.stringify(result) ?? '');
          const next = command
            .next?.({ result, args: parsed.data })
            .map(hint => `${hint.usage}  # ${hint.blurb}`);
          return { content: [text(body), ...(next?.length ? [text(next.join('\n'))] : [])] };
        } catch (e) {
          return failed(String((e as Error)?.message ?? e));
        }
      },

      'resources/list': () => ({
        resources: resources.map(({ uri, name, description, mimeType }) => ({
          uri,
          name,
          description,
          ...(mimeType ? { mimeType } : {}),
        })),
      }),
      'resources/read': async params => {
        const resource = resources.find(r => r.uri === params.uri);
        if (!resource)
          throw Object.assign(new Error(`Unknown resource ${params.uri as string}`), {
            code: -32002,
          });
        return {
          contents: [
            {
              uri: resource.uri,
              ...(resource.mimeType ? { mimeType: resource.mimeType } : {}),
              text: await resource.read(),
            },
          ],
        };
      },
    },
  };
}

/** One tool per command, its path joined with `/`; throws when tool names collide after mapping to `[A-Za-z0-9_-]`. */
export async function serve(
  app: App,
  transport: Transport,
): Promise<{ url?: string; token?: string; done?: Promise<void>; close: () => Promise<void> }> {
  const mcp = server(app);
  if (transport === 'stdio') return serveStdio(mcp);

  const host = '127.0.0.1';
  const token = randomUUID();
  const handle = httpHandler(mcp);
  const { createServer } = await import('node:http');
  const http = createServer((req, res) => {
    if (req.headers.authorization !== `Bearer ${token}`) {
      res.statusCode = 401;
      return res.end();
    }
    if ((req.url ?? '/').split('?')[0] !== `/${app.name}`) {
      res.statusCode = 404;
      return res.end();
    }
    handle(req, res);
  });
  await new Promise<void>((resolve, reject) => {
    http.once('error', reject);
    http.listen(transport.http.port ?? 0, host, () => {
      http.off('error', reject);
      resolve();
    });
  });
  const address = http.address() as { port: number };

  return {
    url: `http://${host}:${address.port}/${app.name}`,
    token,
    close: () =>
      new Promise(resolve => {
        http.closeAllConnections();
        http.close(() => resolve());
      }),
  };
}
