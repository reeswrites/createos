import * as Tone from 'tone';
import { micAnalyser } from '../media/mic-state.js';
import { activeEditorId } from '../../runtime/run-context.js';
import { Shader } from '../shader/shader.js';
import { liveOutput } from '../../runtime/keep-alive.js';
import { runScoped } from '../../runtime/run-scoped.js';
import { acquireMicRunScoped } from '../media/media-lease.js';
import { readAnalyser } from '../audio/analyser-read.js';
import { isAudioSignal } from '../signal/signal-shape.js';
import { noteToMidi as _noteToMidi } from '../audio/music-theory.js';

const _vizs = new Set();

// Registered by PianoRollViz to receive note events from Instrument.play()
export const _noteHooks = [];

// Manual "destroy every viz" helper (app.js imports it). Per-instance,
// owner-filtered reset teardown is handled by run-scoped.js (ADR 041): each viz
// registers a runScoped handle in its ctor, so there is no onReset here.
export function cleanupViz() {
  for (const v of [..._vizs]) v._destroy();
  _vizs.clear();
}

// Owner-scoped teardown via the shared run-scoped handler (ADR 041). Keep-alive
// is toggled separately by each viz's start()/stop() (liveness toggles), so this
// uses runScoped (no keep-alive), not runScopedOutput.
function _registerViz(v) {
  v._ownerEditorId = activeEditorId();
  v._scoped = runScoped({ owner: v._ownerEditorId, onStop: () => v._destroy() });
  _vizs.add(v);
}

// ── Viz shader presets ────────────────────────────────────────────────────────

const VIZ_SHADER_PRESETS = {
  thermal:
    'let col = textureSample(video, videoSampler, uv);\n' +
    '  let v = col.r;\n' +
    '  return vec4f(v * 1.5, v * v, 0.0, 1.0);',
  cool:
    'let col = textureSample(video, videoSampler, uv);\n' +
    '  let v = col.r;\n' +
    '  return vec4f(0.0, v * 0.6, v, 1.0);',
  rainbow:
    'let col = textureSample(video, videoSampler, uv);\n' +
    '  let v = col.r;\n' +
    '  let h = v * 6.0;\n' +
    '  let r = clamp(abs(h - 3.0) - 1.0, 0.0, 1.0);\n' +
    '  let g = clamp(2.0 - abs(h - 2.0), 0.0, 1.0);\n' +
    '  let b = clamp(2.0 - abs(h - 4.0), 0.0, 1.0);\n' +
    '  return vec4f(r * v, g * v, b * v, 1.0);',
  mono:
    'let col = textureSample(video, videoSampler, uv);\n' +
    '  let v = col.r;\n' +
    '  return vec4f(v, v, v, 1.0);',
  neon:
    'let col = textureSample(video, videoSampler, uv);\n' +
    '  let v = col.r;\n' +
    '  let t2 = time * 0.5;\n' +
    '  return vec4f(v * abs(sin(t2)), v * abs(sin(t2 + 2.09)), v * abs(sin(t2 + 4.19)), 1.0);',
};

// ── AudioViz ─────────────────────────────────────────────────────────────────

export class AudioViz {
  constructor(source, { mode = 'bars', bins = 64, z = 5, opacity = 0.9, color = null } = {}) {
    this._mode = mode;
    this._z = z;
    this._opacity = opacity;
    this._color = color;
    this._canvas = null;
    this._ctx = null;
    this._rafId = null;

    this._analyser = new Tone.Analyser(mode === 'bars' ? 'fft' : 'waveform', bins);

    if (source) {
      const node = source._ ?? source;
      try {
        node.connect(this._analyser);
      } catch (_) {}
    }

    _registerViz(this);
  }

  _initCanvas() {
    this._canvas = document.createElement('canvas');
    const wrapper = document.getElementById('canvasWrapper');
    const ref = wrapper?.querySelector('canvas');
    this._canvas.width = ref?.width ?? 1600;
    this._canvas.height = ref?.height ?? 900;
    Object.assign(this._canvas.style, {
      position: 'absolute',
      top: '0',
      left: '0',
      width: '100%',
      height: '100%',
      zIndex: String(this._z),
      opacity: String(this._opacity),
      pointerEvents: 'none',
    });
    wrapper?.appendChild(this._canvas);
    this._ctx = this._canvas.getContext('2d');
  }

