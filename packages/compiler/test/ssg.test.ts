/**
 * The server target + ssgDir, on plain node — no DOM anywhere.
 *
 * Covers what the parity gate (a happy-dom file) cannot: the compile-time
 * rejections the server target adds, the shape of the emitted module, and
 * the whole pages→html pipeline including the islands promise — a page with
 * no islands ships ZERO script bytes.
 */
import { test, expect, afterAll } from 'vitest';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileModule } from '../src/codegen.js';
import { ssgDir } from '../src/ssg.js';
import { TMP, cleanupFixtures, load } from './harness.js';

afterAll(cleanupFixtures);

/* ---------------- server-target codegen shape ---------------- */

test('server target: no markers, no parser import, preamble present', () => {
  const out = compileModule(
    "import { html } from '@amojs.dev/core';\nexport default () => html`<p>${'x'}</p>`;",
    { target: 'server' },
  );
  expect(out).not.toContain('html`');
  expect(out).not.toContain('<!---->');
  expect(out).not.toContain('@amojs.dev/core/compiled');
  expect(out).toContain('isSignal as _$is');
  expect(out).toContain('@amojs.dev/core/runtime');
  expect(out).toContain('_$h(');
});

test('server target: a module without templates passes through untouched', () => {
  const src = "export const n = 1;\n";
  expect(compileModule(src, { target: 'server' })).toBe(src);
});

test('server target rejects <select value=${…}> and names the cure', () => {
  const src =
    "import { html } from '@amojs.dev/core';\nexport default (v) => html`<select value=${v}><option>a</option></select>`;";
  expect(() => compileModule(src, { target: 'server' })).toThrow(
    /selected=\$\{…\} on the matching <option>/,
  );
  // the DOM target keeps accepting it — this is a server-serialization limit
  expect(() => compileModule(src)).not.toThrow();
});

test('server target rejects indeterminate on <input> and names the cure', () => {
  const src =
    "import { html } from '@amojs.dev/core';\nexport default (v) => html`<input type=checkbox indeterminate=${v}>`;";
  expect(() => compileModule(src, { target: 'server' })).toThrow(
    /set it from an island after mount/,
  );
  expect(() => compileModule(src)).not.toThrow();
});

test('a dynamic <title> renders on the server and is rejected by the DOM target', () => {
  const src =
    "import { html } from '@amojs.dev/core';\n" +
    'export default ({ n }) => html`<title>${n} — Shop</title>`;';

  const out = compileModule(src, { target: 'server' });
  expect(out).toContain('<title>'); // static text around the hole survives
  expect(out).toContain(' — Shop</title>');
  expect(out).toContain('_$ta(n)'); // escaped as text, not as an attribute

  // the mirror of the two cases above: here the SERVER accepts and the DOM does not
  expect(() => compileModule(src)).toThrow(/on the client set document\.title/);
});

test('a dynamic <title> escapes, and two holes in one title keep source order', async () => {
  const { t } = await load(
    compileModule(
      "import { html } from '@amojs.dev/core';\n" +
        'export const t = ({ a, b }) => html`<title>${a} | ${b}</title>`;',
      { target: 'server' },
    ),
  );
  expect(String(t({ a: '<Shop>', b: 'A & B' }))).toBe('<title>&lt;Shop> | A &amp; B</title>');
});

/* ---------------- ssgDir: pages → static html ---------------- */

async function writeProject(files: Record<string, string>): Promise<string> {
  const root = join(TMP, `ssg-${Math.random().toString(36).slice(2)}`);
  for (const [name, content] of Object.entries(files)) {
    const p = join(root, name);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, content);
  }
  return root;
}

const CARD = `
import { html } from '@amojs.dev/core';
export const Card = (title, body) => html\`<article class="card"><h2>\${title}</h2><p>\${body}</p></article>\`;
`;

