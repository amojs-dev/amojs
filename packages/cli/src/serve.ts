/**
 * The amo server — one implementation behind `amo dev` and `amo serve`.
 *
 * Static files first (islands, the vendored core, styles, public assets);
 * with ssr enabled, every other url maps to a compiled page module —
 * /about → <out>/pages/about.js — rendered per request with `{ url }`.
 *
 * Deliberately dumb, like the compiler: url → file path, no route params,
 * no middleware, no config. A server that needs more is ~10 lines of your
 * own node code — the README shows the pattern. The server you can replace.
 *
 * In ssr mode, .js is served statically ONLY from the islands dir and
 * _amo/ — everything else compiled for node is server code, and server
 * code is never handed to a browser.
 */

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { Server, ServerResponse } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

export interface SsrOptions {
  /** the pages folder inside the served dir (default convention: 'pages') */
  pagesDir: string;
  /** the islands folder — the one place client .js is served from */
  islandsDir: string;
  /**
   * dev only: bumps after every rebuild so page modules re-import fresh
   * (node caches ESM by url; a ?v= query is the standard cache-buster —
   * old module versions linger for the session, acceptable in dev)
   */
  version?: () => number;
}

export interface ServeOptions {
  outDir: string;
  port: number;
  ssr?: SsrOptions;
  /** dev sets 'no-store'; a production serve sends no cache header at all */
  cacheControl?: string;
}

/** decoded, normalized, query-stripped, traversal-stripped url path */
function cleanPath(urlPath: string): string {
  return normalize(decodeURIComponent(urlPath.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
}

async function isFile(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
}

/** a url path → the static file that answers it (pretty urls included) */
async function findFile(o: ServeOptions, clean: string): Promise<string | null> {
  const rel = clean.replace(/^[/\\]+/, '');
  if (o.ssr && ['.js', '.mjs'].includes(extname(rel))) {
    const servable = [o.ssr.islandsDir, '_amo'].some((dir) => rel.startsWith(dir + sep));
    if (!servable) return null; // server code is never handed to a browser
  }
  for (const candidate of [
    join(o.outDir, rel),
    join(o.outDir, rel, 'index.html'),
    join(o.outDir, rel + '.html'),
  ]) {
    if (await isFile(candidate)) return candidate;
  }
  return null;
}

/** a url path → the compiled page module that renders it */
async function findPage(o: ServeOptions, ssr: SsrOptions, clean: string): Promise<string | null> {
  const rel = clean.replace(/^[/\\]+/, '').replace(/[/\\]+$/, '');
  const base = join(o.outDir, ssr.pagesDir);
  for (const candidate of rel === ''
    ? [join(base, 'index.js')]
    : [join(base, rel + '.js'), join(base, rel, 'index.js')]) {
    if (await isFile(candidate)) return candidate;
  }
  return null;
}

function head(res: ServerResponse, status: number, type: string, o: ServeOptions): void {
  res.writeHead(status, {
    'content-type': type,
    ...(o.cacheControl ? { 'cache-control': o.cacheControl } : {}),
  });
}

export function startServer(o: ServeOptions): Server {
  const server = createServer(async (req, res) => {
    const clean = cleanPath(req.url ?? '/');

    const file = await findFile(o, clean);
    if (file) {
      head(res, 200, TYPES[extname(file)] ?? 'application/octet-stream', o);
      createReadStream(file).pipe(res);
      return;
    }

    if (o.ssr) {
      const page = await findPage(o, o.ssr, clean);
      if (page) {
        try {
          const v = o.ssr.version?.() ?? 0;
          const mod = (await import(
            pathToFileURL(page).href + (v ? `?v=${v}` : '')
          )) as { default?: (props: object) => unknown };
          if (typeof mod.default !== 'function') {
            throw new Error(`${page} needs a default export (a component returning a template)`);
          }
          const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
          const out = (await mod.default({ url })) as { __amoHtml?: unknown } | null;
          if (!out || typeof out.__amoHtml !== 'string') {
            throw new Error(`${page} did not return a template — a page returns html\`…\``);
          }
          head(res, 200, 'text/html; charset=utf-8', o);
          res.end('<!doctype html>\n' + out.__amoHtml + '\n');
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          process.stderr.write(`amo: ${clean} failed to render — ${msg}\n`);
          head(res, 500, 'text/plain; charset=utf-8', o);
          res.end(`500 — ${msg}`);
        }
        return;
      }
    }

    head(res, 404, 'text/plain; charset=utf-8', o);
    res.end('404');
  });

  server.listen(o.port, () => {
    process.stdout.write(`\n  http://localhost:${o.port}\n\n`);
  });
  return server;
}
