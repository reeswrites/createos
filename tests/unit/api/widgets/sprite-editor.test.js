import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Sprite, cleanupSprites } from '../../../../src/api/widgets/sprite.js';
import { SpriteEditor, cleanupSpriteEditors } from '../../../../src/api/widgets/sprite-editor.js';

// ── Stub wm and DOM helpers ────────────────────────────────────────────────────

let _winCounter = 0;

function makeWmWindow(id) {
  const body = document.createElement('div');
  body.className = 'wm-body';
  body.style.cssText = 'display:flex;';
  const win = document.createElement('div');
  win.id = id;
  win.appendChild(body);
  document.body.appendChild(win);
  return win;
}

beforeEach(() => {
  _winCounter = 0;
  window.wm = {
    spawn: vi.fn(() => {
      const id = `win-sprite-test-${++_winCounter}`;
      makeWmWindow(id);
      return id;
    }),
    addHistoryControls: vi.fn(),
  };
  window.__ar_active_editor_id = null;
  window.__ar_instances = null;
});

afterEach(() => {
  cleanupSpriteEditors();
  cleanupSprites();
  document.querySelectorAll('[id^="win-sprite-test-"]').forEach((el) => el.remove());
  delete window.wm;
  delete window.__ar_active_editor_id;
  delete window.__ar_instances;
});

// ── Constructor ────────────────────────────────────────────────────────────────

describe('SpriteEditor constructor', () => {
  it('creates a new Sprite when none provided', () => {
    const ed = new SpriteEditor({ width: 8, height: 8, scale: 4 });
    expect(ed.sprite).toBeInstanceOf(Sprite);
    expect(ed.sprite._w).toBe(8);
    expect(ed.sprite._h).toBe(8);
  });

  it('reuses a passed Sprite (edit-in-place)', () => {
    const sp = new Sprite({ width: 8, height: 8, scale: 4, frames: 2 });
    const ed = new SpriteEditor({ sprite: sp });
    expect(ed.sprite).toBe(sp);
    expect(ed.sprite._frames).toBe(sp._frames);
  });

  it('spawns a wm window', () => {
    new SpriteEditor({ width: 8, height: 8, scale: 4 });
    expect(window.wm.spawn).toHaveBeenCalledOnce();
    const [, opts] = window.wm.spawn.mock.calls[0];
    expect(opts.type).toBe('html');
  });

  it('default tool is pencil', () => {
    const ed = new SpriteEditor({ width: 4, height: 4, scale: 4 });
    expect(ed._tool).toBe('pencil');
  });

  it('default color is red', () => {
    const ed = new SpriteEditor({ width: 4, height: 4, scale: 4 });
    expect(ed._color).toBe('#ff0000');
  });

  it('_winId is set', () => {
    const ed = new SpriteEditor({ width: 4, height: 4, scale: 4 });
    expect(ed._winId).toBeTruthy();
    expect(document.getElementById(ed._winId)).not.toBeNull();
  });
});

// ── Tool selection ─────────────────────────────────────────────────────────────

describe('tool selection', () => {
  it('clicking a tool button sets _tool', () => {
    const ed = new SpriteEditor({ width: 4, height: 4, scale: 4 });
    const win = document.getElementById(ed._winId);
    win.querySelector('button[data-tool="fill"]').click();
    expect(ed._tool).toBe('fill');
  });

  it('clicking eraser sets _tool', () => {
    const ed = new SpriteEditor({ width: 4, height: 4, scale: 4 });
    const win = document.getElementById(ed._winId);
    win.querySelector('button[data-tool="eraser"]').click();
    expect(ed._tool).toBe('eraser');
  });

  it('clicking line sets _tool', () => {
    const ed = new SpriteEditor({ width: 4, height: 4, scale: 4 });
    const win = document.getElementById(ed._winId);
    win.querySelector('button[data-tool="line"]').click();
    expect(ed._tool).toBe('line');
  });

  it('clicking rect sets _tool', () => {
    const ed = new SpriteEditor({ width: 4, height: 4, scale: 4 });
    const win = document.getElementById(ed._winId);
    win.querySelector('button[data-tool="rect"]').click();
    expect(ed._tool).toBe('rect');
  });
});

// ── Palette / color ────────────────────────────────────────────────────────────

