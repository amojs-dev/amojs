/**
 * THE DEVTOOLS SIZE GATE — a development tool, so not budgeted like core;
 * gated anyway so its weight is a number someone chose, not an accident.
 */
import { test, expect } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';

const HERE = import.meta.url.startsWith('file:')
  ? dirname(fileURLToPath(import.meta.url))
  : dirname(import.meta.url);

test('devtools bundles to ≤ 1920 B min+gz, importing nothing', async () => {
  const r = await build({
    entryPoints: [join(HERE, '../src/index.js')],
    bundle: true,
    minify: true,
    format: 'esm',
    write: false,
    metafile: true,
  });
  // nothing external, not even core: every byte bundled is this package's own
  expect(Object.keys(r.metafile.inputs).every((f) => f.includes('devtools/src/'))).toBe(true);
  const bytes = gzipSync(Buffer.from(r.outputFiles[0].contents), { level: 9 }).length;
  console.log(`[size] devtools, bundled: ${bytes} B min+gz (budget 1920)`);
  expect(bytes).toBeLessThanOrEqual(1920);
});
