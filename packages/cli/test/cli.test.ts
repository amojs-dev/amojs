/**
 * THE CLI E2E TEST — the shipped binary, end to end.
 *
 * Not a unit test of argument parsing: it builds the REAL artifacts
 * (tsc → dist for compiler + cli) and then spawns `node dist/main.js`
 * against a fixture project — exactly what a user runs. The heavy
 * behavioral coverage lives in build.test.ts / eject.test.ts; this file
 * proves the shipped binary wires it all together.
 */
import { test, expect, beforeAll, afterAll } from 'vitest';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
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
  // build the real thing, dependency order: compiler first, then cli — plus
  // core's browser bundles, which the islands vendor step hands over
  await run(process.execPath, [TSC, '-p', join(ROOT, 'packages/compiler/tsconfig.build.json')]);
  await run(process.execPath, [TSC, '-p', join(ROOT, 'packages/cli/tsconfig.build.json')]);
  await run(process.execPath, [join(ROOT, 'packages/core/scripts/bundle.mjs')]);
}, 120_000);

async function write(rel: string, content: string): Promise<void> {
  const file = join(TMP, rel);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, content);
}

const APP = [
  "import { signal, html } from '@amojs.dev/core';",
  'export const el = html`<p>${signal(1)}</p>`;',
].join('\n');

test('amo build <mode> <src> <out>: csr compiles the fixture project', async () => {
  await write('proj/src/app.js', APP);
  await write('proj/src/util.js', 'export const inc = (n) => n + 1;');
  await write('proj/assets/style.css', 'p { color: red }');

  const { stdout } = await run(process.execPath, [
    AMO, 'build', 'csr', join(TMP, 'proj'), join(TMP, 'dist-build'),
  ]);
  expect(stdout).toContain('amo build — 1 compiled, 2 copied');
  expect(stdout).not.toContain('islands'); // csr has no islands pass

  const app = await readFile(join(TMP, 'dist-build/src/app.js'), 'utf8');
  expect(app).toContain('_$t(');
  expect(app).not.toContain('html`');
  const css = await readFile(join(TMP, 'dist-build/assets/style.css'), 'utf8');
  expect(css).toBe('p { color: red }');
});

test('amo build: bare invocation defaults to csr, src/ → dist/', async () => {
  await write('proj-default/src/app.js', APP);

  const { stdout } = await run(process.execPath, [AMO, 'build'], {
    cwd: join(TMP, 'proj-default'),
  });
  expect(stdout).toContain('amo build — 1 compiled, 0 copied → dist');

  const app = await readFile(join(TMP, 'proj-default/dist/app.js'), 'utf8');
  expect(app).toContain('_$t(');
});

test('amo build ssr: server target plus an automatic islands pass', async () => {
  await write(
    'proj-ssr/src/pages/product.js',
    [
      "import { html } from '@amojs.dev/core';",
      'export default ({ name }) => html`<h1>${name}</h1>`;',
    ].join('\n'),
  );
  await write(
    'proj-ssr/src/islands/counter.js',
    [
      "import { signal, html, mount } from '@amojs.dev/core';",
      'const n = signal(0);',
      "mount(() => html`<button onclick=${() => n.value++}>${n}</button>`, document.body);",
    ].join('\n'),
  );

  const { stdout } = await run(process.execPath, [
    AMO, 'build', 'ssr', join(TMP, 'proj-ssr/src'), join(TMP, 'dist-ssr'),
  ]);
  expect(stdout).toContain('amo build ssr — 1 compiled');
  expect(stdout).toContain('islands — 1 compiled, 0 copied →');

  // the page is server code: strings, not DOM walks
  const page = await readFile(join(TMP, 'dist-ssr/pages/product.js'), 'utf8');
  expect(page).not.toContain('_$t(');
  expect(page).toContain('_$c(name)');
  // the island is DOM code, NOT server-compiled by the tree pass
  const island = await readFile(join(TMP, 'dist-ssr/islands/counter.js'), 'utf8');
  expect(island).toContain('_$t(');
  expect(island).not.toContain('_$c(');

  // import the page and render twice, the way an http handler does
  const mod = (await import(
    pathToFileURL(join(TMP, 'dist-ssr/pages/product.js')).href
  )) as { default: (p: { name: string }) => { __amoHtml: string } };
  expect(String(mod.default({ name: 'Laptop' }))).toBe('<h1>Laptop</h1>');
  expect(String(mod.default({ name: '<script>' }))).toBe('<h1>&lt;script></h1>');
});

