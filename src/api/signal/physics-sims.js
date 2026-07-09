// physics-sims.js — the v1 physics-sim catalog (ADR 059).
//
// Six sims spanning the signal characters, each a registerPhysicsSource() call
// (register beside your own code). Continuous sims implement step(state, dt, emit)
// and are RK4/Euler integrated; the logistic map implements iterate(state, emit)
// (no continuous time). Imported for side effects by register-builtins.js.
//
//   pendulum  — double pendulum: multi-channel + unbounded ω + `flip` events + stereo
//   ball      — bouncing ball: pure discrete `bounce`{speed} character
//   kuramoto  — coupled oscillators: pre-normalized order param R + `sync` arc
//   harmonic  — damped oscillator: closed-form (the integrator unit-test fixture)
//   lorenz    — attractor: 3-channel x/y/z + `lobe` wing-swap
//   logistic  — iterated map: forces the iterated-vs-continuous tick split

import { registerPhysicsSource } from './physics.js';

const TAU = Math.PI * 2;
const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// Generic RK4 over an object of integrated fields; deriv closes over params.
function rk4(y, deriv, dt) {
  const axpy = (base, k, h) => {
    const o = {};
    for (const key in base) o[key] = base[key] + h * (k[key] ?? 0);
    return o;
  };
  const k1 = deriv(y);
  const k2 = deriv(axpy(y, k1, dt / 2));
  const k3 = deriv(axpy(y, k2, dt / 2));
  const k4 = deriv(axpy(y, k3, dt));
  const out = {};
  for (const key in y)
    out[key] = y[key] + (dt / 6) * (k1[key] + 2 * k2[key] + 2 * k3[key] + k4[key]);
  return out;
}

// Small capped trail buffer for renders that benefit (managed in render, on state).
function pushTrail(s, pt, cap = 240) {
  (s._trail ??= []).push(pt);
  if (s._trail.length > cap) s._trail.shift();
}

