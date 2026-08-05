/**
 * amo runtime — reactive core.
 *
 * Plain JavaScript + JSDoc on purpose: this file ships to browsers raw,
 * with no build step. Types are enforced by `tsc --checkJs`.
 *
 * The algorithm:
 * - dirtiness is one integer compare — write versions, the Svelte 5 model
 * - computeds are lazy and cut propagation off when their value is unchanged
 * - effects are batched into a microtask and re-verify staleness on wake,
 *   so a scheduled effect may prove itself clean and decline to run
 * - ownership tree (v0.5): reactions belong to the scope that CREATED them;
 *   an effect re-running disposes its previous children, root() opens a
 *   detached scope with an explicit dispose — nothing leaks by default
 */

/** Global write version — bumped only when a value actually changes. */
let writeVersion = 0;

/** @type {Computed | Effect | null} the reaction currently collecting deps */
let activeReaction = null;

/**
 * @type {Effect | Root | null} the scope that adopts reactions created now.
 * Ownership follows CREATION, not insertion: whatever a scope makes during
 * its run belongs to it — and is torn down when the scope re-runs or dies.
 */
let activeOwner = null;

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
    if (activeOwner) (activeOwner.children ??= []).push(this);
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
    if (activeReaction instanceof Computed) {
      throw new Error('amo: an effect cannot be created inside computed() — computeds must stay pure');
    }
    /** the user function (module-internal, not public API) */
    this._fn = fn;
    this.lastWv = 0;
    this.state = DIRTY;
    this.queued = false;
    this.disposed = false;
    /** @type {(Signal | Computed)[]} */
    this.deps = [];
    /** @type {(Computed | Effect)[] | null} reactions created during our runs */
    this.children = null;
    /** @type {(() => void)[] | null} run before every re-run and on dispose */
    this.cleanups = null;
    /** @type {(() => void)[] | null} run on final dispose only (see onDispose) */
    this.disposals = null;
    if (activeOwner) (activeOwner.children ??= []).push(this);
  }
}

/** A plain ownership scope with no reaction of its own (see root()). */
class Root {
  constructor() {
    /** @type {(Computed | Effect)[] | null} */
    this.children = null;
    /** @type {(() => void)[] | null} */
    this.cleanups = null;
    /** @type {(() => void)[] | null} */
    this.disposals = null;
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
  const prevOwner = activeOwner;
  activeReaction = r;
  if (r instanceof Effect) activeOwner = r;
  try {
    return fn();
  } finally {
    activeReaction = prev;
    activeOwner = prevOwner;
  }
}

/* ------------------------------------------------------------------ */
/* ownership: creation scope = lifetime                                */
/* ------------------------------------------------------------------ */

/**
 * Tear down what a scope produced during its last run: child reactions
 * (depth-first, children before parents), then the scope's own cleanups.
 * Re-running an effect calls this first — every run starts from a blank
 * slate, so nothing a previous run made can leak.
 * @param {Effect | Root} o
 */
function teardown(o) {
  if (o.children) {
    const kids = o.children;
    o.children = null;
    for (const c of kids) dispose(c);
  }
  if (o.cleanups) {
    const fns = o.cleanups;
    o.cleanups = null;
    for (const fn of fns) fn();
  }
}

/** @param {Effect | Root} o */
function runDisposals(o) {
  if (o.disposals) {
    const fns = o.disposals;
    o.disposals = null;
    for (const fn of fns) fn();
  }
}

/**
 * Remove a reaction from the graph for good.
 * A disposed computed is only DETACHED: a later read recomputes lazily and
 * resubscribes, so cross-scope references keep working — while an unread
 * computed costs nothing and holds nothing.
 * @param {Computed | Effect} r
 */
function dispose(r) {
  if (r instanceof Effect) {
    if (r.disposed) return;
    r.disposed = true;
    teardown(r);
    runDisposals(r);
  } else {
    r.state = DIRTY;
  }
  for (const d of r.deps) d.subs.delete(r);
  r.deps.length = 0;
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
  teardown(e); // last run's children and cleanups die before the new run
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
  return () => dispose(e);
}

/**
 * Run `fn` inside a fresh, DETACHED ownership scope: children don't attach
 * to the current owner (reorders/re-runs above can't kill them) and reads
 * don't subscribe. `fn` receives the scope's dispose function; its return
 * value is passed through. The caller owns the scope — nothing disposes it
 * automatically.
 * @template T
 * @param {(dispose: () => void) => T} fn
 * @returns {T}
 */
export function root(fn) {
  const r = new Root();
  const prevOwner = activeOwner;
  const prevReaction = activeReaction;
  activeOwner = r;
  activeReaction = null; // reads inside a root are deliberate non-subscriptions
  try {
    return fn(() => {
      teardown(r);
      runDisposals(r);
    });
  } finally {
    activeOwner = prevOwner;
    activeReaction = prevReaction;
  }
}

/**
 * Register teardown for the current scope. Runs before every re-run of the
 * owning effect and once more when the scope is disposed for good.
 * @param {() => void} fn
 */
export function onCleanup(fn) {
  if (!activeOwner) {
    throw new Error('amo: onCleanup() called outside a reactive scope');
  }
  (activeOwner.cleanups ??= []).push(fn);
}

/**
 * Module-internal (used by each()): run `fn` ONLY when the current scope is
 * disposed for good — never on re-runs. Returns false when there is no scope.
 * @param {() => void} fn
 * @returns {boolean}
 */
export function onDispose(fn) {
  if (!activeOwner) return false;
  (activeOwner.disposals ??= []).push(fn);
  return true;
}

/**
 * True for values created by `signal()` or `computed()`.
 * @param {*} v
 * @returns {v is Signal | Computed}
 */
export function isSignal(v) {
  return v instanceof Signal || v instanceof Computed;
}
