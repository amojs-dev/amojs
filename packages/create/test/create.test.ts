/**
 * create-amojs, end to end: build the real bin, scaffold into a temp dir,
 * then run the real `amo build ssg` against the scaffold — a template that
 * does not build is worse than no template.
 */
import { test, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { TEMPLATE_DEPS } from '../src/deps.js';

const run = promisify(execFile);

const HERE = import.meta.url.startsWith('file:')
  ? dirname(fileURLToPath(import.meta.url))
  : dirname(import.meta.url);
const ROOT = join(HERE, '../../..');
const TSC = join(ROOT, 'node_modules/typescript/bin/tsc');
const CREATE = join(HERE, '../dist/main.js');
const AMO = join(ROOT, 'packages/cli/dist/main.js');
const TMP = join(HERE, '__tmp__', `create-${randomUUID()}`);

afterAll(() => rm(TMP, { recursive: true, force: true }));

beforeAll(async () => {
  await run(process.execPath, [TSC, '-p', join(ROOT, 'packages/compiler/tsconfig.build.json')]);
  await run(process.execPath, [TSC, '-p', join(ROOT, 'packages/cli/tsconfig.build.json')]);
  await run(process.execPath, [TSC, '-p', join(HERE, '../tsconfig.build.json')]);
  await run(process.execPath, [join(ROOT, 'packages/core/scripts/bundle.mjs')]);
  // core's generated types too — the --ts scaffold is type-checked below
  await run(process.execPath, [TSC, '-p', join(ROOT, 'packages/core/tsconfig.build.json')]);
  await mkdir(TMP, { recursive: true });
}, 120_000);

test('scaffolds a JS ssg project (the non-TTY defaults) that the real amo build accepts', async () => {
  const { stdout } = await run(process.execPath, [CREATE, 'my-app'], { cwd: TMP });
  expect(stdout).toContain('created my-app (ssg)');
  expect(stdout).toContain('npm run dev');

  const app = join(TMP, 'my-app');
  const pkg = JSON.parse(await readFile(join(app, 'package.json'), 'utf8'));
  expect(pkg.name).toBe('my-app');
  expect(pkg.scripts).toEqual({
    dev: 'amo dev ssg',
    build: 'amo build ssg',
    serve: 'amo serve ssg',
  });

  // gitignore and vscode/ ship under safe names and land as the real thing
  const ignore = await readFile(join(app, '.gitignore'), 'utf8');
  expect(ignore).toContain('node_modules/');
  const rec = JSON.parse(await readFile(join(app, '.vscode/extensions.json'), 'utf8'));
  expect(rec.recommendations).toEqual(['amojs-dev.amojs']);

  // no infrastructure files, ever — the CLI owns the pipeline
  await expect(readFile(join(app, 'server.mjs'), 'utf8')).rejects.toThrow();

  // the scaffold builds with the real binary — island pass, vendor and all
  const { stdout: built } = await run(
    process.execPath,
    [AMO, 'build', 'ssg', 'src', 'dist'],
    { cwd: app },
  );
  expect(built).toContain('1 page rendered');
  expect(built).toContain('islands — 1 compiled');
  expect(built).toContain('vendor — core →');

  const html = await readFile(join(app, 'dist/index.html'), 'utf8');
  expect(html).toContain('<h1>It runs.</h1>');
  const favicon = await readFile(join(app, 'dist/favicon.svg'), 'utf8'); // public/ → root
  expect(favicon).toContain('<svg');
});

test('--ts scaffolds .ts sources plus one tsconfig, and it still builds', async () => {
  await run(process.execPath, [CREATE, 'my-ts-app', '--ts'], { cwd: TMP });
  const app = join(TMP, 'my-ts-app');

  await readFile(join(app, 'src/pages/index.ts'), 'utf8'); // renamed, exists
  await expect(readFile(join(app, 'src/pages/index.js'), 'utf8')).rejects.toThrow();

  const pkg = JSON.parse(await readFile(join(app, 'package.json'), 'utf8'));
  expect(pkg.scripts.check).toBe('tsc --noEmit');
  expect(pkg.devDependencies.typescript).toBe(TEMPLATE_DEPS.typescript);

  const tsconfig = JSON.parse(await readFile(join(app, 'tsconfig.json'), 'utf8'));
  expect(tsconfig.compilerOptions.erasableSyntaxOnly).toBe(true);

  const { stdout: built } = await run(
    process.execPath,
    [AMO, 'build', 'ssg', 'src', 'dist'],
    { cwd: app },
  );
  expect(built).toContain('1 page rendered');
  const html = await readFile(join(app, 'dist/index.html'), 'utf8');
  expect(html).toContain('<h1>It runs.</h1>');

  // `npm run check` must pass on a fresh scaffold — a starter that fails its
  // own type-check shipped once (getElementById is Element | null) and never
  // again. Core is linked in the way npm install would place it.
  await mkdir(join(app, 'node_modules/@amojs.dev'), { recursive: true });
  await symlink(join(ROOT, 'packages/core'), join(app, 'node_modules/@amojs.dev/core'));
  await run(process.execPath, [TSC, '--noEmit'], { cwd: app });
});

test('--ssr scaffolds the server variant, and amo build ssr accepts it', async () => {
  await run(process.execPath, [CREATE, 'my-ssr', '--ssr'], { cwd: TMP });
  const app = join(TMP, 'my-ssr');

  const pkg = JSON.parse(await readFile(join(app, 'package.json'), 'utf8'));
  expect(pkg.scripts).toEqual({
    dev: 'amo dev ssr',
    build: 'amo build ssr',
    serve: 'amo serve ssr',
  });
  // same files as ssg — no server.mjs, the CLI owns serving
  await expect(readFile(join(app, 'server.mjs'), 'utf8')).rejects.toThrow();

  const { stdout: built } = await run(
    process.execPath,
    [AMO, 'build', 'ssr', 'src', 'dist'],
    { cwd: app },
  );
  expect(built).toContain('amo build ssr');
  expect(built).toContain('islands — 1 compiled');
  expect(built).toContain('vendor — core →');

  // the built page renders on node, the way server.mjs will call it
  const mod = (await import(`file://${join(app, 'dist/pages/index.js')}`)) as {
    default: (p: object) => Promise<{ __amoHtml: string }> | { __amoHtml: string };
  };
  expect(String(await mod.default({}))).toContain('<h1>It runs.</h1>');
});

test('refuses a non-empty directory', async () => {
  await mkdir(join(TMP, 'taken'), { recursive: true });
  await writeFile(join(TMP, 'taken/file.txt'), 'x');
  const err = await run(process.execPath, [CREATE, 'taken'], { cwd: TMP }).then(
    () => null,
    (e: Error & { stderr?: string }) => e,
  );
  expect(err?.stderr).toContain('exists and is not empty');
});

test('no directory argument prints usage and exits 1', async () => {
  const err = await run(process.execPath, [CREATE], { cwd: TMP }).then(
    () => null,
    (e: Error & { code?: number; stderr?: string }) => e,
  );
  expect(err?.code).toBe(1);
  expect(err?.stderr).toContain('Usage:');
});

test('DRIFT GUARD: template dep ranges match the workspace versions', async () => {
  const core = JSON.parse(
    await readFile(join(ROOT, 'packages/core/package.json'), 'utf8'),
  ) as { version: string };
  const cli = JSON.parse(
    await readFile(join(ROOT, 'packages/cli/package.json'), 'utf8'),
  ) as { version: string };
  expect(TEMPLATE_DEPS['@amojs.dev/core']).toBe(`^${core.version}`);
  expect(TEMPLATE_DEPS['@amojs.dev/cli']).toBe(`^${cli.version}`);
});
