import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Sprite, cleanupSprites } from '../../../../src/api/widgets/sprite.js';

// Stub wm.spawn for show() tests
beforeEach(() => {
  window.wm = { spawn: vi.fn(() => ({ id: 'win-1' })) };
});
afterEach(() => {
  cleanupSprites();
  delete window.wm;
});

describe('Sprite constructor', () => {
  it('creates display canvas at scaled size', () => {
    const sp = new Sprite({ width: 8, height: 8, scale: 4 });
    expect(sp.canvas).toBeInstanceOf(HTMLCanvasElement);
    expect(sp.canvas.width).toBe(32);
    expect(sp.canvas.height).toBe(32);
  });

  it('creates the requested number of frames', () => {
    const sp = new Sprite({ width: 4, height: 4, scale: 2, frames: 3 });
    expect(sp.frameCount).toBe(3);
  });

  it('defaults to 1 frame', () => {
    const sp = new Sprite();
    expect(sp.frameCount).toBe(1);
  });
});

describe('Sprite.pixel', () => {
  it('returns this for chaining', () => {
    const sp = new Sprite({ width: 4, height: 4, scale: 4 });
    expect(sp.pixel(0, 0, '#f00')).toBe(sp);
  });

  it('calls fillRect on the frame context', () => {
    const sp = new Sprite({ width: 4, height: 4, scale: 4 });
    const ctx = sp._frames[0].getContext('2d');
    const spy = vi.spyOn(ctx, 'fillRect');
    sp.pixel(2, 3, '#ff0000');
    // fillRect should be called with floor coords
    expect(spy).toHaveBeenCalledWith(2, 3, 1, 1);
    expect(ctx.fillStyle).toBe('#ff0000');
  });
});

describe('Sprite.fill', () => {
  it('fill(color) calls fillRect on full frame', () => {
    const sp = new Sprite({ width: 4, height: 4, scale: 4 });
    const ctx = sp._frames[0].getContext('2d');
    const spy = vi.spyOn(ctx, 'fillRect');
    sp.fill('#00ff00');
    expect(ctx.fillStyle).toBe('#00ff00');
    expect(spy).toHaveBeenCalledWith(0, 0, 4, 4);
  });

  it('fill(x,y,w,h,color) calls fillRect on rect', () => {
    const sp = new Sprite({ width: 8, height: 8, scale: 4 });
    const ctx = sp._frames[0].getContext('2d');
    const spy = vi.spyOn(ctx, 'fillRect');
    sp.fill(1, 2, 3, 4, '#0000ff');
    expect(ctx.fillStyle).toBe('#0000ff');
    expect(spy).toHaveBeenCalledWith(1, 2, 3, 4);
  });

  it('returns this for chaining', () => {
    const sp = new Sprite({ width: 4, height: 4, scale: 4 });
    expect(sp.fill('#111')).toBe(sp);
  });
});

describe('Sprite.frame', () => {
  it('frame() with no arg returns current index', () => {
    const sp = new Sprite({ frames: 3 });
    expect(sp.frame()).toBe(0);
  });

  it('frame(n) sets current frame index', () => {
    const sp = new Sprite({ frames: 3 });
    sp.frame(2);
    expect(sp.frame()).toBe(2);
  });

  it('frame(n) wraps by frameCount', () => {
    const sp = new Sprite({ frames: 3 });
    sp.frame(5); // 5 % 3 = 2
    expect(sp.frame()).toBe(2);
  });

  it('frame(n) returns this for chaining', () => {
    const sp = new Sprite({ frames: 3 });
    expect(sp.frame(1)).toBe(sp);
  });
});

describe('Sprite.addFrame', () => {
  it('increases frameCount and returns new index', () => {
    const sp = new Sprite({ frames: 1 });
    const idx = sp.addFrame();
    expect(idx).toBe(1);
    expect(sp.frameCount).toBe(2);
  });
});

describe('Sprite.clear', () => {
  it('calls clearRect on frame context', () => {
    const sp = new Sprite({ width: 4, height: 4, scale: 4 });
    const ctx = sp._frames[0].getContext('2d');
    const spy = vi.spyOn(ctx, 'clearRect');
    sp.clear();
    expect(spy).toHaveBeenCalledWith(0, 0, 4, 4);
  });

  it('returns this for chaining', () => {
    const sp = new Sprite();
    expect(sp.clear()).toBe(sp);
  });
});

describe('Sprite.ctx', () => {
  it('returns 2d context for the current frame', () => {
    const sp = new Sprite({ width: 4, height: 4, scale: 4 });
    const ctx = sp.ctx();
    expect(ctx).not.toBeNull();
    expect(typeof ctx.fillRect).toBe('function');
  });
});

describe('Sprite.onionSkin', () => {
  it('sets _onionAlpha', () => {
    const sp = new Sprite({ frames: 2 });
    sp.onionSkin(0.4);
    expect(sp._onionAlpha).toBeCloseTo(0.4);
  });

  it('returns this for chaining', () => {
    const sp = new Sprite({ frames: 2 });
    expect(sp.onionSkin(0.3)).toBe(sp);
  });
});

describe('Sprite.play / stop', () => {
  it('play() sets _iid', () => {
    const sp = new Sprite({ frames: 2 });
    sp.play(8);
    expect(sp._iid).not.toBeNull();
    sp.stop();
  });

  it('stop() clears _iid', () => {
    const sp = new Sprite({ frames: 2 });
    sp.play(8);
    sp.stop();
    expect(sp._iid).toBeNull();
  });

  it('play() returns this', () => {
    const sp = new Sprite({ frames: 2 });
    expect(sp.play(4)).toBe(sp);
    sp.stop();
  });

  it('stop() returns this', () => {
    const sp = new Sprite({ frames: 2 });
    sp.play(4);
    expect(sp.stop()).toBe(sp);
  });
});

describe('Sprite.show', () => {
  it('calls wm.spawn with canvas type', () => {
    const sp = new Sprite({ width: 8, height: 8, scale: 4 });
    sp.show('MySprite');
    expect(window.wm.spawn).toHaveBeenCalledOnce();
    const [title, opts] = window.wm.spawn.mock.calls[0];
    expect(title).toBe('MySprite');
    expect(opts.canvas).toBe(sp.canvas);
    expect(opts.type).toBe('canvas');
  });

  it('returns this for chaining', () => {
    const sp = new Sprite();
    expect(sp.show()).toBe(sp);
  });
});

describe('cleanupSprites', () => {
  it('stops all playing sprites', () => {
    const sp1 = new Sprite({ frames: 2 });
    const sp2 = new Sprite({ frames: 2 });
    sp1.play(8);
    sp2.play(4);
    cleanupSprites();
    expect(sp1._iid).toBeNull();
    expect(sp2._iid).toBeNull();
  });
});
