/**
 * amo runtime — mounting.
 * Its own module (not html.js) so compiled/ejected apps can import it
 * without touching the template parser.
 */

/**
 * Instantiate a component (or take a node) and append it to a target.
 * Component functions run ONCE — after mount, only hole effects stay alive.
 * @param {(() => Node) | Node} component
 * @param {Element} target
 */
export function mount(component, target) {
  const node = typeof component === 'function' ? component() : component;
  target.append(node);
  return node;
}
