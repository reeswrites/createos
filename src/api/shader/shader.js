import { jsToWGSL } from './js-to-wgsl.js';
import { resolveWGSL, library } from '../platform/library.js';
import { onReset } from '../../runtime/reset-registry.js';
import { mountLayerCanvas } from '../visual/layer.js';
import { notify, registerCommand } from '../../events/index.js';
import { acquireCameraRunScoped, acquireMicRunScoped } from '../media/media-lease.js';
import { ShaderLayerBase } from './shader-layer-base.js';

const _shaders = [];
const _shaderRegistry = new Map(); // id → Shader instance (for event bus command handlers)

export function cleanupShaders() {
  for (const s of _shaders) s._destroy();
  _shaders.length = 0;
  _shaderRegistry.clear();
}

// Track the raw viewport pointer (module-level, persists across runs). Each shader
// maps it against ITS OWN canvas rect when writing uniforms (ADR 040 — there is no
// shared editor wrapper anymore, so mouse is per-shader-window). See
// ShaderLayerBase._mouseXY().
document.addEventListener('mousemove', (e) => {
  window.__ar_shaderMouseRaw = { clientX: e.clientX, clientY: e.clientY };
});

// ── Named preset bodies ──────────────────────────────────────────────────────

export const SHADER_PRESETS = {
  gradient: '  let col = vec3f(uv.x, uv.y, sin(time) * 0.5 + 0.5);\n  return vec4f(col, 1.0);',
  plasma:
    '  let r = sin(uv.x * 6.28 + time) * 0.5 + 0.5;\n  let g = sin(uv.y * 6.28 + time * 1.3) * 0.5 + 0.5;\n  let b = sin((uv.x + uv.y) * 6.28 + time * 0.7) * 0.5 + 0.5;\n  return vec4f(r, g, b, 1.0);',
  waves:
    '  let wave = sin(uv.x * 20.0 + time * 3.0) * 0.15;\n  let mask = smoothstep(0.02, 0.0, abs(uv.y - 0.5 - wave));\n  return vec4f(0.2, 0.6, 1.0, mask);',
  circles:
    '  let d = length(uv - vec2f(0.5));\n  let r = sin(d * 30.0 - time * 4.0) * 0.5 + 0.5;\n  return vec4f(r, r * 0.5, 1.0 - r, 1.0);',
  noise:
    '  let p = uv * 8.0 + time;\n  let n = fract(sin(p.x * 127.1 + p.y * 311.7) * 43758.5);\n  return vec4f(n, n * 0.8, n * 0.6, 1.0);',
};

export const CAMERA_PRESETS = {
  greyscale:
    '  let col = textureSample(video, videoSampler, uv);\n  let g = dot(col.rgb, vec3f(0.299, 0.587, 0.114));\n  return vec4f(vec3f(g), 1.0);',
  invert:
    '  let col = textureSample(video, videoSampler, uv);\n  return vec4f(1.0 - col.rgb, 1.0);',
  channel_swap:
    '  let col = textureSample(video, videoSampler, uv);\n  return vec4f(col.g, col.b, col.r, 1.0);',
  posterize:
    '  let col = textureSample(video, videoSampler, uv);\n  let steps = 4.0;\n  return vec4f(floor(col.rgb * steps) / steps, 1.0);',
  scanlines:
    '  let col = textureSample(video, videoSampler, uv);\n  let scan = step(0.5, fract(uv.y * 180.0));\n  return vec4f(col.rgb * scan, 1.0);',
};

// ── WGSL templates ──────────────────────────────────────────────────────────

const VERT_WGSL = /* wgsl */ `
@vertex
fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  var v = array<vec2f, 3>(vec2f(-1,-1), vec2f(3,-1), vec2f(-1,3));
  return vec4f(v[vi], 0.0, 1.0);
}
`;

// Uniform layout (48 bytes / 12 f32s):
//  [0,1]     res      vec2f
//  [2,3]     mouse    vec2f  (normalized 0–1)
//  [4]       time     f32
//  [5,6,7]   padding
//  [8–11]    custom   vec4f
const UNIFORM_WGSL = /* wgsl */ `
struct U {
  res: vec2f,
  mouse: vec2f,
  time: f32,
  _p1: f32, _p2: f32, _p3: f32,
  custom: vec4f,
}
@group(0) @binding(0) var<uniform> u: U;
`;

