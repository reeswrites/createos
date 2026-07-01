// ── Voice ─────────────────────────────────────────────────────────────────────
// A Voice is a named, reusable, DECLARATIVE sound generator (ADR 046). It is
// plain JSON — a descriptor the Trigger Surfaces (Piano / Drumpad / Launchpad)
// instantiate per-trigger, so each routes through its own mixer Strip (ADR 032).
//
// Two kinds:
//   Synth Voice  — { kind:'synth', engine, poly?, opts?, effects?[] } over Tone
//   Sample Voice — { kind:'sample', mode, blobKey|url, baseNote?, slices?, preserveLength? }
//                  chromatic (Tone.Sampler, pitched across keys) or chopped (slices
//                  across pads); speed-coupled pitch, GrainPlayer when preserveLength.
//
// The registry (window.Voice) mirrors library.js: define / get / list / remove,
// persisted to localStorage['vl_voices']. Voices are embedded inline in Bindings
// for portability — this registry is a convenience drawer to copy FROM, not a
// dependency (ADR 046).

import * as Tone from 'tone';
import { buildFaustHandle, FAUST_PRESETS } from './faust.js';

const STORAGE_KEY = 'vl_voices';
const VERSION = 1;

// ── Engine registry ───────────────────────────────────────────────────────────
// engine name (lowercase) → { ctor, poly: canPoly, noteless }
// `noteless` engines (noise) ignore the note argument on trigger.

const ENGINES = {
  basic: { ctor: () => Tone.Synth, poly: true },
  synth: { ctor: () => Tone.Synth, poly: true },
  fm: { ctor: () => Tone.FMSynth, poly: true },
  am: { ctor: () => Tone.AMSynth, poly: true },
  mono: { ctor: () => Tone.MonoSynth, poly: true },
  duo: { ctor: () => Tone.DuoSynth, poly: true },
  pluck: { ctor: () => Tone.PluckSynth, poly: false },
  membrane: { ctor: () => Tone.MembraneSynth, poly: true },
  kick: { ctor: () => Tone.MembraneSynth, poly: true },
  metal: { ctor: () => Tone.MetalSynth, poly: true },
  noise: { ctor: () => Tone.NoiseSynth, poly: true, noteless: true },
};

export function engineNames() {
  // Dedupe alias engines (synth==basic, kick==membrane) for UI listings.
  return ['basic', 'fm', 'am', 'mono', 'duo', 'pluck', 'membrane', 'metal', 'noise'];
}

// ── Effect builder ─────────────────────────────────────────────────────────────
// Mirrors piano.js _buildEffect; one place so every surface gets the same FX set.

function buildEffect(cfg) {
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
      fx.start?.(); // Chorus LFO must be started explicitly
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
    case 'filter':
      return new Tone.Filter({
        type: cfg.filterType ?? 'lowpass',
        frequency: cfg.frequency ?? 1000,
        Q: cfg.Q ?? 1,
      });
    case 'compressor':
      return new Tone.Compressor({ threshold: cfg.threshold ?? -24, ratio: cfg.ratio ?? 4 });
    default:
      return null;
  }
}

// ── Descriptor normalization ────────────────────────────────────────────────────
// Accepts loose user input (legacy {synth:{type,opts},effects} from piano, or a
// flat {engine,opts,effects}) and returns a canonical Voice descriptor.

