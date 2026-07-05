// render-pipeline.js — fluent visual render pipeline.
// pipe(source).ascii(opts).glshader(body).show(title, opts)
//
// Every stage exposes:
//   ._getSource()  → HTMLCanvasElement | HTMLVideoElement (drawable for downstream)
//   .read()        → pull upstream + render this frame (canvas stages only; shader stages self-raf)
//   ._start()      → init canvas / shader (called once when pipeline starts)
//   ._destroy()    → teardown
//
// Shader stages (._isShader = true) self-raf via GLShader/Shader — the pipeline
// driver only calls read() on canvas stages.

import { resolveDrawable, _isCanvas, _isVideo } from './drawable-source.js';
import { openScreenSource } from '../media/screen.js';
import { liveOutput } from '../../runtime/keep-alive.js';
import { onReset } from '../../runtime/reset-registry.js';
import { runScoped } from '../../runtime/run-scoped.js';
import { notify, registerCommand } from '../../events/index.js';

const _pipelines = new Set();
const _stageRegistry = new Map(); // stageId → stage instance

// ── Helpers ───────────────────────────────────────────────────────────────────
// Source resolution + duck-type helpers live in drawable-source.js (ADR 006).
// _srcWidth/_srcHeight are pipeline-specific sizing helpers, kept local.

function _srcWidth(src) {
  return src.videoWidth ?? src.width ?? 800;
}
function _srcHeight(src) {
  return src.videoHeight ?? src.height ?? 600;
}

function _makeHiddenDiv() {
  const div = document.createElement('div');
  div.style.cssText =
    'position:fixed;top:-9999px;left:-9999px;width:800px;height:600px;overflow:hidden;pointer-events:none;';
  document.body.appendChild(div);
  return div;
}

// ── Source — named lazy sources for pipe() ────────────────────────────────────
// Sentinel descriptors resolved at pipeline start. Enables pipe(Source.camera)
// without an explicit await at the call site.
export const Source = Object.freeze({
  camera: Object.freeze({ _src: 'camera' }),
  screen: Object.freeze({ _src: 'screen' }),
  mic: Object.freeze({ _src: 'mic' }),
  // Gaze scalar sub-sources for route() (ADR 034). .x/.y = head-relative
  // direction (no calibration); .vx/.vy = viewport-pixel screen point (needs
  // calibration — falls back to a held value while uncalibrated).
  gaze: Object.freeze({
    x: Object.freeze({ _src: 'gaze', field: 'x' }),
    y: Object.freeze({ _src: 'gaze', field: 'y' }),
    vx: Object.freeze({ _src: 'gaze', field: 'vx' }),
    vy: Object.freeze({ _src: 'gaze', field: 'vy' }),
  }),
});

// Owned accessors for the Source sentinel shape — the seam route() and pipe()
// read through instead of hand-matching `x?._src === '...'` against the private
// `{_src, field}` contract. Co-located with the definition so a rename here
// can't silently desync a consumer in another module.
export function sourceKind(x) {
  return x && typeof x === 'object' && typeof x._src === 'string' ? x._src : null;
}
export function sourceField(x) {
  return x?.field;
}

// ── InputAdapter ──────────────────────────────────────────────────────────────
// Head of every pipeline — wraps any supported source, including Promises.

class InputAdapter {
  constructor(input) {
    this._promise = input instanceof Promise ? input : null;
    this._src = this._promise ? null : resolveDrawable(input);
    this._isShader = false;
    if (!this._promise && !this._src) {
      throw new Error(
        'pipe(): unsupported source — pass Source.camera, a CameraStream, ' +
          'HTMLCanvasElement, HTMLVideoElement, GLShader, Shader, or Layer.',
      );
    }
  }
  async _resolve() {
    if (this._promise) this._src = resolveDrawable(await this._promise);
  }
  _getSource() {
    return this._src;
  }
  _start() {}
  read() {}
  _destroy() {}
}

// ── AsciiStage ────────────────────────────────────────────────────────────────
// Downsamples upstream to cols×rows, computes per-cell luma (same weights as
// draw.toASCII), then renders glyphs to a canvas via fillText.

class AsciiStage {
  constructor(upstream, opts = {}) {
    this._upstream = upstream;
    this._cols = opts.cols ?? 80;
    this._rows = opts.rows ?? Math.round((opts.cols ?? 80) / 2.5);
    this._charset = opts.charset ?? ' .:-=+*#%@';
    this._bg = opts.bg ?? '#000';
    this._color = opts.color ?? '#0f0';
    this._cellW = opts.cellW ?? 8;
    this._cellH = opts.cellH ?? 14;
    this._canvas = document.createElement('canvas');
    this._ctx = null;
    this._offCanvas = document.createElement('canvas');
    this._offCtx = null;
    this._isShader = false;
  }

  _start() {
    const { _cols: cols, _rows: rows, _cellW: cw, _cellH: ch } = this;
    this._canvas.width = cols * cw;
    this._canvas.height = rows * ch;
    this._ctx = this._canvas.getContext('2d');
    this._ctx.font = `${ch}px monospace`;
    this._ctx.textAlign = 'left';
    this._ctx.textBaseline = 'top';

    this._offCanvas.width = cols;
    this._offCanvas.height = rows;
    this._offCtx = this._offCanvas.getContext('2d', { willReadFrequently: true });
  }

  read() {
    if (!this._ctx) return;
    const src = this._upstream._getSource();
    if (_isVideo(src) && src.readyState < 2) return;

    const {
      _cols: cols,
      _rows: rows,
      _cellW: cw,
      _cellH: ch,
      _charset: charset,
      _bg: bg,
      _color: color,
    } = this;

    this._offCtx.drawImage(src, 0, 0, cols, rows);
    const px = this._offCtx.getImageData(0, 0, cols, rows).data;

    const ctx = this._ctx;
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, this._canvas.width, this._canvas.height);
    ctx.fillStyle = color;

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const i = (row * cols + col) * 4;
        const lum = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) / 255;
        const glyph = charset[Math.min(charset.length - 1, Math.floor(lum * charset.length))];
        if (glyph !== ' ') ctx.fillText(glyph, col * cw, row * ch);
      }
    }
  }

  set(props) {
    if (props.color !== undefined) this._color = props.color;
    if (props.bg !== undefined) this._bg = props.bg;
    if (props.charset !== undefined) this._charset = props.charset;
  }

  _getSource() {
    return this._canvas;
  }
  get canvas() {
    return this._canvas;
  }

  _destroy() {
    this._canvas.remove();
    this._offCanvas.remove();
    this._ctx = null;
    this._offCtx = null;
  }
}

