import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { PauseController } from '../src/runtime/pause-controller.js';

// The orchestration these tests cover used to sit inline in the untested
// editor-instance.js: freeze-on-pause, restore-with-remaining-delay-on-resume,
// and (the load-bearing bit) restoring through the editor's NAMESPACED tracked
// setters so timers re-register. Now it has a test surface (ADR 043).

function makeController({ intervals = new Map(), timeouts = new Map(), trackedSetters } = {}) {
  const clearInterval = vi.fn();
  const clearTimeout  = vi.fn();
  const setInterval   = vi.fn();
  const setTimeout    = vi.fn();
  const ctl = new PauseController({
    intervals, timeouts, clearInterval, clearTimeout,
    trackedSetters: trackedSetters ?? (() => ({ setInterval, setTimeout })),
  });
  return { ctl, intervals, timeouts, clearInterval, clearTimeout, setInterval, setTimeout };
}

describe('PauseController.pause()', () => {
  test('clears tracked intervals/timeouts and reports paused', () => {
    const intervals = new Map([[1, { cb: () => {}, delay: 100, args: [] }]]);
    const timeouts  = new Map([[7, { cb: () => {}, delay: 500, createdAt: Date.now(), args: [] }]]);
    const { ctl, clearInterval, clearTimeout } = makeController({ intervals, timeouts });

    expect(ctl.paused).toBe(false);
    ctl.pause();
    expect(ctl.paused).toBe(true);
    expect(clearInterval).toHaveBeenCalledWith(1);
    expect(clearTimeout).toHaveBeenCalledWith(7);
    expect(intervals.size).toBe(0);
    expect(timeouts.size).toBe(0);
  });

  test('is idempotent — second pause does not re-freeze', () => {
    const intervals = new Map([[1, { cb: () => {}, delay: 100, args: [] }]]);
    const { ctl, clearInterval } = makeController({ intervals });
    ctl.pause();
    intervals.set(2, { cb: () => {}, delay: 50, args: [] }); // arrives after freeze
    ctl.pause();                                             // no-op
    expect(clearInterval).toHaveBeenCalledTimes(1);          // only the first id
  });
});

describe('PauseController.resume()', () => {
  test('restores intervals through the injected tracked setters', () => {
    const cb = () => {};
    const intervals = new Map([[1, { cb, delay: 250, args: ['a'] }]]);
    const { ctl, setInterval } = makeController({ intervals });
    ctl.pause();
    ctl.resume();
    expect(setInterval).toHaveBeenCalledWith(cb, 250, 'a');
    expect(ctl.paused).toBe(false);
  });

  test('restores timeouts with their REMAINING delay', () => {
    const cb = () => {};
    const createdAt = Date.now() - 300;                     // 300ms already elapsed
    const timeouts  = new Map([[9, { cb, delay: 500, createdAt, args: [] }]]);
    const { ctl, setTimeout } = makeController({ timeouts });
    ctl.pause();
    ctl.resume();
    expect(setTimeout).toHaveBeenCalledTimes(1);
    const [, remaining] = setTimeout.mock.calls[0];
    expect(remaining).toBeGreaterThanOrEqual(150);          // ~200ms left, allow slack
    expect(remaining).toBeLessThanOrEqual(250);
  });

  test('resolves the tracked setters lazily, at resume time (namespace correctness)', () => {
    const cb = () => {};
    const intervals = new Map([[1, { cb, delay: 100, args: [] }]]);
    let resolved = 0;
    const lateSetInterval = vi.fn();
    const trackedSetters = () => { resolved++; return { setInterval: lateSetInterval, setTimeout: vi.fn() }; };
    const { ctl } = makeController({ intervals, trackedSetters });

    ctl.pause();
    expect(resolved).toBe(0);          // pause must NOT resolve setters
    ctl.resume();
    expect(resolved).toBe(1);          // resume resolves them once, then
    expect(lateSetInterval).toHaveBeenCalledWith(cb, 100);
  });

  test('resume without a prior pause is a no-op', () => {
    const { ctl, setInterval } = makeController();
    ctl.resume();
    expect(setInterval).not.toHaveBeenCalled();
  });
});

describe('PauseController.clear()', () => {
  test('drops frozen state without restoring (hard reset path)', () => {
    const intervals = new Map([[1, { cb: () => {}, delay: 100, args: [] }]]);
    const { ctl, setInterval } = makeController({ intervals });
    ctl.pause();
    ctl.clear();
    expect(ctl.paused).toBe(false);
    ctl.resume();                       // nothing to restore
    expect(setInterval).not.toHaveBeenCalled();
  });
});
