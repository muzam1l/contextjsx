import type { Element, Node } from './jsx-runtime';

/**
 * Untrusted text: XML-escaped when rendered.
 * @param props - Children whose text must be escaped.
 * @returns The supplied children, interpreted as untrusted text by render.
 */
export function Data(props: { children?: Node }): Node {
  return props.children;
}

/**
 * Whitespace and newlines kept when rendered; leading and trailing whitespace of a text run is still dropped.
 * @param props - Children whose whitespace must be preserved.
 * @returns The supplied children, interpreted as whitespace-preserving text by render.
 */
export function Pre(props: { children?: Node }): Node {
  return props.children;
}

/**
 * Each child rendered on its own line; empty children are left out.
 * @param props - Children, one per line.
 * @returns The supplied children, joined by newlines by render.
 */
export function Lines(props: { children?: Node }): Node {
  return props.children;
}

interface Piece {
  text: string;
  pre: boolean;
}

interface Tag {
  name: string;
  attributes: string;
  children: Array<string | Tag>;
}

const ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
};

const escape = (text: string, pattern: RegExp) => text.replace(pattern, char => ENTITIES[char]!);

const indent = (text: string, prefix: string) => (prefix ? text.replace(/^(?=.)/gm, prefix) : text);

function walk(node: Node, data: boolean, pre: boolean, out: Array<Piece | Tag>): void {
  if (node == null || typeof node === 'boolean') return;

  if (typeof node === 'string' || typeof node === 'number') {
    const text = String(node);
    out.push({ text: data ? escape(text, /[&<>]/g) : text, pre });
    return;
  }

  if (Array.isArray(node)) {
    for (const child of node) walk(child as Node, data, pre, out);
    return;
  }

  const { type, props } = node as Element;
  const children = props.children as Node;
  if (type === Data) return walk(children, true, pre, out);
  if (type === Pre) return walk(children, data, true, out);
  if (type === Lines) {
    const rows = (Array.isArray(children) ? children : [children])
      .map(child => {
        const row: Array<Piece | Tag> = [];
        walk(child as Node, data, pre, row);
        return write(normalize(row), '', ' ');
      })
      .filter(Boolean);
    out.push({ text: rows.join('\n'), pre: true });
    return;
  }
  if (typeof type === 'function') return walk(type(props), data, pre, out);

  const items: Array<Piece | Tag> = [];
  walk(children, data, pre, items);
  const content = normalize(items);
  if (!content.length && !props.keep) return;

  let attributes = '';
  for (const name in props) {
    const value = props[name];
    if (name === 'children' || name === 'keep' || value == null) continue;
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean')
      throw new Error(
        `contextjsx: attribute ${name} on <${type}> must be a string, number or boolean`,
      );
    attributes += ` ${name}="${escape(String(value), /[&<>"']/g)}"`;
  }
  out.push({ name: type, attributes, children: content });
}

function normalize(items: Array<Piece | Tag>): Array<string | Tag> {
  const out: Array<string | Tag> = [];
  let pieces: Piece[] = [];
  const flush = () => {
    const run = join(pieces).trim();
    if (run) out.push(run);
    pieces = [];
  };

  for (const item of items) {
    if ('name' in item) {
      flush();
      out.push(item);
    } else pieces.push(item);
  }
  flush();

  return out;
}

function join(pieces: Piece[]): string {
  let text = '';
  let space = false;

  for (const piece of pieces) {
    let part = piece.text;
    if (!piece.pre) {
      part = part.replace(/\s+/g, ' ');
      if ((space || !text) && part.startsWith(' ')) part = part.slice(1);
    }
    if (!part) continue;
    text += part;
    space = !piece.pre && part.endsWith(' ');
  }

  return space ? text.slice(0, -1) : text;
}

function write(items: Array<string | Tag>, prefix: string, pad: string): string {
  return items
    .map(item => {
      if (typeof item === 'string') return indent(item, prefix);
      if (!item.children.length) return `${prefix}<${item.name}${item.attributes}/>`;
      return `${prefix}<${item.name}${item.attributes}>\n${write(item.children, prefix + pad, pad)}\n${prefix}</${item.name}>`;
    })
    .join('\n');
}

/**
 * Renders a prompt tree to text: whitespace collapsed, `Data` escaped, `Pre` kept, empty elements dropped.
 * @param node - Prompt tree to render.
 * @param options - Spaces per indentation level, default 1.
 * @returns The prompt text.
 */
export function render(node: Node, options: { indent?: number } = {}): string {
  const items: Array<Piece | Tag> = [];
  walk(node, false, false, items);
  return write(normalize(items), '', ' '.repeat(options.indent ?? 1));
}