// Injected when a video/canvas source is provided (fragment-body mode only)
const VIDEO_WGSL = /* wgsl */ `
@group(0) @binding(1) var video: texture_2d<f32>;
@group(0) @binding(2) var videoSampler: sampler;
`;

// Mask pass (ADR 054): a self-contained second-pass module. Multiplies the
// already-rendered canvas by a per-pixel coverage scalar (blend zero/dst=src).
// Its own bind group (uniform for res + mask texture/sampler + params), so it
// never collides with the main shader's video bindings. Samples at fragCoord/res
// — same convention the main shader uses for video, so the mask aligns with it.
const MASK_WGSL = /* wgsl */ `
struct U { res: vec2f, mouse: vec2f, time: f32, _p1: f32, _p2: f32, _p3: f32, custom: vec4f }
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var mask: texture_2d<f32>;
@group(0) @binding(2) var maskSampler: sampler;
struct MP { channel: f32, invert: f32, _pa: f32, _pb: f32 }
@group(0) @binding(3) var<uniform> mp: MP;
@vertex
fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  var v = array<vec2f, 3>(vec2f(-1,-1), vec2f(3,-1), vec2f(-1,3));
  return vec4f(v[vi], 0.0, 1.0);
}
@fragment
fn fs(@builtin(position) fragCoord: vec4f) -> @location(0) vec4f {
  let uv = fragCoord.xy / u.res;
  let mc = textureSample(mask, maskSampler, uv);
  let lum = dot(mc.rgb, vec3f(0.299, 0.587, 0.114));
  var m = select(lum, mc.a, mp.channel > 0.5);
  m = select(m, 1.0 - m, mp.invert > 0.5);
  return vec4f(m, m, m, m);
}
`;

function wrapFragBody(body, hasVideo = false, helpers = []) {
  const helperWGSL = helpers.length ? '\n' + helpers.join('\n\n') + '\n' : '';
  const bodyDeclaresCol = /\blet\s+col\b/.test(body);
  const colLine =
    hasVideo && !bodyDeclaresCol ? '\n  let col    = textureSample(video, videoSampler, uv);' : '';
  return (
    UNIFORM_WGSL +
    (hasVideo ? VIDEO_WGSL : '') +
    helperWGSL +
    /* wgsl */ `
@fragment
fn fs(@builtin(position) fragCoord: vec4f) -> @location(0) vec4f {
  let pos    = fragCoord.xy;
  let uv     = pos / u.res;
  let time   = u.time;
  let res    = u.res;
  let mouse  = u.mouse;
  let custom = u.custom;${colLine}
  ${body}
}`
  );
}

// ── Shader class ────────────────────────────────────────────────────────────

let _shaderIdCounter = 0;

export class Shader extends ShaderLayerBase {
  constructor(
    fragmentBodyOrWGSL,
    { z = 30, opacity = 1.0, video = null, container = null, bind = null } = {},
  ) {
    super();
    this._initBase({ z, opacity, container, videoSrc: video });
    this._id = `shader-${++_shaderIdCounter}`;
    // Accept a JS function — transpiled to WGSL at start() time (after video src is known)
    this._fn = typeof fragmentBodyOrWGSL === 'function' ? fragmentBodyOrWGSL : null;
    this._fragSrc = this._fn ? null : resolveWGSL(fragmentBodyOrWGSL);
    this._bind = bind; // param-alias map forwarded to jsToWGSL (internal; e.g. viz {v:'col.r'})
    this._helpers = []; // WGSL helper fn strings from jsToWGSL
    this._ctx = null;
    this._device = null;
    this._pipeline = null;
    this._uniformBuf = null;
    this._bindGroup = null;
    this._rafId = null;
    this._startTime = null;

    // Video / texture source (WebGPU-specific)
    this._videoTex = null;
    this._videoSampler = null;
    this._videoTexSize = null;

    // Mask second-pass resources (ADR 054) — built lazily on first masked frame
    this._maskTex = null;
    this._maskSampler = null;
    this._maskTexSize = null;
    this._maskPipeline = null;
    this._maskBindGroup = null;
    this._maskParamBuf = null;
    this._maskBuilding = false;

    _shaders.push(this);
    _shaderRegistry.set(this._id, this);
  }

