// pause-controller.js — freeze/restore an editor's tracked timers across pause.
// See ADR 043.
//
// Pausing a run must stop its in-flight setInterval/setTimeout and, on resume,
// recreate them with their *remaining* delay — and recreate them through the
// editor's NAMESPACED tracked setters so the new timers land back in the editor's
// _intervals/_timeouts maps (and are cleared on the next reset). That mechanics —
// freeze, remaining-delay, namespace selection — is the part where a pause bug
// actually lives, yet it sat inline in the untested editor-instance.js.
//
// PauseController owns it behind a two-method interface (pause/resume). The idle
// watcher, the UI state-setters, and the global window.__ar_paused flag stay in
// editor-instance.js — they are run lifecycle, not pause mechanics. Timers and
// the tracked setters are INJECTED, so a test drives it with a fake clock through
// the same interface the editor uses (two adapters: native clock, fake clock).

import { freezeTimers, restoreTimers } from './timer-manager.js';

export class PauseController {
  /**
   * @param {object} opts
   * @param {Map}      opts.intervals      editor's tracked interval map (id → {cb,delay,args})
   * @param {Map}      opts.timeouts       editor's tracked timeout map (id → {cb,delay,createdAt,args})
   * @param {function} opts.clearInterval  native clearInterval
   * @param {function} opts.clearTimeout   native clearTimeout
   * @param {function} opts.trackedSetters () => ({ setInterval, setTimeout }) — the
   *                   editor's namespaced tracked setters, resolved at resume time so
   *                   restored timers re-register in the editor's maps. Injected (not
   *                   read off window here) to keep the controller testable.
   */
  constructor({ intervals, timeouts, clearInterval, clearTimeout, trackedSetters }) {
    this._intervals      = intervals;
    this._timeouts       = timeouts;
    this._clearInterval  = clearInterval;
    this._clearTimeout   = clearTimeout;
    this._trackedSetters = trackedSetters;
    this._frozen         = null;   // freezeTimers() snapshot while paused
  }

  get paused() { return this._frozen != null; }

  // Freeze the editor's tracked timers (clears them, records remaining delay).
  // Idempotent: a second pause() while already paused is a no-op.
  pause() {
    if (this._frozen) return;
    this._frozen = freezeTimers(
      this._intervals, this._timeouts,
      this._clearInterval, this._clearTimeout,
    );
  }

  // Recreate the frozen timers through the namespaced tracked setters with their
  // remaining delay. No-op if not paused.
  resume() {
    if (!this._frozen) return;
    const { setInterval, setTimeout } = this._trackedSetters();
    restoreTimers(this._frozen, setInterval, setTimeout);
    this._frozen = null;
  }

  // Drop frozen state without restoring — used by hard reset / stop, which clears
  // the timer maps directly.
  clear() { this._frozen = null; }
}