describe('palette', () => {
  it('clicking a swatch sets _color', () => {
    const ed = new SpriteEditor({ width: 4, height: 4, scale: 4 });
    const win = document.getElementById(ed._winId);
    const swatches = win.querySelectorAll('.wm-body > div:nth-child(2) button');
    swatches[0].click(); // first swatch = #000000
    expect(ed._color).toBe('#000000');
  });

  it('clicking transparent swatch sets _color to transparent', () => {
    const ed = new SpriteEditor({ width: 4, height: 4, scale: 4 });
    const win = document.getElementById(ed._winId);
    const transSw = win.querySelector('button[title="Transparent / erase"]');
    transSw.click();
    expect(ed._color).toBe('transparent');
  });
});

// ── Flood fill ─────────────────────────────────────────────────────────────────

describe('flood fill', () => {
  it('calls putImageData after a fill', () => {
    const ed = new SpriteEditor({ width: 4, height: 4, scale: 4 });
    const ctx = ed.sprite.ctx();

    // Target pixel (0,0) = red [255,0,0,255]; fill = transparent [0,0,0,0] → they differ
    const imgData = ctx.createImageData(4, 4);
    imgData.data[0] = 255;
    imgData.data[3] = 255; // red at (0,0)
    vi.spyOn(ctx, 'getImageData').mockReturnValue(imgData);
    const putSpy = vi.spyOn(ctx, 'putImageData');

    ed._color = 'transparent'; // resolves directly to [0,0,0,0] — no temp-canvas step
    ed._floodFill(0, 0);

    expect(putSpy).toHaveBeenCalledOnce();
  });

  it('fills contiguous region and leaves border intact', () => {
    const ed = new SpriteEditor({ width: 4, height: 4, scale: 4 });
    const ctx = ed.sprite.ctx();

    // Border = red [255,0,0,255], interior = blue [0,0,255,255]
    const imgData = ctx.createImageData(4, 4);
    const d = imgData.data;
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const i = (y * 4 + x) * 4;
        if (x === 0 || x === 3 || y === 0 || y === 3) {
          d[i] = 255;
          d[i + 3] = 255; // red border
        } else {
          d[i + 2] = 255;
          d[i + 3] = 255; // blue interior
        }
      }
    }
    vi.spyOn(ctx, 'getImageData').mockReturnValue(imgData);
    const putSpy = vi.spyOn(ctx, 'putImageData');

    // Fill interior (blue) with transparent: target=[0,0,255,255], fill=[0,0,0,0]
    ed._color = 'transparent';
    ed._floodFill(1, 1);

    expect(putSpy).toHaveBeenCalledOnce();
    const [outImg] = putSpy.mock.calls[0];
    const out = outImg.data;

    // Interior pixel (1,1) → now transparent
    const ii = (1 * 4 + 1) * 4;
    expect(out[ii + 3]).toBe(0);

    // Border pixel (0,0) → still red
    expect(out[0]).toBe(255);
    expect(out[3]).toBe(255);
  });

  it('does nothing when target color matches fill color', () => {
    const ed = new SpriteEditor({ width: 4, height: 4, scale: 4 });
    const ctx = ed.sprite.ctx();

    // All-transparent pixels (createImageData default = [0,0,0,0] everywhere)
    const imgData = ctx.createImageData(4, 4);
    vi.spyOn(ctx, 'getImageData').mockReturnValue(imgData);
    const putSpy = vi.spyOn(ctx, 'putImageData');

    // Fill transparent at a transparent pixel → fill=[0,0,0,0] = target=[0,0,0,0] → no-op
    ed._color = 'transparent';
    ed._floodFill(1, 1);

    expect(putSpy).not.toHaveBeenCalled();
  });
});

// ── Line drawing ───────────────────────────────────────────────────────────────

describe('line commit', () => {
  it('draws pixels along a horizontal line', () => {
    const ed = new SpriteEditor({ width: 8, height: 8, scale: 4 });
    ed._tool = 'line';
    ed._color = '#00ff00';
    const pixelSpy = vi.spyOn(ed.sprite, 'pixel');
    ed._commitShape({ x: 0, y: 2 }, { x: 4, y: 2 });

    for (let x = 0; x <= 4; x++) {
      expect(pixelSpy).toHaveBeenCalledWith(x, 2, '#00ff00');
    }
  });

  it('draws pixels along a diagonal (Bresenham)', () => {
    const ed = new SpriteEditor({ width: 8, height: 8, scale: 4 });
    ed._tool = 'line';
    ed._color = '#ff0000';
    const pixelSpy = vi.spyOn(ed.sprite, 'pixel');
    ed._commitShape({ x: 0, y: 0 }, { x: 2, y: 2 });

    expect(pixelSpy).toHaveBeenCalledWith(0, 0, '#ff0000');
    expect(pixelSpy).toHaveBeenCalledWith(2, 2, '#ff0000');
  });
});

