/**
 * amo router — routing on the Navigation API (Baseline since January 2026).
 *
 * The whole design:
 *   - the URL is the only state
 *   - a page never sees a loading state: `load` settles BEFORE it renders;
 *     pending/error UI live in ONE place (the router options)
 *   - links are plain <a href>, forms are plain <form method="post"> — the
 *     platform intercepts them, the router owns zero click listeners
 *   - a browser without the Navigation API gets full page loads: the app is
 *     slower, not broken (progressive enhancement, no polyfill)
 *
 * Parser-free on purpose: the outlet is built exactly the way compiled
 * output builds a child hole (anchor + bindChild), so an app that routes —
 * compiled or raw — never pays for the template parser through this package.
 */

import { signal, root } from '@amojs.dev/core/runtime';
import { bindChild } from '@amojs.dev/core/compiled';
import { compileRoutes, matchRoute, stripBase } from './match.js';

/**
 * @typedef {Record<string, string>} Params
 *
 * @typedef {Object} PageModule
 * @property {(ctx: { data: *, params: Params, searchParams: URLSearchParams }) => Node} default
 *   the page component — receives RESOLVED data, never a promise
 * @property {(ctx: { params: Params, searchParams: URLSearchParams, signal?: AbortSignal }) => *} [load]
 *   fetch the page's data; the navigation's AbortSignal cancels stale runs
 * @property {(ctx: { formData: FormData, params: Params, searchParams: URLSearchParams, signal?: AbortSignal }) => *} [action]
 *   handle a same-URL <form method="post"> submit
 * @property {string | ((data: *) => string)} [title]  document.title for the page
 *
 * @typedef {() => Promise<PageModule>} Loader
 *
 * @typedef {Object} RouterOptions
 * @property {string} [base]  path prefix the app lives under ('' = site root)
 * @property {() => Node} [pending]  shown once a load takes longer than 100 ms
 * @property {(err: Error, retry: () => void) => Node} [error]  shown when load/action throw
 * @property {boolean} [viewTransitions]  crossfade committed page swaps (opt-in)
 */

/** `load`/`action` return this to send the user somewhere else.
 * @param {string} to */
export const redirect = (to) => ({ __redirect: to });

/** the base of the router created last — see link() */
let linkBase = '';

/**
 * Prefix an in-app path with the router's `base`, so a subpath deployment
 * (GitHub-Pages style) never hand-writes the prefix into every href:
 * `href="${link('/users')}"`. With no base it is the identity function.
 * Bound by router() at creation — create the router before rendering pages,
 * which routing already guarantees.
 * @param {string} path
 */
export const link = (path) => linkBase + path;

/**
 * @param {Record<string, Loader>} routes  '/x/:id' → module loader; '*' = 404
 * @param {RouterOptions} [options]
 * @returns {() => Node} a component — mount it like any other
 */
export function router(routes, { base = '', pending, error, viewTransitions = false } = {}) {
  const compiled = compileRoutes(routes);
  linkBase = base;

  const view = signal(/** @type {*} */ (document.createTextNode('')));
  /** @type {(() => void) | undefined} */
  let disposePage;
  /** @param {() => Node} build */
  const swap = (build) => {
    const prev = disposePage;
    root((dispose) => {
      disposePage = dispose;
      view.value = build(); // the page's effects belong to this root
    });
    prev?.(); // the old page's scope dies the moment the new one is in place
  };

  /** consecutive load/action redirects — reset by any page that RENDERS */
  let hops = 0;
  /** @param {string} to */
  const go = (to) => {
    // a redirect loop in `load` churns history forever with zero diagnostics
    // in most routers — cap it and name both ends (fetch itself caps at ~20)
    if (++hops > 10) throw new Error(`amo router: redirect loop — ${location.pathname} → ${base + to}`);
    navigation.navigate(base + to, { history: 'replace' });
  };

  /**
   * @param {{ load: Loader, params: Params }} m
   * @param {URLSearchParams} sp  captured from the navigation's OWN url — never
   *   from `location`, which may already belong to a newer navigation
   * @param {{ signal?: AbortSignal, formData?: FormData | null }} [nav]
   */
  async function run(m, sp, { signal: abort, formData } = {}) {
    // the old page stays on screen; pending appears only when the wait is real,
    // so a fast page swaps old → new directly with no flash in between
    const slow = pending && setTimeout(() => swap(pending), 100);
    try {
      const mod = await m.load();
      if (formData && mod.action) {
        const r = await mod.action({ formData, params: m.params, searchParams: sp, signal: abort });
        if (r && r.__redirect) return go(r.__redirect);
      }
      const data = mod.load
        ? await mod.load({ params: m.params, searchParams: sp, signal: abort })
        : undefined;
      const r = data && data.__redirect;
      if (r) return go(r);
      // a load without a fetch never rejects on abort — never render a page
      // whose navigation has already been superseded
      if (abort && abort.aborted) return;
      hops = 0;
      const show = () => swap(() => mod.default({ data, params: m.params, searchParams: sp }));
      // opt-in, guarded: a browser without View Transitions swaps instantly.
      // The swap MUST be awaited: startViewTransition defers its callback, and
      // if run() settles before the DOM is in place, the platform restores
      // scroll against the OLD (possibly short) page — found by the tall-page
      // probe, 2026-08-09.
      if (viewTransitions && document.startViewTransition) {
        await document.startViewTransition(show).updateCallbackDone;
      } else {
        show();
      }
      if (mod.title) document.title = typeof mod.title === 'function' ? mod.title(data) : mod.title;
    } catch (err) {
      if (abort && abort.aborted) return; // superseded — the newer navigation owns the outlet
      hops = 0; // the chain ended here — a later redirect starts fresh
      if (!error) throw err;
      // the previous page's title must not linger on the error UI; the
      // message is the default, and error() may overwrite document.title
      document.title = err instanceof Error ? err.message : String(err);
      swap(() => error(/** @type {Error} */ (err), () => navigation.reload()));
    } finally {
      if (slow) clearTimeout(slow);
    }
  }

  navigation.addEventListener('navigate', (e) => {
    if (!e.canIntercept || e.hashChange || e.downloadRequest !== null) return;
    const url = new URL(e.destination.url);
    if (url.origin !== location.origin) return;
    const path = stripBase(url.pathname, base);
    const m = path == null ? null : matchRoute(compiled, path);
    if (!m) return; // not ours — the browser navigates for real
    e.intercept({ handler: () => run(m, url.searchParams, e) });
  });

  // the Navigation API does not fire for the page already open — render it by hand
  const m0 = matchRoute(compiled, stripBase(location.pathname, base) ?? '/');
  if (m0) run(m0, new URL(location.href).searchParams);

  // the outlet, built the way compiled output builds a child hole — no parser
  return () => {
    const frag = document.createDocumentFragment();
    const anchor = frag.appendChild(document.createTextNode(''));
    bindChild(anchor, view);
    return frag;
  };
}
