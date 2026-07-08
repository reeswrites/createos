// trace-controller.js — the Execution Trail glow for one editor (ADR 019).
//
// User code is AST-instrumented (live-patch.js) to call window.__ar_e{id}_trace(line)
// as each line runs. This controller turns that firehose into CodeMirror decorations:
// a line that just fired glows and fades over 800 ms; a line firing at RAF rate stays
// lit. That is a small self-contained state machine — dirty set, active-with-removal-
// timer map, one coalescing RAF — yet it sat inline in the already-1200-line
// editor-instance.js, threaded through reset() and _setStopped(). PauseController (ADR
// 043) set the precedent for pulling a run-lifecycle mechanism out behind a small
// interface; this follows it.
//
// The CodeMirror StateField + effect that actually paint the glow live here too (the
// editor imports traceLineField for its extension list). Native timers and a getCm()
// accessor are INJECTED — cm is built after the controller and can be swapped — so a
// test drives record/flush/clear through the same interface the editor uses.

import { EditorView, Decoration } from '@codemirror/view';
import { StateEffect, StateField, RangeSetBuilder } from '@codemirror/state';

// Lines arrive as Set<number> (or null to clear) via setTraceLinesEffect. Mirrors the
// errorLineField pattern.
export const setTraceLinesEffect = StateEffect.define();

export const traceLineField = StateField.define({
  create: () => Decoration.none,
  update(decos, tr) {
    decos = decos.map(tr.changes);
    for (const e of tr.effects) {
      if (!e.is(setTraceLinesEffect)) continue;
      if (e.value === null) {
        decos = Decoration.none;
        continue;
      }
      const builder = new RangeSetBuilder();
      const lines = [...e.value].sort((a, b) => a - b);
      for (const ln of lines) {
        if (ln < 1 || ln > tr.state.doc.lines) continue;
        const line = tr.state.doc.line(ln);
        builder.add(line.from, line.to, Decoration.mark({ class: 'ar-trace-line' }));
      }
      decos = builder.finish();
    }
    return decos;
  },
  provide: (f) => EditorView.decorations.from(f),
});

export class TraceController {
  /**
   * @param {object}   opts
   * @param {object}   opts.native   native timers ({ setTimeout, clearTimeout })
   * @param {function} opts.getCm     () => EditorView | null — current cm (swappable)
   * @param {boolean}  opts.enabled   initial enabled state (persisted by the editor)
   */
  constructor({ native, getCm, enabled = true }) {
    this._native = native;
    this._getCm = getCm;
    this.enabled = enabled;
    this._dirty = new Set(); // lines that fired since last flush
    this._active = new Map(); // line → removal-timer id (still glowing)
    this._raf = null; // coalescing RAF handle
  }

  // Called from the injected window.__ar_e{id}_trace(line). Cheap + coalescing —
  // fires at line-execution rate, so it only marks dirty + schedules one RAF.
  record(line) {
    if (!this.enabled) return;
    this._dirty.add(line);
    if (this._raf === null) this._raf = requestAnimationFrame(() => this._flush());
  }

  _flush() {
    this._raf = null;
    if (!this._dirty.size) return;
    const cm = this._getCm();
    const lines = new Set(this._active.keys());
    for (const line of this._dirty) {
      // Cancel existing removal timer so hot lines stay lit.
      const existing = this._active.get(line);
      if (existing != null) this._native.clearTimeout(existing);
      const tid = this._native.setTimeout(() => {
        this._active.delete(line);
        const c = this._getCm();
        if (c) c.dispatch({ effects: setTraceLinesEffect.of(new Set(this._active.keys())) });
      }, 800);
      this._active.set(line, tid);
      lines.add(line);
    }
    this._dirty.clear();
    if (cm) cm.dispatch({ effects: setTraceLinesEffect.of(new Set(lines)) });
  }

  // Kill all glow + pending timers. Called on every stop path (manual stop, error,
  // idle auto-stop) so stale execution-trail glow never survives a run.
  clear() {
    if (this._raf !== null) {
      cancelAnimationFrame(this._raf);
      this._raf = null;
    }
    for (const tid of this._active.values()) this._native.clearTimeout(tid);
    this._active.clear();
    this._dirty.clear();
    const cm = this._getCm();
    if (cm) cm.dispatch({ effects: setTraceLinesEffect.of(null) });
  }
}
