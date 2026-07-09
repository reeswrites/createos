// physics.js — physics simulations as a signal-source category (ADR 059).
//
// The sixth register-beside-your-code registry (siblings: onReset, registerSource,
// registerWindowType, registerDesktopFileType, registerWidgetRestorer):
//   registerPhysicsSource(name, spec)  — declare a sim beside its own code
//   physics(name, opts)                — user factory → a PhysicsInstance handle
//
// A sim is DUAL-CHARACTER:
//   • continuous CHANNELS — each a plain `() => value` reader (route() eats it with
//     zero new branch); metadata (label, hint range) rides along via Object.assign.
//   • discrete EVENTS     — dual-emitted bus events: `physics:{name}:{event}` (all
//     instances of a type) AND `physics:{id}:{event}` (one instance).
//
// One shared fixed-step clock (native RAF, gated on isPaused) advances every live
// sim with a fixed internal dt + substep accumulator, so integration is
// frame-rate-independent and chaotic sims stay stable. Two sim kinds ride the same
// accumulator: CONTINUOUS (step(state, dt, emit), substepped) and ITERATED maps
// (iterate(state, emit) at a declared rate — its "dt" is 1/rate).
//
// A sim is an INPUT (owner-scoped teardown, NO keep-alive) — its debug window / a
// downstream sink is the output. It SURVIVES soft reset by identity (like Canvas,
// ADR 040) so a chaotic trajectory doesn't snap back to initial conditions on every
// keystroke. Hard reset / stop / debug-window close destroys it.

import { onReset } from '../../runtime/reset-registry.js';
import { activeEditorId, isPaused } from '../../runtime/run-context.js';
import { liveOutput } from '../../runtime/keep-alive.js';
import { notify } from '../../events/bus.js';

// Native RAF captured before user-code patching (same discipline as route.js).
// Optional-chained so a headless/jsdom env without RAF degrades to a dormant clock
// (tests drive sims deterministically via _advance()).
const _nativeRAF = window.requestAnimationFrame?.bind(window) ?? null;
const _nativeCancelRAF = window.cancelAnimationFrame?.bind(window) ?? (() => {});

// ── Registry ────────────────────────────────────────────────────────────────────
const _specs = new Map(); // name → normalized spec

/**
 * Register a physics-sim source. Called beside the sim's own code (module load).
 * @param {string} name
 * @param {object} spec
 *   init(opts) -> state            build initial state (seed params from opts + defaults)
 *   step(state, dt, emit)          continuous integrator (per substep). XOR iterate.
 *   iterate(state, emit)           iterated map (per tick at `rate` Hz). XOR step.
 *   rate                           Hz for iterated maps (default 60)
 *   dt                             fixed substep seconds for continuous (default 1/240)
 *   substeps                       max substeps per frame (default 8, spiral guard)
 *   channels: { name: { get(state)->number, norm?:[lo,hi] } }
 *   render(ctx, state, w, h)       optional debug draw (else generic channel bars)
 *   onSet(state, key, val)         optional param-set hook (default: state[key]=val)
 */
export function registerPhysicsSource(name, spec) {
  if (!name || typeof name !== 'string') throw new Error('registerPhysicsSource: name required');
  if (typeof spec?.init !== 'function')
    throw new Error(`registerPhysicsSource(${name}): init() required`);
  if (typeof spec.step !== 'function' && typeof spec.iterate !== 'function')
    throw new Error(`registerPhysicsSource(${name}): step() or iterate() required`);
  _specs.set(name, {
    name,
    init: spec.init,
    step: spec.step ?? null,
    iterate: spec.iterate ?? null,
    rate: spec.rate ?? 60,
    dt: spec.dt ?? 1 / 240,
    substeps: spec.substeps ?? 8,
    channels: spec.channels ?? {},
    render: spec.render ?? null,
    onSet: spec.onSet ?? null,
  });
}

/** Names of all registered sims (toolkit / diagnostics). */
export function physicsSimNames() {
  return [..._specs.keys()];
}

// ── Live-instance set + one shared clock ────────────────────────────────────────
const _live = new Set(); // running PhysicsInstances
const _byKey = new Map(); // identity key → instance (soft-reset reuse)
const _autoIndex = new Map(); // name → counter (auto ids when none supplied)
let _raf = null;
let _lastNow = 0;

function _startClock() {
  if (_raf != null || !_nativeRAF) return;
  _lastNow = 0;
  const frame = (now) => {
    const frameDt = _lastNow ? (now - _lastNow) / 1000 : 0;
    _lastNow = now;
    if (!isPaused()) {
      for (const inst of _live) inst._advance(frameDt);
    }
    // Draw regardless of pause so a paused sim shows its frozen state.
    for (const inst of _live) inst._draw();
    _raf = _live.size ? _nativeRAF(frame) : null;
    if (_raf == null) _lastNow = 0;
  };
  _raf = _nativeRAF(frame);
}

