// audio-unlock.js — lazy, gesture-driven AudioContext unlock (ADR 058).
//
// Browser autoplay policy: an AudioContext only resumes from a user gesture.
// Rather than *predict* audio from a code scan (which misses APIs and can't unlock
// a non-gesture auto-exec run anyway), we unlock at the point every sound-maker
// passes through: acquireStrip() (mixer.js), the ADR-032 tail. `ensureAudioUnlocked`
// is idempotent and cheap:
//   - if already running, no-op;
//   - resume now (works when called synchronously inside a gesture — e.g. the Run
//     button click → execute() → new Piano() → acquireStrip);
//   - and arm a one-time capture-phase document listener so the *next* real gesture
//     (the piano key itself, under auto-exec) unlocks.
// This makes silence topologically impossible, independent of detection. Detection
// (usesAudio) survives only as a pre-warm/chip UX signal.
//
// Leaf: imports Tone only, so mixer.js (also a leaf) can import it with no cycle.

import * as Tone from 'tone';

const GESTURES = ['pointerdown', 'keydown', 'touchstart'];
let _armed = false;

function _resume() {
  try {
    Tone.start();
  } catch (_) {}
}

export function ensureAudioUnlocked() {
  try {
    if (Tone.getContext().state === 'running') return;
  } catch (_) {
    return; // no real context (headless/tests) — nothing to unlock
  }
  _resume(); // in-gesture path
  if (_armed) return;
  _armed = true;
  const unlock = () => {
    _resume();
    let running = false;
    try {
      running = Tone.getContext().state === 'running';
    } catch (_) {}
    if (running) {
      for (const ev of GESTURES) document.removeEventListener(ev, unlock, true);
      _armed = false;
    }
  };
  for (const ev of GESTURES) document.addEventListener(ev, unlock, true);
}

// Test-only reset of the module-level armed latch.
export function _resetAudioUnlockForTest() {
  _armed = false;
}
