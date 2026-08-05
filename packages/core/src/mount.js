/**
 * amo runtime — mounting.
 * Its own module (not html.js) so compiled/ejected apps can import it
 * without touching the template parser.
 */

import { root } from './signal.js';

/**
 * Instantiate a component (or take a node) and append it to a target.
 * Component functions run ONCE — after mount, only hole effects stay alive.
 * The component runs inside an app-lifetime root, so onCleanup() is legal
 * anywhere in it; for an explicitly disposable app, wrap mount in root().
 * @param {(() => Node) | Node} component
 * @param {Element} target
 */
export function mount(component, target) {
  const node =
    typeof component === 'function' ? root(() => component()) : component;
  target.append(node);
  return node;
}
