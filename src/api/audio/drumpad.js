// Drumpad — grid of pads backed by Tone.js synths + 16-step sequencer.
// Exposed as: new Drumpad(opts) and audio.drumpad(opts).
// Spawns a WM window; cleanup on window close via _wmCleanup.
//
// Event/signal API (per-instance):
//   dp.onHit(fn)          — fn({vi,id,label,source,step}) on any pad hit
//   dp.onPad(voice, fn)   — fn({vi,id,label,source,step}) scoped to one pad (index 0-7 or name 'kick'/'Kick')
//   dp.onStep(fn)         — fn({step,activeVoices:[vi…]}) once per sequencer step
//   dp.signal(voice?,opts?)→ {value,velocity,stream(fn),on(fn)} decaying-pulse 0–1
// Hooks are per-instance and cleared by cleanupDrumpads() on reset (windows survive reset).
// Event plumbing delegates to WidgetEvents (src/api/widgets/widget-events.js).

import * as Tone from 'tone';
import { WidgetEvents } from '../widgets/widget-events.js';
import { insertSnippet } from '../../editor/active-editor.js';
import { mountWidgetShell, wireCaptureButton } from '../widgets/widget-shell.js';
import { onReset } from '../../runtime/reset-registry.js';
import { Take } from '../signal/performance-recorder.js';
import { replayActions } from '../signal/replay-clock.js';
import {
  registerMidiInstrument,
  unregisterMidiInstrument,
  notifyMidiFocus,
  wireMidiInstrument,
} from './midi-bind.js';

// General MIDI percussion note → voice id (ADR 033). Common aliases included.
// Unmapped notes are ignored.
const GM_DRUM_MAP = {
  35: 'kick',
  36: 'kick',
  38: 'snare',
  40: 'snare',
  42: 'hhc',
  44: 'hhc',
  46: 'hho',
  39: 'clap',
  41: 'tomL',
  43: 'tomL',
  45: 'tomL',
  47: 'tomH',
  48: 'tomH',
  50: 'tomH',
  49: 'cym',
  51: 'cym',
  57: 'cym',
};

// ── Module-level registry ─────────────────────────────────────────────────────

const _drumpads = [];

/** Clear all user-registered hooks on all live drumpad instances (called on reset). */
export function cleanupDrumpads() {
  for (const dp of _drumpads) dp._clearHooks();
}

const _PAD_EMOJI = ['🥁', '🪘', '🎩', '🪗', '👏', '🪩', '🥁', '🔔'];

// ── Voice presets ────────────────────────────────────────────────────────────

const VOICES = [
  {
    id: 'kick',
    label: 'Kick',
    key: 'q',
    color: '#f38ba8',
    make: () =>
      new Tone.MembraneSynth({
        pitchDecay: 0.05,
        octaves: 6,
        envelope: { attack: 0.001, decay: 0.3, sustain: 0, release: 0.3 },
      }).toDestination(),
    note: 'C1',
    dur: '8n',
  },
  {
    id: 'snare',
    label: 'Snare',
    key: 'w',
    color: '#fab387',
    make: () =>
      new Tone.NoiseSynth({
        noise: { type: 'white' },
        envelope: { attack: 0.001, decay: 0.18, sustain: 0, release: 0.12 },
      }).toDestination(),
    note: null,
    dur: '8n',
  },
  {
    id: 'hhc',
    label: 'HH Cl',
    key: 'e',
    color: '#a6e3a1',
    make: () =>
      new Tone.MetalSynth({
        frequency: 400,
        envelope: { attack: 0.001, decay: 0.08, release: 0.05 },
        harmonicity: 5.1,
        modulationIndex: 32,
        resonance: 4000,
        octaves: 1.5,
      }).toDestination(),
    note: null,
    dur: '32n',
  },
  {
    id: 'hho',
    label: 'HH Op',
    key: 'r',
    color: '#89dceb',
    make: () =>
      new Tone.MetalSynth({
        frequency: 400,
        envelope: { attack: 0.001, decay: 0.4, release: 0.2 },
        harmonicity: 5.1,
        modulationIndex: 32,
        resonance: 4000,
        octaves: 1.5,
      }).toDestination(),
    note: null,
    dur: '4n',
  },
  {
    id: 'clap',
    label: 'Clap',
    key: 'a',
    color: '#cba6f7',
    make: () =>
      new Tone.NoiseSynth({
        noise: { type: 'pink' },
        envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.05 },
      }).toDestination(),
    note: null,
    dur: '16n',
  },
  {
    id: 'tomL',
    label: 'Tom L',
    key: 's',
    color: '#f9e2af',
    make: () =>
      new Tone.MembraneSynth({
        pitchDecay: 0.08,
        octaves: 4,
        envelope: { attack: 0.001, decay: 0.4, sustain: 0, release: 0.4 },
      }).toDestination(),
    note: 'G1',
    dur: '8n',
  },
  {
    id: 'tomH',
    label: 'Tom H',
    key: 'd',
    color: '#89b4fa',
    make: () =>
      new Tone.MembraneSynth({
        pitchDecay: 0.06,
        octaves: 4,
        envelope: { attack: 0.001, decay: 0.3, sustain: 0, release: 0.3 },
      }).toDestination(),
    note: 'C2',
    dur: '8n',
  },
  {
    id: 'cym',
    label: 'Cymbal',
    key: 'f',
    color: '#74c7ec',
    make: () =>
      new Tone.MetalSynth({
        frequency: 200,
        envelope: { attack: 0.001, decay: 1.2, release: 0.6 },
        harmonicity: 5.1,
        modulationIndex: 32,
        resonance: 3000,
        octaves: 2,
      }).toDestination(),
    note: null,
    dur: '4n',
  },
];

