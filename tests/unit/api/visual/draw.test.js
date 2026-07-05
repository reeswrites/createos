import { DrawTarget, cleanupBackdrops } from '../../../../src/api/visual/draw.js';

// ── Canvas mock ───────────────────────────────────────────────────────────────

function makeCtx() {
  const ctx = {
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    clearRect: vi.fn(),
    strokeRect: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    fillText: vi.fn(),
    drawImage: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    setTransform: vi.fn(),
    shadowColor: '',
    shadowBlur: 0,
    // fillStyle tracking — bg() restores it after painting, so capture at call time
    _fillStyle: '',
    _fillRectColors: [],
  };
  // Make fillRect record fillStyle at the time it is called
  ctx.fillRect = vi.fn().mockImplementation(() => {
    ctx._fillRectColors.push(ctx._fillStyle);
  });
  Object.defineProperty(ctx, 'fillStyle', {
    get: () => ctx._fillStyle,
    set: (v) => {
      ctx._fillStyle = v;
    },
    configurable: true,
  });
  return ctx;
}

function makeCanvas(w = 800, h = 600) {
  const ctx = makeCtx();
  const canvas = { width: w, height: h, getContext: () => ctx };
  ctx.canvas = canvas; // draw.js uses ctx.canvas.width/height in bg() and clear()
  return { canvas, ctx };
}

// Each test gets a fresh DrawTarget at a unique z.
let _zSeed = 1000;
function freshDraw() {
  const z = _zSeed++;
  const { canvas, ctx } = makeCanvas();
  const draw = new DrawTarget(z, () => canvas);
  return { draw, ctx, canvas };
}

// ── bg / clear ────────────────────────────────────────────────────────────────

describe('DrawTarget.bg', () => {
  test('fills entire canvas with the given color', () => {
    const { draw, ctx, canvas } = freshDraw();
    draw.bg('navy');
    // bg() saves + restores fillStyle, so check the color captured AT fillRect call time
    expect(ctx._fillRectColors).toContain('navy');
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, canvas.width, canvas.height);
  });
  test('restores previous fillStyle after painting', () => {
    const { draw, ctx } = freshDraw();
    ctx._fillStyle = 'red';
    draw.bg('navy');
    expect(ctx._fillStyle).toBe('red');
  });
  test('returns this', () => {
    const { draw } = freshDraw();
    expect(draw.bg('red')).toBe(draw);
  });
});

describe('DrawTarget.clear', () => {
  test('calls clearRect with full dimensions', () => {
    const { draw, ctx, canvas } = freshDraw();
    draw.clear();
    expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, canvas.width, canvas.height);
  });
  test('returns this', () => {
    const { draw } = freshDraw();
    expect(draw.clear()).toBe(draw);
  });
});

// ── rect ──────────────────────────────────────────────────────────────────────

describe('DrawTarget.rect', () => {
  test('calls fillRect with correct args', () => {
    const { draw, ctx } = freshDraw();
    draw.rect(10, 20, 100, 50, 'red');
    expect(ctx.fillStyle).toBe('red');
    expect(ctx.fillRect).toHaveBeenCalledWith(10, 20, 100, 50);
  });
  test('default color is #fff', () => {
    const { draw, ctx } = freshDraw();
    draw.rect(0, 0, 10, 10);
    expect(ctx.fillStyle).toBe('#fff');
  });
  test('returns this', () => {
    const { draw } = freshDraw();
    expect(draw.rect(0, 0, 1, 1)).toBe(draw);
  });
});

// ── circle ────────────────────────────────────────────────────────────────────

describe('DrawTarget.circle', () => {
  test('calls arc and fill', () => {
    const { draw, ctx } = freshDraw();
    draw.circle(200, 300, 50, 'blue');
    expect(ctx.fillStyle).toBe('blue');
    expect(ctx.arc).toHaveBeenCalledWith(200, 300, 50, 0, Math.PI * 2);
    expect(ctx.fill).toHaveBeenCalled();
  });
  test('returns this', () => {
    const { draw } = freshDraw();
    expect(draw.circle(0, 0, 5)).toBe(draw);
  });
});

