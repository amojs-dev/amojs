// @vitest-environment happy-dom
/**
 * Dual-mode golden test for v0.5 composition: a component IMPORTED from
 * another module, mounted and unmounted by a conditional — with a hard
 * no-leak assertion (subscription counts back to zero after unmount).
 * Both modules go through compileModule for the compiled run, exactly like
 * `amo build` would compile them file by file.
 */
import { test, expect, afterAll } from 'vitest';
import { compileModule } from '../src/codegen.js';
import { loadModules, cleanupFixtures } from './harness.js';

afterAll(cleanupFixtures);

const CHILD = [
  "import { html } from 'amojs';",
  '/** a component is a plain exported function; props are its arguments */',
  'export function Child(label) {',
  '  return html`<em>${label}</em>|<i>${() => label.value.toUpperCase()}</i>`;',
  '}',
].join('\n');

const MAIN = [
  "import { signal, html } from 'amojs';",
  "import { Child } from './child.mjs';",
  "export { flushSync } from 'amojs';",
  'export function make() {',
  "  const name = signal('a');",
  '  const on = signal(true);',
  "  const el = html`<div>${() => (on.value ? Child(name) : 'off')}</div>`;",
  '  return { el, name, on };',
  '}',
].join('\n');

async function runApp(files: Record<string, string>) {
  const mod = await loadModules(files, 'main.mjs');
  const { el, name, on } = mod.make();
  document.body.append(el);

  const snaps = [el.innerHTML];
  name.value = 'b';
  mod.flushSync();
  snaps.push(el.innerHTML);

  on.value = false; // unmount the imported component
  mod.flushSync();
  snaps.push(el.innerHTML);
  const subsAfterUnmount = name.subs.size;

  name.value = 'c'; // writes while unmounted must reach nobody
  mod.flushSync();
  snaps.push(el.innerHTML);

  on.value = true; // a fresh instance sees the current value
  mod.flushSync();
  snaps.push(el.innerHTML);

  return { snaps, subsAfterUnmount };
}

test('GOLDEN imported component: raw and compiled behave identically, zero leaks', async () => {
  const compiled = {
    'child.mjs': compileModule(CHILD),
    'main.mjs': compileModule(MAIN),
  };
  expect(compiled['child.mjs']).not.toContain('html`');
  expect(compiled['main.mjs']).not.toContain('html`');

  const raw = await runApp({ 'child.mjs': CHILD, 'main.mjs': MAIN });
  const cmp = await runApp(compiled);

  expect(cmp).toEqual(raw);
  expect(raw.snaps).toEqual([
    '<em>a</em>|<i>A</i>',
    '<em>b</em>|<i>B</i>',
    'off',
    'off',
    '<em>c</em>|<i>C</i>',
  ]);
  expect(raw.subsAfterUnmount).toBe(0); // the unmounted component left nothing behind
});