test('amo build ssr: no islands dir is skipped out loud, not an error', async () => {
  await write(
    'proj-ssr2/src/pages/index.js',
    [
      "import { html } from '@amojs.dev/core';",
      'export default () => html`<p>hi</p>`;',
    ].join('\n'),
  );

  const { stdout } = await run(process.execPath, [
    AMO, 'build', 'ssr', join(TMP, 'proj-ssr2/src'), join(TMP, 'dist-ssr2'),
  ]);
  expect(stdout).toContain('amo build ssr — 1 compiled');
  expect(stdout).toContain('islands — none');
});

test('amo build ssg: renders pages to static html, islands pass included', async () => {
  await write(
    'proj-ssg/src/pages/index.js',
    [
      "import { html, signal } from '@amojs.dev/core';",
      'const n = signal(2);',
      'export default () => html`<html lang="en"><head><title>t</title></head><body><p>n:${n}</p></body></html>`;',
    ].join('\n'),
  );
  await write(
    'proj-ssg/src/islands/counter.js',
    [
      "import { signal, html, mount } from '@amojs.dev/core';",
      'const n = signal(0);',
      "mount(() => html`<button onclick=${() => n.value++}>${n}</button>`, document.body);",
    ].join('\n'),
  );
  await write('proj-ssg/src/styles/site.css', 'p { color: teal }');
  await write('proj-ssg/src/public/robots.txt', 'User-agent: *');

  const { stdout } = await run(process.execPath, [
    AMO, 'build', 'ssg', join(TMP, 'proj-ssg/src'), join(TMP, 'dist-ssg'),
  ]);
  expect(stdout).toContain('amo build ssg — 1 page rendered, 2 assets copied');
  expect(stdout).toContain('islands — 1 compiled');

  // public/ lands at the OUT ROOT
  expect(await readFile(join(TMP, 'dist-ssg/robots.txt'), 'utf8')).toBe('User-agent: *');

  const page = await readFile(join(TMP, 'dist-ssg/index.html'), 'utf8');
  expect(page.startsWith('<!doctype html>\n<html lang="en">')).toBe(true);
  expect(page).toContain('<p>n:2</p>');
  expect(page).not.toContain('<script'); // no island <script> written → zero script bytes

  const island = await readFile(join(TMP, 'dist-ssg/islands/counter.js'), 'utf8');
  expect(island).toContain('_$t(');
  const css = await readFile(join(TMP, 'dist-ssg/styles/site.css'), 'utf8');
  expect(css).toBe('p { color: teal }');
});

test('amo build --islands: overrides the islands folder name', async () => {
  await write(
    'proj-isl/src/pages/index.js',
    [
      "import { html } from '@amojs.dev/core';",
      'export default () => html`<p>hi</p>`;',
    ].join('\n'),
  );
  await write(
    'proj-isl/src/widgets/w.js',
    [
      "import { html } from '@amojs.dev/core';",
      'export const el = html`<b>${1}</b>`;',
    ].join('\n'),
  );

  const { stdout } = await run(process.execPath, [
    AMO, 'build', 'ssr', join(TMP, 'proj-isl/src'), join(TMP, 'dist-isl'),
    '--islands', 'widgets',
  ]);
  expect(stdout).toContain('islands — 1 compiled');
  const w = await readFile(join(TMP, 'dist-isl/widgets/w.js'), 'utf8');
  expect(w).toContain('_$t(');
});

test('amo build ssg: islands are self-contained — core vendored, imports rewritten', async () => {
  await write(
    'proj-vendor/src/pages/index.js',
    [
      "import { html } from '@amojs.dev/core';",
      'export default () => html`<html lang="en"><head><title>t</title></head><body><p>hi</p><script type="module" src="/islands/counter.js"></script></body></html>`;',
    ].join('\n'),
  );
  await write(
    'proj-vendor/src/islands/counter.js',
    [
      "import { signal, html, mount } from '@amojs.dev/core';",
      'const n = signal(0);',
      "mount(() => html`<button onclick=${() => n.value++}>${n}</button>`, document.body);",
    ].join('\n'),
  );

  const { stdout } = await run(process.execPath, [
    AMO, 'build', 'ssg', join(TMP, 'proj-vendor/src'), join(TMP, 'dist-vendor'),
  ]);
  expect(stdout).toContain('vendor — core →');
  expect(stdout).toContain('no importmap needed');

  // the island reaches core relatively; no bare specifier survives
  const island = await readFile(join(TMP, 'dist-vendor/islands/counter.js'), 'utf8');
  expect(island).not.toContain('@amojs.dev/core');
  expect(island).toContain('../_amo/runtime.js');

  // the vendored file IS core's prebuilt browser-runtime bundle
  const vendored = await readFile(join(TMP, 'dist-vendor/_amo/runtime.js'), 'utf8');
  const bundle = await readFile(
    join(ROOT, 'packages/core/dist/browser-runtime.js'),
    'utf8',
  );
  expect(vendored).toBe(bundle);
});