// ── line ──────────────────────────────────────────────────────────────────────

describe('DrawTarget.line', () => {
  test('calls moveTo, lineTo, stroke', () => {
    const { draw, ctx } = freshDraw();
    draw.line(0, 0, 100, 100, 'white', 2);
    expect(ctx.strokeStyle).toBe('white');
    expect(ctx.lineWidth).toBe(2);
    expect(ctx.moveTo).toHaveBeenCalledWith(0, 0);
    expect(ctx.lineTo).toHaveBeenCalledWith(100, 100);
    expect(ctx.stroke).toHaveBeenCalled();
  });
  test('returns this', () => {
    const { draw } = freshDraw();
    expect(draw.line(0, 0, 1, 1)).toBe(draw);
  });
});

// ── text ──────────────────────────────────────────────────────────────────────

describe('DrawTarget.text', () => {
  test('calls fillText with string', () => {
    const { draw, ctx } = freshDraw();
    draw.text('hello', 10, 20);
    expect(ctx.fillText).toHaveBeenCalledWith('hello', 10, 20);
  });
  test('sets font size', () => {
    const { draw, ctx } = freshDraw();
    draw.text('hi', 0, 0, 32, 'lime');
    expect(ctx.font).toContain('32px');
    expect(ctx.fillStyle).toBe('lime');
  });
  test('returns this', () => {
    const { draw } = freshDraw();
    expect(draw.text('x', 0, 0)).toBe(draw);
  });
});

// ── poly ──────────────────────────────────────────────────────────────────────

describe('DrawTarget.poly', () => {
  test('calls moveTo + lineTo per point', () => {
    const { draw, ctx } = freshDraw();
    draw.poly(
      [
        [0, 0],
        [50, 50],
        [100, 0],
      ],
      'green',
    );
    expect(ctx.moveTo).toHaveBeenCalledWith(0, 0);
    expect(ctx.lineTo).toHaveBeenCalledWith(50, 50);
    expect(ctx.lineTo).toHaveBeenCalledWith(100, 0);
    expect(ctx.fill).toHaveBeenCalled();
  });
  test('no-ops when fewer than 2 points', () => {
    const { draw, ctx } = freshDraw();
    draw.poly([[0, 0]]);
    expect(ctx.fill).not.toHaveBeenCalled();
  });
  test('returns this', () => {
    const { draw } = freshDraw();
    expect(
      draw.poly([
        [0, 0],
        [1, 1],
      ]),
    ).toBe(draw);
  });
});

// ── arc ───────────────────────────────────────────────────────────────────────

describe('DrawTarget.arc', () => {
  test('calls arc with radians', () => {
    const { draw, ctx } = freshDraw();
    draw.arc(100, 100, 50, 0, Math.PI, 'cyan');
    expect(ctx.arc).toHaveBeenCalledWith(100, 100, 50, 0, Math.PI);
    expect(ctx.fill).toHaveBeenCalled();
  });
  test('returns this', () => {
    const { draw } = freshDraw();
    expect(draw.arc(0, 0, 5, 0, 1)).toBe(draw);
  });
});

// ── alpha / blend ─────────────────────────────────────────────────────────────

describe('DrawTarget.alpha', () => {
  test('sets globalAlpha', () => {
    const { draw, ctx } = freshDraw();
    draw.alpha(0.5);
    expect(ctx.globalAlpha).toBe(0.5);
  });
  test('returns this', () => {
    const { draw } = freshDraw();
    expect(draw.alpha(1)).toBe(draw);
  });
});

describe('DrawTarget.blend', () => {
  test('sets globalCompositeOperation', () => {
    const { draw, ctx } = freshDraw();
    draw.blend('multiply');
    expect(ctx.globalCompositeOperation).toBe('multiply');
  });
  test('returns this', () => {
    const { draw } = freshDraw();
    expect(draw.blend('screen')).toBe(draw);
  });
});