const STEPS = 16;

// ── Drumpad class ─────────────────────────────────────────────────────────────

export class Drumpad {
  constructor({
    title = 'Drum Pad',
    x,
    y,
    w = 500,
    h = 360,
    bpm: initBpm,
    patterns: initPatterns,
    _desktopIconId: existingIconId,
  } = {}) {
    this._voices = VOICES.map((v) => ({
      ...v,
      synth: v.make(),
      steps: Array.from({ length: STEPS }, () => false),
      _pad: null,
      _flash: null,
      _cells: [],
    }));
    this._bpm = initBpm ?? 120;
    this._playing = false;
    this._paused = false;
    this._sequence = null;
    this._winId = null;
    this._keyMap = {};
    this._onKey = null;
    this._title = title;
    this._desktopIconId = existingIconId ?? null;
    this._playBtn = null; // set in _init; used by onDestroy

    // Replaced per-instance by the shell in _init(); no-op until then.
    this._autoSave = () => {};

    // ── Event/signal hook state ───────────────────────────────────────────────
    this._events = new WidgetEvents();
    this._take = new Take(this); // Performance capture (ADR 031)
    _drumpads.push(this);

    this._init(title, x, y, w, h);

    // MIDI binding (ADR 033): register, then claim focus (window spawned frontmost).
    if (this._winId) {
      registerMidiInstrument(this);
      notifyMidiFocus(this);
    }

    if (initPatterns) {
      initPatterns.forEach((steps, vi) => {
        steps?.forEach((on, s) => {
          if (on) this.step(vi, s, true);
        });
      });
    }
    if (!existingIconId) this._autoSave(); // create desktop icon on first spawn
  }

  // ── Resolve voice name/index → 0-7 or null ──────────────────────────────────
  _voiceIndex(voice) {
    if (voice == null) return null;
    if (typeof voice === 'number') return voice >= 0 && voice < this._voices.length ? voice : null;
    const lo = String(voice).toLowerCase();
    const i = this._voices.findIndex((v) => v.id === lo || v.label.toLowerCase() === lo);
    return i >= 0 ? i : null;
  }

  // ── Fire hit event via WidgetEvents ──────────────────────────────────────────
  _fireHit(vi, source, step, vel = 1) {
    const v = this._voices[vi];
    const ev = { vi, id: v?.id ?? vi, label: v?.label ?? String(vi), source, step, velocity: vel };
    this._events.emit('hit', ev);
  }

  // ── Trigger a voice (note + optional Tone time for precise scheduling) ──────
  _trigger(vi, time = Tone.now(), ctx = {}) {
    const v = this._voices[vi];
    if (!v?.synth) return;
    const vel = ctx.vel ?? 1;
    try {
      if (v.note) v.synth.triggerAttackRelease(v.note, v.dur, time, vel);
      else v.synth.triggerAttackRelease(v.dur, time, vel);
    } catch (_) {}
    this._fireHit(vi, ctx.source ?? 'pad', ctx.step ?? null, vel);
  }

