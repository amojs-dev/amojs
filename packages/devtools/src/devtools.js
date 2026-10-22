/**
 * amo devtools — paints the DOM work a page does, observed from outside.
 * No runtime hooks: it watches DOM mutations, so it sees any code's writes.
 */

/**
 * @typedef {{ write: string, insert: string, remove: string, move: string }} Colors
 * @typedef {{ colors?: Partial<Colors>, panel?: boolean }} Options
 * @typedef {'text' | 'attr' | 'insert' | 'remove' | 'move'} Kind
 * @typedef {{ x: number, y: number, p: Element }} Box
 */

/** @type {Colors} */
const COLORS = { write: '#fde047', insert: '#86efac', remove: '#fca5a5', move: '#93c5fd' };

/** @type {[Kind, string, keyof Colors][]} */
const LINES = [
  ['text', 'text writes', 'write'],
  ['attr', 'attribute writes', 'write'],
  ['insert', 'insertions', 'insert'],
  ['remove', 'removals', 'remove'],
  ['move', 'moves', 'move'],
];

/** when one element gets several marks in a batch, the strongest wins */
const RANK = { write: 1, remove: 2, move: 3, insert: 4 };

const CSS =
  '.p{font:11px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;color:#f4f4f5;direction:ltr;' +
  'background:#18181be6;border-radius:8px;padding:8px 10px;min-width:180px}' +
  '.p div{display:flex;align-items:center;gap:6px}' +
  '.p i{width:8px;height:8px;border-radius:50%}' +
  '.p b{margin-left:auto}' +
  '.p .last{border-top:1px solid #ffffff2e;margin-top:4px;padding-top:4px}';

/**
 * Show every DOM write under `target` as it happens: a flash per write, a
 * FLIP glide per move, and a panel of running counts.
 * @param {Element} [target]  defaults to document.body
 * @param {Options} [options]
 * @returns {() => void} dispose — disconnects, removes the panel, cancels animations
 */
