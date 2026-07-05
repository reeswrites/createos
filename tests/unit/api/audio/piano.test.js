import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('tone', () => {
  function makeNode() {
    return {
      triggerAttack: vi.fn(),
      triggerRelease: vi.fn(),
      triggerAttackRelease: vi.fn(),
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
      volume: { value: 0 },
    };
  }
  const mk = () =>
    vi.fn(function () {
      return makeNode();
    });
  return {
    default: {},
    Synth: mk(),
    FMSynth: mk(),
    AMSynth: mk(),
    MonoSynth: mk(),
    DuoSynth: mk(),
    PluckSynth: mk(),
    MembraneSynth: mk(),
    MetalSynth: mk(),
    NoiseSynth: mk(),
    PolySynth: vi.fn(function () {
      return makeNode();
    }),
    Sampler: vi.fn(function (o) {
      const n = makeNode();
      o?.onload?.();
      n.buffer = { duration: 4 };
      return n;
    }),
    Player: vi.fn(function (o) {
      const n = makeNode();
      n.start = vi.fn();
      o?.onload?.();
      n.buffer = { duration: 8 };
      return n;
    }),
    GrainPlayer: vi.fn(function (o) {
      const n = makeNode();
      n.start = vi.fn();
      o?.onload?.();
      n.buffer = { duration: 8 };
      return n;
    }),
    Gain: mk(),
    Reverb: mk(),
    Chorus: mk(),
    FeedbackDelay: mk(),
    Distortion: mk(),
    Filter: mk(),
    Compressor: mk(),
    Sequence: vi.fn(function () {
      return { start: vi.fn(), stop: vi.fn(), dispose: vi.fn() };
    }),
    Frequency: vi.fn(() => ({ toNote: () => 'C4' })),
    now: () => 0,
    getDestination: vi.fn(() => makeNode()),
    getTransport: () => ({ bpm: { value: 120 }, start: vi.fn(), stop: vi.fn(), pause: vi.fn() }),
  };
});

vi.mock('../../../../src/api/audio/mixer.js', () => ({
  connectSurfaceStrip: vi.fn((out, name, type) => ({ input: { __strip: name }, name, type })),
  releaseStrip: vi.fn(),
}));

import { Piano, cleanupPianos } from '../../../../src/api/audio/piano.js';
import { connectSurfaceStrip, releaseStrip } from '../../../../src/api/audio/mixer.js';
import { _resetVoicesForTesting } from '../../../../src/api/audio/voice.js';
import { on } from '../../../../src/events/index.js';

let _n = 0;
function makeWmWindow(id) {
  const body = document.createElement('div');
  body.className = 'wm-body';
  const win = document.createElement('div');
  win.id = id;
  win.appendChild(body);
  document.body.appendChild(win);
  return win;
}

beforeEach(() => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
  _n = 0;
  _resetVoicesForTesting();
  window.wm = {
    spawn: vi.fn(() => {
      const id = `win-piano-${++_n}`;
      makeWmWindow(id);
      return id;
    }),
    addHistoryControls: vi.fn(),
    window: vi.fn(() => ({ onDispose: vi.fn() })),
  };
  window.desktop = { add: vi.fn(() => ({ id: 'dt-piano-1' })), updateUrl: vi.fn() };
  window.__ar_active_editor_id = null;
  vi.clearAllMocks();
});

afterEach(() => {
  cleanupPianos();
  document.querySelectorAll('[id^="win-piano-"]').forEach((el) => el.remove());
  delete window.wm;
  delete window.desktop;
});

describe('Piano per-key bindings', () => {
  it('an unbound key plays the preset synth', () => {
    const p = new Piano();
    p._triggerAttack('C4', 'kbd');
    expect(p._synth.triggerAttack).toHaveBeenCalledWith('C4', 0, 1);
  });

  it('a bound key plays its Voice instead of the preset', () => {
    const p = new Piano();
    p.bind('C4', { engine: 'am' });
    p._triggerAttack('C4', 'kbd');
    const h = p._bindings.voiceFor('C4');
    expect(h.node.triggerAttack).toHaveBeenCalled();
    expect(p._synth.triggerAttack).not.toHaveBeenCalled();
  });

  it('a bound action fires a named bus event on the key', () => {
    const p = new Piano();
    let got = null;
    on('drop').do((e) => {
      got = e;
    });
    p.bindAction('E4', 'drop');
    p._triggerAttack('E4', 'kbd');
    expect(got).toMatchObject({ note: 'E4' });
  });

  it('a silent action suppresses the preset but fires the event', () => {
    const p = new Piano();
    let fired = false;
    on('q').do(() => {
      fired = true;
    });
    p.bindAction('G4', 'q', { silent: true });
    p._triggerAttack('G4', 'kbd');
    expect(p._synth.triggerAttack).not.toHaveBeenCalled();
    expect(fired).toBe(true);
  });

  it('default voice replaces the preset across all keys', () => {
    const p = new Piano();
    p.voice({ engine: 'mono' });
    p._triggerAttack('C4', 'kbd');
    expect(p._defaultHandle.node.triggerAttack).toHaveBeenCalled();
    expect(p._synth.triggerAttack).not.toHaveBeenCalled();
  });

  it('unbind reverts a key to the preset', () => {
    const p = new Piano();
    p.bind('C4', { engine: 'fm' });
    p.unbind('C4');
    p._triggerAttack('C4', 'kbd');
    expect(p._synth.triggerAttack).toHaveBeenCalled();
  });

  it('bindings + default voice serialize and round-trip through the constructor', () => {
    const p = new Piano();
    p.bind('C4', { engine: 'am' });
    p.bindAction('D4', 'x', { silent: true });
    p.voice({ engine: 'duo' });
    const data = { bindings: p._bindings.serialize(), voice: p._defaultDesc };
    const p2 = new Piano(data);
    expect(p2._bindings.get('C4').voice.engine).toBe('am');
    expect(p2._bindings.actionFor('D4')).toEqual({ event: 'x', silent: true });
    expect(p2._defaultDesc).toEqual({ engine: 'duo' });
  });
});

describe('Piano mixer strip (ADR 032/046)', () => {
  it('acquires one window-scoped strip and routes the preset synth into the bus', () => {
    const p = new Piano({ title: 'Keys' });
    expect(connectSurfaceStrip).toHaveBeenCalledWith(p._out, 'Keys', 'piano', p._winId);
  });

  it('a bound voice routes into the surface bus (_out)', () => {
    const p = new Piano();
    p.bind('C4', { engine: 'am' });
    const h = p._bindings.voiceFor('C4');
    expect(h.output.connect).toHaveBeenCalledWith(p._out);
  });

  it('releases the strip on destroy', () => {
    const p = new Piano({ title: 'Keys2' });
    p._destroy();
    expect(releaseStrip).toHaveBeenCalledWith('Keys2');
  });
});
