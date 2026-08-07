/**
 * amo runtime — templates.
 *
 * `html` is a standard tagged template literal: this whole file runs raw in
 * the browser. A template is parsed ONCE per call site (cached by its strings
 * array), turned into a <template> element, and every instance is
 * cloneNode(true) plus one tiny effect per dynamic hole. No virtual DOM —
 * every hole's DOM position is resolved to a numeric path up front.
 *
 * Hole rule (locked, v0.1) — a hole is exactly one of:
 *   constant  → written once, never reactive
 *   signal    → bound with an effect
 *   function  → wrapped in an effect (for expressions)
 * Holes may appear as element children or as a FULL attribute value.
 * `on*` attribute holes attach real per-element listeners (no delegation —
 * delegation will be an explicit opt-in, never a default).
 */

import { bindChild, bindAttr, bindEvent } from './bind.js';

/* Hole markers use unicode private-use codepoints: they survive HTML parsing
   in both text and attribute positions and cannot collide with real content.
   Built via fromCharCode so no invisible characters live in this source. */
const M_OPEN = String.fromCharCode(0xe000);
const M_CLOSE = String.fromCharCode(0xe001);
const MARKER_RE = new RegExp('[' + M_OPEN + M_CLOSE + ']');
const SPLIT_RE = new RegExp('(' + M_OPEN + '\\d+' + M_CLOSE + ')');
const EXACT_RE = new RegExp('^' + M_OPEN + '(\\d+)' + M_CLOSE + '$');

/**
 * @typedef {{ kind: 'child' | 'attr' | 'event', index: number, path: number[], name: string }} Binding
 * @typedef {{ tpl: HTMLTemplateElement, bindings: Binding[] }} Compiled
 */

/** @type {WeakMap<TemplateStringsArray, Compiled>} */
const cache = new WeakMap();

/**
 * Build a live DOM node from a template literal.
 * @param {TemplateStringsArray} strings
 * @param {...unknown} values
 * @returns {Node}
 */
export function html(strings, ...values) {
  let compiled = cache.get(strings);
  if (!compiled) {
    compiled = compile(strings);
    cache.set(strings, compiled);
  }

  const frag = /** @type {DocumentFragment} */ (compiled.tpl.content.cloneNode(true));

  /* Resolve every target BEFORE binding anything: a child hole can replace its
     one placeholder with several nodes, which shifts the child indexes of
     every later sibling. Compiled output resolves up front for exactly this
     reason — doing it here is what keeps the two modes identical. */
  const nodes = compiled.bindings.map((b) => resolvePath(frag, b.path));

  for (let i = 0; i < compiled.bindings.length; i++) {
    const b = compiled.bindings[i];
    const node = nodes[i];
    if (b.kind === 'child') {
      bindChild(/** @type {Text} */ (node), values[b.index]);
    } else if (b.kind === 'event') {
      bindEvent(/** @type {Element} */ (node), b.name, values[b.index]);
    } else {
      bindAttr(/** @type {Element} */ (node), b.name, values[b.index]);
    }
  }

  return unwrap(frag, compiled);
}

/* ------------------------------------------------------------------ */
/* compile: template string → <template> + positional bindings         */
/* ------------------------------------------------------------------ */

/**
 * @param {TemplateStringsArray} strings
 * @returns {Compiled}
 */
function compile(strings) {
  const tpl = document.createElement('template');
  let text = strings[0];
  for (let i = 1; i < strings.length; i++) {
    text += M_OPEN + (i - 1) + M_CLOSE + strings[i];
  }
  tpl.innerHTML = text;

  /** @type {{ node: Node, kind: Binding['kind'], index: number, name: string }[]} */
  const found = [];
  collect(tpl.content, found);

  // Paths are computed only after all text splitting is done.
  const bindings = found.map((f) => ({
    kind: f.kind,
    index: f.index,
    name: f.name,
    path: pathOf(f.node, tpl.content),
  }));

  /* Children first. An element's live properties must be set AFTER its
     children exist — `<select value=${x}>` cannot select an <option> that has
     not been inserted yet — and that is also the order a human writes:
     build the subtree, then set the property. Sort is stable, so document
     order is preserved within each group. */
  bindings.sort((a, b) => (a.kind === 'child' ? 0 : 1) - (b.kind === 'child' ? 0 : 1));

  return { tpl, bindings };
}

