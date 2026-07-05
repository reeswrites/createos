// recorder.test.js — unit tests for src/api/recorder.js
//
// Runs in jsdom. MediaRecorder is not available in jsdom — we mock it globally.
// requestAnimationFrame is polyfilled in setup.js.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── MediaRecorder mock ────────────────────────────────────────────────────────

class MockMediaRecorder {
  constructor(stream, opts) {
    this._stream = stream;
    this._opts = opts;
    this.mimeType = opts?.mimeType ?? 'video/webm';
    this.state = 'inactive';
    this.ondataavailable = null;
    this.onstop = null;
    MockMediaRecorder.instances.push(this);
  }
  start(timeslice) {
    this.state = 'recording';
    this._timeslice = timeslice;
  }
  stop() {
    this.state = 'inactive';
    this.onstop?.();
  }
  // Helper: fire a data chunk
  fireData(data) {
    this.ondataavailable?.({ data });
  }
}
MockMediaRecorder.instances = [];
MockMediaRecorder.isTypeSupported = (t) => t === 'video/webm;codecs=vp9' || t === 'video/webm';

let Recording, recordStream, compositeCanvasStream, cleanupRecorders;

beforeEach(async () => {
  MockMediaRecorder.instances = [];
  global.MediaRecorder = MockMediaRecorder;

  vi.resetModules();
  ({ Recording, recordStream, compositeCanvasStream, cleanupRecorders } =
    await import('../../../../src/api/media/recorder.js'));
});

afterEach(() => {
  cleanupRecorders();
  vi.restoreAllMocks();
});

// ── Recording class ───────────────────────────────────────────────────────────

describe('Recording', () => {
  it('creates a MediaRecorder and calls start(100)', () => {
    const stream = { getTracks: () => [] };
    new Recording(stream, {});
    const mr = MockMediaRecorder.instances[0];
    expect(mr).toBeDefined();
    expect(mr.state).toBe('recording');
    expect(mr._timeslice).toBe(100);
  });

  it('accumulates chunks and calls onStop with a Blob on stop()', () => {
    const onStop = vi.fn();
    const stream = { getTracks: () => [] };
    const rec = new Recording(stream, { onStop, mimeType: 'video/webm' });
    const mr = MockMediaRecorder.instances[0];
    // fire two chunks
    mr.fireData(new Blob(['a'], { type: 'video/webm' }));
    mr.fireData(new Blob(['b'], { type: 'video/webm' }));
    rec.stop();
    expect(onStop).toHaveBeenCalledOnce();
    const blob = onStop.mock.calls[0][0];
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('video/webm');
  });

  it('does not call onStop if no chunks accumulated', () => {
    const onStop = vi.fn();
    const stream = { getTracks: () => [] };
    const rec = new Recording(stream, { onStop });
    rec.stop(); // no data
    expect(onStop).not.toHaveBeenCalled();
  });

  it('calls _stopCompositor on stop()', () => {
    const stopComp = vi.fn();
    const stream = { getTracks: () => [] };
    const rec = new Recording(stream, {});
    rec._stopCompositor = stopComp;
    rec.stop();
    expect(stopComp).toHaveBeenCalledOnce();
    expect(rec._stopCompositor).toBeNull();
  });

  it('stop() is idempotent when MediaRecorder already inactive', () => {
    const stream = { getTracks: () => [] };
    const rec = new Recording(stream, {});
    rec.stop(); // transitions to inactive + fires onstop
    expect(() => rec.stop()).not.toThrow(); // second stop — no double-fire
  });
});

// ── recordStream ──────────────────────────────────────────────────────────────

describe('recordStream', () => {
  it('returns a Recording instance', () => {
    const stream = { getTracks: () => [] };
    const rec = recordStream(stream, {});
    expect(rec).toBeInstanceOf(Recording);
  });
});

// ── cleanupRecorders ──────────────────────────────────────────────────────────

describe('cleanupRecorders', () => {
  it('stops all in-flight recordings and still fires onStop', () => {
    const onStop = vi.fn();
    const stream = { getTracks: () => [] };
    recordStream(stream, { onStop });
    const mr = MockMediaRecorder.instances[0];
    mr.fireData(new Blob(['x']));
    cleanupRecorders();
    expect(mr.state).toBe('inactive');
    expect(onStop).toHaveBeenCalledOnce();
  });

  it('handles multiple in-flight recordings', () => {
    const stream = { getTracks: () => [] };
    const s1 = vi.fn(),
      s2 = vi.fn();
    recordStream(stream, { onStop: s1 });
    recordStream(stream, { onStop: s2 });
    MockMediaRecorder.instances[0].fireData(new Blob(['a']));
    MockMediaRecorder.instances[1].fireData(new Blob(['b']));
    cleanupRecorders();
    expect(s1).toHaveBeenCalledOnce();
    expect(s2).toHaveBeenCalledOnce();
  });
});

// ── compositeCanvasStream ─────────────────────────────────────────────────────

describe('compositeCanvasStream', () => {
  it('returns { stream, stop } and stop cancels the RAF loop', () => {
    const cancelSpy = vi.spyOn(global, 'cancelAnimationFrame');
    const canvases = [
      Object.assign(document.createElement('canvas'), { width: 320, height: 240 }),
      Object.assign(document.createElement('canvas'), { width: 320, height: 240 }),
    ];
    // captureStream mock
    const fakeStream = { getTracks: () => [] };
    HTMLCanvasElement.prototype.captureStream = vi.fn(() => fakeStream);
    const { stream, stop } = compositeCanvasStream(canvases, 30);
    expect(stream).toBe(fakeStream);
    stop();
    expect(cancelSpy).toHaveBeenCalled();
  });

  it('uses first canvas dimensions for the offscreen canvas', () => {
    const canvases = [Object.assign(document.createElement('canvas'), { width: 640, height: 360 })];
    HTMLCanvasElement.prototype.captureStream = vi.fn(() => ({ getTracks: () => [] }));
    const { stream, stop } = compositeCanvasStream(canvases, 30);
    stop();
    // offscreen canvas created with same dims — can only check no throw
    expect(stream).toBeDefined();
  });
});
