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

/**
 * @param {*} v
 * @returns {string}
 */
export function asText(v) {
  return v == null || v === false ? '' : String(v);
}

/**
 * Bind a value to a placeholder text node (a child hole).
 * @param {Text} placeholder
 * @param {*} v
 */
export function bindChild(placeholder, v) {
  if (isSignal(v)) {
    effect(() => {
      placeholder.data = asText(v.value);
    });
  } else if (typeof v === 'function') {
    effect(() => {
      placeholder.data = asText(v());
    });
  } else if (v instanceof Node) {
    placeholder.replaceWith(v);
  } else if (Array.isArray(v)) {
    throw new Error('amo: arrays in holes arrive with keyed lists (v0.3)');
  } else {
    placeholder.data = asText(v);
  }
}

/**
 * Bind a value to an attribute (a full-value attr hole).
 * null/undefined/false remove the attribute; true sets it empty.
 * @param {Element} el
 * @param {string} name
 * @param {*} v
 */
export function bindAttr(el, name, v) {
  /** @param {*} val */
  const apply = (val) => {
    if (val == null || val === false) el.removeAttribute(name);
    else if (val === true) el.setAttribute(name, '');
    else el.setAttribute(name, String(val));
  };
  if (isSignal(v)) effect(() => apply(v.value));
  else if (typeof v === 'function') effect(() => apply(v()));
  else apply(v);
}