// ── push / pop ────────────────────────────────────────────────────────────────

describe('DrawTarget.push / pop', () => {
  test('push calls ctx.save', () => {
    const { draw, ctx } = freshDraw();
    draw.push();
    expect(ctx.save).toHaveBeenCalled();
  });
  test('pop calls ctx.restore', () => {
    const { draw, ctx } = freshDraw();
    draw.pop();
    expect(ctx.restore).toHaveBeenCalled();
  });
  test('push returns this', () => {
    const { draw } = freshDraw();
    expect(draw.push()).toBe(draw);
  });
});

// ── chaining ──────────────────────────────────────────────────────────────────

describe('DrawTarget chaining', () => {
  test('methods chain fluently', () => {
    const { draw } = freshDraw();
    // Should not throw; chain returns same draw
    const result = draw.bg('black').clear().rect(0, 0, 10, 10).circle(5, 5, 3);
    expect(result).toBe(draw);
  });
});

// ── pixelate ─────────────────────────────────────────────────────────────────

describe('DrawTarget.pixelate', () => {
  test('calls drawImage to downsample then upscale', () => {
    const { draw, ctx } = freshDraw();
    const src = document.createElement('canvas');
    src.width = 800;
    src.height = 600;
    draw.pixelate(src, 8);
    expect(ctx.drawImage).toHaveBeenCalled();
  });
  test('returns this', () => {
    const { draw } = freshDraw();
    const src = document.createElement('canvas');
    expect(draw.pixelate(src, 8)).toBe(draw);
  });
  test('clamps block size to 1 minimum', () => {
    const { draw } = freshDraw();
    const src = document.createElement('canvas');
    expect(() => draw.pixelate(src, 0)).not.toThrow();
  });
});

// ── toASCII ───────────────────────────────────────────────────────────────────

describe('DrawTarget.toASCII', () => {
  test('returns object with el (<pre>) and update()', () => {
    const { draw } = freshDraw();
    const src = document.createElement('canvas');
    const art = draw.toASCII(src, { cols: 10 });
    expect(art.el).toBeInstanceOf(HTMLElement);
    expect(art.el.tagName).toBe('PRE');
    expect(typeof art.update).toBe('function');
  });
  test('el has text content after creation', () => {
    const { draw } = freshDraw();
    const src = document.createElement('canvas');
    const art = draw.toASCII(src, { cols: 10, rows: 5 });
    expect(art.el.textContent.length).toBeGreaterThan(0);
  });
  test('update() re-renders into same element', () => {
    const { draw } = freshDraw();
    const src = document.createElement('canvas');
    const art = draw.toASCII(src, { cols: 10, rows: 5 });
    const before = art.el.textContent;
    art.update(src);
    expect(art.el.textContent).toBe(before);
  });
  test('custom charset respected in output length', () => {
    const { draw } = freshDraw();
    const src = document.createElement('canvas');
    const cols = 5,
      rows = 3;
    const art = draw.toASCII(src, { cols, rows, charset: '@#.' });
    // rows lines each cols chars + newline
    expect(art.el.textContent.length).toBe(rows * (cols + 1));
  });
  test('does not return this (returns { el, update } object)', () => {
    const { draw } = freshDraw();
    const src = document.createElement('canvas');
    const result = draw.toASCII(src);
    expect(result).not.toBe(draw);
    expect(typeof result).toBe('object');
  });
});

// ── backdrop ──────────────────────────────────────────────────────────────────

