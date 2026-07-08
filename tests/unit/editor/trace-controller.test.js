import { TraceController, setTraceLinesEffect } from '../../../src/editor/trace-controller.js';

// The Execution Trail glow, now testable through its own interface (ADR 019) rather
// than only via a live EditorInstance. Native timers + getCm + rAF are all injected/
// stubbed so record → flush → clear is driven deterministically.

function makeFakeCm() {
  const effects = [];
  return {
    effects,
    dispatch({ effects: e }) {
      effects.push(e);
    },
    // Last dispatched trace-line Set (or null), for assertions.
    lastLines() {
      const last = effects[effects.length - 1];
      return last?.value ?? null;
    },
  };
}

function makeNative() {
  let seq = 1;
  const timers = new Map();
  return {
    setTimeout: (fn, _ms) => {
      const id = seq++;
      timers.set(id, fn);
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
    // Test hook: fire a pending timer to simulate the 800ms fade.
    fire: (id) => timers.get(id)?.(),
    pending: () => timers.size,
  };
}

describe('TraceController', () => {
  let rafQueue;
  beforeEach(() => {
    rafQueue = [];
    globalThis.requestAnimationFrame = (fn) => {
      rafQueue.push(fn);
      return rafQueue.length;
    };
    globalThis.cancelAnimationFrame = (id) => {
      rafQueue[id - 1] = null;
    };
  });
  const flushRaf = () => {
    const q = rafQueue;
    rafQueue = [];
    for (const fn of q) fn?.();
  };

  test('record() is a no-op when disabled', () => {
    const cm = makeFakeCm();
    const tc = new TraceController({ native: makeNative(), getCm: () => cm, enabled: false });
    tc.record(3);
    flushRaf();
    expect(cm.effects).toHaveLength(0);
  });

  test('record() → flush lights the fired lines', () => {
    const cm = makeFakeCm();
    const tc = new TraceController({ native: makeNative(), getCm: () => cm, enabled: true });
    tc.record(5);
    tc.record(9);
    flushRaf();
    const lines = cm.lastLines();
    expect([...lines].sort((a, b) => a - b)).toEqual([5, 9]);
  });

  test('multiple record() before a frame coalesce into one RAF', () => {
    const cm = makeFakeCm();
    const tc = new TraceController({ native: makeNative(), getCm: () => cm, enabled: true });
    tc.record(1);
    tc.record(2);
    expect(rafQueue.filter(Boolean)).toHaveLength(1);
  });

  test('fade timer removes a line when it fires', () => {
    const cm = makeFakeCm();
    const native = makeNative();
    const tc = new TraceController({ native, getCm: () => cm, enabled: true });
    tc.record(7);
    flushRaf();
    expect([...cm.lastLines()]).toEqual([7]);
    // One pending fade timer; firing it drops the line.
    native.fire(1);
    expect([...cm.lastLines()]).toEqual([]);
  });

  test('clear() cancels the RAF, timers, and dispatches null', () => {
    const cm = makeFakeCm();
    const native = makeNative();
    const tc = new TraceController({ native, getCm: () => cm, enabled: true });
    tc.record(4);
    flushRaf();
    expect(native.pending()).toBe(1);
    tc.clear();
    expect(native.pending()).toBe(0);
    const last = cm.effects[cm.effects.length - 1];
    expect(last.is(setTraceLinesEffect)).toBe(true);
    expect(last.value).toBeNull();
  });
});
