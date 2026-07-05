import { onReset } from '../../runtime/reset-registry.js';
// sprite.js — pixel-grid sprite & mosaic animation
// #22: new Sprite({ width, height, scale, frames })

const _sprites = [];

export function cleanupSprites() {
  for (const s of _sprites) {
    if (s._iid != null) {
      clearInterval(s._iid);
      s._iid = null;
    }
  }
  _sprites.length = 0;
}

export class Sprite {
  constructor({ width = 16, height = 16, scale = 8, frames = 1, bg = 'transparent' } = {}) {
    this._w = width;
    this._h = height;
    this._scale = scale;
    this._fi = 0;
    this._iid = null;
    this._onionAlpha = 0;
    this._bg = bg;

    // Per-frame canvases (pixel-resolution)
    this._frames = [];
    for (let i = 0; i < Math.max(1, frames); i++) this._addFrameCanvas();

    // Display canvas (scaled up, pixel-crisp)
    this.canvas = document.createElement('canvas');
    this.canvas.width = width * scale;
    this.canvas.height = height * scale;
    this._dctx = this.canvas.getContext('2d');
    this._dctx.imageSmoothingEnabled = false;

    _sprites.push(this);
    this._render();
  }

  // ── Frame management ─────────────────────────────────────────────────────────

  _addFrameCanvas() {
    const c = document.createElement('canvas');
    c.width = this._w;
    c.height = this._h;
    if (this._bg && this._bg !== 'transparent') {
      const ctx = c.getContext('2d');
      ctx.fillStyle = this._bg;
      ctx.fillRect(0, 0, this._w, this._h);
    }
    this._frames.push(c);
    return this._frames.length - 1;
  }

  addFrame() {
    return this._addFrameCanvas();
  }

  get frameCount() {
    return this._frames.length;
  }

  // Clone the current frame into a new appended frame and select it.
  duplicateFrame() {
    const fi = this._fi;
    const ni = this._addFrameCanvas();
    this._frames[ni].getContext('2d').drawImage(this._frames[fi], 0, 0);
    return this.frame(ni);
  }

  // Remove the current frame (no-op when only one remains); clamp + render.
  removeFrame() {
    if (this._frames.length <= 1) return this;
    this._frames.splice(this._fi, 1);
    this._fi = Math.min(this._fi, this._frames.length - 1);
    this._render();
    return this;
  }

  // Reorder the current frame by `dir` (±1); follows it to the new slot.
  moveFrame(dir) {
    const fi = this._fi,
      to = fi + dir;
    if (to < 0 || to >= this._frames.length) return this;
    [this._frames[fi], this._frames[to]] = [this._frames[to], this._frames[fi]];
    this._fi = to;
    this._render();
    return this;
  }

  // Draw frame `i` (default current) into a target canvas, sizing it to the
  // pixel-resolution frame. Keeps the backing _frames array private — the seam
  // the SpriteFrameAdapter reads through for thumbnails.
  drawFrameTo(target, i = this._fi) {
    target.width = this._w;
    target.height = this._h;
    target.getContext('2d').drawImage(this._frames[i], 0, 0);
    return this;
  }

  // Paint an image (e.g. a restored PNG data URL) into frame `i`, then re-render.
  // Inverse of drawFrameTo — the seam desktop restore reads through so it never
  // touches the private _frames array.
  drawImageToFrame(i, img) {
    const frame = this._frames[i];
    if (!frame) return this;
    frame.getContext('2d').drawImage(img, 0, 0);
    this._render();
    return this;
  }

  // ── Pixel drawing ────────────────────────────────────────────────────────────

  // Set pixel at (x,y) on current (or given) frame
  pixel(x, y, color, frameIndex = this._fi) {
    const ctx = this._frames[frameIndex]?.getContext('2d');
    if (!ctx) return this;
    ctx.clearRect(Math.floor(x), Math.floor(y), 1, 1);
    if (color && color !== 'transparent') {
      ctx.fillStyle = color;
      ctx.fillRect(Math.floor(x), Math.floor(y), 1, 1);
    }
    this._render();
    return this;
  }

