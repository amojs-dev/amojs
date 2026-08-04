/**
 * amo runtime — public surface.
 *
 * Three concepts is the whole framework:
 *   state     → signal() / computed()
 *   template  → html``
 *   lifecycle → mount() (+ effect() when you need one by hand)
 */

export { signal, computed, effect, isSignal, flushSync, tick } from './signal.js';
export { html, mount } from './html.js';
