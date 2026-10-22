/**
 * amo build ssg — render pages to static HTML at build time.
 *
 * The islands model, end to end:
 *   1. the whole source tree is compiled with the SERVER target into a
 *      temporary directory INSIDE the output dir — under the project, so the
 *      compiled modules' bare `@amojs.dev/core` imports resolve project-first,
 *      the same rule eject follows;
 *   2. every module under `<src>/<pagesDir>/` is a page: its default export
 *      is called (and awaited) on node, and the resulting template becomes
 *      `<out>/<same path>.html` with `<!doctype html>` prepended;
 *   3. every non-module file (css, images, fonts) is copied verbatim to the
 *      same src-relative path — modules (.js and .ts alike) never are: pages
 *      and layouts are server artifacts, and islands ship through their own
 *      DOM build;
 *   4. the temp dir is removed. Nothing here ships to the browser — a page
 *      with no islands emits ZERO script bytes, and an island is just a
 *      static `<script type="module">` the author wrote, compiled separately
 *      by `amo build`.
 *
 * A page module:
 *   export default (props) => html`<html><head>…</head><body>…</body></html>`
 * `load`-style data fetching is the default export's own business — it may
 * be async; the render waits. ssg has no request, so it passes `{}`; the same
 * module rendered per request receives that request's props instead — see
 * `buildDir(src, out, { target: 'server' })`, which is `amo build ssr` on
 * the command line.
 *
 * A param page — a path segment that is exactly `[name]`, like
 * `pages/blog/[slug].ts` — also exports `paths()`, returning one object per
 * page; each renders with `{ params }` to the path with every `[name]`
 * replaced: `{ slug: 'hello' }` → `blog/hello.html`. ssg only — the ssr
 * server maps a url to a file and has no route params.
 */

import { access, copyFile, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  buildDir,
  copyPublicDir,
  isDeclarationFile,
  isModuleFile,
  PUBLIC_DIR,
} from './build.js';

export interface SsgResult {
  /** rendered pages: source module (src-relative) → emitted html (out-relative) */
  pages: { src: string; out: string; params?: Record<string, string> }[];
  /** param pages whose `paths()` returned [] — rendered nothing (src-relative) */
  empty: string[];
  /** non-JS files copied verbatim (src-relative) */
  assets: string[];
}

const JS_EXT = new Set(['.js', '.mjs']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist']);
const PARAM = /^\[([A-Za-z_][A-Za-z0-9_]*)\]$/;

export async function ssgDir(
  srcDir: string,
  outDir: string,
  opts: { pagesDir?: string } = {},
): Promise<SsgResult> {
  const pagesDir = opts.pagesDir ?? 'pages';
  const pagesRoot = join(srcDir, pagesDir);
  try {
    await readdir(pagesRoot);
  } catch {
    throw new Error(`amo build ssg: no pages directory at ${pagesRoot}`);
  }

  // under outDir → under the project → node resolves @amojs.dev/core from
  // the project's own node_modules (or the workspace), exactly like eject
  const tmp = resolve(outDir, `.amo-ssg-${process.pid}-${Date.now().toString(36)}`);
  const result: SsgResult = { pages: [], empty: [], assets: [] };
  try {
    await buildDir(srcDir, tmp, { target: 'server' });

    const pageFiles: string[] = [];
    async function walk(dir: string): Promise<void> {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name);
        if (entry.isDirectory()) await walk(p);
        else if (JS_EXT.has(extname(entry.name))) pageFiles.push(p);
      }
    }
    await walk(join(tmp, pagesDir));
    pageFiles.sort(); // deterministic build order and result listing

    const written = new Map<string, string>(); // out-relative html → the page that rendered it
    for (const file of pageFiles) {
      const rel = relative(join(tmp, pagesDir), file);
      const srcRel = join(pagesDir, await sourceName(pagesRoot, rel));
      const segments = rel.slice(0, -extname(rel).length).split(sep);
      const names = pageParams(segments, srcRel);
      const mod = (await import(/* @vite-ignore */ pathToFileURL(file).href)) as {
        default?: unknown;
        paths?: unknown;
      };
      if (typeof mod.default !== 'function') {
        throw new Error(
          `amo build ssg: ${srcRel} needs a default export (a component returning a template)`,
        );
      }

      let renders: { out: string; params?: Record<string, string> }[];
      if (names.length === 0) {
        renders = [{ out: segments.join(sep) + '.html' }];
      } else {
        const entries = await expandPaths(mod.paths, names, srcRel);
        if (entries.length === 0) result.empty.push(srcRel);
        renders = entries.map((params) => {
          const filled = segments.map((s) => {
            const name = PARAM.exec(s)?.[1];
            return name === undefined ? s : params[name];
          });
          return { out: join(...filled) + '.html', params };
        });
        renders.sort((a, b) => (a.out < b.out ? -1 : a.out > b.out ? 1 : 0));
      }

      for (const { out } of renders) {
        const prev = written.get(out);
        if (prev === srcRel) {
          throw new Error(
            `amo build ssg: ${srcRel} renders ${out} twice — two paths() entries give the same page`,
          );
        }
        if (prev !== undefined) {
          throw new Error(`amo build ssg: ${prev} and ${srcRel} both render ${out}`);
        }
        written.set(out, srcRel);
      }

      for (const { out, params } of renders) {
        // ONE calling convention for both consumers: a page is `(props) => …`.
        // A build has no request, so a static page gets an empty object — never
        // nothing, or every page that destructures its props would throw here.
        const props = params ? { params } : {};
        const res = (await mod.default(props)) as { __amoHtml?: unknown } | null;
        if (!res || typeof res.__amoHtml !== 'string') {
          throw new Error(
            `amo build ssg: ${srcRel} did not return a template — a page returns html\`…\``,
          );
        }
        const dest = join(outDir, out);
        await mkdir(dirname(dest), { recursive: true });
        await writeFile(dest, '<!doctype html>\n' + res.__amoHtml + '\n');
        result.pages.push(params ? { src: srcRel, out, params } : { src: srcRel, out });
      }
    }

    async function copyAssets(dir: string): Promise<void> {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name);
        if (entry.isDirectory()) {
          // src/public/ copies to the OUT ROOT below, not to its own path
          if (p === join(srcDir, PUBLIC_DIR)) continue;
          if (!SKIP_DIRS.has(entry.name)) await copyAssets(p);
        } else if (!isModuleFile(entry.name) && !isDeclarationFile(entry.name)) {
          const rel = relative(srcDir, p);
          const dest = join(outDir, rel);
          await mkdir(dirname(dest), { recursive: true });
          await copyFile(p, dest);
          result.assets.push(rel);
        }
      }
    }
    await copyAssets(srcDir);
    result.assets.push(...(await copyPublicDir(srcDir, outDir)));
    result.assets.sort();
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
  return result;
}

