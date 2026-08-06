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
  } else if (isNodeish(v)) {
    placeholder.replaceWith(...toNodes(v)); // constant — written once
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
    const v = read();
    const parent = /** @type {Node} */ (anchor.parentNode);
    if (isNodeish(v)) {
      const nodes = toNodes(v);
      if (textMode) {
        anchor.data = '';
        textMode = false;
      }
      reconcile(parent, block, nodes, anchor);
      block = nodes;
    } else {
      if (!textMode) {
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
 * @param {*} v
 * @returns {boolean} does this value render as nodes rather than as text?
 */
function isNodeish(v) {
  return v instanceof Node || Array.isArray(v);
}

/**
 * The node list a value renders to. A DocumentFragment melts into its
 * children on insertion, so capture them up front; anything else must be a
 * plain node (a fragment nested in an array has no stable identity).
 * @param {Node | *[]} v
 * @returns {Node[]}
 */
function toNodes(v) {
  if (v instanceof Node) return v.nodeType === 11 ? [...v.childNodes] : [v];
  return v.map((n) => {
    if (!(n instanceof Node) || n.nodeType === 11) {
      throw new Error('amo: array holes take non-fragment nodes only');
    }
    return n;
  });
}

/**
 * Attach an `on*` hole's listener.
 *
 * A listener must be a FUNCTION. Every other hole position accepts a signal,
 * so handing one to `onclick=${…}` is the natural mistake — and passing a
 * non-callable to addEventListener fails in total silence, forever. One
 * explicit throw is worth more than a listener that never runs.
 *
 * @param {Element} el
 * @param {string} name  event name without the `on` prefix
 * @param {*} v
 */
export function bindEvent(el, name, v) {
  if (typeof v !== 'function') {
    throw new Error(`amo: on${name} needs a function, not a ${isSignal(v) ? 'signal' : typeof v}`);
  }
  el.addEventListener(name, v);
}

/**
 * Bind a value to an attribute (a full-value attr hole).
 * null/undefined/false remove the attribute; true sets it empty.
 * Writes are skipped when the DOM already holds the same value — an effect
 * re-running must never cause DOM work its result doesn't require.
 *
 * `ref` is the one reserved name: it hands the element over instead of
 * writing an attribute. Handled here rather than in the compiler, so raw and
 * compiled mode get it from the same three lines.
 * @param {Element} el
 * @param {string} name
 * @param {*} v
 */
export function bindAttr(el, name, v) {
  if (name === 'ref') {
    // one-shot identity handoff, never reactive: a function is called with
    // the element, a signal receives it. The node exists but is NOT in the
    // document yet — pair it with onMount() when you need a live node.
    if (typeof v === 'function') v(el);
    else v.value = el;
    return;
  }

  /* For form state the attribute is only the DEFAULT and the live property is
     the truth: setAttribute('value') stops showing after the user types, and
     the `checked` attribute never follows a click. `<textarea value>` and
     `<select value>` are not attributes at all. So for these names — and only
     when the element really has the property — write the property, which is
     also what a human writing vanilla does. */
  const asProp = PROPS.has(name) && name in el;

  /** @param {*} val */
  const apply = (val) => {
    if (asProp) {
      // the element's own property type decides the coercion
      const cur = /** @type {*} */ (el)[name];
      const next =
        typeof cur === 'boolean' ? !!val : val == null || val === false ? '' : String(val);
      if (cur !== next) /** @type {*} */ (el)[name] = next;
    } else if (val == null || val === false) {
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

/** names whose attribute and live property genuinely diverge */
const PROPS = new Set(['value', 'checked', 'selected', 'indeterminate']);
