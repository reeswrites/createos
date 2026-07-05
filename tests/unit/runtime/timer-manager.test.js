import { freezeTimers, restoreTimers } from '../../../src/runtime/timer-manager.js';

describe('freezeTimers', () => {
  test('clears interval IDs via nativeClearInterval', () => {
    const clearInterval = vi.fn();
    const clearTimeout = vi.fn();
    const intervals = new Map([
      [1, { cb: () => {}, delay: 100, args: [] }],
      [2, { cb: () => {}, delay: 200, args: [] }],
    ]);
    freezeTimers(intervals, new Map(), clearInterval, clearTimeout);
    expect(clearInterval).toHaveBeenCalledWith(1);
    expect(clearInterval).toHaveBeenCalledWith(2);
    expect(clearInterval).toHaveBeenCalledTimes(2);
  });

  test('empties the intervals map in place', () => {
    const intervals = new Map([[1, { cb: () => {}, delay: 100, args: [] }]]);
    freezeTimers(intervals, new Map(), vi.fn(), vi.fn());
    expect(intervals.size).toBe(0);
  });

  test('saved.intervals contains snapshot before clear', () => {
    const entry = { cb: () => {}, delay: 100, args: ['x'] };
    const intervals = new Map([[1, entry]]);
    const { intervals: saved } = freezeTimers(intervals, new Map(), vi.fn(), vi.fn());
    expect(saved.size).toBe(1);
    expect(saved.get(1)).toBe(entry);
  });

  test('clears timeout IDs via nativeClearTimeout', () => {
    const clearTimeout = vi.fn();
    const timeouts = new Map([[10, { cb: () => {}, delay: 500, createdAt: Date.now(), args: [] }]]);
    freezeTimers(new Map(), timeouts, vi.fn(), clearTimeout);
    expect(clearTimeout).toHaveBeenCalledWith(10);
  });

  test('empties the timeouts map in place', () => {
    const timeouts = new Map([[10, { cb: () => {}, delay: 500, createdAt: Date.now(), args: [] }]]);
    freezeTimers(new Map(), timeouts, vi.fn(), vi.fn());
    expect(timeouts.size).toBe(0);
  });

  test('saved.timeouts contains snapshot before clear', () => {
    const entry = { cb: () => {}, delay: 500, createdAt: Date.now(), args: [] };
    const timeouts = new Map([[10, entry]]);
    const { timeouts: saved } = freezeTimers(new Map(), timeouts, vi.fn(), vi.fn());
    expect(saved.size).toBe(1);
    expect(saved.get(10)).toBe(entry);
  });

  test('returns frozenAt timestamp', () => {
    const before = Date.now();
    const { frozenAt } = freezeTimers(new Map(), new Map(), vi.fn(), vi.fn());
    expect(frozenAt).toBeGreaterThanOrEqual(before);
    expect(frozenAt).toBeLessThanOrEqual(Date.now());
  });

  test('works with empty maps', () => {
    const clearInterval = vi.fn();
    const clearTimeout = vi.fn();
    const saved = freezeTimers(new Map(), new Map(), clearInterval, clearTimeout);
    expect(clearInterval).not.toHaveBeenCalled();
    expect(clearTimeout).not.toHaveBeenCalled();
    expect(saved.intervals.size).toBe(0);
    expect(saved.timeouts.size).toBe(0);
  });
});

describe('restoreTimers', () => {
  test('re-registers each saved interval', () => {
    const setInterval = vi.fn();
    const cb1 = () => {};
    const cb2 = () => {};
    const saved = {
      intervals: new Map([
        [1, { cb: cb1, delay: 100, args: [] }],
        [2, { cb: cb2, delay: 200, args: ['a'] }],
      ]),
      timeouts: new Map(),
    };
    restoreTimers(saved, setInterval, vi.fn());
    expect(setInterval).toHaveBeenCalledWith(cb1, 100);
    expect(setInterval).toHaveBeenCalledWith(cb2, 200, 'a');
  });

  test('re-registers timeout with remaining delay', () => {
    vi.useFakeTimers();
    const setTimeout = vi.fn();
    const cb = () => {};
    const createdAt = Date.now();
    // Advance clock 200 ms then restore a 500 ms timeout → 300 ms remaining
    vi.advanceTimersByTime(200);
    const saved = {
      intervals: new Map(),
      timeouts: new Map([[10, { cb, delay: 500, createdAt, args: [] }]]),
    };
    restoreTimers(saved, vi.fn(), setTimeout);
    const [calledCb, remaining] = setTimeout.mock.calls[0];
    expect(calledCb).toBe(cb);
    expect(remaining).toBeGreaterThanOrEqual(290);
    expect(remaining).toBeLessThanOrEqual(310);
    vi.useRealTimers();
  });

  test('timeout remaining delay floors at 0 (overdue timeouts fire immediately)', () => {
    vi.useFakeTimers();
    const setTimeout = vi.fn();
    const cb = () => {};
    // Timeout was already overdue — createdAt 1000 ms ago, delay was 100 ms
    vi.advanceTimersByTime(1000);
    const createdAt = Date.now() - 1000;
    const saved = {
      intervals: new Map(),
      timeouts: new Map([[10, { cb, delay: 100, createdAt, args: [] }]]),
    };
    restoreTimers(saved, vi.fn(), setTimeout);
    const [, remaining] = setTimeout.mock.calls[0];
    expect(remaining).toBe(0);
    vi.useRealTimers();
  });

  test('no-ops when saved is null', () => {
    const setInterval = vi.fn();
    const setTimeout = vi.fn();
    restoreTimers(null, setInterval, setTimeout);
    expect(setInterval).not.toHaveBeenCalled();
    expect(setTimeout).not.toHaveBeenCalled();
  });

  test('no-ops when saved is undefined', () => {
    const setInterval = vi.fn();
    restoreTimers(undefined, setInterval, vi.fn());
    expect(setInterval).not.toHaveBeenCalled();
  });

  test('freeze → restore round trip: each interval re-registered', () => {
    const cb = vi.fn();
    const setInterval = vi.fn();
    const intervals = new Map([[7, { cb, delay: 250, args: ['z'] }]]);
    const saved = freezeTimers(intervals, new Map(), vi.fn(), vi.fn());
    restoreTimers(saved, setInterval, vi.fn());
    expect(setInterval).toHaveBeenCalledWith(cb, 250, 'z');
  });
});
