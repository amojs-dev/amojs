// @vitest-environment happy-dom
/**
 * THE IDENTITY BENCHMARK — the v0.2 PASS criterion and AmoJS's signature:
 * "compiles to the vanilla JS you would have written."
 *
 * A careful human writes the same counter by hand against amojs
 * signals — real createElement / createTextNode / addEventListener, no
 * templates. The compiled module must (a) behave identically to it and
 * (b) cost at most +10% of its bytes (gzip — normalizes naming noise).
 */
import { test, expect, afterAll } from 'vitest';
import { gzipSync } from 'node:zlib';
import { mkdir } from 'node:fs/promises';
import { build } from 'esbuild';
import { compileModule } from '../src/codegen.js';
import { load, cleanupFixtures, resolveSpecifiers, TMP } from './harness.js';

afterAll(cleanupFixtures);

const FIXTURE = [
  "import { signal, computed, html } from 'amojs';",
  "export { flushSync } from 'amojs';",
  'export function Counter() {',
  '  const count = signal(0);',
  '  const double = computed(() => count.value * 2);',
  '  return html`<button class="btn" onclick=${() => count.value++}>c:${count}|${double}</button>`;',
  '}',
].join('\n');

/* the reference: what a disciplined human writes for the same behavior —
   including importing the parser-free entry, exactly like compiled output */
const REFERENCE = [
  "import { signal, computed, effect } from 'amojs/runtime';",
  "export { flushSync } from 'amojs/runtime';",
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

test('the whole compiled counter app — runtime included — bundles to ≤ 2KB min+gz', async () => {
  // THE 2KB PROMISE: not the module alone — the app plus everything it pulls
  // in, bundled/minified/gzipped. This is the number frameworks quote
  // (a Svelte 5 hello-world lands around 4-6KB on the same metric).
  await mkdir(TMP, { recursive: true });
  const compiled = resolveSpecifiers(compileModule(FIXTURE), TMP);
  const r = await build({
    stdin: { contents: compiled, resolveDir: TMP, loader: 'js' },
    bundle: true,
    minify: true,
    format: 'esm',
    write: false,
  });
  const bytes = gzipSync(Buffer.from(r.outputFiles[0].contents), { level: 9 }).length;
  console.log(`[identity] compiled counter app, all-in: ${bytes} B min+gz (budget 2048)`);
  expect(bytes).toBeLessThanOrEqual(2048);
});

test('identity side-effect: compiled module no longer imports the template parser', () => {
  const compiled = compileModule(FIXTURE);
  // parser-free imports point at the /runtime entry — the package root would
  // statically pull html.js in, and raw ESM has no tree-shaking
  expect(compiled).toContain("import { signal, computed } from 'amojs/runtime';");
  expect(compiled).toContain("export { flushSync } from 'amojs/runtime';");
  expect(compiled).not.toMatch(/\bhtml\b/);
});
