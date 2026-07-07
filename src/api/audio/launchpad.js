// Launchpad — a live soundboard grid on the shared Binding/Voice chassis (ADR 047).
// Exposed as: new Launchpad(opts) and audio.launchpad(opts).
//
// A configurable rows×cols grid of cells (Triggers). Each cell can be bound to a
// custom Voice and/or a named Action (bus event) via the shared BindingMap
// (ADR 046). Unbound cells play a default Voice at a per-cell pitch, so the grid
// is playable out of the box. Live-only — no step sequencer (that's the Drumpad's
// identity); live play is captured as a Performance/Take (ADR 031). Joins the
// sticky MIDI Target rotation for input (ADR 033).

import * as Tone from 'tone';
import { connectSurfaceStrip } from './mixer.js';
import { midiToNote } from './music-theory.js';
import { Voice } from './voice.js';
import { insertSnippet } from '../../editor/active-editor.js';
import { mountWidgetShell, wireCaptureButton } from '../widgets/widget-shell.js';
import { onReset } from '../../runtime/reset-registry.js';
import { registerDesktopFileType } from '../platform/desktop-file-registry.js';
import { wireMidiInstrument } from './midi-bind.js';
import {
  initTriggerSurface,
  enableSurfaceMidi,
  detachTriggerSurface,
  disposeTriggerSurface,
  strikeCore,
} from './trigger-surface.js';

const _launchpads = [];

/** Clear all user-registered hooks on every live launchpad (called on reset). */
export function cleanupLaunchpads() {
  for (const lp of _launchpads) lp._clearHooks();
}

// Pad palette — cells cycle through these as visual identity for bound targets.
const CELL_BG = '#1a1a2e';
const CELL_BG_ACTIVE = '#313244';

export class Launchpad {
  constructor({
    title = 'Launchpad',
    x,
    y,
    w,
    h,
    rows = 8,
    cols = 8,
    baseNote = 36, // MIDI note of cell 0 (also the MIDI input base)
    voice: initVoice,
    bindings: initBindings,
    _desktopIconId: existingIconId,
  } = {}) {
    this._title = title;
    this._rows = Math.max(1, rows);
    this._cols = Math.max(1, cols);
    this._baseNote = baseNote;
    this._winId = null;
    this._cells = []; // DOM buttons, index = r*cols+c
    this._desktopIconId = existingIconId ?? null;
    this._autoSave = () => {};

    // Shared Trigger Surface chassis: output bus + Strip, BindingMap, events, Take.
    initTriggerSurface(this, { registry: _launchpads, bindings: initBindings });

    // Default Voice for unbound cells (FM unless overridden).
    this._defaultDesc = initVoice ?? { engine: 'fm' };
    this._defaultHandle = null;

    this._init(title, x, y, w, h);

    enableSurfaceMidi(this);
    if (!existingIconId) this._autoSave();
  }

  get _total() {
    return this._rows * this._cols;
  }

  // Resolve a cell argument → index 0..total-1 or null. Accepts an index or 'r,c'.
  _cellIndex(cell) {
    if (cell == null) return null;
    if (typeof cell === 'number') return cell >= 0 && cell < this._total ? cell : null;
    const m = String(cell).match(/^(\d+)\s*,\s*(\d+)$/);
    if (m) {
      const r = +m[1],
        c = +m[2];
      if (r >= 0 && r < this._rows && c >= 0 && c < this._cols) return r * this._cols + c;
    }
    return null;
  }

  _noteFor(cell) {
    return midiToNote(this._baseNote + cell);
  }

  _ensureDefault() {
    if (!this._defaultHandle) {
      this._defaultHandle = Voice.make(this._defaultDesc);
      try {
        this._defaultHandle.output.connect(this._out);
      } catch (_) {}
    }
    return this._defaultHandle;
  }

  // ── Strike a cell (the one sound/event path; source tags the origin) ──────────
  _strike(cell, source = 'pad', vel = 1) {
    if (cell == null || cell < 0 || cell >= this._total) return;
    const time = Tone.now();
    const handle = this._bindings.voiceFor(cell);
    const payload = {
      cell,
      row: Math.floor(cell / this._cols),
      col: cell % this._cols,
      source,
      velocity: vel,
    };
    strikeCore(this, cell, {
      sound: () => {
        const h = handle ?? this._ensureDefault();
        if (h?.kind === 'sample' && h.mode === 'chopped') h.triggerSlice(cell, time, vel);
        else h?.trigger(this._noteFor(cell), '8n', time, vel);
      },
      payload: () => payload,
      after: () => {
        this._flashCell(cell);
        this._events.emit('hit', payload);
      },
    });
  }

