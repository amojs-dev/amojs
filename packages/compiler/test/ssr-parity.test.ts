// @vitest-environment happy-dom
/**
 * THE SSR PARITY GATE — LOCKED RULE #3 extended to the string backend.
 *
 * Each fixture runs twice: raw (the browser parses html`` and binds live)
 * and server-compiled (string concatenation on node). The server string,
 * parsed by the same DOM, must produce the tree the client built — same
 * elements, same attributes, same text, and the same live form STATE.
 *
 * The four property names bind.js writes as properties are compared AS
 * properties on both sides (the client sets .value and leaves no attribute;
 * the server serializes the attribute the parser turns back into the
 * property) — everything else must match attribute-for-attribute.
 */
import { test, expect, afterAll } from 'vitest';
import { compileModule } from '../src/codegen.js';
import { load, cleanupFixtures } from './harness.js';

afterAll(cleanupFixtures);

const PROPS = ['value', 'checked', 'selected', 'indeterminate'] as const;

/** structural canon: merged text runs, sorted attrs minus the property
 *  names, the property names read as live properties */
function canon(el: Element): unknown {
  const attrs: Record<string, string> = {};
  for (const a of Array.from(el.attributes)) {
    if (!(PROPS as readonly string[]).includes(a.name)) attrs[a.name] = a.value;
  }
  const props: Record<string, unknown> = {};
  for (const p of PROPS) if (p in el) props[p] = (el as unknown as Record<string, unknown>)[p];
  return {
    tag: el.tagName,
    attrs,
    props,
    // textarea: the value IS the serialized content on the server, and the
    // client keeps the static default as content — .value (in props) is the
    // observable state, the child text is not
    children: el.tagName === 'TEXTAREA' ? [] : canonChildren(el),
  };
}

function canonChildren(parent: Element): unknown[] {
  const out: unknown[] = [];
  let text = '';
  const flush = () => {
    if (text !== '') out.push({ text });
    text = '';
  };
  for (const c of Array.from(parent.childNodes)) {
    if (c.nodeType === 3) text += (c as Text).data;
    else if (c.nodeType === 8) {
      flush();
      out.push({ comment: (c as Comment).data });
    } else {
      flush();
      out.push(canon(c as Element));
    }
  }
  flush();
  return out;
}

/** render both ways, assert the parsed server tree equals the client tree */
async function parity(src: string): Promise<{ html: string }> {
  const rawMod = await load(src);
  const serverSrc = compileModule(src, { target: 'server' });
  expect(serverSrc).not.toContain('html`');
  const serverMod = await load(serverSrc);

  const clientHost = document.createElement('div');
  clientHost.append(rawMod.default());

  const res = serverMod.default();
  expect(typeof res.__amoHtml).toBe('string');
  // no markers, ever — unless the AUTHOR wrote an empty comment, which is
  // content and must survive (positions, not pattern-matching, place holes)
  if (!src.includes('<!---->')) expect(res.__amoHtml).not.toContain('<!---->');
  const serverHost = document.createElement('div');
  serverHost.innerHTML = res.__amoHtml;

  expect(canonChildren(serverHost)).toEqual(canonChildren(clientHost));
  return { html: res.__amoHtml };
}

/* ------------------------------------------------------------------ */

test('parity: text holes — signal, computed, function, and falsy values', async () => {
  await parity(`
import { html, signal, computed } from '@amojs.dev/core';
const n = signal(3);
const d = computed(() => n.value * 2);
export default () => html\`<p class="row">n=\${n} d=\${d} f=\${() => n.value + 1} z=\${0} t=\${true} e=\${null}|\${false}|\${undefined}|\${''}</p>\`;
`);
});

test('parity: attribute holes — string, number, true, false, null, signal', async () => {
  await parity(`
import { html, signal } from '@amojs.dev/core';
const on = signal(true);
const off = signal(false);
export default () => html\`<div id=\${'a'} data-n=\${5} hidden=\${on} draggable=\${'true'} title=\${null} lang=\${off} spellcheck=\${true}>x</div>\`;
`);
});

test('parity: form state — value/checked/selected land as live properties', async () => {
  await parity(`
import { html, signal } from '@amojs.dev/core';
const name = signal('amo');
const agreed = signal(true);
const pct = signal(0.7);
export default () => html\`<form>
  <input class="name" value=\${name}>
  <input type="checkbox" checked=\${agreed}>
  <input type="checkbox" checked=\${false}>
  <select><option value="a">A</option><option value="b" selected=\${true}>B</option></select>
  <progress max="1" value=\${pct}></progress>
  <button value=\${name}>go</button>
</form>\`;
`);
});