  // ── MIDI input (ADR 033) — driven by the focus-routed coordinator ────────────
  // One-shot: note-on maps via the GM drum map and triggers; note-off is ignored.
  // source 'midi' (not 'replay') so live MIDI is captured into the Take.
  _midiNoteOn(num, vel = 1) {
    const vi = this._voiceIndex(GM_DRUM_MAP[num]);
    if (vi == null) return;
    this._take.push({ vi, vel });
    this._trigger(vi, Tone.now(), { source: 'midi', vel });
    this._voices[vi]._flash?.();
  }

  _midiNoteOff() {
    /* one-shot voices — nothing to release */
  }

  // _setMidiChip is installed by wireMidiInstrument() — see midi-bind.js.

  // ── Performance capture / replay (ADR 031) ──────────────────────────────────
  // Public one-shot trigger — the replay verb. Does NOT record (replay must not
  // re-capture); live pad/key input records via this._take.push() at the input
  // sites instead.
  hit(voice) {
    const vi = this._voiceIndex(voice);
    if (vi != null) this._trigger(vi, Tone.now(), { source: 'replay' });
    return this;
  }

  // Apply one recorded action {t, vi}.
  _applyAction(a) {
    if (a && a.vi != null) this._trigger(a.vi, Tone.now(), { source: 'replay', vel: a.vel ?? 1 });
  }

  // Replay a captured Take.
  replay(actions, opts) {
    return replayActions((a) => this._applyAction(a), actions, opts);
  }

  // Self-contained constructor code for the emitted snippet/timeline track.
  _perfCtor() {
    return {
      varName: 'dp',
      code: `const dp = audio.drumpad({ title: '${String(this._title).replace(/'/g, "\\'")}', bpm: ${this._bpm} });`,
    };
  }

