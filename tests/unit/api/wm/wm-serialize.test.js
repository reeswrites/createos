import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initWM } from '../../../../src/api/wm/wm.js';

// Candidate 01 (6th arch pass): the two IN-SESSION serializers — undo (`_captureState`)
// and localStorage (`_flushState`) — now share `_serializeSpawnedType` for the type
// payload and `_respawnEntry` for rebuild. Before the unification, undo respawned a
// spawned window with a BARE geometry spawn (no html/widget/viz), losing its content.
describe('wm in-session serialize/restore', () => {
  let desktop, wm, _store;

  beforeEach(() => {
    _store = new Map();
    globalThis.localStorage = {
      getItem: (k) => (_store.has(k) ? _store.get(k) : null),
      setItem: (k, v) => _store.set(k, String(v)),
      removeItem: (k) => _store.delete(k),
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

  it('localStorage persist carries the html window content payload', async () => {
    const id = wm.spawn('Panel', { type: 'html', html: '<b>hi</b>', w: 300, h: 200 });
    wm.move(id, 5, 5); // triggers debounced _saveState → _flushState
    await new Promise((r) => setTimeout(r, 600));

    const saved = JSON.parse(localStorage.getItem('vl-wm-state'));
    const entry = saved.wins.find((w) => w.id === id);
    expect(entry).toBeTruthy();
    expect(entry.spawned).toBe(true);
    expect(entry.type).toBe('html');
    expect(entry.html).toBe('<b>hi</b>');
  });

  it('persist captures widget type + state (parity with the shared serializer)', async () => {
    const id = wm.spawn('W', { type: 'html', html: '', w: 300, h: 200 });
    const win = document.getElementById(id);
    win._widgetType = 'drumpad';
    win._widgetState = () => ({ pads: 4 });
    wm.move(id, 7, 7);
    await new Promise((r) => setTimeout(r, 600));

    const saved = JSON.parse(localStorage.getItem('vl-wm-state'));
    const entry = saved.wins.find((w) => w.id === id);
    expect(entry.widgetType).toBe('drumpad');
    expect(entry.widgetState).toEqual({ pads: 4 });
  });

  it('undo rebuilds a closed html window WITH its content (not a bare spawn)', async () => {
    const id = wm.spawn('Card', { type: 'html', html: '<span>keep-me</span>', w: 320, h: 200 });

    wm.pushHistory(); // snapshots current state (debounced ~500ms)
    await new Promise((r) => setTimeout(r, 600));

    wm.close(id);
    expect(document.getElementById(id)).toBeNull();

    wm.undo();

    const revived = document.getElementById(id) || [...desktop.querySelectorAll('.wm-win')].at(-1);
    expect(revived).toBeTruthy();
    expect(revived.innerHTML).toContain('keep-me');
  });
});
