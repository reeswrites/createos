import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Tone.js mock ──────────────────────────────────────────────────────────────

vi.mock('tone', () => {
  function makeNode(tag) {
    return {
      __tag: tag,
      triggerAttackRelease: vi.fn(),
      triggerAttack: vi.fn(),
      triggerRelease: vi.fn(),
      connect: vi.fn(function () { return this; }),
      chain: vi.fn(function () { return this; }),
      toDestination: vi.fn(function () { return this; }),
      start: vi.fn(),
      dispose: vi.fn(),
    };
  }
  const mk = (tag) => vi.fn(function () { return makeNode(tag); });
  return {
    default: {},
    Synth: mk('Synth'),
    FMSynth: mk('FMSynth'),
    AMSynth: mk('AMSynth'),
    MonoSynth: mk('MonoSynth'),
    DuoSynth: mk('DuoSynth'),
    PluckSynth: mk('PluckSynth'),
    MembraneSynth: mk('MembraneSynth'),
    MetalSynth: mk('MetalSynth'),
    NoiseSynth: mk('NoiseSynth'),
    PolySynth: vi.fn(function (Ctor) { return makeNode('Poly:' + (Ctor?.name ?? '')); }),
    Sampler: vi.fn(function (opts) { const n = makeNode('Sampler'); opts?.onload?.(); n.buffer = { duration: 4 }; return n; }),
    Player: vi.fn(function (opts) { const n = makeNode('Player'); n.start = vi.fn(); n.volume = { value: 0 }; opts?.onload?.(); n.buffer = { duration: 8 }; return n; }),
    GrainPlayer: vi.fn(function (opts) { const n = makeNode('GrainPlayer'); n.start = vi.fn(); n.volume = { value: 0 }; opts?.onload?.(); n.buffer = { duration: 8 }; return n; }),
    Gain: mk('Gain'),
    Reverb: mk('Reverb'),
    Chorus: mk('Chorus'),
    FeedbackDelay: mk('FeedbackDelay'),
    Distortion: mk('Distortion'),
    Filter: mk('Filter'),
    Compressor: mk('Compressor'),
  };
});

import * as Tone from 'tone';
import {
  Voice,
  normalizeVoice,
  instantiateVoice,
  resolveVoice,
  engineNames,
  initVoices,
  _resetVoicesForTesting,
} from '../../../src/api/audio/voice.js';

// jsdom's localStorage in this runner is a non-functional stub — install a
// working Map-backed one so persistence round-trips can be asserted.
beforeEach(() => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
  _resetVoicesForTesting();
  vi.clearAllMocks();
});

describe('normalizeVoice', () => {
  it('defaults to an FM synth voice', () => {
    const v = normalizeVoice(null);
    expect(v).toMatchObject({ kind: 'synth', engine: 'fm', poly: true });
  });

  it('accepts the legacy piano {synth,effects} shape', () => {
    const v = normalizeVoice({ synth: { type: 'AM', opts: { a: 1 } }, effects: [{ type: 'reverb' }] });
    expect(v.engine).toBe('am');
    expect(v.opts).toEqual({ a: 1 });
    expect(v.effects).toHaveLength(1);
  });

  it('falls back to fm for an unknown engine', () => {
    expect(normalizeVoice({ engine: 'bogus' }).engine).toBe('fm');
  });

  it('normalizes a sample descriptor', () => {
    const v = normalizeVoice({ kind: 'sample', mode: 'chopped', blobKey: 'k1', slices: 8 });
    expect(v).toMatchObject({ kind: 'sample', mode: 'chopped', blobKey: 'k1', slices: 8 });
  });
});

describe('instantiateVoice', () => {
  it('builds a PolySynth for a poly engine and wires fx into the output gain', () => {
    const h = instantiateVoice({ engine: 'fm', poly: true, effects: [{ type: 'reverb' }] });
    expect(Tone.PolySynth).toHaveBeenCalledWith(Tone.FMSynth, {});
    expect(Tone.Reverb).toHaveBeenCalled();
    expect(Tone.Gain).toHaveBeenCalled();
    // node.chain(reverb, output)
    expect(h.node.chain).toHaveBeenCalled();
    expect(h.output).toBeTruthy();
  });

  it('builds a bare (non-poly) node for pluck and connects directly to output', () => {
    const h = instantiateVoice({ engine: 'pluck', poly: false });
    expect(Tone.PluckSynth).toHaveBeenCalled();
    expect(Tone.PolySynth).not.toHaveBeenCalled();
    expect(h.node.connect).toHaveBeenCalled();
  });

  it('trigger passes the note for a pitched engine', () => {
    const h = instantiateVoice({ engine: 'fm' });
    h.trigger('E4', '4n', 0, 0.8);
    expect(h.node.triggerAttackRelease).toHaveBeenCalledWith('E4', '4n', 0, 0.8);
  });

  it('trigger omits the note for a noteless engine (noise)', () => {
    const h = instantiateVoice({ engine: 'noise' });
    expect(h.noteless).toBe(true);
    h.trigger('E4', '8n', 0, 1);
    expect(h.node.triggerAttackRelease).toHaveBeenCalledWith('8n', 0, 1);
  });

  it('dispose tears down node, fx, and output', () => {
    const h = instantiateVoice({ engine: 'am', effects: [{ type: 'delay' }] });
    h.dispose();
    expect(h.node.dispose).toHaveBeenCalled();
    expect(h.output.dispose).toHaveBeenCalled();
  });

  it('a chromatic sample voice builds a Sampler and triggers a note', () => {
    const h = instantiateVoice({ kind: 'sample', mode: 'chromatic', url: 'x.wav', baseNote: 'C2' });
    expect(h.kind).toBe('sample');
    expect(Tone.Sampler).toHaveBeenCalled();
    h.trigger('E4', '8n', 0, 1);
    expect(h.node().triggerAttackRelease).toHaveBeenCalledWith('E4', '8n', 0, 1);
  });

  it('a chopped sample voice builds a Player and plays a slice region', () => {
    const h = instantiateVoice({ kind: 'sample', mode: 'chopped', url: 'loop.wav', slices: 4 });
    expect(Tone.Player).toHaveBeenCalled();
    expect(h.sliceCount()).toBe(4);
    h.triggerSlice(1, 0); // buffer.duration 8 / 4 = 2 → offset 2, len 2
    expect(h.node().start).toHaveBeenCalledWith(0, 2, 2);
  });

  it('a chopped trigger with a numeric note plays that slice index', () => {
    const h = instantiateVoice({ kind: 'sample', mode: 'chopped', url: 'loop.wav', slices: 8 });
    h.trigger(2, '8n', 0); // duration 8 / 8 = 1 → offset 2, len 1
    expect(h.node().start).toHaveBeenCalledWith(0, 2, 1);
  });

  it('preserveLength chopped uses GrainPlayer', () => {
    instantiateVoice({ kind: 'sample', mode: 'chopped', url: 'l.wav', preserveLength: true });
    expect(Tone.GrainPlayer).toHaveBeenCalled();
  });
});

