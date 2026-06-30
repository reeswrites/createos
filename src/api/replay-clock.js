// replay-clock.js — schedules timestamped action lists back onto the harness
// clock (ADR 031). The shared scheduler under both per-widget `.replay(actions)`
// and the cross-widget `window.timeline()`.
//
// An "op" is `{ at, fn }` — `at` is ms from playback start, `fn` is the call that
// re-applies one recorded action. A ReplayClock fires every op via the PATCHED
// `window.setTimeout` (so it pauses with __ar_paused and is torn down by the
// harness — same deliberate exception as tick()/Route timeline) and holds a
// liveOutput keep-alive while playing so the run stays alive. Modeled on
// route.js `_runTimeline`.
//
// Clocks are run-scoped OUTPUTS: owner-scoped teardown + keep-alive are owned by
// runScopedOutput (run-scoped.js) — a reset disposes only matching-owner clocks, so
// resetting editor B does not kill editor A's replay.

import { runScopedOutput } from '../runtime/run-scoped.js';

const _clocks = new Set();

// ops: [{ at:ms, fn:()=>void }]. Returns a handle with .stop().
export function scheduleReplay(ops, { loop = false, label = 'replay' } = {}) {
  return new ReplayClock(ops, { loop, label }).start();
}

// Helper for a single-track replay: maps each `{t,...}` action to an op that
// applies it via `applyFn`. `offset` shifts the whole take (timeline tracks).
export function replayActions(
  applyFn,
  actions,
  { loop = false, offset = 0, label = 'replay' } = {},
) {
  const ops = (actions || []).map((a) => ({ at: offset + (a.t || 0), fn: () => applyFn(a) }));
  return scheduleReplay(ops, { loop, label });
}

class ReplayClock {
  constructor(ops, { loop, label }) {
    this._ops = [...ops].sort((a, b) => a.at - b.at);
    this._loop = loop;
    this._label = label;
    this._timers = [];
    this._h = null;
    this._destroyed = false;
    this._duration = this._ops.length ? this._ops[this._ops.length - 1].at : 0;
  }

  start() {
    if (this._destroyed) return this;
    _clocks.add(this);
    // token `this` so the Signal Graph labels it "ReplayClock". onStop = full teardown.
    this._h = runScopedOutput({ token: this, onStop: () => this._teardown() });
    this._scheduleCycle();
    return this;
  }

  _scheduleCycle() {
    for (const op of this._ops) {
      const id = window.setTimeout(
        () => {
          if (this._destroyed) return;
          try {
            op.fn();
          } catch (e) {
            console.error('[replay] action failed:', e);
          }
        },
        Math.max(0, op.at),
      );
      this._timers.push(id);
    }
    // End marker: loop wrap, or release keep-alive when the take finishes. Only
    // loop when there is real duration, else a 0-length take spins a tight loop.
    const endId = window.setTimeout(() => {
      if (this._destroyed) return;
      if (this._loop && this._duration > 0) {
        this._timers = [];
        this._scheduleCycle();
      } else {
        this.stop();
      }
    }, this._duration + 1);
    this._timers.push(endId);
  }

  // Both stop triggers — the end-of-take marker / external .stop(), and the global
  // reset — funnel through the handle's idempotent dispose() → onStop → _teardown.
  stop() {
    this._h?.dispose();
    if (!this._h) this._teardown();
  }

  _teardown() {
    if (this._destroyed) return;
    this._destroyed = true;
    for (const id of this._timers) window.clearTimeout(id);
    this._timers = [];
    _clocks.delete(this);
  }
}

// Test/inspection helper.
export function _activeReplayCount() {
  return _clocks.size;
}
