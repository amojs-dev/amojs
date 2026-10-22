import { test, expect, afterAll } from 'vitest';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { buildDir } from '../src/build.js';

const HERE = import.meta.url.startsWith('file:')
  ? dirname(fileURLToPath(import.meta.url))
  : dirname(import.meta.url);
const TMP = join(HERE, '__tmp__', `build-${randomUUID()}`);

afterAll(() => rm(TMP, { recursive: true, force: true }));

async function write(rel: string, content: string): Promise<void> {
  const file = join(TMP, rel);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, content);
}

test('buildDir compiles amo modules, copies everything else verbatim', async () => {
  await write(
    'proj/src/app.js',
    [
      "import { signal, html } from '@amojs.dev/core';",
      'export const el = html`<p>${signal(1)}</p>`;',
    ].join('\n'),
  );
  await write('proj/src/util.js', 'export const inc = (n) => n + 1;');
  await write('proj/assets/style.css', 'p { color: red }');

  const res = await buildDir(join(TMP, 'proj'), join(TMP, 'dist'));

  expect(res.compiled).toEqual([join('src', 'app.js')]);
  expect(res.copied.sort()).toEqual([join('assets', 'style.css'), join('src', 'util.js')].sort());

  const app = await readFile(join(TMP, 'dist/src/app.js'), 'utf8');
  expect(app).toContain('_$t(');
  expect(app).not.toContain('html`');

  const util = await readFile(join(TMP, 'dist/src/util.js'), 'utf8');
  expect(util).toBe('export const inc = (n) => n + 1;');

  const css = await readFile(join(TMP, 'dist/assets/style.css'), 'utf8');
  expect(css).toBe('p { color: red }');
});

test('src/public/ copies verbatim to the out ROOT and is never compiled', async () => {
  await write('proj-pub/src/app.js', 'export const a = 1;');
  await write('proj-pub/public/favicon.svg', '<svg/>');
  await write('proj-pub/public/fonts/x.woff2', 'binaryish');
  // a module inside public/ is a root asset, not build input — verbatim, ts and all
  await write('proj-pub/public/sw.js', 'const keep: any = 1; // not stripped, not compiled');

  const res = await buildDir(join(TMP, 'proj-pub'), join(TMP, 'dist-pub'));

  expect(res.copied).toContain('favicon.svg');
  expect(res.copied).toContain(join('fonts', 'x.woff2'));
  const svg = await readFile(join(TMP, 'dist-pub/favicon.svg'), 'utf8');
  expect(svg).toBe('<svg/>');
  const sw = await readFile(join(TMP, 'dist-pub/sw.js'), 'utf8');
  expect(sw).toContain('const keep: any = 1;'); // untouched
  // it does NOT also appear under public/
  await expect(readFile(join(TMP, 'dist-pub/public/favicon.svg'), 'utf8')).rejects.toThrow();
});

const APP_ISLAND = [
  "import { signal, html } from '@amojs.dev/core';",
  'export const el = html`<b>${signal(1)}</b>`;',
].join('\n');

test('buildDir exclude skips a src-relative directory entirely', async () => {
  await write(
    'proj-ex/pages/index.js',
    [
      "import { html } from '@amojs.dev/core';",
      'export default () => html`<p>hi</p>`;',
    ].join('\n'),
  );
  await write('proj-ex/islands/counter.js', APP_ISLAND);
  await write('proj-ex/deep/islands/nested.js', APP_ISLAND); // same name, not src-relative

  const res = await buildDir(join(TMP, 'proj-ex'), join(TMP, 'dist-ex'), {
    target: 'server',
    exclude: ['islands'],
  });

  const rels = [...res.compiled, ...res.copied];
  expect(rels).not.toContain(join('islands', 'counter.js'));
  expect(rels).toContain(join('deep', 'islands', 'nested.js')); // only the root islands/ is excluded
  await expect(readFile(join(TMP, 'dist-ex/islands/counter.js'), 'utf8')).rejects.toThrow();
});

test('buildDir: a template error names the source file', async () => {
  await write(
    'proj-bad/pages/broken.js',
    [
      "import { html } from '@amojs.dev/core';",
      'export default () => html`<div><p>x</p>`;',
    ].join('\n'),
  );

  await expect(buildDir(join(TMP, 'proj-bad'), join(TMP, 'dist-bad'))).rejects.toThrow(
    `${join('pages', 'broken.js')}: amo compiler: unclosed <div>`,
  );
});

test('buildDir writes a .map beside every compiled module — sources relative to the map, the .ts the user wrote embedded', async () => {
  const ts = [
    "import { signal, html } from '@amojs.dev/core';",
    'const n: number = 1;',
    'export const el = html`<p>${signal(n)}</p>`;',
  ].join('\n');
  await write('proj-map/src/app.ts', ts);
  await write('proj-map/src/plain.js', 'export const x = 1;'); // no template → no map

  await buildDir(join(TMP, 'proj-map'), join(TMP, 'dist-map'));

  const app = await readFile(join(TMP, 'dist-map/src/app.js'), 'utf8');
  expect(app.trimEnd().endsWith('//# sourceMappingURL=app.js.map')).toBe(true);
  const map = JSON.parse(await readFile(join(TMP, 'dist-map/src/app.js.map'), 'utf8'));
  expect(map.version).toBe(3);
  expect(map.sources).toEqual(['../../proj-map/src/app.ts']);
  expect(map.sourcesContent).toEqual([ts]); // the original, types and all
  expect(map.mappings.length).toBeGreaterThan(0);
  await expect(readFile(join(TMP, 'dist-map/src/plain.js.map'), 'utf8')).rejects.toThrow();
  const plain = await readFile(join(TMP, 'dist-map/src/plain.js'), 'utf8');
  expect(plain).toBe('export const x = 1;');

  // sourcemap: false — what eject passes — writes neither the file nor the comment
  await buildDir(join(TMP, 'proj-map'), join(TMP, 'dist-nomap'), { sourcemap: false });
  const bare = await readFile(join(TMP, 'dist-nomap/src/app.js'), 'utf8');
  expect(bare).not.toContain('sourceMappingURL');
  await expect(readFile(join(TMP, 'dist-nomap/src/app.js.map'), 'utf8')).rejects.toThrow();
});
