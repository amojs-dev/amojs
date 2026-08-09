/**
 * amo router — pure route matching.
 *
 * No DOM, no Navigation API: everything in this file is a function from
 * strings to values, so it unit-tests in plain node. The browser wiring
 * lives in router.js.
 */

/**
 * @template T
 * @typedef {{ table: { rx: RegExp, names: string[], load: T }[], fallback: T | undefined }} RouteTable
 */

/**
 * Compile a route map into a matchable table.
 *
 * Patterns are literal paths with `:name` params (`'/users/:id'`); `'*'` is
 * the fallback for anything no pattern matches. Every other character is
 * matched literally — `.` in a route means a dot, not "any character".
 *
 * @template T
 * @param {Record<string, T>} routes
 * @returns {RouteTable<T>}
 */
export function compileRoutes(routes) {
  /** @type {RouteTable<T>['table']} */
  const table = [];
  for (const [p, load] of Object.entries(routes)) {
    if (p === '*') continue;
    /** @type {string[]} */
    const names = [];
    const rx = new RegExp(
      '^' +
        p
          .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          .replace(/:(\w+)/g, (_, n) => (names.push(n), '([^/]+)')) +
        '$',
    );
    table.push({ rx, names, load });
  }
  return { table, fallback: routes['*'] };
}

/**
 * Match an app-relative path against a compiled table.
 * Param values arrive percent-decoded.
 *
 * @template T
 * @param {RouteTable<T>} compiled
 * @param {string} path
 * @returns {{ load: T, params: Record<string, string> } | null}
 */
export function matchRoute(compiled, path) {
  // '/products' and '/products/' are one route — trailing-slash ambiguity is
  // a recurring bug (and SEO duplicate-content) class in other routers
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  for (const r of compiled.table) {
    const m = r.rx.exec(path);
    if (m) {
      const params = Object.fromEntries(
        r.names.map((n, i) => [n, decodeURIComponent(m[i + 1])]),
      );
      return { load: r.load, params };
    }
  }
  return compiled.fallback !== undefined ? { load: compiled.fallback, params: {} } : null;
}

/**
 * pathname → app-relative path, or null when the URL is outside the base.
 * The base itself maps to '/', so `base: '/app'` serves `/app` and `/app/…`.
 *
 * @param {string} pathname
 * @param {string} base
 * @returns {string | null}
 */
export function stripBase(pathname, base) {
  if (!base) return pathname;
  return pathname === base || pathname.startsWith(base + '/')
    ? pathname.slice(base.length) || '/'
    : null;
}