test('amo build: a TypeScript project compiles with no toolchain of its own', async () => {
  await write(
    'proj-ts/src/app.ts',
    [
      "import { signal, html } from '@amojs.dev/core';",
      'const n = signal<number>(1);',
      'export const el: unknown = html`<p>${n}</p>`;',
    ].join('\n'),
  );

  const { stdout } = await run(process.execPath, [
    AMO, 'build', 'csr', join(TMP, 'proj-ts'), join(TMP, 'dist-ts'),
  ]);
  expect(stdout).toContain('amo build — 1 compiled');

  const app = await readFile(join(TMP, 'dist-ts/src/app.js'), 'utf8');
  expect(app).toContain('_$t(');
  expect(app).not.toContain(': unknown');
  await expect(readFile(join(TMP, 'dist-ts/src/app.ts'), 'utf8')).rejects.toThrow();
});

test('amo dev: builds, serves pretty urls, rebuilds on change', async () => {
  await write(
    'proj-dev/src/pages/index.js',
    [
      "import { html } from '@amojs.dev/core';",
      'export default () => html`<html lang="en"><head><title>t</title></head><body><p>one</p></body></html>`;',
    ].join('\n'),
  );

  const port = 4750 + Math.floor(Math.random() * 200);
  const child = spawn(process.execPath, [
    AMO, 'dev', 'ssg', join(TMP, 'proj-dev/src'), join(TMP, 'dist-dev'), '--port', String(port),
  ]);
  try {
    const page = async () => {
      const res = await fetch(`http://localhost:${port}/`);
      return res.ok ? res.text() : null;
    };
    const until = async (want: string) => {
      for (let i = 0; i < 100; i++) {
        const body = await page().catch(() => null);
        if (body?.includes(want)) return body;
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error(`dev server never served "${want}" on :${port}`);
    };

    await until('<p>one</p>');

    // edit the source; the watcher rebuilds and the same url answers with it
    await write(
      'proj-dev/src/pages/index.js',
      [
        "import { html } from '@amojs.dev/core';",
        'export default () => html`<html lang="en"><head><title>t</title></head><body><p>two</p></body></html>`;',
      ].join('\n'),
    );
    await until('<p>two</p>');
  } finally {
    child.kill();
  }
}, 30_000);

const SSR_PAGE = (word: string) =>
  [
    "import { html } from '@amojs.dev/core';",
    'export default ({ url }) =>',
    `  html\`<html lang="en"><head><title>t</title></head><body><p>${word} \${url ? url.pathname : ''}</p><script type="module" src="/islands/counter.js"></script></body></html>\`;`,
  ].join('\n');

test('amo serve ssr: renders per request, serves islands, hides server code', async () => {
  await write('proj-serve/src/pages/index.js', SSR_PAGE('served'));
  await write('proj-serve/src/pages/about.js', SSR_PAGE('about'));
  await write('proj-serve/src/lib/secret.js', 'export const key = "server-only";');
  await write(
    'proj-serve/src/islands/counter.js',
    [
      "import { signal, html, mount } from '@amojs.dev/core';",
      'const n = signal(0);',
      "mount(() => html`<button onclick=${() => n.value++}>${n}</button>`, document.body);",
    ].join('\n'),
  );
  await run(process.execPath, [
    AMO, 'build', 'ssr', join(TMP, 'proj-serve/src'), join(TMP, 'dist-serve'),
  ]);

  const port = 4960 + Math.floor(Math.random() * 200);
  const child = spawn(process.execPath, [
    AMO, 'serve', 'ssr', join(TMP, 'dist-serve'), '--port', String(port),
  ]);
  try {
    const get = async (path: string) => {
      for (let i = 0; i < 100; i++) {
        try {
          const res = await fetch(`http://localhost:${port}${path}`);
          return { status: res.status, body: await res.text() };
        } catch {
          await new Promise((r) => setTimeout(r, 100));
        }
      }
      throw new Error(`serve never answered on :${port}`);
    };

    // pages render per request, with { url }
    const home = await get('/');
    expect(home.status).toBe(200);
    expect(home.body).toContain('<p>served /</p>');
    const about = await get('/about');
    expect(about.body).toContain('<p>about /about</p>');

    // client js is served; the vendored core too
    expect((await get('/islands/counter.js')).status).toBe(200);
    expect((await get('/_amo/runtime.js')).status).toBe(200);

    // server code is never handed to a browser
    expect((await get('/lib/secret.js')).status).toBe(404);
    expect((await get('/pages/index.js')).status).toBe(404);

    expect((await get('/nope')).status).toBe(404);
  } finally {
    child.kill();
  }
}, 30_000);

test('amo dev ssr: renders per request and re-imports pages after a rebuild', async () => {
  await write('proj-devssr/src/pages/index.js', SSR_PAGE('one'));
  await write(
    'proj-devssr/src/islands/counter.js',
    [
      "import { html, mount } from '@amojs.dev/core';",
      'mount(() => html`<b>i</b>`, document.body);',
    ].join('\n'),
  );

  const port = 5170 + Math.floor(Math.random() * 200);
  const child = spawn(process.execPath, [
    AMO, 'dev', 'ssr', join(TMP, 'proj-devssr/src'), join(TMP, 'dist-devssr'), '--port', String(port),
  ]);
  try {
    const until = async (want: string) => {
      for (let i = 0; i < 100; i++) {
        try {
          const res = await fetch(`http://localhost:${port}/`);
          const body = await res.text();
          if (body.includes(want)) return body;
        } catch {
          // server not up yet
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error(`dev ssr never rendered "${want}" on :${port}`);
    };

    await until('<p>one /</p>');
    await write('proj-devssr/src/pages/index.js', SSR_PAGE('two'));
    await until('<p>two /</p>'); // fresh import, not node's cached module
  } finally {
    child.kill();
  }
}, 30_000);

test('amo build: an in-project out dir is emptied first; an outside one is not', async () => {
  await write('proj-clean/src/app.js', APP);
  await write('proj-clean/dist/stale.txt', 'left over from a previous shape');

  // out inside cwd → cleaned: the stale file dies with the rebuild
  await run(process.execPath, [AMO, 'build'], { cwd: join(TMP, 'proj-clean') });
  await expect(readFile(join(TMP, 'proj-clean/dist/stale.txt'), 'utf8')).rejects.toThrow();
  const app = await readFile(join(TMP, 'proj-clean/dist/app.js'), 'utf8');
  expect(app).toContain('_$t(');

  // out outside cwd → never emptied, only written into
  await write('outside-out/keep.txt', 'not the build’s to delete');
  await run(process.execPath, [
    AMO, 'build', 'csr', join(TMP, 'proj-clean/src'), join(TMP, 'outside-out'),
  ], { cwd: join(TMP, 'proj-clean') });
  expect(await readFile(join(TMP, 'outside-out/keep.txt'), 'utf8')).toBe(
    'not the build’s to delete',
  );
});

test('amo eject: output through the real binary has zero bare amojs imports', async () => {
  await write('proj2/src/app.js', APP);

  const { stdout } = await run(process.execPath, [
    AMO, 'eject', join(TMP, 'proj2'), join(TMP, 'dist-eject'),
  ]);
  expect(stdout).toContain('amo eject —');
  expect(stdout).toContain('runtime: amo-runtime/');

  // the ejected index is core's public surface, copied verbatim
  const runtimeIndex = await readFile(join(TMP, 'dist-eject/amo-runtime/index.js'), 'utf8');
  expect(runtimeIndex).toContain("export { html } from './html.js';");
  expect(stdout).toContain('runtime taken from ');

  const app = await readFile(join(TMP, 'dist-eject/src/app.js'), 'utf8');
  expect(app).not.toMatch(/from\s+['"]amojs/);
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

test('amo: the removed forms fail with pointed messages', async () => {
  await write('proj-old/src/app.js', APP);

  // amo ssg <src> <out> — moved under build
  const ssg = await run(process.execPath, [
    AMO, 'ssg', join(TMP, 'proj-old/src'), join(TMP, 'dist-old'),
  ]).then(() => null, (e: Error & { stderr?: string }) => e);
  expect(ssg?.stderr).toContain('use: amo build ssg');

  // --target — replaced by modes
  const target = await run(process.execPath, [
    AMO, 'build', join(TMP, 'proj-old/src'), join(TMP, 'dist-old'), '--target', 'server',
  ]).then(() => null, (e: Error & { stderr?: string }) => e);
  expect(target?.stderr).toContain('use a mode instead');

  // amo build <src> <out> — the modeless two-positional form
  const modeless = await run(process.execPath, [
    AMO, 'build', join(TMP, 'proj-old/src'), join(TMP, 'dist-old'),
  ]).then(() => null, (e: Error & { stderr?: string }) => e);
  expect(modeless?.stderr).toContain('is not a mode');

  // flags on modes they cannot mean anything for
  const pages = await run(process.execPath, [
    AMO, 'build', 'ssr', join(TMP, 'proj-old/src'), join(TMP, 'dist-old'), '--pages', 'p',
  ]).then(() => null, (e: Error & { stderr?: string }) => e);
  expect(pages?.stderr).toContain('--pages only applies to build ssg');
});

test('amo build: missing default src/ names the convention', async () => {
  await mkdir(join(TMP, 'empty'), { recursive: true });
  const err = await run(process.execPath, [AMO, 'build'], { cwd: join(TMP, 'empty') }).then(
    () => null,
    (e: Error & { stderr?: string }) => e,
  );
  expect(err?.stderr).toContain('no src/ directory here');
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
