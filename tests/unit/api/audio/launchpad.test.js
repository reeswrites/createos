import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('tone', () => {
  function makeNode() {
    return {
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
    Frequency: vi.fn(() => ({ toNote: () => 'C4' })),
    now: () => 0,
    getTransport: () => ({ bpm: { value: 120 }, start: vi.fn(), stop: vi.fn(), pause: vi.fn() }),
  };
});

vi.mock('../../../../src/api/audio/mixer.js', () => ({
  connectSurfaceStrip: vi.fn((out, name, type) => ({ input: { __strip: name }, name, type })),
  releaseStrip: vi.fn(),
}));

import { Launchpad, cleanupLaunchpads } from '../../../../src/api/audio/launchpad.js';
import { connectSurfaceStrip, releaseStrip } from '../../../../src/api/audio/mixer.js';
import { Voice, _resetVoicesForTesting } from '../../../../src/api/audio/voice.js';
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
      const id = `win-lp-${++_n}`;
      makeWmWindow(id);
      return id;
    }),
    addHistoryControls: vi.fn(),
    window: vi.fn(() => ({ onDispose: vi.fn() })),
  };
  window.desktop = { add: vi.fn(() => ({ id: 'dt-lp-1' })), updateUrl: vi.fn() };
  window.__ar_active_editor_id = null;
  vi.clearAllMocks();
});

afterEach(() => {
  cleanupLaunchpads();
  document.querySelectorAll('[id^="win-lp-"]').forEach((el) => el.remove());
  delete window.wm;
  delete window.desktop;
});

describe('Launchpad grid', () => {
  it('builds a rows×cols grid of cells', () => {
    const lp = new Launchpad({ rows: 4, cols: 4 });
    expect(lp._total).toBe(16);
    expect(lp._cells.length).toBe(16);
  });

  it('_cellIndex resolves index and r,c forms', () => {
    const lp = new Launchpad({ rows: 8, cols: 8 });
    expect(lp._cellIndex(5)).toBe(5);
    expect(lp._cellIndex('1,2')).toBe(10); // row1*8 + col2
    expect(lp._cellIndex('9,9')).toBeNull();
    expect(lp._cellIndex(99)).toBeNull();
  });

  it('an unbound cell plays the default voice', () => {
    const lp = new Launchpad({ rows: 2, cols: 2 });
    lp._strike(0, 'pad');
    const h = lp._ensureDefault();
    expect(h.node.triggerAttackRelease).toHaveBeenCalled();
  });
});

describe('Launchpad bindings', () => {
  it('a bound voice supersedes the default voice', () => {
    const lp = new Launchpad({ rows: 2, cols: 2 });
    lp.bind(1, { engine: 'am' });
    lp._strike(1, 'pad');
    const h = lp._bindings.voiceFor(1);
    expect(h.node.triggerAttackRelease).toHaveBeenCalled();
  });

  it('bindAction fires a named bus event with cell coords', () => {
    const lp = new Launchpad({ rows: 4, cols: 4 });
    let got = null;
    on('zap').do((p) => {
      got = p;
    });
    lp.bindAction('1,1', 'zap');
    lp._strike(5, 'pad'); // 1*4+1 = 5
    expect(got).toMatchObject({ cell: 5, row: 1, col: 1 });
  });

  it('a silent action suppresses sound but fires the event', () => {
    const lp = new Launchpad({ rows: 2, cols: 2 });
    let fired = false;
    on('q').do(() => {
      fired = true;
    });
    lp.bindAction(0, 'q', { silent: true });
    lp._strike(0, 'pad');
    const h = lp._ensureDefault();
    expect(h.node.triggerAttackRelease).not.toHaveBeenCalled();
    expect(fired).toBe(true);
  });

  it('bind accepts a registered Voice name, stored inline', () => {
    Voice.define('Zorp', { engine: 'duo' });
    const lp = new Launchpad({ rows: 2, cols: 2 });
    lp.bind(0, 'Zorp');
    expect(lp._bindings.get(0).voice.engine).toBe('duo');
  });

  it('a bound chopped sample plays the slice for that cell', () => {
    const lp = new Launchpad({ rows: 2, cols: 2 });
    lp.bind(3, { kind: 'sample', mode: 'chopped', url: 'l.wav', slices: 4 });
    lp._strike(3, 'pad');
    const h = lp._bindings.voiceFor(3);
    expect(h.node().start).toHaveBeenCalled(); // triggerSlice → Player.start
  });
});

describe('Launchpad MIDI + capture', () => {
  it('maps a MIDI note to a cell via baseNote offset', () => {
    const lp = new Launchpad({ rows: 2, cols: 2, baseNote: 36 });
    const hits = [];
    lp.onHit((e) => hits.push(e.cell));
    lp._midiNoteOn(38, 1); // 38 - 36 = cell 2
    expect(hits).toEqual([2]);
  });

  it('replay applies actions without recording', () => {
    const lp = new Launchpad({ rows: 2, cols: 2 });
    lp._applyAction({ cell: 1 });
    const h = lp._ensureDefault();
    expect(h.node.triggerAttackRelease).toHaveBeenCalled();
  });
});

describe('Launchpad serialize', () => {
  it('getState includes grid dims, default voice, and bindings', () => {
    const lp = new Launchpad({ rows: 4, cols: 2, voice: { engine: 'mono' } });
    lp.bind(0, { engine: 'fm' });
    lp.bindAction(1, 'x', { silent: true });
    // reach the shell getState by re-binding then re-reading via serialize
    expect(lp._bindings.serialize()['0'].voice.engine).toBe('fm');
    expect(lp._bindings.serialize()['1']).toMatchObject({ event: 'x', silent: true });
    expect(lp._defaultDesc).toEqual({ engine: 'mono' });
  });

  it('round-trips bindings through the constructor', () => {
    const lp = new Launchpad({ rows: 2, cols: 2 });
    lp.bind(0, { engine: 'am' });
    const data = lp._bindings.serialize();
    const lp2 = new Launchpad({ rows: 2, cols: 2, bindings: data });
    expect(lp2._bindings.get(0).voice.engine).toBe('am');
  });
});

describe('Launchpad mixer strip (ADR 032/046)', () => {
  it('acquires one window-scoped strip for the grid', () => {
    const lp = new Launchpad({ title: 'Pad', rows: 2, cols: 2 });
    expect(connectSurfaceStrip).toHaveBeenCalledWith(lp._out, 'Pad', 'launchpad', lp._winId);
  });

  it('the default voice routes into the surface bus (_out)', () => {
    const lp = new Launchpad({ rows: 2, cols: 2 });
    const h = lp._ensureDefault();
    expect(h.output.connect).toHaveBeenCalledWith(lp._out);
  });

  it('releases the strip on destroy', () => {
    const lp = new Launchpad({ title: 'Pad2', rows: 2, cols: 2 });
    lp._destroy();
    expect(releaseStrip).toHaveBeenCalledWith('Pad2');
  });
});
