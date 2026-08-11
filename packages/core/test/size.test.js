/**
 * THE SIZE BUDGETS — enforced in CI forever.
 *
 * Four lids on the library. (The headline number — the ≤2KB ALL-IN cost of a
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
 *
 * Both shapes also ship as a prebuilt single file (`dist/`, see
 * scripts/bundle.mjs) for consumers who want one request instead of seven;
 * those two artifacts are gated at the bottom.
 */
import { test, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { transform } from 'esbuild';
import { buildBundles } from '../scripts/bundle.mjs';

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

/**
 * The SHIPPED bundles (dist/) — the one-request twins of the raw entries.
 * These gate the exact bytes a consumer downloads, because the test builds
 * them with the same function `pnpm build` does.
 */
/** @type {Record<string, number>} */
const BUNDLE_BUDGET = { 'browser.js': 3456, 'browser-runtime.js': 2560 };

test('the shipped browser bundles are within budget', async () => {
  const bundles = await buildBundles();
  expect(bundles.map((b) => b.file).sort()).toEqual(Object.keys(BUNDLE_BUDGET).sort());

  for (const { file, code } of bundles) {
    const bytes = gz(code);
    console.log(`[size] dist/${file}: ${bytes} B min+gz (budget ${BUNDLE_BUDGET[file]})`);
    expect(bytes, file).toBeLessThanOrEqual(BUNDLE_BUDGET[file]);
  }

  // the headline claim, gated: a compiled app never downloads the parser, so
  // the parser-only bundle must not carry html.js — a string literal from it
  // survives minification, which makes this a cheap exact check
  const PARSER_ONLY = 'a hole in an unsupported spot';
  const code = new Map(bundles.map((b) => [b.file, b.code]));
  expect(code.get('browser-runtime.js')).not.toContain(PARSER_ONLY);
  expect(code.get('browser.js')).toContain(PARSER_ONLY);

  // informational: the mixed shape (raw html`` AND compiled templates)
  const union = await perFileSum([...new Set([...NO_BUILD, ...COMPILED])]);
  console.log(`[size] mixed shape, every file (not gated): ${union} B min+gz`);
});
