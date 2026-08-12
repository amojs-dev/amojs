/**
 * TypeScript input — buildDir strips types with node's own
 * stripTypeScriptTypes and emits .js, so a TS project needs no toolchain of
 * its own. Erasable syntax only: anything with runtime meaning is a loud
 * build error, never a silent transform.
 */
import { test, expect, afterAll } from 'vitest';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { buildDir } from '../src/build.js';
import { ssgDir } from '../src/ssg.js';

const HERE = import.meta.url.startsWith('file:')
  ? dirname(fileURLToPath(import.meta.url))
  : dirname(import.meta.url);
const TMP = join(HERE, '__tmp__', `ts-build-${randomUUID()}`);

afterAll(() => rm(TMP, { recursive: true, force: true }));

async function write(rel: string, content: string): Promise<void> {
  const file = join(TMP, rel);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, content);
}

test('buildDir strips types from a .ts amo module and emits .js', async () => {
  await write(
    'proj/src/app.ts',
    [
      "import { signal, html } from '@amojs.dev/core';",
      "import { label, type Label } from './util.js';",
      'const n = signal<number>(1);',
      'export const el: unknown = html`<p>${n} ${label}</p>`;',
    ].join('\n'),
  );
  await write(
    'proj/src/util.ts',
    [
      "export type Label = string;",
      "export const label: Label = 'x';",
    ].join('\n'),
  );
  await write('proj/src/types.d.ts', 'declare const x: number;');

  const res = await buildDir(join(TMP, 'proj'), join(TMP, 'dist'));

  // emitted names are .js; the .d.ts never reaches dist. A stripped module
  // changed, so it reports as compiled even when it owns no templates.
  expect(res.compiled.sort()).toEqual([join('src', 'app.js'), join('src', 'util.js')].sort());
  expect(res.copied).toEqual([]);
  await expect(readFile(join(TMP, 'dist/src/types.d.ts'), 'utf8')).rejects.toThrow();

  const app = await readFile(join(TMP, 'dist/src/app.js'), 'utf8');
  expect(app).toContain('_$t(');
  expect(app).not.toContain('html`');
  expect(app).not.toContain('<number>');
  expect(app).not.toContain(': unknown');
  expect(app).not.toContain('type Label'); // the type-only piece of the import is erased

  const util = await readFile(join(TMP, 'dist/src/util.js'), 'utf8');
  expect(util).not.toContain('type Label'); // no type alias survives
  expect(util).toContain("'x'");

  // the emitted module actually runs
  const mod = (await import(`file://${join(TMP, 'dist/src/util.js')}`)) as { label: string };
  expect(mod.label).toBe('x');
});

test('a .mts module emits .mjs', async () => {
  await write('proj-mts/src/m.mts', 'export const n: number = 7;');
  const res = await buildDir(join(TMP, 'proj-mts'), join(TMP, 'dist-mts'));
  expect(res.compiled).toEqual([join('src', 'm.mjs')]);
  const m = await readFile(join(TMP, 'dist-mts/src/m.mjs'), 'utf8');
  expect(m).not.toContain(': number');
});

test('importing a .ts path is an error naming the emitted path', async () => {
  await write('proj-spec/src/a.ts', "import { x } from './b.ts';\nexport const y = x;");
  await write('proj-spec/src/b.ts', 'export const x = 1;');
  await expect(buildDir(join(TMP, 'proj-spec'), join(TMP, 'dist-spec'))).rejects.toThrow(
    /imports "\.\/b\.ts".*"\.\/b\.js"/,
  );
});

test('syntax with runtime meaning (enum) is a loud build error', async () => {
  await write('proj-enum/src/e.ts', 'export enum Color { Red, Blue }');
  await expect(buildDir(join(TMP, 'proj-enum'), join(TMP, 'dist-enum'))).rejects.toThrow(
    /e\.ts/,
  );
});

test('ssg renders a TypeScript page and never copies .ts as an asset', async () => {
  await write(
    'proj-ssg/src/pages/index.ts',
    [
      "import { html } from '@amojs.dev/core';",
      'interface Props { name?: string }',
      'export default (p: Props) =>',
      '  html`<html lang="en"><head><title>t</title></head><body><p>hi</p></body></html>`;',
    ].join('\n'),
  );
  await write('proj-ssg/src/styles/site.css', 'p { color: teal }');

  const res = await ssgDir(join(TMP, 'proj-ssg/src'), join(TMP, 'dist-ssg'));

  expect(res.pages).toEqual([{ src: join('pages', 'index.js'), out: 'index.html' }]);
  expect(res.assets).toEqual([join('styles', 'site.css')]); // no .ts in the asset list
  const page = await readFile(join(TMP, 'dist-ssg/index.html'), 'utf8');
  expect(page).toContain('<p>hi</p>');
  await expect(readFile(join(TMP, 'dist-ssg/pages/index.ts'), 'utf8')).rejects.toThrow();
});