const INDEX_PAGE = `
import { html, signal } from '@amojs.dev/core';
import { Card } from '../lib/card.js';
const hits = signal(3);
export default () => html\`<html lang="en"><head><title>amo ssg</title></head><body>
  <h1>hits: \${hits}</h1>
  \${['a', 'b'].map((t) => Card(t, 'body of ' + t))}
  <div id="counter-island"></div>
  <script type="module">import { mountCounter } from '/islands/counter.js'; mountCounter();</script>
</body></html>\`;
`;

const INTRO_PAGE = `
import { html } from '@amojs.dev/core';
export default async () => {
  const data = await Promise.resolve('async data');
  return html\`<html lang="en"><head><title>intro</title></head><body><p>\${data}</p></body></html>\`;
};
`;

test('ssgDir renders pages to .html — doctype, data, islands script, structure', async () => {
  const src = await writeProject({
    'pages/index.js': INDEX_PAGE,
    'pages/guide/intro.js': INTRO_PAGE,
    'lib/card.js': CARD,
    'styles/site.css': 'h1 { color: teal }',
  });
  const out = join(src, '..', `out-${Math.random().toString(36).slice(2)}`);
  const r = await ssgDir(src, out);

  expect(r.pages).toEqual([
    { src: join('pages', 'guide', 'intro.js'), out: join('guide', 'intro.html') },
    { src: join('pages', 'index.js'), out: 'index.html' },
  ]);

  // non-JS assets are copied verbatim to the same src-relative path; modules never are
  expect(r.assets).toEqual([join('styles', 'site.css')]);
  expect(await readFile(join(out, 'styles/site.css'), 'utf8')).toBe('h1 { color: teal }');
  await expect(readFile(join(out, 'lib/card.js'), 'utf8')).rejects.toThrow();

  const index = await readFile(join(out, 'index.html'), 'utf8');
  expect(index.startsWith('<!doctype html>\n<html lang="en">')).toBe(true);
  expect(index).toContain('hits: 3');
  expect(index).toContain('<article class="card"><h2>a</h2><p>body of a</p></article>');
  expect(index).toContain('<h2>b</h2>');
  // the island script is the AUTHOR's static markup, carried verbatim
  expect(index).toContain("import { mountCounter } from '/islands/counter.js'");

  const intro = await readFile(join(out, 'guide', 'intro.html'), 'utf8');
  expect(intro).toContain('<p>async data</p>'); // async default export awaited

  // zero script bytes unless the author wrote an island: intro has none
  expect(intro).not.toContain('<script');

  // the server-compile temp dir is gone
  const leftovers = (await readdir(out)).filter((f) => f.startsWith('.amo-ssg'));
  expect(leftovers).toEqual([]);
});

test('ssgDir: a page that destructures its props renders — ssg passes {}', async () => {
  // ONE calling convention with request-time SSR, where props are real. A page
  // written for both must not explode at build time for lack of an argument.
  const src = await writeProject({
    'pages/index.js': [
      "import { html } from '@amojs.dev/core';",
      "export default ({ title = 'default' }) => html`<h1>${title}</h1>`;",
    ].join('\n'),
  });
  const out = join(src, 'out');
  await ssgDir(src, out);
  expect(await readFile(join(out, 'index.html'), 'utf8')).toContain('<h1>default</h1>');
});

test('ssgDir: a page without a default export fails loudly, naming the file', async () => {
  const src = await writeProject({
    'pages/broken.js': "export const x = 1;\n",
  });
  const out = join(src, 'out');
  await expect(ssgDir(src, out)).rejects.toThrow(/pages\/broken\.js needs a default export/);
});

test('ssgDir: a page returning a non-template fails loudly', async () => {
  const src = await writeProject({
    'pages/plain.js': "export default () => '<html></html>';\n",
  });
  const out = join(src, 'out');
  await expect(ssgDir(src, out)).rejects.toThrow(/did not return a template/);
});

