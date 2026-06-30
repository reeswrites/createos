import { onReset } from '../../runtime/reset-registry.js';
// ascii.js — ASCII animation playback and frame capture
// #21: ascii.play(frames, fps) / ascii.record(source, opts)

const _nativeSetInterval = window.setInterval.bind(window);
const _nativeClearInterval = window.clearInterval.bind(window);

const _players = [];

export function cleanupAscii() {
  for (const p of _players) {
    if (p._iid != null) {
      _nativeClearInterval(p._iid);
      p._iid = null;
    }
  }
  _players.length = 0;
}

// ── AsciiPlayer ────────────────────────────────────────────────────────────────

class AsciiPlayer {
  constructor(frames, fps, opts) {
    this.frames = Array.isArray(frames) ? frames : [String(frames)];
    this._fps = fps;
    this._fi = 0;
    this._iid = null;
    this._looping = true;

    this.el = document.createElement('pre');
    Object.assign(this.el.style, {
      margin: '0',
      padding: '8px',
      background: opts.bg ?? '#0d0208',
      color: opts.color ?? '#00ff41',
      fontFamily: 'monospace',
      fontSize: opts.fontSize ?? '12px',
      lineHeight: '1.15',
      whiteSpace: 'pre',
      overflow: 'hidden',
    });

    this._render();
    _players.push(this);
  }

  _render() {
    const frame = this.frames[this._fi];
    if (!frame) return;
    if (typeof frame === 'string') {
      this.el.textContent = frame;
    } else {
      this._renderColored(frame);
    }
  }

  _renderColored({ w, h, cells }) {
    let html = '';
    for (let r = 0; r < h; r++) {
      let run = '',
        runF = null,
        runB = null;
      const flush = () => {
        if (!run) return;
        const esc = run.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const st = `color:${runF ?? '#00ff41'};${runB ? `background:${runB};` : ''}`;
        html += `<span style="${st}">${esc}</span>`;
        run = '';
        runF = null;
        runB = null;
      };
      for (let c = 0; c < w; c++) {
        const cell = cells[r * w + c];
        const f = cell?.f ?? null,
          b = cell?.b ?? null;
        if (f !== runF || b !== runB) {
          flush();
          runF = f;
          runB = b;
        }
        run += cell?.c ?? ' ';
      }
      flush();
      html += '\n';
    }
    this.el.innerHTML = html;
  }

  start() {
    if (this._iid != null) return this;
    this._iid = setInterval(() => {
      if (!this._looping && this._fi >= this.frames.length - 1) {
        this.stop();
        return;
      }
      this._fi = (this._fi + 1) % this.frames.length;
      this._render();
    }, 1000 / this._fps);
    return this;
  }

  stop() {
    if (this._iid != null) {
      clearInterval(this._iid);
      this._iid = null;
    }
    return this;
  }

  loop(on = true) {
    this._looping = on;
    return this;
  }

  frame(n) {
    this._fi = ((n % this.frames.length) + this.frames.length) % this.frames.length;
    this._render();
    return this;
  }

  fps(n) {
    this._fps = n;
    if (this._iid != null) {
      this.stop();
      this.start();
    }
    return this;
  }
}

// ── Canvas → ASCII text ────────────────────────────────────────────────────────

export function canvasToAsciiText(canvas, { cols = 80, charset = ' .:-=+*#%@' } = {}) {
  const rows = Math.round(cols / 2.5);
  const off = document.createElement('canvas');
  off.width = cols;
  off.height = rows;
  const ctx = off.getContext('2d');
  ctx.drawImage(canvas, 0, 0, cols, rows);
  const px = ctx.getImageData(0, 0, cols, rows).data;
  let text = '';
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = (r * cols + c) * 4;
      const lum = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) / 255;
      text += charset[Math.min(charset.length - 1, Math.floor(lum * charset.length))];
    }
    text += '\n';
  }
  return text;
}

function _resolveCanvas(source) {
  if (source instanceof HTMLCanvasElement) return source;
  if (source?.canvas instanceof HTMLCanvasElement) return source.canvas;
  if (source?.renderer?.domElement instanceof HTMLCanvasElement) return source.renderer.domElement;
  if (source?.element instanceof HTMLVideoElement) return null; // camera — not yet supported
  return null;
}

// ── Public API ─────────────────────────────────────────────────────────────────

export const ascii = {
  // Play an array of ASCII text frames at fps
  play(frames, fps = 12, opts = {}) {
    const player = new AsciiPlayer(frames, fps, opts);
    player.start();
    return player;
  },

  // Capture ASCII frames from a canvas source over `duration` seconds
  record(source, opts = {}) {
    const { fps = 12, duration = 2, cols = 80, charset = ' .:-=+*#%@' } = opts;
    return new Promise((resolve) => {
      const total = Math.round(fps * duration);
      const frames = [];
      let n = 0;
      const id = _nativeSetInterval(() => {
        const canvas = _resolveCanvas(source);
        if (canvas) frames.push(canvasToAsciiText(canvas, { cols, charset }));
        if (++n >= total) {
          _nativeClearInterval(id);
          resolve(frames);
        }
      }, 1000 / fps);
    });
  },
};

// Register teardown with the reset registry (ADR 008).
onReset(cleanupAscii);
