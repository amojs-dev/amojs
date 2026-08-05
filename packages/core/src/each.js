/**
 * amo runtime — keyed mapping for list holes.
 *
 *   html`<ul>${each(items, (it) => it.id, (it) => html`<li>${it.label}</li>`)}</ul>`
 *
 * each() returns a FUNCTION — so by the hole rule it becomes an effect, and
 * re-runs whenever the source signal changes. It keeps a key → node cache:
 * `render` runs ONCE per key while the key stays present; the node is then
 * moved by the reconciler, never rebuilt — that is what preserves DOM state
 * (focus, input value) across reorders.
 *
 * Consequence to know: if an item's DATA changes while its key stays, the
 * cached node does NOT re-render — put signals inside items for that.
 * A key that disappears drops out of the cache; if it returns later it gets
 * a fresh node.
 */

import { isSignal } from './signal.js';

/**
 * @param {{ value: unknown } | (() => any[])} source  a signal holding an
 *   array, or a function returning one
 * @param {(item: any, index: number) => unknown} key  stable identity per item
 * @param {(item: any, index: number) => Node} render  built once per key
 * @returns {() => Node[]}
 */
export function each(source, key, render) {
  if (!isSignal(source) && typeof source !== 'function') {
    throw new Error('amo: each() source must be a signal or a function');
  }
  const read = isSignal(source)
    ? () => /** @type {{value: any[]}} */ (source).value
    : /** @type {() => any[]} */ (source);

  /** @type {Map<unknown, Node>} */
  let cache = new Map();

  return () => {
    const items = read();
    /** @type {Map<unknown, Node>} */
    const next = new Map();
    const nodes = items.map((item, i) => {
      const k = key(item, i);
      if (next.has(k)) {
        throw new Error(`amo: duplicate key in each(): ${String(k)}`);
      }
      let node = cache.get(k);
      if (node === undefined) {
        node = render(item, i);
        if (/** @type {Node} */ (node).nodeType === 11) {
          throw new Error('amo: each() render must return a single element, not a fragment');
        }
      }
      next.set(k, node);
      return node;
    });
    cache = next;
    return nodes;
  };
}