export function normalizeVoice(descOrName) {
  if (descOrName == null) return { kind: 'synth', engine: 'fm', poly: true, opts: {}, effects: [] };
  // Legacy piano shape: { synth: { type, opts }, effects: [] }
  if (descOrName.synth && !descOrName.engine) {
    const t = String(descOrName.synth.type ?? 'fm').toLowerCase();
    return {
      kind: 'synth',
      engine: ENGINES[t] ? t : 'fm',
      poly: descOrName.synth.poly ?? true,
      opts: descOrName.synth.opts ?? {},
      effects: descOrName.effects ?? [],
      name: descOrName.name,
    };
  }
  if (descOrName.kind === 'faust') {
    return {
      kind: 'faust',
      code: descOrName.code ?? '',
      poly: descOrName.poly ?? true,
      voices: descOrName.voices ?? 16,
      name: descOrName.name,
    };
  }
  if (descOrName.kind === 'sample') {
    return {
      kind: 'sample',
      mode: descOrName.mode ?? 'chromatic',
      blobKey: descOrName.blobKey ?? null,
      url: descOrName.url ?? null,
      baseNote: descOrName.baseNote ?? 'C4',
      slices: descOrName.slices ?? 16,
      preserveLength: !!descOrName.preserveLength,
      effects: descOrName.effects ?? [],
      name: descOrName.name,
    };
  }
  const engine = String(descOrName.engine ?? 'fm').toLowerCase();
  return {
    kind: 'synth',
    engine: ENGINES[engine] ? engine : 'fm',
    poly: descOrName.poly ?? true,
    opts: descOrName.opts ?? {},
    effects: descOrName.effects ?? [],
    name: descOrName.name,
  };
}

// ── Synth node builder ──────────────────────────────────────────────────────────
// Builds the inner Tone node (not connected anywhere). Returns { node, fx, noteless }.

function buildSynthNode(desc) {
  const spec = ENGINES[desc.engine] ?? ENGINES.fm;
  const Ctor = spec.ctor();
  let node;
  if (desc.poly && spec.poly) {
    node = new Tone.PolySynth(Ctor, desc.opts ?? {});
  } else {
    node = new Ctor(desc.opts ?? {});
  }
  const fx = (desc.effects ?? []).map(buildEffect).filter(Boolean);
  return { node, fx, noteless: !!spec.noteless };
}

// ── Sample voice ─────────────────────────────────────────────────────────────────
// Resolve a sample's audio URL: a direct `url`, or a `blobKey` read from the IDB
// capture store (ADR 016) via the public desktop API. blobKey is resolved at
// runtime (not a static import) to avoid a voice→desktop module cycle.
async function resolveSampleUrl(desc) {
  if (desc.url) return desc.url;
  if (desc.blobKey && window.desktop?.getBlob) {
    try {
      const blob = await window.desktop.getBlob(desc.blobKey);
      if (blob) return URL.createObjectURL(blob);
    } catch (_) {}
  }
  return null;
}

// A Sample Voice handle. Two modes:
//   chromatic — one buffer pitched across notes (Tone.Sampler); trigger(note,…).
//   chopped   — buffer cut into `slices` equal regions; triggerSlice(i,…) plays a
//               region, and trigger(i,…) treats a numeric note as a slice index.
// Pitch is speed-coupled by default (Sampler/Player playbackRate); a
// preserve-length sample uses Tone.GrainPlayer (pitch independent of tempo).
function buildSampleHandle(desc) {
  const output = new Tone.Gain(1);
  const fx = (desc.effects ?? []).map(buildEffect).filter(Boolean);
  let node = null;
  let ready = false;

  const buildNode = (url) => {
    if (!url) return;
    if (desc.mode === 'chromatic') {
      node = new Tone.Sampler({
        urls: { [desc.baseNote ?? 'C4']: url },
        onload: () => {
          ready = true;
        },
      });
    } else {
      const Ctor = desc.preserveLength && Tone.GrainPlayer ? Tone.GrainPlayer : Tone.Player;
      node = new Ctor({
        url,
        onload: () => {
          ready = true;
        },
      });
    }
    if (fx.length) node.chain(...fx, output);
    else node.connect(output);
  };

  // Direct url builds synchronously (triggers can fire immediately); a blobKey
  // must be read from IDB first, so that path loads asynchronously.
  if (desc.url) buildNode(desc.url);
  else resolveSampleUrl(desc).then(buildNode).catch(() => {});

  const sliceCount = () => Math.max(1, desc.slices ?? 16);

  const playSlice = (i, time, vel = 1) => {
    if (!node?.buffer) return;
    const dur = node.buffer.duration ?? 0;
    const n = sliceCount();
    const idx = ((Math.floor(i) % n) + n) % n;
    const len = dur / n;
    try {
      node.volume &&
        (node.volume.value = vel < 1 ? Math.max(-40, 20 * Math.log10(vel || 0.001)) : 0);
      node.start(time, idx * len, len);
    } catch (_) {}
  };

  return {
    kind: 'sample',
    mode: desc.mode,
    output,
    node: () => node,
    get ready() {
      return ready;
    },
    sliceCount,
    triggerSlice: playSlice,
    trigger(note = 'C4', dur = '8n', time, vel = 1) {
      if (!node) return;
      if (desc.mode === 'chromatic') {
        try {
          node.triggerAttackRelease(note, dur, time, vel);
        } catch (_) {}
      } else {
        // chopped: numeric note = slice index, else slice 0
        playSlice(typeof note === 'number' ? note : 0, time, vel);
      }
    },
    attack(note = 'C4', time, vel = 1) {
      if (desc.mode === 'chromatic') {
        try {
          node?.triggerAttack(note, time, vel);
        } catch (_) {}
      } else {
        playSlice(typeof note === 'number' ? note : 0, time, vel);
      }
    },
    release(note = 'C4', time) {
      if (desc.mode === 'chromatic') {
        try {
          node?.triggerRelease?.(note, time);
        } catch (_) {}
      }
    },
    dispose() {
      try {
        node?.dispose?.();
      } catch (_) {}
      for (const f of fx) {
        try {
          f.dispose?.();
        } catch (_) {}
      }
      try {
        output.dispose?.();
      } catch (_) {}
    },
  };
}