// ── Rect drawing ───────────────────────────────────────────────────────────────

describe('rect commit', () => {
  it('outline rect draws corners but not interior', () => {
    const ed = new SpriteEditor({ width: 8, height: 8, scale: 4 });
    ed._tool = 'rect';
    ed._color = '#ffffff';
    const pixelSpy = vi.spyOn(ed.sprite, 'pixel');
    ed._commitShape({ x: 1, y: 1 }, { x: 4, y: 4 });

    const called = new Set(pixelSpy.mock.calls.map(([x, y]) => `${x},${y}`));
    expect(called.has('1,1')).toBe(true); // corner
    expect(called.has('4,4')).toBe(true); // corner
    expect(called.has('2,2')).toBe(false); // interior should NOT be drawn
    expect(called.has('3,3')).toBe(false);
  });

  it('filled rect draws all pixels including interior', () => {
    const ed = new SpriteEditor({ width: 8, height: 8, scale: 4 });
    ed._tool = 'rectfill';
    ed._color = '#ffffff';
    const pixelSpy = vi.spyOn(ed.sprite, 'pixel');
    ed._commitShape({ x: 1, y: 1 }, { x: 3, y: 3 });

    const called = new Set(pixelSpy.mock.calls.map(([x, y]) => `${x},${y}`));
    expect(called.has('2,2')).toBe(true); // interior
    expect(called.has('1,1')).toBe(true); // corner
    expect(called.has('3,3')).toBe(true); // opposite corner
  });
});

// ── Eyedropper ────────────────────────────────────────────────────────────────

describe('eyedropper', () => {
  it('sets _color from frame pixel data', () => {
    const ed = new SpriteEditor({ width: 4, height: 4, scale: 4 });
    const sp = ed.sprite;
    const ctx = sp.ctx();

    const imgData = ctx.createImageData(4, 4);
    imgData.data[0] = 255; // r=255 at (0,0)
    imgData.data[3] = 255; // alpha=255 at (0,0)
    vi.spyOn(ctx, 'getImageData').mockReturnValue(imgData);

    ed._eyedrop(0, 0);
    expect(ed._color).toBe('#ff0000');
  });

  it('sets _color to transparent when pixel has alpha=0', () => {
    const ed = new SpriteEditor({ width: 4, height: 4, scale: 4 });
    const ctx = ed.sprite.ctx();
    const imgData = ctx.createImageData(4, 4); // all zeros
    vi.spyOn(ctx, 'getImageData').mockReturnValue(imgData);

    ed._color = '#aabbcc';
    ed._eyedrop(0, 0);
    expect(ed._color).toBe('transparent');
  });
});

// ── Frame operations ───────────────────────────────────────────────────────────

describe('frame operations', () => {
  it('add frame button increases frameCount', () => {
    const ed = new SpriteEditor({ width: 4, height: 4, scale: 4 });
    const before = ed.sprite.frameCount;
    document.getElementById(ed._winId).querySelector('button[title="Add frame"]').click();
    expect(ed.sprite.frameCount).toBe(before + 1);
  });

  it('add frame switches to the new frame', () => {
    const ed = new SpriteEditor({ width: 4, height: 4, scale: 4 });
    document.getElementById(ed._winId).querySelector('button[title="Add frame"]').click();
    expect(ed.sprite._fi).toBe(1);
  });

  it('duplicate frame increases frameCount', () => {
    const ed = new SpriteEditor({ width: 4, height: 4, scale: 4 });
    const before = ed.sprite.frameCount;
    document
      .getElementById(ed._winId)
      .querySelector('button[title="Duplicate current frame"]')
      .click();
    expect(ed.sprite.frameCount).toBe(before + 1);
  });

  it('duplicate frame selects the new frame', () => {
    const ed = new SpriteEditor({ width: 4, height: 4, scale: 4 });
    document
      .getElementById(ed._winId)
      .querySelector('button[title="Duplicate current frame"]')
      .click();
    expect(ed.sprite._fi).toBe(1);
  });

  it('delete frame decreases frameCount', () => {
    const ed = new SpriteEditor({ width: 4, height: 4, scale: 4, frames: 2 });
    const before = ed.sprite.frameCount;
    document
      .getElementById(ed._winId)
      .querySelector('button[title="Delete current frame"]')
      .click();
    expect(ed.sprite.frameCount).toBe(before - 1);
  });

  it('delete guard: cannot delete last frame', () => {
    const ed = new SpriteEditor({ width: 4, height: 4, scale: 4 });
    expect(ed.sprite.frameCount).toBe(1);
    document
      .getElementById(ed._winId)
      .querySelector('button[title="Delete current frame"]')
      .click();
    expect(ed.sprite.frameCount).toBe(1);
  });

  it('move left swaps frames and updates _fi', () => {
    const ed = new SpriteEditor({ width: 4, height: 4, scale: 4, frames: 3 });
    const sp = ed.sprite;
    const f0 = sp._frames[0],
      f1 = sp._frames[1];
    sp.frame(1);
    document.getElementById(ed._winId).querySelector('button[title="Move frame left"]').click();
    expect(sp._fi).toBe(0);
    expect(sp._frames[0]).toBe(f1);
    expect(sp._frames[1]).toBe(f0);
  });

  it('onion skin toggle sets sprite._onionAlpha', () => {
    const ed = new SpriteEditor({ width: 4, height: 4, scale: 4, frames: 2 });
    const win = document.getElementById(ed._winId);
    const btn = win.querySelector('button[title="Toggle onion skin"]');
    btn.click();
    expect(ed.sprite._onionAlpha).toBeCloseTo(0.3);
    btn.click();
    expect(ed.sprite._onionAlpha).toBe(0);
  });
});

