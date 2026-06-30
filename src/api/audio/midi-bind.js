// midi-bind.js — focus-routed, permission-aware MIDI → instrument-widget binding (ADR 033).
//
// A single open Piano or Drumpad — the MIDI Target — receives Web MIDI input with
// no editor code. Routing is sticky: the last-focused instrument stays the target
// even when focus moves to the editor, switching only when another instrument is
// focused. Enabling is permission-aware: navigator.permissions.query is consulted
// silently (never prompts); a user with no controller is never bothered.
//
// The dispatcher is a PERSISTENT bus tap (addBusTap), NOT a run-scoped subscription
// or midi.onNote handler — both are wiped on reset, but the instrument window (and
// thus its binding) survives reset. The tap lives for the page lifetime.
//
// An instrument widget participates by implementing:
//   _winId                       — its WM window id (for focus matching)
//   _midiNoteOn(num, vel)        — MIDI note-on (num 0-127, vel 0-1)
//   _midiNoteOff(num)            — MIDI note-off
//   _setMidiChip(state)          — 'dormant' | 'idle' | 'target' (chip appearance)
// …and calling registerMidiInstrument(this) after its window exists,
//    unregisterMidiInstrument(this) on destroy, and notifyMidiFocus(this) once on spawn.

import { addBusTap } from '../../events/index.js';
import { midi } from './midi.js';

const _instruments = new Set();
let _target = null;

export function registerMidiInstrument(widget) {
  _instruments.add(widget);
}

export function unregisterMidiInstrument(widget) {
  _instruments.delete(widget);
  if (_target === widget) _target = null;
}

export function getMidiTarget() {
  return _target;
}

// ── Chip wiring (shared by every instrument widget) ─────────────────────────────
// The 🎹 chip appearance per target/idle/dormant state was duplicated byte-for-byte
// across piano.js and drumpad.js bar the tooltip strings. One impl now; the widget
// supplies the chip element (its own button factory) and the per-instrument tooltips.

const CHIP_STYLES = {
  target: {
    color: '#a6e3a1',
    borderColor: '#a6e3a1',
    opacity: '1',
    boxShadow: '0 0 6px #a6e3a155',
  },
  idle: { color: '#6c7086', borderColor: '#313244', opacity: '0.7', boxShadow: '' },
  dormant: { color: '#45475a', borderColor: '#313244', opacity: '0.55', boxShadow: '' },
};

/**
 * Install MIDI-chip behaviour on an instrument widget: defines widget._setMidiChip
 * (appearance for 'target' | 'idle' | 'dormant'), paints the initial dormant state,
 * and wires the chip click as the opt-in permission gesture. The widget still builds
 * the chip element and still calls registerMidiInstrument/notifyMidiFocus(this) once
 * its _winId exists and unregisterMidiInstrument(this) on destroy.
 * @param {object} widget
 * @param {{ chip: HTMLElement, tooltips: { target:string, idle:string, dormant:string } }} opts
 */
export function wireMidiInstrument(widget, { chip, tooltips }) {
  widget._midiChip = chip;
  widget._setMidiChip = (state) => {
    const s = CHIP_STYLES[state] || CHIP_STYLES.dormant;
    chip.style.color = s.color;
    chip.style.borderColor = s.borderColor;
    chip.style.opacity = s.opacity;
    chip.style.boxShadow = s.boxShadow;
    chip.title = tooltips[state] || tooltips.dormant;
  };
  widget._setMidiChip('dormant');
  chip.addEventListener('click', () => enableMidiFor(widget));
}

function _midiOpen() {
  return !!midi._access;
}

/** Re-paint every registered instrument's chip from current open/target state. */
function _refreshChips() {
  const open = _midiOpen();
  for (const w of _instruments) {
    try {
      w._setMidiChip?.(open ? (w === _target ? 'target' : 'idle') : 'dormant');
    } catch (_) {}
  }
}

/**
 * An instrument gained focus (or just spawned). Make it the sticky target and,
 * if MIDI permission is already granted, open access silently. Never prompts.
 */
export async function notifyMidiFocus(widget) {
  if (!_instruments.has(widget)) return;
  _target = widget;
  if (_midiOpen()) {
    _refreshChips();
    return;
  }
  // Silent permission check — does NOT prompt.
  let state = 'prompt';
  try {
    const status = await navigator.permissions?.query?.({ name: 'midi' });
    state = status?.state ?? 'prompt';
  } catch (_) {
    state = 'prompt';
  }
  if (state === 'granted') {
    try {
      await midi.open();
    } catch (_) {}
  }
  _refreshChips();
}

/**
 * Explicit opt-in via the dormant chip click (this click is the permission gesture).
 * Opens MIDI (prompts if needed) and targets this widget.
 */
export async function enableMidiFor(widget) {
  if (!_instruments.has(widget)) return;
  _target = widget;
  try {
    await midi.open();
  } catch (_) {}
  _refreshChips();
}

// ── Persistent dispatcher ──────────────────────────────────────────────────────
// Set up once at module load. Routes note events to the current target and tracks
// focus to maintain the sticky target. Survives every reset (not run-scoped).

addBusTap((event, data) => {
  if (event === 'midi:note:on') {
    _target?._midiNoteOn?.(data.note, (data.velocity ?? 0) / 127 || 0);
  } else if (event === 'midi:note:off') {
    _target?._midiNoteOff?.(data.note);
  } else if (event === 'wm:focus') {
    // Sticky: only react when a registered instrument is focused; ignore everything else.
    const w = [..._instruments].find((i) => i._winId === data.id);
    if (w) notifyMidiFocus(w);
  }
});
