/**
 * The plugin, tested through a REAL `vite build` — the only way to prove the
 * claim it exists for: bundling and tree-shaking are Vite's, and they work.
 *
 * The hook itself is also unit-tested below, with no Vite involved.
 */
import { test, expect, afterAll } from 'vitest';
import { build } from 'vite';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import amo from '../src/index.js';

const HERE = import.meta.url.startsWith('file:')
  ? dirname(fileURLToPath(import.meta.url))
  : dirname(import.meta.url);
const CORE = join(HERE, '../../core/src');
const TMP = join(HERE, '__tmp__', randomUUID());

afterAll(() => rm(join(HERE, '__tmp__'), { recursive: true, force: true }));

/** a workspace has no installed core next to the fixture — point Vite at src */
const ALIAS = [
  { find: '@amojs.dev/core/compiled', replacement: join(CORE, 'compiled.js') },
  { find: '@amojs.dev/core/runtime', replacement: join(CORE, 'runtime.js') },
  { find: '@amojs.dev/core', replacement: join(CORE, 'index.js') },
];

const APP = [
  "import { signal, html, mount } from '@amojs.dev/core';",
  'const App = () => {',
  '  const n = signal(0);',
  '  return html`<button onclick=${() => n.value++}>count: ${n}</button>`;',
  '};',
  "mount(App, document.body);",
].join('\n');

test('a real vite build compiles the templates and tree-shakes what is unused', async () => {
  const dir = join(TMP, 'app');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'main.js'), APP);

  const result = await build({
    root: dir,
    logLevel: 'silent',
    resolve: { alias: ALIAS },
    plugins: [amo()],
    build: {
      write: false,
      minify: true,
      lib: { entry: join(dir, 'main.js'), formats: ['es'], fileName: 'app' },
    },
  });
  const output = (Array.isArray(result) ? result[0] : result) as {
    output: { code: string }[];
  };
  const code = output.output[0].code;

  // the transform ran: the compiled path clones a hoisted template
  expect(code).toContain('cloneNode');
  expect(code).not.toContain('html`');

  // and Vite dropped everything the app never reaches — the parser (html.js)
  // and each()/keyed reconciliation. These are the 600 B raw ESM cannot save.
  expect(code).not.toContain('a hole in an unsupported spot'); // html.js
  expect(code).not.toContain('duplicate key in each()'); // each.js
});

/* ---------------- the hook, with no Vite ---------------- */

/** call the plugin's transform the way rollup does */
function transform(
  plugin: ReturnType<typeof amo>,
  code: string,
  id: string,
): { code: string } | null {
  const hook = plugin.transform as (c: string, i: string) => { code: string } | null;
  return hook(code, id);
}

test('a module with no amo template passes through untouched (returns null)', () => {
  expect(transform(amo(), 'export const a = 1;\n', '/app/util.js')).toBe(null);
});

test('target: server emits string concatenation instead of DOM calls', () => {
  const src = "import { html } from '@amojs.dev/core';\nexport const p = (n) => html`<p>${n}</p>`;";
  const out = transform(amo({ target: 'server' }), src, '/app/page.js');
  expect(out?.code).toContain('_$h(');
  expect(out?.code).not.toContain('cloneNode');
});

test('ids are filtered: node_modules and non-matching extensions are skipped', () => {
  const src = "import { html } from '@amojs.dev/core';\nexport const p = html`<p>a</p>`;";
  expect(transform(amo(), src, '/app/node_modules/dep/index.js')).toBe(null);
  expect(transform(amo(), src, '/app/style.css')).toBe(null);
  // a query suffix must not hide a real module from the filter
  expect(transform(amo(), src, '/app/x.js?worker')).not.toBe(null);
  // TypeScript arrives already stripped by vite:esbuild, so .ts is included
  expect(transform(amo(), src, '/app/x.ts')).not.toBe(null);
});

test('a template error names the file', () => {
  const bad = "import { html } from '@amojs.dev/core';\nexport const p = html`<div><p>x</div>`;";
  expect(() => transform(amo(), bad, '/app/broken.js')).toThrow(/\/app\/broken\.js: /);
});
