// physics.test.js — physics-sim signal sources (ADR 059).
// Sims are driven deterministically via _advance() (the shared RAF clock is dormant
// under jsdom); the harmonic oscillator is checked against its closed-form solution.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  physics,
  physicsSimNames,
  _physicsLiveCount,
} from '../../../../src/api/signal/physics.js';
import '../../../../src/api/signal/physics-sims.js';
import { runResetHandlers } from '../../../../src/runtime/reset-registry.js';
import { subscribe } from '../../../../src/events/bus.js';

// Feed N fixed frames so a continuous sim substeps exactly N times at its own dt.
function advance(inst, frames, frameDt) {
  for (let i = 0; i < frames; i++) inst._advance(frameDt);
}

beforeEach(() => runResetHandlers(undefined, false)); // teardown any leftovers
afterEach(() => runResetHandlers(undefined, false));

describe('physics registry', () => {
  it('registers the v1 sim catalog', () => {
    const names = physicsSimNames();
    for (const n of ['pendulum', 'ball', 'kuramoto', 'harmonic', 'lorenz', 'logistic']) {
      expect(names).toContain(n);
    }
  });

  it('throws on an unknown sim', () => {
    expect(() => physics('nope')).toThrow(/unknown sim/);
  });

  it('exposes channels as callable readers with label + norm metadata', () => {
    const p = physics('harmonic', { id: 't-chan' });
    expect(typeof p.theta2).toBe('undefined'); // harmonic has no theta2
    expect(typeof p.x).toBe('function');
    expect(p.x.label).toBe('harmonic.x');
    expect(p.x.norm).toEqual([-1, 1]);
    expect(typeof p.x()).toBe('number');
  });

  it('reuses a live instance by identity (trajectory continues)', () => {
    const a = physics('pendulum', { id: 'reuse' });
    advance(a, 30, 1 / 60);
    const b = physics('pendulum', { id: 'reuse' });
    expect(b).toBe(a); // same instance, not a fresh one
  });

  it('set() changes a param live without re-creating', () => {
    const p = physics('kuramoto', { id: 'kset', k: 1 });
    expect(p.get('k')).toBe(1);
    p.set('k', 3);
    expect(p.get('k')).toBe(3);
  });
});

describe('physics tick contract', () => {
  it('harmonic oscillator matches its closed-form solution', () => {
    const omega = 2 * Math.PI;
    const zeta = 0.05;
    const p = physics('harmonic', { id: 't-harm', x: 1, v: 0, omega, zeta });
    // 240 substeps at dt = 1/240 → exactly t = 1s of sim time.
    advance(p, 240, 1 / 240);
    const t = 1;
    const wd = omega * Math.sqrt(1 - zeta * zeta);
    const expected =
      Math.exp(-zeta * omega * t) *
      (Math.cos(wd * t) + ((zeta * omega) / wd) * Math.sin(wd * t));
    expect(p.x()).toBeCloseTo(expected, 3);
  });

  it('logistic map iterates (not integrates) at its declared rate', () => {
    // rate 4 → dt 1/4; one advance(0.25) = one iteration.
    const m = physics('logistic', { id: 't-log', x: 0.5, r: 4 });
    m._advance(0.25);
    expect(m.x()).toBeCloseTo(1.0, 6); // 4 * 0.5 * (1-0.5) = 1
    m._advance(0.25);
    expect(m.x()).toBeCloseTo(0.0, 6); // 4 * 1 * (1-1) = 0
  });

  it('dual-emits events on both name and id namespaces with identity payload', () => {
    const byName = [];
    const byId = [];
    const u1 = subscribe('physics:ball:bounce', (e) => byName.push(e));
    const u2 = subscribe('physics:tb:bounce', (e) => byId.push(e));
    const b = physics('ball', { id: 'tb', height: 1, e: 0.9 });
    advance(b, 60, 1 / 60); // ~1s — long enough to fall and bounce
    u1();
    u2();
    expect(byName.length).toBeGreaterThan(0);
    expect(byId.length).toBe(byName.length);
    expect(byName[0]).toMatchObject({ id: 'tb', name: 'ball' });
    expect(typeof byName[0].speed).toBe('number');
  });
});

describe('physics lifecycle', () => {
  it('is an input — creating a sim does not join keep-alive', () => {
    const before = window.__ar_keepAlive?.size ?? 0;
    physics('lorenz', { id: 'li' });
    const after = window.__ar_keepAlive?.size ?? 0;
    expect(after).toBe(before); // no keep-alive membership (until .show())
  });

  it('survives a soft reset by identity, dies on the second (orphan) or a hard reset', () => {
    physics('lorenz', { id: 'soft' });
    expect(_physicsLiveCount()).toBe(1);
    runResetHandlers(undefined, true); // soft: reclaimed → kept, disarmed
    expect(_physicsLiveCount()).toBe(1);
    runResetHandlers(undefined, true); // soft: now an orphan → torn down
    expect(_physicsLiveCount()).toBe(0);

    physics('lorenz', { id: 'hard' });
    expect(_physicsLiveCount()).toBe(1);
    runResetHandlers(undefined, false); // hard: destroy
    expect(_physicsLiveCount()).toBe(0);
  });
});
