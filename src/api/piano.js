// Piano — polyphonic piano widget with chord-per-step sequencer, backed by Tone.js.
// Exposed as: new Piano(opts) — window global wired in app.js separately.
// Spawns a WM window; cleanup on window close via _wmCleanup.
//
// Event/signal API (per-instance):
//   piano.onNote(fn)          — fn({note, midi, velocity, source, step}) on any note played
//   piano.onKey(note, fn)     — fn({...}) scoped to one note string like 'C4'
//   piano.onStep(fn)          — fn({step, notes: ['C4','E4']}) once per sequencer step
//   piano.signal(note, opts)  — decaying 0-1 signal; note=null for any note
// Hooks are per-instance and cleared by cleanupPianos() on reset (windows survive reset).
// Event plumbing delegates to WidgetEvents (src/api/widget-events.js).

import * as Tone from 'tone';
import { WidgetEvents } from './widget-events.js';
import { insertSnippet } from '../editor/active-editor.js';
import { mountWidgetShell, wireCaptureButton } from './widget-shell.js';
import { onReset } from '../runtime/reset-registry.js';
import { Take } from './performance-recorder.js';
import { replayActions } from './replay-clock.js';
import {
  registerMidiInstrument,
  unregisterMidiInstrument,
  notifyMidiFocus,
  wireMidiInstrument,
} from './midi-bind.js';

// ── Module-level registry ─────────────────────────────────────────────────────

const _pianos = [];

/** Clear all user-registered hooks on all live piano instances (called on reset). */
export function cleanupPianos() {
  for (const p of _pianos) p._clearHooks();
}

// ── Note utilities ────────────────────────────────────────────────────────────

const WHITE_NAMES = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

// Maps white-key index within octave → the sharp/black note name that follows it.
// white index: 0=C, 1=D, 2=E, 3=F, 4=G, 5=A, 6=B
const BLACK_AFTER = { 0: 'C#', 1: 'D#', 3: 'F#', 4: 'G#', 5: 'A#' };

