// @vitest-environment happy-dom
/**
 * THE EJECT TEST — the v0.4 PASS criterion.
 *
 * A project is ejected and then EXECUTED: the output contains zero bare
 * 'amojs' imports, so module resolution never touches node_modules —
 * deleting amo can change nothing. The framework you can uninstall,
 * asserted by running the uninstalled result.
 */
import { test, expect, afterAll } from 'vitest';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { ejectDir, RUNTIME_FILES } from '../src/eject.js';

const HERE = import.meta.url.startsWith('file:')
  ? dirname(fileURLToPath(import.meta.url))
  : dirname(import.meta.url);
const TMP = join(HERE, '__tmp__', `eject-${randomUUID()}`);

afterAll(() => rm(TMP, { recursive: true, force: true }));

async function write(rel: string, content: string): Promise<void> {
  const file = join(TMP, rel);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, content);
}

const APP = [
  "import { signal, html, each, mount } from 'amojs';",
  "import { inc } from './util.js';",
  "export { flushSync } from 'amojs';",
  'export function App() {',
  '  const count = signal(0);',
  '  const items = signal([1, 2]);',
  '  const el = html`<div><button onclick=${() => (count.value = inc(count.value))}>c:${count}</button><ul>${each(items, (k) => k, (k) => html`<li>${String(k)}</li>`)}</ul></div>`;',
  '  return { el, push: () => (items.value = [...items.value, items.value.length + 1]) };',
  '}',
  'export { mount };',
].join('\n');

test('eject: output has zero amojs imports and RUNS without the package', async () => {
  await write('proj/src/app.js', APP);
  await write('proj/src/util.js', 'export const inc = (n) => n + 1;');

  const res = await ejectDir(join(TMP, 'proj'), join(TMP, 'dist'));

  // the runtime was handed over
  expect(res.runtime).toContain(join('amo-runtime', 'index.js'));
  expect(res.runtime).toContain(join('amo-runtime', 'signal.js'));

  // no emitted js anywhere IMPORTS from amojs (comments may mention it)
  const files: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else files.push(p);
    }
  };
  await walk(join(TMP, 'dist'));
  for (const f of files) {
    if (!['.js', '.mjs'].includes(extname(f))) continue;
    const src = await readFile(f, 'utf8');
    expect(src).not.toMatch(/from\s+['"]amojs/);
    expect(src).not.toMatch(/import\s*\(\s*['"]amojs/);
  }

  // specifiers point at the local runtime (parser-free entry for compiled code)
  const app = await readFile(join(TMP, 'dist/src/app.js'), 'utf8');
  expect(app).toContain("'../amo-runtime/runtime.js'");
  expect(app).toContain('"../amo-runtime/compiled.js"');

  // and the ejected app actually runs — the ultimate uninstall proof
  const mod = await import(/* @vite-ignore */ join(TMP, 'dist/src/app.js'));
  const { el, push } = mod.App();
  document.body.append(el);
  const btn = el.querySelector('button');
  btn.click();
  btn.click();
  mod.flushSync();
  expect(btn.textContent).toBe('c:2');
  push();
  mod.flushSync();
  expect([...el.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['1', '2', '3']);
});

test('eject hands over the PROJECT\'s installed amojs, not the compiler\'s', async () => {
  // the npm scenario: a project with its own node_modules/amojs. Its
  // copy must win, so the ejected runtime is the version the code was
  // written against. Marker content proves WHICH copy was handed over.
  await write('npmproj/src/app.js', "import { signal } from 'amojs';\nexport const s = signal(1);");
  await write(
    'npmproj/node_modules/amojs/package.json',
    JSON.stringify({
      name: 'amojs',
      version: '9.9.9-fake',
      type: 'module',
      exports: {
        '.': './src/index.js',
        './runtime': './src/runtime.js',
        './compiled': './src/compiled.js',
      },
    }),
  );
  for (const f of RUNTIME_FILES) {
    await write(`npmproj/node_modules/amojs/src/${f}`, `/* installed copy: ${f} */\n`);
  }

  const res = await ejectDir(join(TMP, 'npmproj'), join(TMP, 'dist-npm'));

  expect(res.runtimeFrom).toBe(join(TMP, 'npmproj/node_modules/amojs/src'));
  const signalJs = await readFile(join(TMP, 'dist-npm/amo-runtime/signal.js'), 'utf8');
  expect(signalJs).toContain('installed copy: signal.js');
});

test('eject fails loudly when a runtime file is missing', async () => {
  await write('brokenproj/src/app.js', 'export const n = 1;');
  await write(
    'brokenproj/node_modules/amojs/package.json',
    JSON.stringify({ name: 'amojs', version: '0.0.0', type: 'module', exports: { '.': './src/index.js' } }),
  );
  await write('brokenproj/node_modules/amojs/src/index.js', '// only this one exists\n');

  await expect(
    ejectDir(join(TMP, 'brokenproj'), join(TMP, 'dist-broken')),
  ).rejects.toThrow(/cannot read the runtime file .*signal\.js/);
});

test('RUNTIME_FILES covers every file amojs ships (drift guard)', async () => {
  const coreSrc = join(HERE, '../../core/src');
  const shipped = (await readdir(coreSrc)).filter((f) => extname(f) === '.js');
  expect([...RUNTIME_FILES].sort()).toEqual(shipped.sort());
});
