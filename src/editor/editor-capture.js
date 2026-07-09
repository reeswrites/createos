import { trackedGroup } from '../runtime/tracked-group.js';
// DOMCapture — renders any DOM element to a live HTMLCanvasElement via SVG foreignObject.
// The canvas can be passed directly as `video:` to the Shader class.

let _nativeSetInterval = null;
let _nativeClearInterval = null;
const _captures = trackedGroup({ teardown: (c) => c.stop() });

class DOMCapture {
  constructor(el, fps = 12) {
    this._el = el;
    this._canvas = document.createElement('canvas');
    this._ctx = this._canvas.getContext('2d');
    this._canvas.width = el.offsetWidth || 800;
    this._canvas.height = el.offsetHeight || 600;
    this._pending = false;
    this._styles = null;
    this._intervalId = null;
    this._fps = fps;
  }

  start() {
    if (this._intervalId !== null) return this;
    this._intervalId = _nativeSetInterval(() => this._capture(), Math.round(1000 / this._fps));
    return this;
  }

  stop() {
    if (this._intervalId !== null && _nativeClearInterval) {
      _nativeClearInterval(this._intervalId);
    }
    this._intervalId = null;
    return this;
  }

  trigger() {
    this._styles = null;
    this._capture();
  }

  canvas() {
    return this._canvas;
  }

  _extractStyles() {
    const rules = [];
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) {
          if (rule.cssText) rules.push(rule.cssText);
        }
      } catch (_) {}
    }
    return rules.join('\n');
  }

  _capture() {
    if (this._pending) return;
    const el = this._el;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    if (w < 1 || h < 1) return;

    if (this._canvas.width !== w || this._canvas.height !== h) {
      this._canvas.width = w;
      this._canvas.height = h;
    }

    if (!this._styles) this._styles = this._extractStyles();

    const clone = el.cloneNode(true);
    clone.querySelectorAll('textarea, script').forEach((t) => t.remove());

    const svgStr =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
      `<style>${this._styles}</style>` +
      `<foreignObject x="0" y="0" width="${w}" height="${h}">` +
      `<div xmlns="http://www.w3.org/1999/xhtml">${clone.outerHTML}</div>` +
      `</foreignObject></svg>`;

    this._pending = true;
    const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      this._ctx.clearRect(0, 0, w, h);
      this._ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      this._pending = false;
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      this._pending = false;
    };
    img.src = url;
  }
}

export function initDOMCaptures(nativeSetInterval, nativeClearInterval) {
  _nativeSetInterval = nativeSetInterval;
  _nativeClearInterval = nativeClearInterval;
}

export function captureWindow(target, fps = 12) {
  const el = typeof target === 'string' ? document.querySelector(target) : target;
  if (!el) return null;
  if (
    el instanceof HTMLCanvasElement ||
    el instanceof HTMLVideoElement ||
    el instanceof HTMLImageElement
  )
    return el;
  const c = new DOMCapture(el, fps);
  c.start();
  _captures.add(c);
  return c.canvas();
}

// Manual "destroy-all" helper (tests / app.js); reset teardown is the group's own.
export function cleanupCaptures() {
  _captures.teardownAll();
}
