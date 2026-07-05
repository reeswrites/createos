// WebGL/GLSL shader — same API surface as Shader (WebGPU/WGSL).
// Use when: porting ShaderToy code, running on browsers without WebGPU (Firefox/older Safari),
// or when an LLM generates GLSL because it has a much larger GLSL training corpus.

import { resolveGLSL, library } from '../platform/library.js';
import { mountLayerCanvas } from '../visual/layer.js';
import { onReset } from '../../runtime/reset-registry.js';
import { notify } from '../../events/index.js';
import { registerShaderInstance } from './shader.js';
import { acquireMicRunScoped } from '../media/media-lease.js';
import { ShaderLayerBase } from './shader-layer-base.js';

const _glShaders = [];

let _glShaderIdCounter = 0;

export function cleanupGLShaders() {
  for (const s of _glShaders) s._destroy();
  _glShaders.length = 0;
}

// GLSL fragment-body presets (analogous to SHADER_PRESETS in shader.js)
export const GLSL_PRESETS = {
  gradient: `  gl_FragColor = vec4(uv.x, uv.y, sin(uTime)*0.5+0.5, 1.0);`,
  plasma: `  float r = sin(uv.x*6.28+uTime)*0.5+0.5;
  float g = sin(uv.y*6.28+uTime*1.3)*0.5+0.5;
  float b = sin((uv.x+uv.y)*6.28+uTime*0.7)*0.5+0.5;
  gl_FragColor = vec4(r, g, b, 1.0);`,
  waves: `  float wave = sin(uv.x*20.0+uTime*3.0)*0.15;
  float mask = smoothstep(0.02,0.0,abs(uv.y-0.5-wave));
  gl_FragColor = vec4(0.2,0.6,1.0,mask);`,
  circles: `  float d = length(uv-vec2(0.5));
  float r = sin(d*30.0-uTime*4.0)*0.5+0.5;
  gl_FragColor = vec4(r, r*0.5, 1.0-r, 1.0);`,
  noise: `  vec2 p = uv*8.0+uTime;
  float n = fract(sin(p.x*127.1+p.y*311.7)*43758.5);
  gl_FragColor = vec4(n, n*0.8, n*0.6, 1.0);`,
};

// GLSL camera/video effect presets (same effects as CAMERA_PRESETS in shader.js)
export const GLSL_CAMERA_PRESETS = {
  greyscale: `  vec4 c = texture2D(uVideo,uv); float g=dot(c.rgb,vec3(0.299,0.587,0.114)); gl_FragColor=vec4(vec3(g),1.0);`,
  invert: `  vec4 c = texture2D(uVideo,uv); gl_FragColor=vec4(1.0-c.rgb,1.0);`,
  channel_swap: `  vec4 c = texture2D(uVideo,uv); gl_FragColor=vec4(c.g,c.b,c.r,1.0);`,
  posterize: `  vec4 c = texture2D(uVideo,uv); float s=4.0; gl_FragColor=vec4(floor(c.rgb*s)/s,1.0);`,
  scanlines: `  vec4 c = texture2D(uVideo,uv); float sc=step(0.5,fract(uv.y*180.0)); gl_FragColor=vec4(c.rgb*sc,1.0);`,
};

// ── GLSL source classification ───────────────────────────────────────────────

