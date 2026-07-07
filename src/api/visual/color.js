// color.js — the shared colour leaf (deepening pass #7). Colour parsing/conversion
// used to live in two unrelated homes (inline-widgets.js's swatch popup and
// asciiEditor's ANSI export) with no canonical module, and the transparency
// checkerboard fill was copy-pasted verbatim in Paint + SpriteEditor (×2). Both
// concentrate here: DOM-free where possible, canvas-backed where the browser must parse.

// Any CSS colour string → '#rrggbb'. Uses a 1×1 canvas so the browser does the parsing
// (named colours, rgb(), hsl(), etc.). Throws only if there's no 2D context.
export function colorToHex(color) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

// Is `color` a CSS colour the browser recognises?
export function isValidColor(color) {
  const s = new Option().style;
  s.color = color;
  return s.color !== '';
}

// Best-effort resolve to a 6-digit hex, falling back to red on failure.
export function resolveToHex(color) {
  if (/^#[0-9a-f]{6}$/i.test(color)) return color;
  try {
    return colorToHex(color);
  } catch (_) {
    return '#ff0000';
  }
}

// '#rrggbb' → [r, g, b] (0–255).
export function hexToRgb(hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

// '#rrggbb' → [h(0–360), s(0–100), l(0–100)].
export function hexToHsl(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  let h = 0,
    s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

// [h, s, l] → '#rrggbb'.
export function hslToHex(h, s, l) {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) =>
    Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
  return `#${f(0).toString(16).padStart(2, '0')}${f(8).toString(16).padStart(2, '0')}${f(4).toString(16).padStart(2, '0')}`;
}

// Paint a transparency checkerboard into a 2D context (fills width×height with `cell`-sized
// squares alternating between `a` and `b`). Shared by Paint + SpriteEditor.
export function drawCheckerboard(ctx, width, height, cell = 8, a = '#888', b = '#aaa') {
  for (let y = 0; y < height; y += cell) {
    for (let x = 0; x < width; x += cell) {
      ctx.fillStyle = (x / cell + y / cell) % 2 === 0 ? a : b;
      ctx.fillRect(x, y, cell, cell);
    }
  }
}
