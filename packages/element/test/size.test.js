import { test, expect } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';

const HERE = import.meta.url.startsWith('file:')
  ? dirname(fileURLToPath(import.meta.url))
  : dirname(import.meta.url);

test('the element package bundles to ≤ 600 B min+gz (core external)', async () => {
  const r = await build({
    entryPoints: [join(HERE, '../src/index.js')],
    bundle: true,
    minify: true,
    format: 'esm',
    write: false,
    external: ['@amojs.dev/core', '@amojs.dev/core/*'],
  });
  const bytes = gzipSync(Buffer.from(r.outputFiles[0].contents), { level: 9 }).length;
  console.log(`[size] element, bundled (core external): ${bytes} B min+gz (budget 600)`);
  expect(bytes).toBeLessThanOrEqual(600);
});