test('parity: textarea value hole — state through .value in both modes', async () => {
  const { html } = await parity(`
import { html, signal } from '@amojs.dev/core';
const note = signal('hello <world> & "friends"');
export default () => html\`<textarea rows="2" value=\${note}>fallback</textarea>\`;
`);
  // the server serializes the VALUE as content, escaped
  expect(html).toContain('hello &lt;world> &amp; "friends"');
  expect(html).not.toContain('fallback');
});

test('parity: nested templates, conditionals, and arrays (.map on the server)', async () => {
  await parity(`
import { html, signal } from '@amojs.dev/core';
const items = signal(['a', 'b', 'c']);
const on = signal(true);
const Badge = (t) => html\`<b class="badge">\${t}</b>\`;
export default () => html\`<div>
  \${Badge('top')}
  <ul>\${() => items.value.map((it) => html\`<li>\${it}</li>\`)}</ul>
  \${() => (on.value ? html\`<i>yes</i>\` : 'no')}
</div>\`;
`);
});

test('parity: escaping — text and attribute holes neutralize markup', async () => {
  const { html } = await parity(`
import { html } from '@amojs.dev/core';
const evil = '<script>alert(1)</script>';
const attr = 'a"<b & c';
export default () => html\`<div title=\${attr}><span>\${evil}</span>\${'$\` $& stays literal'}</div>\`;
`);
  expect(html).not.toContain('<script>');
  // `<` is what opens a tag, so `<` is what gets escaped — `>` alone is inert
  expect(html).toContain('&lt;script>alert(1)&lt;/script>');
  expect(html).toContain('title="a&quot;&lt;b &amp; c"');
  // function replacements, never string magic: "$&"-style patterns stay
  // literal (the & itself is escaped like any other text ampersand)
  expect(html).toContain('$` $&amp; stays literal');
});

test('parity: static parts stay verbatim — entities, "a < b", comments', async () => {
  await parity(`
import { html } from '@amojs.dev/core';
export default () => html\`<p>&amp; a < b <!--note--> <!----> \${'x'}</p>\`;
`);
});

test('parity: single root unwraps — surrounding whitespace never renders', async () => {
  const { html } = await parity(`
import { html } from '@amojs.dev/core';
export default () => html\`
  <section id="only">\${'in'}</section>
\`;
`);
  expect(html.startsWith('<section')).toBe(true);
  expect(html.endsWith('</section>')).toBe(true);
});

test('parity: multi-root fragment keeps every root child, whitespace included', async () => {
  await parity(`
import { html } from '@amojs.dev/core';
export default () => html\`<i>a</i> <i>\${'b'}</i>\`;
`);
});

test('parity: svg — self-closed elements, cased attributes, bound holes', async () => {
  await parity(`
import { html, signal } from '@amojs.dev/core';
const r = signal(5);
export default () => html\`<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="\${r}"/><text>\${'lbl'}</text></svg>\`;
`);
});

test('parity: event holes — no markup, and a non-function throws the same words', async () => {
  const { html } = await parity(`
import { html } from '@amojs.dev/core';
export default () => html\`<button onclick=\${() => {}}>go</button>\`;
`);
  expect(html).not.toContain('onclick');

  const bad = `
import { html } from '@amojs.dev/core';
export default () => html\`<button onclick=\${5}>go</button>\`;
`;
  const rawMod = await load(bad);
  const serverMod = await load(compileModule(bad, { target: 'server' }));
  let rawErr = '';
  let serverErr = '';
  try {
    rawMod.default();
  } catch (e) {
    rawErr = (e as Error).message;
  }
  try {
    serverMod.default();
  } catch (e) {
    serverErr = (e as Error).message;
  }
  expect(rawErr).toBe('amo: onclick needs a function, not a number');
  expect(serverErr).toBe(rawErr);
});

test('parity: an array member that is not a template throws the same words', async () => {
  const bad = `
import { html } from '@amojs.dev/core';
export default () => html\`<ul>\${['plain text']}</ul>\`;
`;
  const rawMod = await load(bad);
  const serverMod = await load(compileModule(bad, { target: 'server' }));
  let rawErr = '';
  let serverErr = '';
  try {
    rawMod.default();
  } catch (e) {
    rawErr = (e as Error).message;
  }
  try {
    serverMod.default();
  } catch (e) {
    serverErr = (e as Error).message;
  }
  expect(rawErr).toBe('amo: array holes take non-fragment nodes only');
  expect(serverErr).toBe(rawErr);
});

test('parity: ref holes vanish on the server — no attribute, no call', async () => {
  const { html } = await parity(`
import { html, signal } from '@amojs.dev/core';
const el = signal(null);
export default () => html\`<input class="focus-me" ref=\${el}>\`;
`);
  expect(html).not.toContain('ref');
});
