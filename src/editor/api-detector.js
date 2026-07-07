// api-detector.js — static analysis of user code for audio-start detection.
//
// Returns whether the snippet references any audio API, so the run sequence
// (src/runtime/run.js) can pre-warm audio (Tone.start) + show the taskbar audio
// chip. It does NOT gate user code on audio-ready — awaiting that would deadlock
// a gesture-less auto-exec; audio unlocks lazily at acquireStrip (ADR 058).
//
// History: pre-ADR-040 this also detected visual APIs (draw/pixi/shader/three/…)
// to decide whether to auto-open an output window, and did an esprima AST walk to
// tell a Shader that was `.start()`-ed from one merely constructed. ADR 040 made
// every visual API self-spawning (new Canvas() / route() / .show()), so that
// detection lost its only consumer and was deleted (ADR 058) — along with the AST
// walk it required. The lazy gesture-unlock at acquireStrip (ADR 058) is the actual
// silence guarantee; this flag is now purely a pre-warm/UX signal.

// ── Text-level audio scan ─────────────────────────────────────────────────────

export const API_PATTERNS = {
  // Strudel pattern engine (ADR 035): note()/sound()/stack()/seq()/cat() sources,
  // setcps()/hush()/samples() transport, and the universal `.play()` trigger.
  usesAudio:
    /\baudio\s*\.|\bnote\s*\(|\bsound\s*\(|\bstack\s*\(|\bseq\s*\(|\bsequence\s*\(|\bcat\s*\(|\bsetcps\s*\(|\bsetcpm\s*\(|\bhush\s*\(|\bsamples\s*\(|\.play\s*\(\s*\)|\bnew\s+Drumpad\b/,
};

// ── Registry-derived pattern injection (ADR 058) ──────────────────────────────
// Boot computes the audio-trigger regex from the API Descriptors (every audio
// builtin declares `detect: { effect: 'audio' }`) and injects it here via
// setAudioDetectPattern(), so a new audio API is covered the moment it declares
// its effect — no edit to this file. The static API_PATTERNS.usesAudio above is
// the fallback used when nothing is injected (unit tests that don't boot the
// registry); the derived pattern is a superset (adds Piano/Voice/Launchpad/…).

let _audioPattern = API_PATTERNS.usesAudio;

/** Inject the registry-derived audio pattern (null → revert to static fallback). */
export function setAudioDetectPattern(re) {
  _audioPattern = re || API_PATTERNS.usesAudio;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Analyse user code and report which detected APIs it references.
 *
 * @param {string} code  User code string
 * @returns {{ usesAudio: boolean }}
 */
export function detectAPIUsage(code) {
  return { usesAudio: _audioPattern.test(code) };
}
