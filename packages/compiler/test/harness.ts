/**
 * Shared fixture harness for dual-mode tests.
 *
 * Fixture modules are written inside the project (test/__tmp__, gitignored)
 * so the test runner resolves them like any other module; bare @amojs/core
 * specifiers are rewritten to relative paths first.
 */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

/* vitest may hand import.meta.url over as a bare path — support both */
const HERE = import.meta.url.startsWith('file:')
  ? dirname(fileURLToPath(import.meta.url))
  : dirname(import.meta.url);
/* one subdir PER TEST FILE (fresh module instance per worker): parallel test
   files must never share fixture space — an early afterAll cleanup would
   delete a sibling file's fixture mid-import */
const TMP = join(HERE, '__tmp__', randomUUID());
const CORE_SRC = join(HERE, '../../core/src');

/** rewrite bare @amojs specifiers to paths relative to the fixture's dir */
export function resolveSpecifiers(src: string, fromDir: string): string {
  const rel = (file: string): string =>
    relative(fromDir, join(CORE_SRC, file)).split('\\').join('/');
  const core = rel('index.js');
  const runtime = rel('runtime.js');
  const helpers = rel('compiled.js');
  return src
    .replaceAll('"@amojs/core/compiled"', `"${helpers}"`)
    .replaceAll("'@amojs/core/compiled'", `'${helpers}'`)
    .replaceAll('"@amojs/core/runtime"', `"${runtime}"`)
    .replaceAll("'@amojs/core/runtime'", `'${runtime}'`)
    .replaceAll('"@amojs/core"', `"${core}"`)
    .replaceAll("'@amojs/core'", `'${core}'`);
}

export { TMP };

export async function load(src: string): Promise<Record<string, any>> {
  await mkdir(TMP, { recursive: true });
  const file = join(TMP, `fixture-${randomUUID()}.mjs`);
  await writeFile(file, resolveSpecifiers(src, TMP));
  return import(/* @vite-ignore */ file);
}

/**
 * Multi-module fixture: writes every file into one fresh directory (so
 * relative imports between them work) and imports `entry`.
 */
export async function loadModules(
  files: Record<string, string>,
  entry: string,
): Promise<Record<string, any>> {
  const dir = join(TMP, `proj-${randomUUID()}`);
  await mkdir(dir, { recursive: true });
  for (const [name, src] of Object.entries(files)) {
    await writeFile(join(dir, name), resolveSpecifiers(src, dir));
  }
  return import(/* @vite-ignore */ join(dir, entry));
}

export function cleanupFixtures(): Promise<void> {
  return rm(TMP, { recursive: true, force: true });
}
