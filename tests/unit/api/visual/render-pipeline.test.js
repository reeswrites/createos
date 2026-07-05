import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { pipe, Pipeline, cleanupPipelines, PixelStageBase } from '../../../../src/api/visual/render-pipeline.js';

// ── Canvas / DOM mocks ────────────────────────────────────────────────────────

function makeCtx(w = 800, h = 600) {
  const pixels = new Uint8ClampedArray(w * h * 4);
  const ctx = {
    canvas:              null,
    fillStyle:           '',
    font:                '',
    textAlign:           'left',
    textBaseline:        'alphabetic',
    imageSmoothingEnabled: true,
    filter:              'none',
    _fillTexts:          [],
    _drawImages:         [],
    _fillRects:          [],
    fillRect:   vi.fn().mockImplementation(function() { this._fillRects.push(this.fillStyle); }),
    fillText:   vi.fn().mockImplementation(function(t, x, y) { this._fillTexts.push({ t, x, y }); }),
    drawImage:  vi.fn().mockImplementation(function(src, ...rest) { this._drawImages.push({ src, args: rest }); }),
    getImageData: vi.fn().mockImplementation((x, y, w2, h2) => ({
      data: pixels.slice(0, w2 * h2 * 4),
    })),
    putImageData: vi.fn(),
    clearRect:   vi.fn(),
    save:        vi.fn(),
    restore:     vi.fn(),
    setTransform: vi.fn(),
  };
  return ctx;
}