// ── Code export ────────────────────────────────────────────────────────────────

describe('code export', () => {
  it('inserts code into active editor when available', () => {
    const dispatch = vi.fn();
    const mockInst = { cm: { state: { doc: { length: 0 } }, dispatch, focus: vi.fn() } };
    window.__ar_active_editor_id = 42;
    window.__ar_instances = new Map([[42, mockInst]]);

    const ed = new SpriteEditor({ width: 4, height: 4, scale: 4 });
    ed._exportCode();

    expect(dispatch).toHaveBeenCalledOnce();
    const inserted = dispatch.mock.calls[0][0].changes.insert;
    expect(inserted).toContain('new Sprite(');
    expect(inserted).toContain('sp.show(');
  });

  it('code contains sp.fill or sp.pixel for non-empty frame', () => {
    const dispatch = vi.fn();
    const mockInst = { cm: { state: { doc: { length: 5 } }, dispatch, focus: vi.fn() } };
    window.__ar_active_editor_id = 42;
    window.__ar_instances = new Map([[42, mockInst]]);

    const ed = new SpriteEditor({ width: 4, height: 4, scale: 4 });
    const ctx = ed.sprite.ctx();
    // Mock getImageData to return a pixel with actual data
    const imgData = ctx.createImageData(4, 4);
    imgData.data[0] = 255;
    imgData.data[3] = 255; // red pixel at (0,0)
    vi.spyOn(ctx, 'getImageData').mockReturnValue(imgData);

    ed._exportCode();
    const inserted = dispatch.mock.calls[0][0].changes.insert;
    expect(inserted).toMatch(/sp\.pixel|sp\.fill/);
  });

  it('code includes sp.play when multiple frames', () => {
    const dispatch = vi.fn();
    const mockInst = { cm: { state: { doc: { length: 0 } }, dispatch, focus: vi.fn() } };
    window.__ar_active_editor_id = 42;
    window.__ar_instances = new Map([[42, mockInst]]);

    const ed = new SpriteEditor({ width: 4, height: 4, scale: 4, frames: 3 });
    ed._exportCode();

    const inserted = dispatch.mock.calls[0][0].changes.insert;
    expect(inserted).toContain('sp.play(');
  });
});

// ── Cleanup ───────────────────────────────────────────────────────────────────

describe('cleanupSpriteEditors', () => {
  it('stops playback on all editors', () => {
    const ed1 = new SpriteEditor({ width: 4, height: 4, scale: 4, frames: 2 });
    const ed2 = new SpriteEditor({ width: 4, height: 4, scale: 4, frames: 2 });
    ed1.sprite.play(8);
    ed2.sprite.play(8);
    cleanupSpriteEditors();
    expect(ed1.sprite._iid).toBeNull();
    expect(ed2.sprite._iid).toBeNull();
  });

  it('is idempotent', () => {
    new SpriteEditor({ width: 4, height: 4, scale: 4 });
    cleanupSpriteEditors();
    expect(() => cleanupSpriteEditors()).not.toThrow();
  });

  it('_destroy removes editor from internal list', () => {
    const ed = new SpriteEditor({ width: 4, height: 4, scale: 4 });
    ed._destroy();
    // Second destroy should not throw
    expect(() => ed._destroy()).not.toThrow();
  });
});

