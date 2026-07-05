import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('tone', () => {
  function makeNode(tag) {
    return {
      __tag: tag,
      triggerAttackRelease: vi.fn(),
      triggerAttack: vi.fn(),
      triggerRelease: vi.fn(),
      connect: vi.fn(function () {
        return this;
      }),
      chain: vi.fn(function () {
        return this;
      }),
      toDestination: vi.fn(function () {
        return this;
      }),
      start: vi.fn(),
      dispose: vi.fn(),
    };
  }
  const mk = (tag) =>
    vi.fn(function () {
      return makeNode(tag);
    });
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
    PolySynth: vi.fn(function () {
      return makeNode('Poly');
    }),
    Gain: mk('Gain'),
    Reverb: mk('Reverb'),
    Chorus: mk('Chorus'),
    FeedbackDelay: mk('FeedbackDelay'),
    Distortion: mk('Distortion'),
    Filter: mk('Filter'),
    Compressor: mk('Compressor'),
  };
});

import { BindingMap } from '../../../../src/api/audio/binding.js';
import { Voice, _resetVoicesForTesting } from '../../../../src/api/audio/voice.js';

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

describe('BindingMap voices', () => {
  it('binds a voice by inline descriptor and lazily instantiates it', () => {
    const onVoice = vi.fn();
    const m = new BindingMap({ onVoice });
    m.bindVoice(3, { engine: 'am' });
    expect(m.get(3).voice.engine).toBe('am');
    expect(m.get(3).handle).toBeNull(); // lazy
    const h = m.voiceFor(3);
    expect(h.engine).toBe('am');
    expect(onVoice).toHaveBeenCalledWith(h); // routed via hook
    expect(m.voiceFor(3)).toBe(h); // cached
  });

  it('binds a voice by registered name, stored inline (portable)', () => {
    Voice.define('Bass', { engine: 'mono' });
    const m = new BindingMap();
    m.bindVoice('kick', 'Bass');
    expect(m.get('kick').voice.engine).toBe('mono'); // inlined, not a name ref
  });

  it('rebinding disposes the previous handle', () => {
    const m = new BindingMap();
    m.bindVoice(0, { engine: 'fm' });
    const h1 = m.voiceFor(0);
    m.bindVoice(0, { engine: 'am' });
    expect(h1.node.dispose).toHaveBeenCalled();
    expect(m.voiceFor(0).engine).toBe('am');
  });

  it('voiceFor returns null when no voice bound', () => {
    const m = new BindingMap();
    expect(m.voiceFor(9)).toBeNull();
  });
});

describe('BindingMap actions', () => {
  it('binds a named action; reports event + silence', () => {
    const m = new BindingMap();
    m.bindAction(2, 'drop', { silent: true });
    expect(m.actionFor(2)).toEqual({ event: 'drop', silent: true });
    expect(m.isSilent(2)).toBe(true);
  });

  it('a non-silent action does not suppress sound', () => {
    const m = new BindingMap();
    m.bindAction(2, 'hit');
    expect(m.isSilent(2)).toBe(false);
  });

  it('a key can carry both a voice and an action', () => {
    const m = new BindingMap();
    m.bindVoice(1, { engine: 'fm' });
    m.bindAction(1, 'boom');
    expect(m.voiceFor(1)).toBeTruthy();
    expect(m.actionFor(1).event).toBe('boom');
  });
});

describe('BindingMap serialize / restore', () => {
  it('round-trips voices inline + actions', () => {
    const m = new BindingMap();
    m.bindVoice(0, { engine: 'duo' });
    m.bindAction(0, 'x', { silent: true });
    m.bindAction(5, 'y');
    const data = m.serialize();
    expect(data['0'].voice.engine).toBe('duo');
    expect(data['0']).toMatchObject({ event: 'x', silent: true });
    expect(data['5']).toMatchObject({ event: 'y', silent: false });

    const m2 = new BindingMap();
    m2.restore(data);
    expect(m2.get(0).voice.engine).toBe('duo');
    expect(m2.actionFor(5).event).toBe('y');
  });

  it('dispose tears down all instantiated handles', () => {
    const m = new BindingMap();
    m.bindVoice(0, { engine: 'fm' });
    m.bindVoice(1, { engine: 'am' });
    const h0 = m.voiceFor(0);
    const h1 = m.voiceFor(1);
    m.dispose();
    expect(h0.node.dispose).toHaveBeenCalled();
    expect(h1.node.dispose).toHaveBeenCalled();
  });
});
