// shader-layer-base.js — shared non-GPU half of Shader (WebGPU/WGSL) and
// GLShader (WebGL/GLSL). Extracts the methods and state that were previously
// duplicated byte-for-byte between the two classes.
//
// Factored out by the same logic as ADR 010's mountLayerCanvas — the canvas-mount
// seam was already extracted; this finishes the job for the audio/bind/uniform half.
//
// Subclasses supply: constructor (calls _initBase), _writeUniforms(time) (calls
// _packAudioCustom() then uploads to GPU), start()/stop()/_destroy() (GPU lifecycle).
// ShaderLayerBase provides: video-source resolution, set/setUniform, bind/audio-pack,
// opacity/z, canvas getter, and liveness helpers.

import { readAnalyser, bands } from '../audio/analyser-read.js';
import { resolveDrawable } from '../visual/drawable-source.js';
import { isBandsSignal } from '../signal/signal-shape.js';
import { liveOutput } from '../../runtime/keep-alive.js';
import { notify } from '../../events/index.js';

export class ShaderLayerBase {
  // ── Shared constructor state ─────────────────────────────────────────────
  // Subclass constructors call this._initBase({z, opacity, container, videoSrc}).
  _initBase({ z = 30, opacity = 1.0, container = null, videoSrc = null } = {}) {
    this._z = z;
    this._opacity = opacity;
    this._container = container;
    this._canvas = null;
    this._custom = new Float32Array(4);
    this._uniforms = {}; // named uniform store for route swizzle reads
    this._boundSignal = null; // audio.signal() obj
    this._boundAnalyser = null; // Tone.Analyser | AnalyserNode | 'mic'
    this._videoSrc = videoSrc;
    this._maskSrc = null; // dynamic mask drawable (ADR 054)
    this._maskOpts = { channel: 'luminance', invert: false };
    this._live = null; // liveOutput handle
  }

  // ── Video source ─────────────────────────────────────────────────────────

  // Shared object-form resolver (ADR 006); `?? this._videoSrc` keeps the
  // permissive passthrough for exotic GPU-uploadable sources (ImageBitmap…).
  _resolveVideoSrc() {
    return resolveDrawable(this._videoSrc) ?? this._videoSrc ?? null;
  }

  video(src) {
    this._videoSrc = src;
    return this;
  }

  // ── Mask source (ADR 054) ──────────────────────────────────────────────────
  //
  // Restrict this layer to the region defined by a live Drawable Source's pixels.
  // Masking is a SECOND full-screen pass (multiply the rendered framebuffer by a
  // per-pixel coverage scalar) — never a fragment-source injection — so it works
  // on every shader form (body / ShaderToy / full-source) identically. The mask
  // texture lives in that second pass's own program/pipeline, so there is no
  // binding collision with the video texture.
  //
  //   channel: 'luminance' (default) | 'alpha' — how a source pixel → scalar
  //   invert:  false — flip the coverage (m → 1 - m)
  //
  // `.mask(null)` (or no arg) clears the mask; the second pass is skipped.
  // Single mask per layer (last-wins). Intersect separate sources via the
  // pipeline: pipe(cam).mask(a).mask(b) chains two multiply passes.
  mask(source = null, { channel = 'luminance', invert = false } = {}) {
    this._maskSrc = source;
    this._maskOpts = { channel, invert };
    return this;
  }

  // Resolve the mask drawable (same permissive passthrough as video).
  _resolveMaskSrc() {
    return this._maskSrc ? (resolveDrawable(this._maskSrc) ?? this._maskSrc) : null;
  }

  // ── Custom vec4 uniform ──────────────────────────────────────────────────

  // Set custom uniform by index (0–3) or whole-array.
  // Accessible as `custom` in both WGSL and GLSL shader bodies.
  set(indexOrArray, value) {
    if (Array.isArray(indexOrArray)) {
      for (let i = 0; i < 4; i++) this._custom[i] = indexOrArray[i] ?? 0;
    } else {
      this._custom[indexOrArray] = value;
    }
    notify('shader:uniform', { id: this._id, key: indexOrArray, value });
    return this;
  }

  // Named uniform write — makes route().to(shader, 'uCustom.x') work (ADR 025).
  //
  // 'uCustom' / 'custom' → unpack {x,y,z,w} into _custom via set(); value is also
  // stored in _uniforms so route's read-modify-write swizzle can read the current
  //   state (via getUniform()) before updating one component. Other names are
  //   stored in _uniforms for forward-compat but only reach the GPU if explicitly
  //   declared in the shader.
  //
  // ⚠️  Mutual exclusion: bind() and setUniform('uCustom') conflict —
  //   _packAudioCustom() overwrites _custom[0..3] every frame when a source is
  //   bound, so route-driven setUniform writes will be silently overridden.
  //   Do not use both on the same shader instance.
  setUniform(name, val) {
    if (name === 'uCustom' || name === 'custom') {
      const v = { x: 0, y: 0, z: 0, w: 0, ...val };
      this._uniforms.uCustom = v;
      this.set([v.x, v.y, v.z, v.w]);
    } else {
      this._uniforms[name] = val;
    }
    return this;
  }

