// canvas.js — window-scoped drawing surface (ADR 038, ADR 040).
//
// `new Canvas({ w, h, title })` spawns a wm window with its own 2D canvas at a
// chosen logical size (default 16:9 → 1600×900) and exposes the full fluent draw
// API scoped to it (via DrawTarget). It owns its window, so it delivers pointer
// coordinates already mapped into its OWN canvas space — no getBoundingClientRect
// math in user code. Since ADR 040, `Canvas` is the *sole* 2D surface (global
// `draw` is gone) and it is the z=0 plane of its window's WM-owned layer stack.
//
// Lifecycle (ADR 040 Q6): every Canvas is identical, but windows SURVIVE soft
// reset (auto-exec) by identity so they don't flash-rebuild every ~1s. Re-running
// `new Canvas({ id | title+w+h })` reuses the live window; a Canvas deleted from
// the code is torn down a cycle later. Hard reset / window close destroys.

import { DrawTarget } from './draw.js';
import { Layer } from './layer.js';
import { liveOutput } from '../../runtime/keep-alive.js';
import { onReset } from '../../runtime/reset-registry.js';
import { subscribe, notify } from '../../events/index.js';

const _instances = new Set();
const _byKey = new Map(); // identity key → live Canvas (for soft-reset reuse)
let _spawnCount = 0; // cascade offset for windows without explicit x/y

class Canvas extends DrawTarget {
  constructor(opts = {}) {
    const { w = 1600, h = 900, title = 'Canvas', x, y, noChrome, transparent, id } = opts;

    // ── Identity-reuse: a live window with the same key is reused, not respawned ──
    const key = id ?? `${title}|${w}|${h}`;
    const existing = _byKey.get(key);
    if (existing && existing.winId && document.getElementById(existing.winId)) {
      existing._reuse();
      return existing; // legal in a derived ctor: returning an object skips super()
    }

    // Cascade from a corner when no explicit position — handles 1..N surfaces
    // uniformly without overlapping or shrinking the editor (ADR 040 Q7).
    let cx = x,
      cy = y;
    if (cx === undefined && cy === undefined) {
      const i = _spawnCount++ % 8;
      cx = 60 + i * 36;
      cy = 60 + i * 36;
    }

    // Local so the DrawTarget getter resolves our canvas without touching `this`
    // before super() (legal: declaring/closing over a local var, not `this`).
    let canvasEl = null;
    super(0, () => canvasEl);

    this._key = key;
    this._w = w;
    this._h = h;
    this.pointer = { x: 0, y: 0, down: false };
    this._handlers = { down: [], move: [], up: [] };
    this._unsubs = [];
    this._disposed = false;
    this._reclaimed = true; // used by the run that creates it
    this._ownerEditorId = window.__ar_active_editor_id ?? null;

    // ── Spawn the window ──────────────────────────────────────────────────────
    const winId = window.wm?.spawn(title, {
      w,
      h,
      html: '',
      transient: true, // run artifact — don't serialize/restore
      onClose: () => this._destroy(),
      ...(noChrome !== undefined ? { noChrome } : {}),
      ...(transparent !== undefined ? { transparent } : {}),
      ...(cx !== undefined ? { x: cx } : {}),
      ...(cy !== undefined ? { y: cy } : {}),
    });
    this.winId = winId ?? null;
    const winEl = winId ? document.getElementById(winId) : null;
    const body = winEl?.querySelector('.wm-body') ?? null;

    // ── Mount the canvas (fixed logical backing store, CSS-fills the body) ─────
    canvasEl = document.createElement('canvas');
    canvasEl.width = w;
    canvasEl.height = h;
    Object.assign(canvasEl.style, { width: '100%', height: '100%', display: 'block' });
    this._canvasEl = canvasEl;
    if (body) {
      body.style.cssText += ';overflow:hidden;padding:0;margin:0;';
      body.appendChild(canvasEl);
    }
    // Register as the z=0 plane of this window's layer stack (ADR 040). `adopt`
    // because Canvas's backing store is fixed-logical — it must NOT get the DPR
    // native-resize that mountLayerCanvas applies to shader/pixi planes.
    if (winId) window.wm?.layer?.(winId, 0, { adopt: canvasEl });

    this._subscribePointer();

    // ── Lifecycle: keep-alive while alive (released in _teardown) ──────────────
    this._live = liveOutput(this);
    _instances.add(this);
    _byKey.set(key, this);
    notify('canvas:open', { winId: this.winId, w, h });
  }

