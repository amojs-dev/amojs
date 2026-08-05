/**
 * amo runtime — keyed list reconciliation.
 *
 * Node identity IS the key: keying strategies live upstream in each() —
 * exactly the dom-expressions lesson (reconcile nodes, key in the mapper).
 *
 * Correct-first version: skip the common prefix and suffix, remove leavers,
 * then re-insert the middle in order (insertBefore moves nodes that already
 * live in the parent). An LIS-optimal diff that minimizes moves is a v0.6
 * (size & speed) concern — the behavior contract is fixed here.
 */

/**
 * Make the children of `parent` between "before `anchor`" match `next`.
 * @param {Node} parent
 * @param {Node[]} prev  nodes currently rendered, in order
 * @param {Node[]} next  nodes wanted, in order
 * @param {Node} anchor  every list node sits immediately before this node
 */
export function reconcile(parent, prev, next, anchor) {
  let aStart = 0;
  let bStart = 0;
  let aEnd = prev.length;
  let bEnd = next.length;

  // common prefix — untouched
  while (aStart < aEnd && bStart < bEnd && prev[aStart] === next[bStart]) {
    aStart++;
    bStart++;
  }
  // common suffix — untouched
  while (aEnd > aStart && bEnd > bStart && prev[aEnd - 1] === next[bEnd - 1]) {
    aEnd--;
    bEnd--;
  }

  // remove nodes that leave
  const keep = new Set(next.slice(bStart, bEnd));
  for (let i = aStart; i < aEnd; i++) {
    if (!keep.has(prev[i])) parent.removeChild(prev[i]);
  }

  // (re)insert the middle in order, walking backwards toward the suffix
  let ref = aEnd < prev.length ? prev[aEnd] : anchor;
  for (let i = bEnd - 1; i >= bStart; i--) {
    parent.insertBefore(next[i], ref);
    ref = next[i];
  }
}
