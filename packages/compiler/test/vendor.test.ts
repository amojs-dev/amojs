/**
 * vendorCore — a built islands directory becomes self-contained: core's
 * browser bundle is copied under <out>/_amo/ and every island's core import
 * is rewritten to reach it relatively. No importmap, one core url.
 *
 * Resolution is project-first (the npm scenario), so the fixture fakes an
 * installed @amojs.dev/core with an exports map — the same precedent the
 * eject tests use.
 */
import { test, expect, afterAll } from 'vitest';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { vendorCore } from '../src/vendor.js';

const HERE = import.meta.url.startsWith('file:')
  ? dirname(fileURLToPath(import.meta.url))
  : dirname(import.meta.url);
const TMP = join(HERE, '__tmp__', `vendor-${randomUUID()}`);

afterAll(() => rm(TMP, { recursive: true, force: true }));

async function write(rel: string, content: string): Promise<void> {
  const file = join(TMP, rel);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, content);
}

/** a fake installed core: exports map + distinguishable bundle bodies */
async function fakeCore(projRel: string): Promise<void> {
  const pkg = join(projRel, 'node_modules/@amojs.dev/core');
  await write(
    join(pkg, 'package.json'),
    JSON.stringify({
      name: '@amojs.dev/core',
      type: 'module',
      exports: {
        './browser': './dist/browser.js',
        './browser/runtime': './dist/browser-runtime.js',
      },
    }),
  );
  await write(join(pkg, 'dist/browser.js'), '/* full bundle */');
  await write(join(pkg, 'dist/browser-runtime.js'), '/* runtime bundle */');
}

test('vendorCore copies the runtime bundle and rewrites island imports relatively', async () => {
  await fakeCore('proj');
  await write(
    'proj/dist/islands/counter.js',
    "import { tpl } from '@amojs.dev/core/compiled';\nimport { signal } from '@amojs.dev/core/runtime';\n",
  );
  await write(
    'proj/dist/islands/deep/gauge.js',
    'import { signal } from "@amojs.dev/core/runtime";\n',
  );

  const out = join(TMP, 'proj/dist');
  const res = await vendorCore(out, join(out, 'islands'), join(TMP, 'proj'));

  expect(res.vendored).toEqual([join('_amo', 'runtime.js')]);
  expect(res.rewritten.sort()).toEqual(['counter.js', join('deep', 'gauge.js')].sort());

  const counter = await readFile(join(out, 'islands/counter.js'), 'utf8');
  expect(counter).toContain("from '../_amo/runtime.js'");
  expect(counter).not.toContain('@amojs.dev/core');

  // depth-aware prefix, and double-quoted specifiers rewritten too
  const gauge = await readFile(join(out, 'islands/deep/gauge.js'), 'utf8');
  expect(gauge).toContain('from "../../_amo/runtime.js"');

  // project-first: the fake project's own bundle is the one handed over
  const bundle = await readFile(join(out, '_amo/runtime.js'), 'utf8');
  expect(bundle).toBe('/* runtime bundle */');
});

test('a bare core import (raw island) vendors the full bundle, parser included', async () => {
  await fakeCore('proj-raw');
  await write(
    'proj-raw/dist/islands/widget.js',
    "import { signal, html, mount } from '@amojs.dev/core';\n",
  );

  const out = join(TMP, 'proj-raw/dist');
  const res = await vendorCore(out, join(out, 'islands'), join(TMP, 'proj-raw'));

  expect(res.vendored).toEqual([join('_amo', 'core.js')]);
  const widget = await readFile(join(out, 'islands/widget.js'), 'utf8');
  expect(widget).toContain("from '../_amo/core.js'");
  const bundle = await readFile(join(out, '_amo/core.js'), 'utf8');
  expect(bundle).toBe('/* full bundle */');
});

test('islands that never import core vendor nothing — _amo/ does not appear', async () => {
  await fakeCore('proj-none');
  await write('proj-none/dist/islands/theme.js', 'document.title = "x";\n');

  const out = join(TMP, 'proj-none/dist');
  const res = await vendorCore(out, join(out, 'islands'), join(TMP, 'proj-none'));

  expect(res.vendored).toEqual([]);
  expect(res.rewritten).toEqual([]);
  await expect(readFile(join(out, '_amo/runtime.js'), 'utf8')).rejects.toThrow();
});