  // ── Video source resolution ──────────────────────────────────────────────
  // _resolveVideoSrc() — inherited from ShaderLayerBase

  _srcSize(src) {
    return [
      src.videoWidth || src.naturalWidth || src.width || 1,
      src.videoHeight || src.naturalHeight || src.height || 1,
    ];
  }

  // ── Init ─────────────────────────────────────────────────────────────────

  async _init() {
    if (!navigator.gpu) throw new Error('WebGPU not supported — use Chrome 113+ or Safari 18+');
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('No WebGPU adapter available');
    this._device = await adapter.requestDevice();

    const { canvas, parent, resizeObserver } = mountLayerCanvas({
      z: this._z,
      opacity: this._opacity,
      container: this._container,
      webgpu: true,
      onResize: (w, h) => {
        if (this._readable) {
          this._readable.width = w;
          this._readable.height = h;
        }
      },
    });
    this._canvas = canvas;
    this._resizeObserver = resizeObserver;

    // 2D readable shadow canvas — updated each frame within shader RAF so drawImage works.
    // Mirror windows read from this instead of the WebGPU canvas (which is unreadable outside its own RAF).
    this._readable = document.createElement('canvas');
    this._readable._ar_shaderReadable = true; // mirror pings this flag to request blits
    this._readable.width = canvas.width;
    this._readable.height = canvas.height;
    Object.assign(this._readable.style, {
      position: 'absolute',
      top: '0',
      left: '0',
      width: '100%',
      height: '100%',
      zIndex: String(this._z),
      opacity: '0',
      pointerEvents: 'none',
    });
    parent?.appendChild(this._readable);

    const format = navigator.gpu.getPreferredCanvasFormat();
    this._ctx = this._canvas.getContext('webgpu');
    this._ctx.configure({ device: this._device, format, alphaMode: 'premultiplied' });
    this._format = format;

    this._uniformBuf = this._device.createBuffer({
      size: 48,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Create sampler if a video source is provided
    if (this._videoSrc) {
      this._videoSampler = this._device.createSampler({
        magFilter: 'linear',
        minFilter: 'linear',
      });
    }

    await this._compilePipeline();
    this._buildBindGroup();
  }

  async _compilePipeline() {
    // JS function path — transpile to WGSL now (video src is known)
    if (this._fn) {
      try {
        const result = jsToWGSL(this._fn, this._bind ? { bind: this._bind } : {});
        this._fragSrc = result.body;
        this._helpers = result.helpers;
        // if fn uses 'col' param, ensure video binding is set up
        if (result.usesCol && !this._videoSrc) {
          console.warn('Shader: fn uses col (video sample) but no video: source was provided');
        }
      } catch (e) {
        throw new Error(`Shader JS→WGSL: ${e.message}`);
      }
    }
    const isFullShader = /@(fragment|vertex|compute)/.test(this._fragSrc ?? '');
    const hasVideo = !!this._videoSrc && !isFullShader;
    const fragWGSL = isFullShader
      ? this._fragSrc
      : wrapFragBody(this._fragSrc, hasVideo, this._helpers);
    const wgsl = isFullShader ? fragWGSL : VERT_WGSL + '\n' + fragWGSL;

    this._device.pushErrorScope('validation');
    const shaderModule = this._device.createShaderModule({ code: wgsl });
    const shaderErr = await this._device.popErrorScope();
    if (shaderErr) {
      notify('shader:error', { id: this._id, error: shaderErr.message, line: null });
      throw new Error(`Shader compile error: ${shaderErr.message}`);
    }
    notify('shader:compile', { id: this._id, type: 'wgsl' });

    this._device.pushErrorScope('validation');
    this._pipeline = this._device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: shaderModule, entryPoint: 'vs' },
      fragment: {
        module: shaderModule,
        entryPoint: 'fs',
        targets: [
          {
            format: this._format,
            blend: {
              color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
              alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            },
          },
        ],
      },
      primitive: { topology: 'triangle-list' },
    });
    const pipeErr = await this._device.popErrorScope();
    if (pipeErr) throw new Error(`Shader pipeline error: ${pipeErr.message}`);
  }

  _buildBindGroup() {
    const entries = [{ binding: 0, resource: { buffer: this._uniformBuf } }];
    if (this._videoTex && this._videoSampler) {
      entries.push({ binding: 1, resource: this._videoTex.createView() });
      entries.push({ binding: 2, resource: this._videoSampler });
    }
    this._bindGroup = this._device.createBindGroup({
      layout: this._pipeline.getBindGroupLayout(0),
      entries,
    });
  }

  // ── Video texture management ─────────────────────────────────────────────

  _ensureVideoTex() {
    const src = this._resolveVideoSrc();
    if (!src) return;
    const [w, h] = this._srcSize(src);
    if (w < 1 || h < 1) return;

    const sizeChanged =
      !this._videoTexSize || this._videoTexSize[0] !== w || this._videoTexSize[1] !== h;

    if (sizeChanged) {
      this._videoTex?.destroy();
      this._videoTex = this._device.createTexture({
        size: [w, h],
        format: 'rgba8unorm',
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_DST |
          GPUTextureUsage.RENDER_ATTACHMENT,
      });
      this._videoTexSize = [w, h];
      this._buildBindGroup();
    }
  }

  _copyVideoFrame() {
    const src = this._resolveVideoSrc();
    if (!src) return;

    // Guard: video element not ready
    if (src instanceof HTMLVideoElement && src.readyState < 2) return;

    this._ensureVideoTex();
    if (!this._videoTex) return;

    try {
      this._device.queue.copyExternalImageToTexture(
        { source: src, flipY: false },
        { texture: this._videoTex, colorSpace: 'srgb' },
        [this._videoTexSize[0], this._videoTexSize[1]],
      );
    } catch (_) {
      // Source not ready this frame — skip silently
    }
  }

  // ── Mask second pass (ADR 054) ─────────────────────────────────────────────

  // Compile the mask pipeline + create its sampler/param buffer once. Async
  // (pipeline creation is async), kicked off from _frame; the mask pass is
  // skipped until _maskPipeline exists (mask appears a frame or two later).
  async _buildMaskResources() {
    if (this._maskBuilding || this._maskPipeline || !this._device) return;
    this._maskBuilding = true;
    try {
      this._maskSampler = this._device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
      this._maskParamBuf = this._device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      const module = this._device.createShaderModule({ code: MASK_WGSL });
      this._maskPipeline = this._device.createRenderPipeline({
        layout: 'auto',
        vertex: { module, entryPoint: 'vs' },
        fragment: {
          module,
          entryPoint: 'fs',
          targets: [
            {
              format: this._format,
              // result = dst * maskColor (per channel) → multiply the framebuffer
              blend: {
                color: { srcFactor: 'zero', dstFactor: 'src', operation: 'add' },
                alpha: { srcFactor: 'zero', dstFactor: 'src-alpha', operation: 'add' },
              },
            },
          ],
        },
        primitive: { topology: 'triangle-list' },
      });
    } catch (e) {
      console.warn('Shader.mask() unavailable:', e.message);
      this._maskPipeline = null;
    } finally {
      this._maskBuilding = false;
    }
  }

  _ensureMaskTex() {
    const src = this._resolveMaskSrc();
    if (!src) return;
    const [w, h] = this._srcSize(src);
    if (w < 1 || h < 1) return;
    const sizeChanged =
      !this._maskTexSize || this._maskTexSize[0] !== w || this._maskTexSize[1] !== h;
    if (sizeChanged) {
      this._maskTex?.destroy();
      this._maskTex = this._device.createTexture({
        size: [w, h],
        format: 'rgba8unorm',
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_DST |
          GPUTextureUsage.RENDER_ATTACHMENT,
      });
      this._maskTexSize = [w, h];
      this._maskBindGroup = null; // rebuilt below with the new texture view
    }
  }

  _copyMaskFrame() {
    const src = this._resolveMaskSrc();
    if (!src) return;
    if (src instanceof HTMLVideoElement && src.readyState < 2) return;
    this._ensureMaskTex();
    if (!this._maskTex) return;
    try {
      this._device.queue.copyExternalImageToTexture(
        { source: src, flipY: false },
        { texture: this._maskTex, colorSpace: 'srgb' },
        [this._maskTexSize[0], this._maskTexSize[1]],
      );
    } catch (_) {}
  }

  // Encode the mask draw into the same frame's encoder, over the same canvas
  // view (loadOp 'load' preserves the main render). Called after the main pass.
  _encodeMaskPass(encoder, view) {
    if (!this._maskPipeline || !this._maskTex) return;
    if (!this._maskBindGroup) {
      this._maskBindGroup = this._device.createBindGroup({
        layout: this._maskPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this._uniformBuf } },
          { binding: 1, resource: this._maskTex.createView() },
          { binding: 2, resource: this._maskSampler },
          { binding: 3, resource: { buffer: this._maskParamBuf } },
        ],
      });
    }
    this._device.queue.writeBuffer(
      this._maskParamBuf,
      0,
      new Float32Array([
        this._maskOpts.channel === 'alpha' ? 1 : 0,
        this._maskOpts.invert ? 1 : 0,
        0,
        0,
      ]),
    );
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view, loadOp: 'load', storeOp: 'store' }],
    });
    pass.setPipeline(this._maskPipeline);
    pass.setBindGroup(0, this._maskBindGroup);
    pass.draw(3);
    pass.end();
  }

  // ── Uniforms ─────────────────────────────────────────────────────────────

  _writeUniforms(time) {
    this._packAudioCustom(); // auto-fill _custom[0..3] from bound signal/analyser (base)

    const c = this._canvas;
    const mo = this._mouseXY();
    const data = new Float32Array(12);
    data[0] = c.width;
    data[1] = c.height;
    data[2] = mo.x / c.width;
    data[3] = mo.y / c.height;
    data[4] = time;
    data[8] = this._custom[0];
    data[9] = this._custom[1];
    data[10] = this._custom[2];
    data[11] = this._custom[3];
    this._device.queue.writeBuffer(this._uniformBuf, 0, data);
  }

  // ── Render loop ──────────────────────────────────────────────────────────

  _frame(ts) {
    if (!this._startTime) this._startTime = ts;
    this._writeUniforms((ts - this._startTime) / 1000);

    if (this._videoSrc) this._copyVideoFrame();

    // Mask second pass (ADR 054): build lazily, upload this frame's mask.
    if (this._maskSrc) {
      if (!this._maskPipeline) this._buildMaskResources();
      this._copyMaskFrame();
    }

    const view = this._ctx.getCurrentTexture().createView();
    const encoder = this._device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        { view, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' },
      ],
    });
    pass.setPipeline(this._pipeline);
    pass.setBindGroup(0, this._bindGroup);
    pass.draw(3);
    pass.end();
    if (this._maskSrc) this._encodeMaskPass(encoder, view);
    this._device.queue.submit([encoder.finish()]);

    // Blit to 2D readable canvas only when a mirror is watching (flag set by mirror RAF, auto-expires)
    if (this._readable?._ar_watched) {
      this._readable._ar_watched = false;
      if (
        this._readable.width !== this._canvas.width ||
        this._readable.height !== this._canvas.height
      ) {
        this._readable.width = this._canvas.width;
        this._readable.height = this._canvas.height;
      }
      try {
        this._readable.getContext('2d').drawImage(this._canvas, 0, 0);
      } catch (_) {}
    }
  }

  // ── Public API ──────────────────────────────────────────────────────────

  start() {
    // Detached (no .mount()/.show()) — spawn our own window so .start() works
    // standalone, as the docs show. (The old editor-output fallback is gone — ADR 040.)
    if (!this._container && !this._ownWinId) return this.show();
    this._registerLive();
    (async () => {
      if (!this._device) await this._init();
      if (this._rafId) return;
      const loop = (ts) => {
        if (!window.__ar_paused) this._frame(ts);
        this._rafId = requestAnimationFrame(loop);
      };
      this._rafId = requestAnimationFrame(loop);
      notify('shader:start', { id: this._id });
    })().catch((e) => {
      console.error('Shader error:', e.message);
      this._releaseLive();
    });
    return this;
  }

  stop() {
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
      notify('shader:stop', { id: this._id });
    }
    return this;
  }

  // video(), set(), setUniform(), bind(), opacity(), z(), get canvas() — inherited from ShaderLayerBase

  _destroy() {
    this.stop();
    this._releaseLive();
    this._closeOwnWin();
    this._resizeObserver?.disconnect();
    this._resizeObserver = null;
    this._readable?.remove();
    this._readable = null;
    this._canvas?.remove();
    this._videoTex?.destroy();
    this._maskTex?.destroy();
    this._maskParamBuf?.destroy();
    this._uniformBuf?.destroy();
    this._device?.destroy();
    this._device = null;
    this._videoTex = null;
    this._videoSampler = null;
    this._videoTexSize = null;
    this._maskTex = null;
    this._maskSampler = null;
    this._maskTexSize = null;
    this._maskPipeline = null;
    this._maskBindGroup = null;
    this._maskParamBuf = null;
  }

  // Save a named WGSL body (or JS arrow fn) to the user library — persists across projects.
  // Equivalent to library.wgsl(name, body).
  static define(name, body) {
    library.wgsl(name, body);
  }
}

