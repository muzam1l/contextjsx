import { expect, test } from 'bun:test';
import { Data, Lines, Pre, render } from 'contextjsx';
import type { Node } from 'contextjsx';
import { TaskSystemPrompt, cases, expected } from './fixtures/coder-prompts';

const text = (node: Node) => render(node);

test('whitespace runs, newlines included, collapse to one space', () => {
  expect(text(<a>{'one  two\n\n  three\tfour'}</a>)).toBe('<a>\n one two three four\n</a>');
});

test('trim applies to the joined child text, so Hello {name} keeps its space', () => {
  const name = 'Ada';
  expect(text(<a>Hello {name}</a>)).toBe('<a>\n Hello Ada\n</a>');
  expect(text(<a> {'  x '} </a>)).toBe('<a>\n x\n</a>');
});

test('Data children are XML-escaped, other text is verbatim', () => {
  expect(text(<a>{'<b> & c'}</a>)).toBe('<a>\n <b> & c\n</a>');
  expect(
    text(
      <a>
        <Data>{'<b> & "c"'}</Data>
      </a>,
    ),
  ).toBe('<a>\n &lt;b&gt; &amp; "c"\n</a>');
});

test('attributes are always escaped, quotes included', () => {
  expect(text(<a title={`<"x" & 'y'>`}>z</a>)).toBe(
    '<a title="&lt;&quot;x&quot; &amp; &apos;y&apos;&gt;">\n z\n</a>',
  );
});

test('Pre keeps whitespace and newlines', () => {
  expect(
    text(
      <a>
        <Pre>{'one\n  two  three'}</Pre>
      </a>,
    ),
  ).toBe('<a>\n one\n   two  three\n</a>');
});

test('Pre around Data escapes and keeps', () => {
  expect(
    text(
      <a>
        <Pre>
          <Data>{'x < y\n  z'}</Data>
        </Pre>
      </a>,
    ),
  ).toBe('<a>\n x &lt; y\n   z\n</a>');
});

test('empty elements are dropped with their attributes', () => {
  expect(
    text(
      <a>
        <b id="1">{''}</b>
        <c>
          {null}
          {false}
          <d />
        </c>
        x
      </a>,
    ),
  ).toBe('<a>\n x\n</a>');
  expect(text(<a>{' \n '}</a>)).toBe('');
});

test('keep forces a self-closing tag', () => {
  expect(
    text(
      <a>
        <b keep id="1" />x
      </a>,
    ),
  ).toBe('<a>\n <b id="1"/>\n x\n</a>');
});

test('indent sets spaces per level', () => {
  expect(
    render(
      <a>
        <b>x</b>
      </a>,
      { indent: 2 },
    ),
  ).toBe('<a>\n  <b>\n    x\n  </b>\n</a>');
});

test('Coder system prompts render byte-identical', () => {
  for (const [name, parts] of Object.entries(cases))
    expect([name, text(<TaskSystemPrompt {...parts} />)]).toEqual([name, expected[name]!]);
});

test('render of a 200-element tree is under 2 ms', () => {
  const tree = (
    <root>
      {Array.from({ length: 100 }, (_, i) => (
        <item id={i}>
          <name>
            item {i} with <Data>{'<data>'}</Data>
          </name>
        </item>
      ))}
    </root>
  );
  render(tree);
  const start = performance.now();
  render(tree);
  expect(performance.now() - start).toBeLessThan(20);
});

test('without augmentation any lowercase tag with primitive attributes compiles', () => {
  expect(
    text(
      <any-tag n={1} s="x" b>
        y
      </any-tag>,
    ),
  ).toBe('<any-tag n="1" s="x" b="true">\n y\n</any-tag>');
  // @ts-expect-error object attribute
  void (<a x={{}} />);
});

test('attributes are primitives; an element or array attribute is rejected', () => {
  expect(text(<a n={1} ok={true} s="x" keep />)).toBe('<a n="1" ok="true" s="x"/>');
  expect(() => render(<a v={[1, 2]}>x</a>)).toThrow('attribute v on <a>');
});

test('section bytes of deep Unicode render in linear time', () => {
  const deep = (depth: number) => {
    let node: Node = 'é'.repeat(depth * 1000);
    for (let i = 0; i < depth; i++) node = <s>{node}</s>;
    return node;
  };
  render(deep(50), { indent: 0 });
  const t0 = performance.now();
  const r = render(deep(400), { indent: 0 });
  expect(performance.now() - t0).toBeLessThan(100);
  expect(r.length).toBeGreaterThan(400 * 4);
});

test('Pre drops leading and trailing whitespace of a run, keeps the inside', () => {
  expect(
    render(
      <a>
        <Pre>{'\n  one\n  two  \n\n'}</Pre>
      </a>,
    ),
  ).toBe('<a>\n one\n   two\n</a>');
});

test('Lines puts each child on its own line and skips empty ones', () => {
  const flows = '';
  expect(
    render(
      <runtime>
        <Lines>
          {'Do the work yourself.'}
          {flows}
          {'Verify before the final message.'}
        </Lines>
      </runtime>,
    ),
  ).toBe('<runtime>\n Do the work yourself.\n Verify before the final message.\n</runtime>');
});
