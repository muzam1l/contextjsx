import type { Element, Node } from './jsx-runtime';

/** Untrusted text: `&`, `<` and `>` escaped. */
export function Data(props: { children?: Node }): Node {
  return props.children;
}

/** Whitespace and newlines kept; a text run's edges are still trimmed. */
export function Pre(props: { children?: Node }): Node {
  return props.children;
}

/** Each child on its own line; empty children left out. */
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

const escapeXml = (text: string, pattern: RegExp) => text.replace(pattern, char => ENTITIES[char]!);

function walk(node: Node, escape: boolean, pre: boolean, out: Array<Piece | Tag>): void {
  if (node == null || typeof node === 'boolean') return;

  if (typeof node === 'string' || typeof node === 'number') {
    const text = String(node);
    out.push({ text: escape ? escapeXml(text, /[&<>]/g) : text, pre });
    return;
  }

  if (Array.isArray(node)) {
    for (const child of node) walk(child as Node, escape, pre, out);
    return;
  }

  const { type, props } = node as Element;
  const children = props.children as Node;
  if (type === Data) return walk(children, true, pre, out);
  if (type === Pre) return walk(children, escape, true, out);
  if (type === Lines) {
    const rows = (Array.isArray(children) ? children : [children])
      .map(child => {
        const row: Array<Piece | Tag> = [];
        walk(child as Node, escape, pre, row);
        return write(normalize(row), '', ' ');
      })
      .filter(Boolean);
    out.push({ text: rows.join('\n'), pre: true });
    return;
  }
  if (typeof type === 'function') return walk(type(props), escape, pre, out);

  const items: Array<Piece | Tag> = [];
  walk(children, escape, pre, items);
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
    attributes += ` ${name}="${escapeXml(String(value), /[&<>"']/g)}"`;
  }
  out.push({ name: type, attributes, children: content });
}

function normalize(items: Array<Piece | Tag>): Array<string | Tag> {
  const out: Array<string | Tag> = [];
  let pieces: Piece[] = [];
  const flush = () => {
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
    const run = (space ? text.slice(0, -1) : text).trim();
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

function write(items: Array<string | Tag>, prefix: string, pad: string): string {
  return items
    .map(item => {
      if (typeof item === 'string') return prefix ? item.replace(/^(?=.)/gm, prefix) : item;
      if (!item.children.length) return `${prefix}<${item.name}${item.attributes}/>`;
      return `${prefix}<${item.name}${item.attributes}>\n${write(item.children, prefix + pad, pad)}\n${prefix}</${item.name}>`;
    })
    .join('\n');
}

/** Whitespace collapsed, `Data` escaped, `Pre` kept, empty elements dropped; `indent` spaces per level, default 1. */
export function render(node: Node, options: { indent?: number } = {}): string {
  const items: Array<Piece | Tag> = [];
  walk(node, false, false, items);
  return write(normalize(items), '', ' '.repeat(options.indent ?? 1));
}
