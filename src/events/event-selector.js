// event-selector.js — composable event subscription builder. (ADR 013 / ADR 014)
//
// on('event').every(4).after('other').within(500).when(pred).do(fn) → stop handle
// on('event').when({ key: 'w' })                → property-filter modifier
// on('event').when({ w: fn, s: fn })            → terse dispatch terminal (uses event's `primary`)
// on('event').when('prop', { w: fn, s: fn })    → explicit dispatch terminal
// on('event').hold()                            → live Set (paired events) or live object
// any('a', 'b', ...) — fires when any of the listed events occurs
//
// tick(ms).every(n).after('event').do(fn)       → interval-based source, full modifier chain
//
// hold('event')                                 → global memoized live-state (persistent/non-run-scoped)

import { subscribe, getLastPayload } from './bus.js';
import { onReset } from '../runtime/reset-registry.js';
import { SYSTEM_EVENTS } from './system-events.js';

// Resolve the ACTIVE editor's tracked setInterval/clearInterval. Intervals made
// here must land in that editor's `_intervals` map so reset/stop clears them —
// otherwise they leak as untracked native timers (the global window.setInterval
// is NOT patched; the tracker lives on window.__ar_e{id}_setInterval). Captured
// at call time, so a tick/tween belongs to the editor that created it. Falls back
// to native globals when there's no active editor (e.g. tests).
function _trackedTimers() {
  const id = window.__ar_active_editor_id;
  const si = id != null ? window[`__ar_e${id}_setInterval`] : null;
  const ci = id != null ? window[`__ar_e${id}_clearInterval`] : null;
  return { setInterval: si || window.setInterval, clearInterval: ci || window.clearInterval };
}

// Build lookup maps from the catalog at module load.
const _eventsMap = new Map(SYSTEM_EVENTS.map((e) => [e.name, e]));

// ── EventSelector ────────────────────────────────────────────────────────────

export class EventSelector {
  constructor(events) {
    // Accept a single string (on) or an array (any)
    this._events = Array.isArray(events) ? events : [events];
    this._every = null;
    this._after = null;
    this._within = null;
    this._when = null; // fn predicate only (object patterns are compiled here)
  }

  // Fire only every Nth occurrence of each subscribed event.
  every(n) {
    this._every = n;
    return this;
  }

  // Require that `event` has fired at least once before this one triggers.
  after(event) {
    this._after = event;
    return this;
  }

  // Combined with after(): require the after-event fired within `ms` milliseconds ago.
  within(ms) {
    this._within = ms;
    return this;
  }

  // .when() — three modes detected by argument shape:
  //   when(fn)              → predicate modifier (returns this)
  //   when({ key:'w' })     → property-filter modifier; array value = OR (returns this)
  //   when({ w:fn, s:fn })  → terse dispatch terminal via event's `primary` (returns stop handle)
  //   when('prop', map)     → explicit dispatch terminal on data[prop] (returns stop handle)
  when(patternOrFn, map) {
    // Mode 1: function predicate — modifier
    if (typeof patternOrFn === 'function') {
      this._when = patternOrFn;
      return this;
    }

    // Mode 4: explicit prop dispatch — terminal
    if (typeof patternOrFn === 'string' && map && typeof map === 'object') {
      return this._dispatchOn(patternOrFn, map);
    }

    // Modes 2/3: object argument
    if (patternOrFn !== null && typeof patternOrFn === 'object') {
      const entries = Object.entries(patternOrFn);
      if (entries.length === 0) return this; // empty filter is a no-op modifier

      const allFunctions = entries.every(([, v]) => typeof v === 'function');

      if (allFunctions) {
        // Mode 3: terse dispatch — look up primary from catalog
        if (this._events.length !== 1) {
          throw new Error(
            '.when(map) dispatch requires a single event (not any(...)). Use .when("prop", map) explicitly.',
          );
        }
        const meta = _eventsMap.get(this._events[0]);
        if (!meta?.primary) {
          throw new Error(
            `.when(map) dispatch: event '${this._events[0]}' has no primary field in the catalog. Use .when('propName', map) instead.`,
          );
        }
        return this._dispatchOn(meta.primary, patternOrFn);
      } else {
        // Mode 2: property-filter modifier — compile to predicate
        this._when = (d) =>
          entries.every(([k, v]) => (Array.isArray(v) ? v.includes(d[k]) : d[k] === v));
        return this;
      }
    }

    throw new TypeError(
      '.when() expects a function, an object pattern, or (propName, handlerMap).',
    );
  }

