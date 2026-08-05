// @vitest-environment happy-dom
/**
 * Dual-mode golden test for `ref` + `onMount`.
 *
 * Both landed with ZERO compiler changes: `ref` is intercepted inside
 * bindAttr (which compiled output already calls) and onMount is drained by
 * mount()/flushSync. This is the proof — the same fixture, run raw and
 * compiled, must observe the same node identity and the same mount timing.
 */
import { test, expect, afterAll } from 'vitest';
import { compileModule } from '../src/codegen.js';
import { load, cleanupFixtures } from './harness.js';

afterAll(cleanupFixtures);

const FIXTURE = [
  "import { signal, html, mount, onMount, each } from '@amojs/core';",
  "export { flushSync, mount } from '@amojs/core';",
  'export function App() {',
  '  const log = [];',
  '  const items = signal([1, 2]);',
  '  let box = null;',
  '  const Row = (k) => {',
  "    const li = html`<li ref=${(n) => log.push('ref:li' + k + ':' + n.tagName)}>${String(k)}</li>`;",
  "    onMount(() => log.push('mount:li' + k + ':' + li.isConnected));",
  '    return li;',
  '  };',
  '  const el = html`<div><input ref=${(n) => (box = n)}><ul>${each(items, (k) => k, Row)}</ul></div>`;',
  "  onMount(() => log.push('mount:root:' + el.isConnected + ':' + box.tagName));",
  '  return { el, log, items, refAttr: () => box.hasAttribute("ref") };',
  '}',
].join('\n');

async function run(src: string) {
  const mod = await load(src);
  const { el, log, items, refAttr } = mod.App();

  const beforeMount = [...log]; // refs fire during construction, before insertion
  mod.mount(el, document.body);
  const afterMount = [...log];

  items.value = [2, 1, 3]; // reorder + one newcomer
  mod.flushSync();

  return { beforeMount, afterMount, final: [...log], refAttr: refAttr() };
}

test('GOLDEN ref + onMount: raw and compiled behave identically', async () => {
  const compiled = compileModule(FIXTURE);
  expect(compiled).not.toContain('html`');
  expect(compiled).toContain('_$attr('); // ref needed no compiler support

  const raw = await run(FIXTURE);
  const cmp = await run(compiled);

  expect(cmp).toEqual(raw);

  // refs run while the nodes are still detached — that is why onMount exists
  expect(raw.beforeMount).toEqual(['ref:li1:LI', 'ref:li2:LI']);
  // ...and onMount runs once the tree is live. `mount:root` also proves the
  // <input>'s ref landed: it reports the captured element's tagName.
  expect(raw.afterMount).toEqual([
    'ref:li1:LI',
    'ref:li2:LI',
    'mount:li1:true',
    'mount:li2:true',
    'mount:root:true:INPUT',
  ]);
  // the newcomer mounts; reordered rows are moved, not re-mounted
  expect(raw.final.filter((l: string) => l.startsWith('mount:li'))).toEqual([
    'mount:li1:true',
    'mount:li2:true',
    'mount:li3:true',
  ]);
  expect(raw.refAttr).toBe(false); // `ref` never reaches the DOM
});