// ── Instantiation ────────────────────────────────────────────────────────────────
// Turn a descriptor (or registered name) into a playable handle. The caller
// connects `handle.output` to its surface Strip; `handle.dispose()` frees it.
//
// handle.trigger(note, dur, time, vel)  — one-shot (triggerAttackRelease)
// handle.attack(note, time, vel)        — note on
// handle.release(note, time)            — note off

export function instantiateVoice(descOrName) {
  const desc = normalizeVoice(resolveVoice(descOrName));

  if (desc.kind === 'faust') return buildFaustHandle(desc);
  if (desc.kind === 'sample') return buildSampleHandle(desc);

  const { node, fx, noteless } = buildSynthNode(desc);
  // node → [fx…] → output (a Gain the caller connects to its Strip)
  const output = new Tone.Gain(1);
  if (fx.length) node.chain(...fx, output);
  else node.connect(output);

  const dispose = () => {
    try {
      node.dispose?.();
    } catch (_) {}
    for (const f of fx) {
      try {
        f.dispose?.();
      } catch (_) {}
    }
    try {
      output.dispose?.();
    } catch (_) {}
  };

  return {
    kind: 'synth',
    engine: desc.engine,
    noteless,
    output,
    node,
    trigger(note = 'C4', dur = '8n', time, vel = 1) {
      if (noteless) node.triggerAttackRelease(dur, time, vel);
      else node.triggerAttackRelease(note, dur, time, vel);
    },
    attack(note = 'C4', time, vel = 1) {
      if (noteless) node.triggerAttack(time, vel);
      else node.triggerAttack(note, time, vel);
    },
    release(note = 'C4', time) {
      if (noteless) node.triggerRelease?.(time);
      else node.triggerRelease?.(note, time);
    },
    dispose,
  };
}

// ── Registry ─────────────────────────────────────────────────────────────────────

const _voices = new Map(); // name → canonical descriptor

const BUILTIN_VOICES = {
  'FM Keys': {
    kind: 'synth',
    engine: 'fm',
    poly: true,
    opts: {},
    effects: [{ type: 'reverb', wet: 0.2 }],
  },
  Pluck: { kind: 'synth', engine: 'pluck', poly: false, opts: {}, effects: [] },
  Bass: {
    kind: 'synth',
    engine: 'mono',
    poly: false,
    opts: { oscillator: { type: 'sawtooth' }, filterEnvelope: { baseFrequency: 200 } },
    effects: [],
  },
};

function persist() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: VERSION, voices: Object.fromEntries(_voices) }),
    );
  } catch (e) {
    console.warn('vl_voices: localStorage write failed', e);
  }
}