function _isFullGLSL(src) {
  return /void\s+main\s*\(/.test(src) || src.trimStart().startsWith('#version');
}

function _isShaderToy(src) {
  // ShaderToy: void mainImage(out vec4 fragColor, in vec2 fragCoord)
  return /void\s+mainImage\s*\(/.test(src);
}

// ── GLSL source assembly ─────────────────────────────────────────────────────

const VERT_GLSL = `
attribute vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const UNIFORM_HEADER = `precision highp float;
uniform vec2 uResolution;
uniform vec2 uMouse;
uniform float uTime;
uniform vec4 uCustom;
`;

function _wrapFragBody(body, hasVideo = false) {
  const videoLine = hasVideo ? 'uniform sampler2D uVideo;\n' : '';
  const colLine = hasVideo ? '  vec4 col = texture2D(uVideo, uv);\n' : '';
  return `${UNIFORM_HEADER}${videoLine}void main() {
  vec2 uv   = gl_FragCoord.xy / uResolution;
  float time  = uTime;
  vec2 mouse  = uMouse;
  vec4 custom = uCustom;
${colLine}${body}
}`;
}

// ShaderToy shaders define mainImage(out vec4, in vec2) — wrap to call from main()
function _wrapShaderToy(body) {
  return `${UNIFORM_HEADER}${body}
void main() {
  mainImage(gl_FragColor, gl_FragCoord.xy);
}`;
}

// Mask pass (ADR 054): a second full-screen draw that multiplies the already-
// rendered framebuffer by a per-pixel coverage scalar. channel/invert are
// uniforms (no recompile on change). Sampled at gl_FragCoord/res, matching how
// the main shader samples uVideo (same texture origin convention).
const MASK_FRAG_GLSL = `precision highp float;
uniform sampler2D uMask;
uniform vec2 uResolution;
uniform float uMaskChannel; // 0 = luminance, 1 = alpha
uniform float uMaskInvert;  // 0 or 1
void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  vec4 mc = texture2D(uMask, uv);
  float lum = dot(mc.rgb, vec3(0.299, 0.587, 0.114));
  float m = mix(lum, mc.a, step(0.5, uMaskChannel));
  m = mix(m, 1.0 - m, step(0.5, uMaskInvert));
  gl_FragColor = vec4(m, m, m, m);
}`;

// ── GLShader class ───────────────────────────────────────────────────────────

export class GLShader extends ShaderLayerBase {
  constructor(fragBody, { z = 30, opacity = 1.0, video = null, container = null } = {}) {
    super();
    this._initBase({ z, opacity, container, videoSrc: video });
    this._id = `glsl-${++_glShaderIdCounter}`;
    this._fragSrc = resolveGLSL(fragBody);

    // WebGL-specific state
    this._gl = null;
    this._program = null;
    this._rafId = null;
    this._startTime = null;
    this._videoTex = null;
    this._buf = null;
    this._maskTex = null; // second-pass mask texture (ADR 054)
    this._maskProgram = null;

    _glShaders.push(this);
    registerShaderInstance(this._id, this); // register in shared shader registry for event bus commands
  }

  // ── Video source resolution ──────────────────────────────────────────────
  // _resolveVideoSrc() — inherited from ShaderLayerBase

  // ── Init ─────────────────────────────────────────────────────────────────

  _init() {
    const { canvas, resizeObserver } = mountLayerCanvas({
      z: this._z,
      opacity: this._opacity,
      container: this._container,
      onResize: (w, h) => this._gl?.viewport(0, 0, w, h),
    });
    this._canvas = canvas;
    this._resizeObserver = resizeObserver;

    this._gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!this._gl) throw new Error('WebGL not supported in this browser');

    this._compilePipeline();
  }

  // ── Shader compilation ───────────────────────────────────────────────────

  _compileShader(type, src) {
    const gl = this._gl;
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const info = gl.getShaderInfoLog(s);
      gl.deleteShader(s);
      notify('shader:error', { id: this._id, error: info, line: null });
      throw new Error(`GLShader compile error:\n${info}`);
    }
    return s;
  }

  _compilePipeline() {
    const gl = this._gl;
    const hasVideo = !!this._videoSrc;

    let fragSrc;
    if (_isShaderToy(this._fragSrc)) {
      fragSrc = _wrapShaderToy(this._fragSrc);
    } else if (_isFullGLSL(this._fragSrc)) {
      fragSrc = this._fragSrc;
    } else {
      fragSrc = _wrapFragBody(this._fragSrc, hasVideo);
    }

    const vert = this._compileShader(gl.VERTEX_SHADER, VERT_GLSL);
    const frag = this._compileShader(gl.FRAGMENT_SHADER, fragSrc);

    this._program = gl.createProgram();
    gl.attachShader(this._program, vert);
    gl.attachShader(this._program, frag);
    gl.linkProgram(this._program);
    gl.deleteShader(vert);
    gl.deleteShader(frag);
    if (!gl.getProgramParameter(this._program, gl.LINK_STATUS)) {
      const linkInfo = gl.getProgramInfoLog(this._program);
      notify('shader:error', { id: this._id, error: linkInfo, line: null });
      throw new Error(`GLShader link error: ${linkInfo}`);
    }
    notify('shader:compile', { id: this._id, type: 'glsl' });

    // Full-screen triangle (same topology as WGSL Shader). Kept on `this` so the
    // mask pass can rebind it for its own draw.
    const buf = (this._buf = gl.createBuffer());
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const posLoc = gl.getAttribLocation(this._program, 'position');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    // Cache uniform locations
    gl.useProgram(this._program);
    this._uResolution = gl.getUniformLocation(this._program, 'uResolution');
    this._uMouse = gl.getUniformLocation(this._program, 'uMouse');
    this._uTime = gl.getUniformLocation(this._program, 'uTime');
    this._uCustom = gl.getUniformLocation(this._program, 'uCustom');
    this._uVideo = gl.getUniformLocation(this._program, 'uVideo');

    // Video texture
    if (hasVideo) {
      this._videoTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this._videoTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    }

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  // ── Frame upload ─────────────────────────────────────────────────────────

  // Shared texture-upload leaf — one copy for video, one for the mask (ADR 054).
  _copyFrameToTexture(tex, src) {
    if (!src || !tex) return;
    if (src instanceof HTMLVideoElement && src.readyState < 2) return;
    const gl = this._gl;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    } catch (_) {}
  }

  _copyVideoFrame() {
    this._copyFrameToTexture(this._videoTex, this._resolveVideoSrc());
  }

  // ── Mask pass (ADR 054) ────────────────────────────────────────────────────

  // Lazily compile the mask program + texture on first masked frame. Returns
  // false (and warns once) if compilation fails, so a bad mask never kills the
  // main shader.
  _ensureMask() {
    if (this._maskProgram === false) return false; // failed earlier
    if (this._maskProgram) return true;
    const gl = this._gl;
    try {
      const vert = this._compileShader(gl.VERTEX_SHADER, VERT_GLSL);
      const frag = this._compileShader(gl.FRAGMENT_SHADER, MASK_FRAG_GLSL);
      const prog = gl.createProgram();
      gl.attachShader(prog, vert);
      gl.attachShader(prog, frag);
      gl.linkProgram(prog);
      gl.deleteShader(vert);
      gl.deleteShader(frag);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
        throw new Error(gl.getProgramInfoLog(prog));
      this._maskProgram = prog;
      this._maskLoc = {
        position: gl.getAttribLocation(prog, 'position'),
        uMask: gl.getUniformLocation(prog, 'uMask'),
        uResolution: gl.getUniformLocation(prog, 'uResolution'),
        uMaskChannel: gl.getUniformLocation(prog, 'uMaskChannel'),
        uMaskInvert: gl.getUniformLocation(prog, 'uMaskInvert'),
      };
      this._maskTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this._maskTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      return true;
    } catch (e) {
      console.warn('GLShader.mask() unavailable:', e.message);
      this._maskProgram = false;
      return false;
    }
  }

  // Second full-screen draw: multiply the rendered framebuffer by the mask.
  _maskPass() {
    if (!this._resolveMaskSrc() || !this._ensureMask()) return;
    const gl = this._gl;
    const c = this._canvas;
    this._copyFrameToTexture(this._maskTex, this._resolveMaskSrc());

    gl.useProgram(this._maskProgram);
    gl.bindBuffer(gl.ARRAY_BUFFER, this._buf);
    gl.enableVertexAttribArray(this._maskLoc.position);
    gl.vertexAttribPointer(this._maskLoc.position, 2, gl.FLOAT, false, 0, 0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._maskTex);
    if (this._maskLoc.uMask) gl.uniform1i(this._maskLoc.uMask, 0);
    if (this._maskLoc.uResolution) gl.uniform2f(this._maskLoc.uResolution, c.width, c.height);
    if (this._maskLoc.uMaskChannel)
      gl.uniform1f(this._maskLoc.uMaskChannel, this._maskOpts.channel === 'alpha' ? 1 : 0);
    if (this._maskLoc.uMaskInvert)
      gl.uniform1f(this._maskLoc.uMaskInvert, this._maskOpts.invert ? 1 : 0);

    // dst *= mask (per channel), then restore normal over-blend
    gl.blendFunc(gl.ZERO, gl.SRC_COLOR);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  // ── Uniforms ─────────────────────────────────────────────────────────────

  _writeUniforms(time) {
    this._packAudioCustom(); // auto-fill _custom[0..3] from bound signal/analyser (base)

    const gl = this._gl;
    const c = this._canvas;
    const mo = this._mouseXY();
    if (this._uResolution) gl.uniform2f(this._uResolution, c.width, c.height);
    if (this._uMouse) gl.uniform2f(this._uMouse, mo.x / c.width, mo.y / c.height);
    if (this._uTime) gl.uniform1f(this._uTime, time);
    if (this._uCustom) gl.uniform4fv(this._uCustom, this._custom);
    if (this._videoTex && this._uVideo) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this._videoTex);
      gl.uniform1i(this._uVideo, 0);
    }
  }

  // ── Render loop ──────────────────────────────────────────────────────────

  _frame(ts) {
    if (!this._startTime) this._startTime = ts;
    const gl = this._gl;
    if (this._videoSrc) this._copyVideoFrame();
    gl.useProgram(this._program);
    this._writeUniforms((ts - this._startTime) / 1000);
    gl.viewport(0, 0, this._canvas.width, this._canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (this._maskSrc) this._maskPass();
  }

  // ── Public API (mirrors Shader) ──────────────────────────────────────────

  start() {
    // Detached (no .mount()/.show()) — spawn our own window so .start() works
    // standalone, as the docs show. (The old editor-output fallback is gone — ADR 040.)
    if (!this._container && !this._ownWinId) return this.show();
    this._registerLive();
    if (!this._gl) {
      try {
        this._init();
      } catch (e) {
        console.error('GLShader error:', e.message);
        this._releaseLive();
        return this;
      }
    }
    if (this._rafId) return this;
    const loop = (ts) => {
      if (!window.__ar_paused) this._frame(ts);
      this._rafId = requestAnimationFrame(loop);
    };
    this._rafId = requestAnimationFrame(loop);
    notify('shader:start', { id: this._id });
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

  // video(), set(), setUniform(), opacity(), z(), get canvas() — inherited from ShaderLayerBase

  // Override bind() to also acquire a mic media lease when 'mic' is passed.
  bind(source) {
    if (source === 'mic') acquireMicRunScoped();
    return super.bind(source);
  }

  _destroy() {
    this.stop();
    this._releaseLive();
    this._closeOwnWin();
    this._resizeObserver?.disconnect();
    this._resizeObserver = null;
    if (this._gl) {
      if (this._videoTex) this._gl.deleteTexture(this._videoTex);
      if (this._maskTex) this._gl.deleteTexture(this._maskTex);
      if (this._program) this._gl.deleteProgram(this._program);
      if (this._maskProgram) this._gl.deleteProgram(this._maskProgram);
    }
    this._canvas?.remove();
    this._canvas = null;
    this._gl = null;
    this._program = null;
    this._videoTex = null;
    this._maskTex = null;
    this._maskProgram = null;
    this._buf = null;
  }

  // Save a named GLSL body to the user library — persists across projects.
  // Equivalent to library.glsl(name, body).
  static define(name, body) {
    library.glsl(name, body);
  }
}

// Register teardown with the reset registry (ADR 008).
onReset(cleanupGLShaders);
