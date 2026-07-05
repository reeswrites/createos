import { describe, it, expect } from 'vitest';
import {
  registerDesktopFileType,
  getDesktopFileType,
  isDesktopFileType,
  desktopFileGlyphs,
  desktopFileCssClass,
} from '../../../../src/api/platform/desktop-file-registry.js';

// The Desktop File-Type Adapter registry (ADR 055) — the seam desktop-files.js
// derives its glyph / icon CSS class / open-dispatch / restore branch from.

describe('desktop-file-registry', () => {
  it('registers and retrieves an adapter record', () => {
    const open = () => {};
    registerDesktopFileType('widget-x', { glyph: 'fa-x', cssClass: 'dt-x-icon', open });
    const rec = getDesktopFileType('widget-x');
    expect(rec).toBeTruthy();
    expect(rec.glyph).toBe('fa-x');
    expect(rec.cssClass).toBe('dt-x-icon');
    expect(rec.open).toBe(open);
  });

  it('isDesktopFileType reflects registration', () => {
    registerDesktopFileType('widget-y', { glyph: 'fa-y', cssClass: 'dt-y-icon', open() {} });
    expect(isDesktopFileType('widget-y')).toBe(true);
    // Base (non-widget) icon types are NOT registered — desktop-files handles them inline.
    expect(isDesktopFileType('editor')).toBe(false);
    expect(isDesktopFileType('folder')).toBe(false);
    expect(isDesktopFileType('image')).toBe(false);
    expect(isDesktopFileType('nope')).toBe(false);
  });

  it('desktopFileGlyphs collects every registered glyph as a map', () => {
    registerDesktopFileType('widget-z', { glyph: 'fa-z', cssClass: 'dt-z-icon', open() {} });
    const glyphs = desktopFileGlyphs();
    expect(glyphs['widget-z']).toBe('fa-z');
  });

  it('desktopFileCssClass returns the class, or empty for unknown types', () => {
    registerDesktopFileType('widget-w', { glyph: 'fa-w', cssClass: 'dt-w-icon', open() {} });
    expect(desktopFileCssClass('widget-w')).toBe('dt-w-icon');
    expect(desktopFileCssClass('unknown')).toBe('');
  });

  it('later registration of the same type wins (last-write)', () => {
    registerDesktopFileType('dupe', { glyph: 'fa-old', cssClass: 'dt-old', open() {} });
    registerDesktopFileType('dupe', { glyph: 'fa-new', cssClass: 'dt-new', open() {} });
    expect(getDesktopFileType('dupe').glyph).toBe('fa-new');
    expect(desktopFileCssClass('dupe')).toBe('dt-new');
  });
});