export function initVoices() {
  for (const [name, desc] of Object.entries(BUILTIN_VOICES)) {
    if (!_voices.has(name)) _voices.set(name, normalizeVoice(desc));
  }
  // Seed Faust physical-modelling presets (physmodels.lib) as named Voices.
  for (const [name, code] of Object.entries(FAUST_PRESETS)) {
    if (!_voices.has(name)) _voices.set(name, normalizeVoice({ kind: 'faust', code, name }));
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (data.voices)
      Object.entries(data.voices).forEach(([k, v]) => _voices.set(k, normalizeVoice(v)));
  } catch (e) {
    console.warn('vl_voices: localStorage read failed', e);
  }
}

// Resolve a name to its stored descriptor; pass-through for inline descriptors.
export function resolveVoice(nameOrDesc) {
  if (typeof nameOrDesc === 'string') return _voices.get(nameOrDesc) ?? BUILTIN_VOICES['FM Keys'];
  return nameOrDesc;
}

// ── Public API (window.Voice) ────────────────────────────────────────────────────

export const Voice = {
  // Register a named Voice. `desc` is a descriptor OR a factory fn returning one
  // (the power-user door, ADR 046). Returns the canonical descriptor.
  define(name, desc) {
    const resolved = typeof desc === 'function' ? desc() : desc;
    const canon = normalizeVoice(resolved);
    canon.name = name;
    _voices.set(name, canon);
    persist();
    window.__ar_addToolkitEntry?.('Voices', _voiceCmd(name));
    return canon;
  },

  get(name) {
    return _voices.get(name) ?? null;
  },

  // Instantiate a playable handle from a name or inline descriptor.
  make(descOrName) {
    return instantiateVoice(descOrName);
  },

  // Register a Faust Voice from DSP source (ADR 046 / P4). `code` is Faust language;
  // a poly instrument (freq/gain/gate) plays across keys/pads. Physical modelling via
  // `import("stdfaust.lib"); process = pm.…;`. The WASM compiler loads on first use.
  faust(name, code, { poly = true, voices = 16 } = {}) {
    const desc = normalizeVoice({ kind: 'faust', code, poly, voices });
    desc.name = name;
    _voices.set(name, desc);
    persist();
    window.__ar_addToolkitEntry?.('Voices', _voiceCmd(name));
    return desc;
  },

  // Build (and optionally register) a Sample Voice. Pass a `blob`/`file` to store
  // it in the IDB capture store (ADR 016) and carry it as a blobKey; or a `url`.
  //   Voice.sample({ name:'Vox', blob, mode:'chopped', slices:16 })
  //   Voice.sample({ url:'kick.wav', mode:'chromatic', baseNote:'C2' })
  sample(opts = {}) {
    let {
      name,
      url,
      blob,
      file,
      blobKey,
      mode = 'chromatic',
      baseNote = 'C4',
      slices = 16,
      preserveLength = false,
      effects = [],
    } = opts;
    const b = blob ?? file;
    if (b && window.desktop?.addBlob) {
      try {
        const rec = window.desktop.addBlob(b, { name: name ?? 'sample', type: 'audio' });
        blobKey = rec.blobKey ?? rec.id;
      } catch (_) {}
    }
    const desc = normalizeVoice({
      kind: 'sample',
      mode,
      url,
      blobKey,
      baseNote,
      slices,
      preserveLength,
      effects,
    });
    if (name) {
      desc.name = name;
      _voices.set(name, desc);
      persist();
      window.__ar_addToolkitEntry?.('Voices', _voiceCmd(name));
    }
    return desc;
  },

  list() {
    return [..._voices.entries()].map(([name, d]) => ({
      name,
      kind: d.kind,
      engine: d.engine,
    }));
  },

  remove(name) {
    _voices.delete(name);
    persist();
    return Voice;
  },

  engines() {
    return engineNames();
  },
};

function _voiceCmd(name) {
  return {
    label: name,
    hint: `Saved voice "${name}" — play with Voice.make('${name}')`,
    code: `const v = Voice.make('${name}');\nv.output.toDestination();\nv.trigger('C4', '8n');`,
    tags: ['voice', 'synth', name],
  };
}

// ── Test helper ───────────────────────────────────────────────────────────────
export function _resetVoicesForTesting() {
  _voices.clear();
}
