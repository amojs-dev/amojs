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
 * @type {Root | null} the scope that adopts reactions created now.
 * Ownership follows CREATION, not insertion: whatever a scope makes during
 * its run belongs to it — and is torn down when the scope re-runs or dies.
 */
let activeOwner = null;

const CLEAN = 0;
const MAYBE_DIRTY = 1;
const DIRTY = 2;

const UNSET = Symbol();

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

/**
 * An ownership scope: it owns whatever reactions are created during its run
 * and kills them when it dies. `root()` uses one directly; an Effect IS one
 * that also reacts.
 */
class Root {
  constructor() {
    this.disposed = false;
    /** @type {(Computed | Effect)[] | null} reactions created during our runs */
    this.children = null;
    /** @type {(() => void)[] | null} run before every re-run and on dispose */
    this.cleanups = null;
    /** @type {(() => void)[] | null} run on final dispose only (see onDispose) */
    this.disposals = null;
  }
}

class Effect extends Root {
  /** @param {() => *} fn */
  constructor(fn) {
    if (activeReaction instanceof Computed) {
      throw new Error('amo: no effect() inside computed()');
    }
    super();
    /** the user function (module-internal, not public API) */
    this._fn = fn;
    this.lastWv = 0;
    this.state = DIRTY;
    this.queued = false;
    /** @type {(Signal | Computed)[]} */
    this.deps = [];
    if (activeOwner) (activeOwner.children ??= []).push(this);
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
 * Take a callback list off a scope and run every entry exactly once. Detached
 * before running, so a callback that registers more does not loop forever.
 * @param {Root} o
 * @param {'cleanups' | 'disposals'} key
 */
function drain(o, key) {
  const fns = o[key];
  if (!fns) return;
  o[key] = null;
  for (const fn of fns) fn();
}

/**
 * Tear down what a scope produced during its last run: child reactions
 * (depth-first, children before parents), then the scope's own cleanups.
 * Re-running an effect calls this first — every run starts from a blank
 * slate, so nothing a previous run made can leak.
 * @param {Root} o
 */
function teardown(o) {
  if (o.children) {
    const kids = o.children;
    o.children = null;
    for (const c of kids) dispose(c);
  }
  drain(o, 'cleanups');
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
    drain(r, 'disposals');
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

/**
 * Investigate a MAYBE_DIRTY reaction: refresh its computed deps, then ask
 * whether any dep has actually written since our last run.
 * @param {Computed | Effect} r
 */
function stale(r) {
  for (const d of r.deps) {
    if (d instanceof Computed) refresh(d);
    if (d.wv > r.lastWv) return true;
  }
  return false;
}

/** @param {Computed} c */
function refresh(c) {
  if (c.state === CLEAN) return;
  if (c.state === MAYBE_DIRTY && c._v !== UNSET && !stale(c)) {
    c.state = CLEAN; // proven clean — no recompute, no downstream wake
    return;
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
  if (e.state === MAYBE_DIRTY && !stale(e)) {
    e.state = CLEAN; // woke up, proved itself clean — zero DOM work
    return;
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
  wake();
}

function wake() {
  if (!scheduled) {
    scheduled = true;
    queueMicrotask(flushSync);
  }
}

/**
 * One thrown callback must never strand the rest of the batch: every failure
 * is collected, the queue drains to the end, and the error is re-thrown
 * afterwards. Thrown from the flush means it reaches the platform's uncaught
 * handler — the same place a vanilla listener's exception would land.
 * @param {unknown[]} errors
 */
function rethrow(errors) {
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, 'amo: several callbacks failed');
}

/** Run every queued effect (and post-insertion callback) now. */
export function flushSync() {
  scheduled = false;
  /** @type {unknown[]} */
  const errors = [];
  let e;
  while ((e = queue.shift()) !== undefined) {
    e.queued = false;
    try {
      runEffect(e);
    } catch (err) {
      errors.push(err);
    }
  }
  drainMounts(errors);
  rethrow(errors);
}

/* ------------------------------------------------------------------ */
/* post-insertion callbacks (onMount)                                  */
/* ------------------------------------------------------------------ */

/** @type {(() => void)[]} */
let mounts = [];

/**
 * Run `fn` once, after the nodes built by the current work are in the
 * document — for anything that needs a LIVE node: measuring layout, focus,
 * observers, or handing an element to a third-party library.
 *
 * A component function runs while its nodes are still detached, so this is
 * the moment that does not exist otherwise. Drained by mount() right after
 * insertion, and at the end of every flush (so a component instantiated by a
 * conditional or a list gets it too). Skipped if its scope died first.
 * @param {() => void} fn
 */
export function onMount(fn) {
  const owner = activeOwner;
  mounts.push(owner ? () => { if (!owner.disposed) fn(); } : fn);
  wake(); // safety net for a node appended by hand, without mount()
}

/** @param {unknown[]} errors */
function drainMounts(errors) {
  while (mounts.length > 0) {
    const fns = mounts;
    mounts = []; // a callback may queue more — those run in the next round
    for (const fn of fns) {
      try {
        fn();
      } catch (err) {
        errors.push(err);
      }
    }
  }
}

/** Module-internal: mount() drains synchronously right after inserting. */
export function flushMount() {
  /** @type {unknown[]} */
  const errors = [];
  drainMounts(errors);
  rethrow(errors);
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
      r.disposed = true;
      teardown(r);
      drain(r, 'disposals');
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
    throw new Error('amo: onCleanup() outside a scope');
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
