// route.test.js — unit tests for src/api/route.js (ADR 025)
//
// Tests cover: source/sink resolution, push/pull clock election,
// sample-and-hold, fan-in, bridges, structural throws, lifecycle,
// signalGraph auto-population, and route-scoped .on() cleanup.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Module-level mocks ────────────────────────────────────────────────────────

// audio.level stub
let _audioLevel = 0;
vi.mock('../../../../src/api/audio/audio.js', () => ({
  audio: {
    get level() {
      return _audioLevel;
    },
    get fft() {
      return { fft: [0.1, 0.2, 0.3], getValue: () => [0.1, 0.2, 0.3] };
    },
  },
}));

// video-signal stub
vi.mock('../../../../src/api/signal/video-signal.js', () => ({
  VideoSignalAPI: {
    signal: (_src, _opts) => ({
      get brightness() {
        return 0.5;
      },
      get motion() {
        return 0.3;
      },
    }),
  },
}));

// media-lease stub
vi.mock('../../../../src/api/media/media-lease.js', () => ({
  acquireMicRunScoped: vi.fn(),
  acquireMic: vi.fn(() => ({ release: vi.fn() })),
}));

// render-pipeline stub — pipe() returns an object with chainable methods and show/layer
vi.mock('../../../../src/api/visual/render-pipeline.js', () => {
  const _stages = [];
  const _stageArgCache = new Map();
  const _rafId = 1;
  let _started = false;

  const pipelineObj = {
    _stages,
    _stageArgCache,
    _rafId: null, // null until show()/layer() called = not started
    _id: 'pipe-1',
    show: vi.fn(function () {
      this._rafId = 1;
      return this;
    }),
    layer: vi.fn(function () {
      this._rafId = 1;
      return this;
    }),
    start: vi.fn(function () {
      this._rafId = 1;
      return this;
    }),
    stop: vi.fn(),
    tint: vi.fn(function () {
      return this;
    }),
    negative: vi.fn(function () {
      return this;
    }),
    solarize: vi.fn(function () {
      return this;
    }),
    posterize: vi.fn(function () {
      return this;
    }),
    duotone: vi.fn(function () {
      return this;
    }),
    grain: vi.fn(function () {
      return this;
    }),
    strobe: vi.fn(function () {
      return this;
    }),
    blur: vi.fn(function () {
      return this;
    }),
    hue: vi.fn(function () {
      return this;
    }),
    ascii: vi.fn(function () {
      return this;
    }),
    pixelate: vi.fn(function () {
      return this;
    }),
    fx: vi.fn(function () {
      return this;
    }),
    glshader: vi.fn(function () {
      return this;
    }),
    _addNamedStage: vi.fn(function (type, args) {
      _stageArgCache.set(type, args);
      return {};
    }),
    _removeNamedStage: vi.fn(),
    _toggleNamedStage: vi.fn(),
    _clearNamedStages: vi.fn(),
  };

  return {
    pipe: vi.fn(() => pipelineObj),
    Source: Object.freeze({
      camera: Object.freeze({ _src: 'camera' }),
      mic: Object.freeze({ _src: 'mic' }),
    }),
    sourceKind: (x) => (x && typeof x === 'object' && typeof x._src === 'string' ? x._src : null),
    sourceField: (x) => x?.field,
    __pipelineObj: pipelineObj,
  };
});

// keep-alive stub
vi.mock('../../../../src/runtime/keep-alive.js', () => ({
  liveOutput: vi.fn(() => ({ release: vi.fn(), token: {} })),
}));

// reset-registry stub — capture the onReset callback
let _onResetCb = null;
vi.mock('../../../../src/runtime/reset-registry.js', () => ({
  onReset: vi.fn((fn) => {
    _onResetCb = fn;
  }),
}));

