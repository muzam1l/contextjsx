/**
 * A scalar prompt child; booleans produce no rendered text.
 */
export type Primitive = string | number | boolean;

/**
 * A prompt element, scalar, empty child or nested array of children.
 */
export type Node = Element | Primitive | null | undefined | readonly Node[];

/**
 * A function that produces prompt children from JSX props.
 * @param props - Component attributes and children, checked at the JSX call site.
 * @returns Prompt children to render.
 */
export type Component = (props: any) => Node;

/**
 * A prompt tag or component paired with its attributes and children.
 */
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

/**
 * Types used by the automatic JSX transform and intrinsic tag checking.
 */
export declare namespace JSX {
  /**
   * The element produced by the JSX runtime.
   */
  type Element = Root;
  /**
   * An intrinsic tag name or prompt component accepted in JSX.
   */
  type ElementType = string | Component;
  /**
   * Identifies the props field that receives JSX children.
   */
  interface ElementChildrenAttribute {
    children: {};
  }
  /**
   * Any lowercase tag with primitive attributes and children.
   */
  type IntrinsicElements = { [tag: Lowercase<string>]: Open };
}

/**
 * Creates a prompt element without rendering its children.
 * @param type - Intrinsic tag name or component function.
 * @param props - Element attributes and children.
 * @returns The element with the supplied type and props.
 */
export function jsx(type: string | Component, props: Element['props']): Element {
  return { type, props };
}

/**
 * Creates a prompt element for JSX with multiple children.
 * @param type - Intrinsic tag name or component function.
 * @param props - Element attributes and children.
 * @returns The element with the supplied type and props.
 */
export const jsxs = jsx;

/**
 * Passes children through without adding a rendered tag.
 * @param props - Children to pass through.
 * @returns The supplied children.
 */
export function Fragment(props: { children?: Node }): Node {
  return props.children;
}