test('ssgDir: a missing pages directory fails loudly', async () => {
  const src = await writeProject({ 'lib/x.js': 'export const a = 1;\n' });
  await expect(ssgDir(src, join(src, 'out'))).rejects.toThrow(/no pages directory/);
});

test('ssgDir names a TypeScript page by the file the author wrote', async () => {
  const src = await writeProject({
    'pages/index.ts': INTRO_PAGE.replace('export default async () => {', 'export default async (): Promise<unknown> => {'),
    'pages/about/index.ts': INTRO_PAGE,
  });
  const out = join(src, '..', `out-${Math.random().toString(36).slice(2)}`);
  const r = await ssgDir(src, out);
  // the tree is compiled (.ts → .js) before the pages are walked; the log and
  // the result still say .ts, because that is the name a user greps for
  expect(r.pages).toEqual([
    { src: join('pages', 'about', 'index.ts'), out: join('about', 'index.html') },
    { src: join('pages', 'index.ts'), out: 'index.html' },
  ]);
  expect(await readFile(join(out, 'about', 'index.html'), 'utf8')).toContain('<p>async data</p>');
});

test('ssgDir: the loud errors name the .ts source too', async () => {
  const src = await writeProject({ 'pages/index.ts': "export const notDefault: number = 1;" });
  const out = join(src, '..', `out-${Math.random().toString(36).slice(2)}`);
  await expect(ssgDir(src, out)).rejects.toThrow(join('pages', 'index.ts'));
});

/* ---------------- ssgDir: [param] pages ---------------- */

const POST_PAGE = `
import { html } from '@amojs.dev/core';
export function paths() {
  return [{ slug: 'world' }, { slug: 'hello' }];
}
export default ({ params }) => html\`<h1>post \${params.slug}</h1>\`;
`;

/** run ssgDir and hand back its rejection — the messages are the interface */
async function ssgError(files: Record<string, string>): Promise<string> {
  const src = await writeProject(files);
  const err = await ssgDir(src, join(src, 'out')).then(
    () => null,
    (e: Error) => e,
  );
  expect(err).toBeInstanceOf(Error);
  return err!.message;
}

test('ssgDir: a [slug] page renders once per paths() entry, sorted, with { params }', async () => {
  const src = await writeProject({ 'pages/blog/[slug].js': POST_PAGE });
  // the file on disk really is named with brackets; its import url percent-encodes them
  expect(pathToFileURL(join(src, 'pages/blog/[slug].js')).href).toContain('%5Bslug%5D.js');
  const out = join(src, 'out');
  const r = await ssgDir(src, out);

  expect(r.pages).toEqual([
    { src: join('pages', 'blog', '[slug].js'), out: join('blog', 'hello.html'), params: { slug: 'hello' } },
    { src: join('pages', 'blog', '[slug].js'), out: join('blog', 'world.html'), params: { slug: 'world' } },
  ]);
  expect(r.empty).toEqual([]);
  expect(await readFile(join(out, 'blog', 'hello.html'), 'utf8')).toBe(
    '<!doctype html>\n<h1>post hello</h1>\n',
  );
  expect(await readFile(join(out, 'blog', 'world.html'), 'utf8')).toContain('<h1>post world</h1>');
  // the bracketed name itself is never emitted
  expect(await readdir(join(out, 'blog'))).toEqual(['hello.html', 'world.html']);
});

test('ssgDir: [slug]/index renders the pretty-url shape, blog/<slug>/index.html', async () => {
  const src = await writeProject({ 'pages/blog/[slug]/index.ts': POST_PAGE });
  const out = join(src, 'out');
  const r = await ssgDir(src, out);
  expect(r.pages.map((p) => [p.src, p.out])).toEqual([
    [join('pages', 'blog', '[slug]', 'index.ts'), join('blog', 'hello', 'index.html')],
    [join('pages', 'blog', '[slug]', 'index.ts'), join('blog', 'world', 'index.html')],
  ]);
  expect(await readFile(join(out, 'blog', 'hello', 'index.html'), 'utf8')).toContain(
    '<h1>post hello</h1>',
  );
});