  // ── Build the window ─────────────────────────────────────────────────────────
  _init(title, x, y, w, h) {
    if (!window.wm) return;

    // Shell owns the window, body styling, autosave, history, and lifecycle.
    // Drumpad has no frames, so it skips the frame strip/transport builders and
    // appends its pad grid / sequencer / controls straight into shell.body.
    const shell = mountWidgetShell({
      title,
      x,
      y,
      w,
      h,
      widgetType: 'drumpad',
      bg: '#0d0d1a',
      rows: [],
      getState: () => ({
        title: this._title,
        bpm: this._bpm,
        patterns: this._voices.map((v) => [...v.steps]),
        _desktopIconId: this._desktopIconId,
      }),
      save: {
        name: (this._title || 'Beat') + '.beat',
        type: 'beat',
        getIconId: () => this._desktopIconId,
        setIconId: (id) => {
          this._desktopIconId = id;
        },
      },
      history: {
        capture: () => ({ bpm: this._bpm, patterns: this._voices.map((v) => [...v.steps]) }),
        restore: (snap) => {
          this._bpm = snap.bpm;
          try {
            Tone.getTransport().bpm.value = snap.bpm;
          } catch (_) {}
          snap.patterns.forEach((steps, vi) => {
            const v = this._voices[vi];
            if (!v) return;
            steps.forEach((on, s) => {
              v.steps[s] = on;
              if (v._cells[s]) v._cells[s].style.background = on ? v.color + 'cc' : '#1a1a2e';
            });
          });
        },
      },
      keepIconOnClose: true,
      onDestroy: () => this._destroy(this._playBtn),
    });
    if (!shell) return;
    this._winId = shell.winId;
    this._autoSave = shell.save;
    this._history = shell.history;
    const body = shell.body;

    // ── Pad grid (2 rows × 4 cols) ────────────────────────────────────────────
    const padGrid = document.createElement('div');
    padGrid.style.cssText =
      'display:grid;grid-template-columns:repeat(4,1fr);gap:6px;padding:10px 10px 6px;flex-shrink:0;';

    this._voices.forEach((v, vi) => {
      const pad = document.createElement('button');
      pad.style.cssText = [
        `background:#1e1e2e;border:2px solid ${v.color}44;border-radius:8px;`,
        `color:${v.color};font-size:10px;font-family:monospace;font-weight:bold;`,
        `padding:10px 4px;cursor:pointer;display:flex;flex-direction:column;`,
        `align-items:center;gap:3px;user-select:none;`,
        `transition:background 0.06s,border-color 0.06s,transform 0.06s;`,
      ].join('');
      pad.innerHTML =
        `<span style="font-size:18px;line-height:1;">${_PAD_EMOJI[vi] ?? '🎵'}</span>` +
        `<span>${v.label}</span>` +
        `<span style="font-size:8px;opacity:0.45;">[${v.key}]</span>`;

      const flash = () => {
        pad.style.background = v.color + '55';
        pad.style.borderColor = v.color;
        pad.style.transform = 'scale(0.94)';
        setTimeout(() => {
          pad.style.background = '#1e1e2e';
          pad.style.borderColor = v.color + '44';
          pad.style.transform = '';
        }, 100);
      };

      pad.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this._take.push({ vi });
        this._trigger(vi, Tone.now(), { source: 'pad' });
        flash();
      });
      v._pad = pad;
      v._flash = flash;
      this._keyMap[v.key] = vi;
      padGrid.appendChild(pad);
    });

    body.appendChild(padGrid);

    // ── Step sequencer (one row per voice, 16 steps) ──────────────────────────
    const seqWrap = document.createElement('div');
    seqWrap.style.cssText =
      'flex:1;overflow-y:auto;padding:0 10px 4px;display:flex;flex-direction:column;gap:3px;min-height:0;';

    this._voices.forEach((v) => {
      const row = document.createElement('div');
      row.style.cssText =
        'display:grid;grid-template-columns:42px repeat(16,1fr);gap:2px;align-items:center;';

      const lbl = document.createElement('span');
      lbl.style.cssText = `font-size:9px;color:${v.color};font-family:monospace;text-align:right;padding-right:5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;`;
      lbl.textContent = v.label;
      row.appendChild(lbl);

      for (let s = 0; s < STEPS; s++) {
        const cell = document.createElement('button');
        // Group visual: darken every 4th boundary
        const groupStart = s % 4 === 0;
        cell.style.cssText =
          `height:18px;border-radius:2px;border:1px solid #313244;` +
          `background:#1a1a2e;cursor:pointer;padding:0;` +
          (groupStart && s > 0 ? 'margin-left:2px;' : '');
        cell.dataset.step = s;
        cell.addEventListener('click', () => {
          v.steps[s] = !v.steps[s];
          cell.style.background = v.steps[s] ? v.color + 'cc' : '#1a1a2e';
          this._history?.commit();
          this._autoSave();
        });
        v._cells.push(cell);
        row.appendChild(cell);
      }
      seqWrap.appendChild(row);
    });

    body.appendChild(seqWrap);

    // ── Transport bar ─────────────────────────────────────────────────────────
    const ctrl = document.createElement('div');
    ctrl.style.cssText =
      'display:flex;align-items:center;gap:6px;padding:6px 10px;background:#13131f;border-top:1px solid #2a2a3e;flex-shrink:0;';

    const _mkBtn = (label, color) => {
      const b = document.createElement('button');
      b.style.cssText = `background:#1e1e2e;color:${color};border:1px solid #313244;border-radius:4px;padding:3px 10px;font-size:11px;cursor:pointer;font-family:monospace;transition:background 0.1s;`;
      b.textContent = label;
      b.addEventListener('mouseenter', () => {
        b.style.background = '#313244';
      });
      b.addEventListener('mouseleave', () => {
        b.style.background = '#1e1e2e';
      });
      return b;
    };

    const playBtn = _mkBtn('▶ Play', '#a6e3a1');
    const stopBtn = _mkBtn('■ Stop', '#f38ba8');
    const clearBtn = _mkBtn('✕ Clear', '#6c7086');

    const bpmLbl = document.createElement('span');
    bpmLbl.style.cssText = 'color:#6c7086;font-size:10px;font-family:monospace;margin-left:auto;';
    bpmLbl.textContent = 'BPM:';

    const bpmIn = document.createElement('input');
    bpmIn.type = 'number';
    bpmIn.min = '40';
    bpmIn.max = '300';
    bpmIn.value = String(this._bpm);
    bpmIn.style.cssText =
      'width:52px;background:#1e1e2e;color:#cdd6f4;border:1px solid #313244;border-radius:3px;padding:2px 4px;font-size:11px;font-family:monospace;text-align:center;';

    playBtn.addEventListener('click', () => {
      if (!this._playing) {
        // Start fresh
        this._playing = true;
        this._paused = false;
        Tone.getTransport().bpm.value = parseInt(bpmIn.value) || 120;
        let step = 0;
        this._sequence = new Tone.Sequence(
          (time) => {
            const s = step;
            requestAnimationFrame(() => {
              this._voices.forEach((v) => {
                v._cells.forEach((c, i) => {
                  c.style.boxShadow = i === s ? `0 0 0 2px ${v.color}` : '';
                });
              });
            });
            const activeVoices = [];
            this._voices.forEach((v, vi) => {
              if (v.steps[s]) {
                this._trigger(vi, time, { source: 'seq', step: s });
                activeVoices.push(vi);
              }
            });
            const stepEv = { step: s, activeVoices };
            this._events.emit('step', stepEv);
            step = (step + 1) % STEPS;
          },
          [...Array(STEPS).keys()],
          '16n',
        );
        this._sequence.start(0);
        Tone.getTransport().start();
        playBtn.textContent = '⏸ Pause';
        playBtn.style.background = '#1a3d1a';
      } else if (!this._paused) {
        // Pause — freeze at current step
        this._paused = true;
        Tone.getTransport().pause();
        playBtn.textContent = '▶ Play';
        playBtn.style.background = '#1e1e2e';
      } else {
        // Resume from pause
        this._paused = false;
        Tone.getTransport().start();
        playBtn.textContent = '⏸ Pause';
        playBtn.style.background = '#1a3d1a';
      }
    });

    stopBtn.addEventListener('click', () => this._stop(playBtn));

    clearBtn.addEventListener('click', () => {
      this._voices.forEach((v) => {
        v.steps.fill(false);
        v._cells.forEach((c) => {
          c.style.background = '#1a1a2e';
        });
      });
      this._history?.commit();
      this._autoSave();
    });

    bpmIn.addEventListener('change', () => {
      this._bpm = parseInt(bpmIn.value) || 120;
      Tone.getTransport().bpm.value = this._bpm;
      this._history?.commit();
      this._autoSave();
    });

    // ── Copy Code ─────────────────────────────────────────────────────────────
    const codeBtn = _mkBtn('</>', '#cba6f7');
    codeBtn.title = 'Copy code to editor';
    codeBtn.style.padding = '3px 7px';
    codeBtn.addEventListener('click', () => {
      const lines = [`const dp = audio.drumpad({ title: '${title}', bpm: ${this._bpm} });`];
      this._voices.forEach((v, vi) => {
        if (v.steps.some(Boolean)) {
          const pat = v.steps.map((on) => (on ? 'x' : '.')).join(' ');
          lines.push(`dp.pattern(${vi}, '${pat}'); // ${v.label}`);
        }
      });
      const code = lines.join('\n');
      insertSnippet(code);
    });

    // ── Capture ● (Performance recording → replay code) ───────────────────────
    const capBtn = _mkBtn('● Rec', '#f38ba8');
    capBtn.style.padding = '3px 7px';
    wireCaptureButton(capBtn, { take: this._take, widget: this });

    // ── MIDI chip (ADR 033) — opt-in / target indicator ─────────────────────────
    const midiChip = _mkBtn('🎹', '#45475a');
    midiChip.style.padding = '3px 7px';
    wireMidiInstrument(this, {
      chip: midiChip,
      tooltips: {
        target: 'MIDI input → this Drum Pad (GM map)',
        idle: 'MIDI on — focus this Drum Pad to play it',
        dormant: 'Enable MIDI input',
      },
    });

    ctrl.appendChild(playBtn);
    ctrl.appendChild(stopBtn);
    ctrl.appendChild(clearBtn);
    ctrl.appendChild(bpmLbl);
    ctrl.appendChild(bpmIn);
    ctrl.appendChild(codeBtn);
    ctrl.appendChild(capBtn);
    ctrl.appendChild(midiChip);
    body.appendChild(ctrl);

    // ── Keyboard triggers ─────────────────────────────────────────────────────
    this._onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target instanceof HTMLInputElement) return;
      const vi = this._keyMap[e.key?.toLowerCase()];
      if (vi != null) {
        this._take.push({ vi });
        this._trigger(vi, Tone.now(), { source: 'key' });
        this._voices[vi]._flash?.();
      }
    };
    document.addEventListener('keydown', this._onKey);

    // playBtn is captured for the shell's onDestroy (see _init head).
    this._playBtn = playBtn;
  }

  // ── Public methods ────────────────────────────────────────────────────────────

  /** Set BPM */
  bpm(val) {
    this._bpm = val;
    Tone.getTransport().bpm.value = val;
    this._history?.commit();
    this._autoSave();
    return this;
  }

  /** Toggle a step on/off: voice index (0-7), step (0-15) */
  step(vi, s, on = true) {
    const v = this._voices[vi];
    if (!v) return this;
    v.steps[s] = on;
    if (v._cells[s]) v._cells[s].style.background = on ? v.color + 'cc' : '#1a1a2e';
    this._history?.commit();
    this._autoSave();
    return this;
  }

  /** Fill a voice row from a pattern string ('x . x .' etc.) */
  pattern(vi, str) {
    const tokens = str.trim().split(/\s+/);
    for (let s = 0; s < STEPS; s++) this.step(vi, s, tokens[s % tokens.length] === 'x');
    return this;
  }

  // ── Event / signal public API ─────────────────────────────────────────────────

  /**
   * Fire fn({vi, id, label, source, step}) whenever any pad is hit.
   * source: 'pad' | 'key' | 'seq'. step: sequencer step index or null.
   */
  onHit(fn) {
    this._events.on('hit', fn);
    return this;
  }

  /**
   * Fire fn({vi, id, label, source, step}) only when a specific pad fires.
   * @param {number|string} voice  — 0-7 index, or name/id like 'kick' / 'Kick'.
   */
  onPad(voice, fn) {
    const vi = this._voiceIndex(voice);
    if (vi === null) {
      console.warn(`[Drumpad] onPad: unknown voice '${voice}'. Use index 0-7 or name like 'kick'.`);
      return this;
    }
    this._events.on('hit', (e) => {
      if (e.vi === vi) fn(e);
    });
    return this;
  }

  /**
   * Fire fn({step, activeVoices:[vi…]}) once per sequencer step (only while playing).
   * step = 0-15. activeVoices = indices of voices that fired this step.
   */
  onStep(fn) {
    this._events.on('step', fn);
    return this;
  }

  /**
   * Return a live decaying-pulse signal for a pad (or the whole kit).
   * value: 1.0 on hit, linearly decays to 0 over opts.decay ms (default 250).
   * @param {number|string|null} [voice]   — pad index/name; omit for any-pad (whole kit).
   * @param {{ decay?: number }}  [opts]
   * @returns {{ value: number, velocity: number, stream(fn): sig, on(fn): sig }}
   */
  signal(voice = null, { decay = 250 } = {}) {
    const vi = voice != null ? this._voiceIndex(voice) : null;
    return this._events.signal('hit', {
      decay,
      match: (e) => vi === null || e.vi === vi,
    });
  }

  // ── Clear user hooks (called on reset — does NOT destroy the window) ──────────
  _clearHooks() {
    this._events.clear();
  }

  _stop(playBtn) {
    if (this._sequence) {
      try {
        this._sequence.stop();
        this._sequence.dispose();
      } catch (_) {}
      this._sequence = null;
    }
    try {
      Tone.getTransport().stop();
    } catch (_) {}
    this._playing = false;
    this._paused = false;
    this._voices.forEach((v) =>
      v._cells.forEach((c) => {
        c.style.boxShadow = '';
      }),
    );
    if (playBtn) {
      playBtn.textContent = '▶ Play';
      playBtn.style.background = '#1e1e2e';
    }
  }

  _destroy(playBtn) {
    this._stop(playBtn);
    this._clearHooks();
    unregisterMidiInstrument(this);
    const idx = _drumpads.indexOf(this);
    if (idx >= 0) _drumpads.splice(idx, 1);
    if (this._onKey) {
      document.removeEventListener('keydown', this._onKey);
      this._onKey = null;
    }
    this._voices.forEach((v) => {
      try {
        v.synth?.dispose();
      } catch (_) {}
    });
  }
}

// Register teardown with the reset registry (ADR 008).
onReset(cleanupDrumpads);
