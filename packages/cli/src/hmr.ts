/**
 * amo dev — the hot-update channel.
 *
 * One SSE endpoint (`/_amo/events`), one injected client (`/_amo/dev.js`),
 * zero dependencies. Three update classes, picked per rebuild from the
 * watcher's changed paths:
 *
 *   css     every changed file is .css — swap <link> hrefs in place;
 *           no reload, island state survives (most of HMR's real value)
 *   island  every change is inside the islands dir — re-import each changed
 *           island with a cache-buster; a dev-only mount facade removes the
 *           previous version's DOM from its container first. Local island
 *           state resets, and old timers/effects linger until a real reload
 *           (bounded, dev-only, the same honesty Solid/Svelte settle for).
 *   reload  anything else (pages, lib, public) — server-rendered HTML has
 *           no client module to swap, so the browser refreshes itself.
 *
 * A failed rebuild sends a fourth message, `error`: the client shows it in an
 * overlay, and the next update of any class removes it.
 *
 * Nothing here touches `amo build` output or `amo serve`: the client is
 * injected at SERVE time by dev only, and the mount facade is applied to
 * the built _amo/ AFTER each rebuild, in the out dir only.
 */

import { readFile, rename, writeFile } from 'node:fs/promises';
import { extname, join, sep } from 'node:path';
import type { ServerResponse } from 'node:http';

export interface DevChannel {
  /** open SSE connections; serve.ts adds and removes them */
  clients: Set<ServerResponse>;
  /** the failed build's error while it stands — a tab that connects later gets it first */
  lastError: Update | null;
}

export type Update =
  | { type: 'css'; v: number }
  | { type: 'island'; paths: string[]; v: number }
  | { type: 'reload' }
  | { type: 'error'; message: string };

/** decide what the browser must do about this set of changed source files */
export function classify(
  changed: Iterable<string>,
  opts: { islandsDir: string | null; v: number },
): Update {
  const paths = [...changed];
  if (paths.length === 0) return { type: 'reload' };

  if (paths.every((p) => extname(p) === '.css')) return { type: 'css', v: opts.v };

  if (
    opts.islandsDir !== null &&
    paths.every((p) => p.startsWith(opts.islandsDir + sep) || p.startsWith(opts.islandsDir + '/'))
  ) {
    // src-relative islands/counter.ts → the url the page loaded it from
    const urls = paths.map(
      (p) =>
        '/' +
        p
          .split(sep)
          .join('/')
          .replace(/\.mts$/, '.mjs')
          .replace(/\.ts$/, '.js'),
    );
    return { type: 'island', paths: urls, v: opts.v };
  }

  return { type: 'reload' };
}

/** one SSE message */
export function frame(update: Update): string {
  return `data: ${JSON.stringify(update)}\n\n`;
}

export function broadcast(dev: DevChannel, update: Update): void {
  const f = frame(update);
  for (const res of dev.clients) res.write(f);
}

/**
 * The injected client. Kept as source-in-a-string so the CLI stays a single
 * tsc emit — it is served from memory at /_amo/dev.js, never written to disk.
 */
export const DEV_CLIENT = `// amo dev — live updates. Not part of your build.
const fallback = new URL(import.meta.url).searchParams.has('fallback'); // on the fallback document: no page to update in place
const CSS = '.layer{all:initial;position:fixed;inset:0;z-index:2147483647;display:flex;align-items:flex-start;justify-content:center;box-sizing:border-box;padding:8vh 16px;overflow:auto;background:rgba(11,12,17,.72);font:14px/1.5 system-ui,sans-serif;color:#f6f7f5;direction:ltr}'
  + '.panel{box-sizing:border-box;width:100%;max-width:960px;padding:20px 24px;background:#0b0c11;border:1px solid #2b2d38;border-top:3px solid #ff6b6b;border-radius:8px;box-shadow:0 16px 48px rgba(0,0,0,.5)}'
  + 'h1{margin:0 0 12px;font-size:15px;font-weight:600;color:#ff8f8f}'
  + 'pre{margin:0;padding:12px 14px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;background:#15161d;border-radius:6px;font:13px/1.6 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}'
  + 'p{margin:12px 0 0;font-size:13px;color:#a3a8b5}';
let host = null;
const hide = () => { host?.remove(); host = null; };
const show = (message) => {
  hide();
  host = document.createElement('amo-dev-overlay');
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = '<style>' + CSS + '</style><div class="layer"><section class="panel" role="alert">'
    + '<h1>amo dev — build failed</h1><pre></pre><p>fix the file and save — this closes itself</p></section></div>';
  root.querySelector('pre').textContent = message;
  root.querySelector('.layer').onclick = (e) => { if (e.target === e.currentTarget) hide(); };
  document.documentElement.append(host);
};
addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });

let lost = false;
const es = new EventSource('/_amo/events');
es.onerror = () => { lost = true; };
es.onopen = () => { if (lost) location.reload(); }; // the dev server came back
es.onmessage = async (e) => {
  const m = JSON.parse(e.data);
  if (m.type === 'error') return show(m.message);
  hide();
  if (fallback) return location.reload();
  if (m.type === 'css') {
    for (const l of document.querySelectorAll('link[rel="stylesheet"]')) {
      const u = new URL(l.getAttribute('href'), location.href);
      u.searchParams.set('v', m.v);
      l.setAttribute('href', u.pathname + u.search);
    }
  } else if (m.type === 'island') {
    window.__amoDevSwap = true;
    try {
      for (const p of m.paths) await import(p + '?v=' + m.v);
    } catch (err) {
      console.error('[amo] island update failed — reloading', err);
      location.reload();
    }
    window.__amoDevSwap = false;
  } else {
    location.reload();
  }
};
`;

/**
 * The dev mount facade. Islands import core from the vendored _amo/ url;
 * in dev that file becomes this wrapper over the real bundle, so a swapped
 * island can REPLACE its previous DOM instead of appending a second copy.
 * Applied after every rebuild (the build rewrites _amo/ fresh each time).
 */
const FACADE_MARK = '__amoDevMounts';

function facadeFor(impl: string): string {
  return `// amo dev — mount facade over ${impl}. Not part of your build.
export * from './${impl}';
import { mount as _mount } from './${impl}';
const reg = (window.${FACADE_MARK} ??= new Map()); // container → mounted nodes
export function mount(component, target) {
  if (window.__amoDevSwap && reg.has(target)) {
    for (const n of reg.get(target)) n.remove(); // the old version's DOM
    reg.delete(target);
  }
  const node = _mount(component, target);
  (reg.get(target) ?? reg.set(target, []).get(target)).push(node);
  return node;
}
`;
}

/** wrap the vendored core bundles (when present) with the mount facade */
export async function applyDevFacade(outDir: string): Promise<void> {
  for (const bundle of ['runtime.js', 'core.js']) {
    const file = join(outDir, '_amo', bundle);
    let source: string;
    try {
      source = await readFile(file, 'utf8');
    } catch {
      continue; // this bundle was not vendored — nothing imports it
    }
    if (source.includes(FACADE_MARK)) continue; // already wrapped
    const impl = bundle.replace('.js', '-impl.js');
    await rename(file, join(outDir, '_amo', impl));
    await writeFile(file, facadeFor(impl));
  }
}
