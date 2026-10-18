import type * as z from 'zod';
import type { Node } from './jsx-runtime';

export type Access = 'read' | 'write';

export type Shape = { [name: string]: z.core.$ZodType };

export type Args<S extends Shape> = z.output<z.ZodObject<S>>;

export interface Next {
  usage: string;
  blurb: string;
}

export interface Context {
  signal?: AbortSignal;
}

export interface Command<S extends Shape = Shape, R = unknown> {
  /** Its own word; the path comes from the namespaces it sits in. */
  name: string;
  description: string;
  args?: S;
  usage?: Node;
  access: Access;
  next?(input: { result: R; args: Args<S> }): Next[];
  run(args: Args<S>, ctx: Context): R | Promise<R>;
  cli?: {
    positional?: Array<keyof S & string>;
    exit?: Array<[code: number, meaning: string]>;
    env?: Array<[name: string, meaning: string]>;
    examples?: string[];
  };
  /** `false` keeps the command off MCP; help and docs still list it. */
  mcp?: false | { description?: string; text?(result: R): string };
}

export interface Namespace {
  name: string;
  description: string;
  commands: Command[];
  namespaces?: Namespace[];
  skills?: Skill[];
  usage?: Node;
  /** Alias to command name, such as `{ ls: 'list' }`. */
  aliases?: Record<string, string>;
}

export type Skill = {
  license?: string;
  /** 1 to 500 characters. */
  compatibility?: string;
  metadata?: Record<string, string>;
  /** Space-separated pre-approved tools, written as `allowed-tools`. */
  allowedTools?: string;
} & (
  | { name: string; description: string; body?: Node; file?: never }
  | {
      /** Markdown whose frontmatter fills a missing `name` and `description`. */
      file: string | URL;
      name?: string;
      description?: string;
      body?: never;
    }
);

export interface Resource {
  uri: string;
  name?: string;
  description: string;
  mimeType?: string;
  read(): string | Promise<string>;
}

export interface App {
  name: string;
  description: string;
  instructions?: Node;
  namespaces?: Namespace[];
  commands?: Command[];
  skills?: Skill[];
  resources?: Resource[];
}

export function defineCommand<S extends Shape, R>(command: Command<S, R>): Command<S, R> {
  return command;
}

export function defineNamespace<N extends Namespace>(namespace: N): N {
  return namespace;
}

export function defineApp<A extends App>(app: A): A {
  return app;
}

export function defineSkill<S extends Skill>(skill: S): S {
  return skill;
}

export function defineResource<R extends Resource>(resource: R): R {
  return resource;
}
