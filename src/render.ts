import type { Element, Node } from './jsx-runtime';

/** Untrusted text: `&`, `<` and `>` escaped. */
export function Data(props: { children?: Node }): Node {
  return props.children;
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

function walk(node: Node, escape: boolean, out: Array<string | Tag>): void {
  if (node == null || typeof node === 'boolean') return;

  if (typeof node === 'string' || typeof node === 'number') {
    const text = String(node);
    out.push(escape ? escapeXml(text, /[&<>]/g) : text);
    return;
  }

  if (Array.isArray(node)) {
    for (const child of node) walk(child as Node, escape, out);
    return;
  }

  const { type, props } = node as Element;
  const children = props.children as Node;
  if (type === Data) return walk(children, true, out);
  if (typeof type === 'function') return walk(type(props), escape, out);

  const items: Array<string | Tag> = [];
  walk(children, escape, items);
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

// Adjacent strings form one run, trimmed at its edges; empty runs vanish.
function normalize(items: Array<string | Tag>): Array<string | Tag> {
  const out: Array<string | Tag> = [];
  let run = '';
  const flush = () => {
    const text = run.trim();
    if (text) out.push(text);
    run = '';
  };

  for (const item of items) {
    if (typeof item === 'string') run += item;
    else {
      flush();
      out.push(item);
    }
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

/** Text as written, `Data` escaped, empty elements dropped; `indent` spaces per level, default 1. */
export function render(node: Node, options: { indent?: number } = {}): string {
  const items: Array<string | Tag> = [];
  walk(node, false, items);
  return write(normalize(items), '', ' '.repeat(options.indent ?? 1));
}
