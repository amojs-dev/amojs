/**
 * The server target + ssgDir, on plain node — no DOM anywhere.
 *
 * Covers what the parity gate (a happy-dom file) cannot: the compile-time
 * rejections the server target adds, the shape of the emitted module, and
 * the whole pages→html pipeline including the islands promise — a page with
 * no islands ships ZERO script bytes.
 */
import { test, expect, afterAll } from 'vitest';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { compileModule } from '../src/codegen.js';
import { ssgDir } from '../src/ssg.js';
import { TMP, cleanupFixtures } from './harness.js';

afterAll(cleanupFixtures);

/* ---------------- server-target codegen shape ---------------- */

test('server target: no markers, no parser import, preamble present', () => {
  const out = compileModule(
    "import { html } from '@amojs.dev/core';\nexport default () => html`<p>${'x'}</p>`;",
    { target: 'server' },
  );
  expect(out).not.toContain('html`');
  expect(out).not.toContain('<!---->');
  expect(out).not.toContain('@amojs.dev/core/compiled');
  expect(out).toContain('isSignal as _$is');
  expect(out).toContain('@amojs.dev/core/runtime');
  expect(out).toContain('_$h(');
});

test('server target: a module without templates passes through untouched', () => {
  const src = "export const n = 1;\n";
  expect(compileModule(src, { target: 'server' })).toBe(src);
});

test('server target rejects <select value=${…}> and names the cure', () => {
  const src =
    "import { html } from '@amojs.dev/core';\nexport default (v) => html`<select value=${v}><option>a</option></select>`;";
  expect(() => compileModule(src, { target: 'server' })).toThrow(
    /selected=\$\{…\} on the matching <option>/,
  );
  // the DOM target keeps accepting it — this is a server-serialization limit
  expect(() => compileModule(src)).not.toThrow();
});

test('server target rejects indeterminate on <input> and names the cure', () => {
  const src =
    "import { html } from '@amojs.dev/core';\nexport default (v) => html`<input type=checkbox indeterminate=${v}>`;";
  expect(() => compileModule(src, { target: 'server' })).toThrow(
    /set it from an island after mount/,
  );
  expect(() => compileModule(src)).not.toThrow();
});

/* ---------------- ssgDir: pages → static html ---------------- */

async function writeProject(files: Record<string, string>): Promise<string> {
  const root = join(TMP, `ssg-${Math.random().toString(36).slice(2)}`);
  for (const [name, content] of Object.entries(files)) {
    const p = join(root, name);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, content);
  }
  return root;
}

const CARD = `
import { html } from '@amojs.dev/core';
export const Card = (title, body) => html\`<article class="card"><h2>\${title}</h2><p>\${body}</p></article>\`;
`;

const INDEX_PAGE = `
import { html, signal } from '@amojs.dev/core';
import { Card } from '../lib/card.js';
const hits = signal(3);
export default () => html\`<html lang="en"><head><title>amo ssg</title></head><body>
  <h1>hits: \${hits}</h1>
  \${['a', 'b'].map((t) => Card(t, 'body of ' + t))}
  <div id="counter-island"></div>
  <script type="module">import { mountCounter } from '/islands/counter.js'; mountCounter();</script>
</body></html>\`;
`;

const INTRO_PAGE = `
import { html } from '@amojs.dev/core';
export default async () => {
  const data = await Promise.resolve('async data');
  return html\`<html lang="en"><head><title>intro</title></head><body><p>\${data}</p></body></html>\`;
};
`;

test('ssgDir renders pages to .html — doctype, data, islands script, structure', async () => {
  const src = await writeProject({
    'pages/index.js': INDEX_PAGE,
    'pages/guide/intro.js': INTRO_PAGE,
    'lib/card.js': CARD,
  });
  const out = join(src, '..', `out-${Math.random().toString(36).slice(2)}`);
  const r = await ssgDir(src, out);

  expect(r.pages).toEqual([
    { src: join('pages', 'guide', 'intro.js'), out: join('guide', 'intro.html') },
    { src: join('pages', 'index.js'), out: 'index.html' },
  ]);

  const index = await readFile(join(out, 'index.html'), 'utf8');
  expect(index.startsWith('<!doctype html>\n<html lang="en">')).toBe(true);
  expect(index).toContain('hits: 3');
  expect(index).toContain('<article class="card"><h2>a</h2><p>body of a</p></article>');
  expect(index).toContain('<h2>b</h2>');
  // the island script is the AUTHOR's static markup, carried verbatim
  expect(index).toContain("import { mountCounter } from '/islands/counter.js'");

  const intro = await readFile(join(out, 'guide', 'intro.html'), 'utf8');
  expect(intro).toContain('<p>async data</p>'); // async default export awaited

  // zero script bytes unless the author wrote an island: intro has none
  expect(intro).not.toContain('<script');

  // the server-compile temp dir is gone
  const leftovers = (await readdir(out)).filter((f) => f.startsWith('.amo-ssg'));
  expect(leftovers).toEqual([]);
});

test('ssgDir: a page without a default export fails loudly, naming the file', async () => {
  const src = await writeProject({
    'pages/broken.js': "export const x = 1;\n",
  });
  const out = join(src, 'out');
  await expect(ssgDir(src, out)).rejects.toThrow(/pages\/broken\.js needs a default export/);
});

test('ssgDir: a page returning a non-template fails loudly', async () => {
  const src = await writeProject({
    'pages/plain.js': "export default () => '<html></html>';\n",
  });
  const out = join(src, 'out');
  await expect(ssgDir(src, out)).rejects.toThrow(/did not return a template/);
});

test('ssgDir: a missing pages directory fails loudly', async () => {
  const src = await writeProject({ 'lib/x.js': 'export const a = 1;\n' });
  await expect(ssgDir(src, join(src, 'out'))).rejects.toThrow(/no pages directory/);
});