  // Fill rect (pixel coords) on current frame
  fill(x, y, w, h, color, frameIndex = this._fi) {
    if (typeof x === 'string') {
      // fill(color) — fill whole frame
      color = x;
      const ctx = this._frames[this._fi]?.getContext('2d');
      if (!ctx) return this;
      ctx.clearRect(0, 0, this._w, this._h);
      if (color !== 'transparent') {
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, this._w, this._h);
      }
      this._render();
      return this;
    }
    const ctx = this._frames[frameIndex]?.getContext('2d');
    if (!ctx) return this;
    ctx.clearRect(Math.floor(x), Math.floor(y), Math.ceil(w), Math.ceil(h));
    if (color !== 'transparent') {
      ctx.fillStyle = color;
      ctx.fillRect(Math.floor(x), Math.floor(y), Math.ceil(w), Math.ceil(h));
    }
    this._render();
    return this;
  }

  // Clear a frame (or all frames)
  clear(frameIndex = this._fi) {
    const ctx = this._frames[frameIndex]?.getContext('2d');
    if (!ctx) return this;
    ctx.clearRect(0, 0, this._w, this._h);
    this._render();
    return this;
  }

  // Get raw 2d context for a frame (for advanced drawing)
  ctx(frameIndex = this._fi) {
    return this._frames[frameIndex]?.getContext('2d') ?? null;
  }

  // ── Frame index ──────────────────────────────────────────────────────────────

  frame(n) {
    if (n === undefined) return this._fi;
    this._fi = ((n % this._frames.length) + this._frames.length) % this._frames.length;
    this._render();
    return this;
  }

  // ── Onion skin ───────────────────────────────────────────────────────────────

  onionSkin(alpha = 0.3) {
    this._onionAlpha = alpha;
    this._render();
    return this;
  }

  // ── Rendering ────────────────────────────────────────────────────────────────

  _render() {
    const ctx = this._dctx;
    const cw = this.canvas.width,
      ch = this.canvas.height;
    ctx.clearRect(0, 0, cw, ch);
    if (this._bg && this._bg !== 'transparent') {
      ctx.fillStyle = this._bg;
      ctx.fillRect(0, 0, cw, ch);
    }
    // Onion skin — previous frame semi-transparent
    if (this._onionAlpha > 0 && this._frames.length > 1) {
      const prev = this._frames[(this._fi - 1 + this._frames.length) % this._frames.length];
      ctx.globalAlpha = this._onionAlpha;
      ctx.drawImage(prev, 0, 0, cw, ch);
      ctx.globalAlpha = 1;
    }
    ctx.drawImage(this._frames[this._fi], 0, 0, cw, ch);
  }

  // ── Playback ─────────────────────────────────────────────────────────────────

  play(fps = 8) {
    if (this._iid != null) return this;
    this._iid = setInterval(() => {
      this._fi = (this._fi + 1) % this._frames.length;
      this._render();
    }, 1000 / fps);
    return this;
  }

  stop() {
    if (this._iid != null) {
      clearInterval(this._iid);
      this._iid = null;
    }
    return this;
  }

  // ── Display ──────────────────────────────────────────────────────────────────

  // Open the sprite in a wm window (live mirror via RAF)
  show(title = 'Sprite') {
    window.wm?.spawn(title, {
      type: 'canvas',
      canvas: this.canvas,
      w: this.canvas.width,
      h: this.canvas.height + 29,
    });
    return this;
  }

  // Open the visual Aseprite-style editor on this sprite
  edit(opts = {}) {
    import('./sprite-editor.js').then(
      ({ SpriteEditor }) => new SpriteEditor({ sprite: this, ...opts }),
    );
    return this;
  }

  // Static factory — open editor on a new sprite
  static edit(opts = {}) {
    import('./sprite-editor.js').then(({ SpriteEditor }) => new SpriteEditor(opts));
  }
}

// Register teardown with the reset registry (ADR 008).
onReset(cleanupSprites);
