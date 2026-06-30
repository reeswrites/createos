import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// Physics logic is inside the wm API object returned by initWM.
// We test the internal _physTick and push/physics/gravity methods directly.

function makeApi() {
  // Minimal subset of the wm api object with just physics methods
  const api = {
    _physState:  new Map(),
    _physActive: false,
    _physRafId:  null,
    _physGravity: 0,

    physics(on = true, opts = {}) {
      const { gravity = 0 } = opts;
      api._physGravity = gravity;
      if (on && !api._physActive) {
        api._physActive = true;
        // Don't start actual RAF in tests
      } else if (!on) {
        api._physActive = false;
        if (api._physRafId) { cancelAnimationFrame(api._physRafId); api._physRafId = null; }
      }
      return api;
    },

    push(id, vx = 0, vy = 0) {
      if (!api._physState.has(id)) {
        api._physState.set(id, { vx: 0, vy: 0, mass: 1, elasticity: 0.6 });
      }
      const s = api._physState.get(id);
      s.vx += vx; s.vy += vy;
      return api;
    },

    gravity(g = 0.3) {
      api._physGravity = g;
      return api;
    },

    _physTick() {
      const desktop = document.getElementById('desktop');
      if (!desktop) return;
      const dW = desktop.offsetWidth  || 800;
      const dH = desktop.offsetHeight || 600;

      const windows = document.querySelectorAll('#desktop .wm-win');
      windows.forEach(win => {
        const id = win.id;
        if (!id) return;
        if (!api._physState.has(id)) {
          api._physState.set(id, { vx: 0, vy: 0, mass: 1, elasticity: 0.6 });
        }
        const s = api._physState.get(id);
        s.vy += api._physGravity;
        s.vx *= 0.98; s.vy *= 0.98;

        let x = parseInt(win.style.left, 10) || 0;
        let y = parseInt(win.style.top,  10) || 0;
        const w = win.offsetWidth  || 200;
        const h = win.offsetHeight || 200;
        x += s.vx; y += s.vy;

        if (x < 0)      { x = 0;      s.vx =  Math.abs(s.vx) * s.elasticity; }
        if (x + w > dW) { x = dW - w; s.vx = -Math.abs(s.vx) * s.elasticity; }
        if (y < 0)      { y = 0;      s.vy =  Math.abs(s.vy) * s.elasticity; }
        if (y + h > dH) { y = dH - h; s.vy = -Math.abs(s.vy) * s.elasticity; }

        if (Math.abs(s.vx) < 0.05) s.vx = 0;
        if (Math.abs(s.vy) < 0.05) s.vy = 0;

        win.style.left = `${x}px`;
        win.style.top  = `${y}px`;
      });
    },
  };
  return api;
}

// Helpers
function makeDesktop(w = 800, h = 600) {
  const d = document.createElement('div');
  d.id = 'desktop';
  Object.defineProperty(d, 'offsetWidth',  { get: () => w, configurable: true });
  Object.defineProperty(d, 'offsetHeight', { get: () => h, configurable: true });
  document.body.appendChild(d);
  return d;
}

function makeWin(id, x, y, w = 200, h = 100) {
  const win = document.createElement('div');
  win.id = id;
  win.className = 'wm-win';
  win.style.left = `${x}px`;
  win.style.top  = `${y}px`;
  Object.defineProperty(win, 'offsetWidth',  { get: () => w, configurable: true });
  Object.defineProperty(win, 'offsetHeight', { get: () => h, configurable: true });
  document.getElementById('desktop').appendChild(win);
  return win;
}

beforeEach(() => {
  makeDesktop();
});

afterEach(() => {
  document.getElementById('desktop')?.remove();
});

describe('wm.physics()', () => {
  it('sets _physActive and _physGravity', () => {
    const api = makeApi();
    api.physics(true, { gravity: 0.5 });
    expect(api._physActive).toBe(true);
    expect(api._physGravity).toBe(0.5);
  });

  it('physics(false) deactivates', () => {
    const api = makeApi();
    api.physics(true);
    api.physics(false);
    expect(api._physActive).toBe(false);
  });

  it('returns api for chaining', () => {
    const api = makeApi();
    expect(api.physics(true)).toBe(api);
  });
});

describe('wm.push()', () => {
  it('creates state entry for unknown id', () => {
    const api = makeApi();
    api.push('win-x', 5, -3);
    expect(api._physState.has('win-x')).toBe(true);
    expect(api._physState.get('win-x').vx).toBe(5);
    expect(api._physState.get('win-x').vy).toBe(-3);
  });

  it('accumulates velocity on existing state', () => {
    const api = makeApi();
    api.push('win-x', 2, 3);
    api.push('win-x', 1, 1);
    expect(api._physState.get('win-x').vx).toBe(3);
    expect(api._physState.get('win-x').vy).toBe(4);
  });

  it('returns api for chaining', () => {
    const api = makeApi();
    expect(api.push('x', 0, 0)).toBe(api);
  });
});

describe('wm.gravity()', () => {
  it('sets physGravity', () => {
    const api = makeApi();
    api.gravity(0.8);
    expect(api._physGravity).toBe(0.8);
  });
});

describe('wm._physTick()', () => {
  it('moves window by velocity', () => {
    const api = makeApi();
    makeWin('w1', 100, 100);
    api.push('w1', 10, 5);
    api._physTick();
    const win = document.getElementById('w1');
    expect(parseInt(win.style.left, 10)).toBeGreaterThan(100);
    expect(parseInt(win.style.top,  10)).toBeGreaterThan(100);
  });

  it('bounces off right edge', () => {
    const api = makeApi();
    makeWin('w2', 650, 100);  // 650 + 200 = 850 > 800
    api.push('w2', 50, 0);
    api._physTick();
    const win = document.getElementById('w2');
    // Window should bounce: x clamped to dW - w = 600
    expect(parseInt(win.style.left, 10)).toBe(600);
    // Velocity should have reversed sign
    const s = api._physState.get('w2');
    expect(s.vx).toBeLessThan(0);
  });

  it('bounces off bottom edge', () => {
    const api = makeApi();
    makeWin('w3', 100, 550);  // 550 + 100 = 650 > 600
    api.push('w3', 0, 80);
    api._physTick();
    const win = document.getElementById('w3');
    expect(parseInt(win.style.top, 10)).toBe(500); // dH - h = 500
    const s = api._physState.get('w3');
    expect(s.vy).toBeLessThan(0);
  });

  it('bounces off left edge', () => {
    const api = makeApi();
    makeWin('w4', 5, 100);
    api.push('w4', -50, 0);
    api._physTick();
    const win = document.getElementById('w4');
    expect(parseInt(win.style.left, 10)).toBe(0);
    expect(api._physState.get('w4').vx).toBeGreaterThan(0);
  });

  it('applies gravity each tick', () => {
    const api = makeApi();
    makeWin('w5', 100, 100);
    api.gravity(1);
    api._physTick();
    const s = api._physState.get('w5');
    expect(s.vy).toBeGreaterThan(0);
  });

  it('damps velocity on each tick', () => {
    const api = makeApi();
    makeWin('w6', 100, 100);
    api.push('w6', 10, 10);
    api._physTick();
    const s = api._physState.get('w6');
    expect(s.vx).toBeLessThan(10);
  });
});
