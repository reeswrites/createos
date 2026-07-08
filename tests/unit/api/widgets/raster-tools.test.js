import { describe, it, expect } from 'vitest';
import {
  floodFill,
  resolveColorRGBA,
  expandBbox,
  clampToGrid,
  rasterLine,
  rasterRectOutline,
  readPixelHex,
} from '../../../../src/api/widgets/raster-tools.js';

// Candidate 03 (6th arch pass): the flood fill + bbox accumulator were byte-identical
// in Paint and Sprite and had NO test — the only way to reach them was a full editor
// drag through the DOM. Now they are a pure leaf. floodFill takes a pre-resolved RGBA
// so the algorithm is DOM-free; here we back a fake 2D context with a plain array.

function fakeCtx(w, h, init) {
  const data = init ?? new Uint8ClampedArray(w * h * 4);
  return { getImageData: () => ({ data }), putImageData: () => {}, data };
}
const px = (ctx, w, x, y) => {
  const i = (y * w + x) * 4;
  return [ctx.data[i], ctx.data[i + 1], ctx.data[i + 2], ctx.data[i + 3]];
};

describe('raster-tools.resolveColorRGBA', () => {
  it('maps transparent to zeroes without touching a canvas', () => {
    expect(resolveColorRGBA('transparent')).toEqual([0, 0, 0, 0]);
  });
});

describe('raster-tools.floodFill', () => {
  it('fills a blank region and reports it changed', () => {
    const ctx = fakeCtx(4, 4);
    expect(floodFill(ctx, 4, 4, 0, 0, [0, 255, 0, 255])).toBe(true);
    expect(px(ctx, 4, 3, 3)).toEqual([0, 255, 0, 255]);
  });

  it('is a no-op when the target already equals the fill', () => {
    const filled = new Uint8ClampedArray(4 * 4 * 4);
    for (let i = 0; i < filled.length; i += 4) {
      filled[i + 2] = 255; // blue
      filled[i + 3] = 255; // opaque
    }
    const ctx = fakeCtx(4, 4, filled);
    expect(floodFill(ctx, 4, 4, 1, 1, [0, 0, 255, 255])).toBe(false);
  });

  it('stops at a colour boundary (does not bleed past a wall)', () => {
    // 4×1 strip, opaque-black wall at x=2 (blank elsewhere).
    const arr = new Uint8ClampedArray(4 * 1 * 4);
    arr[2 * 4 + 3] = 255; // wall alpha
    const ctx = fakeCtx(4, 1, arr);
    floodFill(ctx, 4, 1, 0, 0, [255, 0, 0, 255]); // fill the left region
    expect(px(ctx, 4, 1, 0)).toEqual([255, 0, 0, 255]); // left filled
    expect(px(ctx, 4, 3, 0)).toEqual([0, 0, 0, 0]); // right side untouched
  });
});

describe('raster-tools.expandBbox', () => {
  it('creates a point bbox when none exists', () => {
    expect(expandBbox(null, 3, 5)).toEqual({ minX: 3, minY: 5, maxX: 3, maxY: 5 });
  });
  it('grows an existing bbox in both directions', () => {
    let b = expandBbox(null, 3, 5);
    b = expandBbox(b, 1, 9);
    b = expandBbox(b, 7, 2);
    expect(b).toEqual({ minX: 1, minY: 2, maxX: 7, maxY: 9 });
  });
});

// Candidate 01 (9th arch pass): coord clamp, Bresenham line/rect, and eyedropper were
// triplicated across Paint/Sprite/Ascii (Bresenham byte-identical in Sprite + Ascii).
// Now pure units with one test each.

describe('raster-tools.clampToGrid', () => {
  const rect = { left: 10, top: 20 };
  it('floors and divides by the per-axis divisor (Sprite: scale 8)', () => {
    // clientX 10+8*3+5 → col 3; clientY 20+8*2 → row 2.
    expect(clampToGrid(39, 36, rect, { divX: 8, divY: 8, maxX: 16, maxY: 16 })).toEqual({
      x: 3,
      y: 2,
    });
  });
  it('clamps to [0, max-1] on both axes', () => {
    expect(clampToGrid(-100, 9999, rect, { divX: 1, divY: 1, maxX: 32, maxY: 24 })).toEqual({
      x: 0,
      y: 23,
    });
  });
  it('supports non-square divisors (Ascii cellW ≠ cellH)', () => {
    expect(clampToGrid(10 + 27, 20 + 30, rect, { divX: 9, divY: 15, maxX: 80, maxY: 25 })).toEqual({
      x: 3,
      y: 2,
    });
  });
});

describe('raster-tools.rasterLine', () => {
  it('walks a horizontal run inclusive of both ends', () => {
    const pts = [];
    rasterLine(0, 0, 3, 0, (x, y) => pts.push([x, y]));
    expect(pts).toEqual([
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
    ]);
  });
  it('walks a perfect diagonal', () => {
    const pts = [];
    rasterLine(0, 0, 2, 2, (x, y) => pts.push([x, y]));
    expect(pts).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
    ]);
  });
  it('handles a single point (start === end)', () => {
    const pts = [];
    rasterLine(4, 4, 4, 4, (x, y) => pts.push([x, y]));
    expect(pts).toEqual([[4, 4]]);
  });
});

describe('raster-tools.rasterRectOutline', () => {
  it('plots the perimeter of a 3×3 rect, corners once', () => {
    const seen = new Set();
    rasterRectOutline(0, 0, 2, 2, (x, y) => seen.add(`${x},${y}`));
    // 8 perimeter cells, centre (1,1) excluded.
    expect(seen.size).toBe(8);
    expect(seen.has('1,1')).toBe(false);
    expect(seen.has('0,0')).toBe(true);
    expect(seen.has('2,2')).toBe(true);
  });
  it('degenerate single row does not double-plot', () => {
    const pts = [];
    rasterRectOutline(0, 0, 3, 0, (x, y) => pts.push([x, y]));
    expect(pts).toEqual([
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
    ]);
  });
});

describe('raster-tools.readPixelHex', () => {
  const ctxOf = (rgba) => ({ getImageData: () => ({ data: rgba }) });
  it('formats an opaque pixel as #rrggbb', () => {
    expect(readPixelHex(ctxOf([255, 0, 128, 255]), 0, 0)).toBe('#ff0080');
  });
  it('returns the sentinel for a fully-transparent pixel', () => {
    expect(readPixelHex(ctxOf([0, 0, 0, 0]), 0, 0, '#000000')).toBe('#000000');
    expect(readPixelHex(ctxOf([0, 0, 0, 0]), 0, 0)).toBe('transparent');
  });
});