export function devtools(target, options = {}) {
  const root = target ?? document.body;
  if (!root) throw new Error('amo devtools: no target (call it once <body> exists)');
  const colors = { ...COLORS, ...options.colors };
  const totals = { text: 0, attr: 0, insert: 0, remove: 0, move: 0 };
  /** last resting position of every element, read after each batch */
  const boxes = /** @type {WeakMap<Element, Box>} */ (new WeakMap());
  const running = /** @type {Set<Animation>} */ (new Set());
  const panel = options.panel === false ? null : makePanel(colors);
  const host = panel && panel.host;

  /** @param {Element} el @param {Keyframe[]} frames @param {KeyframeAnimationOptions} opts */
  const play = (el, frames, opts) => {
    const a = el.animate?.(frames, opts);
    if (!a) return;
    running.add(a);
    a.onfinish = a.oncancel = () => running.delete(a);
  };

  const measure = () => {
    for (const el of root.getElementsByTagName('*')) {
      const b = box(el);
      if (b) boxes.set(el, b);
    }
  };

  /** @param {MutationRecord[]} records */
  const onBatch = (records) => {
    const batch = { text: 0, attr: 0, insert: 0, remove: 0, move: 0 };
    /** @type {Map<Element, keyof Colors>} */
    const marks = new Map();
    /** @param {Node | null | undefined} n @param {keyof Colors} kind */
    const mark = (n, kind) => {
      let el = n && (n.nodeType === 1 ? /** @type {Element} */ (n) : n.parentElement);
      if (!el || !root.contains(el)) return;
      // only the outermost <svg> paints a box
      while (el instanceof SVGElement && el.ownerSVGElement) el = el.ownerSVGElement;
      const had = marks.get(el);
      if (!had || RANK[kind] > RANK[had]) marks.set(el, kind);
    };
    /** node → was its first change in this batch a removal (it existed before)? */
    const first = /** @type {Map<Node, boolean>} */ (new Map());
    /** node → the parent it was last removed from */
    const left = /** @type {Map<Node, Node>} */ (new Map());

    for (const m of records) {
      if (m.target === host) continue;
      if (m.type === 'characterData') {
        batch.text++;
        mark(m.target, 'write');
      } else if (m.type === 'attributes') {
        batch.attr++;
        mark(m.target, 'write');
      } else {
        for (const n of m.removedNodes) {
          if (n === host) continue;
          if (!first.has(n)) first.set(n, true);
          left.set(n, m.target);
        }
        for (const n of m.addedNodes) if (n !== host && !first.has(n)) first.set(n, false);
      }
    }

    /** @type {[Element, number, number][]} */
    const glides = [];
    const moved = /** @type {Set<Node>} */ (new Set());
    for (const [n, existed] of first) {
      const here = root.contains(n);
      if (existed && here) {
        // removed and re-inserted in one batch: the same node moved
        batch.move++;
        moved.add(n);
        mark(n, 'move');
        if (n.nodeType !== 1) continue;
        const el = /** @type {Element} */ (n);
        const was = boxes.get(el);
        const now = box(el);
        if (was && now && was.p === now.p && (was.x !== now.x || was.y !== now.y)) {
          glides.push([el, was.x - now.x, was.y - now.y]);
        }
        continue;
      }
      if (!existed) {
        batch.insert++;
        if (here) mark(n, 'insert');
      }
      if (!here) {
        batch.remove++;
        mark(left.get(n), 'remove');
      }
    }

    // a node displaced but not moved this time drops its old glide: untouched nodes do not animate
    for (const a of running) {
      const fx = /** @type {KeyframeEffect} */ (a.effect);
      const el = fx.target;
      if (fx.composite !== 'add' || !el || moved.has(el)) continue;
      const was = boxes.get(el);
      const now = box(el);
      if (was && now && (was.x !== now.x || was.y !== now.y)) a.cancel();
    }
    measure();
    for (const [el, dx, dy] of glides) {
      // additive, so an author transform and a still-running glide both survive
      play(el, [{ transform: `translate(${dx}px,${dy}px)` }, { transform: 'none' }], {
        duration: 400, easing: 'cubic-bezier(.2,.7,.2,1)', composite: 'add',
      });
    }
    for (const [el, kind] of marks) {
      const c = colors[kind];
      // no end keyframe value: the flash fades back to the element's own style
      play(el, [{ backgroundColor: c, boxShadow: `inset 0 0 0 2px ${c}` }, {}], {
        duration: 600, easing: 'ease-out',
      });
    }

    let sum = 0;
    for (const k of /** @type {Kind[]} */ (Object.keys(batch))) {
      totals[k] += batch[k];
      sum += batch[k];
    }
    if (panel && sum) panel.show(totals, sum);
  };

  measure();
  const mo = new MutationObserver(onBatch);
  mo.observe(root, { subtree: true, childList: true, attributes: true, characterData: true });

  // a key or pointer press starts a fresh "last batch", so an input that changes nothing reads 0
  const fresh = () => panel?.show(totals, 0);
  if (panel) {
    addEventListener('pointerdown', fresh, true);
    addEventListener('keydown', fresh, true);
  }

  let live = true;
  return () => {
    if (!live) return;
    live = false;
    mo.disconnect();
    for (const a of running) a.cancel();
    running.clear();
    if (panel) {
      removeEventListener('pointerdown', fresh, true);
      removeEventListener('keydown', fresh, true);
      panel.host.remove();
    }
  };
}

/**
 * Layout position, read with offsets because they ignore transforms — so a
 * running glide never corrupts the next measurement.
 * @param {Element} el
 * @returns {Box | null}
 */
function box(el) {
  if (!(el instanceof HTMLElement)) return null;
  const p = el.offsetParent;
  return p ? { x: el.offsetLeft, y: el.offsetTop, p } : null;
}

/**
 * The counts panel. It lives in a shadow root, which a MutationObserver on
 * the page never sees — so its own updates can never be counted.
 * @param {Colors} colors
 */
function makePanel(colors) {
  const host = document.createElement('div');
  host.setAttribute('data-amo-devtools', '');
  host.style.cssText =
    'position:fixed;right:8px;bottom:8px;z-index:2147483647;pointer-events:none;margin:0;padding:0';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = CSS;
  const p = document.createElement('div');
  p.className = 'p';
  /** @type {Record<string, HTMLElement>} */
  const cells = {};
  /** @param {string} kind @param {string} label @param {string} [color] */
  const line = (kind, label, color) => {
    const row = document.createElement('div');
    row.dataset.kind = kind;
    const dot = document.createElement('i');
    if (color) dot.style.background = color;
    const n = document.createElement('b');
    n.textContent = '0';
    row.append(dot, label, n);
    p.append(row);
    return (cells[kind] = n);
  };
  for (const [kind, label, color] of LINES) line(kind, label, colors[color]);
  line('last', 'last batch').parentElement?.classList.add('last');
  shadow.append(style, p);
  document.body.append(host);
  return {
    host,
    /** @param {Record<Kind, number>} totals @param {number} last */
    show(totals, last) {
      for (const [kind] of LINES) cells[kind].textContent = String(totals[kind]);
      cells.last.textContent = String(last);
    },
  };
}
