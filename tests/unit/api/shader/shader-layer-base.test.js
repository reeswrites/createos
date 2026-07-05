// shader-layer-base.test.js — unit tests for src/api/shader-layer-base.js
//
// Tests drive the base through a minimal stub subclass so the non-GPU half is
// exercised without WebGPU or WebGL. Covers: setUniform/_uniforms/_custom,
// bind/audio-pack, video resolve, opacity/z, liveness helpers.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../../../../src/runtime/keep-alive.js', () => ({
  liveOutput: vi.fn(() => ({
    release: vi.fn(),
    token: {},
  })),
}));

vi.mock('../../../../src/runtime/reset-registry.js', () => ({
  onReset: vi.fn(),
}));

vi.mock('../../../../src/events/bus.js', () => ({
  notify:            vi.fn(),
  subscribe:         vi.fn(() => () => {}),
  registerCommand:   vi.fn(),
  clearRunScoped:    vi.fn(),
  registerSource:    vi.fn(),
  getLastPayload:    vi.fn(),
  addBusTap:        vi.fn(),
}));

// ── Test stub ─────────────────────────────────────────────────────────────────

import { ShaderLayerBase } from '../../../../src/api/shader/shader-layer-base.js';
import { liveOutput } from '../../../../src/runtime/keep-alive.js';

class StubShader extends ShaderLayerBase {
  constructor(opts = {}) {
    super();
    this._initBase(opts);
    this._id = opts.id ?? 'stub-shader';
  }
}

function make(opts = {}) {
  return new StubShader(opts);
}

// ── setUniform / _uniforms / _custom ─────────────────────────────────────────

describe('setUniform', () => {
  it('uCustom writes {x,y,z,w} into _custom[0..3]', () => {
    const s = make();
    s.setUniform('uCustom', { x: 0.1, y: 0.2, z: 0.3, w: 0.4 });
    expect(s._custom[0]).toBeCloseTo(0.1);
    expect(s._custom[1]).toBeCloseTo(0.2);
    expect(s._custom[2]).toBeCloseTo(0.3);
    expect(s._custom[3]).toBeCloseTo(0.4);
  });

  it('uCustom stores {x,y,z,w} in _uniforms for route RMW reads', () => {
    const s = make();
    s.setUniform('uCustom', { x: 0.5, y: 1, z: 0, w: 0 });
    expect(s._uniforms.uCustom).toMatchObject({ x: 0.5, y: 1, z: 0, w: 0 });
  });

  it('"custom" alias behaves identically to "uCustom"', () => {
    const s = make();
    s.setUniform('custom', { x: 0.7 });
    expect(s._custom[0]).toBeCloseTo(0.7);
    expect(s._uniforms.uCustom).toMatchObject({ x: 0.7 });
  });

  it('uCustom defaults missing components to 0', () => {
    const s = make();
    s.setUniform('uCustom', { y: 0.9 }); // x/z/w omitted
    expect(s._custom[0]).toBe(0);
    expect(s._custom[1]).toBeCloseTo(0.9);
    expect(s._custom[2]).toBe(0);
    expect(s._custom[3]).toBe(0);
  });

  it('route RMW swizzle: read existing _uniforms.uCustom then write one component', () => {
    const s = make();
    s.setUniform('uCustom', { x: 0, y: 1, z: 0, w: 0 }); // initial state
    // Simulate what route resolveSink does for 'uCustom.x':
    const cur = s._uniforms['uCustom'] ?? { x: 0, y: 0, z: 0, w: 0 };
    s.setUniform('uCustom', { ...cur, x: 0.8 });
    expect(s._custom[0]).toBeCloseTo(0.8);
    expect(s._custom[1]).toBeCloseTo(1.0); // preserved
  });

  it('non-uCustom name is stored in _uniforms (fwd-compat)', () => {
    const s = make();
    s.setUniform('uBeat', 42);
    expect(s._uniforms.uBeat).toBe(42);
    // _custom unchanged
    expect(Array.from(s._custom)).toEqual([0, 0, 0, 0]);
  });

  it('returns this for chaining', () => {
    const s = make();
    expect(s.setUniform('uCustom', { x: 1 })).toBe(s);
  });
});

// ── set() ─────────────────────────────────────────────────────────────────────

describe('set', () => {
  it('index form sets one lane', () => {
    const s = make();
    s.set(2, 0.75);
    expect(s._custom[2]).toBeCloseTo(0.75);
  });

  it('array form sets all 4 lanes', () => {
    const s = make();
    s.set([0.1, 0.2, 0.3, 0.4]);
    expect(s._custom[0]).toBeCloseTo(0.1);
    expect(s._custom[3]).toBeCloseTo(0.4);
  });

  it('returns this', () => {
    const s = make();
    expect(s.set(0, 1)).toBe(s);
  });
});

// ── bind / _packAudioCustom ───────────────────────────────────────────────────