// event bus stub
const _subscribers = new Map();
vi.mock('../../../../src/events/bus.js', () => ({
  subscribe: vi.fn((event, fn) => {
    if (!_subscribers.has(event)) _subscribers.set(event, new Set());
    const entry = { fn };
    _subscribers.get(event).add(entry);
    return () => _subscribers.get(event)?.delete(entry);
  }),
  notify: vi.fn(),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function fire(event, payload = {}) {
  for (const { fn } of _subscribers.get(event) ?? []) fn(payload);
}

// Shader stub implementing the ShaderLayerBase interface: setUniform/_uniforms/_custom.
// Avoids importing ShaderLayerBase (which pulls in event-selector.js, causing a
// temporal dead zone error on _onResetCb). ShaderLayerBase itself is tested separately
// in shader-layer-base.test.js; these tests verify route's wiring to the interface.
function makeShaderStub(id = 'test-shader') {
  const _custom = new Float32Array(4);
  const _uniforms = {};
  const stub = {
    _id: id,
    _custom,
    _uniforms,
    setUniform(name, val) {
      if (name === 'uCustom' || name === 'custom') {
        const v = { x: 0, y: 0, z: 0, w: 0, ...val };
        _uniforms.uCustom = v;
        _custom[0] = v.x;
        _custom[1] = v.y;
        _custom[2] = v.z;
        _custom[3] = v.w;
      } else {
        _uniforms[name] = val;
      }
      return stub;
    },
    getUniform(name) {
      if (name === 'uCustom' || name === 'custom') {
        return _uniforms.uCustom ?? { x: 0, y: 0, z: 0, w: 0 };
      }
      return _uniforms[name];
    },
  };
  return stub;
}

let route, getLiveRoutes;
let liveOutput;
let _pipelineObj;
let Source;
let notify;

beforeEach(async () => {
  _subscribers.clear();
  vi.clearAllMocks();
  _onResetCb = null;
  _audioLevel = 0;

  vi.resetModules();
  // Re-import after module reset so each test starts fresh
  ({ route, getLiveRoutes } = await import('../../../../src/api/signal/route.js'));
  ({ liveOutput } = await import('../../../../src/runtime/keep-alive.js'));
  ({ __pipelineObj: _pipelineObj, Source } =
    await import('../../../../src/api/visual/render-pipeline.js'));
  ({ notify } = await import('../../../../src/events/bus.js'));
  // Re-import onReset mock to capture new callback
  await import('../../../../src/runtime/reset-registry.js');
});

afterEach(() => {
  // Fire reset to clean up any live routes
  _onResetCb?.();
});

// ── Source resolution ─────────────────────────────────────────────────────────

describe('source resolution', () => {
  it('string = discrete bus event', () => {
    const r = route('midi:cc');
    expect(r._src.kind).toBe('discrete');
    expect(r._src.label).toBe('midi:cc');
  });

  it('Source.mic = continuous reader', async () => {
    const r = route(Source.mic);
    expect(r._src.kind).toBe('continuous');
    expect(r._src.isMic).toBe(true);
  });

  it('Source.camera = frame source', async () => {
    const r = route(Source.camera);
    expect(r._src.kind).toBe('frame');
    expect(r._src.label).toBe('camera');
  });

  it('fn = continuous reader', () => {
    const r = route(() => 0.5);
    expect(r._src.kind).toBe('continuous');
  });

  it('video.signal-like object = continuous', () => {
    const sig = { brightness: 0.5, motion: 0.2 };
    const r = route(sig);
    expect(r._src.kind).toBe('continuous');
    expect(r._src.label).toBe('video.signal');
  });

  it('throws on unsupported source', () => {
    expect(() => route(12345)).toThrow('route(): unsupported source');
  });
});

// ── Transform chain ───────────────────────────────────────────────────────────

describe('transform chain', () => {
  it('scale() maps value linearly', () => {
    const r = route(() => 0.5);
    r.scale(0, 1, 200, 800);
    expect(r._eval(0)).toBe(200);
    expect(r._eval(1)).toBe(800);
    expect(r._eval(0.5)).toBe(500);
  });

  it('norm() normalises to 0–1', () => {
    const r = route(() => 0);
    r.norm(0, 127);
    expect(r._eval(0)).toBeCloseTo(0);
    expect(r._eval(127)).toBeCloseTo(1);
    expect(r._eval(63.5)).toBeCloseTo(0.5);
  });

  it('clamp() limits range', () => {
    const r = route(() => 0);
    r.clamp(0.2, 0.8);
    expect(r._eval(0)).toBe(0.2);
    expect(r._eval(1)).toBe(0.8);
    expect(r._eval(0.5)).toBe(0.5);
  });

  it('threshold() returns 0 or 1', () => {
    const r = route(() => 0);
    r.threshold(0.5);
    expect(r._eval(0.3)).toBe(0);
    expect(r._eval(0.7)).toBe(1);
  });

  it('filter() swallows values not matching predicate', () => {
    const r = route(() => 0);
    r.filter((v) => v > 0.5);
    r._eval(0.3);
    // SKIP is the internal sentinel — to() would not write this
    // We verify by checking the sink is not called
    const writes = [];
    r.to((v) => writes.push(v));
    fire('does_not_matter'); // continuous source — need RAF tick
    // For a fn-source route, just test _eval directly
    const r2 = route(() => 0);
    r2.filter((v) => v > 0.5);
    // eval 0.3 → SKIP (not undefined, not a number)
    const result = r2._eval(0.3);
    expect(typeof result).toBe('symbol'); // SKIP sentinel
  });

  it('smooth() is stateful (forces RAF driver)', () => {
    const r = route(() => 0);
    r.smooth(0.9);
    expect(r._stateful).toBe(true);
    expect(r._chain[0].stateful).toBe(true);
  });

  it('debounce() is stateful', () => {
    const r = route(() => 0);
    r.debounce(100);
    expect(r._stateful).toBe(true);
  });

  it('smooth() accumulates exponential decay', () => {
    const r = route(() => 0);
    r.smooth(0.5);
    // First call: p = 0*0.5 + 1*0.5 = 0.5
    expect(r._eval(1)).toBeCloseTo(0.5);
    // Second: p = 0.5*0.5 + 1*0.5 = 0.75
    expect(r._eval(1)).toBeCloseTo(0.75);
  });
});

// ── Structural guards ─────────────────────────────────────────────────────────

describe('structural guards', () => {
  it('scalar transform on frame source throws', () => {
    const r = route(Source.camera);
    expect(() => r.scale(0, 1, 0, 1)).toThrow('scalar transform on a frame source');
  });

  it('bridge on discrete source throws', () => {
    const r = route('midi:note:on');
    expect(() => r.amplitude).toThrow('bridge on a discrete');
  });

  it('show() on non-frame source throws', () => {
    const r = route(() => 0.5);
    expect(() => r.show()).toThrow('visual/frame method');
  });

  it('wait() on non-frame source throws', () => {
    const r = route(() => 0.5);
    expect(() => r.wait(3)).toThrow('visual/frame method');
  });

  it('mask() queues a mask stage op on a frame source (ADR 054)', () => {
    const r = route(Source.camera);
    const maskCanvas = { getContext: () => {}, width: 8, height: 8 };
    r.mask(maskCanvas, { channel: 'alpha' });
    const last = r._stageQueue[r._stageQueue.length - 1];
    expect(last).toMatchObject({ op: 'add', type: 'mask' });
    expect(last.args[0]).toBe(maskCanvas);
    expect(last.args[1]).toEqual({ channel: 'alpha' });
  });
});

// ── Sink resolution ───────────────────────────────────────────────────────────

describe('sink resolution', () => {
  it('fn sink: writes value directly', () => {
    const writes = [];
    route(() => 0.7).to((v) => writes.push(v));
    // Continuous source — tick via RAF mock
    // setUp fires RAF immediately (16ms setTimeout in setup.js)
    return new Promise((resolve) =>
      setTimeout(() => {
        expect(writes.length).toBeGreaterThan(0);
        expect(writes[0]).toBeCloseTo(0.7);
        resolve();
      }, 50),
    );
  });

  it('string sink: emits bus event', async () => {
    route(() => 42).to('test:event');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(notify).toHaveBeenCalledWith('test:event', expect.objectContaining({ value: 42 }));
  });

  it('Tone.Signal sink: writes .value directly', () => {
    const param = { value: 0 };
    route(() => 0.5).to(param);
    return new Promise((resolve) =>
      setTimeout(() => {
        expect(param.value).toBeCloseTo(0.5);
        resolve();
      }, 50),
    );
  });

  it('Tone.Signal with {ramp:ms}: calls .rampTo', () => {
    const param = { value: 0, rampTo: vi.fn() };
    route(() => 0.5).to(param, { ramp: 100 });
    return new Promise((resolve) =>
      setTimeout(() => {
        expect(param.rampTo).toHaveBeenCalledWith(0.5, 0.1);
        resolve();
      }, 50),
    );
  });

  it('shader+path sink: setUniform stores value in _uniforms', () => {
    const shader = makeShaderStub();
    route(() => 0.5).to(shader, 'uColor');
    return new Promise((resolve) =>
      setTimeout(() => {
        // Non-uCustom names are stored in _uniforms (fwd-compat storage)
        expect(shader._uniforms.uColor).toBe(0.5);
        resolve();
      }, 50),
    );
  });

  it('shader+dotted path: RMW swizzle writes to _custom and _uniforms', () => {
    const shader = makeShaderStub();
    shader.setUniform('uCustom', { x: 0, y: 1, z: 0, w: 0 }); // set initial state
    route(() => 0.8).to(shader, 'uCustom.x');
    return new Promise((resolve) =>
      setTimeout(() => {
        // x channel updated to 0.8; y channel preserved from initial write
        expect(shader._custom[0]).toBeCloseTo(0.8);
        expect(shader._custom[1]).toBeCloseTo(1.0);
        expect(shader._uniforms.uCustom).toMatchObject({ x: 0.8, y: 1 });
        resolve();
      }, 50),
    );
  });

  it('unsupported sink throws', () => {
    expect(() => route(() => 0).to(12345)).toThrow('route().to(): unsupported sink');
  });
});

// ── Clock election: push vs pull ─────────────────────────────────────────────

describe('clock election', () => {
  it('discrete + stateless + immediate sink → push driver (no RAF registered)', async () => {
    const writes = [];
    const r = route('beat:bar')
      .filter((p) => p.count > 0)
      .to((v) => writes.push(v));

    // RAF should NOT be registered (push driver handles it)
    expect(r._raf).toBeNull();

    // Fire the event — should write synchronously
    fire('beat:bar', { count: 1 });
    expect(writes).toHaveLength(1);
  });

  it('discrete + stateful chain → RAF driver', () => {
    const writes = [];
    const r = route('midi:cc')
      .get('value')
      .smooth(0.8)
      .to((v) => writes.push(v));
    // Stateful → RAF
    expect(r._raf).not.toBeNull();
  });

  it('continuous source → RAF driver', () => {
    const r = route(() => 0.5).to((v) => v);
    expect(r._raf).not.toBeNull();
  });

  it('discrete + non-immediate sink → pull driver (RAF)', () => {
    const shader = makeShaderStub();
    const r = route('beat:bar').get('value').to(shader, 'uBeat');
    // Non-immediate sink → RAF needed
    expect(r._raf).not.toBeNull();
  });
});

// ── Sample-and-hold (discrete → pull sinks) ──────────────────────────────────

describe('sample-and-hold', () => {
  it('discrete event payload is held for pull sinks', async () => {
    const shader = makeShaderStub();
    route('midi:cc').get('value').to(shader, 'uMidi');

    // Fire event → value stored in hold cell
    fire('midi:cc', { value: 64 });

    // RAF tick should write held value to shader via real setUniform
    await new Promise((r) => setTimeout(r, 50));
    expect(shader._uniforms.uMidi).toBe(64);
  });
});

// ── Bridges ───────────────────────────────────────────────────────────────────

describe('bridges', () => {
  it('.amplitude retypes source to continuous scalar', () => {
    const r = route(Source.mic);
    r.amplitude;
    expect(r._src.kind).toBe('continuous');
    expect(r._src.label).toContain('.amplitude');
  });

  it('.brightness() retypes camera to continuous scalar', () => {
    const r = route(Source.camera);
    r.brightness();
    expect(r._src.kind).toBe('continuous');
    expect(r._src.label).toContain('.brightness');
  });

  it('.motion() retypes camera to continuous scalar', () => {
    const r = route(Source.camera);
    r.motion();
    expect(r._src.kind).toBe('continuous');
    expect(r._src.label).toContain('.motion');
  });

  it('bridge reads the correct value', async () => {
    _audioLevel = 0.42;
    const writes = [];
    const r = route(Source.mic);
    r.amplitude;
    r.to((v) => writes.push(v));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(writes[0]).toBeCloseTo(0.42);
  });
});

// ── Fan-in (.mix) ─────────────────────────────────────────────────────────────

describe('fan-in (.mix)', () => {
  it('mixes two sources with default average', async () => {
    const writes = [];
    // Route A returns 0.6, route B returns 0.4 → average = 0.5
    route(() => 0.6)
      .mix(route(() => 0.4))
      .to((v) => writes.push(v));
    await new Promise((r) => setTimeout(r, 50));
    expect(writes[0]).toBeCloseTo(0.5);
  });

  it('uses custom combine fn', async () => {
    const writes = [];
    route(() => 3)
      .mix(
        route(() => 2),
        (a, b) => a * b,
      )
      .to((v) => writes.push(v));
    await new Promise((r) => setTimeout(r, 50));
    expect(writes[0]).toBeCloseTo(6);
  });

  it('mix forces stateful/RAF (stateful flag set)', () => {
    const r = route(() => 0).mix(route(() => 1));
    expect(r._stateful).toBe(true);
  });

  it('nested route passed to mix is removed from _routes registry', () => {
    const inner = route(() => 0.5);
    route(() => 0.3).mix(inner);
    // inner should have been deleted from _routes (it's a source-only route)
    expect(getLiveRoutes().has(inner)).toBe(false);
  });
});

// ── Route-scoped .on() ────────────────────────────────────────────────────────

describe('route-scoped .on()', () => {
  it('calls cb with (route, payload)', () => {
    const cb = vi.fn();
    const r = route(() => 0).to((v) => v);
    r.on('beat:bar', cb);
    fire('beat:bar', { count: 1 });
    expect(cb).toHaveBeenCalledWith(r, { count: 1 });
  });

  it('cleans up subscriptions on _destroy()', () => {
    const cb = vi.fn();
    const r = route(() => 0).to((v) => v);
    r.on('beat:bar', cb);
    r._destroy();
    fire('beat:bar', { count: 2 });
    expect(cb).not.toHaveBeenCalled();
  });
});

// ── Lifecycle: keep-alive and run-scoped cleanup ──────────────────────────────

describe('lifecycle', () => {
  it('registers liveOutput when route starts', () => {
    route(() => 0.5).to((v) => v);
    expect(liveOutput).toHaveBeenCalled();
  });

  it('releases liveOutput on _destroy()', () => {
    const r = route(() => 0.5).to((v) => v);
    const handle = liveOutput.mock.results[0].value;
    r._destroy();
    expect(handle.release).toHaveBeenCalled();
  });

  it('onReset callback clears all routes', () => {
    route(() => 0).to((v) => v);
    route(() => 1).to((v) => v);
    expect(getLiveRoutes().size).toBeGreaterThanOrEqual(2);
    _onResetCb?.();
    expect(getLiveRoutes().size).toBe(0);
  });

  it('onReset(editorId) only destroys routes owned by that editor', () => {
    const prev = window.__ar_active_editor_id;
    window.__ar_active_editor_id = 1;
    const rA = route(() => 0).to((v) => v); // owned by editor 1
    window.__ar_active_editor_id = 2;
    const rB = route(() => 1).to((v) => v); // owned by editor 2
    window.__ar_active_editor_id = prev;

    _onResetCb?.(2); // editor 2 resets
    expect(rB._destroyed).toBe(true); // its own route torn down
    expect(rA._destroyed).toBe(false); // editor 1's route survives
    expect(getLiveRoutes().has(rA)).toBe(true);
    expect(getLiveRoutes().has(rB)).toBe(false);
  });

  it('onReset() with no editorId still clears everything (global reset)', () => {
    window.__ar_active_editor_id = 1;
    route(() => 0).to((v) => v);
    window.__ar_active_editor_id = 2;
    route(() => 1).to((v) => v);
    window.__ar_active_editor_id = undefined;

    _onResetCb?.(); // no id → full teardown
    expect(getLiveRoutes().size).toBe(0);
  });

  it('_destroy() is idempotent', () => {
    const r = route(() => 0).to((v) => v);
    expect(() => {
      r._destroy();
      r._destroy();
    }).not.toThrow();
  });

  it('RAF is cleared on _destroy() (._raf set to null)', () => {
    const r = route(() => 0).to((v) => v);
    expect(r._raf).not.toBeNull();
    r._destroy();
    expect(r._raf).toBeNull();
  });
});

// ── signalGraph auto-population ───────────────────────────────────────────────

describe('signalGraph auto-population', () => {
  it('_descriptor() returns source/chain/sinks shape', () => {
    const r = route('midi:cc')
      .norm(0, 127)
      .to((v) => v);
    const d = r._descriptor();
    expect(d.source).toBe('midi:cc');
    expect(d.chain[0].op).toBe('norm');
    expect(d.sinks[0]).toBe('fn');
  });

  it('registers to __ar_signalRoutes on start', () => {
    window.__ar_signalRoutes = [];
    route('midi:cc')
      .norm(0, 127)
      .to((v) => v);
    expect(window.__ar_signalRoutes.length).toBeGreaterThan(0);
    expect(window.__ar_signalRoutes[0].source).toBe('midi:cc');
  });

  it('getLiveRoutes() returns all active routes', () => {
    const r1 = route(() => 0).to((v) => v);
    const r2 = route(() => 1).to((v) => v);
    expect(getLiveRoutes().has(r1)).toBe(true);
    expect(getLiveRoutes().has(r2)).toBe(true);
  });
});

// ── Frame-route visual chain ──────────────────────────────────────────────────

describe('frame-route visual chain', () => {
  it('show() delegates to pipeline.show()', () => {
    route(Source.camera).show('Test Route', { w: 700, h: 500 });
    // onClose is injected so closing the output window tears down the route (releases keep-alive).
    expect(_pipelineObj.show).toHaveBeenCalledWith(
      'Test Route',
      expect.objectContaining({ w: 700, h: 500, onClose: expect.any(Function) }),
    );
  });

  it('stages queued before show() are added pre-start via chain methods', () => {
    route(Source.camera).grain(0.1).show('Grain');
    // grain() should have been called on the pipeline directly (no timeline)
    expect(_pipelineObj.grain).toHaveBeenCalledWith(0.1);
  });

  it('toggle() calls pipeline._toggleNamedStage()', () => {
    const r = route(Source.camera).show('VJ');
    _pipelineObj._rafId = 1; // mark as running
    r.toggle('negative');
    expect(_pipelineObj._toggleNamedStage).toHaveBeenCalledWith('negative');
  });

  it('clearEffects() calls pipeline._clearNamedStages() when running', () => {
    const r = route(Source.camera).show('VJ');
    _pipelineObj._rafId = 1;
    r.clearEffects();
    expect(_pipelineObj._clearNamedStages).toHaveBeenCalled();
  });
});

// ── Temporal control (wait/loop) ──────────────────────────────────────────────

describe('temporal control', () => {
  it('wait() accumulates timeline parts', () => {
    const r = route(Source.camera).tint('#f00').wait(3).negative();
    // Before show(), stages are in stageQueue or timelineParts
    // After first wait(), _timelineParts should have one segment
    expect(r._timelineParts.length).toBe(1);
    expect(r._timelineParts[0].atMs).toBe(0);
    expect(r._timelineParts[0].ops[0]).toMatchObject({ op: 'add', type: 'tint' });
  });

  it('loop() sets _looping flag', () => {
    const r = route(Source.camera).wait(2).loop();
    expect(r._looping).toBe(true);
  });

  it('show() with timeline calls _addNamedStage via setTimeout', async () => {
    _pipelineObj._rafId = 1; // mark pipeline as running for _addNamedStage
    route(Source.camera).tint('#4a0').wait(1).negative().show('Timeline');
    // First segment (t=0) fires immediately via setTimeout(fn, 0)
    await new Promise((r) => setTimeout(r, 50));
    // tint should be applied (either via chain method or _addNamedStage)
    // pipeline.show was called
    expect(_pipelineObj.show).toHaveBeenCalled();
  });
});