// ── Double pendulum ──────────────────────────────────────────────────────────────
registerPhysicsSource('pendulum', {
  init(o) {
    return {
      th1: o.th1 ?? Math.PI / 2,
      th2: o.th2 ?? Math.PI / 2 + (o.split ?? 0), // `split` seeds a divergent stereo twin
      w1: o.w1 ?? 0,
      w2: o.w2 ?? 0,
      m1: o.m1 ?? 1,
      m2: o.m2 ?? 1,
      l1: o.l1 ?? 1,
      l2: o.l2 ?? 1,
      g: o.g ?? 9.8,
      damp: o.damp ?? 0,
      _rev1: 0,
      _rev2: 0,
    };
  },
  step(s, dt, emit) {
    const deriv = (y) => {
      const { th1, th2, w1, w2 } = y;
      const { m1, m2, l1, l2, g } = s;
      const d = th1 - th2;
      const cd = Math.cos(d);
      const sd = Math.sin(d);
      const den1 = (m1 + m2) * l1 - m2 * l1 * cd * cd;
      const den2 = (l2 / l1) * den1;
      const a1 =
        (m2 * l1 * w1 * w1 * sd * cd +
          m2 * g * Math.sin(th2) * cd +
          m2 * l2 * w2 * w2 * sd -
          (m1 + m2) * g * Math.sin(th1)) /
        den1;
      const a2 =
        (-m2 * l2 * w2 * w2 * sd * cd +
          (m1 + m2) * (g * Math.sin(th1) * cd - l1 * w1 * w1 * sd - g * Math.sin(th2))) /
        den2;
      return { th1: w1, th2: w2, w1: a1, w2: a2 };
    };
    const next = rk4({ th1: s.th1, th2: s.th2, w1: s.w1, w2: s.w2 }, deriv, dt);
    s.th1 = next.th1;
    s.th2 = next.th2;
    s.w1 = next.w1;
    s.w2 = next.w2;
    if (s.damp) {
      s.w1 -= s.damp * s.w1 * dt;
      s.w2 -= s.damp * s.w2 * dt;
    }
    // flip = an arm passes over the top (crosses an odd multiple of π from vertical).
    const r1 = Math.floor((s.th1 + Math.PI) / TAU);
    const r2 = Math.floor((s.th2 + Math.PI) / TAU);
    if (r1 !== s._rev1) {
      emit('flip', { arm: 1, dir: Math.sign(r1 - s._rev1) });
      s._rev1 = r1;
    }
    if (r2 !== s._rev2) {
      emit('flip', { arm: 2, dir: Math.sign(r2 - s._rev2) });
      s._rev2 = r2;
    }
  },
  channels: {
    theta1: { get: (s) => wrapPi(s.th1), norm: [-Math.PI, Math.PI] },
    theta2: { get: (s) => wrapPi(s.th2), norm: [-Math.PI, Math.PI] },
    omega1: { get: (s) => s.w1, norm: [-10, 10] }, // unbounded — hint only
    omega2: { get: (s) => s.w2, norm: [-10, 10] },
    energy: {
      get: (s) => {
        const { m1, m2, l1, l2, g, w1, w2, th1, th2 } = s;
        const ke =
          0.5 * m1 * (l1 * w1) ** 2 +
          0.5 *
            m2 *
            ((l1 * w1) ** 2 + (l2 * w2) ** 2 + 2 * l1 * l2 * w1 * w2 * Math.cos(th1 - th2));
        const pe = -(m1 + m2) * g * l1 * Math.cos(th1) - m2 * g * l2 * Math.cos(th2);
        return ke + pe;
      },
      norm: [-50, 50],
    },
  },
  render(ctx, s, w, h) {
    ctx.fillStyle = '#0d0d12';
    ctx.fillRect(0, 0, w, h);
    const cx = w / 2;
    const cy = h * 0.38;
    const scale = (Math.min(w, h) * 0.2) / (s.l1 + s.l2);
    const x1 = cx + Math.sin(s.th1) * s.l1 * scale;
    const y1 = cy + Math.cos(s.th1) * s.l1 * scale;
    const x2 = x1 + Math.sin(s.th2) * s.l2 * scale;
    const y2 = y1 + Math.cos(s.th2) * s.l2 * scale;
    pushTrail(s, [x2, y2]);
    ctx.strokeStyle = 'rgba(79,209,255,0.25)';
    ctx.beginPath();
    s._trail.forEach(([tx, ty], i) => (i ? ctx.lineTo(tx, ty) : ctx.moveTo(tx, ty)));
    ctx.stroke();
    ctx.strokeStyle = '#cfd2dc';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.fillStyle = '#4fd1ff';
    for (const [px, py, r] of [
      [x1, y1, 5],
      [x2, y2, 6],
    ]) {
      ctx.beginPath();
      ctx.arc(px, py, r, 0, TAU);
      ctx.fill();
    }
  },
});

// ── Bouncing ball ────────────────────────────────────────────────────────────────
registerPhysicsSource('ball', {
  init(o) {
    const height = o.height ?? 1;
    return { y: height, vy: o.vy ?? 0, g: o.g ?? 9.8, e: o.e ?? 0.8, y0: height };
  },
  step(s, dt, emit) {
    s.vy -= s.g * dt;
    s.y += s.vy * dt;
    if (s.y <= 0 && s.vy < 0) {
      s.y = 0;
      s.vy = -s.vy * s.e;
      const speed = Math.abs(s.vy);
      emit('bounce', { speed });
      if (speed < 0.05) s.vy = 0; // settle — stop micro-bounces
    }
  },
  channels: {
    height: { get: (s) => s.y, norm: [0, 1] }, // hint; scales with initial height
    vy: { get: (s) => s.vy, norm: [-10, 10] },
  },
  render(ctx, s, w, h) {
    ctx.fillStyle = '#0d0d12';
    ctx.fillRect(0, 0, w, h);
    const pad = 20;
    const t = s.y0 ? Math.max(0, Math.min(1, s.y / s.y0)) : 0;
    const cy = h - pad - t * (h - 2 * pad);
    ctx.strokeStyle = '#3a3a4a';
    ctx.beginPath();
    ctx.moveTo(pad, h - pad);
    ctx.lineTo(w - pad, h - pad);
    ctx.stroke();
    ctx.fillStyle = '#4fd1ff';
    ctx.beginPath();
    ctx.arc(w / 2, cy, 10, 0, TAU);
    ctx.fill();
  },
});

