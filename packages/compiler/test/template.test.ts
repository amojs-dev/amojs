import { test, expect } from 'vitest';
import { parseTemplate } from '../src/template.js';

/* strings arrays are written exactly as the runtime would receive them:
   parseTemplate(['<p>', '</p>']) ≡ html`<p>${x}</p>` */

test('text hole: <p>${x}</p>', () => {
  expect(parseTemplate(['<p>', '</p>'])).toEqual({
    html: '<p><!----></p>',
    holes: [{ kind: 'child', expr: 0, path: [0, 0] }],
    singleRootIndex: 0,
  });
});

test('static text before a hole becomes its own node: <p>c:${x}</p>', () => {
  expect(parseTemplate(['<p>c:', '</p>'])).toEqual({
    html: '<p>c:<!----></p>',
    holes: [{ kind: 'child', expr: 0, path: [0, 1] }],
    singleRootIndex: 0,
  });
});

test('adjacent holes get separate placeholder indexes: <p>${a}${b}</p>', () => {
  expect(parseTemplate(['<p>', '', '</p>']).holes).toEqual([
    { kind: 'child', expr: 0, path: [0, 0] },
    { kind: 'child', expr: 1, path: [0, 1] },
  ]);
});

test('unquoted attribute hole on a void element: <img src=${u} alt="x">', () => {
  expect(parseTemplate(['<img src=', ' alt="x">'])).toEqual({
    html: '<img alt="x">',
    holes: [{ kind: 'attr', expr: 0, name: 'src', path: [0] }],
    singleRootIndex: 0,
  });
});

test('quoted attribute hole: <div class="${c}">t</div>', () => {
  expect(parseTemplate(['<div class="', '">t</div>'])).toEqual({
    html: '<div>t</div>',
    holes: [{ kind: 'attr', expr: 0, name: 'class', path: [0] }],
    singleRootIndex: 0,
  });
});

test('event hole: <button onclick=${f}>x</button>', () => {
  expect(parseTemplate(['<button onclick=', '>x</button>'])).toEqual({
    html: '<button>x</button>',
    holes: [{ kind: 'event', expr: 0, name: 'click', path: [0] }],
    singleRootIndex: 0,
  });
});

test('nested element paths: <div><span>${x}</span><b>${y}</b></div>', () => {
  expect(parseTemplate(['<div><span>', '</span><b>', '</b></div>']).holes).toEqual([
    { kind: 'child', expr: 0, path: [0, 0, 0] },
    { kind: 'child', expr: 1, path: [0, 1, 0] },
  ]);
});

test('second root element: <i>a</i><i>${x}</i>', () => {
  expect(parseTemplate(['<i>a</i><i>', '</i>']).holes).toEqual([
    { kind: 'child', expr: 0, path: [1, 0] },
  ]);
});

test('void elements count as siblings: <div><br>${x}</div>', () => {
  const ir = parseTemplate(['<div><br>', '</div>']);
  expect(ir.html).toBe('<div><br><!----></div>');
  expect(ir.holes).toEqual([{ kind: 'child', expr: 0, path: [0, 1] }]);
});

test('comments count as siblings and pass through: <div><!--c-->${x}</div>', () => {
  const ir = parseTemplate(['<div><!--c-->', '</div>']);
  expect(ir.html).toBe('<div><!--c--><!----></div>');
  expect(ir.holes).toEqual([{ kind: 'child', expr: 0, path: [0, 1] }]);
});

test('boolean and unquoted static attributes pass through', () => {
  expect(parseTemplate(['<input disabled id=x>']).html).toBe('<input disabled id=x>');
});

test('tag and attribute names are lowercased, values kept as-is', () => {
  const ir = parseTemplate(['<DIV CLASS="Ab">', '</DIV>']);
  expect(ir.html).toBe('<div class="Ab"><!----></div>');
});

test('entities pass through untouched: <p>&amp; ${x}</p>', () => {
  const ir = parseTemplate(['<p>&amp; ', '</p>']);
  expect(ir.html).toBe('<p>&amp; <!----></p>');
  expect(ir.holes[0].path).toEqual([0, 1]);
});

test('a lone "<" is text, exactly like the browser: <p>a < b</p>', () => {
  expect(parseTemplate(['<p>a < b</p>']).html).toBe('<p>a < b</p>');
});

test('whitespace around a hole stays in separate text nodes: <p> ${x} </p>', () => {
  const ir = parseTemplate(['<p> ', ' </p>']);
  expect(ir.html).toBe('<p> <!----> </p>');
  expect(ir.holes).toEqual([{ kind: 'child', expr: 0, path: [0, 1] }]);
});

test('a template with no holes parses to plain IR', () => {
  expect(parseTemplate(['<p>hi</p>'])).toEqual({
    html: '<p>hi</p>',
    holes: [],
    singleRootIndex: 0,
  });
});

test('singleRootIndex: null for multiple roots or root-level text', () => {
  expect(parseTemplate(['<i>a</i><i>b</i>']).singleRootIndex).toBe(null);
  expect(parseTemplate(['x<p>t</p>']).singleRootIndex).toBe(null);
  expect(parseTemplate(['<!--c--><p>t</p>']).singleRootIndex).toBe(null);
  // whitespace around a single root is fine — and the index counts it
  expect(parseTemplate(['  <p>t</p> ']).singleRootIndex).toBe(1);
});

/* ---------------- foreign content (svg / math) ---------------- */

