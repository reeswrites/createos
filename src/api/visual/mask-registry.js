// mask-registry.js — named, reusable procedural mask factories (ADR 054).
//
// `Mask` is a small registry of data-less shape generators for the dynamic
// masking system. Each factory returns a **white-on-black** canvas (so the
// default `channel:'luminance'` reads it directly) carrying an `.update(opts)`
// method for animation. Coordinates are **normalized 0–1** (resolution-
// independent, matching the stretch-to-uv mask sampling). Static use = draw
// once, never call update.
//
// Tracking-driven masks (hands/face) do NOT live here — they belong in vision.js
// (`vision.handMask`), where the mirror + smoothing logic and landmark cache are.
// `Mask` is generic geometry only; `Mask.register(name, factory)` extends it.

const _maskFactories = new Map();

function _canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function _drawCircle(ctx, o, w, h) {
  ctx.fillStyle = 'black';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'white';
  ctx.beginPath();
  ctx.arc(o.x * w, o.y * h, o.r * Math.min(w, h), 0, Math.PI * 2);
  ctx.fill();
}

function _drawFeather(ctx, o, w, h) {
  ctx.fillStyle = 'black';
  ctx.fillRect(0, 0, w, h);
  const cx = o.x * w,
    cy = o.y * h,
    r = o.r * Math.min(w, h);
  const soft = Math.max(0, Math.min(1, o.softness ?? 0.3));
  const g = ctx.createRadialGradient(cx, cy, r * (1 - soft), cx, cy, r);
  g.addColorStop(0, 'white');
  g.addColorStop(1, 'black');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
}

// Build a factory from defaults + a draw fn. The returned canvas is redrawn in
// place by `.update(nextOpts)`, so a route()/tween can animate a mask param.
function _makeFactory(defaults, drawFn) {
  return (opts = {}) => {
    const o = { ...defaults, ...opts };
    const canvas = _canvas(o.w, o.h);
    const ctx = canvas.getContext('2d');
    const render = () => drawFn(ctx, o, o.w, o.h);
    render();
    canvas.update = (next = {}) => {
      Object.assign(o, next);
      render();
      return canvas;
    };
    return canvas;
  };
}

export const Mask = {
  // Register a named factory; also exposed as Mask.<name>(opts). Survives resets
  // (registrations are library-like, not run artifacts) — matches pipe.register.
  register(name, factory) {
    _maskFactories.set(name, factory);
    Mask[name] = factory;
    return Mask;
  },
  has(name) {
    return _maskFactories.has(name);
  },
};

// ── Starter set ────────────────────────────────────────────────────────────────
Mask.register('circle', _makeFactory({ x: 0.5, y: 0.5, r: 0.25, w: 512, h: 512 }, _drawCircle));
Mask.register(
  'feather',
  _makeFactory({ x: 0.5, y: 0.5, r: 0.25, softness: 0.3, w: 512, h: 512 }, _drawFeather),
);