describe('bind + _packAudioCustom', () => {
  it('signal object (has .bass) sets _boundSignal', () => {
    const s = make();
    const sig = { bass: 0.3, value: 0.5, mid: 0.2, high: 0.1 };
    s.bind(sig);
    expect(s._boundSignal).toBe(sig);
    expect(s._boundAnalyser).toBeNull();
  });

  it('non-signal source sets _boundAnalyser', () => {
    const s = make();
    const node = { frequencyBinCount: 32, getByteFrequencyData: vi.fn() };
    s.bind(node);
    expect(s._boundAnalyser).toBe(node);
    expect(s._boundSignal).toBeNull();
  });

  it('_packAudioCustom fills _custom from signal.value/bass/mid/high', () => {
    const s = make();
    s.bind({ value: 0.9, bass: 0.1, mid: 0.5, high: 0.3 });
    s._packAudioCustom();
    expect(s._custom[0]).toBeCloseTo(0.9); // value/rms
    expect(s._custom[1]).toBeCloseTo(0.1); // bass
    expect(s._custom[2]).toBeCloseTo(0.5); // mid
    expect(s._custom[3]).toBeCloseTo(0.3); // high
  });

  it('_packAudioCustom fills _custom from analyser via readAnalyser+bands', () => {
    const s = make();
    // Tone.Analyser returning -40 dB across all bins → each band ≈ 0.5
    const tone = { getValue: () => new Float32Array(32).fill(-40) };
    s.bind(tone);
    s._packAudioCustom();
    expect(s._custom[0]).toBeCloseTo(0.5); // rms
    expect(s._custom[1]).toBeCloseTo(0.5); // bass
  });

  it('_packAudioCustom is no-op when nothing bound', () => {
    const s = make();
    s._custom.fill(0.5);
    s._packAudioCustom();
    // Should remain 0.5 (unchanged)
    expect(s._custom[0]).toBeCloseTo(0.5);
  });
});

// ── video / _resolveVideoSrc ──────────────────────────────────────────────────

describe('video + _resolveVideoSrc', () => {
  it('stores video src and resolves bare canvas via resolveDrawable', () => {
    const canvas = { getContext: () => {}, width: 100, height: 100 };
    const s = make({ videoSrc: canvas });
    const resolved = s._resolveVideoSrc();
    expect(resolved).toBe(canvas);
  });

  it('video() setter updates _videoSrc', () => {
    const s = make();
    const canvas = { getContext: () => {}, width: 1, height: 1 };
    s.video(canvas);
    expect(s._videoSrc).toBe(canvas);
  });

  it('returns null for null src', () => {
    const s = make();
    expect(s._resolveVideoSrc()).toBeNull();
  });
});

// ── mask / _resolveMaskSrc (ADR 054) ──────────────────────────────────────────

describe('mask + _resolveMaskSrc', () => {
  it('stores source + default opts (luminance, not inverted)', () => {
    const s = make();
    const canvas = { getContext: () => {}, width: 8, height: 8 };
    s.mask(canvas);
    expect(s._maskSrc).toBe(canvas);
    expect(s._maskOpts).toEqual({ channel: 'luminance', invert: false });
  });

  it('honors channel + invert opts', () => {
    const s = make();
    s.mask({ getContext: () => {}, width: 1, height: 1 }, { channel: 'alpha', invert: true });
    expect(s._maskOpts).toEqual({ channel: 'alpha', invert: true });
  });

  it('_resolveMaskSrc resolves a bare canvas via resolveDrawable', () => {
    const canvas = { getContext: () => {}, width: 4, height: 4 };
    const s = make();
    s.mask(canvas);
    expect(s._resolveMaskSrc()).toBe(canvas);
  });

  it('.mask(null) clears the mask and resolver returns null', () => {
    const s = make();
    s.mask({ getContext: () => {}, width: 1, height: 1 });
    s.mask(null);
    expect(s._maskSrc).toBeNull();
    expect(s._resolveMaskSrc()).toBeNull();
  });

  it('.mask() with no arg clears', () => {
    const s = make();
    s.mask({ getContext: () => {}, width: 1, height: 1 });
    s.mask();
    expect(s._maskSrc).toBeNull();
  });

  it('returns this for chaining', () => {
    const s = make();
    expect(s.mask(null)).toBe(s);
  });

  it('_maskSrc defaults to null on a fresh instance', () => {
    expect(make()._maskSrc).toBeNull();
  });
});

// ── opacity / z / canvas getter ───────────────────────────────────────────────

describe('style setters', () => {
  it('opacity updates _opacity and canvas style if mounted', () => {
    const s = make();
    const fakeCanvas = { style: { opacity: '1' } };
    s._canvas = fakeCanvas;
    s.opacity(0.5);
    expect(s._opacity).toBe(0.5);
    expect(fakeCanvas.style.opacity).toBe('0.5');
  });

  it('z updates _z and canvas style if mounted', () => {
    const s = make();
    const fakeCanvas = { style: { zIndex: '30' } };
    s._canvas = fakeCanvas;
    s.z(50);
    expect(s._z).toBe(50);
    expect(fakeCanvas.style.zIndex).toBe('50');
  });

  it('canvas getter returns _canvas', () => {
    const s = make();
    const c = {};
    s._canvas = c;
    expect(s.canvas).toBe(c);
  });
});

// ── liveness ──────────────────────────────────────────────────────────────────

describe('_registerLive / _releaseLive', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('_registerLive calls liveOutput with this', () => {
    const s = make();
    s._registerLive();
    expect(liveOutput).toHaveBeenCalledWith(s);
    expect(s._live).toBeDefined();
  });

  it('_releaseLive calls release() and nulls _live', () => {
    const s = make();
    s._registerLive();
    const handle = s._live;
    s._releaseLive();
    expect(handle.release).toHaveBeenCalled();
    expect(s._live).toBeNull();
  });

  it('_releaseLive is idempotent when _live is null', () => {
    const s = make();
    expect(() => s._releaseLive()).not.toThrow();
  });
});
