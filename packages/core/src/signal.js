/**
 * amo runtime — reactive core.
 *
 * Plain JavaScript + JSDoc on purpose: this file ships to browsers raw,
 * with no build step. Types are enforced by `tsc --checkJs`.
 *
 * The algorithm (see learn/fine-grained-internals.html for the full story):
 * - dirtiness is one integer compare — write versions, the Svelte 5 model
 * - computeds are lazy and cut propagation off when their value is unchanged
 * - effects are batched into a microtask and re-verify staleness on wake,
 *   so a scheduled effect may prove itself clean and decline to run
 */

/** Global write version — bumped only when a value actually changes. */
let writeVersion = 0;

/** @type {Computed | Effect | null} the reaction currently collecting deps */
let activeReaction = null;

const CLEAN = 0;
const MAYBE_DIRTY = 1;
const DIRTY = 2;

const UNSET = Symbol('amo.unset');

export class Signal {
  /** @param {*} value */
  constructor(value) {
    /** @private */
    this._v = value;
    /** write version of the last actual change */
    this.wv = 0;
    /** @type {Set<Computed | Effect>} */
    this.subs = new Set();
  }

  get value() {
    track(this);
    return this._v;
  }

  set value(next) {
    if (Object.is(next, this._v)) return; // cutoff at the source
    this._v = next;
    this.wv = ++writeVersion;
    for (const r of this.subs) mark(r, DIRTY);
  }

  /** Read the current value without subscribing. */
  peek() {
    return this._v;
  }
}

export class Computed {
  /** @param {() => *} fn */
  constructor(fn) {
    /** the user computation (module-internal, not public API) */
    this._fn = fn;
    /** @type {*} cached value (module-internal, not public API) */
    this._v = UNSET;
    /** write version of the last actual value change */
    this.wv = 0;
    /** global writeVersion as of the last recompute */
    this.lastWv = 0;
    /** born dirty: nothing is computed until somebody reads */
    this.state = DIRTY;
    /** @type {(Signal | Computed)[]} */
    this.deps = [];
    /** @type {Set<Computed | Effect>} */
    this.subs = new Set();
  }

  get value() {
    track(this);
    refresh(this);
    return this._v;
  }

  /** Read (recomputing if needed) without subscribing. */
  peek() {
    refresh(this);
    return this._v;
  }
}

class Effect {
  /** @param {() => *} fn */
  constructor(fn) {
    /** the user function (module-internal, not public API) */
    this._fn = fn;
    this.lastWv = 0;
    this.state = DIRTY;
    this.queued = false;
    this.disposed = false;
    /** @type {(Signal | Computed)[]} */
    this.deps = [];
  }
}

/* ------------------------------------------------------------------ */
/* tracking                                                            */
/* ------------------------------------------------------------------ */

/** @param {Signal | Computed} dep */
function track(dep) {
  const r = activeReaction;
  if (!r) return;
  if (!r.deps.includes(dep)) {
    r.deps.push(dep);
    dep.subs.add(r);
  }
}

/**
 * Re-run a reaction's function with fresh dependency collection.
 * @param {Computed | Effect} r
 * @param {() => *} fn
 */
function runWith(r, fn) {
  for (const d of r.deps) d.subs.delete(r);
  r.deps.length = 0;
  const prev = activeReaction;
  activeReaction = r;
  try {
    return fn();
  } finally {
    activeReaction = prev;
  }
}

/* ------------------------------------------------------------------ */
/* push phase: only paint flags, never compute                         */
/* ------------------------------------------------------------------ */

/**
 * Direct subscribers of a changed signal become DIRTY; everything further
 * downstream only learns "maybe" — the pull phase turns maybe into proof.
 * @param {Computed | Effect} r
 * @param {number} state
 */
function mark(r, state) {
  if (r.state >= state) {
    if (r instanceof Effect) schedule(r);
    return;
  }
  const wasClean = r.state === CLEAN;
  r.state = state;
  if (r instanceof Effect) {
    schedule(r);
    return;
  }
  // computed: propagate "maybe" once; upgrades (MAYBE→DIRTY) don't re-propagate
  if (wasClean) for (const sub of r.subs) mark(sub, MAYBE_DIRTY);
}

/* ------------------------------------------------------------------ */
/* pull phase: recompute only with proof                               */
/* ------------------------------------------------------------------ */

/** @param {Computed} c */
function refresh(c) {
  if (c.state === CLEAN) return;
  if (c.state === MAYBE_DIRTY && c._v !== UNSET) {
    // investigate: refresh own deps first, then compare write versions
    let stale = false;
    for (const d of c.deps) {
      if (d instanceof Computed) refresh(d);
      if (d.wv > c.lastWv) {
        stale = true;
        break;
      }
    }
    if (!stale) {
      c.state = CLEAN; // proven clean — no recompute, no downstream wake
      return;
    }
  }
  const next = runWith(c, c._fn);
  c.lastWv = writeVersion;
  c.state = CLEAN;
  if (!Object.is(next, c._v)) {
    c._v = next;
    c.wv = ++writeVersion; // value really changed → downstream may care
  }
  // unchanged value → wv stays put → subscribers prove themselves clean
}

/** @param {Effect} e */
function runEffect(e) {
  if (e.disposed) return;
  if (e.state === MAYBE_DIRTY) {
    // woke up from the queue — but is anything actually newer?
    let stale = false;
    for (const d of e.deps) {
      if (d instanceof Computed) refresh(d);
      if (d.wv > e.lastWv) {
        stale = true;
        break;
      }
    }
    if (!stale) {
      e.state = CLEAN; // nothing to do — go back to sleep, zero DOM work
      return;
    }
  }
  runWith(e, e._fn);
  e.lastWv = writeVersion;
  e.state = CLEAN;
}

/* ------------------------------------------------------------------ */
/* scheduling                                                          */
/* ------------------------------------------------------------------ */

/** @type {Effect[]} */
const queue = [];
let scheduled = false;

/** @param {Effect} e */
function schedule(e) {
  if (e.queued || e.disposed) return;
  e.queued = true;
  queue.push(e);
  if (!scheduled) {
    scheduled = true;
    queueMicrotask(flushSync);
  }
}

/** Run every queued effect now. (Normally happens automatically in a microtask.) */
export function flushSync() {
  scheduled = false;
  let e;
  while ((e = queue.shift()) !== undefined) {
    e.queued = false;
    runEffect(e);
  }
}

/** @returns {Promise<void>} resolves after pending effects have flushed */
export function tick() {
  return new Promise((resolve) => {
    queueMicrotask(() => {
      flushSync();
      resolve();
    });
  });
}

/* ------------------------------------------------------------------ */
/* public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Create a reactive value.
 * @param {*} initial
 */
export function signal(initial) {
  return new Signal(initial);
}

/**
 * Create a lazy, cached derivation. It never computes until read, and it
 * never wakes its subscribers when a recompute produces an equal value.
 * @param {() => *} fn
 */
export function computed(fn) {
  return new Computed(fn);
}

/**
 * Run `fn` now, then re-run it whenever anything it read changes.
 * @param {() => *} fn
 * @returns {() => void} dispose
 */
export function effect(fn) {
  const e = new Effect(fn);
  runEffect(e);
  return () => {
    e.disposed = true;
    for (const d of e.deps) d.subs.delete(e);
    e.deps.length = 0;
  };
}

/**
 * True for values created by `signal()` or `computed()`.
 * @param {*} v
 * @returns {v is Signal | Computed}
 */
export function isSignal(v) {
  return v instanceof Signal || v instanceof Computed;
}