  _drawBars() {
    const data = this._analyser.getValue();
    const ctx = this._ctx;
    const W = this._canvas.width,
      H = this._canvas.height;
    const n = data.length;
    ctx.clearRect(0, 0, W, H);
    const bw = W / n;
    for (let i = 0; i < n; i++) {
      const v = Math.max(0, (data[i] + 100) / 100);
      const h = v * H;
      const hue = this._color != null ? this._color : (i / n) * 240;
      ctx.fillStyle = `hsl(${hue}, 90%, ${25 + v * 45}%)`;
      ctx.fillRect(i * bw, H - h, bw - 1, h);
    }
  }

  _drawWave() {
    const data = this._analyser.getValue();
    const ctx = this._ctx;
    const W = this._canvas.width,
      H = this._canvas.height;
    const mid = H / 2;
    ctx.clearRect(0, 0, W, H);
    ctx.beginPath();
    ctx.strokeStyle = this._color != null ? `hsl(${this._color}, 90%, 60%)` : 'hsl(120, 90%, 60%)';
    ctx.lineWidth = 2;
    for (let i = 0; i < data.length; i++) {
      const x = (i / (data.length - 1)) * W;
      const y = mid - data[i] * mid;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  _drawRing() {
    const data = this._analyser.getValue();
    const ctx = this._ctx;
    const W = this._canvas.width,
      H = this._canvas.height;
    const cx = W / 2,
      cy = H / 2;
    const r = Math.min(W, H) * 0.25;
    const n = data.length;
    ctx.clearRect(0, 0, W, H);
    ctx.beginPath();
    ctx.strokeStyle = this._color != null ? `hsl(${this._color}, 90%, 65%)` : 'hsl(270, 90%, 70%)';
    ctx.lineWidth = 2;
    for (let i = 0; i <= n; i++) {
      const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
      const v = data[i % n];
      const rad = r + v * r * 0.6;
      const x = cx + Math.cos(angle) * rad;
      const y = cy + Math.sin(angle) * rad;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
  }

  _frame() {
    if (this._mode === 'wave') this._drawWave();
    else if (this._mode === 'ring') this._drawRing();
    else this._drawBars();
    this._rafId = requestAnimationFrame(() => this._frame());
  }

  start() {
    if (!this._canvas) this._initCanvas();
    if (!this._rafId) this._frame();
    this._live = liveOutput(this);
    return this;
  }

  stop() {
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    this._live?.release();
    return this;
  }

  mode(m) {
    this._mode = m;
    this._analyser.type = m === 'bars' ? 'fft' : 'waveform';
    return this;
  }

  color(hue) {
    this._color = hue;
    return this;
  }

  opacity(n) {
    this._opacity = n;
    if (this._canvas) this._canvas.style.opacity = String(n);
    return this;
  }

  z(n) {
    this._z = n;
    if (this._canvas) this._canvas.style.zIndex = String(n);
    return this;
  }

  // Apply a WebGPU shader to this viz's canvas.
  // fnOrPreset: arrow function (v, t?) => [r, g, b, a]  OR  preset name string.
  // Returns the started Shader — call .stop()/.opacity()/.z() on it.
  shader(fnOrPreset, opts = {}) {
    if (!this._canvas) this.start();
    if (typeof fnOrPreset === 'string') {
      const body = VIZ_SHADER_PRESETS[fnOrPreset];
      if (!body)
        throw new Error(
          `viz.shader(): unknown preset '${fnOrPreset}'. Available: ${Object.keys(VIZ_SHADER_PRESETS).join(', ')}`,
        );
      return new Shader(body, { video: this._canvas, ...opts }).start();
    }
    if (typeof fnOrPreset === 'function') {
      // viz contract: (v, t?) => [r,g,b,a]. Bind the user's param names to the
      // video sample and let the shared transpiler (jsToWGSL, via Shader) handle
      // the body: v = col.r (pixel luminance/red), t = time.
      const m = fnOrPreset.toString().match(/^\s*(?:\(([^)]*)\)|([a-zA-Z_$][\w$]*))\s*=>/);
      const params = ((m && (m[1] ?? m[2])) || 'v')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const bind = {};
      if (params[0]) bind[params[0]] = 'col.r';
      if (params[1]) bind[params[1]] = 'time';
      return new Shader(fnOrPreset, { video: this._canvas, bind, ...opts }).start();
    }
    throw new Error('viz.shader() expects an arrow function or a preset name string');
  }

  get canvas() {
    return this._canvas;
  }

  static get presets() {
    return Object.keys(VIZ_SHADER_PRESETS);
  }

  _destroy() {
    if (this._destroyed) return; // idempotent; stops dispose()→onStop re-entry
    this._destroyed = true;
    this.stop();
    this._canvas?.remove();
    try {
      this._analyser.dispose();
    } catch (_) {}
    _vizs.delete(this);
    this._scoped?.dispose();
  }
}

// ── SpectrogramCanvas (#8) ────────────────────────────────────────────────────
// Scrolling spectrogram: frequency on Y, time scrolls left→right.
// source: Tone node | 'mic' | signal object (has .fft getter)
export class SpectrogramCanvas {
  constructor(
    source,
    { bins = 256, width = 512, height = 256, palette = 'rainbow', z = null } = {},
  ) {
    this._bins = bins;
    this._palette = palette;
    this._signal = null;
    this._analyser = null;
    this._micMode = source === 'mic';

    if (this._micMode) acquireMicRunScoped(); // run-scoped: auto-released on reset (ADR 023)

    if (!this._micMode && source) {
      if (isAudioSignal(source)) {
        this._signal = source;
      } else {
        this._analyser = new Tone.Analyser('fft', bins);
        const node = source?._ ?? source;
        try {
          node.connect(this._analyser);
        } catch (_) {}
      }
    }

    this._canvas = document.createElement('canvas');
    this._canvas.width = width;
    this._canvas.height = height;
    this._ctx = this._canvas.getContext('2d', { willReadFrequently: true });
    this._rafId = null;

    if (z !== null) {
      Object.assign(this._canvas.style, {
        position: 'absolute',
        top: '0',
        left: '0',
        width: '100%',
        height: '100%',
        zIndex: String(z),
        pointerEvents: 'none',
      });
      document.getElementById('canvasWrapper')?.appendChild(this._canvas);
      this._live = liveOutput(this);
    }

    _registerViz(this);
    this._start();
  }

  _getFft() {
    if (this._signal) return this._signal.fft;
    if (this._micMode) {
      const node = micAnalyser();
      if (!node) return new Float32Array(this._bins);
      const raw = new Float32Array(node.frequencyBinCount || this._bins);
      if (typeof node.getFloatFrequencyData === 'function') node.getFloatFrequencyData(raw);
      const out = new Float32Array(this._bins);
      const step = raw.length / this._bins;
      for (let i = 0; i < this._bins; i++) {
        const db = raw[Math.floor(i * step)];
        out[i] = isFinite(db) ? Math.max(0, (db + 80) / 80) : 0;
      }
      return out;
    }
    return readAnalyser(this._analyser, this._bins);
  }

  _colorFor(v) {
    switch (this._palette) {
      case 'thermal':
        return [Math.min(255, Math.round(v * 1.5 * 255)), Math.round(v * v * 255), 0, 255];
      case 'cool':
        return [0, Math.round(v * 150), Math.round(v * 255), 255];
      case 'mono': {
        const c = Math.round(v * 255);
        return [c, c, c, 255];
      }
      default: {
        // rainbow hue from blue→red as v increases
        const h = ((1 - v) * 240) / 360;
        const [r, g, b] = _hslToRgb(h, 0.9, Math.max(0.05, v * 0.55 + 0.1));
        return [r, g, b, 255];
      }
    }
  }

  _frame() {
    const ctx = this._ctx;
    const W = this._canvas.width;
    const H = this._canvas.height;

    // Shift all pixels left by 1
    const img = ctx.getImageData(1, 0, W - 1, H);
    ctx.putImageData(img, 0, 0);

    // Draw new column on right edge
    const fft = this._getFft();
    const col = ctx.createImageData(1, H);
    for (let y = 0; y < H; y++) {
      const binIdx = Math.floor(((H - 1 - y) / H) * this._bins);
      const v = Math.min(1, fft[Math.min(binIdx, this._bins - 1)] ?? 0);
      const [r, g, b, a] = this._colorFor(v);
      const i = y * 4;
      col.data[i] = r;
      col.data[i + 1] = g;
      col.data[i + 2] = b;
      col.data[i + 3] = a;
    }
    ctx.putImageData(col, W - 1, 0);

    this._rafId = requestAnimationFrame(() => this._frame());
  }

  _start() {
    if (!this._rafId) this._frame();
  }

  stop() {
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    this._live?.release();
    return this;
  }

  palette(name) {
    this._palette = name;
    return this;
  }

  get canvas() {
    return this._canvas;
  }

  _destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    this.stop();
    this._canvas?.remove();
    if (this._analyser)
      try {
        this._analyser.dispose();
      } catch (_) {}
    _vizs.delete(this);
    this._scoped?.dispose();
  }
}

// ── PianoRollViz (#9) ─────────────────────────────────────────────────────────
// Scrolling note history overlay. Pitch on X, time scrolls upward.
// Receives notes via _noteHooks (fired by Instrument.play() in audio.js).
export class PianoRollViz {
  constructor({ z = 15, opacity = 0.85, speed = 80, midiMin = 36, midiMax = 96 } = {}) {
    this._notes = [];
    this._speed = speed; // pixels per second scrolling upward
    this._midiMin = midiMin;
    this._midiMax = midiMax;
    this._canvas = null;
    this._ctx = null;
    this._rafId = null;
    this._z = z;
    this._opacity = opacity;

    this._hook = ({ note, dur }) => {
      const midi = _noteToMidi(note);
      if (midi < this._midiMin || midi > this._midiMax) return;
      const durMs = _durToMs(dur);
      this._notes.push({
        midi,
        startAt: performance.now(),
        dur: durMs,
        color: `hsl(${((midi - 60) * 15 + 360) % 360},80%,60%)`,
      });
      if (this._notes.length > 500) this._notes.shift();
    };
    _noteHooks.push(this._hook);
    _registerViz(this);
  }