// ── ShaderFX — high-level preset helpers ────────────────────────────────────

export class ShaderFX {
  // ── Factory methods (create, don't start — for composing with .start()/.stop()/etc.) ──

  // camOrEffect: CameraStream from Camera.open(), or an effect name string (uses toolbar camera)
  static cameraShader(camOrEffect = 'greyscale', effect = 'greyscale') {
    const isStream = camOrEffect && typeof camOrEffect !== 'string';
    if (!isStream) acquireCameraRunScoped(); // toolbar camera — run-scoped lease
    const src = isStream ? camOrEffect : window.__ar_video;
    const eff = isStream ? effect : camOrEffect;
    return new Shader(CAMERA_PRESETS[eff] ?? CAMERA_PRESETS.greyscale, { video: src });
  }

  static videoShader(src, effect = 'greyscale') {
    return new Shader(CAMERA_PRESETS[effect] ?? CAMERA_PRESETS.greyscale, { video: src });
  }

  static presetShader(name = 'plasma') {
    return new Shader(SHADER_PRESETS[name] ?? SHADER_PRESETS.plasma);
  }

  static windowShader(name = 'editor', effect = 'greyscale') {
    // ADR 040: the global canvas is gone — 'canvas' source no longer resolves.
    // To shade a Canvas, use `new Shader(body).mount(myCanvas)` instead.
    const SELECTORS = { editor: '.CodeMirror', console: '#console' };
    const src = window.captureWindow?.(SELECTORS[name] ?? SELECTORS.editor);
    return new Shader(CAMERA_PRESETS[effect] ?? CAMERA_PRESETS.greyscale, { video: src });
  }

