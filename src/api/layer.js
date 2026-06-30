export class Layer {
  #canvas;
  #state;

  constructor(canvas) {
    this.#canvas = canvas;
    this.#state = {
      blur: null,
      hue: null,
      brightness: null,
      saturate: null,
      invert: null,
      rawFilter: null,
      opacity: null,
      blendMode: null,
      rotate: null,
      rotateX: null,
      rotateY: null,
      scale: null,
      perspective: 600,
      clip: null,
    };
  }

  get canvas() {
    return this.#canvas;
  }

  #applyFilter() {
    if (this.#state.rawFilter !== null) {
      this.#canvas.style.filter = this.#state.rawFilter;
      return;
    }
    const s = this.#state;
    const parts = [];
    if (s.blur !== null) parts.push(`blur(${s.blur}px)`);
    if (s.hue !== null) parts.push(`hue-rotate(${s.hue}deg)`);
    if (s.brightness !== null) parts.push(`brightness(${s.brightness})`);
    if (s.saturate !== null) parts.push(`saturate(${s.saturate})`);
    if (s.invert !== null) parts.push(`invert(${s.invert})`);
    this.#canvas.style.filter = parts.join(' ');
  }

  #applyTransform() {
    const s = this.#state;
    const parts = [];
    if (s.rotateX !== null || s.rotateY !== null) parts.push(`perspective(${s.perspective}px)`);
    if (s.rotate !== null) parts.push(`rotate(${s.rotate}deg)`);
    if (s.rotateX !== null) parts.push(`rotateX(${s.rotateX}deg)`);
    if (s.rotateY !== null) parts.push(`rotateY(${s.rotateY}deg)`);
    if (s.scale !== null) parts.push(`scale(${s.scale})`);
    this.#canvas.style.transform = parts.join(' ');
  }

  blur(px) {
    this.#state.blur = px;
    this.#applyFilter();
    return this;
  }
  hue(deg) {
    this.#state.hue = deg;
    this.#applyFilter();
    return this;
  }
  brightness(n) {
    this.#state.brightness = n;
    this.#applyFilter();
    return this;
  }
  saturate(n) {
    this.#state.saturate = n;
    this.#applyFilter();
    return this;
  }
  invert(n) {
    this.#state.invert = n;
    this.#applyFilter();
    return this;
  }
  filter(str) {
    this.#state.rawFilter = str;
    this.#applyFilter();
    return this;
  }

  opacity(n) {
    this.#state.opacity = n;
    this.#canvas.style.opacity = String(n);
    return this;
  }

  rotate(deg) {
    this.#state.rotate = deg;
    this.#applyTransform();
    return this;
  }
  rotateX(deg) {
    this.#state.rotateX = deg;
    this.#applyTransform();
    return this;
  }
  rotateY(deg) {
    this.#state.rotateY = deg;
    this.#applyTransform();
    return this;
  }
  scale(x, y) {
    this.#state.scale = y !== undefined ? `${x}, ${y}` : String(x);
    this.#applyTransform();
    return this;
  }
  perspective(px) {
    this.#state.perspective = px;
    this.#applyTransform();
    return this;
  }

  clip(str) {
    this.#state.clip = str;
    this.#canvas.style.clipPath = str;
    return this;
  }

  blendMode(mode) {
    this.#state.blendMode = mode;
    this.#canvas.style.mixBlendMode = mode;
    return this;
  }

  reset() {
    this.#state = {
      blur: null,
      hue: null,
      brightness: null,
      saturate: null,
      invert: null,
      rawFilter: null,
      opacity: null,
      blendMode: null,
      rotate: null,
      rotateX: null,
      rotateY: null,
      scale: null,
      perspective: 600,
      clip: null,
    };
    this.#canvas.style.filter = '';
    this.#canvas.style.opacity = '';
    this.#canvas.style.mixBlendMode = '';
    this.#canvas.style.transform = '';
    this.#canvas.style.clipPath = '';
    return this;
  }
}

// Mount a managed <canvas> into the layer stack (the canvasWrapper/fsContainer
// stack, or an explicit `container`). Owns the non-GPU half of Shader/GLShader
// init: container resolution, the absolute-fill style, the static→relative fix,
// and a devicePixelRatio ResizeObserver. The caller attaches its own GPU context
// and supplies `onResize(w,h)` for any context-specific resize work. See ADR 010.
//
// Returns { canvas, parent, sizeRef, refCanvas, resizeObserver } — the caller
// keeps resizeObserver to disconnect on its own teardown.
export function mountLayerCanvas({
  z = 30,
  opacity = 1,
  container = null,
  webgpu = false,
  onResize = null,
} = {}) {
  const wrapper = window.__ar_canvasWrapper ?? document.getElementById('canvasWrapper');
  const fsContainer = window.__ar_fsContainer ?? document.getElementById('fsContainer');
  const parent = container ?? fsContainer ?? wrapper;
  const sizeRef = container ?? wrapper ?? parent;
  const refCanvas = (container ?? wrapper)?.querySelector('canvas');

  const canvas = document.createElement('canvas');
  if (webgpu) canvas._ar_webgpu = true; // mirror copy loop skips WebGPU canvases
  canvas.width = refCanvas?.width ?? 1600;
  canvas.height = refCanvas?.height ?? 900;
  Object.assign(canvas.style, {
    position: 'absolute',
    top: '0',
    left: '0',
    width: '100%',
    height: '100%',
    zIndex: String(z),
    opacity: String(opacity),
    pointerEvents: 'none',
  });
  if (container) {
    const pos = getComputedStyle(container).position;
    if (pos === 'static') container.style.position = 'relative';
  }
  parent?.appendChild(canvas);

  const resizeObserver = new ResizeObserver(() => {
    const w = Math.round((sizeRef?.clientWidth ?? 0) * devicePixelRatio) || 1600;
    const h = Math.round((sizeRef?.clientHeight ?? 0) * devicePixelRatio) || 900;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      onResize?.(w, h);
    }
  });
  resizeObserver.observe(sizeRef ?? parent);

  return { canvas, parent, sizeRef, refCanvas, resizeObserver };
}
