import { signal, root, mount } from '@amojs.dev/core/runtime';

/** @typedef {ReturnType<typeof signal<string | null>>} AttrSignal */

/**
 * Register `name` as a custom element that mounts `component` while it is in
 * the document and disposes it when it leaves.
 *
 * `component` receives ONE props object: a `Signal<string | null>` per name
 * in `options.attrs`, kept in sync with that attribute, plus `host` — the
 * element itself (dispatch events from it, read its light-DOM children).
 *
 * @template {string} [A=never]
 * @param {string} name  a valid custom element name — the platform validates it
 * @param {(props: { [K in A]: AttrSignal } & { host: HTMLElement }) => Node} component
 * @param {{ attrs?: A[], shadow?: 'open' | 'closed' }} [options]
 *   `attrs`: observed attribute names (lowercase, as HTML stores them);
 *   `shadow`: render into a shadow root of that mode instead of the light DOM
 * @returns {CustomElementConstructor} the class — the same one `customElements.get(name)` returns
 */
export function define(name, component, options = {}) {
  if (typeof customElements === 'undefined') {
    throw new Error('amo: define() needs a browser');
  }
  if (customElements.get(name)) {
    throw new Error(`amo: <${name}> is already defined`);
  }
  const { attrs = [], shadow } = options;

  class AmoElement extends HTMLElement {
    static observedAttributes = attrs;

    /** @type {Record<string, AttrSignal>} */
    #attrs = {};
    /** @type {any} */
    #props;
    /** @type {HTMLElement | ShadowRoot | undefined} */
    #target;
    /** @type {(() => void) | undefined} */
    #unmount;

    constructor() {
      super();
      for (const a of attrs) this.#attrs[a] = signal(/** @type {string | null} */ (null));
      this.#props = { ...this.#attrs, host: this };
    }

    connectedCallback() {
      for (const a of attrs) this.#attrs[a].value = this.getAttribute(a);
      const target = (this.#target ??= shadow ? this.attachShadow({ mode: shadow }) : this);
      this.#unmount = root((dispose) => {
        const node = component(this.#props);
        // a top-level hole inserts before its own anchor, so [start, end] holds every node we own
        const start = target.appendChild(document.createTextNode(''));
        mount(node, /** @type {HTMLElement} */ (target));
        const end = target.lastChild;
        return () => {
          dispose();
          for (let n = /** @type {ChildNode | null} */ (start); n; ) {
            const next = n === end ? null : n.nextSibling;
            n.remove();
            n = next;
          }
        };
      });
    }

    disconnectedCallback() {
      this.#unmount?.();
      this.#unmount = undefined;
    }

    /**
     * @param {string} attr
     * @param {string | null} _old
     * @param {string | null} value
     */
    attributeChangedCallback(attr, _old, value) {
      this.#attrs[attr].value = value;
    }
  }

  customElements.define(name, AmoElement);
  return AmoElement;
}
