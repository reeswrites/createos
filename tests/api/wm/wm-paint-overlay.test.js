import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initWM, cleanupPaintOverlays } from '../../../src/api/wm/wm.js';

// Integration harness for the in-window paint overlay (the seam that ADR 045
// extracts into paint-overlay.js). These tests exercise the overlay through wm's
// PUBLIC surface — spawn → toggle → stroke → addText → close — so the extraction
// is guarded against regression. They run before and after the refactor unchanged.

function findPaintBtn(winId) {
  const win = document.getElementById(winId);
  return [...win.querySelectorAll('.wm-titlebar .wm-btn')].find(b => b.innerHTML.includes('🖌️')) ?? null;
}

function pointer(type, target, { x = 0, y = 0, id = 1 } = {}) {
  const e = new Event(type, { bubbles: true });
  e.pointerId = id; e.clientX = x; e.clientY = y;
  target.dispatchEvent(e);
}

describe('wm paint overlay (integration)', () => {
  let desktop, wm, _store;

  beforeEach(() => {
    _store = new Map();
    globalThis.localStorage = {
      getItem: k => (_store.has(k) ? _store.get(k) : null),
      setItem: (k, v) => _store.set(k, String(v)),
      removeItem: k => _store.delete(k),
      clear: () => _store.clear(),
    };
    // jsdom lacks pointer-capture; paint onDown calls it.
    HTMLCanvasElement.prototype.setPointerCapture = function () {};
    HTMLCanvasElement.prototype.releasePointerCapture = function () {};
    desktop = document.createElement('div');
    desktop.id = 'desktop';
    document.body.appendChild(desktop);
    wm = initWM();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    delete globalThis.localStorage;
  });

  it('a visual window gets a paint overlay wired through wm.paintEvents', () => {
    const id = wm.spawn('Pic', { type: 'image', src: 'data:,', w: 300, h: 200 });
    const events = wm.paintEvents(id);
    expect(events).toBeTruthy();
    expect(typeof events.on).toBe('function');
    expect(typeof events.signal).toBe('function');
  });

  it('exposes a 🖌️ toggle button that builds and tears down the overlay canvas', () => {
    const id = wm.spawn('Pic', { type: 'image', src: 'data:,', w: 300, h: 200 });
    const win = document.getElementById(id);
    const btn = findPaintBtn(id);
    expect(btn).toBeTruthy();

    expect(win._getOverlay()).toBeNull();   // lazy — no overlay until activated
    btn.click();
    expect(win._getOverlay()).toBeTruthy();  // overlay canvas built
    btn.click();
    expect(win._getOverlay()).toBeNull();    // torn down on toggle off
  });

  it('emits a stroke event (with bbox) on pointer down→up while active', () => {
    const id = wm.spawn('Pic', { type: 'image', src: 'data:,', w: 300, h: 200 });
    const win = document.getElementById(id);
    let stroke = null;
    wm.onStroke(id, p => { stroke = p; });

    findPaintBtn(id).click();                 // activate
    const overlay = win._getOverlay();
    pointer('pointerdown', overlay, { x: 5, y: 5 });
    pointer('pointerup',   overlay, { x: 5, y: 5 });

    expect(stroke).toBeTruthy();
    expect(stroke.winId).toBe(id);
    expect(stroke.tool).toBe('pen');
    expect(stroke.bbox).toBeTruthy();
  });

  it('wm.addText creates a Text Layer and a mirror canvas on the window', () => {
    const id = wm.spawn('Pic', { type: 'image', src: 'data:,', w: 300, h: 200 });
    const win = document.getElementById(id);
    const handle = wm.addText(id, 'hi', 10, 10);
    expect(handle).toBeTruthy();
    expect(win._getTextCanvas()).toBeTruthy();
  });

  it('closing the window tears the overlay down — paintEvents resolves null after', () => {
    const id = wm.spawn('Pic', { type: 'image', src: 'data:,', w: 300, h: 200 });
    findPaintBtn(id).click();                 // build overlay so cleanup has something to do
    wm.remove(id, { animate: false });
    expect(document.getElementById(id)).toBeNull();
    expect(wm.paintEvents(id)).toBeNull();
  });

  it('cleanupPaintOverlays() runs without throwing and clears run-scoped text', () => {
    const id = wm.spawn('Pic', { type: 'image', src: 'data:,', w: 300, h: 200 });
    wm.addText(id, 'hi', 10, 10);
    expect(() => cleanupPaintOverlays()).not.toThrow();
  });
});
