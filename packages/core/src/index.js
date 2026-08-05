/**
 * amo runtime — public surface.
 *
 * Three concepts is the whole framework:
 *   state     → signal() / computed()
 *   template  → html``
 *   lifecycle → mount() (+ effect() / root() / onCleanup() when needed)
 *
 * There is deliberately NO component API: a component is a plain function
 * returning a Node, props are its arguments (signals when reactive), and
 * teardown is the ownership tree's job.
 */

export { signal, computed, effect, isSignal, flushSync, tick, root, onCleanup } from './signal.js';
export { html } from './html.js';
export { mount } from './mount.js';
export { each } from './each.js';
