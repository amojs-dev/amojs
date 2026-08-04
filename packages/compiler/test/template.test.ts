import { test, expect } from 'vitest';
import { parseTemplate } from '../src/template.js';

/* strings arrays are written exactly as the runtime would receive them:
   parseTemplate(['<p>', '</p>']) ≡ html`<p>${x}</p>` */

test('text hole: <p>${x}</p>', () => {
  expect(parseTemplate(['<p>', '</p>'])).toEqual({
    html: '<p></p>',
    holes: [{ kind: 'child', expr: 0, path: [0, 0] }],
  });
});

test('static text before a hole becomes its own node: <p>c:${x}</p>', () => {
  expect(parseTemplate(['<p>c:', '</p>'])).toEqual({
    html: '<p>c:</p>',
    holes: [{ kind: 'child', expr: 0, path: [0, 1] }],
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
  });
});

test('quoted attribute hole: <div class="${c}">t</div>', () => {
  expect(parseTemplate(['<div class="', '">t</div>'])).toEqual({
    html: '<div>t</div>',
    holes: [{ kind: 'attr', expr: 0, name: 'class', path: [0] }],
  });
});

test('event hole: <button onclick=${f}>x</button>', () => {
  expect(parseTemplate(['<button onclick=', '>x</button>'])).toEqual({
    html: '<button>x</button>',
    holes: [{ kind: 'event', expr: 0, name: 'click', path: [0] }],
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
  expect(ir.html).toBe('<div><br></div>');
  expect(ir.holes).toEqual([{ kind: 'child', expr: 0, path: [0, 1] }]);
});

test('comments count as siblings and pass through: <div><!--c-->${x}</div>', () => {
  const ir = parseTemplate(['<div><!--c-->', '</div>']);
  expect(ir.html).toBe('<div><!--c--></div>');
  expect(ir.holes).toEqual([{ kind: 'child', expr: 0, path: [0, 1] }]);
});

test('boolean and unquoted static attributes pass through', () => {
  expect(parseTemplate(['<input disabled id=x>']).html).toBe('<input disabled id=x>');
});

test('tag and attribute names are lowercased, values kept as-is', () => {
  const ir = parseTemplate(['<DIV CLASS="Ab">', '</DIV>']);
  expect(ir.html).toBe('<div class="Ab"></div>');
});

test('entities pass through untouched: <p>&amp; ${x}</p>', () => {
  const ir = parseTemplate(['<p>&amp; ', '</p>']);
  expect(ir.html).toBe('<p>&amp; </p>');
  expect(ir.holes[0].path).toEqual([0, 1]);
});

test('a lone "<" is text, exactly like the browser: <p>a < b</p>', () => {
  expect(parseTemplate(['<p>a < b</p>']).html).toBe('<p>a < b</p>');
});

test('whitespace around a hole stays in separate text nodes: <p> ${x} </p>', () => {
  const ir = parseTemplate(['<p> ', ' </p>']);
  expect(ir.html).toBe('<p>  </p>');
  expect(ir.holes).toEqual([{ kind: 'child', expr: 0, path: [0, 1] }]);
});

test('a template with no holes parses to plain IR', () => {
  expect(parseTemplate(['<p>hi</p>'])).toEqual({ html: '<p>hi</p>', holes: [] });
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
