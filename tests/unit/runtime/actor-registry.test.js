import { describe, it, expect, vi } from 'vitest';

// ── Minimal event bus stub ────────────────────────────────────────────────────

const _subscribers = new Map();
const _commands = new Map();

vi.stubGlobal('__ar_notify', (event, data) => {
  (_subscribers.get(event) ?? []).forEach((fn) => fn(data));
});

vi.mock('../../../src/events/index.js', () => ({
  notify: (event, data) => {
    (_subscribers.get(event) ?? []).forEach((fn) => fn(data));
  },
  registerCommand: (event, fn) => {
    _commands.set(event, fn);
  },
  registerSource: vi.fn(),
  emit: (event, data) => {
    if (_commands.has(event)) {
      _commands.get(event)(data ?? {});
      return;
    }
    (_subscribers.get(event) ?? []).forEach((fn) => fn(data));
  },
  on: (event) => ({
    do: (fn) => {
      if (!_subscribers.has(event)) _subscribers.set(event, []);
      _subscribers.get(event).push(fn);
      return { do: vi.fn() };
    },
  }),
  any: vi.fn(),
  hold: vi.fn(),
  clearRunScoped: vi.fn(),
  addBusTap: () => () => {},
}));

// ── Tone.js stub ─────────────────────────────────────────────────────────────

vi.mock('tone', () => {
  class FakeLoop {
    constructor(fn) {
      this._fn = fn;
    }
    start() {
      return this;
    }
    stop() {
      return this;
    }
    dispose() {}
  }
  return {
    Loop: FakeLoop,
    Time: (_t) => ({ toSeconds: () => 1 }),
    getTransport: () => ({
      bpm: { value: 120 },
      stop: vi.fn(),
      cancel: vi.fn(),
      scheduleRepeat: vi.fn(),
    }),
    getDestination: () => ({ volume: { rampTo: vi.fn() } }),
    now: () => 0,
    start: vi.fn(),
    Frequency: vi.fn(),
    NoiseSynth: class {},
    MetalSynth: class {},
    Analyser: class {
      getValue() {
        return [];
      }
      frequencyBinCount = 0;
    },
    Player: class {
      constructor() {
        this.loaded = Promise.resolve();
      }
      toDestination() {}
      disconnect() {}
      chain() {}
      start() {}
      stop() {}
      volume = { value: 0 };
    },
  };
});

vi.mock('../../../src/runtime/reset-registry.js', () => ({ onReset: vi.fn() }));
vi.mock('../../../src/events/system-events.js', () => ({}));
vi.mock(
  './viz.js',
  () => ({
    AudioViz: class {},
    SpectrogramCanvas: class {},
    PianoRollViz: class {},
    _noteHooks: [],
  }),
  { virtual: true },
);
vi.mock('../../../src/api/visual/viz.js', () => ({
  AudioViz: class {},
  SpectrogramCanvas: class {},
  PianoRollViz: class {},
  _noteHooks: [],
}));
vi.mock('../../../src/api/audio/mixer.js', () => ({
  acquireStrip: () => ({ input: {}, name: 'x', _autoNamed: true }),
  renameStrip: () => {},
  mixer: {},
  cleanupMixer: () => {},
  serializeMixer: () => ({}),
  restoreMixer: () => {},
}));
vi.mock('../../../src/api/audio/drumpad.js', () => ({ Drumpad: class {} }));

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Pipeline actor registry', async () => {
  // Pipeline requires DOM — skip heavy DOM tests, focus on id/registry logic
  it('pipe() assigns auto id', async () => {
    // Stub DOM minimally
    const { pipe } = await import('../../../src/api/visual/render-pipeline.js');
    const p = pipe(document.createElement('canvas'));
    expect(p._id).toMatch(/^pipe-/);
  });

  it('show() opts.id overrides pipeline id', async () => {
    const { pipe } = await import('../../../src/api/visual/render-pipeline.js');
    const p = pipe(document.createElement('canvas'));
    const origId = p._id;
    // Patch wm to avoid DOM spawn
    const origWm = window.wm;
    window.wm = { spawn: () => null };
    p.show('Test', { id: 'my-viz' });
    window.wm = origWm;
    expect(p._id).toBe('my-viz');
    expect(origId).not.toBe('my-viz');
  });

  it('stage gets auto id based on pipeline id', async () => {
    const { pipe } = await import('../../../src/api/visual/render-pipeline.js');
    const p = pipe(document.createElement('canvas'));
    p.ascii({});
    const stage = p._stages[0];
    expect(stage._id).toBe(`${p._id}-ascii-0`);
  });

  it('stage gets caller-supplied id', async () => {
    const { pipe } = await import('../../../src/api/visual/render-pipeline.js');
    const p = pipe(document.createElement('canvas'));
    p.ascii({}, 'my-chars');
    expect(p._stages[0]._id).toBe('my-chars');
  });

  it('pipe:stop command calls stop()', async () => {
    const { pipe } = await import('../../../src/api/visual/render-pipeline.js');
    const p = pipe(document.createElement('canvas'));
    p.start({ id: 'test-pipe' });
    const spy = vi.spyOn(p, 'stop');
    _commands.get('pipe:stop')({ id: 'test-pipe' });
    expect(spy).toHaveBeenCalled();
  });

  it('pipe:stage:set calls stage.set()', async () => {
    const { pipe } = await import('../../../src/api/visual/render-pipeline.js');
    const p = pipe(document.createElement('canvas'));
    p.ascii({}, 'chars');
    const stage = p._stages[0];
    const spy = vi.spyOn(stage, 'set');
    _commands.get('pipe:stage:set')({ stageId: 'chars', color: '#ff0066' });
    expect(spy).toHaveBeenCalledWith({ color: '#ff0066' });
  });
});
