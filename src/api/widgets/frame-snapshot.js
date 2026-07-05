// frame-snapshot.js — the one copy of raw-RGBA frame capture/restore and
// canvas/blob download, shared by Paint and SpriteEditor.
//
// Both widgets snapshot an array of frame <canvas> as Uint8ClampedArray for
// undo/redo (paint.js:_snapFrames literally said "mirrors SpriteEditor._snapPixels"),
// and Paint/Sprite/Ascii each hand-rolled the same toBlob → <a download> →
// revokeObjectURL dance. Callers keep the parts that genuinely differ — frame-count
// reconcile and post-restore render — and delegate the pixel/download mechanics here.
// Leaf module — no imports.

// Capture each frame canvas as a detached Uint8ClampedArray of its RGBA bytes.
export function snapshotFrameCanvases(canvases, w, h) {
  return canvases.map(
    (fc) => new Uint8ClampedArray(fc.getContext('2d').getImageData(0, 0, w, h).data),
  );
}

// Paint one captured RGBA buffer back onto a frame canvas.
export function paintFrameCanvas(canvas, w, h, data) {
  const ctx = canvas.getContext('2d');
  const id = ctx.createImageData(w, h);
  id.data.set(new Uint8ClampedArray(data));
  ctx.putImageData(id, 0, 0);
}

// Trigger a browser download of a Blob under `filename` (revokes the URL after).
export function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

// Download a canvas as a PNG file.
export function downloadCanvasPng(canvas, filename) {
  canvas.toBlob((blob) => downloadBlob(blob, filename), 'image/png');
}