function _stopClockIfIdle() {
  if (_live.size === 0 && _raf != null) {
    _nativeCancelRAF(_raf);
    _raf = null;
    _lastNow = 0;
  }
}

// ── PhysicsInstance ─────────────────────────────────────────────────────────────

class PhysicsInstance {
  constructor(spec, opts) {
    this.spec = spec;
    this.name = spec.name;
    const { id } = opts;
    // Stable identity across re-runs: explicit id, else name + opts signature — so
    // re-running the same `physics('pendulum',{damp:0})` on a keystroke reuses this
    // instance and continues the trajectory (soft-reset survival, like Canvas).
    const { id: _omit, ...rest } = opts;
    this._key = id != null ? `id:${id}` : `${spec.name}|${JSON.stringify(rest)}`;
    // Human id for the per-instance event namespace.
    if (id != null) {
      this.id = String(id);
    } else {
      const n = _autoIndex.get(spec.name) ?? 0;
      _autoIndex.set(spec.name, n + 1);
      this.id = `${spec.name}${n}`;
    }

    this.state = spec.init({ ...opts });
    this._dt = spec.iterate ? 1 / (opts.rate ?? spec.rate) : (opts.dt ?? spec.dt);
    this._maxSub = opts.substeps ?? spec.substeps;
    this._acc = 0;

    this._ownerEditorId = activeEditorId() ?? null;
    this._reclaimed = true; // used by the run that created it
    this._disposed = false;

    // Debug window (created lazily by show()). Only the window is an OUTPUT.
    this._winId = null;
    this._ctx = null;
    this._live = null; // keep-alive handle while the debug window is open

    // Bound emitter passed into step/iterate — dual-emits with instance identity.
    this._emit = (evName, payload) => {
      const data = { ...payload, id: this.id, name: this.name };
      notify(`physics:${this.name}:${evName}`, data);
      notify(`physics:${this.id}:${evName}`, data);
    };

    // Channels: a callable reader per declared channel, metadata attached (route
    // ignores the props today; a future route branch can read label/norm).
    for (const [ch, def] of Object.entries(spec.channels)) {
      const reader = () => def.get(this.state);
      reader.label = `${this.name}.${ch}`;
      if (def.norm) reader.norm = def.norm;
      this[ch] = reader;
    }

    _live.add(this);
    _byKey.set(this._key, this);
    _startClock();
  }

  // Reclaimed by a re-run with the same identity key: keep state (trajectory
  // continues), re-arm the reclaim flag. Pointer/graph subs (none here) would be
  // re-wired; the debug window (if open) is left in place.
  _reuse(opts) {
    this._reclaimed = true;
    // Allow live opts to update params without resetting state.
    for (const [k, v] of Object.entries(opts)) {
      if (k === 'id' || k === 'dt' || k === 'rate' || k === 'substeps') continue;
      this.set(k, v);
    }
  }

  /** Set a live parameter (matches dp.swing() convention). Preserves the trajectory. */
  set(key, val) {
    if (this.spec.onSet) this.spec.onSet(this.state, key, val);
    else this.state[key] = val;
    return this;
  }

  /** Read a live parameter/state field. */
  get(key) {
    return this.state[key];
  }

  // Advance this instance's own accumulator by the shared frame dt. Continuous sims
  // substep by fixed dt; iterated maps tick at 1/rate. Both share the accumulator.
  _advance(frameDt) {
    if (this._disposed) return;
    // Clamp a stall to this sim's own per-frame budget (maxSub × dt) — bounds the
    // spiral without starving a low-rate iterated map (whose dt can exceed a fixed
    // wall-clock cap; e.g. the 4 Hz logistic map's dt is 0.25 s).
    this._acc += Math.min(frameDt, this._maxSub * this._dt);
    let n = 0;
    while (this._acc >= this._dt && n < this._maxSub) {
      if (this.spec.iterate) this.spec.iterate(this.state, this._emit);
      else this.spec.step(this.state, this._dt, this._emit);
      this._acc -= this._dt;
      n++;
    }
    if (n >= this._maxSub) this._acc = 0; // dropped backlog — never catch up forever
  }

  // ── Debug window (the OUTPUT half) ────────────────────────────────────────────

  /** Spawn a debug window rendering raw sim state. This is what holds the run alive. */
  show(title, opts = {}) {
    if (this._winId && document.getElementById(this._winId)) return this;
    const w = opts.w ?? 360;
    const h = opts.h ?? 300;
    const winId = window.wm?.spawn(title ?? `physics: ${this.id}`, {
      w,
      h,
      html: '',
      transient: true,
      onClose: () => this._destroy(),
      ...(opts.x !== undefined ? { x: opts.x } : {}),
      ...(opts.y !== undefined ? { y: opts.y } : {}),
    });
    this._winId = winId ?? null;
    const body = winId ? document.getElementById(winId)?.querySelector('.wm-body') : null;
    if (body) {
      body.style.cssText += ';overflow:hidden;padding:0;margin:0;background:#0d0d12;';
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      Object.assign(canvas.style, { width: '100%', height: '100%', display: 'block' });
      body.appendChild(canvas);
      this._canvasEl = canvas;
      this._ctx = canvas.getContext('2d');
    }
    // Debug window is the visible output → keep the run alive while it is open.
    this._live = liveOutput(this);
    return this;
  }