test('svg self-closes any element — the way SVG is actually written', () => {
  const ir = parseTemplate(['<svg><circle r="5"/><rect/></svg>']);
  // the "/" MUST survive into the emitted markup: without it the reparse
  // would open <circle> and swallow <rect>, shifting every later NodePath
  expect(ir.html).toBe('<svg><circle r="5"/><rect/></svg>');
  expect(ir.singleRootIndex).toBe(0);
});

test('svg keeps name casing — SVG attributes are case-sensitive', () => {
  const ir = parseTemplate([
    '<svg viewBox="0 0 1 1"><linearGradient gradientTransform="t"><stop/></linearGradient></svg>',
  ]);
  expect(ir.html).toBe(
    '<svg viewBox="0 0 1 1"><linearGradient gradientTransform="t"><stop/></linearGradient></svg>',
  );
});

test('an svg attr hole keeps its casing, an svg event hole is lowercased', () => {
  expect(parseTemplate(['<svg><path pathLength=', ' onClick=', ' /></svg>']).holes).toEqual([
    { kind: 'attr', expr: 0, name: 'pathLength', path: [0, 0] },
    { kind: 'event', expr: 1, name: 'click', path: [0, 0] },
  ]);
});

test('throws: an unquoted hole glued to "/>" — the browser mis-parses it', () => {
  // Chrome folds the "/" into the value AND does not self-close, so the next
  // sibling becomes a child. Raw mode rejects it; so must we (LOCKED RULE #3).
  expect(() => parseTemplate(['<svg><circle r=', '/></svg>'])).toThrow(/cannot be followed by/);
  expect(() => parseTemplate(['<img src=', '/>'])).toThrow(/cannot be followed by/);
  // both spellings the error suggests do work
  expect(parseTemplate(['<svg><circle r=', ' /></svg>']).html).toBe('<svg><circle/></svg>');
  expect(parseTemplate(['<svg><circle r="', '"/></svg>']).html).toBe('<svg><circle/></svg>');
});

test('foreign content has no void elements: <svg><circle> still needs closing', () => {
  expect(() => parseTemplate(['<svg><circle></svg>'])).toThrow(/unexpected <\/svg>/);
  expect(parseTemplate(['<svg><circle></circle></svg>']).html).toBe(
    '<svg><circle></circle></svg>',
  );
});

test('inside svg, rawtext elements are ordinary — <title> is the a11y name', () => {
  expect(parseTemplate(['<svg><title>Chart</title></svg>']).html).toBe(
    '<svg><title>Chart</title></svg>',
  );
});

test('holes and paths work inside svg', () => {
  const ir = parseTemplate(['<svg><circle r="', '"/><text>', '</text></svg>']);
  expect(ir.holes).toEqual([
    { kind: 'attr', expr: 0, name: 'r', path: [0, 0] },
    { kind: 'child', expr: 1, path: [0, 1, 0] },
  ]);
  expect(ir.html).toBe('<svg><circle/><text><!----></text></svg>');
});

test('svg nested in html, with siblings after it, keeps sibling paths right', () => {
  const ir = parseTemplate(['<div><svg><use href="#a"/></svg><span>', '</span></div>']);
  expect(ir.html).toBe('<div><svg><use href="#a"/></svg><span><!----></span></div>');
  expect(ir.holes).toEqual([{ kind: 'child', expr: 0, path: [0, 1, 0] }]);
});

test('<math> is foreign content too', () => {
  expect(parseTemplate(['<math><mi>x</mi><mspace/></math>']).html).toBe(
    '<math><mi>x</mi><mspace/></math>',
  );
});

test('HTML rules resume inside an integration point (foreignObject)', () => {
  expect(parseTemplate(['<svg><foreignObject><div>x</div></foreignObject></svg>']).html).toBe(
    '<svg><foreignObject><div>x</div></foreignObject></svg>',
  );
  // <div/> is still an error in there — foreignObject's children are HTML
  expect(() =>
    parseTemplate(['<svg><foreignObject><div/></foreignObject></svg>']),
  ).toThrow(/self-closing/);
});

/* ---------------- strict-subset errors ---------------- */

test('throws: partial quoted attribute value', () => {
  expect(() => parseTemplate(['<div class="a', '">t</div>'])).toThrow(/entire quoted value/);
});

test('throws: hole glued to an unquoted value', () => {
  expect(() => parseTemplate(['<div class=', 'x>t</div>'])).toThrow(/entire attribute value/);
});

test('throws: hole in attribute-name position', () => {
  expect(() => parseTemplate(['<div ', '>x</div>'])).toThrow(/full attribute value/);
});

test('throws: unclosed element', () => {
  expect(() => parseTemplate(['<div>'])).toThrow(/unclosed <div>/);
});

test('throws: mismatched closing tag', () => {
  expect(() => parseTemplate(['<div></span>'])).toThrow(/unexpected <\/span>/);
});

test('throws: self-closing a non-void element', () => {
  expect(() => parseTemplate(['<div/>'])).toThrow(/self-closing/);
});

test('throws: rawtext elements are not supported', () => {
  expect(() => parseTemplate(['<script>a</script>'])).toThrow(/not supported/);
});

test('throws: hole inside a comment', () => {
  expect(() => parseTemplate(['<div><!-- ', ' --></div>'])).toThrow(/inside a comment/);
});

test('throws: two holes glued together inside a tag', () => {
  expect(() => parseTemplate(['<div class=', '', '>x</div>'])).toThrow(/two holes/);
});