// ── Kuramoto coupled oscillators ─────────────────────────────────────────────────
registerPhysicsSource('kuramoto', {
  init(o) {
    const n = o.n ?? 12;
    const spread = o.spread ?? 1;
    const phases = [];
    const omegas = [];
    for (let i = 0; i < n; i++) {
      phases.push(Math.random() * TAU);
      // symmetric spread of natural frequencies around 0
      omegas.push((i / (n - 1) - 0.5) * 2 * spread);
    }
    return { n, k: o.k ?? 1, phases, omegas, R: 0, psi: 0, _prevR: 0 };
  },
  step(s, dt, emit) {
    let re = 0;
    let im = 0;
    for (const p of s.phases) {
      re += Math.cos(p);
      im += Math.sin(p);
    }
    re /= s.n;
    im /= s.n;
    const R = Math.hypot(re, im);
    const psi = Math.atan2(im, re);
    for (let i = 0; i < s.n; i++) {
      s.phases[i] += (s.omegas[i] + s.k * R * Math.sin(psi - s.phases[i])) * dt;
    }
    s.R = R;
    s.psi = psi;
    if (s._prevR < 0.5 && R >= 0.5) emit('sync', { crossed: 'up', R });
    else if (s._prevR >= 0.5 && R < 0.5) emit('sync', { crossed: 'down', R });
    s._prevR = R;
  },
  channels: {
    R: { get: (s) => s.R, norm: [0, 1] }, // order parameter — already normalized
    psi: { get: (s) => s.psi, norm: [-Math.PI, Math.PI] },
  },
  render(ctx, s, w, h) {
    ctx.fillStyle = '#0d0d12';
    ctx.fillRect(0, 0, w, h);
    const cx = w / 2;
    const cy = h / 2;
    const r = Math.min(w, h) * 0.35;
    ctx.strokeStyle = '#2a2a38';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = '#4fd1ff';
    for (const p of s.phases) {
      ctx.beginPath();
      ctx.arc(cx + Math.cos(p) * r, cy + Math.sin(p) * r, 4, 0, TAU);
      ctx.fill();
    }
    // order-parameter vector
    ctx.strokeStyle = '#ff8a4f';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(s.psi) * r * s.R, cy + Math.sin(s.psi) * r * s.R);
    ctx.stroke();
    ctx.fillStyle = '#cfd2dc';
    ctx.font = '12px monospace';
    ctx.fillText(`R=${s.R.toFixed(2)}  K=${s.k.toFixed(2)}`, 8, 14);
  },
});