describe('DrawTarget.backdrop', () => {
  afterEach(() => {
    cleanupBackdrops();
    delete window.__ar_keepAlive;
    delete window.__ar_getLayerCanvas;
  });

  test('returns handle with stop() and layer', () => {
    const bdCanvas = makeCanvas(200, 100).canvas;
    const getLayerCanvas = () => bdCanvas;
    const draw = new DrawTarget(2000, getLayerCanvas);

    const img = new Image();
    Object.defineProperty(img, 'complete', { get: () => true });
    Object.defineProperty(img, 'naturalWidth', { get: () => 200 });

    const handle = draw.backdrop(img);
    expect(handle).toHaveProperty('stop');
    expect(handle).toHaveProperty('layer');
    expect(handle.layer).toBe(1999); // this.#z - 1 = 2000 - 1
  });

  test('cleanupBackdrops stops all backdrops', () => {
    window.__ar_keepAlive = new Set();
    const { canvas } = makeCanvas(200, 100);
    const bdCanvas = makeCanvas(200, 100).canvas;
    const getLayerCanvas = (z) => (z === 0 ? canvas : bdCanvas);
    const draw = new DrawTarget(2001, getLayerCanvas);

    // Live source (canvas) — starts a raf loop
    window.__ar_keepAlive.add = vi.fn(window.__ar_keepAlive.add.bind(window.__ar_keepAlive));
    window.__ar_keepAlive.delete = vi.fn(window.__ar_keepAlive.delete.bind(window.__ar_keepAlive));

    draw.backdrop(bdCanvas, { loop: true });
    expect(window.__ar_keepAlive.add).toHaveBeenCalled();

    cleanupBackdrops();
    expect(window.__ar_keepAlive.delete).toHaveBeenCalled();
  });

  test('cleanupBackdrops is idempotent', () => {
    expect(() => {
      cleanupBackdrops();
      cleanupBackdrops();
    }).not.toThrow();
  });

  test('stop() removes sentinel from __ar_keepAlive', () => {
    window.__ar_keepAlive = new Set();
    const { canvas } = makeCanvas(200, 100);
    const bdCanvas = makeCanvas(200, 100).canvas;
    const getLayerCanvas = (z) => (z === 0 ? canvas : bdCanvas);
    const draw = new DrawTarget(2002, getLayerCanvas);

    const handle = draw.backdrop(bdCanvas, { loop: true });
    const sizeBefore = window.__ar_keepAlive.size;
    handle.stop();
    expect(window.__ar_keepAlive.size).toBeLessThan(sizeBefore);
  });

  test('backdrop targets the z-1 plane, so clear() (z=0) leaves it intact', () => {
    // Regression: a z-aware getter must route backdrop onto a SEPARATE plane
    // below z=0. If the getter collapsed every z onto z=0 (the old Canvas bug),
    // backdrop and clear would fight one canvas. Here z=0 and z-1 are distinct.
    window.__ar_keepAlive = new Set();
    const { canvas } = makeCanvas(200, 100);
    const { canvas: bdCanvas } = makeCanvas(200, 100);
    // z-aware getter, mirroring Canvas's ctor: z=0 → base, anything else → plane.
    const getLayerCanvas = vi.fn((z) => (z === 0 || z == null ? canvas : bdCanvas));
    const draw = new DrawTarget(0, getLayerCanvas); // Canvas instance is #z=0

    draw.backdrop(bdCanvas, { loop: true }); // targetZ = 0-1 = -1
    draw.clear(); //                            resolves z=0

    const zsRequested = getLayerCanvas.mock.calls.map((c) => c[0]);
    expect(zsRequested).toContain(-1); // backdrop asked for a plane BELOW z=0
    expect(zsRequested).toContain(0); //  clear stayed on z=0
    expect(bdCanvas).not.toBe(canvas); // distinct planes → clear() can't wipe backdrop
  });

  test('URL string source creates an Image (no raf)', () => {
    const { canvas } = makeCanvas(200, 100);
    const bdCanvas = makeCanvas(200, 100).canvas;
    const getLayerCanvas = (z) => (z === 0 ? canvas : bdCanvas);
    const draw = new DrawTarget(2003, getLayerCanvas);

    const handle = draw.backdrop('https://example.com/photo.jpg');
    expect(handle).toHaveProperty('stop');
    // stop should not throw
    expect(() => handle.stop()).not.toThrow();
  });
});