  // ── MIDI input (ADR 033) — one-shot; note → cell via baseNote offset ──────────
  _midiNoteOn(num, vel = 1) {
    const cell = num - this._baseNote;
    if (cell < 0 || cell >= this._total) return;
    this._take.push({ cell, vel });
    this._strike(cell, 'midi', vel);
  }

  _midiNoteOff() {
    /* one-shot */
  }

  // ── Performance capture / replay (ADR 031) ───────────────────────────────────
  // Public verb (replay calls this; does NOT record — live input records inline).
  strike(cell) {
    const ci = this._cellIndex(cell);
    if (ci != null) this._strike(ci, 'replay');
    return this;
  }

  _applyAction(a) {
    if (a && a.cell != null) this._strike(a.cell, 'replay', a.vel ?? 1);
  }

  _perfCtor() {
    return {
      varName: 'lp',
      code: `const lp = audio.launchpad({ title: '${String(this._title).replace(/'/g, "\\'")}', rows: ${this._rows}, cols: ${this._cols} });`,
    };
  }

  // ── Bindings (ADR 046) ────────────────────────────────────────────────────────
  bind(cell, voiceNameOrDesc) {
    const ci = this._cellIndex(cell);
    if (ci != null) {
      this._bindings.bindVoice(ci, voiceNameOrDesc);
      this._paintCell(ci);
      this._autoSave();
    }
    return this;
  }

  bindAction(cell, event, opts = {}) {
    const ci = this._cellIndex(cell);
    if (ci != null) {
      this._bindings.bindAction(ci, event, opts);
      this._paintCell(ci);
      this._autoSave();
    }
    return this;
  }

  unbind(cell) {
    const ci = this._cellIndex(cell);
    if (ci != null) {
      this._bindings.unbind(ci);
      this._paintCell(ci);
      this._autoSave();
    }
    return this;
  }

  // Set the default Voice played by unbound cells.
  voice(nameOrDesc) {
    this._defaultDesc =
      typeof nameOrDesc === 'string' ? (Voice.get(nameOrDesc) ?? { engine: 'fm' }) : nameOrDesc;
    try {
      this._defaultHandle?.dispose?.();
    } catch (_) {}
    this._defaultHandle = null;
    this._autoSave();
    return this;
  }

  // ── Events / signals (per-instance, cleared on reset) ─────────────────────────
  onHit(fn) {
    this._events.on('hit', fn);
    return this;
  }

  // Scoped to one cell (index or 'r,c').
  onCell(cell, fn) {
    const ci = this._cellIndex(cell);
    if (ci == null) {
      console.warn(`[Launchpad] onCell: bad cell '${cell}'. Use an index or 'r,c'.`);
      return this;
    }
    this._events.on('hit', (e) => {
      if (e.cell === ci) fn(e);
    });
    return this;
  }

  signal(cell = null, { decay = 250 } = {}) {
    const ci = cell == null ? null : this._cellIndex(cell);
    return this._events.signal('hit', {
      decay,
      match: ci == null ? null : (e) => e.cell === ci,
    });
  }

  _clearHooks() {
    this._events.clear();
  }

