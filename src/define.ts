import type * as z from 'zod';
import type { Node } from './jsx-runtime';

/**
 * Declares whether a command reads or writes.
 */
export type Access = 'read' | 'write';

/**
 * Named Zod schemas defining command arguments, classic or `zod/mini`.
 */
export type Shape = { [name: string]: z.core.$ZodType };

/**
 * Infers parsed command arguments from a Zod shape.
 */
export type Args<S extends Shape> = z.output<z.ZodObject<S>>;

/**
 * A suggested follow-up command usage and its explanation.
 */
export interface Next {
  usage: string;
  blurb: string;
}

/**
 * Execution context carrying an optional cancellation signal.
 */
export interface Context {
  signal?: AbortSignal;
}

/**
 * A command definition shared by execution, help and MCP projections.
 */
export interface Command<S extends Shape = Shape, R = unknown> {
  /** Its own word, such as `run`; the full path comes from the namespaces it sits in. */
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
  /** `false` keeps the command off MCP; help and index still list it. */
  mcp?: false | { description?: string; text?(result: R): string };
}

/**
 * A named set of commands, skills and nested namespaces.
 */
export interface Namespace {
  name: string;
  description: string;
  commands: Command[];
  namespaces?: Namespace[];
  skills?: Skill[];
  usage?: Node;
  /** Alternate words for a command's name in this namespace, such as `{ ls: 'list' }`. */
  aliases?: Record<string, string>;
}

/**
 * An Agent Skills `SKILL.md`: spec frontmatter, then the body, inline or from a markdown file.
 */
export type Skill = {
  license?: string;
  /** 1 to 500 characters of environment requirements. */
  compatibility?: string;
  metadata?: Record<string, string>;
  /** Space-separated pre-approved tools, written as `allowed-tools`. */
  allowedTools?: string;
} & (
  | { name: string; description: string; body?: Node; file?: never }
  | {
      /** Markdown read when the body is needed; its frontmatter fills `name` and `description` left out here. */
      file: string | URL;
      name?: string;
      description?: string;
      body?: never;
    }
);

/**
 * A named text resource with MCP resource fields, read synchronously or asynchronously.
 */
export interface Resource {
  uri: string;
  name?: string;
  description: string;
  mimeType?: string;
  read(): string | Promise<string>;
}

/**
 * An app definition containing namespaces, commands, skills and resources.
 */
export interface App {
  name: string;
  description: string;
  instructions?: Node;
  namespaces?: Namespace[];
  commands?: Command[];
  skills?: Skill[];
  resources?: Resource[];
}

/**
 * Checks a command definition against its inferred argument and result types.
 * @param command - Command definition to type-check.
 * @returns The supplied command unchanged.
 */
export function defineCommand<S extends Shape, R>(command: Command<S, R>): Command<S, R> {
  return command;
}

/**
 * Checks a namespace while preserving its inferred type.
 * @param namespace - Namespace to type-check.
 * @returns The supplied namespace unchanged.
 */
export function defineNamespace<N extends Namespace>(namespace: N): N {
  return namespace;
}

/**
 * Checks an app definition while preserving its inferred type.
 * @param app - App definition to type-check.
 * @returns The supplied app unchanged.
 */
export function defineApp<A extends App>(app: A): A {
  return app;
}

/**
 * Checks a skill definition while preserving its inferred type.
 * @param skill - Skill definition to type-check.
 * @returns The supplied skill unchanged.
 */
export function defineSkill<S extends Skill>(skill: S): S {
  return skill;
}

/**
 * Checks a resource definition while preserving its inferred type.
 * @param resource - Resource definition to type-check.
 * @returns The supplied resource unchanged.
 */
export function defineResource<R extends Resource>(resource: R): R {
  return resource;
}
