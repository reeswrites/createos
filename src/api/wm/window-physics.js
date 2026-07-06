// Window Physics (#42) — an optional spring/AABB bounce simulation over the WM's
// windows. Extracted from initWM: it is a genuine bolt-on — it touches only the
// `api` object it is installed on and the live `#desktop` DOM, never initWM's
// closure state (savedGeometry/spawnedIds/zTop/…), so it couples to the WM by
// nothing but co-location. installWindowPhysics(api) adds the public verbs
// (physics/push/gravity) + the RAF tick onto the wm api object.

export function installWindowPhysics(api) {
  // Internal state
  api._physState = new Map(); // id → { vx, vy, mass, elasticity }
  api._physActive = false;
  api._physRafId = null;
  api._physGravity = 0;

  // Enable/disable window physics
  api.physics = function (on = true, opts = {}) {
    const { gravity = 0 } = opts;
    api._physGravity = gravity;
    if (on && !api._physActive) {
      api._physActive = true;
      const loop = () => {
        if (!api._physActive) return;
        api._physTick();
        api._physRafId = requestAnimationFrame(loop);
      };
      api._physRafId = requestAnimationFrame(loop);
    } else if (!on && api._physActive) {
      api._physActive = false;
      if (api._physRafId) {
        cancelAnimationFrame(api._physRafId);
        api._physRafId = null;
      }
    }
    return api;
  };

  // Apply impulse to a window
  api.push = function (id, vx = 0, vy = 0) {
    if (!api._physState.has(id)) {
      api._physState.set(id, { vx: 0, vy: 0, mass: 1, elasticity: 0.6 });
    }
    const s = api._physState.get(id);
    s.vx += vx;
    s.vy += vy;
    return api;
  };

  // Set gravity (pixels/frame²)
  api.gravity = function (g = 0.3) {
    api._physGravity = g;
    return api;
  };

  // Physics tick — called each RAF
  api._physTick = function () {
    const desktop = document.getElementById('desktop');
    if (!desktop) return;
    const dW = desktop.offsetWidth;
    const dH = desktop.offsetHeight;

    const windows = document.querySelectorAll('#desktop .wm-win');
    windows.forEach((win) => {
      const id = win.id;
      if (!id) return;
      if (!api._physState.has(id)) {
        api._physState.set(id, { vx: 0, vy: 0, mass: 1, elasticity: 0.6 });
      }
      const s = api._physState.get(id);
      if (s.vx === 0 && s.vy === 0 && api._physGravity === 0) return;

      // Gravity
      s.vy += api._physGravity;

      // Damping
      s.vx *= 0.98;
      s.vy *= 0.98;

      // Integrate position
      let x = parseInt(win.style.left, 10) || 0;
      let y = parseInt(win.style.top, 10) || 0;
      const w = win.offsetWidth;
      const h = win.offsetHeight;

      x += s.vx;
      y += s.vy;

      // AABB bounce off desktop edges
      if (x < 0) {
        x = 0;
        s.vx = Math.abs(s.vx) * s.elasticity;
      }
      if (x + w > dW) {
        x = dW - w;
        s.vx = -Math.abs(s.vx) * s.elasticity;
      }
      if (y < 0) {
        y = 0;
        s.vy = Math.abs(s.vy) * s.elasticity;
      }
      if (y + h > dH) {
        y = dH - h;
        s.vy = -Math.abs(s.vy) * s.elasticity;
      }

      // Stop micro-motion
      if (Math.abs(s.vx) < 0.05) s.vx = 0;
      if (Math.abs(s.vy) < 0.05) s.vy = 0;

      win.style.left = `${x}px`;
      win.style.top = `${y}px`;
    });
  };
}