  // Read twin of setUniform — the owned seam route's swizzle reads through
  // (instead of poking _uniforms directly). Vector names default to a zeroed
  // {x,y,z,w} so a read-modify-write of one component never writes garbage.
  getUniform(name) {
    if (name === 'uCustom' || name === 'custom') {
      return this._uniforms.uCustom ?? { x: 0, y: 0, z: 0, w: 0 };
    }
    return this._uniforms[name];
  }

  // ── Audio binding ────────────────────────────────────────────────────────

  // Bind an audio source → auto-fills custom = [rms, bass, mid, high] every frame.
  // source: audio.signal() obj | Tone.Analyser | Web Audio AnalyserNode | 'mic'
  // GLShader overrides to add acquireMicRunScoped() for 'mic' (run-scoped media lease).
  bind(source) {
    if (isBandsSignal(source)) {
      this._boundSignal = source;
      this._boundAnalyser = null;
    } else {
      this._boundSignal = null;
      this._boundAnalyser = source;
    }
    return this;
  }

  // Pack _custom[0..3] = [rms, bass, mid, high] from the bound audio source.
  // Called at the start of each subclass's _writeUniforms() before GPU upload.
  _packAudioCustom() {
    if (this._boundSignal) {
      const s = this._boundSignal;
      this._custom[0] = s.value ?? 0;
      this._custom[1] = s.bass ?? 0;
      this._custom[2] = s.mid ?? 0;
      this._custom[3] = s.high ?? 0;
    } else if (this._boundAnalyser) {
      const b = bands(readAnalyser(this._boundAnalyser, 32));
      this._custom[0] = b.value;
      this._custom[1] = b.bass;
      this._custom[2] = b.mid;
      this._custom[3] = b.high;
    }
  }

  // ── Canvas style ─────────────────────────────────────────────────────────

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

  get canvas() {
    return this._canvas;
  }

  // Pointer in THIS shader's canvas-pixel space (ADR 040). Maps the raw viewport
  // pointer (set by shader.js's mousemove listener) against this canvas's own
  // on-screen rect — so `mouse` is correct in whatever window the shader mounts in.
  _mouseXY() {
    const raw = window.__ar_shaderMouseRaw;
    const c = this._canvas;
    if (!raw || !c) return { x: 0, y: 0 };
    const r = c.getBoundingClientRect();
    if (!r.width || !r.height) return { x: 0, y: 0 };
    return {
      x: ((raw.clientX - r.left) / r.width) * c.width,
      y: ((raw.clientY - r.top) / r.height) * c.height,
    };
  }

  // ── Mount / show (ADR 040) ─────────────────────────────────────────────────
  // Render this shader as a plane in a window's layer stack. Replaces the old
  // fall-back-to-editor-output-window behavior (which is gone with global draw).
  //
  //   .mount(target[, z]) — the primitive: mount onto an existing window. target
  //                         is a Canvas (has .winId), a window id, or a DOM element.
  //   .show(opts)         — sugar: spawn a bare window and mount into it (standalone).
  mount(target, z) {
    if (z !== undefined) this._z = z;
    let el = null;
    if (target && typeof target === 'object' && target.winId) {
      el = document.getElementById(target.winId)?.querySelector('.wm-body') ?? null;
    } else if (typeof target === 'string') {
      el =
        document.getElementById(target)?.querySelector('.wm-body') ??
        document.querySelector(target);
    } else if (target instanceof HTMLElement) {
      el = target;
    }
    if (el) this._container = el;
    return this.start();
  }

  show(opts = {}) {
    const { title = 'Shader', w = 700, h = 500 } = opts;
    const winId = window.wm?.spawn(title, {
      w,
      h,
      html: '',
      transient: true,
      onClose: () => this._destroy(),
      ...(opts.noChrome !== undefined ? { noChrome: opts.noChrome } : {}),
      ...(opts.transparent !== undefined ? { transparent: opts.transparent } : {}),
    });
    this._ownWinId = winId ?? null;
    const body = winId ? document.getElementById(winId)?.querySelector('.wm-body') : null;
    if (body) this._container = body;
    return this.start();
  }

  // Close the window we spawned via show() (call from subclass _destroy so it
  // doesn't orphan across reset/re-run). Idempotent.
  _closeOwnWin() {
    if (this._ownWinId) {
      const id = this._ownWinId;
      this._ownWinId = null;
      window.wm?.remove?.(id, { animate: false });
    }
  }

  // ── Liveness helpers ──────────────────────────────────────────────────────
  // start() calls _registerLive(); error paths + _destroy() call _releaseLive().

  _registerLive() {
    this._live = liveOutput(this);
  }
  _releaseLive() {
    this._live?.release();
    this._live = null;
  }
}
