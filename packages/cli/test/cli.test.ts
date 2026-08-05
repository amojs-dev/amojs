/**
 * THE CLI E2E TEST — v0.4b closed end to end.
 *
 * Not a unit test of argument parsing: it builds the REAL artifacts
 * (tsc → dist for compiler + cli) and then spawns `node dist/main.js`
 * against a fixture project — exactly what a user runs. The heavy
 * behavioral coverage lives in build.test.ts / eject.test.ts; this file
 * proves the shipped binary wires it all together.
 */
import { test, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const run = promisify(execFile);

const HERE = import.meta.url.startsWith('file:')
  ? dirname(fileURLToPath(import.meta.url))
  : dirname(import.meta.url);
const ROOT = join(HERE, '../../..'); // the amojs workspace root
const TSC = join(ROOT, 'node_modules/typescript/bin/tsc');
const AMO = join(HERE, '../dist/main.js');
const TMP = join(HERE, '__tmp__', `cli-${randomUUID()}`);

afterAll(() => rm(TMP, { recursive: true, force: true }));

beforeAll(async () => {
  // build the real thing, dependency order: compiler first, then cli
  await run(process.execPath, [TSC, '-p', join(ROOT, 'packages/compiler/tsconfig.build.json')]);
  await run(process.execPath, [TSC, '-p', join(ROOT, 'packages/cli/tsconfig.build.json')]);
}, 120_000);

async function write(rel: string, content: string): Promise<void> {
  const file = join(TMP, rel);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, content);
}

const APP = [
  "import { signal, html } from '@amojs/core';",
  'export const el = html`<p>${signal(1)}</p>`;',
].join('\n');

test('amo build: compiles the fixture project through the real binary', async () => {
  await write('proj/src/app.js', APP);
  await write('proj/src/util.js', 'export const inc = (n) => n + 1;');
  await write('proj/assets/style.css', 'p { color: red }');

  const { stdout } = await run(process.execPath, [
    AMO, 'build', join(TMP, 'proj'), join(TMP, 'dist-build'),
  ]);
  expect(stdout).toContain('amo build — 1 compiled, 2 copied');

  const app = await readFile(join(TMP, 'dist-build/src/app.js'), 'utf8');
  expect(app).toContain('_$t(');
  expect(app).not.toContain('html`');
  const css = await readFile(join(TMP, 'dist-build/assets/style.css'), 'utf8');
  expect(css).toBe('p { color: red }');
});

test('amo eject: output through the real binary has zero bare @amojs imports', async () => {
  await write('proj2/src/app.js', APP);

  const { stdout } = await run(process.execPath, [
    AMO, 'eject', join(TMP, 'proj2'), join(TMP, 'dist-eject'),
  ]);
  expect(stdout).toContain('amo eject —');
  expect(stdout).toContain('runtime: amo-runtime/');

  const runtimeIndex = await readFile(join(TMP, 'dist-eject/amo-runtime/index.js'), 'utf8');
  expect(runtimeIndex).toContain('ejected copy');

  const app = await readFile(join(TMP, 'dist-eject/src/app.js'), 'utf8');
  expect(app).not.toMatch(/from\s+['"]@amojs/);
  expect(app).toContain('../amo-runtime/');
});

test('amo eject --runtime: custom runtime directory name', async () => {
  await write('proj3/src/app.js', APP);

  await run(process.execPath, [
    AMO, 'eject', join(TMP, 'proj3'), join(TMP, 'dist-rt'), '--runtime', 'vendor',
  ]);
  const app = await readFile(join(TMP, 'dist-rt/src/app.js'), 'utf8');
  expect(app).toContain('../vendor/');
});

test('amo without a valid command exits 1 and prints usage to stderr', async () => {
  const err = await run(process.execPath, [AMO]).then(
    () => null,
    (e: Error & { code?: number; stderr?: string }) => e,
  );
  expect(err?.code).toBe(1);
  expect(err?.stderr).toContain('Usage:');
});

test('amo --version prints the package version', async () => {
  const { stdout } = await run(process.execPath, [AMO, '--version']);
  expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
});
