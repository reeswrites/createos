import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initWM } from '../../../../src/api/wm/wm.js';

// Regression: auto-generated window ids (`win-spawn-N`) must never collide with
// windows already in the DOM. spawnCounter resets to 0 on page reload, but windows
// restored from a saved project keep ids like `win-spawn-11`. A collision produced
// duplicate ids, so getElementById returned the wrong element and wm.addText /
// wm.bounds silently failed against a stale/dead window.
describe('wm.spawn id collision avoidance', () => {
  let desktop, wm;

  let _store;
  beforeEach(() => {
    _store = new Map();
    globalThis.localStorage = {
      getItem: k => (_store.has(k) ? _store.get(k) : null),
      setItem: (k, v) => _store.set(k, String(v)),
      removeItem: k => _store.delete(k),
      clear: () => _store.clear(),
    };
    desktop = document.createElement('div');
    desktop.id = 'desktop';
    document.body.appendChild(desktop);
    wm = initWM();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    delete globalThis.localStorage;
  });

  it('skips ids already present in the DOM (e.g. restored windows)', () => {
    // Simulate a restored window with an explicit id that collides with the counter range.
    wm.spawn('Restored', { id: 'win-spawn-1', w: 400, h: 300 });

    // Fresh auto-spawns must not reuse win-spawn-1.
    const a = wm.spawn('A', { w: 400, h: 300 });
    const b = wm.spawn('B', { w: 400, h: 300 });

    expect(a).not.toBe('win-spawn-1');
    expect(b).not.toBe('win-spawn-1');
    expect(a).not.toBe(b);

    const allIds = [...document.querySelectorAll('.wm-win')].map(w => w.id);
    const dupes = allIds.filter((v, i, arr) => arr.indexOf(v) !== i);
    expect(dupes).toEqual([]);

    // getElementById resolves the freshly-spawned window (not a stale duplicate).
    expect(document.getElementById(a)).toBeTruthy();
    expect(document.getElementById(b)).toBeTruthy();
  });

  it('wm.bounds returns the spawned window body size, not null', () => {
    const id = wm.spawn('Sized', { w: 500, h: 400 });
    const b = wm.bounds(id);
    expect(b).not.toBeNull();
    expect(b).toHaveProperty('w');
    expect(b).toHaveProperty('h');
  });

  it('wm.bounds returns null for an unknown window id', () => {
    expect(wm.bounds('win-does-not-exist')).toBeNull();
  });

  it('wm.remove tears down a spawned window and removes it from the DOM', () => {
    const id = wm.spawn('Doomed', { w: 400, h: 300 });
    expect(document.getElementById(id)).toBeTruthy();
    wm.remove(id, { animate: false });   // animate:false → synchronous removal (reset path)
    expect(document.getElementById(id)).toBeNull();
  });

  it('wm.remove is a no-op for an unknown id', () => {
    expect(() => wm.remove('win-nope', { animate: false })).not.toThrow();
  });

  it('transient windows (pipe/route run artifacts) are not serialized to localStorage', async () => {
    const persistent = wm.spawn('Keep', { type: 'html', html: 'hi', w: 300, h: 200 });
    const transient  = wm.spawn('Karaoke', { transient: true, html: '', w: 800, h: 450 });

    // wm.move triggers the debounced _saveState → _flushState.
    wm.move(transient, 10, 10);
    await new Promise(r => setTimeout(r, 600));

    const saved = JSON.parse(localStorage.getItem('vl-wm-state') || '{"wins":[]}');
    const ids = saved.wins.map(w => w.id);
    expect(ids).toContain(persistent);     // normal spawned window persists
    expect(ids).not.toContain(transient);  // transient run-artifact does not
  });
});
