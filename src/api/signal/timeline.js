// timeline.js — window.timeline() (ADR 031). Composes multiple recorded Takes
// across multiple widgets on one shared clock. Each `.track(widget, actions,
// {at})` places a take at an offset (wall-clock ms), so different takes — even
// several of the same widget — can be spliced at different times by hand.
//
// `.replay()` on a widget is the degenerate single-track case; both reduce to
// replay-clock ops `{at, fn}` where fn applies one action via the widget's
// `_applyAction(action)` dispatch. A Timeline schedules ONE clock for all tracks
// so cross-widget timing stays coherent.

import { scheduleReplay } from './replay-clock.js';

class Timeline {
  constructor() {
    this._tracks = [];
    this._clock = null;
  }

  // actions: [{ t, ... }] recorded for `widget`. `at`: offset ms for this take.
  track(widget, actions, { at = 0 } = {}) {
    if (widget && typeof widget._applyAction === 'function') {
      this._tracks.push({ widget, actions: actions || [], at });
    } else {
      console.warn('[timeline] track target has no _applyAction — skipped');
    }
    return this;
  }

  play({ loop = false } = {}) {
    const ops = [];
    for (const { widget, actions, at } of this._tracks) {
      for (const a of actions) {
        ops.push({ at: at + (a.t || 0), fn: () => widget._applyAction(a) });
      }
    }
    this._clock = scheduleReplay(ops, { loop, label: 'timeline' });
    return this;
  }

  stop() {
    this._clock?.stop();
    this._clock = null;
    return this;
  }
}

export function timeline() {
  return new Timeline();
}
export { Timeline };
