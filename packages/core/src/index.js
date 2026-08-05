/**
 * amo runtime — public surface.
 *
 * Three concepts is the whole framework:
 *   state     → signal() / computed()
 *   template  → html`` (+ the reserved `ref` attribute for a node)
 *   lifetime  → mount() (+ effect() / root() / onCleanup() / onMount())
 *
 * There is deliberately NO component API and NO lifecycle: a component is a
 * plain function returning a Node, props are its arguments (signals when
 * reactive), and teardown is the ownership tree's job. A scope has exactly
 * two moments — it is created, and it dies.
 */

export {
  signal, computed, effect, isSignal, flushSync, tick, root, onCleanup, onMount,
} from './signal.js';
export { html } from './html.js';
export { mount } from './mount.js';
export { each } from './each.js';