  start() {
    if (!this._canvas) this._initCanvas();
    if (!this._rafId) this._frame();
    this._live = liveOutput(this);
    return this;
  }

  stop() {
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    this._live?.release();
    return this;
  }

  _initCanvas() {
    this._canvas = document.createElement('canvas');
    const wrapper = document.getElementById('canvasWrapper');
    const ref = wrapper?.querySelector('canvas');
    this._canvas.width = ref?.width ?? 1600;
    this._canvas.height = ref?.height ?? 900;
    Object.assign(this._canvas.style, {
      position: 'absolute',
      top: '0',
      left: '0',
      width: '100%',
      height: '100%',
      zIndex: String(this._z),
      opacity: String(this._opacity),
      pointerEvents: 'none',
    });
    wrapper?.appendChild(this._canvas);
    this._ctx = this._canvas.getContext('2d');
  }

  _frame() {
    const ctx = this._ctx;
    const W = this._canvas.width;
    const H = this._canvas.height;
    const now = performance.now();
    const range = Math.max(1, this._midiMax - this._midiMin);

    ctx.clearRect(0, 0, W, H);

    // Faint key grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    for (let m = this._midiMin; m <= this._midiMax; m++) {
      const x = ((m - this._midiMin) / range) * W;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }

    // "now" line at 85% down
    const nowY = H * 0.85;
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, nowY);
    ctx.lineTo(W, nowY);
    ctx.stroke();

