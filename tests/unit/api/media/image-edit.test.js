import { describe, test, expect, vi } from 'vitest';
import { EditableImage, editImage } from '../../../../src/api/media/image-edit.js';

function makeCanvas(w = 100, h = 100) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// ── factory ───────────────────────────────────────────────────────────────────

describe('editImage()', () => {
  test('returns an EditableImage', () => {
    expect(editImage(makeCanvas())).toBeInstanceOf(EditableImage);
  });
});

// ── chaining ──────────────────────────────────────────────────────────────────

describe('EditableImage chaining', () => {
  test('all op methods return this', () => {
    const img = editImage(makeCanvas());
    expect(img.crop(0, 0, 50, 50)).toBe(img);
    expect(img.rotate(45)).toBe(img);
    expect(img.filter('blur(2px)')).toBe(img);
    expect(img.flipH()).toBe(img);
    expect(img.flipV()).toBe(img);
    expect(img.blend(makeCanvas())).toBe(img);
    expect(img.reset()).toBe(img);
  });
});

// ── toCanvas ──────────────────────────────────────────────────────────────────

describe('EditableImage.toCanvas()', () => {
  test('returns HTMLCanvasElement', () => {
    expect(editImage(makeCanvas()).toCanvas()).toBeInstanceOf(HTMLCanvasElement);
  });

  test('caches result on repeated calls', () => {
    const img = editImage(makeCanvas());
    expect(img.toCanvas()).toBe(img.toCanvas());
  });

  test('invalidates cache after adding an op', () => {
    const img = editImage(makeCanvas());
    const a = img.toCanvas();
    img.flipH();
    expect(img.toCanvas()).not.toBe(a);
  });
});

// ── crop ──────────────────────────────────────────────────────────────────────

describe('EditableImage.crop()', () => {
  test('output has correct cropped dimensions', () => {
    const c = editImage(makeCanvas(200, 150)).crop(10, 10, 80, 60).toCanvas();
    expect(c.width).toBe(80);
    expect(c.height).toBe(60);
  });
});

// ── rotate ────────────────────────────────────────────────────────────────────

describe('EditableImage.rotate()', () => {
  test('rotate(90) approximately swaps dimensions', () => {
    const c = editImage(makeCanvas(100, 50)).rotate(90).toCanvas();
    expect(c.width).toBeCloseTo(50, 0);
    expect(c.height).toBeCloseTo(100, 0);
  });
  test('rotate(0) keeps same dimensions', () => {
    const c = editImage(makeCanvas(100, 50)).rotate(0).toCanvas();
    expect(c.width).toBe(100);
    expect(c.height).toBe(50);
  });
  test('rotate(180) keeps same dimensions', () => {
    const c = editImage(makeCanvas(100, 50)).rotate(180).toCanvas();
    expect(c.width).toBe(100);
    expect(c.height).toBe(50);
  });
});

// ── filter ────────────────────────────────────────────────────────────────────

describe('EditableImage.filter()', () => {
  test('keeps same dimensions', () => {
    const c = editImage(makeCanvas(100, 60)).filter('blur(4px)').toCanvas();
    expect(c.width).toBe(100);
    expect(c.height).toBe(60);
  });
});

// ── flipH / flipV ─────────────────────────────────────────────────────────────

describe('EditableImage.flipH()', () => {
  test('keeps same dimensions', () => {
    const c = editImage(makeCanvas(100, 50)).flipH().toCanvas();
    expect(c.width).toBe(100);
    expect(c.height).toBe(50);
  });
});

describe('EditableImage.flipV()', () => {
  test('keeps same dimensions', () => {
    const c = editImage(makeCanvas(100, 50)).flipV().toCanvas();
    expect(c.width).toBe(100);
    expect(c.height).toBe(50);
  });
});

// ── blend ─────────────────────────────────────────────────────────────────────

describe('EditableImage.blend()', () => {
  test('keeps same dimensions', () => {
    const c = editImage(makeCanvas(100, 50)).blend(makeCanvas(100, 50), 'screen').toCanvas();
    expect(c.width).toBe(100);
    expect(c.height).toBe(50);
  });
  test('accepts another EditableImage as other', () => {
    const other = editImage(makeCanvas(100, 50)).flipH();
    const c = editImage(makeCanvas(100, 50)).blend(other, 'multiply').toCanvas();
    expect(c.width).toBe(100);
    expect(c.height).toBe(50);
  });
});

// ── reset ─────────────────────────────────────────────────────────────────────

describe('EditableImage.reset()', () => {
  test('clears ops — toCanvas() returns source dimensions', () => {
    const img = editImage(makeCanvas(100, 50));
    img.crop(0, 0, 40, 30);
    img.toCanvas(); // build + cache
    img.reset();
    const c = img.toCanvas();
    expect(c.width).toBe(100);
    expect(c.height).toBe(50);
  });
});

// ── op pipeline ───────────────────────────────────────────────────────────────

describe('EditableImage op pipeline', () => {
  test('chained ops apply in order', () => {
    // crop then flipH — both should apply without throwing
    const c = editImage(makeCanvas(200, 200))
      .crop(0, 0, 100, 80)
      .flipH()
      .toCanvas();
    expect(c.width).toBe(100);
    expect(c.height).toBe(80);
  });
});

// ── width / height getters ────────────────────────────────────────────────────

describe('EditableImage.width / height', () => {
  test('match source dimensions before any ops', () => {
    const img = editImage(makeCanvas(80, 60));
    expect(img.width).toBe(80);
    expect(img.height).toBe(60);
  });
  test('reflect cropped dimensions after crop()', () => {
    const img = editImage(makeCanvas(200, 150)).crop(0, 0, 50, 30);
    expect(img.width).toBe(50);
    expect(img.height).toBe(30);
  });
});

// ── draw() ────────────────────────────────────────────────────────────────────

describe('EditableImage.draw()', () => {
  test('calls target.image with canvas and position', () => {
    const img = editImage(makeCanvas(50, 50));
    const target = { image: vi.fn().mockReturnThis() };
    img.draw(target, 10, 20);
    expect(target.image).toHaveBeenCalled();
    const [canvas, x, y] = target.image.mock.calls[0];
    expect(canvas).toBeInstanceOf(HTMLCanvasElement);
    expect(x).toBe(10);
    expect(y).toBe(20);
  });
  test('returns this', () => {
    const img = editImage(makeCanvas());
    const target = { image: vi.fn().mockReturnThis() };
    expect(img.draw(target)).toBe(img);
  });
});