describe('Voice registry', () => {
  it('define stores a normalized descriptor and persists it', () => {
    Voice.define('MyBass', { engine: 'mono', opts: { x: 1 } });
    expect(Voice.get('MyBass')).toMatchObject({ kind: 'synth', engine: 'mono', name: 'MyBass' });
    const raw = JSON.parse(localStorage.getItem('vl_voices'));
    expect(raw.voices.MyBass.engine).toBe('mono');
  });

  it('define accepts a factory function (power-user door)', () => {
    Voice.define('Fn', () => ({ engine: 'pluck', poly: false }));
    expect(Voice.get('Fn').engine).toBe('pluck');
  });

  it('resolveVoice returns the stored descriptor by name, pass-through for inline', () => {
    Voice.define('X', { engine: 'am' });
    expect(resolveVoice('X').engine).toBe('am');
    expect(resolveVoice({ engine: 'duo' }).engine).toBe('duo');
  });

  it('make instantiates by name', () => {
    Voice.define('Lead', { engine: 'fm' });
    const h = Voice.make('Lead');
    expect(h.engine).toBe('fm');
  });

  it('list and remove work', () => {
    Voice.define('A', { engine: 'fm' });
    Voice.define('B', { engine: 'am' });
    expect(Voice.list().map((v) => v.name).sort()).toEqual(['A', 'B']);
    Voice.remove('A');
    expect(Voice.get('A')).toBeNull();
  });

  it('engineNames exposes the deduped engine list', () => {
    expect(engineNames()).toContain('fm');
    expect(engineNames()).toContain('noise');
    expect(engineNames()).not.toContain('synth'); // alias of basic
  });
});

describe('Voice.faust', () => {
  it('normalizes a faust descriptor', () => {
    const v = normalizeVoice({ kind: 'faust', code: 'process = _;', voices: 8 });
    expect(v).toMatchObject({ kind: 'faust', code: 'process = _;', poly: true, voices: 8 });
  });

  it('Voice.faust registers a named faust voice', () => {
    Voice.faust('Bow', 'import("stdfaust.lib"); process = pm.violin_ui_MIDI;');
    expect(Voice.get('Bow')).toMatchObject({ kind: 'faust', poly: true });
    expect(Voice.get('Bow').code).toContain('pm.violin');
  });
});

describe('Voice.sample', () => {
  it('builds a sample descriptor from a url', () => {
    const d = Voice.sample({ url: 'kick.wav', mode: 'chromatic', baseNote: 'C2' });
    expect(d).toMatchObject({ kind: 'sample', mode: 'chromatic', url: 'kick.wav', baseNote: 'C2' });
  });

  it('stores a blob in IDB and carries the blobKey', () => {
    const addBlob = vi.fn(() => ({ blobKey: 'cap-1' }));
    window.desktop = { addBlob };
    const d = Voice.sample({ name: 'Vox', blob: new Blob(['x']), mode: 'chopped', slices: 8 });
    expect(addBlob).toHaveBeenCalled();
    expect(d.blobKey).toBe('cap-1');
    expect(Voice.get('Vox')).toMatchObject({ kind: 'sample', blobKey: 'cap-1', slices: 8 });
    delete window.desktop;
  });
});

describe('initVoices', () => {
  it('seeds builtin voices and merges persisted ones', () => {
    localStorage.setItem(
      'vl_voices',
      JSON.stringify({ version: 1, voices: { Saved: { kind: 'synth', engine: 'duo' } } }),
    );
    initVoices();
    expect(Voice.get('FM Keys')).toBeTruthy(); // builtin
    expect(Voice.get('Saved').engine).toBe('duo'); // persisted
  });
});
