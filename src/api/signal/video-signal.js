import { onReset } from '../../runtime/reset-registry.js';
import { acquireCameraRunScoped } from '../media/media-lease.js';
import { isVideoSignal } from './signal-shape.js';
// ── Video Signal Bus ──────────────────────────────────────────────────────────
// Samples pixel data from any canvas/video source and exposes it as live
// signal objects that can drive audio params, effects, or anything numeric.
//
// Usage:
//   const sig = video.signal('camera', { x: 0.5, y: 0.5, radius: 0.05 })
//   // sig.brightness, sig.r, sig.g, sig.b, sig.motion, sig.hue — all live getters

const _nativeSetInterval = window.setInterval.bind(window);
const _nativeClearInterval = window.clearInterval.bind(window);

const _cleanupFns = [];

export function cleanupVideoSignal() {
  for (const fn of _cleanupFns) fn();
  _cleanupFns.length = 0;
}

const SAMPLE_SIZE = 16; // 16×16 offscreen = 256px, fast getImageData

function _resolveSource(source) {
  if (source === 'camera') return () => document.getElementById('camera');
  if (source instanceof HTMLCanvasElement || source instanceof HTMLVideoElement)
    return () => source;
  return () => null;
}

export const VideoSignalAPI = {
  // Sample a region of any canvas/video source as a live signal.
  // opts: { x, y } = normalized center (0–1), radius = normalized region size, fps = sample rate
  signal(source, { x = 0.5, y = 0.5, radius = 0.05, fps = 30 } = {}) {
    if (source === 'camera') acquireCameraRunScoped();
    const getSource = _resolveSource(source);

    const off = document.createElement('canvas');
    off.width = SAMPLE_SIZE;
    off.height = SAMPLE_SIZE;
    const offCtx = off.getContext('2d', { willReadFrequently: true });

    let _r = 0,
      _g = 0,
      _b = 0,
      _brightness = 0,
      _hue = 0,
      _motion = 0;
    let _prevData = null;

    const sample = () => {
      const src = getSource();
      if (!src) return;
      const w = src.videoWidth || src.width || 1;
      const h = src.videoHeight || src.height || 1;

      const r = Math.max(0.01, radius);
      const sx = Math.max(0, (x - r) * w);
      const sy = Math.max(0, (y - r) * h);
      const sw = Math.min(w - sx, r * 2 * w);
      const sh = Math.min(h - sy, r * 2 * h);
      if (sw < 1 || sh < 1) return;

      try {
        offCtx.drawImage(src, sx, sy, sw, sh, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
      } catch (_) {
        return;
      }

      const pixels = offCtx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data;
      const n = SAMPLE_SIZE * SAMPLE_SIZE;
      let sumR = 0,
        sumG = 0,
        sumB = 0,
        sumDiff = 0;

      for (let i = 0; i < pixels.length; i += 4) {
        sumR += pixels[i];
        sumG += pixels[i + 1];
        sumB += pixels[i + 2];
        if (_prevData) {
          const dr = pixels[i] - _prevData[i];
          const dg = pixels[i + 1] - _prevData[i + 1];
          const db = pixels[i + 2] - _prevData[i + 2];
          sumDiff += Math.sqrt(dr * dr + dg * dg + db * db);
        }
      }

      _r = sumR / (n * 255);
      _g = sumG / (n * 255);
      _b = sumB / (n * 255);
      _brightness = 0.299 * _r + 0.587 * _g + 0.114 * _b;
      _motion = _prevData ? Math.min(1, sumDiff / (n * 441)) : 0; // 441 = sqrt(255²×3)

      // RGB → hue
      const mx = Math.max(_r, _g, _b),
        mn = Math.min(_r, _g, _b),
        d = mx - mn;
      if (d < 0.001) {
        _hue = 0;
      } else if (mx === _r) {
        _hue = (((_g - _b) / d) % 6) * 60;
      } else if (mx === _g) {
        _hue = ((_b - _r) / d + 2) * 60;
      } else {
        _hue = ((_r - _g) / d + 4) * 60;
      }
      if (_hue < 0) _hue += 360;

      _prevData = new Uint8ClampedArray(pixels);
    };

    const id = _nativeSetInterval(sample, Math.round(1000 / fps));
    _cleanupFns.push(() => _nativeClearInterval(id));

    const sig = {
      get brightness() {
        return _brightness;
      },
      get r() {
        return _r;
      },
      get g() {
        return _g;
      },
      get b() {
        return _b;
      },
      get motion() {
        return _motion;
      },
      get hue() {
        return _hue;
      },
      // RAF-driven push — fn(sig) called every frame, cleaned up on reset
      stream(fn) {
        let rafId;
        const frame = () => {
          fn(sig);
          rafId = requestAnimationFrame(frame);
        };
        rafId = requestAnimationFrame(frame);
        _cleanupFns.push(() => cancelAnimationFrame(rafId));
        return sig;
      },
    };
    return sig;
  },

  // Edge-triggered motion threshold. Fires onEnter when motion >= threshold, onExit when it drops below.
  // sourceOrSig: 'camera' | HTMLCanvasElement | existing video.signal() object
  // opts: same as signal() — x, y, radius, fps
  onMotion(sourceOrSig, threshold, onEnter, onExit, opts = {}) {
    const sig = isVideoSignal(sourceOrSig) ? sourceOrSig : this.signal(sourceOrSig, opts);
    let wasAbove = false;
    const id = _nativeSetInterval(
      () => {
        const above = sig.motion >= threshold;
        if (above && !wasAbove) {
          wasAbove = true;
          onEnter();
        } else if (!above && wasAbove) {
          wasAbove = false;
          onExit?.();
        }
      },
      Math.round(1000 / (opts.fps ?? 30)),
    );
    _cleanupFns.push(() => _nativeClearInterval(id));
  },

  // Edge-triggered brightness threshold. Fires onEnter when brightness >= threshold, onExit when below.
  onBrightness(sourceOrSig, threshold, onEnter, onExit, opts = {}) {
    const sig = isVideoSignal(sourceOrSig) ? sourceOrSig : this.signal(sourceOrSig, opts);
    let wasAbove = false;
    const id = _nativeSetInterval(
      () => {
        const above = sig.brightness >= threshold;
        if (above && !wasAbove) {
          wasAbove = true;
          onEnter();
        } else if (!above && wasAbove) {
          wasAbove = false;
          onExit?.();
        }
      },
      Math.round(1000 / (opts.fps ?? 30)),
    );
    _cleanupFns.push(() => _nativeClearInterval(id));
  },
};

// Register teardown with the reset registry (ADR 008).
onReset(cleanupVideoSignal);
