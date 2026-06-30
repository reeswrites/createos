// widget-events.js — shared event/signal helper used by Paint, SpriteEditor, AsciiEditor,
// Drumpad, and the in-window paint overlay. No DOM, fully unit-testable.
//
// Usage:
//   const events = new WidgetEvents();
//   events.on('stroke', e => console.log(e));
//   events.emit('stroke', { tool: 'pen', color: '#f00', bbox: {...} });
//   const sig = events.signal('stroke', { decay: 300, region: {x:0,y:0,w:100,h:100} });
//   sig.value    // 0–1 decaying pulse
//   sig.stream(fn) // RAF push
//   events.clear() // cancel all RAFs + remove all hooks

export class WidgetEvents {
  constructor() {
    this._hooks = new Map(); // event → fn[]
    this._rafs = []; // active RAF ids (for stream)
  }

  /**
   * Register a listener for a specific event or '*' for all events.
   * Does NOT return `this` intentionally — callers use the widget's chaining methods instead.
   */
  on(event, fn) {
    if (!this._hooks.has(event)) this._hooks.set(event, []);
    this._hooks.get(event).push(fn);
  }

  /**
   * Fire all listeners for `event` and all '*' listeners.
   * Errors in individual listeners are caught and logged (one bad hook ≠ all hooks fail).
   */
  emit(event, payload = {}) {
    const specific = this._hooks.get(event) ?? [];
    const wildcard = this._hooks.get('*') ?? [];
    for (const fn of [...specific, ...wildcard]) {
      try {
        fn(payload);
      } catch (err) {
        console.error('[WidgetEvents] listener error:', err);
      }
    }
  }

  /**
   * Return a decaying-pulse signal object.
   *
   * @param {string}  [event='*']        — which event drives the pulse. '*' = any event.
   * @param {object}  [opts]
   * @param {number}  [opts.decay=250]   — ms until value reaches 0
   * @param {object}  [opts.region]      — { x, y, w, h } bounding-box filter (pixel or cell coords).
   *                                       Tested against payload.x/y (point) or payload.bbox (rect).
   * @param {Function}[opts.match]       — custom predicate(payload) → bool; AND'd with region.
   * @returns {{ value, velocity, stream(fn), on(fn) }}
   */
  signal(event = '*', { decay = 250, region = null, match = null } = {}) {
    // Normalise: first arg may be an opts object (no event string supplied)
    if (typeof event === 'object' && event !== null) {
      const opts = event;
      event = '*';
      decay = opts.decay ?? decay;
      region = opts.region ?? region;
      match = opts.match ?? match;
    }

    const ref = { t: -Infinity };

    // Filtered hook: stamp ref.t only when the event passes both predicates
    const hookFn = (payload) => {
      if (region !== null && !_inRegion(payload, region)) return;
      if (match !== null && !match(payload)) return;
      ref.t = performance.now();
    };
    this.on(event, hookFn);

    const self = this;
    const sig = {
      get value() {
        const dt = performance.now() - ref.t;
        return dt >= decay ? 0 : 1 - dt / decay;
      },
      get velocity() {
        return sig.value;
      },

      /** Push value to fn on every animation frame. Returns sig for chaining. */
      stream(fn) {
        let rafId;
        const frame = () => {
          fn(sig);
          rafId = requestAnimationFrame(frame);
        };
        rafId = requestAnimationFrame(frame);
        self._rafs.push(rafId);
        return sig;
      },

      /** Register an additional filtered listener on this signal's event. Returns sig. */
      on(fn) {
        const filteredFn = (payload) => {
          if (region !== null && !_inRegion(payload, region)) return;
          if (match !== null && !match(payload)) return;
          fn(payload);
        };
        self.on(event, filteredFn);
        return sig;
      },
    };

    return sig;
  }

  /** Cancel all RAF streams and remove all listeners. */
  clear() {
    this._hooks.clear();
    for (const id of this._rafs) cancelAnimationFrame(id);
    this._rafs.length = 0;
  }
}

// ── Region helper ─────────────────────────────────────────────────────────────

/**
 * Test whether a payload falls within a region { x, y, w, h }.
 * Supports point payloads (x/y or c/r) and bbox payloads ({ bbox: { x, y, w, h } }).
 */
function _inRegion(payload, region) {
  const rx = region.x ?? 0,
    ry = region.y ?? 0;
  const rw = region.w ?? Infinity,
    rh = region.h ?? Infinity;

  // bbox overlap (stroke/fill payloads)
  if (payload.bbox) {
    const { x: bx, y: by, w: bw, h: bh } = payload.bbox;
    return bx < rx + rw && bx + bw > rx && by < ry + rh && by + bh > ry;
  }

  // point (pixel events)
  const px = payload.x ?? payload.c ?? 0;
  const py = payload.y ?? payload.r ?? 0;
  return px >= rx && px < rx + rw && py >= ry && py < ry + rh;
}