  // Dispatch terminal — internal shared impl for Mode 3 and Mode 4.
  // Wires all modifier guards, dispatches on data[prop] → map[value](data).
  _dispatchOn(prop, map) {
    const cleanups = [];
    let lastAfter = null;
    let lastFired = null;

    if (this._after) {
      cleanups.push(
        subscribe(this._after, () => {
          lastAfter = Date.now();
        }),
      );
    }

    for (const event of this._events) {
      let count = 0;
      cleanups.push(
        subscribe(event, (data) => {
          count++;
          if (this._every !== null && count % this._every !== 0) return;
          if (this._when !== null && !this._when(data)) return;
          if (this._after !== null && lastAfter === null) return;
          if (this._within !== null) {
            const refTime = this._after !== null ? lastAfter : lastFired;
            if (refTime !== null && Date.now() - refTime > this._within) return;
          }
          lastFired = Date.now();
          map[data[prop]]?.(data);
        }),
      );
    }

    return () => cleanups.forEach((c) => c());
  }

  // .hold() — terminal, returns a live state object rather than wiring a callback.
  //   Paired events (primary + release in catalog) → returns a live Set of primary values.
  //   All other events → returns a live object, Object.assign'd on every payload.
  // Subscriptions created here are run-scoped (cleared on reset like .do() subscriptions).
  // Use the module-level hold() function for persistent global state instead.
  hold() {
    if (this._events.length !== 1) {
      throw new Error('.hold() requires a single event (not any(...)). Use on("event").hold().');
    }
    const event = this._events[0];
    const meta = _eventsMap.get(event);
    const whenFn = this._when; // capture current filter

    if (meta?.release && meta?.primary) {
      // Set mode: add primary value on event, delete on release event.
      const set = new Set();
      subscribe(event, (data) => {
        if (whenFn !== null && !whenFn(data)) return;
        set.add(data[meta.primary]);
      });
      subscribe(meta.release, (data) => {
        set.delete(data[meta.primary]);
      });
      return set;
    } else {
      // Object mode: live snapshot of the last payload.
      const last = getLastPayload(event);
      const state = last ? { ...last } : {};
      subscribe(event, (data) => {
        if (whenFn !== null && !whenFn(data)) return;
        Object.assign(state, data);
      });
      return state;
    }
  }

  // Commit — wire up all subscriptions and return a stop handle.
  do(fn) {
    const cleanups = [];
    let lastAfter = null;
    let lastFired = null;

    if (this._after) {
      cleanups.push(
        subscribe(this._after, () => {
          lastAfter = Date.now();
        }),
      );
    }

    for (const event of this._events) {
      let count = 0;
      cleanups.push(
        subscribe(event, (data) => {
          count++;
          if (this._every !== null && count % this._every !== 0) return;
          if (this._when !== null && !this._when(data)) return;
          if (this._after !== null && lastAfter === null) return;
          if (this._within !== null) {
            const refTime = this._after !== null ? lastAfter : lastFired;
            if (refTime !== null && Date.now() - refTime > this._within) return;
          }
          lastFired = Date.now();
          fn(data);
        }),
      );
    }

    return () => cleanups.forEach((c) => c());
  }
}

// on('event') — subscribe to a single event with an optional modifier chain.
export function on(event) {
  return new EventSelector(event);
}

// any('a', 'b', ...) — subscribe to multiple events; fires when any occurs.
export function any(...events) {
  return new EventSelector(events);
}

// ── TickSelector ─────────────────────────────────────────────────────────────
// tick(ms) — composable interval source. Uses the active editor's TRACKED
// setInterval (via _trackedTimers) so it lands in _intervals and is cleared on
// reset/stop like user setInterval calls. This is an intentional exception to the
// "use _nativeSetInterval for harness timers" rule — tick() IS user-visible.