const _CHROMA = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function noteToMidi(note) {
  const m = String(note).match(/^([A-G]#?)(-?\d+)$/);
  if (!m) return 60;
  const ci = _CHROMA.indexOf(m[1]);
  if (ci < 0) return 60;
  return (parseInt(m[2]) + 1) * 12 + ci;
}

// Inverse of noteToMidi: MIDI note number → note string (60 → 'C4').
function midiToNote(num) {
  const ci = ((num % 12) + 12) % 12;
  const oct = Math.floor(num / 12) - 1;
  return _CHROMA[ci] + oct;
}

// ── Built-in presets ──────────────────────────────────────────────────────────

const BUILTIN_PRESETS = {
  electric: {
    synth: {
      type: 'FM',
      opts: {
        harmonicity: 3,
        modulationIndex: 10,
        oscillator: { type: 'sine' },
        envelope: { attack: 0.01, decay: 0.2, sustain: 0.5, release: 0.8 },
      },
    },
    effects: [{ type: 'reverb', decay: 1.2, wet: 0.3 }],
  },
  grand: {
    synth: {
      type: 'FM',
      opts: {
        harmonicity: 4,
        modulationIndex: 8,
        oscillator: { type: 'sine' },
        envelope: { attack: 0.005, decay: 0.3, sustain: 0.4, release: 1.5 },
      },
    },
    effects: [
      { type: 'reverb', decay: 3, wet: 0.45 },
      { type: 'chorus', frequency: 1.5, wet: 0.2 },
    ],
  },
  organ: {
    synth: {
      type: 'AM',
      opts: {
        harmonicity: 2,
        oscillator: { type: 'sine' },
        envelope: { attack: 0.01, decay: 0.01, sustain: 1, release: 0.1 },
      },
    },
    effects: [{ type: 'chorus', frequency: 3, delayTime: 3.5, depth: 0.7, wet: 0.6 }],
  },
  pluck: {
    synth: {
      type: 'basic',
      opts: {
        oscillator: { type: 'triangle' },
        envelope: { attack: 0.001, decay: 0.4, sustain: 0, release: 0.2 },
      },
    },
    effects: [{ type: 'delay', delayTime: '8n', feedback: 0.3, wet: 0.3 }],
  },
  pad: {
    synth: {
      type: 'basic',
      opts: {
        oscillator: { type: 'sawtooth' },
        envelope: { attack: 0.8, decay: 0.2, sustain: 0.9, release: 2 },
      },
    },
    effects: [
      { type: 'reverb', decay: 5, wet: 0.7 },
      { type: 'chorus', frequency: 1, wet: 0.4 },
    ],
  },
  bass: {
    synth: {
      type: 'FM',
      opts: {
        harmonicity: 1,
        modulationIndex: 2,
        oscillator: { type: 'sine' },
        envelope: { attack: 0.01, decay: 0.1, sustain: 0.8, release: 0.3 },
      },
    },
    effects: [{ type: 'compressor', threshold: -24, ratio: 4 }],
  },
};

// ── Effect + synth builders ───────────────────────────────────────────────────

function _buildEffect(cfg) {
  switch (cfg.type) {
    case 'reverb':
      return new Tone.Reverb({ decay: cfg.decay ?? 1.5, wet: cfg.wet ?? 0.3 });
    case 'chorus': {
      const fx = new Tone.Chorus({
        frequency: cfg.frequency ?? 1.5,
        delayTime: cfg.delayTime ?? 3.5,
        depth: cfg.depth ?? 0.7,
        wet: cfg.wet ?? 0.5,
      });
      fx.start(); // Chorus LFO must be started explicitly
      return fx;
    }
    case 'delay':
      return new Tone.FeedbackDelay({
        delayTime: cfg.delayTime ?? '8n',
        feedback: cfg.feedback ?? 0.3,
        wet: cfg.wet ?? 0.3,
      });
    case 'distortion':
      return new Tone.Distortion({ distortion: cfg.distortion ?? 0.4, wet: cfg.wet ?? 0.5 });
    case 'compressor':
      return new Tone.Compressor({ threshold: cfg.threshold ?? -24, ratio: cfg.ratio ?? 4 });
    default:
      return null;
  }
}

function _buildSynth(desc) {
  const { synth: sc = {}, effects: ec = [] } = desc;
  let inner;
  switch (sc.type ?? 'FM') {
    case 'FM':
      inner = new Tone.PolySynth(Tone.FMSynth, sc.opts ?? {});
      break;
    case 'AM':
      inner = new Tone.PolySynth(Tone.AMSynth, sc.opts ?? {});
      break;
    case 'basic':
      inner = new Tone.PolySynth(Tone.Synth, sc.opts ?? {});
      break;
    default:
      inner = new Tone.PolySynth(Tone.FMSynth, sc.opts ?? {});
      break;
  }
  const effects = ec.map(_buildEffect).filter(Boolean);
  if (effects.length) inner.chain(...effects, Tone.getDestination());
  else inner.connect(Tone.getDestination());
  return { inner, effects };
}

// ── Duration labels ───────────────────────────────────────────────────────────

const DURATION_VALS = ['1n', '2n', '4n', '8n', '16n', '32n'];
const DURATION_NAMES = ['1/1', '1/2', '1/4', '1/8', '1/16', '1/32'];

// ── Piano class ───────────────────────────────────────────────────────────────

export class Piano {
  static _presets = { ...BUILTIN_PRESETS };

  static define(name, desc) {
    Piano._presets[name] = desc;
  }

  constructor({
    title = 'Piano',
    x,
    y,
    w = 560,
    h = 420,
    preset: initPreset = 'electric',
    bpm: initBpm = 120,
    duration: initDuration = '8n',
    baseOctave = 4,
    octaves = 2,
    steps: initSteps,
    _desktopIconId: existingIconId,
  } = {}) {
    this._title = title;
    this._bpm = initBpm;
    this._duration = initDuration;
    this._baseOctave = baseOctave;
    this._octaves = octaves;
    this._kbdOctave = baseOctave;
    this._kbdMap = this._buildKbdMap();
    this._presetName = initPreset;
    this._heldNotes = new Set();
    this._take = new Take(this); // Performance capture (ADR 031)
    this._recNotes = new Map(); // note → { rec, start } for dur back-fill
    this._steps = Array.from({ length: 16 }, () => new Set());
    this._selectedStep = null;
    this._seqStep = 0;
    this._playing = false;
    this._paused = false;
    this._sequence = null;
    this._winId = null;
    this._onKey = null;
    this._keyEls = {}; // note → { el, isBlack, origBg }
    this._stepBtns = [];
    this._notesLbl = null;
    this._fxPanel = null;
    this._fxVisible = false;
    this._activeEffects = []; // [{ node, cfg }]
    this._playBtnEl = null;
    this._octLbl = null;
    this._presetSel = null;
    this._desktopIconId = existingIconId ?? null;
    this._autoSave = () => {};
    this._history = null;

    // Build synth from initial preset
    const presetDesc = Piano._presets[initPreset] ?? Piano._presets.electric;
    const { inner, effects } = _buildSynth(presetDesc);
    this._synth = inner;
    this._activeEffects = effects.map((node, i) => ({
      node,
      cfg: (presetDesc.effects ?? [])[i] ?? {},
    }));

    this._events = new WidgetEvents();
    _pianos.push(this);

    this._init(title, x, y, w, h);

    // MIDI binding (ADR 033): register, then claim focus (the window just spawned
    // frontmost). Permission is checked silently — no prompt unless already granted.
    if (this._winId) {
      registerMidiInstrument(this);
      notifyMidiFocus(this);
    }

    if (initSteps) {
      initSteps.forEach((notes, si) => {
        if (!notes || si >= 16) return;
        notes.forEach((note) => this.note(si, note, true));
      });
    }
    if (!existingIconId) this._autoSave();
  }

  // ── Keyboard note map from current kbd octave ─────────────────────────────────

  _buildKbdMap() {
    const oct = this._kbdOctave;
    return {
      a: `C${oct}`,
      w: `C#${oct}`,
      s: `D${oct}`,
      e: `D#${oct}`,
      d: `E${oct}`,
      f: `F${oct}`,
      t: `F#${oct}`,
      g: `G${oct}`,
      y: `G#${oct}`,
      h: `A${oct}`,
      u: `A#${oct}`,
      j: `B${oct}`,
      k: `C${oct + 1}`,
    };
  }

  // ── Build the window ──────────────────────────────────────────────────────────

  _init(title, x, y, w, h) {
    if (!window.wm) return;

    const shell = mountWidgetShell({
      title,
      x,
      y,
      w,
      h,
      widgetType: 'piano',
      bg: '#0d0d1a',
      rows: [],
      getState: () => ({
        title: this._title,
        bpm: this._bpm,
        duration: this._duration,
        baseOctave: this._baseOctave,
        octaves: this._octaves,
        preset: this._presetName,
        steps: this._steps.map((s) => [...s]),
        _desktopIconId: this._desktopIconId,
      }),
      save: {
        name: (this._title || 'Piano') + '.piano',
        type: 'piano',
        getIconId: () => this._desktopIconId,
        setIconId: (id) => {
          this._desktopIconId = id;
        },
      },
      history: {
        capture: () => ({
          bpm: this._bpm,
          steps: this._steps.map((s) => [...s]),
        }),
        restore: (snap) => {
          this._bpm = snap.bpm;
          try {
            Tone.getTransport().bpm.value = snap.bpm;
          } catch (_) {}
          snap.steps.forEach((notes, si) => {
            this._steps[si] = new Set(notes);
          });
          this._updateStepButtons();
          this._updateKeyboardHighlights();
        },
      },
      onDestroy: () => this._destroy(),
    });
    if (!shell) return;

    this._winId = shell.winId;
    this._autoSave = shell.save;
    this._history = shell.history;
    const body = shell.body;

    // ── Piano keyboard ─────────────────────────────────────────────────────────
    body.appendChild(this._buildKeyboard());

    // ── Step sequencer ─────────────────────────────────────────────────────────
    body.appendChild(this._buildSequencer());

    // ── Transport bar ──────────────────────────────────────────────────────────
    body.appendChild(this._buildTransport());

    // ── Fx panel (collapsible, hidden by default) ──────────────────────────────
    body.appendChild(this._buildFxPanel());

    // ── Computer keyboard listener ─────────────────────────────────────────────
    this._onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;

      if (e.type === 'keydown') {
        if (e.repeat) return;
        if (e.key === 'z') {
          this._shiftKbdOctave(-1);
          return;
        }
        if (e.key === 'x') {
          this._shiftKbdOctave(1);
          return;
        }
        const note = this._kbdMap[e.key];
        if (note) this._triggerAttack(note, 'kbd');
      } else {
        const note = this._kbdMap[e.key];
        if (note) this._triggerRelease(note);
      }
    };
    document.addEventListener('keydown', this._onKey);
    document.addEventListener('keyup', this._onKey);
  }

  // ── Keyboard DOM ──────────────────────────────────────────────────────────────

  _buildKeyboard() {
    const wrap = document.createElement('div');
    wrap.style.cssText =
      'position:relative;padding:8px 10px 6px;height:120px;flex-shrink:0;box-sizing:border-box;';

    const inner = document.createElement('div');
    inner.style.cssText = 'position:relative;width:100%;height:100%;';

    const totalWhites = this._octaves * 7;
    const ww = 100 / totalWhites; // white key width in %
    const bw = ww * 0.55; // black key width in %

    // White keys (z-index 1)
    for (let oct = 0; oct < this._octaves; oct++) {
      const octave = this._baseOctave + oct;
      WHITE_NAMES.forEach((name, wi) => {
        const note = `${name}${octave}`;
        const globalWi = oct * 7 + wi;
        const el = document.createElement('div');
        el.dataset.note = note;
        el.style.cssText = [
          `position:absolute;top:0;left:${globalWi * ww}%;`,
          `width:calc(${ww}% - 1px);height:100%;`,
          'background:#e8e8e8;border:1px solid #555;border-top:none;',
          'border-radius:0 0 5px 5px;cursor:pointer;box-sizing:border-box;',
          'z-index:1;transition:background 0.05s;',
        ].join('');
        el.addEventListener('pointerdown', (ev) => {
          ev.preventDefault();
          if (this._selectedStep !== null) {
            this._toggleNoteInStep(note, this._selectedStep);
          } else {
            this._triggerAttack(note, 'mouse');
          }
        });
        el.addEventListener('pointerup', () => {
          if (this._selectedStep === null) this._triggerRelease(note);
        });
        el.addEventListener('pointerleave', () => {
          if (this._selectedStep === null) this._triggerRelease(note);
        });
        this._keyEls[note] = { el, isBlack: false, origBg: '#e8e8e8' };
        inner.appendChild(el);
      });
    }

    // Black keys (z-index 3, overlapping white keys)
    for (let oct = 0; oct < this._octaves; oct++) {
      const octave = this._baseOctave + oct;
      for (const [wiStr, name] of Object.entries(BLACK_AFTER)) {
        const wi = parseInt(wiStr);
        const note = `${name}${octave}`;
        const globalWi = oct * 7 + wi;
        // Center black key at the boundary between white key globalWi and globalWi+1
        const leftPct = (globalWi + 1) * ww - bw / 2;
        const el = document.createElement('div');
        el.dataset.note = note;
        el.style.cssText = [
          `position:absolute;top:0;left:${leftPct}%;`,
          `width:${bw}%;height:62%;`,
          'background:#222;border:1px solid #000;border-top:none;',
          'border-radius:0 0 3px 3px;cursor:pointer;',
          'z-index:3;box-sizing:border-box;transition:background 0.05s;',
        ].join('');
        el.addEventListener('pointerdown', (ev) => {
          ev.preventDefault();
          if (this._selectedStep !== null) {
            this._toggleNoteInStep(note, this._selectedStep);
          } else {
            this._triggerAttack(note, 'mouse');
          }
        });
        el.addEventListener('pointerup', () => {
          if (this._selectedStep === null) this._triggerRelease(note);
        });
        el.addEventListener('pointerleave', () => {
          if (this._selectedStep === null) this._triggerRelease(note);
        });
        this._keyEls[note] = { el, isBlack: true, origBg: '#222' };
        inner.appendChild(el);
      }
    }

    wrap.appendChild(inner);
    return wrap;
  }

  // ── Sequencer DOM ─────────────────────────────────────────────────────────────

  _buildSequencer() {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'padding:4px 10px 6px;flex-shrink:0;';

    const notesLbl = document.createElement('div');
    notesLbl.style.cssText =
      'font-size:9px;color:#6c7086;font-family:monospace;min-height:14px;padding-bottom:3px;';
    this._notesLbl = notesLbl;
    wrap.appendChild(notesLbl);

    const stepRow = document.createElement('div');
    stepRow.style.cssText = 'display:grid;grid-template-columns:repeat(16,1fr);gap:3px;';

    this._stepBtns = [];
    for (let s = 0; s < 16; s++) {
      const btn = document.createElement('button');
      const groupMl = s % 4 === 0 && s > 0 ? 'margin-left:2px;' : '';
      btn.style.cssText = `height:22px;border-radius:3px;cursor:pointer;padding:0;border:2px solid #313244;background:#1a1a2e;${groupMl}`;
      btn.title = `Step ${s + 1}`;
      btn.addEventListener('click', () => {
        this._selectedStep = this._selectedStep === s ? null : s;
        this._updateStepButtons();
        this._updateKeyboardHighlights();
      });
      this._stepBtns.push(btn);
      stepRow.appendChild(btn);
    }
    wrap.appendChild(stepRow);
    return wrap;
  }

  // ── Transport DOM ─────────────────────────────────────────────────────────────

  _buildTransport() {
    const ctrl = document.createElement('div');
    ctrl.style.cssText =
      'display:flex;align-items:center;gap:5px;padding:5px 10px;background:#13131f;border-top:1px solid #2a2a3e;flex-shrink:0;flex-wrap:wrap;';

    const _mkBtn = (label, color) => {
      const b = document.createElement('button');
      b.style.cssText = `background:#1e1e2e;color:${color};border:1px solid #313244;border-radius:4px;padding:3px 8px;font-size:11px;cursor:pointer;font-family:monospace;transition:background 0.1s;`;
      b.textContent = label;
      b.addEventListener('mouseenter', () => {
        b.style.background = '#313244';
      });
      b.addEventListener('mouseleave', () => {
        b.style.background = b._active ? '#1a3d1a' : '#1e1e2e';
      });
      return b;
    };

    // Play / Stop
    const playBtn = _mkBtn('▶ Play', '#a6e3a1');
    const stopBtn = _mkBtn('■ Stop', '#f38ba8');
    this._playBtnEl = playBtn;

    playBtn.addEventListener('click', () => {
      if (!this._playing) {
        // Start fresh
        this._playing = true;
        this._paused = false;
        this._seqStep = 0;
        Tone.getTransport().bpm.value = this._bpm;
        this._sequence = new Tone.Sequence(
          (time) => {
            const s = this._seqStep;
            const notes = [...this._steps[s]];
            requestAnimationFrame(() => {
              this._stepBtns.forEach((b, i) => {
                b.style.boxShadow = i === s ? '0 0 0 2px #cba6f7' : '';
              });
              notes.forEach((note) => this._flashKeyBrief(note));
            });
            if (notes.length) {
              try {
                this._synth.triggerAttackRelease(notes, this._duration, time);
              } catch (_) {}
              notes.forEach((note) => this._fireNote(note, 'seq', s));
            }
            this._events.emit('step', { step: s, notes });
            this._seqStep = (this._seqStep + 1) % 16;
          },
          [...Array(16).keys()],
          '16n',
        );
        this._sequence.start(0);
        Tone.getTransport().start();
        playBtn.textContent = '⏸ Pause';
        playBtn._active = true;
        playBtn.style.background = '#1a3d1a';
      } else if (!this._paused) {
        // Pause
        this._paused = true;
        Tone.getTransport().pause();
        playBtn.textContent = '▶ Play';
        playBtn._active = false;
        playBtn.style.background = '#1e1e2e';
      } else {
        // Resume
        this._paused = false;
        Tone.getTransport().start();
        playBtn.textContent = '⏸ Pause';
        playBtn._active = true;
        playBtn.style.background = '#1a3d1a';
      }
    });

    stopBtn.addEventListener('click', () => this._stop());

    // BPM
    const bpmLbl = document.createElement('span');
    bpmLbl.style.cssText = 'color:#6c7086;font-size:10px;font-family:monospace;';
    bpmLbl.textContent = 'BPM:';

    const bpmIn = document.createElement('input');
    bpmIn.type = 'number';
    bpmIn.min = '40';
    bpmIn.max = '300';
    bpmIn.value = String(this._bpm);
    bpmIn.style.cssText =
      'width:50px;background:#1e1e2e;color:#cdd6f4;border:1px solid #313244;border-radius:3px;padding:2px 4px;font-size:11px;font-family:monospace;text-align:center;';
    bpmIn.addEventListener('change', () => {
      this._bpm = parseInt(bpmIn.value) || 120;
      if (this._playing) Tone.getTransport().bpm.value = this._bpm;
      this._history?.commit();
      this._autoSave();
    });

    // Duration
    const durLbl = document.createElement('span');
    durLbl.style.cssText = 'color:#6c7086;font-size:10px;font-family:monospace;';
    durLbl.textContent = 'Dur:';

    const durSel = document.createElement('select');
    durSel.style.cssText =
      'background:#1e1e2e;color:#cdd6f4;border:1px solid #313244;border-radius:3px;font-size:10px;font-family:monospace;padding:2px 3px;cursor:pointer;';
    DURATION_VALS.forEach((val, i) => {
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = DURATION_NAMES[i];
      if (val === this._duration) opt.selected = true;
      durSel.appendChild(opt);
    });
    durSel.addEventListener('change', () => {
      this._duration = durSel.value;
      this._autoSave();
    });

    // Oct shift (for computer keyboard mapping)
    const octDn = _mkBtn('<', '#89b4fa');
    octDn.title = 'Keyboard octave down (Z)';
    octDn.style.padding = '2px 6px';
    octDn.addEventListener('click', () => this._shiftKbdOctave(-1));

    const octLbl = document.createElement('span');
    octLbl.style.cssText =
      'color:#89b4fa;font-size:10px;font-family:monospace;min-width:44px;text-align:center;';
    octLbl.textContent = `Oct:${this._kbdOctave}`;
    this._octLbl = octLbl;

    const octUp = _mkBtn('>', '#89b4fa');
    octUp.title = 'Keyboard octave up (X)';
    octUp.style.padding = '2px 6px';
    octUp.addEventListener('click', () => this._shiftKbdOctave(1));

    // Preset dropdown
    const presetSel = document.createElement('select');
    presetSel.style.cssText =
      'background:#1e1e2e;color:#cdd6f4;border:1px solid #313244;border-radius:3px;font-size:10px;font-family:monospace;padding:2px 3px;cursor:pointer;';
    this._presetSel = presetSel;
    this._refreshPresetOptions();
    presetSel.addEventListener('change', () => this.preset(presetSel.value));

    // Fx toggle
    const fxBtn = _mkBtn('Fx', '#cba6f7');
    fxBtn.style.padding = '3px 7px';
    fxBtn.addEventListener('click', () => {
      this._fxVisible = !this._fxVisible;
      if (this._fxPanel) this._fxPanel.style.display = this._fxVisible ? 'block' : 'none';
      fxBtn.style.borderColor = this._fxVisible ? '#cba6f7' : '#313244';
    });

    // Volume
    const volLbl = document.createElement('span');
    volLbl.style.cssText = 'color:#6c7086;font-size:10px;font-family:monospace;';
    volLbl.textContent = 'Vol:';

    const volSlider = document.createElement('input');
    volSlider.type = 'range';
    volSlider.min = '-40';
    volSlider.max = '0';
    volSlider.step = '1';
    volSlider.value = String(Math.round(this._synth.volume.value));
    volSlider.title = 'Master volume (dB)';
    volSlider.style.cssText = 'width:52px;accent-color:#cba6f7;flex-shrink:0;';
    volSlider.addEventListener('input', () => {
      this._synth.volume.value = parseInt(volSlider.value, 10);
    });

    // Code button
    const codeBtn = _mkBtn('</>', '#cba6f7');
    codeBtn.title = 'Insert code snippet';
    codeBtn.style.padding = '3px 7px';
    codeBtn.addEventListener('click', () => {
      const lines = [
        `const p = new Piano({ title: '${this._title}', bpm: ${this._bpm}, preset: '${this._presetName}', duration: '${this._duration}' });`,
      ];
      this._steps.forEach((notes, si) => {
        if (notes.size > 0) {
          [...notes].forEach((note) => lines.push(`p.note(${si}, '${note}', true);`));
        }
      });
      insertSnippet(lines.join('\n'));
    });

    ctrl.appendChild(playBtn);
    ctrl.appendChild(stopBtn);
    ctrl.appendChild(bpmLbl);
    ctrl.appendChild(bpmIn);
    ctrl.appendChild(durLbl);
    ctrl.appendChild(durSel);
    ctrl.appendChild(octDn);
    ctrl.appendChild(octLbl);
    ctrl.appendChild(octUp);
    ctrl.appendChild(presetSel);
    ctrl.appendChild(fxBtn);
    ctrl.appendChild(volLbl);
    ctrl.appendChild(volSlider);
    ctrl.appendChild(codeBtn);

    // ── Capture ● (Performance recording → replay code) ───────────────────────
    const capBtn = _mkBtn('● Rec', '#f38ba8');
    capBtn.style.padding = '3px 7px';
    wireCaptureButton(capBtn, { take: this._take, widget: this });
    ctrl.appendChild(capBtn);

    // ── MIDI chip (ADR 033) — opt-in / target indicator ─────────────────────────
    const midiChip = _mkBtn('🎹', '#45475a');
    midiChip.style.padding = '3px 7px';
    wireMidiInstrument(this, {
      chip: midiChip,
      tooltips: {
        target: 'MIDI input → this Piano',
        idle: 'MIDI on — focus this Piano to play it',
        dormant: 'Enable MIDI input',
      },
    });
    ctrl.appendChild(midiChip);
    return ctrl;
  }

  // ── Fx panel DOM ─────────────────────────────────────────────────────────────

  _buildFxPanel() {
    const panel = document.createElement('div');
    panel.style.cssText =
      'padding:6px 10px;background:#0d0d1a;border-top:1px solid #2a2a3e;flex-shrink:0;display:none;';
    this._fxPanel = panel;
    this._updateFxPanel();
    return panel;
  }

  _updateFxPanel() {
    if (!this._fxPanel) return;
    this._fxPanel.innerHTML = '';

    if (!this._activeEffects.length) {
      const empty = document.createElement('span');
      empty.style.cssText = 'color:#45475a;font-size:10px;font-family:monospace;';
      empty.textContent = 'No effects in this preset.';
      this._fxPanel.appendChild(empty);
      return;
    }

    this._activeEffects.forEach(({ node, cfg }) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:3px 0;';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = true;
      cb.style.cssText = 'cursor:pointer;accent-color:#cba6f7;flex-shrink:0;';

      const nameLbl = document.createElement('span');
      nameLbl.style.cssText =
        'color:#cdd6f4;font-size:10px;font-family:monospace;min-width:78px;text-transform:capitalize;';
      nameLbl.textContent = cfg.type ?? 'effect';

      row.appendChild(cb);
      row.appendChild(nameLbl);

      if (cfg.type === 'compressor') {
        // Compressor has no wet signal; checkbox bypasses by setting ratio to 1
        const origRatio = cfg.ratio ?? 4;
        cb.addEventListener('change', () => {
          try {
            node.ratio.value = cb.checked ? origRatio : 1;
          } catch (_) {}
        });
      } else {
        const origWet = cfg.wet ?? 0.5;
        const wetRange = document.createElement('input');
        wetRange.type = 'range';
        wetRange.min = '0';
        wetRange.max = '100';
        wetRange.value = String(Math.round(origWet * 100));
        wetRange.style.cssText = 'flex:1;cursor:pointer;accent-color:#cba6f7;';

        wetRange.addEventListener('input', () => {
          if (cb.checked) {
            try {
              node.wet.value = wetRange.valueAsNumber / 100;
            } catch (_) {}
          }
        });
        cb.addEventListener('change', () => {
          try {
            node.wet.value = cb.checked ? wetRange.valueAsNumber / 100 : 0;
          } catch (_) {}
        });
        row.appendChild(wetRange);
      }

      this._fxPanel.appendChild(row);
    });
  }

  // ── Internal helpers ──────────────────────────────────────────────────────────

  _refreshPresetOptions() {
    if (!this._presetSel) return;
    this._presetSel.innerHTML = '';
    for (const name of Object.keys(Piano._presets)) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      if (name === this._presetName) opt.selected = true;
      this._presetSel.appendChild(opt);
    }
  }

  _shiftKbdOctave(dir) {
    this._kbdOctave = Math.max(0, Math.min(8, this._kbdOctave + dir));
    this._kbdMap = this._buildKbdMap();
    if (this._octLbl) this._octLbl.textContent = `Oct:${this._kbdOctave}`;
  }

  /** pointerdown / keydown / MIDI → start holding note. vel 0-1 (default 1). */
  _triggerAttack(note, source, vel = 1) {
    if (this._heldNotes.has(note)) return;
    this._heldNotes.add(note);
    try {
      this._synth.triggerAttack(note, Tone.now(), vel);
    } catch (_) {}
    this._setKeyActive(note, true);
    this._fireNote(note, source, null, vel);
    // Performance capture: record live attacks; dur is back-filled on release.
    // Replay-driven attacks (source 'replay') are excluded so replay never
    // re-records.
    if (source !== 'replay') {
      const rec = this._take.push({ note, dur: 0, vel });
      if (rec) this._recNotes.set(note, { rec, start: performance.now() });
    }
  }

  /** pointerup / pointerleave / keyup → release note */
  _triggerRelease(note) {
    if (!this._heldNotes.has(note)) return;
    this._heldNotes.delete(note);
    try {
      this._synth.triggerRelease(note, Tone.now());
    } catch (_) {}
    this._setKeyActive(note, false);
    this._events.emit('note:off', { note, midi: noteToMidi(note) });
    const e = this._recNotes.get(note);
    if (e) {
      e.rec.dur = Math.max(1, Math.round(performance.now() - e.start));
      this._recNotes.delete(note);
    }
  }

  _fireNote(note, source, step, vel = 1) {
    const midi = noteToMidi(note);
    const ev = { note, midi, velocity: vel, source, step };
    this._events.emit('note', ev);
    this._events.emit(`note:${note}`, ev);
  }

  // ── MIDI input (ADR 033) — driven by the focus-routed coordinator ────────────
  // note-on/off give true sustain; with a step selected, note-on programs that
  // step (mirroring mouse). source 'midi' so live MIDI is captured into the Take.
  _midiNoteOn(num, vel = 1) {
    const note = midiToNote(num);
    if (this._selectedStep !== null) this._toggleNoteInStep(note, this._selectedStep);
    else this._triggerAttack(note, 'midi', vel);
  }

  _midiNoteOff(num) {
    if (this._selectedStep !== null) return;
    this._triggerRelease(midiToNote(num));
  }

  // _setMidiChip is installed by wireMidiInstrument() — see midi-bind.js.

  // ── Performance capture / replay (ADR 031) ──────────────────────────────────
  // Public timed-note verb: attack now, release after `dur` ms (patched
  // setTimeout → run-scoped, pauses/cleans with the harness).
  strike(note, dur = 200, vel = 1) {
    this._triggerAttack(note, 'replay', vel);
    const ms = typeof dur === 'number' && dur > 0 ? dur : 200;
    window.setTimeout(() => this._triggerRelease(note), ms);
    return this;
  }

  _applyAction(a) {
    if (a && a.note) this.strike(a.note, a.dur, a.vel ?? 1);
  }

  replay(actions, opts) {
    return replayActions((act) => this._applyAction(act), actions, opts);
  }

  _perfCtor() {
    return {
      varName: 'p',
      code: `const p = new Piano({ title: '${String(this._title).replace(/'/g, "\\'")}', bpm: ${this._bpm}, preset: '${this._presetName}', duration: '${this._duration}' });`,
    };
  }

  _toggleNoteInStep(note, stepIdx) {
    const s = this._steps[stepIdx];
    if (s.has(note)) s.delete(note);
    else s.add(note);
    this._updateStepButtons();
    this._updateKeyboardHighlights();
    this._history?.commit();
    this._autoSave();
  }

  /** Set a key to "active" (held or seq-playing) or restore to rest state. */
  _setKeyActive(note, active) {
    const k = this._keyEls[note];
    if (!k) return;
    if (active) {
      k.el.style.background = '#cba6f7';
    } else {
      const inSelStep = this._selectedStep !== null && this._steps[this._selectedStep].has(note);
      k.el.style.background = inSelStep ? '#cba6f7' : k.origBg;
    }
  }

  /** Flash a key briefly during sequencer playback, then restore. */
  _flashKeyBrief(note) {
    const k = this._keyEls[note];
    if (!k) return;
    k.el.style.background = '#cba6f7';
    setTimeout(() => {
      if (!this._heldNotes.has(note)) this._setKeyActive(note, false);
    }, 150);
  }

  _updateStepButtons() {
    this._stepBtns.forEach((btn, s) => {
      btn.style.background = this._steps[s].size > 0 ? '#2a2a4e' : '#1a1a2e';
      btn.style.borderColor = this._selectedStep === s ? '#cba6f7' : '#313244';
    });
  }

  _updateKeyboardHighlights() {
    for (const [note, k] of Object.entries(this._keyEls)) {
      const inSelStep = this._selectedStep !== null && this._steps[this._selectedStep].has(note);
      k.el.style.background = inSelStep || this._heldNotes.has(note) ? '#cba6f7' : k.origBg;
    }
    if (this._notesLbl) {
      if (this._selectedStep !== null) {
        const notes = [...this._steps[this._selectedStep]];
        this._notesLbl.textContent = notes.length
          ? `Step ${this._selectedStep + 1}: ${notes.join(', ')}`
          : `Step ${this._selectedStep + 1}: (empty — click keys to add notes)`;
      } else {
        this._notesLbl.textContent = '';
      }
    }
  }

  // ── Public methods ────────────────────────────────────────────────────────────

  /** Set transport BPM. */
  bpm(v) {
    this._bpm = v;
    if (this._playing) Tone.getTransport().bpm.value = v;
    this._history?.commit();
    this._autoSave();
    return this;
  }

  /** Apply a named preset (disposes current synth + effects, builds new ones). */
  preset(name) {
    const desc = Piano._presets[name];
    if (!desc) {
      console.warn(`[Piano] preset '${name}' not found`);
      return this;
    }
    try {
      this._synth?.dispose();
    } catch (_) {}
    for (const { node } of this._activeEffects) {
      try {
        node?.dispose();
      } catch (_) {}
    }
    const { inner, effects } = _buildSynth(desc);
    this._synth = inner;
    this._presetName = name;
    this._activeEffects = effects.map((node, i) => ({ node, cfg: (desc.effects ?? [])[i] ?? {} }));
    this._updateFxPanel();
    if (this._presetSel) this._presetSel.value = name;
    return this;
  }

  /** Toggle a note in a sequencer step. step 0-15, noteName e.g. 'C4', on bool. */
  note(step, noteName, on = true) {
    if (step < 0 || step >= 16) return this;
    const s = this._steps[step];
    if (on) s.add(noteName);
    else s.delete(noteName);
    this._updateStepButtons();
    this._updateKeyboardHighlights();
    this._history?.commit();
    this._autoSave();
    return this;
  }

  /** Fire fn({note, midi, velocity, source, step}) on any note played. */
  onNote(fn) {
    this._events.on('note', fn);
    return this;
  }

  /** Fire fn({note, midi, velocity, source, step}) only when a specific note fires. */
  onKey(noteName, fn) {
    this._events.on(`note:${noteName}`, fn);
    return this;
  }

  /** Fire fn({step, notes}) once per sequencer step (only while playing). */
  onStep(fn) {
    this._events.on('step', fn);
    return this;
  }

  /**
   * Return a decaying-pulse signal 0-1 driven by note events.
   * @param {string|null} [note]    — note string like 'C4', or null for any note.
   * @param {{ decay?: number }} [opts]
   */
  signal(note = null, { decay = 250 } = {}) {
    return this._events.signal(note ? `note:${note}` : 'note', { decay });
  }

  // ── Internal lifecycle ────────────────────────────────────────────────────────

  /** Clear user hooks and release held notes (called on reset; window survives). */
  _clearHooks() {
    for (const note of [...this._heldNotes]) {
      try {
        this._synth?.triggerRelease(note, Tone.now());
      } catch (_) {}
      this._setKeyActive(note, false);
    }
    this._heldNotes.clear();
    this._events.clear();
  }

  _stop() {
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
    this._seqStep = 0;
    this._stepBtns.forEach((b) => {
      b.style.boxShadow = '';
    });
    if (this._playBtnEl) {
      this._playBtnEl.textContent = '▶ Play';
      this._playBtnEl._active = false;
      this._playBtnEl.style.background = '#1e1e2e';
    }
  }

  _destroy() {
    this._stop();
    this._clearHooks();
    unregisterMidiInstrument(this);
    const idx = _pianos.indexOf(this);
    if (idx >= 0) _pianos.splice(idx, 1);
    if (this._onKey) {
      document.removeEventListener('keydown', this._onKey);
      document.removeEventListener('keyup', this._onKey);
      this._onKey = null;
    }
    try {
      this._synth?.dispose();
    } catch (_) {}
    for (const { node } of this._activeEffects) {
      try {
        node?.dispose();
      } catch (_) {}
    }
  }
}

// Register teardown with the reset registry (ADR 008).
onReset(cleanupPianos);
