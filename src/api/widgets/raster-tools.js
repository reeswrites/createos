// raster-tools.js — pure raster paint helpers shared by the Paint + Sprite editors.
// Both hand-rolled an identical 4-neighbour flood fill (including the same
// 1×1-canvas colour→RGBA resolve) and an identical stroke-bbox accumulator. Pulled
// out so the flood-fill algorithm has ONE home and ONE test (it previously had none —
// the only way to reach it was through a full editor + DOM drag). DOM-free apart from
// the 2D context the caller passes in and the throwaway canvas used to parse a colour.

// Resolve a CSS colour string to an [r,g,b,a] byte tuple via a 1×1 canvas.
// 'transparent' → [0, 0, 0, 0].
export function resolveColorRGBA(color) {
  if (color === 'transparent') return [0, 0, 0, 0];
  const tmp = document.createElement('canvas');
  tmp.width = tmp.height = 1;
  const tx = tmp.getContext('2d');
  tx.fillStyle = color;
  tx.fillRect(0, 0, 1, 1);
  const d = tx.getImageData(0, 0, 1, 1).data;
  return [d[0], d[1], d[2], d[3]];
}

// 4-neighbour flood fill of the region matching the pixel at (px, py), painted with
// the pre-resolved `fill` = [r,g,b,a] byte tuple, in place on the 2D context's w×h
// image. Returns true if any pixel changed (false when the target colour already
// equals the fill — the no-op guard both editors carried). The caller resolves the
// colour (resolveColorRGBA) and owns render / stroke-event / history after a true
// return. Colour resolution is kept out so the algorithm is a pure, DOM-free unit.
export function floodFill(ctx, w, h, px, py, fill) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const idx = (x, y) => (y * w + x) * 4;
  const i0 = idx(px, py);
  const [tr, tg, tb, ta] = [d[i0], d[i0 + 1], d[i0 + 2], d[i0 + 3]];
  const [fr, fg, fb, fa] = fill;
  if (tr === fr && tg === fg && tb === fb && ta === fa) return false;

  const stack = [[px, py]];
  while (stack.length) {
    const [cx, cy] = stack.pop();
    if (cx < 0 || cx >= w || cy < 0 || cy >= h) continue;
    const ci = idx(cx, cy);
    if (d[ci] !== tr || d[ci + 1] !== tg || d[ci + 2] !== tb || d[ci + 3] !== ta) continue;
    d[ci] = fr;
    d[ci + 1] = fg;
    d[ci + 2] = fb;
    d[ci + 3] = fa;
    stack.push([cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]);
  }
  ctx.putImageData(img, 0, 0);
  return true;
}

// Accumulate point (a, b) into a stroke bbox with {minX, minY, maxX, maxY} keys.
// Returns the (possibly newly-created) bbox. Paint + Sprite share this exact shape;
// AsciiEditor uses cell-coord keys (minC/minR) and keeps its own.
export function expandBbox(bbox, a, b) {
  if (!bbox) return { minX: a, minY: b, maxX: a, maxY: b };
  if (a < bbox.minX) bbox.minX = a;
  if (b < bbox.minY) bbox.minY = b;
  if (a > bbox.maxX) bbox.maxX = a;
  if (b > bbox.maxY) bbox.maxY = b;
  return bbox;
}