class TickSelector {
  constructor(ms) {
    this._ms = ms;
    this._every = null;
    this._after = null;
    this._within = null;
    this._when = null;
  }

  every(n) {
    this._every = n;
    return this;
  }
  after(event) {
    this._after = event;
    return this;
  }
  within(ms) {
    this._within = ms;
    return this;
  }

  when(pred) {
    if (typeof pred !== 'function')
      throw new TypeError('tick().when() expects a predicate function.');
    this._when = pred;
    return this;
  }

  do(fn) {
    const cleanups = [];
    let lastAfter = null;
    let lastFired = null;

    if (this._after) {
      cleanups.push(
        subscribe(this._after, () => {
          lastAfter = Date.now();
        }),
      );
    }

    let count = 0;
    const T = _trackedTimers();
    const id = T.setInterval(() => {
      count++;
      if (this._every !== null && count % this._every !== 0) return;
      if (this._when !== null && !this._when()) return;
      if (this._after !== null && lastAfter === null) return;
      if (this._within !== null) {
        const refTime = this._after !== null ? lastAfter : lastFired;
        if (refTime !== null && Date.now() - refTime > this._within) return;
      }
      lastFired = Date.now();
      fn();
    }, this._ms);

    cleanups.push(() => T.clearInterval(id));
    return () => cleanups.forEach((c) => c());
  }
}

// tick(ms) → composable TickSelector (call .do(fn) to run; supports .every/.after/.within/.when).
// tick(fn) → convenience: run fn every frame (~16ms) and return a cancel handle directly.
// The function form is what reads naturally for a plain animation loop; without it,
// `tick(() => {...})` silently builds a selector that is never started (no interval, no draw).
export function tick(msOrFn) {
  if (typeof msOrFn === 'function') return new TickSelector(16).do(msOrFn);
  return new TickSelector(msOrFn);
}

// ── tween() ───────────────────────────────────────────────────────────────────
// tween(duration, fn(t), { easing?, onDone? }) → cancel
// Calls fn with t in [0,1] every ~16ms for `duration` ms, then calls onDone.
// Uses the active editor's tracked setInterval so it pauses/cleans with the harness (ADR 027).
export function tween(duration, fn, { easing = (t) => t, onDone } = {}) {
  const start = Date.now();
  const T = _trackedTimers();
  const id = T.setInterval(() => {
    const raw = Math.min(1, (Date.now() - start) / duration);
    fn(easing(raw));
    if (raw >= 1) {
      T.clearInterval(id);
      if (onDone) onDone();
    }
  }, 16);
  return () => T.clearInterval(id);
}

// ── Global hold() ─────────────────────────────────────────────────────────────
// hold(event) — persistent (non-run-scoped) live-state for an event. Memoized: repeated
// calls return the same object/Set. Enables inline polling: hold('window:mouse:move').x
//
// For Set mode (paired events), the Set is cleared on reset so held keys don't bleed
// across runs. Object mode (mouse position etc.) retains last known value across resets.

const _holdCache = new Map(); // event → live Set or object

export function hold(event) {
  if (_holdCache.has(event)) return _holdCache.get(event);
  const meta = _eventsMap.get(event);

  if (meta?.release && meta?.primary) {
    // Set mode — persistent subscriptions that survive reset
    const primary = meta.primary;
    const set = new Set();
    subscribe(
      event,
      (data) => {
        set.add(data[primary]);
      },
      { persistent: true },
    );
    subscribe(
      meta.release,
      (data) => {
        set.delete(data[primary]);
      },
      { persistent: true },
    );
    _holdCache.set(event, set);
    return set;
  } else {
    // Object mode
    const last = getLastPayload(event);
    const state = last ? { ...last } : {};
    subscribe(
      event,
      (data) => {
        Object.assign(state, data);
      },
      { persistent: true },
    );
    _holdCache.set(event, state);
    return state;
  }
}

// On reset: clear Set-mode hold state (held keys must not bleed across runs).
onReset(() => {
  for (const [event, state] of _holdCache) {
    const meta = _eventsMap.get(event);
    if (meta?.release && state instanceof Set) state.clear();
  }
});
