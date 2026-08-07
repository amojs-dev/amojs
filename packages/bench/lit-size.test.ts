/**
 * AmoJS vs Lit — shipped bytes for the SAME app.
 *
 * Both sides: one entry module, bundled + minified + gzipped, runtime
 * included. That is the number a user's browser downloads.
 *
 * Fairness:
 * - Lit is used bare (`html` + `render`), its smallest configuration — no
 *   LitElement, no decorators, no custom element, no shadow DOM. Anything
 *   more only adds bytes on Lit's side.
 * - The AmoJS side goes through the real compiler (`compileModule`), which is
 *   how an AmoJS app actually ships.
 * - Neither app is contrived: a card with five dynamic text bindings plus a
 *   keyed list of rows, the shape of a real UI fragment.
 */
import { test, expect } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';
import { compileModule } from '@amojs.dev/compiler';

const HERE = import.meta.url.startsWith('file:')
  ? dirname(fileURLToPath(import.meta.url))
  : dirname(import.meta.url);
const CORE_SRC = join(HERE, '../core/src');
const TMP = join(HERE, '__tmp__', randomUUID());

const gz = (code: Uint8Array | string) => gzipSync(Buffer.from(code), { level: 9 }).length;

/** the same app, written the AmoJS way */
const AMO_APP = [
  "import { signal, html, mount, each } from '@amojs.dev/core';",
  'export function App(target) {',
  '  const title = signal("t");',
  '  const count = signal(0);',
  '  const items = signal([{ id: 1, label: "a" }]);',
  '  const el = html`<div class="card"',
  '    ><h2>${title}</h2',
  '    ><b>${count}</b',
  '    ><button onclick=${() => count.value++}>+</button',
  '    ><ul>${each(items, (it) => it.id, (it) => html`<li>${it.label}</li>`)}</ul',
  '  ></div>`;',
  '  mount(el, target);',
  '  return { title, count, items };',
  '}',
].join('\n');

/** the same app, written the Lit way */
const LIT_APP = [
  "import { html, render } from 'lit';",
  "import { repeat } from 'lit/directives/repeat.js';",
  'export function App(target) {',
  '  const state = { title: "t", count: 0, items: [{ id: 1, label: "a" }] };',
  '  const tpl = () => html`<div class="card"',
  '    ><h2>${state.title}</h2',
  '    ><b>${state.count}</b',
  '    ><button @click=${() => { state.count++; draw(); }}>+</button',
  '    ><ul>${repeat(state.items, (it) => it.id, (it) => html`<li>${it.label}</li>`)}</ul',
  '  ></div>`;',
  '  const draw = () => render(tpl(), target);',
  '  draw();',
  '  return state;',
  '}',
].join('\n');

async function bundleBytes(entry: string, resolveDir: string): Promise<number> {
  const r = await build({
    stdin: { contents: entry, resolveDir, loader: 'js' },
    bundle: true,
    minify: true,
    format: 'esm',
    write: false,
  });
  return gz(r.outputFiles[0].contents);
}

test('shipped bytes: the same app in AmoJS vs Lit', async () => {
  await mkdir(TMP, { recursive: true });
  try {
    // AmoJS: compile for real, then point the specifiers at the local runtime
    const compiled = compileModule(AMO_APP)
      .replaceAll("'@amojs.dev/core/runtime'", `'${join(CORE_SRC, 'runtime.js')}'`)
      .replaceAll('"@amojs.dev/core/compiled"', `"${join(CORE_SRC, 'compiled.js')}"`)
      .replaceAll("'@amojs.dev/core'", `'${join(CORE_SRC, 'index.js')}'`);
    await writeFile(join(TMP, 'amo.js'), compiled);
    const amoBytes = await bundleBytes(`export * from './amo.js';`, TMP);

    // Lit: resolved from the bench package's own node_modules
    const litBytes = await bundleBytes(LIT_APP, HERE);

    const ratio = litBytes / amoBytes;
    console.log(
      `[lit] shipped bytes for the same app (min+gz): amo ${amoBytes} B vs lit ${litBytes} B ` +
        `→ Lit is ${ratio.toFixed(2)}× larger`,
    );
    // the claim, gated: an AmoJS app must stay meaningfully smaller than the
    // same app on Lit. If this ever fails, the size story needs rewriting.
    expect(amoBytes).toBeLessThan(litBytes);
  } finally {
    await rm(TMP, { recursive: true, force: true });
  }
});