    const pixPerMs = this._speed / 1000;
    const noteW = Math.max(4, Math.floor(W / (range + 1)) - 1);

    for (const n of this._notes) {
      const elapsed = now - n.startAt;
      const x = Math.floor(((n.midi - this._midiMin) / range) * W);
      const noteH = Math.max(4, n.dur * pixPerMs);
      const y = nowY - elapsed * pixPerMs - noteH;

      if (y + noteH < 0) continue;

      ctx.fillStyle = n.color;
      if (typeof ctx.roundRect === 'function') {
        ctx.beginPath();
        ctx.roundRect(x, y, noteW, noteH, 2);
        ctx.fill();
      } else {
        ctx.fillRect(x, y, noteW, noteH);
      }
    }

    this._rafId = requestAnimationFrame(() => this._frame());
  }

  get canvas() {
    return this._canvas;
  }

  _destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    this.stop();
    this._canvas?.remove();
    const i = _noteHooks.indexOf(this._hook);
    if (i >= 0) _noteHooks.splice(i, 1);
    _vizs.delete(this);
    this._scoped?.dispose();
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h * 6) % 2) - 1));
  const m = l - c / 2;
  let r = 0,
    g = 0,
    b = 0;
  const seg = Math.floor(h * 6);
  if (seg === 0) {
    r = c;
    g = x;
  } else if (seg === 1) {
    r = x;
    g = c;
  } else if (seg === 2) {
    g = c;
    b = x;
  } else if (seg === 3) {
    g = x;
    b = c;
  } else if (seg === 4) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

function _durToMs(dur) {
  if (typeof dur === 'number') return dur * 1000;
  const bpm = Tone.getTransport?.().bpm?.value ?? 120;
  const beatMs = 60000 / bpm;
  if (typeof dur === 'string') {
    if (dur.endsWith('n')) return beatMs * (4 / parseInt(dur, 10));
    if (dur.endsWith('m')) return beatMs * 4 * parseInt(dur, 10);
    if (dur.endsWith('s')) return parseFloat(dur) * 1000;
  }
  return 500;
}

// Reset teardown is owner-filtered via run-scoped.js (ADR 041): each viz
// registers a runScoped handle in its ctor. cleanupViz() remains as a manual
// "destroy all" helper for app.js / tests.
