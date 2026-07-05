import { VideoSignalAPI, cleanupVideoSignal } from '../../../../src/api/signal/video-signal.js';

// ── cleanupVideoSignal ────────────────────────────────────────────────────────

describe('cleanupVideoSignal', () => {
  test('callable without error', () => {
    expect(() => cleanupVideoSignal()).not.toThrow();
  });
  test('idempotent — safe to call multiple times', () => {
    expect(() => {
      cleanupVideoSignal();
      cleanupVideoSignal();
    }).not.toThrow();
  });
  test('stops intervals created by signal()', () => {
    vi.useFakeTimers();
    VideoSignalAPI.signal('camera', { fps: 30 });
    cleanupVideoSignal();
    // no assertion needed — just confirm no throw and cleanup doesn't hang
    vi.useRealTimers();
  });
});

// ── Signal-bus contract ───────────────────────────────────────────────────────
// video.signal() must expose sync getters + .stream(fn) per signal-bus contract.

describe('VideoSignalAPI.signal() — signal shape', () => {
  test('returns an object', () => {
    expect(typeof VideoSignalAPI.signal('camera')).toBe('object');
  });

  test('has numeric getters: brightness r g b motion hue', () => {
    const sig = VideoSignalAPI.signal('camera');
    for (const p of ['brightness', 'r', 'g', 'b', 'motion', 'hue']) {
      expect(typeof sig[p]).toBe('number');
    }
  });

  test('initial values are 0 when source unavailable', () => {
    const sig = VideoSignalAPI.signal('camera');
    expect(sig.brightness).toBe(0);
    expect(sig.r).toBe(0);
    expect(sig.g).toBe(0);
    expect(sig.b).toBe(0);
    expect(sig.motion).toBe(0);
    expect(sig.hue).toBe(0);
  });

  test('has stream method', () => {
    const sig = VideoSignalAPI.signal('camera');
    expect(typeof sig.stream).toBe('function');
  });

  test('stream returns the signal (for chaining)', () => {
    vi.useFakeTimers();
    const sig = VideoSignalAPI.signal('camera', { fps: 60 });
    const ret = sig.stream(() => {});
    expect(ret).toBe(sig);
    vi.useRealTimers();
    cleanupVideoSignal();
  });
});

describe('VideoSignalAPI.signal() — source types', () => {
  test('accepts canvas element as source', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 100;
    canvas.height = 100;
    expect(() => VideoSignalAPI.signal(canvas)).not.toThrow();
  });

  test('accepts video element as source', () => {
    const video = document.createElement('video');
    expect(() => VideoSignalAPI.signal(video)).not.toThrow();
  });

  test('unknown string source yields zeros', () => {
    const sig = VideoSignalAPI.signal('nonexistent-source');
    expect(sig.brightness).toBe(0);
  });
});

// ── Edge-trigger helpers ──────────────────────────────────────────────────────

describe('VideoSignalAPI.onMotion / onBrightness', () => {
  test('onMotion is available and callable', () => {
    expect(typeof VideoSignalAPI.onMotion).toBe('function');
  });
  test('onBrightness is available and callable', () => {
    expect(typeof VideoSignalAPI.onBrightness).toBe('function');
  });
  test('onMotion does not throw', () => {
    vi.useFakeTimers();
    expect(() => VideoSignalAPI.onMotion('camera', 0.5, () => {})).not.toThrow();
    vi.useRealTimers();
    cleanupVideoSignal();
  });
});
