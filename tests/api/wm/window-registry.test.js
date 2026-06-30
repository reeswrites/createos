import { describe, it, expect } from 'vitest';
import {
  registerWindowType,
  getWindowAdapter,
  windowTypes,
  geoOf,
  titleOf,
  readAudio,
  applyGeo,
} from '../../../src/api/wm/window-registry.js';

// The Window Type Adapter registry is a DOM-pure leaf — no wm import, no desktop.
// This is the seam project.js iterates instead of switching on opts.type twice.

describe('window-registry', () => {
  it('registers and resolves an adapter by type', () => {
    const adapter = { serialize: () => ({}), restore: () => {} };
    registerWindowType('test-type', adapter);
    expect(getWindowAdapter('test-type')).toBe(adapter);
    expect(windowTypes()).toContain('test-type');
  });

  it('getWindowAdapter is undefined for an unknown type', () => {
    expect(getWindowAdapter('no-such-type')).toBeUndefined();
  });

  function mkWin() {
    const win = document.createElement('div');
    win.style.cssText = 'left:40px;top:50px;width:300px;height:200px;display:flex;';
    const title = document.createElement('div');
    title.className = 'wm-title';
    title.textContent = '  My Window  ';
    win.appendChild(title);
    return win;
  }

  it('geoOf reads position/size and flags from the element', () => {
    const win = mkWin();
    win.classList.add('wm-no-chrome');
    expect(geoOf(win)).toMatchObject({
      x: 40,
      y: 50,
      w: 300,
      h: 200,
      visible: true,
      nochrome: true,
      transparent: false,
    });
  });

  it('titleOf trims the title, falling back when absent', () => {
    expect(titleOf(mkWin())).toBe('My Window');
    expect(titleOf(document.createElement('div'), 'Fallback')).toBe('Fallback');
  });

  it('readAudio reports mute + normalized volume', () => {
    const win = mkWin();
    const mute = document.createElement('button');
    mute.className = 'wm-mute muted';
    const vol = document.createElement('input');
    vol.className = 'wm-vol';
    vol.value = '50';
    win.append(mute, vol);
    expect(readAudio(win)).toEqual({ muted: true, volume: 0.5 });
  });

  it('applyGeo round-trips geoOf', () => {
    const src = mkWin();
    src.classList.add('wm-transparent');
    const rec = geoOf(src);
    const dst = document.createElement('div');
    applyGeo(dst, rec);
    expect(geoOf(dst)).toMatchObject(rec);
    expect(dst.classList.contains('wm-transparent')).toBe(true);
  });
});