// ── Damped harmonic oscillator (closed-form test fixture) ────────────────────────
registerPhysicsSource('harmonic', {
  init(o) {
    return {
      x: o.x ?? 1,
      v: o.v ?? 0,
      omega: o.omega ?? TAU, // 1 Hz natural
      zeta: o.zeta ?? 0.05,
      _prevX: o.x ?? 1,
    };
  },
  step(s, dt, emit) {
    const deriv = (y) => ({ x: y.v, v: -s.omega * s.omega * y.x - 2 * s.zeta * s.omega * y.v });
    const next = rk4({ x: s.x, v: s.v }, deriv, dt);
    if (s._prevX >= 0 && next.x < 0) emit('zero', { dir: -1 });
    else if (s._prevX < 0 && next.x >= 0) emit('zero', { dir: 1 });
    s._prevX = next.x;
    s.x = next.x;
    s.v = next.v;
  },
  channels: {
    x: { get: (s) => s.x, norm: [-1, 1] }, // hint; amplitude depends on IC
    v: { get: (s) => s.v, norm: [-8, 8] },
  },
  render(ctx, s, w, h) {
    ctx.fillStyle = '#0d0d12';
    ctx.fillRect(0, 0, w, h);
    pushTrail(s, s.x, w);
    ctx.strokeStyle = '#3a3a4a';
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();
    ctx.strokeStyle = '#4fd1ff';
    ctx.beginPath();
    s._trail.forEach((x, i) => {
      const px = (i / w) * w;
      const py = h / 2 - x * (h * 0.4);
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    });
    ctx.stroke();
  },
});

// ── Lorenz attractor ─────────────────────────────────────────────────────────────
registerPhysicsSource('lorenz', {
  init(o) {
    return {
      x: o.x ?? 0.1,
      y: o.y ?? 0,
      z: o.z ?? 0,
      sigma: o.sigma ?? 10,
      rho: o.rho ?? 28,
      beta: o.beta ?? 8 / 3,
      _prevX: o.x ?? 0.1,
    };
  },
  step(s, dt, emit) {
    const deriv = (p) => ({
      x: s.sigma * (p.y - p.x),
      y: p.x * (s.rho - p.z) - p.y,
      z: p.x * p.y - s.beta * p.z,
    });
    const next = rk4({ x: s.x, y: s.y, z: s.z }, deriv, dt);
    if (Math.sign(next.x) !== Math.sign(s._prevX) && s._prevX !== 0)
      emit('lobe', { side: Math.sign(next.x) });
    s._prevX = next.x;
    s.x = next.x;
    s.y = next.y;
    s.z = next.z;
  },
  channels: {
    x: { get: (s) => s.x, norm: [-20, 20] },
    y: { get: (s) => s.y, norm: [-30, 30] },
    z: { get: (s) => s.z, norm: [0, 50] },
  },
  render(ctx, s, w, h) {
    ctx.fillStyle = '#0d0d12';
    ctx.fillRect(0, 0, w, h);
    pushTrail(s, [s.x, s.z], 600);
    ctx.strokeStyle = '#4fd1ff';
    ctx.lineWidth = 1;
    ctx.beginPath();
    s._trail.forEach(([x, z], i) => {
      const px = w / 2 + x * (w * 0.02);
      const py = h - z * (h * 0.017);
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    });
    ctx.stroke();
  },
});

// ── Logistic map (iterated — no continuous time) ─────────────────────────────────
registerPhysicsSource('logistic', {
  rate: 4, // iterations/sec (visible/audible step cadence)
  init(o) {
    return { x: o.x ?? 0.5, r: o.r ?? 3.7 };
  },
  iterate(s, emit) {
    s.x = s.r * s.x * (1 - s.x);
    emit('step', { x: s.x });
  },
  channels: {
    x: { get: (s) => s.x, norm: [0, 1] },
  },
  render(ctx, s, w, h) {
    ctx.fillStyle = '#0d0d12';
    ctx.fillRect(0, 0, w, h);
    pushTrail(s, s.x, w);
    ctx.fillStyle = '#4fd1ff';
    const bw = Math.max(1, w / (s._trail?.length || 1));
    (s._trail ?? []).forEach((x, i) => {
      const bh = x * (h - 20);
      ctx.fillRect(i * bw, h - bh, bw - 0.5, bh);
    });
    ctx.fillStyle = '#cfd2dc';
    ctx.font = '12px monospace';
    ctx.fillText(`r=${s.r.toFixed(3)}  x=${s.x.toFixed(3)}`, 8, 14);
  },
});
