import * as z from 'zod';
import { defineApp, defineCommand, defineNamespace, defineResource, defineSkill } from 'contextjsx';

export const taskRun = defineCommand({
  name: 'run',
  description: 'Dispatch a task to an engine',
  args: {
    prompt: z.string().describe('what to do'),
    engine: z.string().optional().describe('engine name'),
    wait: z.boolean().default(false),
  },
  usage: <>Prints the task id; add --wait to block until it finishes.</>,
  access: 'write',
  run: async args => ({
    id: `t-${args.prompt.length}`,
    engine: args.engine ?? 'codex',
    wait: args.wait,
  }),
  next: ({ result }) => [
    { usage: `app task result ${result.id} --wait`, blurb: 'wait for the result' },
  ],
  cli: {
    positional: ['prompt'],
    exit: [
      [0, 'done'],
      [2, 'engine failed'],
    ],
    examples: ['app task run "fix the build"'],
  },
  mcp: { text: result => `started ${result.id} on ${result.engine}` },
});

export const taskList = defineCommand({
  name: 'list',
  description: 'List recent tasks',
  args: { limit: z.number().optional() },
  access: 'read',
  run: args => Array.from({ length: args.limit ?? 2 }, (_, i) => ({ id: `t-${i}` })),
});

export const status = defineCommand({
  name: 'status',
  description: 'Show the daemon status',
  access: 'read',
  run: () => 'ok',
});

/** Nested two deep: `agent integrations list`, tool `agent/integrations/list`. */
export const integrationsList = defineCommand({
  name: 'list',
  description: 'List integrations of an agent',
  args: { agent: z.string() },
  access: 'read',
  cli: { positional: ['agent'] },
  run: args => `slack, linear for ${args.agent}`,
});

export const login = defineCommand({
  name: 'login',
  description: 'Log in on this machine',
  access: 'write',
  run: () => 'logged in',
  mcp: false,
});

export const filed = defineSkill({
  file: new URL('./guide.md', import.meta.url),
});

export const app = defineApp({
  name: 'app',
  description: 'Runs coding tasks on engines',
  instructions: (
    <instructions>Dispatch work with task/run, then read results with task/list.</instructions>
  ),
  commands: [status, login],
  namespaces: [
    defineNamespace({
      name: 'task',
      description: 'Run and inspect tasks',
      usage: <>Tasks run in the background.</>,
      commands: [taskRun, taskList],
    }),
    defineNamespace({
      name: 'agent',
      description: 'Configure agents',
      commands: [],
      namespaces: [
        defineNamespace({
          name: 'integrations',
          description: 'Agent integrations',
          commands: [integrationsList],
          skills: [filed],
        }),
      ],
    }),
  ],
  skills: [
    defineSkill({
      name: 'app-tasks',
      description:
        'Run coding tasks through app. Use when the user asks to dispatch or inspect a task.',
      license: 'MIT',
      compatibility: 'Needs the app binary on PATH.',
      metadata: { version: '1.0' },
      allowedTools: 'Bash(app:*) Read',
      body: `## When to use

The user asks to run, list or wait for a task.

## Rules

Never retry a write after a timeout.`,
    }),
  ],
  resources: [
    defineResource({
      uri: 'app://engines',
      description: 'Available engines',
      read: () => 'codex\nclaude',
    }),
  ],
});

export default app;

/** An app with 40 commands in 8 namespaces. */
export const large = defineApp({
  name: 'large',
  description: 'Forty commands',
  namespaces: Array.from({ length: 8 }, (_, g) =>
    defineNamespace({
      name: `group${g}`,
      description: `Group ${g}`,
      commands: Array.from({ length: 5 }, (_, c) =>
        defineCommand({
          name: `command${c}`,
          description: `Command ${c} of group ${g}`,
          args: { id: z.string(), verbose: z.boolean().optional() },
          access: c % 2 ? 'write' : 'read',
          cli: { positional: ['id'] },
          run: args => args.id,
        }),
      ),
    }),
  ),
});

/** Every argv form `parse` reads: two positionals, value, boolean, repeated and true-or-string flags. */
export const dispatch = defineCommand({
  name: 'dispatch',
  description: 'Dispatch a prompt',
  args: {
    prompt: z.string(),
    target: z.string().optional(),
    engine: z.string().optional(),
    wait: z.boolean().default(false),
    'add-dir': z.array(z.string()).optional(),
    server: z.union([z.string(), z.literal(true)]).optional(),
    limit: z.coerce.number().int().positive().optional(),
  },
  access: 'write',
  cli: { positional: ['prompt', 'target'] },
  run: args => args,
});

/** A command with 20 string flags. */
export const wide = defineCommand({
  name: 'wide',
  description: 'Twenty flags',
  args: Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`flag${i}`, z.string()])),
  access: 'read',
  run: args => args,
});

/** A last positional with an array schema takes the remaining words. */
export const flowRun = defineCommand({
  name: 'run',
  description: 'Run a flow with key=value inputs',
  args: { flow: z.string(), inputs: z.array(z.string()).optional(), wait: z.boolean().optional() },
  access: 'write',
  cli: { positional: ['flow', 'inputs'] },
  run: args => args,
});
