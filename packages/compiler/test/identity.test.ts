// @vitest-environment happy-dom
/**
 * THE IDENTITY BENCHMARK — the v0.2 PASS criterion and AmoJS's signature:
 * "compiles to the vanilla JS you would have written."
 *
 * A careful human writes the same counter by hand against @amojs/core
 * signals — real createElement / createTextNode / addEventListener, no
 * templates. The compiled module must (a) behave identically to it and
 * (b) cost at most +10% of its bytes (gzip — normalizes naming noise).
 */
import { test, expect, afterAll } from 'vitest';
import { gzipSync } from 'node:zlib';
import { compileModule } from '../src/codegen.js';
import { load, cleanupFixtures } from './harness.js';

afterAll(cleanupFixtures);

const FIXTURE = [
  "import { signal, computed, html } from '@amojs/core';",
  "export { flushSync } from '@amojs/core';",
  'export function Counter() {',
  '  const count = signal(0);',
  '  const double = computed(() => count.value * 2);',
  '  return html`<button class="btn" onclick=${() => count.value++}>c:${count}|${double}</button>`;',
  '}',
].join('\n');

/* the reference: what a disciplined human writes for the same behavior */
const REFERENCE = [
  "import { signal, computed, effect } from '@amojs/core';",
  "export { flushSync } from '@amojs/core';",
  'export function Counter() {',
  '  const count = signal(0);',
  '  const double = computed(() => count.value * 2);',
  "  const button = document.createElement('button');",
  "  button.setAttribute('class', 'btn');",
  "  const t0 = document.createTextNode('c:');",
  "  const t1 = document.createTextNode('');",
  "  const t2 = document.createTextNode('|');",
  "  const t3 = document.createTextNode('');",
  '  button.append(t0, t1, t2, t3);',
  "  button.addEventListener('click', () => count.value++);",
  '  effect(() => { t1.data = String(count.value); });',
  '  effect(() => { t3.data = String(double.value); });',
  '  return button;',
  '}',
].join('\n');

async function run(src: string) {
  const mod = await load(src);
  const el = mod.Counter();
  document.body.append(el);
  const snaps = [el.textContent];
  el.click();
  mod.flushSync();
  snaps.push(el.textContent);
  el.click();
  el.click();
  mod.flushSync();
  snaps.push(el.textContent);
  return { snaps, tag: el.tagName, cls: el.getAttribute('class') };
}

test('identity: the hand-written reference, raw mode and compiled mode all behave the same', async () => {
  const compiled = compileModule(FIXTURE);
  const ref = await run(REFERENCE);
  const raw = await run(FIXTURE);
  const cmp = await run(compiled);
  expect(raw).toEqual(ref);
  expect(cmp).toEqual(ref);
  expect(ref.snaps).toEqual(['c:0|0', 'c:1|2', 'c:3|6']);
});

test('identity: compiled output is ≤ +10% of the hand-written reference (gzip)', () => {
  const compiled = compileModule(FIXTURE);
  const gz = (s: string) => gzipSync(Buffer.from(s), { level: 9 }).length;
  const compiledGz = gz(compiled);
  const referenceGz = gz(REFERENCE);
  const ratio = compiledGz / referenceGz;
  console.log(
    `[identity] compiled: ${compiled.length}B raw / ${compiledGz}B gz · ` +
      `reference: ${REFERENCE.length}B raw / ${referenceGz}B gz · ratio ${ratio.toFixed(3)}`,
  );
  expect(ratio).toBeLessThanOrEqual(1.1);
});

test('identity side-effect: compiled module no longer imports the template parser', () => {
  const compiled = compileModule(FIXTURE);
  expect(compiled).toContain("import { signal, computed } from '@amojs/core';");
  expect(compiled).not.toMatch(/\bhtml\b/);
});