  static micVizShader(effect = 'greyscale') {
    acquireMicRunScoped();
    const src = window.__ar_mic_viz ?? null;
    return new Shader(CAMERA_PRESETS[effect] ?? CAMERA_PRESETS.greyscale, { video: src });
  }

  // ── Shorthand (create + start in one call) ──

  // camOrEffect: CameraStream or effect string
  static camera(camOrEffect = 'greyscale', effect = 'greyscale') {
    return ShaderFX.cameraShader(camOrEffect, effect).start();
  }
  static video(src, effect = 'greyscale') {
    return ShaderFX.videoShader(src, effect).start();
  }
  static preset(name = 'plasma') {
    return ShaderFX.presetShader(name).start();
  }
  static window(name = 'editor', effect = 'greyscale') {
    return ShaderFX.windowShader(name, effect).start();
  }
  static micViz(effect = 'greyscale') {
    return ShaderFX.micVizShader(effect).start();
  }
}

// ── Event bus command handlers ─────────────────────────────────────────────────
// _shaderRegistry stores both Shader (WGSL) and GLShader (WebGL) instances so one
// set of handlers covers both. GLShader registers via registerShaderInstance() below.
export function registerShaderInstance(id, instance) {
  _shaderRegistry.set(id, instance);
}
registerCommand('shader:start', ({ id }) => {
  _shaderRegistry.get(id)?.start();
});
registerCommand('shader:stop', ({ id }) => {
  _shaderRegistry.get(id)?.stop();
});
registerCommand('shader:uniform', ({ id, key, value }) => {
  _shaderRegistry.get(id)?.set(key, value);
});
// Live mask swap/update from outside a shader's own code (ADR 054): another
// editor pane / UI panel passes a live drawable through the in-process bus.
registerCommand('shader:mask', ({ id, source, opts }) => {
  _shaderRegistry.get(id)?.mask(source, opts);
});

// Register teardown with the reset registry (ADR 008).
onReset(cleanupShaders);
