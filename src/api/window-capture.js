// window-capture.js — turn a window's visual into a PNG snapshot or a WebM
// recording. Extracted from wm.js (ADR 042) so the compositing + recorder wiring
// lives behind a small interface instead of inside the wm god-closure.
//
// A window's pixels are its z-ordered <canvas> planes (draw@0, pixi@25,
// shader@30, paint-overlay@50, text@51 — ADR 040). Snapshot composites them in
// z-order into one PNG; record composites them into one captured stream. Both
// converge on desktop.addBlob (the single capture seam — ADR 016/023). The only
// DOM these touch is the window body (to find the planes) and `.wm-title` (for a
// default name) — never a `win._*` private field, so wm stays the owner of
// window internals.

import { recordStream, compositeCanvasStream } from './recorder.js';

// All <canvas> planes of a window body, z-sorted (ADR 040). Replaces the old
// base→overlay→text filter dance: every plane composites in zIndex order.
export function zSortedCanvases(body) {
  return [...body.querySelectorAll('canvas')]
    .map(c => [c, parseInt(getComputedStyle(c).zIndex, 10) || 0])
    .sort((a, b) => a[1] - b[1])
    .map(e => e[0]);
}

function _defaultName(win, fallback, ext) {
  return (win.querySelector('.wm-title')?.textContent?.trim() || fallback) + ext;
}

// Composite the window's visual into a persistent desktop PNG.
export function snapshotWindow(win, body, visualEl, { name, download = false } = {}) {
  const canvases = zSortedCanvases(body);
  let w, h;
  if (canvases.length > 0) {
    w = canvases[0].width || 320;
    h = canvases[0].height || 240;
  } else {
    w = visualEl.videoWidth || visualEl.naturalWidth || visualEl.width || 320;
    h = visualEl.videoHeight || visualEl.naturalHeight || visualEl.height || 240;
  }
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  if (canvases.length > 0) {
    for (const src of canvases) { try { ctx.drawImage(src, 0, 0, w, h); } catch (_) {} }
  } else {
    try { ctx.drawImage(visualEl, 0, 0, w, h); } catch (_) {}
  }
  const snapName = name ?? _defaultName(win, 'snapshot', '.png');
  c.toBlob(blob => {
    if (!blob) return;
    window.desktop?.addBlob(blob, { name: snapName, type: 'image', download });
  }, 'image/png');
}

// Start recording the window's visual → desktop WebM. Returns the recorder
// handle (with a chained _stopCompositor when a multi-plane compositor is used).
export function recordWindow(win, body, visualEl, { fps = 30, name } = {}) {
  // All canvases, z-sorted → composite order (base → … → overlay → text).
  const all = zSortedCanvases(body);
  let stream, stopCompositor = null;
  if (all.length > 1) {
    const comp = compositeCanvasStream(all, fps);
    stream = comp.stream;
    stopCompositor = comp.stop;
  } else if (all.length === 1) {
    stream = all[0].captureStream?.(fps);
  } else if (visualEl?.tagName === 'VIDEO') {
    stream = visualEl.captureStream?.() ?? visualEl.mozCaptureStream?.();
  }
  if (!stream) return null;
  const recName = name ?? _defaultName(win, 'recording', '.webm');
  const rec = recordStream(stream, {
    onStop: blob => window.desktop?.addBlob(blob, { name: recName, type: 'video' }),
  });
  if (stopCompositor) rec._stopCompositor = stopCompositor;
  return rec;
}
