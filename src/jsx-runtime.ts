/** Booleans render no text. */
export type Primitive = string | number | boolean;

export type Node = Element | Primitive | null | undefined | readonly Node[];

export type Component = (props: any) => Node;

export interface Element {
  type: string | Component;
  props: { [name: string]: unknown };
}

interface Body {
  children?: Node;
  keep?: boolean;
}

// Children share the index signature, so the type cannot exclude element attributes; render rejects them.
type Open = Body & { [attribute: string]: Node };

type Root = Element;

export declare namespace JSX {
  type Element = Root;
  type ElementType = string | Component;
  interface ElementChildrenAttribute {
    children: {};
  }
  type IntrinsicElements = { [tag: Lowercase<string>]: Open };
}

export function jsx(type: string | Component, props: Element['props']): Element {
  return { type, props };
}

export const jsxs = jsx;

export function Fragment(props: { children?: Node }): Node {
  return props.children;
}
