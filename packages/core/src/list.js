/**
 * amo runtime — keyed list reconciliation.
 *
 * Node identity IS the key: keying strategies live upstream in each() —
 * exactly the dom-expressions lesson (reconcile nodes, key in the mapper).
 *
 * Move-minimal (v0.6): skip the common prefix and suffix, remove leavers,
 * then keep every node on the longest increasing subsequence of old
 * positions anchored and insert only the rest. A swap costs 2 moves, a
 * reverse costs n−1 — the counts a careful human would produce by hand.
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

  // one map does double duty: membership (who stays) and old position
  /** @type {Map<Node, number>} new-middle node → old position (-1 = new) */
  const pos = new Map();
  for (let i = bStart; i < bEnd; i++) pos.set(next[i], -1);
  for (let i = aStart; i < aEnd; i++) {
    if (pos.has(prev[i])) pos.set(prev[i], i);
    else parent.removeChild(prev[i]);
  }

  // nodes whose old positions form the longest increasing subsequence are
  // already in relative order — anchor on them, move only the rest
  const stable = lis(next, bStart, bEnd, pos);

  let ref = aEnd < prev.length ? prev[aEnd] : anchor;
  for (let i = bEnd - 1; i >= bStart; i--) {
    const n = next[i];
    if (!stable.has(n)) parent.insertBefore(n, ref);
    ref = n;
  }
}

/**
 * The nodes on one longest strictly-increasing subsequence of old positions:
 * patience sorting with predecessor links, O(n log n).
 * @param {Node[]} next
 * @param {number} bStart
 * @param {number} bEnd
 * @param {Map<Node, number>} pos
 * @returns {Set<Node>}
 */
function lis(next, bStart, bEnd, pos) {
  /** @type {Node[]} reused nodes in new order */
  const nodes = [];
  /** @type {number[]} their old positions */
  const seq = [];
  for (let i = bStart; i < bEnd; i++) {
    const p = /** @type {number} */ (pos.get(next[i]));
    if (p >= 0) {
      nodes.push(next[i]);
      seq.push(p);
    }
  }
  /** @type {number[]} index of the smallest tail per subsequence length */
  const tails = [];
  /** @type {number[]} previous chain link per element */
  const back = new Array(seq.length).fill(-1);
  for (let i = 0; i < seq.length; i++) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (seq[tails[mid]] < seq[i]) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) back[i] = tails[lo - 1];
    tails[lo] = i;
  }
  const stable = new Set();
  for (let k = tails.length ? tails[tails.length - 1] : -1; k !== -1; k = back[k]) {
    stable.add(nodes[k]);
  }
  return stable;
}