/**
 * @param {Node} root
 * @param {{ node: Node, kind: Binding['kind'], index: number, name: string }[]} found
 */
function collect(root, found) {
  // snapshot: splitting text nodes mutates the child list
  for (const child of [...root.childNodes]) {
    if (child.nodeType === 3 /* TEXT */) {
      splitText(/** @type {Text} */ (child), found);
    } else if (child.nodeType === 1 /* ELEMENT */) {
      scanAttributes(/** @type {Element} */ (child), found);
      collect(child, found);
    }
  }
}

/**
 * Turn `a <marker:0> b` into: text("a "), placeholder(), text(" b") — one
 * empty text node per hole, recorded as a child binding.
 * @param {Text} textNode
 * @param {{ node: Node, kind: Binding['kind'], index: number, name: string }[]} found
 */
function splitText(textNode, found) {
  const data = textNode.data;
  if (!MARKER_RE.test(data)) return;
  const parent = /** @type {Node} */ (textNode.parentNode);
  for (const part of data.split(SPLIT_RE)) {
    const m = part.match(EXACT_RE);
    if (!m && part === '') continue;
    const n = document.createTextNode(m ? '' : part);
    parent.insertBefore(n, textNode);
    if (m) found.push({ node: n, kind: 'child', index: Number(m[1]), name: '' });
  }
  parent.removeChild(textNode);
}

/**
 * @param {Element} el
 * @param {{ node: Node, kind: Binding['kind'], index: number, name: string }[]} found
 */
function scanAttributes(el, found) {
  for (const attr of [...el.attributes]) {
    const m = attr.value.match(EXACT_RE);
    if (!m) {
      if (MARKER_RE.test(attr.value) || MARKER_RE.test(attr.name)) {
        throw new Error(
          `amo: a hole must be the entire attribute value (offending attribute: "${attr.name}")`,
        );
      }
      continue;
    }
    const index = Number(m[1]);
    const name = attr.name; // the HTML parser lowercases: onClick → onclick
    el.removeAttribute(name);
    if (name.startsWith('on')) {
      found.push({ node: el, kind: 'event', index, name: name.slice(2) });
    } else {
      found.push({ node: el, kind: 'attr', index, name });
    }
  }
}

/**
 * @param {Node} node
 * @param {Node} root
 * @returns {number[]} child indexes from root down to node
 */
function pathOf(node, root) {
  /** @type {number[]} */
  const path = [];
  let n = node;
  while (n !== root) {
    const parent = /** @type {Node} */ (n.parentNode);
    path.unshift([...parent.childNodes].indexOf(/** @type {ChildNode} */ (n)));
    n = parent;
  }
  return path;
}

/**
 * @param {Node} root
 * @param {number[]} path
 * @returns {Node}
 */
function resolvePath(root, path) {
  let n = root;
  for (const i of path) n = n.childNodes[i];
  return n;
}

/* ------------------------------------------------------------------ */
/* binding lives in bind.js — shared with compiled mode                */
/* ------------------------------------------------------------------ */
/* ergonomics: single-root templates hand back the element itself      */
/* ------------------------------------------------------------------ */

/**
 * @param {DocumentFragment} frag
 * @param {Compiled} compiled
 * @returns {Node}
 */
function unwrap(frag, compiled) {
  // a root-level child hole means the fragment itself carries live nodes
  const hasRootBinding = compiled.bindings.some(
    (b) => b.kind === 'child' && b.path.length === 1,
  );
  if (hasRootBinding) return frag;

  const el = frag.firstElementChild;
  if (!el || el !== frag.lastElementChild) return frag;
  for (const n of frag.childNodes) {
    if (n === el) continue;
    if (!(n.nodeType === 3 && !/\S/.test(/** @type {Text} */ (n).data))) return frag;
  }
  return el;
}