// ── PixelateStage ─────────────────────────────────────────────────────────────
// Reuses the draw.pixelate downscale/upscale trick for a mosaic effect.

class PixelateStage {
  constructor(upstream, opts = {}) {
    this._upstream = upstream;
    this._blockSize = opts.blockSize ?? opts ?? 8;
    if (typeof this._blockSize !== 'number') this._blockSize = 8;
    this._canvas = document.createElement('canvas');
    this._ctx = null;
    this._offCanvas = document.createElement('canvas');
    this._offCtx = null;
    this._isShader = false;
  }

  _start() {
    const src = this._upstream._getSource();
    const w = _srcWidth(src),
      h = _srcHeight(src);
    this._canvas.width = w;
    this._canvas.height = h;
    this._ctx = this._canvas.getContext('2d');
    const pw = Math.max(1, Math.round(w / this._blockSize));
    const ph = Math.max(1, Math.round(h / this._blockSize));
    this._offCanvas.width = pw;
    this._offCanvas.height = ph;
    this._offCtx = this._offCanvas.getContext('2d');
  }

  read() {
    if (!this._ctx) return;
    const src = this._upstream._getSource();
    if (_isVideo(src) && src.readyState < 2) return;
    this._offCtx.drawImage(src, 0, 0, this._offCanvas.width, this._offCanvas.height);
    this._ctx.imageSmoothingEnabled = false;
    this._ctx.drawImage(this._offCanvas, 0, 0, this._canvas.width, this._canvas.height);
    this._ctx.imageSmoothingEnabled = true;
  }

  set(props) {
    if (props.blockSize !== undefined) this._blockSize = props.blockSize;
  }

  _getSource() {
    return this._canvas;
  }
  get canvas() {
    return this._canvas;
  }

  _destroy() {
    this._canvas.remove();
    this._offCanvas.remove();
    this._ctx = null;
    this._offCtx = null;
  }
}

// ── FxStage ───────────────────────────────────────────────────────────────────
// Applies a CSS filter string (blur/hue-rotate/invert/saturate/etc.) to upstream.

class FxStage {
  constructor(upstream, filter) {
    this._upstream = upstream;
    this._filter = filter;
    this._canvas = document.createElement('canvas');
    this._ctx = null;
    this._isShader = false;
  }

  _start() {
    const src = this._upstream._getSource();
    this._canvas.width = _srcWidth(src);
    this._canvas.height = _srcHeight(src);
    this._ctx = this._canvas.getContext('2d');
  }

  read() {
    if (!this._ctx) return;
    const src = this._upstream._getSource();
    if (_isVideo(src) && src.readyState < 2) return;
    this._ctx.filter = this._filter;
    this._ctx.drawImage(src, 0, 0, this._canvas.width, this._canvas.height);
    this._ctx.filter = 'none';
  }

  set(props) {
    if (props.filter !== undefined) this._filter = props.filter;
  }

  _getSource() {
    return this._canvas;
  }
  get canvas() {
    return this._canvas;
  }

  _destroy() {
    this._canvas.remove();
    this._ctx = null;
  }
}

// ── GLShaderStage ─────────────────────────────────────────────────────────────
// Wraps GLShader (WebGL/GLSL). Self-rafs — pipeline loop does not call read().
// When used as a terminal stage with a sink container, the shader canvas mounts
// directly inside it. Otherwise, uses a hidden div so its canvas can be sampled
// by downstream stages.

class GLShaderStage {
  constructor(upstream, fragBody, opts = {}) {
    this._upstream = upstream;
    this._fragBody = fragBody;
    this._opts = opts;
    this._shaderInst = null;
    this._hiddenDiv = null;
    this._sinkContainer = null; // set by Pipeline._mountInContainer when terminal
    this._isShader = true;
    this._owned = true; // false when caller passes a pre-created instance
  }

  _start() {
    const upstream = this._upstream._getSource();
    // Accept a pre-created GLShader instance (object, not a body string/fn)
    if (this._fragBody !== null && typeof this._fragBody === 'object') {
      this._shaderInst = this._fragBody;
      this._owned = false;
      this._shaderInst.video(upstream).start();
      return;
    }
    const GLShaderCls = window.GLShader;
    if (!GLShaderCls) throw new Error('pipe().glshader(): GLShader not available on window.');
    const container = this._sinkContainer ?? (this._hiddenDiv = _makeHiddenDiv());
    this._shaderInst = new GLShaderCls(this._fragBody, {
      z: this._opts.z ?? 0,
      opacity: this._opts.opacity ?? 1,
      container,
    });
    if (this._opts.mask) this._shaderInst.mask(this._opts.mask, this._opts.maskOpts); // ADR 054
    this._shaderInst.video(upstream).start();
  }

  read() {} // GLShader self-rafs

  _getSource() {
    return this._shaderInst?._canvas ?? null;
  }
  get canvas() {
    return this._shaderInst?._canvas ?? null;
  }

  _destroy() {
    if (this._owned) this._shaderInst?._destroy?.();
    this._shaderInst = null;
    this._hiddenDiv?.remove();
    this._hiddenDiv = null;
  }
}

// ── ShaderStage ───────────────────────────────────────────────────────────────
// Wraps Shader (WebGPU/WGSL). Same pattern as GLShaderStage.

class ShaderStage {
  constructor(upstream, fragBody, opts = {}) {
    this._upstream = upstream;
    this._fragBody = fragBody;
    this._opts = opts;
    this._shaderInst = null;
    this._hiddenDiv = null;
    this._sinkContainer = null;
    this._isShader = true;
    this._owned = true;
  }

  _start() {
    const upstream = this._upstream._getSource();
    // Accept a pre-created Shader instance (object, not a body string/fn)
    if (this._fragBody !== null && typeof this._fragBody === 'object') {
      this._shaderInst = this._fragBody;
      this._owned = false;
      this._shaderInst.video(upstream).start();
      return;
    }
    const ShaderCls = window.Shader;
    if (!ShaderCls) throw new Error('pipe().shader(): Shader (WebGPU) not available on window.');
    const container = this._sinkContainer ?? (this._hiddenDiv = _makeHiddenDiv());
    this._shaderInst = new ShaderCls(this._fragBody, {
      z: this._opts.z ?? 0,
      opacity: this._opts.opacity ?? 1,
      container,
    });
    if (this._opts.mask) this._shaderInst.mask(this._opts.mask, this._opts.maskOpts); // ADR 054
    this._shaderInst.video(upstream).start();
  }

  read() {} // Shader self-rafs

