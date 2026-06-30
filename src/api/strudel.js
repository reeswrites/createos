// Strudel integration (ADR 035) — replaces the in-house "Deep Strudel" Pattern engine.
//
// Owns as little as possible: every seam below touches a PUBLIC export of
// @strudel/* or superdough. No library internals are patched.
//
//   - Bootstrap mirrors @strudel/web's initStrudel, minus the transpiler and minus
//     String.prototype patching (ADR 035 #2 — explicit calls only, one execution model).
//   - Shared tempo, stock scheduler (ADR 035 #3): Tone is master. Strudel + superdough
//     run on Tone's AudioContext (superdough.setAudioContext); setcps(n) drives both
//     Strudel cps and Tone.Transport.bpm = n*60.
//   - One "Strudel" mixer strip (ADR 035 #4): superdough's single master node
//     (getSuperdoughAudioController().output.destinationGain) is rerouted into a mixer
//     strip. Per-orbit strips are deferred to an upstream superdough feature.
//   - Run-scoped (ADR 035 #5): hush() on every reset via onReset.

import * as core from '@strudel/core';
import * as tonal from '@strudel/tonal';
import * as webaudio from '@strudel/webaudio';
import { Pattern, evalScope, setTime } from '@strudel/core';
import { miniAllStrings } from '@strudel/mini';
import {
  webaudioRepl,
  registerSynthSounds,
  initAudioOnFirstClick,
  setAudioContext,
  getSuperdoughAudioController,
  samples,
} from '@strudel/webaudio';
import * as Tone from 'tone';
import { onReset } from '../runtime/reset-registry.js';
import { acquireStrip } from './mixer.js';

let _repl = null;
let _initDone = null;
let _stripWired = false;

// ── Bootstrap ──────────────────────────────────────────────────────────────

export function initStrudel() {
  if (_initDone) return _initDone;

  // Share ONE *native* AudioContext between Tone (master) and superdough, BEFORE
  // either lazily creates its own. Tone's default context is a standardized-audio-
  // context wrapper whose object fails `new ChannelMergerNode(ctx)` — superdough
  // builds every voice with the native constructor, so the wrapper silenced ALL
  // Strudel audio (ADR 035's owed browser-verify). A native context satisfies both:
  // Tone creates nodes via ctx.createX() factory methods (fine on native) and
  // superdough via native constructors. setContext wraps it; rawContext stays native.
  try {
    const Native = window.AudioContext || window.webkitAudioContext;
    const ctx = new Native({ latencyHint: 'interactive' });
    Tone.setContext(ctx); // Tone master, on the shared native ctx
    setAudioContext(ctx); // superdough shares the exact same native ctx
  } catch (_) {}

  initAudioOnFirstClick(); // superdough resumes the (shared) ctx on first user gesture
  miniAllStrings(); // setStringParser(mini) only — no String.prototype patch in this version

  _repl = webaudioRepl({}); // NB: no transpiler (ADR 035 #2)

  _initDone = (async () => {
    await evalScope(
      import('@strudel/core'),
      import('@strudel/mini'),
      import('@strudel/tonal'),
      import('@strudel/webaudio'),
    );
    try {
      await registerSynthSounds();
    } catch (_) {}
    return _repl;
  })();

  setTime(() => _repl.scheduler.now());

  // .play() schedules on the single shared scheduler (last pattern wins — authentic
  // Strudel; stack(...) to layer). .stop()/hush() halt the scheduler.
  Pattern.prototype.play = function () {
    _initDone.then(() => {
      try {
        _wireStrip();
      } catch (_) {}
      _repl.setPattern(this, true);
    });
    return this;
  };
  Pattern.prototype.stop = function () {
    try {
      _repl?.stop();
    } catch (_) {}
    return this;
  };

  return _initDone;
}

// ── Tempo bridge (ADR 035 #3) ───────────────────────────────────────────────

export function setcps(n) {
  try {
    _repl?.scheduler?.setCps?.(n);
  } catch (_) {}
  try {
    Tone.getTransport().bpm.value = n * 60;
  } catch (_) {}
  return n;
}
export function setcpm(n) {
  return setcps(n / 60);
}
export function hush() {
  try {
    _repl?.stop();
  } catch (_) {}
}

// ── Mixer strip (ADR 035 #4) ────────────────────────────────────────────────
// Reroute superdough's single master node into a dedicated "Strudel" strip.
// Idempotent + degrades to direct-to-destination if the seam ever moves.

function _wireStrip() {
  if (_stripWired) return;
  let dg;
  try {
    dg = getSuperdoughAudioController()?.output?.destinationGain;
  } catch (_) {}
  if (!dg) return; // superdough not initialised yet — retry next play
  try {
    const strip = acquireStrip('Strudel', { type: 'node', lifecycle: 'persistent' });
    dg.disconnect(); // detach from ctx.destination
    strip.connectFrom(dg); // → strip._in → channel → masterIn → destination
    _stripWired = true;
  } catch (_) {
    _stripWired = false; // leave default routing intact on failure
  }
}

// ── Curated window-global namespace ─────────────────────────────────────────
// Top-level pattern constructors / combinators / signals users start statements
// with. Chain transforms (.fast/.gain/.jux/…) are Pattern methods, already on the
// returned object — they need no globals. evalScope (above) registers the full set
// into Strudel's own scope for engine-side name resolution.

const GLOBAL_NAMES = [
  // sources
  'note',
  's',
  'n',
  'sound',
  'silence',
  // combinators
  'stack',
  'cat',
  'slowcat',
  'fastcat',
  'seq',
  'sequence',
  'timeCat',
  'arrange',
  'polymeter',
  'polyrhythm',
  'run',
  // random / signals
  'rand',
  'rand2',
  'perlin',
  'irand',
  'choose',
  'wchoose',
  'chooseCycles',
  'randcat',
  'sine',
  'cosine',
  'saw',
  'isaw',
  'square',
  'tri',
  'signal',
  'steady',
  // misc helpers
  'pure',
  'reify',
  'mini',
  'samples',
];

export function strudelGlobals() {
  const src = { ...core, ...tonal, ...webaudio, samples, setcps, setcpm, hush };
  const out = {};
  for (const name of GLOBAL_NAMES) {
    if (typeof src[name] !== 'undefined') out[name] = src[name];
  }
  // tempo + transport sugar always present
  out.setcps = setcps;
  out.setcpm = setcpm;
  out.hush = hush;
  return out;
}

// ── Reset (ADR 035 #5) ──────────────────────────────────────────────────────
onReset(() => {
  hush();
});