  _draw() {
    const ctx = this._ctx;
    if (!ctx) return;
    const w = this._canvasEl.width;
    const h = this._canvasEl.height;
    if (this.spec.render) {
      try {
        this.spec.render(ctx, this.state, w, h);
        return;
      } catch (e) {
        console.error(`[physics:${this.name}] render failed:`, e);
      }
    }
    _genericRender(ctx, this, w, h);
  }

  /** Explicit teardown (also fires on window close / hard reset). */
  remove() {
    this._destroy();
  }

  _teardown() {
    if (this._disposed) return;
    this._disposed = true;
    this._live?.release();
    this._live = null;
    this._ctx = null;
    if (this._winId) {
      window.wm?.remove?.(this._winId, { animate: false });
      this._winId = null;
    }
    _live.delete(this);
    if (_byKey.get(this._key) === this) _byKey.delete(this._key);
    _stopClockIfIdle();
  }

  _destroy() {
    this._teardown();
  }
}

// Generic fallback debug render: scrolling value bars per channel. Makes .show()
// useful for any sim that doesn't supply its own render (find the region by eye).
function _genericRender(ctx, inst, w, h) {
  ctx.fillStyle = '#0d0d12';
  ctx.fillRect(0, 0, w, h);
  const chans = Object.keys(inst.spec.channels);
  ctx.font = '12px monospace';
  ctx.textBaseline = 'middle';
  const rowH = Math.min(28, (h - 16) / Math.max(1, chans.length));
  chans.forEach((ch, i) => {
    const y = 12 + i * rowH;
    const def = inst.spec.channels[ch];
    const raw = def.get(inst.state);
    const [lo, hi] = def.norm ?? [-1, 1];
    const t = hi === lo ? 0.5 : Math.max(0, Math.min(1, (raw - lo) / (hi - lo)));
    ctx.fillStyle = '#1e1e2a';
    ctx.fillRect(90, y, w - 100, rowH - 6);
    ctx.fillStyle = '#4fd1ff';
    ctx.fillRect(90, y, (w - 100) * t, rowH - 6);
    ctx.fillStyle = '#cfd2dc';
    ctx.fillText(ch, 8, y + (rowH - 6) / 2);
    ctx.fillStyle = '#8b8f9e';
    ctx.fillText(raw.toFixed(2), w - 52, y + (rowH - 6) / 2);
  });
}

// ── Public factory ──────────────────────────────────────────────────────────────

/**
 * Instantiate a registered physics sim.
 * @param {string} name  a registered sim ('pendulum', 'ball', 'kuramoto', …)
 * @param {object} opts  per-sim params + { id?, dt?, rate?, substeps? }
 * @returns {PhysicsInstance}
 */
export function physics(name, opts = {}) {
  const spec = _specs.get(name);
  if (!spec) {
    throw new Error(
      `physics('${name}'): unknown sim. Registered: ${physicsSimNames().join(', ') || '(none)'}.`,
    );
  }
  // Identity reuse: a live instance with the same key continues instead of respawning.
  const { id } = opts;
  const { id: _omit, ...rest } = opts;
  const key = id != null ? `id:${id}` : `${name}|${JSON.stringify(rest)}`;
  const existing = _byKey.get(key);
  if (existing && !existing._disposed) {
    existing._reuse(opts);
    return existing;
  }
  return new PhysicsInstance(spec, opts);
}

// ── One owner-filtered, soft-aware reset handler for all sims (mirrors Canvas) ────
// Soft reset (auto-exec): keep a reclaimed sim (disarm, await re-claim by the re-run)
// so a chaotic trajectory survives a keystroke; destroy an orphan (dropped from the
// code). Hard reset / stop: destroy all.
onReset((editorId, soft) => {
  for (const inst of [..._live]) {
    if (editorId != null && inst._ownerEditorId != null && inst._ownerEditorId !== editorId)
      continue;
    if (soft) {
      if (inst._reclaimed)
        inst._reclaimed = false; // keep; await re-claim
      else inst._teardown(); // orphan from a prior cycle → destroy
    } else {
      inst._teardown();
    }
  }
  _stopClockIfIdle();
});

// Test / diagnostics helpers.
export function _physicsLiveCount() {
  return _live.size;
}
export function _physicsClockRunning() {
  return _raf != null;
}
