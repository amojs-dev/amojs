/**
 * amo runtime — hole binding, shared by BOTH modes.
 *
 * The hole rule lives here exactly once:
 *   constant → written once · signal → reactive binding · function → effect
 *
 * Raw mode (html.js) and compiled output (via compiled.js) call these same
 * functions — which is what makes "identical behavior in both modes" true
 * by construction rather than by discipline.
 */

import { effect, isSignal } from './signal.js';
import { reconcile } from './list.js';

/**
 * @param {*} v
 * @returns {string}
 */
export function asText(v) {
  return v == null || v === false ? '' : String(v);
}

/**
 * Bind a value to a placeholder text node (a child hole).
 *
 * Reactive values (signal | function) may produce text, a Node, or an array
 * of Nodes — and may switch between those shapes over time. The placeholder
 * text node doubles as the block ANCHOR: block nodes always sit immediately
 * before it, so conditionals and keyed lists need no extra markers.
 *
 * @param {Text} placeholder
 * @param {*} v
 */
export function bindChild(placeholder, v) {
  if (isSignal(v)) {
    reactiveChild(placeholder, () => v.value);
  } else if (typeof v === 'function') {
    reactiveChild(placeholder, v);
  } else if (v instanceof Node) {
    // constant — written once
    placeholder.replaceWith(...normalizeNodes(v));
  } else if (Array.isArray(v)) {
    placeholder.replaceWith(...v.map(assertNode));
  } else {
    placeholder.data = asText(v);
  }
}

/**
 * @param {Text} anchor
 * @param {() => *} read
 */
function reactiveChild(anchor, read) {
  /** @type {Node[]} nodes currently rendered by this hole (block mode) */
  let block = [];
  let textMode = true;
  effect(() => {
    let v = read();
    if (v instanceof Node) v = normalizeNodes(v);
    if (Array.isArray(v)) {
      v.forEach(assertNode);
      if (textMode) {
        anchor.data = '';
        textMode = false;
      }
      const parent = /** @type {Node} */ (anchor.parentNode);
      reconcile(parent, block, v, anchor);
      block = v.slice();
    } else {
      if (!textMode) {
        const parent = /** @type {Node} */ (anchor.parentNode);
        for (const n of block) parent.removeChild(n);
        block = [];
        textMode = true;
      }
      const t = asText(v);
      if (anchor.data !== t) anchor.data = t; // cutoff at the DOM boundary too
    }
  });
}

/**
 * A DocumentFragment melts into its children on insertion — capture them.
 * @param {Node} v
 * @returns {Node[]}
 */
function normalizeNodes(v) {
  return v.nodeType === 11 ? [...v.childNodes] : [v];
}

/**
 * @param {*} n
 * @returns {Node}
 */
function assertNode(n) {
  if (!(n instanceof Node)) {
    throw new Error('amo: array holes must contain DOM nodes only');
  }
  if (n.nodeType === 11) {
    throw new Error('amo: array holes cannot contain fragments — use single-root templates');
  }
  return n;
}

/**
 * Bind a value to an attribute (a full-value attr hole).
 * null/undefined/false remove the attribute; true sets it empty.
 * Writes are skipped when the DOM already holds the same value — an effect
 * re-running must never cause DOM work its result doesn't require.
 * @param {Element} el
 * @param {string} name
 * @param {*} v
 */
export function bindAttr(el, name, v) {
  /** @param {*} val */
  const apply = (val) => {
    if (val == null || val === false) {
      if (el.hasAttribute(name)) el.removeAttribute(name);
    } else {
      const s = val === true ? '' : String(val);
      if (el.getAttribute(name) !== s) el.setAttribute(name, s);
    }
  };
  if (isSignal(v)) effect(() => apply(v.value));
  else if (typeof v === 'function') effect(() => apply(v()));
  else apply(v);
}
