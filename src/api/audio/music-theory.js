// music-theory.js — the single note-name ↔ MIDI converter (deepening pass #7).
//
// Wraps Tone.Frequency (which already parses sharps, flats, and either case) so every
// caller shares one semantics. Before this leaf, five hand-rolled copies disagreed:
// piano.js's `/^([A-G]#?)…/` regex rejected flats and silently returned 60, so
// `noteToMidi('Db4')` was 60 in piano but 61 in viz — same app, same input, two answers.
// faust.js and launchpad.js already routed through Tone.Frequency; this makes it the rule.
//
// Both fns guard against headless/test Tone mocks (which may omit toMidi/toNote) by
// falling back to the historical defaults (60 / 'C4') — matching what faust/launchpad did.

import * as Tone from 'tone';

// note name or midi number → midi number. Unparseable → `fallback` (default 60 = C4).
export function noteToMidi(note, fallback = 60) {
  if (typeof note === 'number') return Math.round(note);
  try {
    const m = Tone.Frequency(note).toMidi();
    return Number.isFinite(m) ? m : fallback;
  } catch (_) {
    return fallback;
  }
}

// midi number → note name (60 → 'C4'). Unresolvable → `fallback` (default 'C4').
export function midiToNote(midi, fallback = 'C4') {
  if (typeof midi === 'string') return midi;
  try {
    return Tone.Frequency(midi, 'midi').toNote() ?? fallback;
  } catch (_) {
    return fallback;
  }
}
