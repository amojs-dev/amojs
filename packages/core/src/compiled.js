/**
 * amo runtime — helpers for COMPILED output only.
 *
 * Generated code imports the '@amojs.dev/core/compiled' entry. This module never
 * touches the template parser: a fully compiled app ships signal.js +
 * bind.js + this file — nothing else. That missing parser IS the size win.
 */

export { bindChild, bindAttr, bindEvent } from './bind.js';

/**
 * Cached template factory for compiled output.
 *
 * `htmlText` is parsed once (lazily, on first use — never at module top
 * level, LOCKED RULE #5). Each child hole sits in the markup as an empty
 * `<!---->` comment (the separator that keeps adjacent static text nodes
 * apart); it is swapped for an empty text node once, on the cached content —
 * clones then carry the placeholders for free, exactly like raw mode after
 * its splitText pass.
 *
 * @param {string} htmlText
 * @param {number[][]} placeholderPaths
 * @param {number} [svg]  1 for an svg`` template: parsed inside an <svg> wrapper that is then dropped
 * @returns {() => DocumentFragment}
 */
export function tpl(htmlText, placeholderPaths, svg) {
  /** @type {DocumentFragment | null} */
  let content = null;
  return () => {
    if (!content) {
      const t = document.createElement('template');
      t.innerHTML = svg ? '<svg>' + htmlText + '</svg>' : htmlText;
      if (svg) t.content.replaceChildren(.../** @type {Element} */ (t.content.firstChild).childNodes);
      for (const path of placeholderPaths) {
        /** @type {Node} */
        let marker = t.content;
        for (const idx of path) marker = marker.childNodes[idx];
        /** @type {Node} */ (marker.parentNode).replaceChild(
          document.createTextNode(''),
          marker,
        );
      }
      content = t.content;
    }
    return /** @type {DocumentFragment} */ (content.cloneNode(true));
  };
}
