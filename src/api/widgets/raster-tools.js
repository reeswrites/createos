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

// Map a client pointer position to an integer grid cell, clamped to [0, max-1] on each
// axis. Paint (divX=divY=1), Sprite (divX=divY=scale), and Ascii (divX=cellW, divY=cellH,
// mapped to c/r) hand-rolled this identical clamp-floor; only the divisors differ. rect =
// the element's getBoundingClientRect() (passed in so this stays a pure unit).
export function clampToGrid(clientX, clientY, rect, { divX, divY, maxX, maxY }) {
  return {
    x: Math.max(0, Math.min(maxX - 1, Math.floor((clientX - rect.left) / divX))),
    y: Math.max(0, Math.min(maxY - 1, Math.floor((clientY - rect.top) / divY))),
  };
}

// Bresenham integer line from (x0,y0) to (x1,y1), calling plot(x,y) at each point.
// Sprite plots pixels, Ascii accumulates cells — they carried byte-identical copies of
// this loop (with x/y vs c/r names). Callers own what "plot" does.
export function rasterLine(x0, y0, x1, y1, plot) {
  const dx = Math.abs(x1 - x0),
    dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1,
    sy = y0 < y1 ? 1 : -1;
  let err = dx - dy,
    x = x0,
    y = y0;
  for (;;) {
    plot(x, y);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }
}

// Rectangle perimeter between two corners, calling plot(x,y) on each edge cell. Skips
// the duplicate edge on a degenerate (single-row / single-column) rect. Shared by Sprite
// (pixels) and Ascii (cells) — both idempotent under plot, so double-plotting a corner
// would be harmless, but the guard keeps the two exact.
export function rasterRectOutline(x0, y0, x1, y1, plot) {
  const lx = Math.min(x0, x1),
    rx = Math.max(x0, x1);
  const ty = Math.min(y0, y1),
    by = Math.max(y0, y1);
  for (let x = lx; x <= rx; x++) {
    plot(x, ty);
    if (by !== ty) plot(x, by);
  }
  for (let y = ty + 1; y < by; y++) {
    plot(lx, y);
    if (rx !== lx) plot(rx, y);
  }
}

// Read the pixel at (x, y) as a #rrggbb hex string. Fully-transparent pixels return the
// `transparent` sentinel (Paint uses '#000000', Sprite uses 'transparent'). The
// eyedropper both editors hand-rolled off getImageData.
export function readPixelHex(ctx, x, y, transparent = 'transparent') {
  const [r, g, b, a] = ctx.getImageData(x, y, 1, 1).data;
  if (a === 0) return transparent;
  return '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('');
}
