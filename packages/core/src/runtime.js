/**
 * amo runtime — the parser-free public surface.
 *
 * Everything index.js offers EXCEPT html``. Compiled modules import from
 * here instead of the package root, because raw ESM has no tree-shaking:
 * an import chain IS the network cost, and index.js pulls the template
 * parser in. A fully compiled app never loads html.js.
 */

export { signal, computed, effect, isSignal, flushSync, tick, root, onCleanup } from './signal.js';
export { mount } from './mount.js';
export { each } from './each.js';
