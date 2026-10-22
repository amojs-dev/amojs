/**
 * amo runtime — mounting.
 * Its own module (not html.js) so compiled/ejected apps can import it
 * without touching the template parser.
 */

import { root, owned, flushMount } from './signal.js';

/**
 * Instantiate a component (or take a node) and append it to a target.
 * Component functions run ONCE — after mount, only hole effects stay alive.
 * At top level the component runs inside an app-lifetime root, so onCleanup()
 * is legal anywhere in it; inside a scope — `root(() => mount(App, el))` —
 * that scope owns it, so disposing the scope tears the app down.
 * @param {(() => Node) | Node} component
 * @param {Element} target
 * @returns {Node}
 */
export function mount(component, target) {
  const node =
    typeof component === 'function' ? (owned() ? component() : root(() => component())) : component;
  target.append(node);
  flushMount(); // the node is live now — onMount callbacks may run
  return node;
}