test('ssgDir: two params in one path, each replaced in its own segment', async () => {
  const src = await writeProject({
    'pages/[lang]/docs/[page].js': [
      "import { html } from '@amojs.dev/core';",
      'export const paths = () => [',
      "  { lang: 'fa', page: 'intro' },",
      "  { lang: 'en', page: 'intro' },",
      "  { lang: 'en', page: 'signal', note: 'extra keys are not params' },",
      '];',
      'export default ({ params }) => html`<p>${params.lang}/${params.page}:${Object.keys(params).join()}</p>`;',
    ].join('\n'),
  });
  const out = join(src, 'out');
  const r = await ssgDir(src, out);
  expect(r.pages.map((p) => p.out)).toEqual([
    join('en', 'docs', 'intro.html'),
    join('en', 'docs', 'signal.html'),
    join('fa', 'docs', 'intro.html'),
  ]);
  expect(r.pages[1].params).toEqual({ lang: 'en', page: 'signal' });
  expect(await readFile(join(out, 'fa', 'docs', 'intro.html'), 'utf8')).toContain(
    '<p>fa/intro:lang,page</p>',
  );
});

test('ssgDir: paths() may be async', async () => {
  const src = await writeProject({
    'pages/tags/[tag].js': [
      "import { html } from '@amojs.dev/core';",
      'export async function paths() {',
      "  const tags = await Promise.resolve(['ui', 'compiler']);",
      '  return tags.map((tag) => ({ tag }));',
      '}',
      'export default async ({ params }) => html`<h1>#${params.tag}</h1>`;',
    ].join('\n'),
  });
  const out = join(src, 'out');
  const r = await ssgDir(src, out);
  expect(r.pages.map((p) => p.out)).toEqual([
    join('tags', 'compiler.html'),
    join('tags', 'ui.html'),
  ]);
  expect(await readFile(join(out, 'tags', 'ui.html'), 'utf8')).toContain('<h1>#ui</h1>');
});

test('ssgDir: a param page without paths() fails with the exact cure', async () => {
  const msg = await ssgError({
    'pages/blog/[slug].ts': [
      "import { html } from '@amojs.dev/core';",
      'export default ({ params }: { params: { slug: string } }) => html`<h1>${params.slug}</h1>`;',
    ].join('\n'),
  });
  expect(msg).toBe(
    `amo build ssg: ${join('pages', 'blog', '[slug].ts')} needs \`export function paths()\` — ` +
      "one object per page: [{ slug: 'hello' }]",
  );
});

test('ssgDir: a bad param value names the file, the param and the value', async () => {
  const page = (entries: string) =>
    [
      "import { html } from '@amojs.dev/core';",
      `export const paths = () => ${entries};`,
      'export default ({ params }) => html`<h1>${params.slug}</h1>`;',
    ].join('\n');
  const file = join('pages', 'blog', '[slug].js');
  const cases: [string, string][] = [
    ["[{ slug: 'ok' }, { title: 'no slug' }]", 'paths()[1].slug must name one path segment'],
    ['[{ slug: 42 }]', '— got 42'],
    ["[{ slug: '' }]", '— got ""'],
    ["[{ slug: 'a/b' }]", '— got "a/b"'],
    ["[{ slug: 'a\\\\b' }]", '— got "a\\\\b"'],
    ["[{ slug: '..' }]", '— got ".."'],
    ["[{ slug: '.' }]", '— got "."'],
    ["[{ slug: 'x..y' }]", '— got "x..y"'],
  ];
  for (const [entries, want] of cases) {
    const msg = await ssgError({ 'pages/blog/[slug].js': page(entries) });
    expect(msg).toContain(`amo build ssg: ${file} paths()[`);
    expect(msg).toContain('.slug must name one path segment');
    expect(msg).toContain(want);
  }

  expect(await ssgError({ 'pages/blog/[slug].js': page("({ slug: 'x' })") })).toBe(
    `amo build ssg: ${file} paths() must return an array, one object per page — got {"slug":"x"}`,
  );
  expect(await ssgError({ 'pages/blog/[slug].js': page("['x']") })).toBe(
    `amo build ssg: ${file} paths()[0] must be an object of params — got "x"`,
  );
});

