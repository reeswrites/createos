import { describe, it, expect } from 'vitest';
import {
  resolveDrawable,
  _isCanvas,
  _isVideo,
  _isImage,
} from '../../../../src/api/visual/drawable-source.js';

// ADR 006 — the single Drawable Source resolver. This table is the coverage
// surface that previously lived (and drifted) across four copies.

describe('resolveDrawable', () => {
  const canvas = document.createElement('canvas');
  const video = document.createElement('video');
  const image = document.createElement('img');

  it.each([
    ['null', null, null],
    ['undefined', undefined, null],
    ['Layer / ShaderFX (_canvas)', { _canvas: canvas }, canvas],
    ['CameraStream (.element)', { element: video }, video],
    ['bare <video>', video, video],
    ['bare <canvas>', canvas, canvas],
    ['bare <img>', image, image],
    ['GLShader/Shader instance', { canvas }, canvas],
    ['unknown object', { foo: 1 }, null],
  ])('resolves %s', (_label, input, expected) => {
    expect(resolveDrawable(input)).toBe(expected);
  });

  it('prefers _canvas over a sibling .element (Layer wins)', () => {
    expect(resolveDrawable({ _canvas: canvas, element: video })).toBe(canvas);
  });

  it('resolves a shader instance via .canvas — the branch the old copies dropped', () => {
    // Two of the four pre-ADR-006 copies returned the instance itself here,
    // which is not a valid texture source. Regression guard.
    const fakeShader = { canvas, start() {}, set() {} };
    expect(resolveDrawable(fakeShader)).toBe(canvas);
  });
});

describe('duck-type helpers', () => {
  it('_isCanvas / _isVideo / _isImage discriminate real elements', () => {
    expect(_isCanvas(document.createElement('canvas'))).toBe(true);
    expect(_isVideo(document.createElement('video'))).toBe(true);
    expect(_isImage(document.createElement('img'))).toBe(true);
    expect(_isImage(document.createElement('video'))).toBe(false);
    expect(_isCanvas(null)).toBe(false);
  });
});
