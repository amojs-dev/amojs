/**
 * THE SIZE BUDGETS — enforced in CI forever.
 *
 * Three lids on the library. (The headline number — the ≤2KB ALL-IN cost of a
 * real compiled app, the metric frameworks actually quote — lives with the
 * identity benchmark in @amojs.dev/compiler, which can compile fixtures.)
 *
 * The per-file gates below measure what a browser actually FETCHES with no
 * bundler: every file min+gzipped on its own and summed. There are exactly
 * two real shipping shapes, and they are mutually exclusive by construction:
 *   A. a no-build app loads index.js → html.js (the parser), never compiled.js
 *   B. a compiled app loads runtime.js + compiled.js, never html.js
 * A module that keeps some raw html`` AND has compiled templates loads the
 * union of both; that is a legitimate but unusual shape, so it is logged
 * rather than gated.
 */
import { test, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build, transform } from 'esbuild';

const HERE = import.meta.url.startsWith('file:')
  ? dirname(fileURLToPath(import.meta.url))
  : dirname(import.meta.url);
const SRC = join(HERE, '../src');

/** @param {Uint8Array | string} code */
const gz = (code) => gzipSync(Buffer.from(code), { level: 9 }).length;

/** every file both shapes need */
const SHARED = ['signal.js', 'bind.js', 'list.js', 'each.js', 'mount.js'];
const NO_BUILD = [...SHARED, 'html.js', 'index.js'];
const COMPILED = [...SHARED, 'compiled.js', 'runtime.js'];

/** @param {string[]} files */
async function perFileSum(files) {
  let total = 0;
  for (const f of files) {
    const { code } = await transform(await readFile(join(SRC, f), 'utf8'), { minify: true });
    total += gz(code);
  }
  return total;
}

test('shape A — a no-build app (raw ESM, parser included) is ≤ 4KB min+gz', async () => {
  const bytes = await perFileSum(NO_BUILD);
  console.log(`[size] shape A, no-build app: ${bytes} B min+gz (budget 4096)`);
  expect(bytes).toBeLessThanOrEqual(4096);
});

test('shape B — a compiled app (no parser) is ≤ 3.25KB min+gz', async () => {
  const bytes = await perFileSum(COMPILED);
  console.log(`[size] shape B, compiled app: ${bytes} B min+gz (budget 3328)`);
  expect(bytes).toBeLessThanOrEqual(3328);
});

test('the whole framework minus the parser bundles to ≤ 2.5KB min+gz', async () => {
  const r = await build({
    stdin: {
      contents: `export * from './runtime.js'; export * from './compiled.js';`,
      resolveDir: SRC,
      loader: 'js',
    },
    bundle: true,
    minify: true,
    format: 'esm',
    write: false,
  });
  const bytes = gz(r.outputFiles[0].contents);
  console.log(`[size] framework minus parser, bundled: ${bytes} B min+gz (budget 2560)`);
  expect(bytes).toBeLessThanOrEqual(2560);

  // informational: the mixed shape (raw html`` AND compiled templates)
  const union = await perFileSum([...new Set([...NO_BUILD, ...COMPILED])]);
  console.log(`[size] mixed shape, every file (not gated): ${union} B min+gz`);
});
