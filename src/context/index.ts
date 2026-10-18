import { defineApp, defineSkill } from 'contextjsx';
import { app as cli } from '../cli/app';

export const app = defineApp({
  ...cli,
  instructions:
    'contextjsx defines prompts, commands and skills once in TypeScript and projects them to CLI help, docs, SKILL.md files and an MCP server. Load the contextjsx skill before writing code against it.',
  skills: [
    defineSkill({
      file: new URL('./contextjsx.md', import.meta.url),
      license: 'MIT',
    }),
  ],
});

export default app;