  _getSource() {
    const c = this._shaderInst?.canvas;
    return _isCanvas(c) ? c : null;
  }
  get canvas() {
    return this._getSource();
  }

  _destroy() {
    if (this._owned) {
      this._shaderInst?.stop?.();
      this._shaderInst?._destroy?.();
    }
    this._shaderInst = null;
    this._hiddenDiv?.remove();
    this._hiddenDiv = null;
  }
}

// ── CustomStage ───────────────────────────────────────────────────────────────
// User-supplied stage via pipe().use(factory).
// factory(srcDrawable) called once at start — must return { canvas, read() }.
// srcDrawable is the upstream HTMLCanvasElement or HTMLVideoElement.
// canvas must be an HTMLCanvasElement the factory owns.
// read() is called every raf tick to update the canvas.

class CustomStage {
  constructor(upstream, factory) {
    this._upstream = upstream;
    this._factory = factory;
    this._canvas = null;
    this._userRead = null;
    this._isShader = false;
  }

  _start() {
    const src = this._upstream._getSource();
    const result = this._factory(src);
    if (!result || typeof result.read !== 'function' || !result.canvas) {
      throw new Error(
        'pipe().use(factory): factory must return { canvas: HTMLCanvasElement, read() }',
      );
    }
    this._canvas = result.canvas;
    this._userRead = result.read.bind(result);
  }

  read() {
    if (this._userRead) this._userRead();
  }

  _getSource() {
    return this._canvas;
  }
  get canvas() {
    return this._canvas;
  }

  _destroy() {
    this._canvas?.remove?.();
    this._canvas = null;
    this._userRead = null;
  }
}

// ── SRT Subtitle stage ────────────────────────────────────────────────────────

function _parseSRT(srt) {
  return srt
    .trim()
    .split(/\n\n+/)
    .map((block) => {
      const lines = block.trim().split('\n');
      if (lines.length < 3) return null;
      const m = lines[1].match(/(\d{2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,.]\d{3})/);
      if (!m) return null;
      const toSec = (s) => {
        const [h, mi, rest] = s.split(':');
        const [sec, ms] = rest.split(/[,.]/).map(Number);
        return Number(h) * 3600 + Number(mi) * 60 + sec + ms / 1000;
      };
      return {
        start: toSec(m[1]),
        end: toSec(m[2]),
        text: lines
          .slice(2)
          .join('\n')
          .replace(/<[^>]+>/g, ''),
      };
    })
    .filter(Boolean);
}

class SubtitleStage {
  constructor(upstream, srtText, opts = {}) {
    this._upstream = upstream;
    this._cues = _parseSRT(srtText);
    this._opts = opts;
    this.canvas = null;
    this._ctx = null;
    this._isShader = false;
  }

  _start() {
    const src = this._upstream._getSource();
    this.canvas = document.createElement('canvas');
    this.canvas.width = _srcWidth(src);
    this.canvas.height = _srcHeight(src);
    this._ctx = this.canvas.getContext('2d');
  }

  _getSource() {
    return this.canvas;
  }

  read() {
    const src = this._upstream._getSource();
    if (!src) return;
    const W = _srcWidth(src),
      H = _srcHeight(src);
    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width = W;
      this.canvas.height = H;
    }
    this._ctx.clearRect(0, 0, W, H);
    this._ctx.drawImage(src, 0, 0, W, H);

    const t = src.currentTime ?? 0;
    const cue = this._cues.find((c) => t >= c.start && t <= c.end);
    if (!cue) return;

    const {
      fontSize = 28,
      color = '#fff',
      bg = 'rgba(0,0,0,0.65)',
      font = 'sans-serif',
      weight = 'bold',
      stroke = true,
      strokeColor = '#000',
      strokeWidth = 1.5,
      marginBottom = 24,
    } = this._opts;

    const ctx = this._ctx;
    const lines = cue.text.split('\n');
    const lineH = fontSize * 1.35;

