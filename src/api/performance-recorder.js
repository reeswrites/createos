// performance-recorder.js — Performance capture (ADR 031). A Take is an
// append-only, timestamped log of a widget's user actions. It is fed explicitly
// from each widget's INPUT handlers (pointer/key), never from the public action
// methods — so replaying a Take (which calls those public methods) does not
// re-record. Wall-clock ms from take start; `op` only where a widget records
// more than one action type.
//
// Two modes share one Take per widget:
//   solo   — the widget's own Capture ● button arms its Take; stop → `.replay(...)`
//   global — a desktop-level Capture ● arms every widget on ONE shared clock;
//            stop → a single `timeline()` composing one track per widget.
//
// This module is DOM-free and pure: it builds the code STRINGS; widgets hand
// them to insertSnippet(). See CONTEXT.md "Performance"/"Take"/"Timeline".

// ── Global take (shared clock across widgets) ─────────────────────────────────
let _globalArmed = false;
let _globalT0 = 0;
const _globalTracks = new Map(); // Take → actions[]

export function armGlobal() {
  _globalArmed = true;
  _globalT0 = performance.now();
  _globalTracks.clear();
}

// Returns [{ widget, actions }] for non-empty tracks, in insertion order.
export function disarmGlobal() {
  _globalArmed = false;
  const out = [];
  for (const [take, actions] of _globalTracks) {
    if (actions.length) out.push({ widget: take._widget, actions });
  }
  _globalTracks.clear();
  return out;
}

export function isGlobalArmed() {
  return _globalArmed;
}

function _globalRecord(take, action) {
  let actions = _globalTracks.get(take);
  if (!actions) {
    actions = [];
    _globalTracks.set(take, actions);
  }
  const stored = { t: Math.round(performance.now() - _globalT0), ...action };
  actions.push(stored);
  return stored;
}

// ── Per-widget take ───────────────────────────────────────────────────────────
export class Take {
  constructor(widget) {
    this._widget = widget;
    this._log = [];
    this._t0 = 0;
    this._armed = false;
  }

  get armed() {
    return this._armed;
  }

  arm() {
    this._log = [];
    this._t0 = performance.now();
    this._armed = true;
  }

  // Returns the captured action log.
  disarm() {
    this._armed = false;
    return this._log;
  }

  // Called from the widget's input handlers. Routes to the global take when a
  // global capture is in progress, else to this widget's own log when armed.
  // Returns the stored action object (so callers can back-fill fields like a
  // note's `dur` on release), or null when nothing was recorded.
  push(action) {
    if (_globalArmed) return _globalRecord(this, action);
    if (!this._armed) return null;
    const stored = { t: Math.round(performance.now() - this._t0), ...action };
    this._log.push(stored);
    return stored;
  }
}

// ── Code emission (pure string builders) ──────────────────────────────────────
// Each widget implements `_perfCtor()` → { varName, code } and `_perfReplayCall`
// is standard: `<varName>.replay(<actions>)`.

function _serialize(actions) {
  // Compact one-action-per-line array literal — readable + editable in the editor.
  if (!actions.length) return '[]';
  return '[\n' + actions.map((a) => '  ' + JSON.stringify(a)).join(',\n') + '\n]';
}

// Solo: construct the widget then replay its take.
export function buildReplayCode(widget, actions, { loop = false } = {}) {
  const { varName, code } = widget._perfCtor();
  const opts = loop ? ', { loop: true }' : '';
  return `${code}\n${varName}.replay(${_serialize(actions)}${opts});`;
}

// Global: construct each widget then compose a multi-track timeline.
export function buildTimelineCode(tracks, { loop = false } = {}) {
  const ctorLines = [];
  const trackLines = [];
  for (const { widget, actions } of tracks) {
    const { varName, code } = widget._perfCtor();
    ctorLines.push(code);
    trackLines.push(`  .track(${varName}, ${_serialize(actions)}, { at: 0 })`);
  }
  const play = loop ? '\n  .play({ loop: true });' : '\n  .play();';
  return `${ctorLines.join('\n')}\ntimeline()\n${trackLines.join('\n')}${play}`;
}
