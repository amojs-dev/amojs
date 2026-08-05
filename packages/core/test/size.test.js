/**
 * THE SIZE BUDGET — a v0.6 PASS criterion, enforced in CI forever.
 *
 * Two lids on the library itself (the third gate — the ≤2KB all-in cost of
 * a real compiled app, the number frameworks actually quote — lives with
 * the identity benchmark in @amojs/compiler, which can compile fixtures):
 *   1. BUNDLED framework, parser excluded: everything reachable from
 *      '@amojs/core/runtime' + '@amojs/core/compiled'. Budget: ≤ 2.5KB.
 *   2. RAW ESM (what a no-build user's browser actually fetches): every
 *      runtime file minified+gzipped individually and summed, INCLUDING the
 *      template parser. Budget: ≤ 4KB.
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
});

test('raw-ESM full runtime (per-file sum, parser included) is ≤ 4KB min+gz', async () => {
  const files = [
    'signal.js', 'bind.js', 'list.js', 'each.js', 'mount.js',
    'compiled.js', 'runtime.js', 'index.js', 'html.js',
  ];
  let total = 0;
  for (const f of files) {
    const src = await readFile(join(SRC, f), 'utf8');
    const { code } = await transform(src, { minify: true });
    total += gz(code);
  }
  console.log(`[size] full runtime per-file sum: ${total} B min+gz (budget 4096)`);
  expect(total).toBeLessThanOrEqual(4096);
});
