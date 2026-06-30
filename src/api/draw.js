import { resolveDrawable } from './drawable-source.js';
import { onReset } from '../runtime/reset-registry.js';
import { liveOutput } from '../runtime/keep-alive.js';
import { acquireCameraRunScoped } from './media-lease.js';

const _backdrops = [];

// ── Fit helper (cover / contain / stretch) ────────────────────────────────────
function _drawFit(canvas, src, fit) {
  const ctx = canvas.getContext('2d');
  const cw = canvas.width, ch = canvas.height;
  const sw = src.videoWidth ?? src.naturalWidth  ?? src.width  ?? cw;
  const sh = src.videoHeight ?? src.naturalHeight ?? src.height ?? ch;
  if (!sw || !sh) return;
  if (fit === 'stretch') {
    ctx.drawImage(src, 0, 0, cw, ch);
  } else {
    const scale = fit === 'cover'
      ? Math.max(cw / sw, ch / sh)
      : Math.min(cw / sw, ch / sh);
    const dw = sw * scale, dh = sh * scale;
    ctx.drawImage(src, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
  }
}

export function cleanupBackdrops() {
  _backdrops.forEach(h => h.stop?.());
  _backdrops.length = 0;
}

export class DrawTarget {
  #z;
  #gc;

  constructor(z, getLayerCanvas) {
    this.#z = z;
    this.#gc = getLayerCanvas ?? ((z) => window.__ar_getLayerCanvas(z));
  }

  #ctx() {
    return this.#gc(this.#z).getContext("2d");
  }

  get width()  { return this.#gc(this.#z).width; }
  get height() { return this.#gc(this.#z).height; }

  // ── Background / clear ────────────────────────────────────────────────────

  bg(color) {
    const ctx = this.#ctx();
    const prev = ctx.fillStyle;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.fillStyle = prev;
    return this;
  }

  clear() {
    const ctx = this.#ctx();
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    return this;
  }

  // ── Filled shapes ─────────────────────────────────────────────────────────

  rect(x, y, w, h, color = "#fff") {
    const ctx = this.#ctx();
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
    return this;
  }

  circle(x, y, r, color = "#fff") {
    const ctx = this.#ctx();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    return this;
  }

  arc(x, y, r, start, end, color = "#fff") {
    const ctx = this.#ctx();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.arc(x, y, r, start, end);
    ctx.closePath();
    ctx.fill();
    return this;
  }

  poly(points, color = "#fff") {
    if (points.length < 2) return this;
    const ctx = this.#ctx();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
    ctx.closePath();
    ctx.fill();
    return this;
  }

  // ── Stroked shapes ────────────────────────────────────────────────────────

  rectStroke(x, y, w, h, color = "#fff", thickness = 1) {
    const ctx = this.#ctx();
    ctx.strokeStyle = color;
    ctx.lineWidth = thickness;
    ctx.strokeRect(x, y, w, h);
    return this;
  }

  ring(x, y, r, color = "#fff", thickness = 1) {
    const ctx = this.#ctx();
    ctx.strokeStyle = color;
    ctx.lineWidth = thickness;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    return this;
  }

  arcStroke(x, y, r, start, end, color = "#fff", thickness = 1) {
    const ctx = this.#ctx();
    ctx.strokeStyle = color;
    ctx.lineWidth = thickness;
    ctx.beginPath();
    ctx.arc(x, y, r, start, end);
    ctx.stroke();
    return this;
  }

  line(x1, y1, x2, y2, color = "#fff", thickness = 1) {
    const ctx = this.#ctx();
    ctx.strokeStyle = color;
    ctx.lineWidth = thickness;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    return this;
  }

  polyStroke(points, color = "#fff", thickness = 1, closed = true) {
    if (points.length < 2) return this;
    const ctx = this.#ctx();
    ctx.strokeStyle = color;
    ctx.lineWidth = thickness;
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
    if (closed) ctx.closePath();
    ctx.stroke();
    return this;
  }

  // ── Text ──────────────────────────────────────────────────────────────────

  text(str, x, y, size = 24, color = "#fff", {
    font      = "sans-serif",
    align     = "left",
    baseline  = "alphabetic",
    weight    = "normal",
    style     = "normal",
    stroke    = false,
    strokeColor = "#000",
    strokeWidth = 2,
    shadow    = false,
    shadowColor = "rgba(0,0,0,0.6)",
    shadowBlur  = 4,
    shadowX     = 2,
    shadowY     = 2,
    gradient  = null,   // array of CSS colors, top→bottom fill gradient
  } = {}) {
    const ctx = this.#ctx();
    ctx.font = `${style} ${weight} ${size}px ${font}`;
    ctx.textAlign = align;
    ctx.textBaseline = baseline;

    if (shadow) {
      ctx.shadowColor   = shadowColor;
      ctx.shadowBlur    = shadowBlur;
      ctx.shadowOffsetX = shadowX;
      ctx.shadowOffsetY = shadowY;
    }

    if (gradient && gradient.length >= 2) {
      const met = ctx.measureText(str);
      const w   = met.width;
      const h   = size * 1.2;
      const g   = ctx.createLinearGradient(x, y - h, x, y + h * 0.2);
      gradient.forEach((c, i) => g.addColorStop(i / (gradient.length - 1), c));
      ctx.fillStyle = g;
    } else {
      ctx.fillStyle = color;
    }

    ctx.fillText(str, x, y);

    if (stroke) {
      ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth   = strokeWidth;
      ctx.strokeText(str, x, y);
    }

    ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
    return this;
  }

  /** Load a web font by name + URL, returns Promise<name>. */
  async loadFont(name, url) {
    const face = new FontFace(name, `url(${url})`);
    await face.load();
    document.fonts.add(face);
    return name;
  }

  // ── Image ─────────────────────────────────────────────────────────────────

  image(img, x, y, w, h) {
    const ctx = this.#ctx();
    if (w !== undefined && h !== undefined) ctx.drawImage(img, x, y, w, h);
    else ctx.drawImage(img, x, y);
    return this;
  }

  // ── State ─────────────────────────────────────────────────────────────────

  push() { this.#ctx().save(); return this; }
  pop()  { this.#ctx().restore(); return this; }

  alpha(n)     { this.#ctx().globalAlpha = n; return this; }
  blend(mode)  { this.#ctx().globalCompositeOperation = mode; return this; }

  // ── Transform ─────────────────────────────────────────────────────────────

  translate(x, y)  { this.#ctx().translate(x, y); return this; }
  rotate(rad)      { this.#ctx().rotate(rad); return this; }
  scale(x, y = x)  { this.#ctx().scale(x, y); return this; }

  resetTransform() { this.#ctx().setTransform(1, 0, 0, 1, 0, 0); return this; }

  reset() {
    const ctx = this.#ctx();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.lineWidth = 1;
    return this;
  }

  // ── Pixel FX ──────────────────────────────────────────────────────────────

  pixelate(source, blockSize = 8, x = 0, y = 0, w, h) {
    const ctx = this.#ctx();
    const dw = w ?? ctx.canvas.width - x;
    const dh = h ?? ctx.canvas.height - y;
    const pw = Math.max(1, Math.round(dw / blockSize));
    const ph = Math.max(1, Math.round(dh / blockSize));
    const off = document.createElement('canvas');
    off.width = pw; off.height = ph;
    const offCtx = off.getContext('2d');
    offCtx.drawImage(source, 0, 0, pw, ph);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, x, y, dw, dh);
    ctx.imageSmoothingEnabled = true;
    return this;
  }

  toASCII(canvas, { cols = 80, rows, charset = ' .:-=+*#%@', bg = '#000', color = '#0f0' } = {}) {
    const r = rows ?? Math.round(cols / 2.5);
    const pre = document.createElement('pre');
    pre.style.cssText = `background:${bg};color:${color};font:${Math.max(4, Math.floor(800 / cols))}px/1.1 monospace;margin:0;padding:4px;white-space:pre;overflow:hidden;`;
    const update = (src = canvas) => {
      const off = document.createElement('canvas');
      off.width = cols; off.height = r;
      const offCtx = off.getContext('2d');
      offCtx.drawImage(src, 0, 0, cols, r);
      const px = offCtx.getImageData(0, 0, cols, r).data;
      let text = '';
      for (let row = 0; row < r; row++) {
        for (let col = 0; col < cols; col++) {
          const i = (row * cols + col) * 4;
          const lum = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) / 255;
          text += charset[Math.min(charset.length - 1, Math.floor(lum * charset.length))];
        }
        text += '\n';
      }
      pre.textContent = text;
    };
    update(canvas);
    return { el: pre, update };
  }

  // ── Backdrop ──────────────────────────────────────────────────────────────
  //
  // Renders `source` onto a layer below this one so all draw calls appear on
  // top.  `source` accepts anything resolveDrawable handles (ADR 006) PLUS:
  //   - 'camera'      → document.getElementById('camera') (<video>)
  //   - A URL string  → loaded as a static <img> (drawn once on load)
  //
  // The string/URL cases are this method's own async layer on top of the shared
  // sync resolver — see ADR 006 for why they are not folded into resolveDrawable.
  //
  // Returns { stop(), layer }.  Live sources raf-loop; stop() cancels it.
  // cleanupBackdrops() is called automatically on reset.

  backdrop(source, { z, fit = 'cover', loop = true } = {}) {
    const targetZ  = z ?? (this.#z - 1);
    const bdCanvas = this.#gc(targetZ);

    // Build the stop handle up-front so the raf closure can reference it
    let _rafId = null;
    let _live  = null;
    let _cameraLease = null;
    const h = {
      layer: targetZ,
      stop: () => {
        if (_rafId !== null) { cancelAnimationFrame(_rafId); _rafId = null; }
        _live?.release(); _live = null;
        _cameraLease?.release(); _cameraLease = null;
        const i = _backdrops.indexOf(h);
        if (i !== -1) _backdrops.splice(i, 1);
        const j = this._ownBackdrops?.indexOf(h) ?? -1;
        if (j !== -1) this._ownBackdrops.splice(j, 1);
      },
    };
    _backdrops.push(h);
    // Also track on THIS surface so a window-scoped surface (Canvas) can stop its
    // own backdrops when it tears down — otherwise the backdrop's keep-alive + raf
    // outlive the closed window and pin the run alive (idle watcher never stops it).
    (this._ownBackdrops ??= []).push(h);

    // Resolve to a drawable
    let drawable = null;
    if (typeof source === 'string') {
      if (source === 'camera') {
        _cameraLease = acquireCameraRunScoped();
        drawable = document.getElementById('camera');
      } else {
        // URL string → static image
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => _drawFit(bdCanvas, img, fit);
        img.src = source;
        return h;
      }
    } else {
      drawable = resolveDrawable(source);
    }

    if (!drawable) {
      console.warn('draw.backdrop: unsupported source type');
      return h;
    }

    // Static <img>
    if (drawable instanceof HTMLImageElement || drawable.nodeName === 'IMG') {
      const draw = () => _drawFit(bdCanvas, drawable, fit);
      if (drawable.complete && drawable.naturalWidth) draw();
      else drawable.addEventListener('load', draw, { once: true });
      return h;
    }

    // Non-looping one-shot
    if (!loop) {
      _drawFit(bdCanvas, drawable, fit);
      return h;
    }

    // Live source — raf loop
    _live = liveOutput({});
    const tick = () => {
      const ctx = bdCanvas.getContext('2d');
      ctx.clearRect(0, 0, bdCanvas.width, bdCanvas.height);
      if ((drawable.videoWidth ?? drawable.width) > 0) _drawFit(bdCanvas, drawable, fit);
      _rafId = requestAnimationFrame(tick);
    };
    _rafId = requestAnimationFrame(tick);
    return h;
  }

  // Stop every backdrop started on THIS surface (releases their keep-alive + raf).
  // Called by window-scoped surfaces on teardown so closing the window stops the
  // footage loop and lets the idle watcher auto-stop the run.
  stopBackdrops() {
    if (!this._ownBackdrops) return;
    for (const h of [...this._ownBackdrops]) { try { h.stop?.(); } catch { /* gone */ } }
    this._ownBackdrops = [];
  }

  // ── Layer targeting ───────────────────────────────────────────────────────

  at(z) { return new DrawTarget(z, this.#gc); }
}

// Register teardown with the reset registry (ADR 008).
onReset(cleanupBackdrops);