test('ssgDir: two entries rendering the same file fail, naming the file and the path', async () => {
  const msg = await ssgError({
    'pages/blog/[slug].js': POST_PAGE.replace("{ slug: 'world' }", "{ slug: 'hello' }"),
  });
  expect(msg).toBe(
    `amo build ssg: ${join('pages', 'blog', '[slug].js')} renders ${join('blog', 'hello.html')} ` +
      'twice — two paths() entries give the same page',
  );
});

test('ssgDir: a param page and a static page rendering the same file fail', async () => {
  const msg = await ssgError({
    'pages/blog/[slug].js': POST_PAGE,
    'pages/blog/hello.js': "import { html } from '@amojs.dev/core';\nexport default () => html`<p>static</p>`;",
  });
  expect(msg).toContain(join('pages', 'blog', '[slug].js'));
  expect(msg).toContain(join('pages', 'blog', 'hello.js'));
  expect(msg).toContain(`both render ${join('blog', 'hello.html')}`);
});

test('ssgDir: paths() returning [] renders zero pages and is reported, not an error', async () => {
  const src = await writeProject({
    'pages/blog/[slug].js': [
      "import { html } from '@amojs.dev/core';",
      'export const paths = () => [];',
      'export default ({ params }) => html`<h1>${params.slug}</h1>`;',
    ].join('\n'),
    'pages/index.js': "import { html } from '@amojs.dev/core';\nexport default () => html`<p>home</p>`;",
  });
  const out = join(src, 'out');
  const r = await ssgDir(src, out);
  expect(r.pages).toEqual([{ src: join('pages', 'index.js'), out: 'index.html' }]);
  expect(r.empty).toEqual([join('pages', 'blog', '[slug].js')]);
  await expect(readdir(join(out, 'blog'))).rejects.toThrow();
});

test('ssgDir: a static page beside param pages still receives {}', async () => {
  const src = await writeProject({
    'pages/blog/[slug].js': POST_PAGE,
    'pages/blog/index.js': [
      "import { html } from '@amojs.dev/core';",
      'export default (props) => html`<p>props:${JSON.stringify(props)}</p>`;',
    ].join('\n'),
  });
  const out = join(src, 'out');
  const r = await ssgDir(src, out);
  expect(r.pages.find((p) => p.out === join('blog', 'index.html'))).toEqual({
    src: join('pages', 'blog', 'index.js'),
    out: join('blog', 'index.html'),
  });
  expect(await readFile(join(out, 'blog', 'index.html'), 'utf8')).toContain('<p>props:{}</p>');
});

test('ssgDir: catch-all, partial and repeated params are rejected by name', async () => {
  const page = "import { html } from '@amojs.dev/core';\nexport default () => html`<p>x</p>`;";

  const rest = await ssgError({ 'pages/docs/[...rest].js': page });
  expect(rest).toContain(`amo build ssg: ${join('pages', 'docs', '[...rest].js')}`);
  expect(rest).toContain('catch-all segments like [...rest] are not supported');

  const partial = await ssgError({ 'pages/blog/post-[id].js': page });
  expect(partial).toContain(`amo build ssg: ${join('pages', 'blog', 'post-[id].js')}`);
  expect(partial).toContain('"post-[id]" is not a param; a param is one whole path segment');

  const dir = await ssgError({ 'pages/[id]x/index.js': page });
  expect(dir).toContain('"[id]x" is not a param');

  const twice = await ssgError({ 'pages/[id]/[id].js': page });
  expect(twice).toContain(`amo build ssg: ${join('pages', '[id]', '[id].js')} uses [id] twice`);
});