function makeCanvas(w = 800, h = 600) {
  const ctx = makeCtx(w, h);
  const canvas = {
    width:  w,
    height: h,
    style:  { cssText: '' },
    remove: vi.fn(),
    getContext: vi.fn(() => ctx),
  };
  ctx.canvas = canvas;
  return { canvas, ctx };
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

let _canvasSeed = 0;
const _canvases = [];

beforeEach(() => {
  _canvases.length = 0;

  // Patch document.createElement to return mock canvases and divs
  vi.spyOn(document, 'createElement').mockImplementation((tag) => {
    if (tag === 'canvas') {
      const { canvas } = makeCanvas();
      // Give each canvas unique tracking id
      canvas._id = ++_canvasSeed;
      _canvases.push(canvas);
      return canvas;
    }
    if (tag === 'div') {
      return {
        style: { cssText: '' },
        remove: vi.fn(),
        appendChild: vi.fn(),
        querySelector: vi.fn(() => null),
        querySelectorAll: vi.fn(() => []),
        innerHTML: '',
      };
    }
    return { style: {}, remove: vi.fn(), appendChild: vi.fn() };
  });

  vi.spyOn(document.body, 'appendChild').mockImplementation(() => {});
  vi.spyOn(document, 'getElementById').mockReturnValue(null);

  // Fake requestAnimationFrame — captures callback but does NOT invoke synchronously
  // (synchronous invocation would cause infinite recursion in the pipeline loop).
  let _rafId = 0;
  global.requestAnimationFrame = vi.fn(() => ++_rafId);
  global.cancelAnimationFrame  = vi.fn();

  // Mock window globals
  global.window.__ar_paused   = false;
  global.window.__ar_keepAlive = new Set();
  global.window.GLShader = vi.fn().mockImplementation(function() {
    this._canvas  = makeCanvas().canvas;  // .canvas not ._canvas
    this.video    = vi.fn().mockReturnThis();
    this.start    = vi.fn().mockReturnThis();
    this._destroy = vi.fn();
  });
});

afterEach(() => {
  cleanupPipelines();
  vi.restoreAllMocks();
  delete global.window.__ar_keepAlive;
});

// ── InputAdapter ──────────────────────────────────────────────────────────────

describe('pipe() source resolution', () => {
  it('accepts HTMLCanvasElement', () => {
    const { canvas } = makeCanvas();
    const p = pipe(canvas);
    expect(p).toBeInstanceOf(Pipeline);
    expect(p._head._getSource()).toBe(canvas);
  });

  it('accepts HTMLVideoElement (duck-typed)', () => {
    // Duck-typed video: has readyState + videoWidth
    const video = { videoWidth: 1920, videoHeight: 1080, readyState: 4 };
    const p = pipe(video);
    expect(p._head._getSource()).toBe(video);
  });

  it('accepts CameraStream (has .element duck-typed video)', () => {
    const video = { videoWidth: 1920, videoHeight: 1080, readyState: 4 };
    const cam = { element: video };
    const p = pipe(cam);
    expect(p._head._getSource()).toBe(video);
  });

  it('accepts GLShader-like (has .canvas)', () => {
    const { canvas } = makeCanvas();
    const shaderLike = { canvas };
    const p = pipe(shaderLike);
    expect(p._head._getSource()).toBe(canvas);
  });

  it('accepts Layer-like (has ._canvas)', () => {
    const { canvas } = makeCanvas();
    const layer = { _canvas: canvas };
    const p = pipe(layer);
    expect(p._head._getSource()).toBe(canvas);
  });

  it('throws on unsupported source', () => {
    expect(() => pipe({ foo: 'bar' })).toThrow(/unsupported source/);
  });
});

// ── AsciiStage ────────────────────────────────────────────────────────────────

describe('MaskStage (ADR 054)', () => {
  it('mask is registered in STAGE_CTORS (so it survives timelined routes)', () => {
    expect(typeof Pipeline.STAGE_CTORS.mask).toBe('function');
  });

  it('pipe(src).mask(m) pushes a MaskStage', () => {
    const src = makeCanvas(800, 600).canvas;
    const mask = makeCanvas(800, 600).canvas;
    const p = pipe(src).mask(mask);
    const stage = p._stages[0];
    expect(stage._canvas).toBeTruthy();
    stage._start();
    expect(stage._canvas.width).toBe(800);
    expect(stage._canvas.height).toBe(600);
  });

  it('read() composites without throwing (destination-in + luminance→alpha)', () => {
    const src = makeCanvas(64, 64).canvas;
    const mask = makeCanvas(64, 64).canvas;
    const stage = pipe(src).mask(mask, { channel: 'luminance' })._stages[0];
    stage._start();
    expect(() => stage.read()).not.toThrow();
  });

  it('set() updates source/channel/invert live', () => {
    const src = makeCanvas().canvas;
    const stage = pipe(src).mask(makeCanvas().canvas)._stages[0];
    const newMask = makeCanvas().canvas;
    stage.set({ source: newMask, channel: 'alpha', invert: true });
    expect(stage._source).toBe(newMask);
    expect(stage._channel).toBe('alpha');
    expect(stage._invert).toBe(true);
  });
});

describe('AsciiStage', () => {
  it('creates a canvas on _start()', () => {
    const src = makeCanvas(800, 600).canvas;
    const p = pipe(src).ascii({ cols: 10, rows: 4 });
    const stage = p._stages[0];

    // Access canvas before start — should exist (created in constructor)
    expect(stage._canvas).toBeTruthy();
    stage._start();
    // Canvas sized: cols * cellW × rows * cellH
    expect(stage._canvas.width).toBe(10 * (stage._cellW));
    expect(stage._canvas.height).toBe(4 * (stage._cellH));
  });

  it('exposes .canvas getter matching ._canvas', () => {
    const src = makeCanvas().canvas;
    const p = pipe(src).ascii({ cols: 20 });
    expect(p._stages[0].canvas).toBe(p._stages[0]._canvas);
  });

  it('luma→glyph mapping: bright pixel → dense glyph', () => {
    const { canvas } = makeCanvas(800, 600);
    const p = pipe(canvas).ascii({ cols: 2, rows: 1, charset: ' .#', cellW: 8, cellH: 14 });
    const stage = p._stages[0];
    stage._start();

    // Inject known pixel data into the offscreen ctx
    const offCtx = stage._offCtx;
    // Bright white pixel at col 0: should map to last char '#'
    // Dark black pixel at col 1: should map to ' '
    offCtx.getImageData = vi.fn().mockReturnValue({
      data: new Uint8ClampedArray([
        255, 255, 255, 255,   // col 0: white → lum=1 → '#'
        0,   0,   0,   255,   // col 1: black → lum=0 → ' '
      ]),
    });

    stage.read();

    // fillText should have been called once (for '#' — space chars are skipped)
    const texts = stage._ctx._fillTexts;
    expect(texts.length).toBe(1);
    expect(texts[0].t).toBe('#');
  });

  it('luma calculation matches draw.toASCII weights (0.299/0.587/0.114)', () => {
    // lum = (r*0.299 + g*0.587 + b*0.114) / 255
    // charset ' .:-=+*#%@' (10 chars)
    // lum=0.5 → index=floor(0.5*10)=5 → char '+'
    const { canvas } = makeCanvas(800, 600);
    const p = pipe(canvas).ascii({ cols: 1, rows: 1, charset: ' .:-=+*#%@', cellW: 8, cellH: 14 });
    const stage = p._stages[0];
    stage._start();

    // r=128,g=128,b=128 → lum=(128*0.299+128*0.587+128*0.114)/255 ≈ 0.502
    // index=floor(0.502*10)=5 → '+'
    stage._offCtx.getImageData = vi.fn().mockReturnValue({
      data: new Uint8ClampedArray([128, 128, 128, 255]),
    });
    stage.read();
    expect(stage._ctx._fillTexts[0]?.t).toBe('+');
  });

  it('_getSource() returns the output canvas', () => {
    const src = makeCanvas().canvas;
    const p = pipe(src).ascii({ cols: 10 });
    const stage = p._stages[0];
    stage._start();
    expect(stage._getSource()).toBe(stage._canvas);
  });
});

// ── Pipeline chaining ─────────────────────────────────────────────────────────

describe('Pipeline stage chaining', () => {
  it('each chain method returns the same Pipeline instance', () => {
    const { canvas } = makeCanvas();
    const p = pipe(canvas);
    expect(p.ascii()).toBe(p);
    expect(p.pixelate()).toBe(p);
    expect(p.fx('blur(2px)')).toBe(p);
  });

  it('stages are wired upstream → downstream', () => {
    const { canvas } = makeCanvas();
    const p = pipe(canvas).ascii({ cols: 10 }).pixelate({ blockSize: 4 });
    const [ascii, pix] = p._stages;
    // Pixelate stage's upstream is AsciiStage
    expect(pix._upstream).toBe(ascii);
    // AsciiStage's upstream is head InputAdapter
    expect(ascii._upstream).toBe(p._head);
  });

  it('.glshader() pushes a shader stage with _isShader=true', () => {
    const { canvas } = makeCanvas();
    const p = pipe(canvas).glshader('void main() {}');
    expect(p._stages[0]._isShader).toBe(true);
  });

  it('_last() returns head when no stages', () => {
    const { canvas } = makeCanvas();
    const p = pipe(canvas);
    expect(p._last()).toBe(p._head);
  });

  it('_last() returns final stage when stages exist', () => {
    const { canvas } = makeCanvas();
    const p = pipe(canvas).ascii().pixelate();
    expect(p._last()).toBe(p._stages[1]);
  });
});

// ── Pipeline.start() / keepAlive ─────────────────────────────────────────────

describe('Pipeline.start() / keepAlive', () => {
  it('registers sentinel in __ar_keepAlive', () => {
    const { canvas } = makeCanvas();
    const p = pipe(canvas).start();
    expect(window.__ar_keepAlive.has(p._sentinel)).toBe(true);
  });

  it('stop() removes sentinel from __ar_keepAlive', () => {
    const { canvas } = makeCanvas();
    const p = pipe(canvas).start();
    p.stop();
    expect(window.__ar_keepAlive.has(p._sentinel)).toBe(false);
  });

  it('start() is idempotent (double-call does not double-register)', () => {
    const { canvas } = makeCanvas();
    pipe(canvas).start().start();
    expect(window.__ar_keepAlive.size).toBe(1);
  });
});

// ── cleanupPipelines ──────────────────────────────────────────────────────────

describe('cleanupPipelines()', () => {
  it('stops all pipelines and clears keepAlive sentinels', () => {
    const { canvas: c1 } = makeCanvas();
    const { canvas: c2 } = makeCanvas();
    pipe(c1).start();
    pipe(c2).start();

    expect(window.__ar_keepAlive.size).toBe(2);
    cleanupPipelines();
    expect(window.__ar_keepAlive.size).toBe(0);
  });

  it('is idempotent (calling twice does not throw)', () => {
    const { canvas } = makeCanvas();
    pipe(canvas).start();
    expect(() => { cleanupPipelines(); cleanupPipelines(); }).not.toThrow();
  });

  it('calls _destroy on stage canvases', () => {
    const { canvas } = makeCanvas();
    const p = pipe(canvas).ascii().start();
    const stage = p._stages[0];
    stage._start(); // ensure canvas exists
    const removeSpy = vi.spyOn(stage._canvas, 'remove');
    cleanupPipelines();
    expect(removeSpy).toHaveBeenCalled();
  });

  it('scoped reset only destroys the resetting editor\'s pipelines', () => {
    const prev = window.__ar_active_editor_id;
    const { canvas: c1 } = makeCanvas();
    const { canvas: c2 } = makeCanvas();
    window.__ar_active_editor_id = 1;
    const p1 = pipe(c1).start();   // editor 1
    window.__ar_active_editor_id = 2;
    const p2 = pipe(c2).start();   // editor 2
    window.__ar_active_editor_id = prev;

    cleanupPipelines(2);            // editor 2 resets
    expect(window.__ar_keepAlive.size).toBe(1);  // editor 1's pipeline survives
    expect(p1._rafId).not.toBeNull();
    expect(p2._rafId).toBeNull();
  });

  it('global reset (no editorId) destroys every pipeline', () => {
    const { canvas: c1 } = makeCanvas();
    const { canvas: c2 } = makeCanvas();
    window.__ar_active_editor_id = 1;
    pipe(c1).start();
    window.__ar_active_editor_id = 2;
    pipe(c2).start();
    window.__ar_active_editor_id = undefined;

    cleanupPipelines();
    expect(window.__ar_keepAlive.size).toBe(0);
  });
});

// ── PixelateStage ─────────────────────────────────────────────────────────────

describe('PixelateStage', () => {
  it('creates output canvas matching upstream dimensions', () => {
    const { canvas } = makeCanvas(640, 480);
    canvas.width = 640; canvas.height = 480;
    const p = pipe(canvas).pixelate({ blockSize: 16 });
    const stage = p._stages[0];
    stage._start();
    expect(stage._canvas.width).toBe(640);
    expect(stage._canvas.height).toBe(480);
  });

  it('read() calls drawImage twice (downscale + upscale)', () => {
    const { canvas } = makeCanvas(640, 480);
    canvas.width = 640; canvas.height = 480;
    const p = pipe(canvas).pixelate({ blockSize: 10 });
    const stage = p._stages[0];
    stage._start();
    stage.read();
    // offCtx: drawImage(src, 0, 0, pw, ph)
    // ctx:    drawImage(offCanvas, 0, 0, w, h)
    expect(stage._offCtx._drawImages.length).toBe(1);
    expect(stage._ctx._drawImages.length).toBe(1);
  });
});

// ── FxStage ───────────────────────────────────────────────────────────────────

describe('FxStage', () => {
  it('applies filter then resets to none', () => {
    const { canvas } = makeCanvas(800, 600);
    const p = pipe(canvas).fx('hue-rotate(90deg)');
    const stage = p._stages[0];
    stage._start();

    let capturedFilter = null;
    stage._ctx.drawImage = vi.fn().mockImplementation(function() {
      capturedFilter = this.filter;
    });
    stage.read();

    expect(capturedFilter).toBe('hue-rotate(90deg)');
    expect(stage._ctx.filter).toBe('none');
  });
});

// ── GLShaderStage ─────────────────────────────────────────────────────────────

describe('GLShaderStage', () => {
  it('_start() creates a GLShader with video set to upstream source', () => {
    const { canvas } = makeCanvas();
    const p = pipe(canvas).glshader('void main(){}');
    const stage = p._stages[0];
    stage._start();

    expect(window.GLShader).toHaveBeenCalled();
    const inst = stage._shaderInst;
    expect(inst.video).toHaveBeenCalledWith(canvas);
    expect(inst.start).toHaveBeenCalled();
  });

  it('uses _sinkContainer when set (skip hidden div)', () => {
    const { canvas } = makeCanvas();
    const container = { style: { cssText: '' }, appendChild: vi.fn() };
    const p = pipe(canvas).glshader('void main(){}');
    const stage = p._stages[0];
    stage._sinkContainer = container;
    stage._start();

    // No hidden div should be created
    expect(stage._hiddenDiv).toBeNull();
  });

  it('_destroy() calls shaderInst._destroy', () => {
    const { canvas } = makeCanvas();
    const p = pipe(canvas).glshader('void main(){}');
    const stage = p._stages[0];
    stage._start();
    stage._destroy();
    expect(stage._shaderInst).toBeNull();
  });

  it('accepts a pre-created GLShader instance instead of body string', () => {
    const { canvas: src } = makeCanvas();
    const existingShader = { _canvas: makeCanvas().canvas, video: vi.fn().mockReturnThis(), start: vi.fn().mockReturnThis(), _destroy: vi.fn() };
    const p = pipe(src).glshader(existingShader);
    const stage = p._stages[0];
    stage._start();

    expect(window.GLShader).not.toHaveBeenCalled();  // no new construction
    expect(stage._shaderInst).toBe(existingShader);
    expect(existingShader.video).toHaveBeenCalledWith(src);
    expect(existingShader.start).toHaveBeenCalled();
  });

  it('does NOT destroy pre-created instance on _destroy()', () => {
    const { canvas: src } = makeCanvas();
    const existingShader = { _canvas: makeCanvas().canvas, video: vi.fn().mockReturnThis(), start: vi.fn().mockReturnThis(), _destroy: vi.fn() };
    const p = pipe(src).glshader(existingShader);
    const stage = p._stages[0];
    stage._start();
    stage._destroy();
    expect(existingShader._destroy).not.toHaveBeenCalled();
  });

  it('pre-created instance _getSource() returns its canvas', () => {
    const { canvas: src } = makeCanvas();
    const shaderCanvas = makeCanvas().canvas;
    const existingShader = { _canvas: shaderCanvas, video: vi.fn().mockReturnThis(), start: vi.fn().mockReturnThis(), _destroy: vi.fn() };
    const stage = pipe(src).glshader(existingShader)._stages[0];
    stage._start();
    expect(stage._getSource()).toBe(shaderCanvas);
  });
});

// ── CustomStage (.use) ────────────────────────────────────────────────────────

describe('pipe().use(factory)', () => {
  it('factory receives the upstream drawable', () => {
    const { canvas: src } = makeCanvas();
    let capturedSrc = null;
    const factory = vi.fn((s) => {
      capturedSrc = s;
      const { canvas: out } = makeCanvas();
      return { canvas: out, read: vi.fn() };
    });

    const p = pipe(src).use(factory);
    p._stages[0]._start();
    expect(capturedSrc).toBe(src);
  });

  it('read() delegates to user read()', () => {
    const { canvas: src } = makeCanvas();
    const userRead = vi.fn();
    const factory = () => {
      const { canvas: out } = makeCanvas();
      return { canvas: out, read: userRead };
    };

    const p = pipe(src).use(factory);
    const stage = p._stages[0];
    stage._start();
    stage.read();
    expect(userRead).toHaveBeenCalledTimes(1);
  });

  it('exposes factory output canvas via _getSource()', () => {
    const { canvas: src } = makeCanvas();
    const { canvas: out } = makeCanvas();
    const factory = () => ({ canvas: out, read: vi.fn() });

    const p = pipe(src).use(factory);
    p._stages[0]._start();
    expect(p._stages[0]._getSource()).toBe(out);
  });

  it('throws if factory returns no canvas', () => {
    const { canvas: src } = makeCanvas();
    const factory = () => ({ read: vi.fn() }); // missing canvas
    const p = pipe(src).use(factory);
    expect(() => p._stages[0]._start()).toThrow(/factory must return/);
  });

  it('chains after built-in stages', () => {
    const { canvas: src } = makeCanvas();
    const { canvas: out } = makeCanvas();
    const userRead = vi.fn();
    const p = pipe(src).ascii({ cols: 10 }).use(() => ({ canvas: out, read: userRead }));
    expect(p._stages.length).toBe(2);
    expect(p._stages[1]._upstream).toBe(p._stages[0]);
  });

  it('_isShader is false (driven by pipeline loop not self-raf)', () => {
    const { canvas: src } = makeCanvas();
    const p = pipe(src).use(() => ({ canvas: makeCanvas().canvas, read: vi.fn() }));
    expect(p._stages[0]._isShader).toBe(false);
  });
});

// ── pipe.register ─────────────────────────────────────────────────────────────

describe('pipe.register()', () => {
  afterEach(() => {
    // Clean up any registered stage methods from Pipeline.prototype
    delete Pipeline.prototype.testStage;
    delete Pipeline.prototype.noFieldStage;
    delete Pipeline.prototype.colorStage;
  });

  it('adds a chainable method on Pipeline.prototype', () => {
    const userRead = vi.fn();
    pipe.register('testStage', (_src, _opts) => {
      const { canvas } = makeCanvas();
      return { canvas, read: userRead };
    });
    const { canvas: src } = makeCanvas();
    const p = pipe(src).testStage({ x: 1 });
    expect(p).toBeInstanceOf(Pipeline);
    expect(p._stages.length).toBe(1);
    expect(p._stages[0]).toBeInstanceOf(Object); // CustomStage
  });

  it('stage method passes opts to factory', () => {
    let capturedOpts = null;
    pipe.register('testStage', (_src, opts) => {
      capturedOpts = opts;
      const { canvas } = makeCanvas();
      return { canvas, read: vi.fn() };
    });
    const { canvas: src } = makeCanvas();
    const p = pipe(src).testStage({ cols: 99, color: '#f00' });
    p._stages[0]._start();
    expect(capturedOpts).toEqual({ cols: 99, color: '#f00' });
  });

  it('multiple registrations produce independent methods', () => {
    pipe.register('testStage', (_src) => ({ canvas: makeCanvas().canvas, read: vi.fn() }));
    pipe.register('colorStage', (_src) => ({ canvas: makeCanvas().canvas, read: vi.fn() }));
    const { canvas: src } = makeCanvas();
    const p = pipe(src).testStage().colorStage();
    expect(p._stages.length).toBe(2);
  });

  it('calls window.__ar_addToolkitEntry with Pipeline category', () => {
    const addEntry = vi.fn();
    global.window.__ar_addToolkitEntry = addEntry;
    pipe.register('testStage', (_src) => ({ canvas: makeCanvas().canvas, read: vi.fn() }), {
      label: 'Test Stage',
      hint: 'A test stage',
    });
    expect(addEntry).toHaveBeenCalledWith('Pipeline', expect.objectContaining({
      label: 'Test Stage',
      hint: 'A test stage',
      blockType: 'pipe_custom_testStage',
    }));
    delete global.window.__ar_addToolkitEntry;
  });

  it('toolkit entry code contains the stage name', () => {
    let capturedCmd = null;
    global.window.__ar_addToolkitEntry = (_cat, cmd) => { capturedCmd = cmd; };
    pipe.register('noFieldStage', (_src) => ({ canvas: makeCanvas().canvas, read: vi.fn() }), {
      label: 'No Fields',
    });
    expect(capturedCmd.code).toContain('.noFieldStage(');
    delete global.window.__ar_addToolkitEntry;
  });

  it('toolkit entry code includes default field values', () => {
    let capturedCmd = null;
    global.window.__ar_addToolkitEntry = (_cat, cmd) => { capturedCmd = cmd; };
    pipe.register('colorStage', (_src) => ({ canvas: makeCanvas().canvas, read: vi.fn() }), {
      label: 'Color Stage',
      fields: [
        { name: 'cols', type: 'number', default: 120 },
        { name: 'color', type: 'color', default: '#00ff41' },
      ],
    });
    expect(capturedCmd.code).toContain('cols: 120');
    expect(capturedCmd.code).toContain('color: "#00ff41"');
    delete global.window.__ar_addToolkitEntry;
  });

  it('chained after built-in stages', () => {
    pipe.register('testStage', (_src) => ({ canvas: makeCanvas().canvas, read: vi.fn() }));
    const { canvas: src } = makeCanvas();
    const p = pipe(src).ascii({ cols: 10 }).testStage().pixelate({ blockSize: 4 });
    expect(p._stages.length).toBe(3);
    expect(p._stages[1]._upstream).toBe(p._stages[0]);
    expect(p._stages[2]._upstream).toBe(p._stages[1]);
  });
});

// ── PixelStageBase — shared canvas boilerplate ─────────────────────────────────

describe('PixelStageBase subclass', () => {
  // Minimal upstream stub satisfying the interface
  function makeUpstream(w = 4, h = 4) {
    const { canvas, ctx } = makeCanvas(w, h);
    return {
      _getSource: () => canvas,
      canvas,
      ctx,
    };
  }

  // Concrete subclass that inverts red channel only (simplest unique transform)
  class InvertRedStage extends PixelStageBase {
    _processPixels(data) {
      for (let i = 0; i < data.length; i += 4) data[i] = 255 - data[i];
    }
  }

  it('_start() initializes both canvases', () => {
    const up = makeUpstream(8, 6);
    const stage = new InvertRedStage(up);
    stage._start();
    expect(stage._canvas.width).toBe(8);
    expect(stage._canvas.height).toBe(6);
    expect(stage._ctx).toBeDefined();
    expect(stage._offCtx).toBeDefined();
  });

  it('read() calls drawImage → getImageData → _processPixels → putImageData', () => {
    const up = makeUpstream(4, 4);
    const stage = new InvertRedStage(up);
    stage._start();

    const fakeData = new Uint8ClampedArray(4 * 4 * 4).fill(128);
    const putData = vi.fn();
    stage._offCtx.getImageData = vi.fn(() => ({ data: fakeData }));
    stage._ctx.putImageData = putData;

    stage.read();

    expect(stage._offCtx.drawImage).toHaveBeenCalled();
    expect(putData).toHaveBeenCalled();
    // red channels inverted: 128 → 127
    expect(fakeData[0]).toBe(127);
    expect(fakeData[1]).toBe(128); // green unchanged
  });

  it('read() is no-op before _start()', () => {
    const up = makeUpstream();
    const stage = new InvertRedStage(up);
    // Should not throw even without _ctx
    expect(() => stage.read()).not.toThrow();
  });

  it('_destroy() calls remove() and nulls ctx refs', () => {
    const up = makeUpstream();
    const stage = new InvertRedStage(up);
    stage._start();
    stage._destroy();
    expect(stage._canvas.remove).toHaveBeenCalled();
    expect(stage._ctx).toBeNull();
    expect(stage._offCtx).toBeNull();
  });

  it('_getSource() returns _canvas', () => {
    const up = makeUpstream();
    const stage = new InvertRedStage(up);
    expect(stage._getSource()).toBe(stage._canvas);
  });
});

// ── Pipeline.STAGE_CTORS — single source of truth ─────────────────────────────

describe('Pipeline.STAGE_CTORS', () => {
  const expectedTypes = [
    'tint','negative','solarize','posterize','duotone',
    'grain','strobe','blur','hue','ascii','pixelate','fx',
  ];

  it('contains all expected stage types', () => {
    const ctors = Pipeline.STAGE_CTORS;
    for (const type of expectedTypes) {
      expect(ctors[type], `missing stage type '${type}'`).toBeDefined();
    }
  });

  it('each entry is a function returning an object with read/_getSource', () => {
    const ctors = Pipeline.STAGE_CTORS;
    const fakeUpstream = { _getSource: () => makeCanvas().canvas };
    for (const [type, ctor] of Object.entries(ctors)) {
      let stage;
      // provide sensible defaults for each type
      if (type === 'tint')      stage = ctor(fakeUpstream, '#ff0000');
      else if (type === 'blur') stage = ctor(fakeUpstream, 4);
      else if (type === 'hue')  stage = ctor(fakeUpstream, 90);
      else if (type === 'fx')   stage = ctor(fakeUpstream, 'invert(1)');
      else                      stage = ctor(fakeUpstream);
      expect(typeof stage.read,       `${type}.read`).toBe('function');
      expect(typeof stage._getSource, `${type}._getSource`).toBe('function');
    }
  });

  it('_createNamedStage delegates to STAGE_CTORS', () => {
    const { canvas: src } = makeCanvas();
    const p = pipe(src);
    const stage = p._createNamedStage('grain', [0.3]);
    expect(stage).toBeDefined();
    expect(typeof stage.read).toBe('function');
  });

  it('_createNamedStage throws for unknown type', () => {
    const { canvas: src } = makeCanvas();
    const p = pipe(src);
    expect(() => p._createNamedStage('unicorn', [])).toThrow(/unknown stage type/);
  });
});