// ── Event hooks ───────────────────────────────────────────────────────────────

describe('SpriteEditor event hooks', () => {
  it('onPixel fires via _paintAt', () => {
    const ed = new SpriteEditor({ width: 8, height: 8, scale: 4 });
    const evs = [];
    ed.onPixel((e) => evs.push(e));
    ed._paintAt(2, 3, '#ff0000');
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({ x: 2, y: 3, color: '#ff0000' });
  });

  it('onColor fires via _setColor', () => {
    const ed = new SpriteEditor({ width: 8, height: 8, scale: 4 });
    const evs = [];
    ed.onColor((e) => evs.push(e));
    ed._setColor('#00ff00');
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({ color: '#00ff00' });
    expect(ed._color).toBe('#00ff00');
  });

  it('onStroke fires via _emitStroke', () => {
    const ed = new SpriteEditor({ width: 8, height: 8, scale: 4 });
    const evs = [];
    ed.onStroke((e) => evs.push(e));
    ed._expandBbox(1, 2);
    ed._expandBbox(5, 6);
    ed._emitStroke();
    expect(evs).toHaveLength(1);
    expect(evs[0].bbox).toMatchObject({ x: 1, y: 2, w: 4, h: 4 });
    expect(ed._strokeBbox).toBeNull();
  });

  it('_emitStroke silent when no bbox', () => {
    const ed = new SpriteEditor({ width: 8, height: 8, scale: 4 });
    const evs = [];
    ed.onStroke((e) => evs.push(e));
    ed._emitStroke();
    expect(evs).toHaveLength(0);
  });

  it('onTool fires with tool/prev', () => {
    const ed = new SpriteEditor({ width: 8, height: 8, scale: 4 });
    const evs = [];
    ed.onTool((e) => evs.push(e));
    ed._events.emit('tool', { tool: 'fill', prev: 'pencil' });
    expect(evs[0]).toMatchObject({ tool: 'fill', prev: 'pencil' });
  });

  it('onFrame fires with action', () => {
    const ed = new SpriteEditor({ width: 8, height: 8, scale: 4 });
    const evs = [];
    ed.onFrame((e) => evs.push(e));
    ed._events.emit('frame', { action: 'add', index: 1, count: 2 });
    expect(evs[0]).toMatchObject({ action: 'add', index: 1 });
  });

  it('signal decays from pixel event', () => {
    const ed = new SpriteEditor({ width: 8, height: 8, scale: 4 });
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const sig = ed.signal('pixel', { decay: 200 });
    ed._paintAt(0, 0, '#ffffff');
    expect(sig.value).toBeCloseTo(1, 5);
    now = 100;
    expect(sig.value).toBeCloseTo(0.5, 3);
    now = 200;
    expect(sig.value).toBe(0);
    vi.restoreAllMocks();
  });

  it('signal region filters by pixel coord', () => {
    const ed = new SpriteEditor({ width: 16, height: 16, scale: 4 });
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const sig = ed.signal('pixel', { decay: 100, region: { x: 0, y: 0, w: 8, h: 8 } });
    // outside
    ed._events.emit('pixel', { x: 10, y: 10, color: '#fff', frame: 0 });
    expect(sig.value).toBe(0);
    // inside
    ed._events.emit('pixel', { x: 3, y: 3, color: '#fff', frame: 0 });
    expect(sig.value).toBeCloseTo(1, 5);
    vi.restoreAllMocks();
  });

  it('returns this from all on* methods', () => {
    const ed = new SpriteEditor({ width: 8, height: 8, scale: 4 });
    expect(ed.onPixel(() => {})).toBe(ed);
    expect(ed.onStroke(() => {})).toBe(ed);
    expect(ed.onColor(() => {})).toBe(ed);
    expect(ed.onTool(() => {})).toBe(ed);
    expect(ed.onFrame(() => {})).toBe(ed);
  });

  it('cleanupSpriteEditors clears hooks', () => {
    const ed = new SpriteEditor({ width: 8, height: 8, scale: 4 });
    const calls = [];
    ed.onPixel(() => calls.push(1));
    ed._paintAt(0, 0, '#fff');
    expect(calls).toHaveLength(1);
    cleanupSpriteEditors();
    ed._paintAt(0, 0, '#fff');
    expect(calls).toHaveLength(1); // cleared
  });
});