  // Pointer: window-scoped events, mapped body-px → logical canvas px. Re-created
  // on every reuse because run-scoped subscriptions are wiped by clearRunScoped.
  _subscribePointer() {
    const winId = this.winId;
    if (!winId) return;
    const body = document.getElementById(winId)?.querySelector('.wm-body') ?? null;
    const map = (p) => {
      const bw = body?.clientWidth || this._w;
      const bh = body?.clientHeight || this._h;
      return { x: (p.x / bw) * this._w, y: (p.y / bh) * this._h, button: p.button };
    };
    for (const kind of ['down', 'move', 'up']) {
      this._unsubs.push(
        subscribe(`wm:${winId}:mouse:${kind}`, (p) => {
          const m = map(p);
          this.pointer.x = m.x;
          this.pointer.y = m.y;
          if (kind === 'down') this.pointer.down = true;
          if (kind === 'up') this.pointer.down = false;
          for (const fn of this._handlers[kind]) {
            try {
              fn(m);
            } catch (e) {
              console.error('[Canvas] pointer handler failed:', e);
            }
          }
        }),
      );
    }
  }

  // Reclaimed by a re-run (same identity key). Clear for a fresh frame, re-wire
  // pointer (subs were wiped on the soft reset), re-arm reclaim flag.
  _reuse() {
    this._reclaimed = true;
    this._handlers = { down: [], move: [], up: [] };
    this._unsubs = [];
    const ctx = this._canvasEl?.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, this._canvasEl.width, this._canvasEl.height);
    this._subscribePointer();
  }

  /** Register a pointer handler. evt: 'down' | 'move' | 'up'. Coords are canvas-space. */
  on(evt, fn) {
    if (this._handlers[evt]) this._handlers[evt].push(fn);
    return this;
  }

  /** Underlying <canvas> element (for snapshot/record/compositing). */
  get el() {
    return this._canvasEl;
  }

  /**
   * A DrawTarget over a higher z-plane of THIS canvas's window (ADR 040) —
   * the per-window replacement for the old global getDraw(z)/getLayer(z).
   * Fixed-logical, sized to this canvas, composited above z=0.
   */
  layer(z) {
    if (z === 0) return this;
    return new DrawTarget(z, () =>
      window.wm?.layer?.(this.winId, z, { raster: true, w: this._w, h: this._h }),
    );
  }

  /**
   * A CSS-filter wrapper (blur/hue/opacity/blendMode/transform) over a z-plane of
   * THIS canvas's window — the per-window replacement for the old global getLayer(z).
   */
  fx(z = 0) {
    const c =
      z === 0
        ? this._canvasEl
        : window.wm?.layer?.(this.winId, z, { raster: true, w: this._w, h: this._h });
    return new Layer(c);
  }

  /** Tear down explicitly (also happens on hard reset / window close). */
  remove() {
    this._destroy();
  }

  _teardown() {
    if (this._disposed) return;
    this._disposed = true;
    for (const u of this._unsubs) {
      try {
        u();
      } catch {
        /* already gone */
      }
    }
    this._unsubs = [];
    // Stop backdrops mounted on this surface so their keep-alive + raf don't
    // outlive the window (else the run never idle-stops and audio keeps firing).
    this.stopBackdrops();
    this._live?.release();
    if (this.winId) {
      window.wm?.remove?.(this.winId, { animate: false });
      this.winId = null;
    }
    _instances.delete(this);
    if (_byKey.get(this._key) === this) _byKey.delete(this._key);
    notify('canvas:close', {});
  }

  // Window-close path — destroy unconditionally.
  _destroy() {
    this._teardown();
  }
}

// ── One owner-filtered, soft-aware reset handler for all Canvases (ADR 040) ─────
// Soft reset (auto-exec): keep the window so it doesn't flash-rebuild. A Canvas
// used by the run that just ended (_reclaimed) is kept and disarmed, awaiting
// re-claim by the re-run; one that survived a prior soft reset WITHOUT being
// reclaimed (deleted from the code) is torn down. Hard reset/stop: destroy all.
onReset((editorId, soft) => {
  for (const c of [..._instances]) {
    if (editorId != null && c._ownerEditorId != null && c._ownerEditorId !== editorId) continue;
    // Pointer subs are run-scoped → already wiped by clearRunScoped; drop refs.
    c._unsubs = [];
    c._handlers = { down: [], move: [], up: [] };
    if (soft) {
      if (c._reclaimed)
        c._reclaimed = false; // keep; await re-claim
      else c._teardown(); // orphan from a prior cycle → destroy
    } else {
      c._teardown();
    }
  }
});

export { Canvas };
