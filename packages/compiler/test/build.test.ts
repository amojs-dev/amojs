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
      "import { signal, html } from 'amojs';",
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
