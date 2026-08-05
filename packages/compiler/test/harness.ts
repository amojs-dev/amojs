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
const TMP = join(HERE, '__tmp__');
const CORE_REL = relative(TMP, join(HERE, '../../core/src/index.js'))
  .split('\\')
  .join('/');
const HELPERS_REL = relative(TMP, join(HERE, '../../core/src/compiled.js'))
  .split('\\')
  .join('/');

function resolveSpecifiers(src: string): string {
  return src
    .replaceAll('"@amojs/core/compiled"', `"${HELPERS_REL}"`)
    .replaceAll("'@amojs/core/compiled'", `'${HELPERS_REL}'`)
    .replaceAll('"@amojs/core"', `"${CORE_REL}"`)
    .replaceAll("'@amojs/core'", `'${CORE_REL}'`);
}

export async function load(src: string): Promise<Record<string, any>> {
  await mkdir(TMP, { recursive: true });
  const file = join(TMP, `fixture-${randomUUID()}.mjs`);
  await writeFile(file, resolveSpecifiers(src));
  return import(/* @vite-ignore */ file);
}

export function cleanupFixtures(): Promise<void> {
  return rm(TMP, { recursive: true, force: true });
}