/** the `[name]` params in a page's path, in order — a shape we do not route is a loud error */
function pageParams(segments: string[], srcRel: string): string[] {
  const names: string[] = [];
  for (const seg of segments) {
    if (!seg.includes('[') && !seg.includes(']')) continue;
    if (seg.startsWith('[...')) {
      throw new Error(
        `amo build ssg: ${srcRel} — catch-all segments like ${seg} are not supported; ` +
          'a param is one whole path segment: [name]',
      );
    }
    const name = PARAM.exec(seg)?.[1];
    if (name === undefined) {
      throw new Error(
        `amo build ssg: ${srcRel} — "${seg}" is not a param; a param is one whole path ` +
          'segment, named with letters, digits and _: [slug]',
      );
    }
    if (names.includes(name)) {
      throw new Error(
        `amo build ssg: ${srcRel} uses [${name}] twice — each param name appears once in a path`,
      );
    }
    names.push(name);
  }
  return names;
}

/** call a param page's `paths()` and check every entry before anything renders */
async function expandPaths(
  paths: unknown,
  names: string[],
  srcRel: string,
): Promise<Record<string, string>[]> {
  if (typeof paths !== 'function') {
    throw new Error(
      `amo build ssg: ${srcRel} needs \`export function paths()\` — one object per page: ` +
        `[{ ${names.map((n) => `${n}: 'hello'`).join(', ')} }]`,
    );
  }
  const list: unknown = await paths();
  if (!Array.isArray(list)) {
    throw new Error(
      `amo build ssg: ${srcRel} paths() must return an array, one object per page — got ${show(list)}`,
    );
  }
  return list.map((entry: unknown, i) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new Error(
        `amo build ssg: ${srcRel} paths()[${i}] must be an object of params — got ${show(entry)}`,
      );
    }
    const params: Record<string, string> = {};
    for (const n of names) {
      const v = (entry as Record<string, unknown>)[n];
      if (typeof v !== 'string' || v === '' || v === '.' || /[/\\]|\.\./.test(v)) {
        throw new Error(
          `amo build ssg: ${srcRel} paths()[${i}].${n} must name one path segment — a ` +
            `non-empty string other than ".", with no /, \\ or .. — got ${show(v)}`,
        );
      }
      params[n] = v;
    }
    return params;
  });
}

function show(v: unknown): string {
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'object' && v !== null) {
    try {
      return JSON.stringify(v);
    } catch {
      // cyclic or BigInt inside — fall through
    }
  }
  return String(v);
}

/**
 * The file the author wrote. The tree is compiled before the pages are walked,
 * so a `.ts` page shows up as `.js` here — report the name a user would grep for.
 */
async function sourceName(pagesRoot: string, compiledRel: string): Promise<string> {
  const ts = compiledRel.replace(/\.mjs$/, '.mts').replace(/\.js$/, '.ts');
  if (ts === compiledRel) return compiledRel;
  try {
    await access(join(pagesRoot, compiledRel));
    return compiledRel;
  } catch {
    /* no .js source — the compiled module came from a .ts file */
  }
  try {
    await access(join(pagesRoot, ts));
    return ts;
  } catch {
    return compiledRel;
  }
}
