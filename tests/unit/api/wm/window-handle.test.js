import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initWM } from '../../../../src/api/wm/wm.js';

// The Window handle (wm.window(id)) replaces the win._wmCleanup expando bag.
// These tests exercise it through wm's public surface: spawn → window(id) →
// onDispose accumulator (LIFO) → serialize via the registered adapter → close.

describe('wm window handle', () => {
  let wm, _store;

  beforeEach(() => {
    _store = new Map();
    globalThis.localStorage = {
      getItem: (k) => (_store.has(k) ? _store.get(k) : null),
      setItem: (k, v) => _store.set(k, String(v)),
      removeItem: (k) => _store.delete(k),
      clear: () => _store.clear(),
    };
    const desktop = document.createElement('div');
    desktop.id = 'desktop';
    document.body.appendChild(desktop);
    wm = initWM();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    delete globalThis.localStorage;
  });

  it('window(id) returns a handle whose id matches and type resolves', () => {
    const id = wm.spawn('Hi', { type: 'html', html: '<p>hi</p>', audio: false });
    const h = wm.window(id);
    expect(h).toBeTruthy();
    expect(h.id).toBe(id);
    expect(h.type).toBe('html');
  });

  it('window(id) is null for an unknown id', () => {
    expect(wm.window('win-does-not-exist')).toBeNull();
  });

  it('onDispose fires every listener LIFO on close (no clobber)', () => {
    const id = wm.spawn('Hi', { type: 'html', html: '', audio: false });
    const order = [];
    const h = wm.window(id);
    h.onDispose(() => order.push('first'));
    h.onDispose(() => order.push('second'));
    // Two registrations both survive — the old _wmCleanup clobber would drop one.
    wm.close(id);
    expect(order).toEqual(['second', 'first']);
  });

  it('serialize() dispatches to the registered Window Type Adapter', () => {
    const id = wm.spawn('Note', {
      type: 'html',
      html: '<b>x</b>',
      x: 10,
      y: 20,
      w: 333,
      h: 222,
      audio: false,
    });
    const rec = wm.window(id).serialize();
    expect(rec).toMatchObject({ type: 'html', title: 'Note', html: '<b>x</b>', w: 333, h: 222 });
  });

  it('dispose() closes the window', () => {
    const id = wm.spawn('Hi', { type: 'html', html: '', audio: false });
    expect(document.getElementById(id)).toBeTruthy();
    wm.window(id).dispose();
    expect(document.getElementById(id)).toBeNull();
  });
});
