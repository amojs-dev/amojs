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
 *
 * Ownership (v0.5): every key's render runs in a DETACHED root, so list
 * re-runs (reorders, appends) never touch living rows; a leaving key
 * disposes exactly its own scope, and disposing the hole that hosts the
 * list disposes every row.
 */

import { isSignal, root, onDispose } from './signal.js';

/**
 * @template T
 * @param {{ value: readonly T[] } | (() => readonly T[])} source  a signal
 *   holding an array, or a function returning one
 * @param {(item: T, index: number) => unknown} key  stable identity per item
 * @param {(item: T, index: number) => Node} render  built once per key
 * @returns {() => Node[]}
 */
export function each(source, key, render) {
  if (!isSignal(source) && typeof source !== 'function') {
    throw new Error('amo: each() source must be signal or function');
  }
  const read = isSignal(source)
    ? () => /** @type {{value: any[]}} */ (source).value
    : /** @type {() => any[]} */ (source);

  /** @type {Map<unknown, { node: Node, dispose: () => void }>} */
  let cache = new Map();
  /** rows must die with the hole hosting the list — not with its re-runs */
  let hooked = false;

  return () => {
    if (!hooked) {
      hooked = onDispose(() => {
        for (const entry of cache.values()) entry.dispose();
        cache = new Map();
      });
    }
    const items = read();
    /** @type {Map<unknown, { node: Node, dispose: () => void }>} */
    const next = new Map();
    const nodes = items.map((item, i) => {
      const k = key(item, i);
      if (next.has(k)) {
        throw new Error(`amo: duplicate key in each(): ${String(k)}`);
      }
      let entry = cache.get(k);
      if (entry === undefined) {
        // every key gets its own DETACHED root: the list effect re-runs on
        // any change, and per-run teardown must never touch reused rows —
        // a row's scope dies exactly when its key leaves.
        entry = root((dispose) => ({ node: render(item, i), dispose }));
        if (entry.node.nodeType === 11) {
          entry.dispose();
          throw new Error('amo: each() render must return one element');
        }
      }
      next.set(k, entry);
      return entry.node;
    });
    for (const [k, entry] of cache) {
      if (!next.has(k)) entry.dispose(); // key left → its whole scope goes too
    }
    cache = next;
    return nodes;
  };
}