    ctx.font = `${weight} ${fontSize}px ${font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';

    for (let i = 0; i < lines.length; i++) {
      const txt = lines[i];
      const tw = ctx.measureText(txt).width;
      const tx = W / 2;
      const ty = H - marginBottom - (lines.length - 1 - i) * lineH;

      if (bg) {
        ctx.fillStyle = bg;
        ctx.fillRect(tx - tw / 2 - 10, ty - fontSize - 4, tw + 20, fontSize + 10);
      }
      if (stroke) {
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = strokeWidth;
        ctx.strokeText(txt, tx, ty);
      }
      ctx.fillStyle = color;
      ctx.fillText(txt, tx, ty);
    }
  }

  _destroy() {
    this.canvas = null;
    this._ctx = null;
  }
}

// ── PixelStageBase ────────────────────────────────────────────────────────────
// Shared canvas scaffolding for per-pixel image-data stages (solarize/posterize/
// duotone/grain). Subclasses provide _processPixels(data) and set(props) only.

export class PixelStageBase {
  constructor(upstream) {
    this._upstream = upstream;
    this._canvas = document.createElement('canvas');
    this._ctx = null;
    this._off = document.createElement('canvas');
    this._offCtx = null;
    this._isShader = false;
  }
  _start() {
    const src = this._upstream._getSource();
    const w = _srcWidth(src),
      h = _srcHeight(src);
    this._canvas.width = w;
    this._canvas.height = h;
    this._off.width = w;
    this._off.height = h;
    this._ctx = this._canvas.getContext('2d');
    this._offCtx = this._off.getContext('2d', { willReadFrequently: true });
  }
  read() {
    if (!this._ctx) return;
    const src = this._upstream._getSource();
    if (_isVideo(src) && src.readyState < 2) return;
    const w = this._canvas.width,
      h = this._canvas.height;
    this._offCtx.drawImage(src, 0, 0, w, h);
    const d = this._offCtx.getImageData(0, 0, w, h);
    this._processPixels(d.data);
    this._ctx.putImageData(d, 0, 0);
  }
  _processPixels(_data) {}
  set(_props) {}
  _getSource() {
    return this._canvas;
  }
  get canvas() {
    return this._canvas;
  }
  _destroy() {
    this._canvas.remove();
    this._off.remove();
    this._ctx = null;
    this._offCtx = null;
  }
}

// ── TintStage ────────────────────────────────────────────────────────────────
// Composites a solid color over the upstream frame using 'multiply' blending,
// producing a color-tinted image (dark areas stay dark, light areas take the tint).

class TintStage {
  constructor(upstream, color = '#ffffff') {
    this._upstream = upstream;
    this._color = color;
    this._canvas = document.createElement('canvas');
    this._ctx = null;
    this._isShader = false;
  }
  _start() {
    const src = this._upstream._getSource();
    this._canvas.width = _srcWidth(src);
    this._canvas.height = _srcHeight(src);
    this._ctx = this._canvas.getContext('2d');
  }
  read() {
    if (!this._ctx) return;
    const src = this._upstream._getSource();
    if (_isVideo(src) && src.readyState < 2) return;
    const { width: w, height: h } = this._canvas;
    this._ctx.globalCompositeOperation = 'source-over';
    this._ctx.drawImage(src, 0, 0, w, h);
    this._ctx.globalCompositeOperation = 'multiply';
    this._ctx.fillStyle = this._color;
    this._ctx.fillRect(0, 0, w, h);
    this._ctx.globalCompositeOperation = 'source-over';
  }
  set(props) {
    if (props.color !== undefined) this._color = props.color;
  }
  _getSource() {
    return this._canvas;
  }
  get canvas() {
    return this._canvas;
  }
  _destroy() {
    this._canvas.remove();
    this._ctx = null;
  }
}

// ── MaskStage ─────────────────────────────────────────────────────────────────
// Restrict the upstream frame to a mask drawable's region (ADR 054). Canvas-tier
// analog of Shader/GLShader.mask(): draw upstream, then composite the mask with
// `destination-in`. destination-in respects only the mask's ALPHA, so for
// channel:'luminance' (default) we first convert the mask's luminance → alpha on
// an offscreen canvas — making `.mask(src, {channel})` behave identically whether
// it lands on a GPU shader or this 2D stage. Chaining .mask().mask() = two passes
// = intersection.

class MaskStage {
  constructor(upstream, source, opts = {}) {
    this._upstream = upstream;
    this._source = source;
    this._channel = opts.channel ?? 'luminance';
    this._invert = !!opts.invert;
    this._canvas = document.createElement('canvas');
    this._ctx = null;
    this._mc = document.createElement('canvas'); // offscreen: mask → alpha
    this._mctx = null;
    this._isShader = false;
  }
  _start() {
    const src = this._upstream._getSource();
    this._canvas.width = _srcWidth(src);
    this._canvas.height = _srcHeight(src);
    this._ctx = this._canvas.getContext('2d');
    this._mctx = this._mc.getContext('2d', { willReadFrequently: true });
  }
  read() {
    if (!this._ctx) return;
    const src = this._upstream._getSource();
    if (_isVideo(src) && src.readyState < 2) return;
    const mask = resolveDrawable(this._source) ?? this._source;
    const { width: w, height: h } = this._canvas;

    this._ctx.globalCompositeOperation = 'source-over';
    this._ctx.clearRect(0, 0, w, h);
    this._ctx.drawImage(src, 0, 0, w, h);
    if (!mask) return; // no mask → passthrough

    const alphaMask = this._maskToAlpha(mask, w, h);
    this._ctx.globalCompositeOperation = 'destination-in';
    this._ctx.drawImage(alphaMask, 0, 0, w, h);
    this._ctx.globalCompositeOperation = 'source-over';
  }
  // Render the mask into an offscreen whose ALPHA encodes coverage (per channel/
  // invert), so a plain destination-in cuts correctly.
  _maskToAlpha(mask, w, h) {
    if (this._mc.width !== w || this._mc.height !== h) {
      this._mc.width = w;
      this._mc.height = h;
    }
    this._mctx.globalCompositeOperation = 'source-over';
    this._mctx.clearRect(0, 0, w, h);
    try {
      this._mctx.drawImage(mask, 0, 0, w, h);
    } catch (_) {
      return this._mc;
    }
    const img = this._mctx.getImageData(0, 0, w, h);
    const d = img.data;
    const alphaChannel = this._channel === 'alpha';
    for (let i = 0; i < d.length; i += 4) {
      let m = alphaChannel
        ? d[i + 3] / 255
        : (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) / 255;
      if (this._invert) m = 1 - m;
      d[i + 3] = m * 255; // coverage → alpha; RGB irrelevant for destination-in
    }
    this._mctx.putImageData(img, 0, 0);
    return this._mc;
  }
  set(props) {
    if (props.source !== undefined) this._source = props.source;
    if (props.channel !== undefined) this._channel = props.channel;
    if (props.invert !== undefined) this._invert = !!props.invert;
  }
  _getSource() {
    return this._canvas;
  }
  get canvas() {
    return this._canvas;
  }
  _destroy() {
    this._canvas.remove();
    this._mc.remove();
    this._ctx = null;
    this._mctx = null;
  }
}

// ── NegativeStage ─────────────────────────────────────────────────────────────

class NegativeStage extends FxStage {
  constructor(upstream) {
    super(upstream, 'invert(1)');
  }
}

// ── SolarizeStage ─────────────────────────────────────────────────────────────
// Inverts pixels whose luminance exceeds threshold (optical-printing solarization).

class SolarizeStage extends PixelStageBase {
  constructor(upstream, threshold = 0.5) {
    super(upstream);
    this._threshold = threshold;
  }
  _processPixels(p) {
    const t = this._threshold * 255;
    for (let i = 0; i < p.length; i += 4) {
      const br = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];
      if (br > t) {
        p[i] = 255 - p[i];
        p[i + 1] = 255 - p[i + 1];
        p[i + 2] = 255 - p[i + 2];
      }
    }
  }
  set(props) {
    if (props.threshold !== undefined) this._threshold = props.threshold;
  }
}

// ── PosterizeStage ─────────────────────────────────────────────────────────────
// Reduces each channel to N discrete levels.

class PosterizeStage extends PixelStageBase {
  constructor(upstream, levels = 4) {
    super(upstream);
    this._levels = Math.max(2, levels);
  }
  _processPixels(p) {
    const step = 255 / (this._levels - 1);
    for (let i = 0; i < p.length; i += 4) {
      p[i] = Math.round(Math.round(p[i] / step) * step);
      p[i + 1] = Math.round(Math.round(p[i + 1] / step) * step);
      p[i + 2] = Math.round(Math.round(p[i + 2] / step) * step);
    }
  }
  set(props) {
    if (props.levels !== undefined) this._levels = Math.max(2, props.levels);
  }
}

// ── DuotoneStage ──────────────────────────────────────────────────────────────
// Maps luminance 0→darkColor, 1→lightColor (two-color image).

function _parseHex(color) {
  if (typeof color === 'string' && color.startsWith('#')) {
    const h = color.slice(1);
    if (h.length === 3)
      return [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16)];
    if (h.length === 6)
      return [
        parseInt(h.slice(0, 2), 16),
        parseInt(h.slice(2, 4), 16),
        parseInt(h.slice(4, 6), 16),
      ];
  }
  return [0, 0, 0];
}

class DuotoneStage extends PixelStageBase {
  constructor(upstream, darkColor = '#000000', lightColor = '#ffffff') {
    super(upstream);
    this._dark = _parseHex(darkColor);
    this._light = _parseHex(lightColor);
  }
  _processPixels(p) {
    const [dr, dg, db] = this._dark,
      [lr, lg, lb] = this._light;
    for (let i = 0; i < p.length; i += 4) {
      const luma = (0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2]) / 255;
      p[i] = Math.round(dr + (lr - dr) * luma);
      p[i + 1] = Math.round(dg + (lg - dg) * luma);
      p[i + 2] = Math.round(db + (lb - db) * luma);
    }
  }
  set(props) {
    if (props.darkColor !== undefined) this._dark = _parseHex(props.darkColor);
    if (props.lightColor !== undefined) this._light = _parseHex(props.lightColor);
  }
}

// ── GrainStage ────────────────────────────────────────────────────────────────
// Adds per-pixel luminance noise (film grain).

class GrainStage extends PixelStageBase {
  constructor(upstream, amount = 0.15) {
    super(upstream);
    this._amount = amount;
  }
  _processPixels(p) {
    const n = this._amount * 255;
    for (let i = 0; i < p.length; i += 4) {
      const noise = (Math.random() * 2 - 1) * n;
      p[i] = Math.min(255, Math.max(0, p[i] + noise));
      p[i + 1] = Math.min(255, Math.max(0, p[i + 1] + noise));
      p[i + 2] = Math.min(255, Math.max(0, p[i + 2] + noise));
    }
  }
  set(props) {
    if (props.amount !== undefined) this._amount = props.amount;
  }
}

// ── StrobeStage ───────────────────────────────────────────────────────────────
// Alternates between source frame and black at the given fps rate.

class StrobeStage {
  constructor(upstream, fps = 4) {
    this._upstream = upstream;
    this._fps = fps;
    this._canvas = document.createElement('canvas');
    this._ctx = null;
    this._last = 0;
    this._on = true;
    this._isShader = false;
  }
  _start() {
    const src = this._upstream._getSource();
    this._canvas.width = _srcWidth(src);
    this._canvas.height = _srcHeight(src);
    this._ctx = this._canvas.getContext('2d');
  }
  read() {
    if (!this._ctx) return;
    const src = this._upstream._getSource();
    if (_isVideo(src) && src.readyState < 2) return;
    const now = performance.now();
    const halfPeriod = 500 / this._fps;
    if (now - this._last >= halfPeriod) {
      this._on = !this._on;
      this._last = now;
    }
    const { width: w, height: h } = this._canvas;
    if (this._on) {
      this._ctx.drawImage(src, 0, 0, w, h);
    } else {
      this._ctx.fillStyle = '#000';
      this._ctx.fillRect(0, 0, w, h);
    }
  }
  set(props) {
    if (props.fps !== undefined) this._fps = props.fps;
  }
  _getSource() {
    return this._canvas;
  }
  get canvas() {
    return this._canvas;
  }
  _destroy() {
    this._canvas.remove();
    this._ctx = null;
  }
}

// ── Pipeline ──────────────────────────────────────────────────────────────────

export class Pipeline {
  constructor(head) {
    this._head = head; // InputAdapter
    this._stages = []; // stages added by chain methods
    this._rafId = null;
    this._sentinel = { label: 'pipe' }; // keep-alive token (carries a label
    // so the Signal Graph reads token.label,
    // not 'Object' — ADR 041)
    this._displayCanvas = null; // canvas shown to user (for canvas-terminal sinks)
    this._displayCtx = null;
    // Owner editor — set when constructed during a run. Lets cleanup tear down
    // only this editor's pipelines so running one editor doesn't kill another's
    // live output (routes delegate to pipe internally — same scoping applies).
    this._ownerEditorId = window.__ar_active_editor_id;
    // Owner-scoped teardown via the shared run-scoped handler (ADR 041). Keep-alive
    // is toggled separately by start()/stop() (liveness toggles), so this uses
    // runScoped (no keep-alive), not runScopedOutput.
    this._scoped = runScoped({ owner: this._ownerEditorId, onStop: () => this._destroy() });
    _pipelines.add(this);
  }

  // ── Stage chain methods (each returns `this`) ─────────────────────────────
  // All route through _pushStage to eliminate 4-line boilerplate repetition.

  _pushStage(stage, type, id) {
    stage._id = id ?? `${this._id}-${type}-${this._stages.length}`;
    stage._stageName = type;
    _stageRegistry.set(stage._id, stage);
    this._stages.push(stage);
    notify('pipe:stage-added', { id: this._id, stageId: stage._id, stage: type });
    return this;
  }

  ascii(opts = {}, id) {
    return this._pushStage(new AsciiStage(this._last(), opts), 'ascii', id);
  }
  pixelate(opts = {}, id) {
    return this._pushStage(new PixelateStage(this._last(), opts), 'pixelate', id);
  }
  fx(filter, id) {
    return this._pushStage(new FxStage(this._last(), filter), 'fx', id);
  }
  glshader(body, opts = {}, id) {
    return this._pushStage(new GLShaderStage(this._last(), body, opts), 'glshader', id);
  }
  shader(body, opts = {}, id) {
    return this._pushStage(new ShaderStage(this._last(), body, opts), 'shader', id);
  }

  /** Custom stage — escape hatch. factory(upstream) must return { canvas, read() }. */
  use(factory, id) {
    return this._pushStage(new CustomStage(this._last(), factory), 'custom', id);
  }
  /** Overlay SRT subtitles on the upstream source (video or canvas with .currentTime). */
  subtitle(srtText, opts = {}, id) {
    return this._pushStage(new SubtitleStage(this._last(), srtText, opts), 'subtitle', id);
  }
  /** Tint the frame by compositing a solid color with 'multiply' blending. */
  tint(color = '#ffffff', id) {
    return this._pushStage(new TintStage(this._last(), color), 'tint', id);
  }
  /**
   * Mask the frame to a drawable's region (ADR 054). source: any Drawable Source.
   * opts: { channel: 'luminance'|'alpha', invert }. Chain .mask().mask() to
   * intersect separate sources.
   */
  mask(source, opts = {}, id) {
    return this._pushStage(new MaskStage(this._last(), source, opts), 'mask', id);
  }
  /** Invert all pixel values (photographic negative). */
  negative(id) {
    return this._pushStage(new NegativeStage(this._last()), 'negative', id);
  }
  /** Solarize: invert pixels whose luminance exceeds threshold (0–1). */
  solarize(threshold = 0.5, id) {
    return this._pushStage(new SolarizeStage(this._last(), threshold), 'solarize', id);
  }
  /** Posterize: reduce each channel to n discrete levels. */
  posterize(levels = 4, id) {
    return this._pushStage(new PosterizeStage(this._last(), levels), 'posterize', id);
  }
  /** Duotone: map luminance between two colors (darkColor → lightColor). */
  duotone(darkColor = '#000000', lightColor = '#ffffff', id) {
    return this._pushStage(new DuotoneStage(this._last(), darkColor, lightColor), 'duotone', id);
  }
  /** Add film grain (luminance noise). amount: 0–1. */
  grain(amount = 0.15, id) {
    return this._pushStage(new GrainStage(this._last(), amount), 'grain', id);
  }
  /** Strobe: alternate between source frame and black at fps rate. */
  strobe(fps = 4, id) {
    return this._pushStage(new StrobeStage(this._last(), fps), 'strobe', id);
  }
  /** CSS blur filter. r: radius in px. */
  blur(r = 4, id) {
    return this.fx(`blur(${r}px)`, id);
  }
  /** CSS hue-rotate filter. deg: degrees. */
  hue(deg = 0, id) {
    return this.fx(`hue-rotate(${deg}deg)`, id);
  }

  // ── Live stage mutation (used by route() for temporal control) ────────────

  // Named stage constructors — single source of truth for _createNamedStage and tests.
  static get STAGE_CTORS() {
    return {
      tint: (up, ...a) => new TintStage(up, ...a),
      negative: (up) => new NegativeStage(up),
      solarize: (up, ...a) => new SolarizeStage(up, ...a),
      posterize: (up, ...a) => new PosterizeStage(up, ...a),
      duotone: (up, ...a) => new DuotoneStage(up, ...a),
      grain: (up, ...a) => new GrainStage(up, ...a),
      strobe: (up, ...a) => new StrobeStage(up, ...a),
      blur: (up, r = 4) => new FxStage(up, `blur(${r}px)`),
      hue: (up, d = 0) => new FxStage(up, `hue-rotate(${d}deg)`),
      ascii: (up, o = {}) => new AsciiStage(up, o),
      pixelate: (up, o = {}) => new PixelateStage(up, o),
      fx: (up, f) => new FxStage(up, f),
      mask: (up, source, opts = {}) => new MaskStage(up, source, opts),
    };
  }

  /**
   * Factory: create a stage by type name and args, assign _stageName for mutation.
   * Internal — used by route() for timeline and toggle/remove/clear.
   */
  _createNamedStage(type, args) {
    const ctor = Pipeline.STAGE_CTORS[type];
    if (!ctor) throw new Error(`pipe: unknown stage type '${type}'`);
    return ctor(this._last(), ...args);
  }

  /**
   * Add a named stage to a RUNNING pipeline (called by route() for live timeline).
   * Calls stage._start() immediately since the pipeline RAF is already running.
   */
  _addNamedStage(type, args) {
    if (!this._stageArgCache) this._stageArgCache = new Map();
    this._stageArgCache.set(type, args); // cache for toggle re-add
    const stage = this._createNamedStage(type, args);
    const stageId = `${this._id}-${type}-live-${this._stages.length}`;
    stage._id = stageId;
    stage._stageName = type;
    stage._isShader = stage._isShader ?? false;
    _stageRegistry.set(stageId, stage);
    this._stages.push(stage);
    if (this._rafId) stage._start(); // pipeline running — init the stage immediately
    notify('pipe:stage-added', { id: this._id, stageId, stage: type });
    return stage;
  }

  /** Remove the most-recently-added stage with the given name. */
  _removeNamedStage(name) {
    const idx =
      this._stages.findLastIndex?.((s) => s._stageName === name) ??
      (() => {
        let i = this._stages.length - 1;
        while (i >= 0 && this._stages[i]._stageName !== name) i--;
        return i;
      })();
    if (idx === -1) return;
    const stage = this._stages.splice(idx, 1)[0];
    if (stage._id) _stageRegistry.delete(stage._id);
    try {
      stage._destroy();
    } catch (_) {}
  }

  /** Toggle: add if absent, remove if present (using cached args from last _addNamedStage). */
  _toggleNamedStage(name) {
    const exists = this._stages.some((s) => s._stageName === name);
    if (exists) {
      this._removeNamedStage(name);
    } else {
      const args = this._stageArgCache?.get(name) ?? [];
      this._addNamedStage(name, args);
    }
  }

  /** Remove ALL stages that were added via _addNamedStage (have _stageName set). */
  _clearNamedStages() {
    const named = this._stages.filter((s) => s._stageName);
    for (const stage of named) {
      this._stages.splice(this._stages.indexOf(stage), 1);
      if (stage._id) _stageRegistry.delete(stage._id);
      try {
        stage._destroy();
      } catch (_) {}
    }
  }

  _last() {
    return this._stages.length === 0 ? this._head : this._stages[this._stages.length - 1];
  }

  // ── Sink methods (start the pipeline) ────────────────────────────────────

  /** Spawn a wm window and render the pipeline inside it. */
  show(title, opts = {}) {
    if (opts.id) this._id = opts.id;
    const winId = window.wm?.spawn(title, {
      w: opts.w ?? 700,
      h: opts.h ?? 500,
      html: '',
      transient: true, // run artifact — don't serialize/restore (empties orphan on refresh)
      // Chain caller's onClose (e.g. route._destroy to release its keep-alive) before stop().
      onClose: () => {
        opts.onClose?.();
        this.stop();
      },
      ...(opts.noChrome !== undefined ? { noChrome: opts.noChrome } : {}),
      ...(opts.transparent !== undefined ? { transparent: opts.transparent } : {}),
    });

    if (winId) {
      this.winId = winId;
      this._ownWinId = winId; // window we spawned — close it on _destroy (reset), else it orphans
      const winEl = document.getElementById(winId);
      const body = winEl?.querySelector('.wm-body');
      if (body) {
        body.style.cssText += ';overflow:hidden;padding:0;margin:0;';
        this._mountInContainer(body);
      }
      notify('pipe:show', { id: this._id, winId, title });
    }

    this.start();
    return this;
  }

  /**
   * Mount pipeline output onto a z-plane of a target window (ADR 040 — the global
   * canvas stack is gone). `target` is a Canvas (has .winId) or a window id; `z`
   * defaults to 0. For a bare DOM element use `.to(el)`; for a standalone window
   * use `.show()`.
   */
  layer(target, z = 0) {
    const winId = target && typeof target === 'object' ? target.winId : target;
    const layerCanvas = winId ? window.wm?.layer?.(winId, z, { raster: true }) : null;
    if (layerCanvas) {
      this._displayCanvas = layerCanvas;
      this._displayCtx = layerCanvas.getContext('2d');
    } else {
      console.warn(
        'pipe.layer(target, z): pass a Canvas or window id (ADR 040). Use .show() for a standalone window.',
      );
    }
    this.start();
    return this;
  }

  /** Mount pipeline output into an arbitrary DOM element. */
  to(target) {
    const el = typeof target === 'string' ? document.querySelector(target) : target;
    if (el) this._mountInContainer(el);
    this.start();
    return this;
  }

  /** Start pipeline without any display sink (access output via .canvas). */
  start(opts = {}) {
    if (opts?.id) this._id = opts.id;
    if (this._rafId || this._starting) return this;

    if (this._head._promise) {
      this._starting = true;
      this._head._resolve().then(() => {
        this._starting = false;
        if (!this._stopped) this._doStart();
      });
      return this;
    }

    return this._doStart();
  }

  _doStart() {
    if (this._rafId) return this;

    // Initialise all stages in order
    this._head._start();
    for (const stage of this._stages) stage._start();

    // After all stages are up, size the display canvas to match source output
    // (only if we own it — never resize an external wm.layer/Canvas plane).
    if (this._displayCanvas && this._ownsDisplayCanvas) {
      const src = this._last()._getSource() ?? this._head._getSource();
      if (src) {
        this._displayCanvas.width = _srcWidth(src);
        this._displayCanvas.height = _srcHeight(src);
      }
    }

    // Register sentinel so the idle watcher treats the pipeline as a live output
    this._live = liveOutput(this._sentinel);

    // Drive canvas stages via raf; shader stages self-raf independently
    const loop = () => {
      if (!window.__ar_paused) {
        for (const stage of this._stages) {
          if (!stage._isShader) stage.read();
        }
        // Blit terminal output to display canvas (canvas-terminal pipelines only)
        if (this._displayCtx) {
          const src = this._last()._getSource() ?? this._head._getSource();
          if (src) {
            this._displayCtx.drawImage(
              src,
              0,
              0,
              this._displayCanvas.width,
              this._displayCanvas.height,
            );
          }
        }
      }
      this._rafId = requestAnimationFrame(loop);
    };
    this._rafId = requestAnimationFrame(loop);
    notify(`${this._id}:started`, { id: this._id });
    return this;
  }

  stop() {
    this._stopped = true;
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    this._live?.release();
    notify(`${this._id}:stopped`, { id: this._id });
    return this;
  }

  /** The final canvas output of the pipeline (available after start()). */
  get canvas() {
    return this._last()._getSource() ?? this._head._getSource();
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  _mountInContainer(container) {
    const terminal = this._stages[this._stages.length - 1];
    if (terminal?._isShader) {
      // Shader terminal: render shader canvas directly inside the container —
      // no extra blit step needed. The pipeline raf drives canvas stages upstream.
      terminal._sinkContainer = container;
    } else {
      // Canvas terminal: create a display canvas inside the container and blit
      // the pipeline output to it each frame.
      const dc = document.createElement('canvas');
      dc.style.cssText = 'width:100%;height:100%;display:block;';
      container.appendChild(dc);
      this._displayCanvas = dc;
      this._displayCtx = dc.getContext('2d');
      this._ownsDisplayCanvas = true; // we created it → safe to size/remove (ADR 040)
    }
  }

  _destroy() {
    if (this._destroyed) return; // idempotent; stops dispose()→onStop re-entry
    this._destroyed = true;
    notify('pipe:destroy', { id: this._id });
    this.stop();
    for (const stage of this._stages) {
      if (stage._id) _stageRegistry.delete(stage._id);
      stage._destroy();
    }
    this._stages = [];
    // Only remove displayCanvas if we created it (not an external wm.layer/Canvas plane)
    if (this._displayCanvas && this._ownsDisplayCanvas) {
      this._displayCanvas.remove();
    }
    this._displayCanvas = null;
    this._displayCtx = null;
    this._ownsDisplayCanvas = false;
    // Close the window we spawned so it doesn't orphan across reset/re-run.
    if (this._ownWinId) {
      const id = this._ownWinId;
      this._ownWinId = null;
      window.wm?.remove?.(id, { animate: false });
    }
    _pipelines.delete(this);
    this._scoped?.dispose(); // removes from run-scoped set
  }
}

// ── Public factory ────────────────────────────────────────────────────────────

/**
 * Create a new render pipeline from any visual source.
 *
 * @param {typeof Source[keyof typeof Source]|CameraStream|HTMLVideoElement|HTMLCanvasElement|GLShader|Shader|Layer|Promise} source
 * @returns {Pipeline}
 *
 * @example
 * pipe(Source.camera)
 *   .ascii({ cols: 80, color: '#00ff41', bg: '#0d0208' })
 *   .show('ASCII Cam', { w: 700, h: 500 });
 */
let _pipeIdCounter = 0;

export function pipe(source) {
  if (sourceKind(source) === 'camera') source = window.Camera?.open();
  else if (sourceKind(source) === 'screen') source = openScreenSource(); // Promise<video>
  const p = new Pipeline(new InputAdapter(source));
  p._id = `pipe-${++_pipeIdCounter}`;
  notify('pipe:create', { id: p._id });
  return p;
}

// ── pipe.register — user-extensible named stages ──────────────────────────────
//
// Registers a named pipeline stage so it becomes:
//   • A chainable method on all Pipeline instances: pipe(cam).myStage(opts)
//   • A draggable toolkit entry in the text editor sidebar
//   • A Blockly block (auto-generated from descriptor.fields) draggable in blocks mode
//
// descriptor:
//   label   — display name (default: name)
//   hint    — tooltip text
//   colour  — Blockly block hue (default: 80)
//   fields  — array of field descriptors for auto-block generation:
//             { name, label?, type: 'number'|'color'|'text'|'boolean', default }
//   code    — custom toolkit snippet (auto-generated if omitted)
//
// The factory receives (srcDrawable, opts) — same as .use() but with opts injected.
// Must return { canvas: HTMLCanvasElement, read() }.
//
// Example:
//   pipe.register('glowAscii', (src, opts = {}) => {
//     const canvas = document.createElement('canvas');
//     canvas.width = 800; canvas.height = 600;
//     const ctx = canvas.getContext('2d');
//     return { canvas, read() { /* draw */ } };
//   }, {
//     label: 'Glow ASCII',
//     hint:  'ASCII art with bloom glow',
//     fields: [
//       { name: 'cols',  label: 'cols',  type: 'number', default: 120 },
//       { name: 'color', label: 'color', type: 'color',  default: '#00ff41' },
//     ],
//   });
//
//   pipe(cam).glowAscii({ cols: 120, color: '#00ff41' }).show('Glow', { w: 700, h: 500 });

function _pipeBlockFieldDef(f) {
  if (f.type === 'number') return { type: 'field_number', name: f.name, value: f.default ?? 0 };
  if (f.type === 'color' || f.type === 'colour')
    return { type: 'field_colour', name: f.name, colour: f.default ?? '#ffffff' };
  if (f.type === 'boolean')
    return { type: 'field_checkbox', name: f.name, checked: f.default ?? false };
  return { type: 'field_input', name: f.name, text: String(f.default ?? '') };
}

function _generatePipeBlock(name, label, colour, fields) {
  // Args: %1=camera index, %2..%N+1=user fields, %N+2=title, %N+3=W, %N+4=H
  const fieldMsgs = fields.map((f, i) => `${f.label ?? f.name} %${i + 2}`).join(' ');
  const ti = fields.length + 2; // title arg index
  const sep = fieldMsgs ? ' ' + fieldMsgs : '';
  const definition = {
    type: `pipe_custom_${name}`,
    message0: `pipe camera %1 → ${label}${sep} → window %${ti} %${ti + 1} × %${ti + 2}`,
    args0: [
      { type: 'field_number', name: 'INDEX', value: 0, min: 0, precision: 1 },
      ...fields.map(_pipeBlockFieldDef),
      { type: 'field_input', name: 'TITLE', text: label },
      { type: 'field_number', name: 'W', value: 700, min: 100 },
      { type: 'field_number', name: 'H', value: 500, min: 100 },
    ],
    previousStatement: null,
    nextStatement: null,
    colour,
    tooltip: `${label} pipeline stage`,
  };

  const generator = (b) => {
    const idx = b.getFieldValue('INDEX');
    const opts = {};
    for (const f of fields) {
      const v = b.getFieldValue(f.name);
      opts[f.name] = f.type === 'number' ? Number(v) : v;
    }
    const title = JSON.stringify(b.getFieldValue('TITLE'));
    const w = b.getFieldValue('W');
    const h = b.getFieldValue('H');
    return (
      `const _cam${idx} = await Camera.open({ index: ${idx} });\n` +
      `pipe(_cam${idx}).${name}(${JSON.stringify(opts)}).show(${title}, { w: ${w}, h: ${h} });\n`
    );
  };

  return { definition, generator };
}

pipe.register = function (name, factory, descriptor = {}) {
  const label = descriptor.label ?? name;
  const hint = descriptor.hint ?? `pipe().${name}() — custom pipeline stage`;
  const colour = descriptor.colour ?? 80;
  const fields = descriptor.fields ?? [];
  const blockType = `pipe_custom_${name}`;

  // 1. Add stage method to all Pipeline instances (persists across resets)
  Pipeline.prototype[name] = function (opts = {}) {
    this._stages.push(new CustomStage(this._last(), (src) => factory(src, opts)));
    return this;
  };

  // 2. Build toolkit snippet
  const optsStr = fields.length
    ? `{ ${fields.map((f) => `${f.name}: ${JSON.stringify(f.default ?? '')}`).join(', ')} }`
    : '';
  const code =
    descriptor.code ??
    `const cam = await Camera.open();\npipe(cam)\n  .${name}(${optsStr})\n  .show('${label}', { w: 700, h: 500 });`;
  const cmd = {
    label,
    code,
    hint,
    blockType, // enables drag-into-blocks-mode from text toolkit
    tags: ['pipe', name, 'pipeline', 'custom'],
  };

  // 3. Live toolkit panel insertion (updates any currently-open toolkit windows)
  if (window.__ar_addToolkitEntry) {
    window.__ar_addToolkitEntry('Pipeline', cmd);
  }

  // 4. Blockly block + generator (registered even when no fields — allows blockType drag)
  const blockDef = _generatePipeBlock(name, label, colour, fields);

  // 5. Register block via API registry; skip toolkit if already injected live above
  window.registerAPI?.(`_pipe_${name}`, null, {
    category: 'Pipeline',
    toolkit: window.__ar_addToolkitEntry ? [] : [cmd], // avoid double-add
    blocks: [blockDef],
  });
};

// ── Cleanup (called on every reset via editor-instance.js) ───────────────────

// Manual "destroy matching pipelines" helper (tests + route's frame-route
// teardown call it). Per-instance, owner-filtered reset teardown is also handled
// by run-scoped.js (ADR 041) — each pipeline registers a runScoped handle. This
// helper stays because it owns the residual GLOBAL teardown (_stageRegistry) and
// is exercised directly by tests. Each _destroy() self-removes from _pipelines.
export function cleanupPipelines(editorId) {
  for (const p of [..._pipelines]) {
    if (editorId == null || p._ownerEditorId == null || p._ownerEditorId === editorId) {
      p._destroy();
    }
  }
  if (editorId == null) _stageRegistry.clear();
}

// ── Event bus command handlers ────────────────────────────────────────────────
registerCommand('pipe:destroy', ({ id }) => {
  const p = [..._pipelines].find((p) => p._id === id);
  if (p) p._destroy();
});
registerCommand('pipe:stop', ({ id }) => {
  [..._pipelines].find((p) => p._id === id)?.stop();
});
registerCommand('pipe:start', ({ id }) => {
  [..._pipelines].find((p) => p._id === id)?.start();
});
registerCommand('pipe:stage:set', ({ stageId, ...props }) => {
  _stageRegistry.get(stageId)?.set?.(props);
});
registerCommand('pipe:stage:set-uniform', ({ stageId, name, value }) => {
  const stage = _stageRegistry.get(stageId);
  stage?._shaderInst?.setUniform?.(name, value);
});

// Per-instance, owner-filtered reset teardown is handled by run-scoped.js (ADR
// 041) — each pipeline registers a runScoped handle in its ctor. This residual
// onReset only clears the GLOBAL stage registry on a full (editorId == null)
// reset; cleanupPipelines() remains a manual destroy-all helper for tests.
onReset((editorId) => {
  if (editorId == null) _stageRegistry.clear();
});
