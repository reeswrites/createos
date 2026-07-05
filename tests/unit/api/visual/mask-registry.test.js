// mask-registry.test.js — Mask procedural factories (ADR 054).
// Real HTMLCanvasElement + the global 2d-context stub from tests/unit/setup.js.

import { describe, it, expect } from 'vitest';
import { Mask } from '../../../../src/api/visual/mask-registry.js';

describe('Mask registry', () => {
  it('circle returns a canvas at the requested resolution', () => {
    const c = Mask.circle({ w: 256, h: 128 });
    expect(c).toBeInstanceOf(HTMLCanvasElement);
    expect(c.width).toBe(256);
    expect(c.height).toBe(128);
  });

  it('circle defaults to 512×512', () => {
    const c = Mask.circle();
    expect(c.width).toBe(512);
    expect(c.height).toBe(512);
  });

  it('feather returns a canvas (uses radial gradient)', () => {
    const c = Mask.feather({ softness: 0.5 });
    expect(c).toBeInstanceOf(HTMLCanvasElement);
  });

  it('the returned canvas carries an .update() that returns itself', () => {
    const c = Mask.circle();
    expect(typeof c.update).toBe('function');
    expect(c.update({ x: 0.7 })).toBe(c);
  });

  it('register exposes a custom factory as Mask.<name> and via has()', () => {
    const factory = () => document.createElement('canvas');
    Mask.register('customTest', factory);
    expect(Mask.customTest).toBe(factory);
    expect(Mask.has('customTest')).toBe(true);
    expect(Mask.has('nope')).toBe(false);
  });

  it('register returns Mask for chaining', () => {
    expect(Mask.register('chainTest', () => document.createElement('canvas'))).toBe(Mask);
  });

  it('built-in circle/feather are registered', () => {
    expect(Mask.has('circle')).toBe(true);
    expect(Mask.has('feather')).toBe(true);
  });
});