  // ── Build the window ──────────────────────────────────────────────────────────
  _init(title, x, y, w, h) {
    if (!window.wm) return;
    const cellPx = 44;
    const gw = w ?? this._cols * cellPx + 24;
    const gh = h ?? this._rows * cellPx + 76;

    const shell = mountWidgetShell({
      title,
      x,
      y,
      w: gw,
      h: gh,
      widgetType: 'launchpad',
      bg: '#0d0d1a',
      rows: [],
      getState: () => ({
        title: this._title,
        rows: this._rows,
        cols: this._cols,
        baseNote: this._baseNote,
        voice: this._defaultDesc,
        bindings: this._bindings.serialize(),
        _desktopIconId: this._desktopIconId,
      }),
      save: {
        name: (this._title || 'Launchpad') + '.pad',
        type: 'launchpad',
        getIconId: () => this._desktopIconId,
        setIconId: (id) => {
          this._desktopIconId = id;
        },
      },
      keepIconOnClose: true,
      onDestroy: () => this._destroy(),
    });
    if (!shell) return;
    this._winId = shell.winId;
    this._autoSave = shell.save;
    this._strip = connectSurfaceStrip(this._out, this._title, 'launchpad', this._winId);
    const body = shell.body;

    // ── Grid ──────────────────────────────────────────────────────────────────
    const grid = document.createElement('div');
    grid.style.cssText = `display:grid;grid-template-columns:repeat(${this._cols},1fr);gap:5px;padding:10px;flex:1;min-height:0;`;
    for (let i = 0; i < this._total; i++) {
      const cell = document.createElement('button');
      cell.dataset.cell = i;
      cell.style.cssText = `border:none;border-radius:6px;background:${CELL_BG};cursor:pointer;transition:background .08s;min-height:28px;`;
      cell.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this._take.push({ cell: i });
        this._strike(i, 'pad');
      });
      this._cells[i] = cell;
      grid.appendChild(cell);
      this._paintCell(i);
    }
    body.appendChild(grid);

    // ── Controls ──────────────────────────────────────────────────────────────
    const ctrl = document.createElement('div');
    ctrl.style.cssText =
      'display:flex;gap:6px;align-items:center;padding:6px 10px;border-top:1px solid #1e1e2e;flex-shrink:0;';

    const mkBtn = (label, color) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.style.cssText = `background:#1e1e2e;color:${color};border:1px solid #313244;border-radius:5px;padding:3px 7px;cursor:pointer;font-size:12px;`;
      return b;
    };

    const codeBtn = mkBtn('</>', '#cba6f7');
    codeBtn.title = 'Copy code to editor';
    codeBtn.addEventListener('click', () => {
      const lines = [this._perfCtor().code];
      for (const k of this._bindings.keys()) {
        const b = this._bindings.get(k);
        if (b?.voice) lines.push(`lp.bind(${k}, ${JSON.stringify(b.voice)});`);
        if (b?.event)
          lines.push(`lp.bindAction(${k}, '${b.event}'${b.silent ? ', { silent: true }' : ''});`);
      }
      insertSnippet(lines.join('\n'));
    });

    const capBtn = mkBtn('● Rec', '#f38ba8');
    wireCaptureButton(capBtn, { take: this._take, widget: this });

    const midiChip = mkBtn('🎹', '#45475a');
    wireMidiInstrument(this, {
      chip: midiChip,
      tooltips: {
        target: 'MIDI input → this Launchpad',
        idle: 'MIDI on — focus this Launchpad to play it',
        dormant: 'Enable MIDI input',
      },
    });

    ctrl.appendChild(codeBtn);
    ctrl.appendChild(capBtn);
    ctrl.appendChild(midiChip);
    body.appendChild(ctrl);
  }

  // Recolor a cell to reflect its binding (voice/action/empty).
  _paintCell(i) {
    const el = this._cells[i];
    if (!el) return;
    const b = this._bindings.get(i);
    if (b?.voice) {
      el.style.background = '#2a2a4a';
      el.title = `Voice: ${b.voice.name ?? b.voice.engine ?? b.voice.kind}`;
    } else if (b?.event) {
      el.style.background = b.silent ? '#3a2a2a' : '#2a3a2a';
      el.title = `Action: ${b.event}${b.silent ? ' (silent)' : ''}`;
    } else {
      el.style.background = CELL_BG;
      el.title = '';
    }
  }

  _flashCell(i) {
    const el = this._cells[i];
    if (!el) return;
    const prev = el.style.background;
    el.style.background = CELL_BG_ACTIVE;
    setTimeout(() => {
      el.style.background = prev;
    }, 90);
  }

  _destroy() {
    this._clearHooks();
    detachTriggerSurface(this, _launchpads);
    disposeTriggerSurface(this);
  }
}

// Register teardown with the reset registry (ADR 008).
onReset(cleanupLaunchpads);

// Desktop File-Type Adapter (ADR 055) — owns 'launchpad' icon glyph + restore.
registerDesktopFileType('launchpad', {
  glyph: 'fa-solid fa-table-cells',
  cssClass: 'dt-beat-icon',
  open: (data, pos) => new Launchpad({ ...data, ...pos }),
});
