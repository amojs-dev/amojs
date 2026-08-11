/**
 * amo ssg — render pages to static HTML at build time.
 *
 * The islands model, end to end:
 *   1. the whole source tree is compiled with the SERVER target into a
 *      temporary directory INSIDE the output dir — under the project, so the
 *      compiled modules' bare `@amojs.dev/core` imports resolve project-first,
 *      the same rule eject follows;
 *   2. every module under `<src>/<pagesDir>/` is a page: its default export
 *      is called (and awaited) on node, and the resulting template becomes
 *      `<out>/<same path>.html` with `<!doctype html>` prepended;
 *   3. the temp dir is removed. Nothing here ships to the browser — a page
 *      with no islands emits ZERO script bytes, and an island is just a
 *      static `<script type="module">` the author wrote, compiled separately
 *      by `amo build`.
 *
 * A page module:
 *   export default (props) => html`<html><head>…</head><body>…</body></html>`
 * `load`-style data fetching is the default export's own business — it may
 * be async; the render waits. ssg has no request, so it passes `{}`; the same
 * module rendered per request receives that request's props instead — see
 * `buildDir(src, out, { target: 'server' })`, which is `amo build --target
 * server` on the command line.
 */

import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildDir } from './build.js';

export interface SsgResult {
  /** rendered pages: source module (src-relative) → emitted html (out-relative) */
  pages: { src: string; out: string }[];
}

const JS_EXT = new Set(['.js', '.mjs']);

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
    throw new Error(`amo ssg: no pages directory at ${pagesRoot}`);
  }

  // under outDir → under the project → node resolves @amojs.dev/core from
  // the project's own node_modules (or the workspace), exactly like eject
  const tmp = resolve(outDir, `.amo-ssg-${process.pid}-${Date.now().toString(36)}`);
  const result: SsgResult = { pages: [] };
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

    for (const file of pageFiles) {
      const rel = relative(join(tmp, pagesDir), file);
      const mod = (await import(/* @vite-ignore */ pathToFileURL(file).href)) as {
        default?: unknown;
      };
      if (typeof mod.default !== 'function') {
        throw new Error(
          `amo ssg: ${join(pagesDir, rel)} needs a default export (a component returning a template)`,
        );
      }
      // ONE calling convention for both consumers: a page is `(props) => …`.
      // A build has no request, so ssg passes an empty object — never nothing,
      // or every page that destructures its props would throw here.
      const res = (await mod.default({})) as { __amoHtml?: unknown } | null;
      if (!res || typeof res.__amoHtml !== 'string') {
        throw new Error(
          `amo ssg: ${join(pagesDir, rel)} did not return a template — a page returns html\`…\``,
        );
      }
      const outRel = rel.slice(0, -extname(rel).length) + '.html';
      const dest = join(outDir, outRel);
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, '<!doctype html>\n' + res.__amoHtml + '\n');
      result.pages.push({ src: join(pagesDir, rel), out: outRel });
    }
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
  return result;
}
