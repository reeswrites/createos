// ── Faust Voice engine (ADR 046, P4) ────────────────────────────────────────────
// A second DSP engine behind the Voice registry: the Faust language compiled to a
// WebAssembly AudioWorklet in the browser (@grame/faustwasm), giving true physical
// modelling (physmodels.lib) beside Tone's fixed engines. Same "second engine on the
// shared AudioContext, routed through the mixer" discipline as Strudel/superdough
// (ADR 035) — the node runs on Tone's rawContext and feeds a Tone.Gain the surface
// connects to its strip/Destination.
//
// The heavy compiler (~5 MB WASM) is dynamic-imported on FIRST use only, never in
// the main bundle; the libfaust assets are served by the `faust-assets` Vite plugin
// (dev middleware + build copy) from node_modules, so no binaries land in git.
//
// A Faust Voice descriptor: { kind:'faust', code:'<dsl>', poly?:true, voices?:16 }.
// buildFaustHandle returns the standard Voice handle (output/trigger/attack/release/
// dispose), so Faust voices drop into Piano/Drumpad/Launchpad + bindings for free.

import * as Tone from 'tone';
import { noteToMidi } from './music-theory.js';

// ── libfaust compiler (lazy, shared) ────────────────────────────────────────────

let _faustModPromise = null;
let _compilerPromise = null;

function _loadFaust() {
  if (!_faustModPromise) _faustModPromise = import('@grame/faustwasm');
  return _faustModPromise;
}

async function _getCompiler() {
  if (_compilerPromise) return _compilerPromise;
  _compilerPromise = (async () => {
    const { instantiateFaustModuleFromFile, LibFaust, FaustCompiler } = await _loadFaust();
    // Assets are served under <base>libfaust-wasm/ (Vite plugin). The .js glue
    // derives the .data/.wasm paths from this URL, so they must be colocated.
    const base = import.meta?.env?.BASE_URL ?? '/';
    const origin = typeof location !== 'undefined' ? location.origin : '';
    const jsURL = new URL(base + 'libfaust-wasm/libfaust-wasm.js', origin || undefined).href;
    const module = await instantiateFaustModuleFromFile(jsURL);
    return new FaustCompiler(new LibFaust(module));
  })();
  return _compilerPromise;
}

// The real node factory: compile `code` → a poly (or mono) Faust AudioWorklet on
// Tone's shared context. Overridable in tests (WASM can't run under jsdom).
let _nodeFactory = async (code, { voices = 16 } = {}) => {
  const { FaustPolyDspGenerator, FaustMonoDspGenerator } = await _loadFaust();
  const compiler = await _getCompiler();
  const ctx = Tone.getContext().rawContext;
  const args = '-ftz 2';
  if (voices > 0) {
    const gen = new FaustPolyDspGenerator();
    await gen.compile(compiler, 'voice', code, args);
    return gen.createNode(ctx, voices);
  }
  const gen = new FaustMonoDspGenerator();
  await gen.compile(compiler, 'voice', code, args);
  return gen.createNode(ctx);
};

export function _setFaustNodeFactoryForTesting(fn) {
  _nodeFactory = fn;
}

// ── Note / duration helpers ─────────────────────────────────────────────────────

function _durMs(dur) {
  try {
    return Math.max(1, Tone.Time(dur).toMilliseconds());
  } catch (_) {
    return 250;
  }
}

// Mono Faust synth: drive the conventional freq/gain/gate params by path suffix.
function _monoGate(node, note, vel, on) {
  try {
    const params = node.__ar_params ?? (node.__ar_params = node.getParams?.() ?? []);
    for (const p of params) {
      const lp = p.toLowerCase();
      if (lp.endsWith('/freq')) node.setParamValue(p, Tone.Frequency(note).toFrequency?.() ?? 440);
      else if (lp.endsWith('/gain')) node.setParamValue(p, vel);
      else if (lp.endsWith('/gate')) node.setParamValue(p, on ? 1 : 0);
    }
  } catch (_) {}
}

// ── Handle ───────────────────────────────────────────────────────────────────────

export function buildFaustHandle(desc) {
  const output = new Tone.Gain(1);
  let node = null;
  let ready = false;
  const voices = desc.poly === false ? 0 : (desc.voices ?? 16);

  _nodeFactory(desc.code ?? '', { voices })
    .then((n) => {
      node = n;
      try {
        node.connect(output.input ?? output);
      } catch (_) {}
      ready = true;
    })
    .catch((e) => {
      console.warn('Faust: compile/create failed —', e?.message ?? e);
    });

  const isPoly = () => node && typeof node.keyOn === 'function';

  return {
    kind: 'faust',
    output,
    node: () => node,
    get ready() {
      return ready;
    },
    attack(note = 'C4', time, vel = 1) {
      if (isPoly())
        node.keyOn(0, noteToMidi(note), Math.round(Math.max(0, Math.min(1, vel)) * 127));
      else if (node) _monoGate(node, note, vel, true);
    },
    release(note = 'C4') {
      if (isPoly()) node.keyOff(0, noteToMidi(note));
      else if (node) _monoGate(node, note, 0, false);
    },
    // One-shot: attack, then release after `dur` (Faust keyOn/off is immediate — the
    // Tone `time` arg can't schedule a worklet note; P4a plays now, no sample-accurate
    // sequencer scheduling for Faust voices).
    trigger(note = 'C4', dur = '8n', time, vel = 1) {
      this.attack(note, time, vel);
      const ms = _durMs(dur);
      window.setTimeout(() => this.release(note), ms);
    },
    dispose() {
      try {
        node?.disconnect?.();
      } catch (_) {}
      try {
        node?.destroy?.();
      } catch (_) {}
      try {
        output.dispose?.();
      } catch (_) {}
    },
  };
}

// ── Physical-modelling presets (physmodels.lib) ─────────────────────────────────
// A few zero-code Faust Voices so non-coders get physical modelling. Each is a
// standard poly instrument (freq/gain/gate) from the Faust standard library.
export const FAUST_PRESETS = {
  'Bowed String': 'import("stdfaust.lib");\nprocess = pm.violin_ui_MIDI <: _, _;',
  Marimba: 'import("stdfaust.lib");\nprocess = pm.marimba_ui_MIDI <: _, _;',
  Clarinet: 'import("stdfaust.lib");\nprocess = pm.clarinet_ui_MIDI <: _, _;',
  Flute: 'import("stdfaust.lib");\nprocess = pm.flute_ui_MIDI <: _, _;',
};
