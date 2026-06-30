import { onReset } from '../runtime/reset-registry.js';

const _recorders = [];

export function cleanupRecorders() {
  for (const rec of [..._recorders]) rec.stop();
}

function pickMime() {
  if (typeof MediaRecorder === 'undefined') return 'video/webm';
  const types = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  for (const t of types) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return '';
}

function _remove(rec) {
  const i = _recorders.indexOf(rec);
  if (i >= 0) _recorders.splice(i, 1);
}

export class Recording {
  constructor(stream, { onStop, mimeType } = {}) {
    this._onStop = onStop;
    this._stopCompositor = null;
    const chunks = [];
    const mime = mimeType ?? pickMime();
    let mr;
    try {
      mr = new MediaRecorder(stream, mime ? { mimeType: mime } : {});
    } catch (_) {
      mr = new MediaRecorder(stream);
    }
    this._mr = mr;
    const usedMime = mr.mimeType || mime || 'video/webm';
    mr.ondataavailable = (e) => {
      if (e.data?.size > 0) chunks.push(e.data);
    };
    mr.onstop = () => {
      _remove(this);
      if (chunks.length > 0) {
        const blob = new Blob(chunks, { type: usedMime });
        this._onStop?.(blob);
      }
    };
    mr.start(100);
    _recorders.push(this);
  }

  stop() {
    this._stopCompositor?.();
    this._stopCompositor = null;
    if (this._mr?.state !== 'inactive') this._mr?.stop();
    else _remove(this);
  }
}

export function recordStream(stream, opts = {}) {
  return new Recording(stream, opts);
}

export function compositeCanvasStream(canvases, fps = 30) {
  const first = canvases[0];
  const w = first.width || 640;
  const h = first.height || 480;
  const off = document.createElement('canvas');
  off.width = w;
  off.height = h;
  const ctx = off.getContext('2d');
  let rafId = null;
  const draw = () => {
    rafId = requestAnimationFrame(draw);
    ctx.clearRect(0, 0, w, h);
    for (const c of canvases) {
      try {
        ctx.drawImage(c, 0, 0, w, h);
      } catch (_) {}
    }
  };
  draw();
  const stream = off.captureStream(fps);
  return {
    stream,
    stop() {
      cancelAnimationFrame(rafId);
      rafId = null;
    },
  };
}

onReset(cleanupRecorders);
