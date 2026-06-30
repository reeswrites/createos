// event-bus.test.js — unit tests for the global event bus (src/events/bus.js)
// and EventSelector (src/events/event-selector.js).

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Reset module state between tests by importing fresh copies.
// The bus module uses top-level Maps; we need to reset them each test.
// Strategy: use vi.isolateModules for stateful tests, or just reimport
// and work with the exported API (statefulness is acceptable for integration-style tests).

let emit, notify, subscribe, registerCommand, registerSource, getLastPayload, clearRunScoped, hasSubscribers;
let on, any, tick, hold;

beforeEach(async () => {
  // Re-import to get a fresh module instance per test would require vitest resetModules.
  // Instead we rely on clearRunScoped + direct cleanup via returned unsub handles.
  ({ emit, notify, subscribe, registerCommand, registerSource, getLastPayload, clearRunScoped, hasSubscribers } = await import('../src/events/bus.js'));
  ({ on, any, tick, hold } = await import('../src/events/event-selector.js'));
});

// ── Core bus ──────────────────────────────────────────────────────────────────

describe('emit / subscribe (notification-only events)', () => {
  it('emit fires subscribers for notification-only events', () => {
    const fn = vi.fn();
    const unsub = subscribe('test:ping', fn);
    emit('test:ping', { x: 1 });
    expect(fn).toHaveBeenCalledWith({ x: 1 });
    unsub();
  });

  it('multiple subscribers all fire', () => {
    const a = vi.fn(), b = vi.fn();
    const ua = subscribe('test:multi', a);
    const ub = subscribe('test:multi', b);
    emit('test:multi', { v: 7 });
    expect(a).toHaveBeenCalledWith({ v: 7 });
    expect(b).toHaveBeenCalledWith({ v: 7 });
    ua(); ub();
  });

  it('unsubscribe stops further notifications', () => {
    const fn = vi.fn();
    const unsub = subscribe('test:unsub', fn);
    unsub();
    emit('test:unsub', {});
    expect(fn).not.toHaveBeenCalled();
  });

  it('subscriber error does not stop other subscribers', () => {
    const bad = vi.fn(() => { throw new Error('boom'); });
    const good = vi.fn();
    const u1 = subscribe('test:err', bad);
    const u2 = subscribe('test:err', good);
    expect(() => emit('test:err', {})).not.toThrow();
    expect(good).toHaveBeenCalled();
    u1(); u2();
  });
});

describe('notify()', () => {
  it('notify fires subscribers directly (bypasses command handler)', () => {
    const handler = vi.fn(() => ({}));
    const sub = vi.fn();
    registerCommand('test:notifycmd', handler);
    const unsub = subscribe('test:notifycmd', sub);
    notify('test:notifycmd', { from: 'notify' });
    expect(sub).toHaveBeenCalledWith({ from: 'notify' });
    expect(handler).not.toHaveBeenCalled();
    unsub();
  });
});

describe('registerCommand()', () => {
  it('emit calls command handler', () => {
    const handler = vi.fn();
    registerCommand('test:cmd1', handler);
    emit('test:cmd1', { do: 'something' });
    expect(handler).toHaveBeenCalledWith({ do: 'something' });
  });

  it('command handler called — subscribers NOT called by emit (method calls notify)', () => {
    const handler = vi.fn();
    const sub = vi.fn();
    registerCommand('test:cmd2', handler);
    const unsub = subscribe('test:cmd2', sub);
    emit('test:cmd2', {});
    // emit() does NOT fire subscribers after command handler — avoids double-notification
    expect(handler).toHaveBeenCalled();
    expect(sub).not.toHaveBeenCalled();
    unsub();
  });

  it('command handler error emits namespace:error', () => {
    const errSub = vi.fn();
    const unsub = subscribe('test:error', errSub);
    registerCommand('test:throw', () => { throw new Error('handler fail'); });
    emit('test:throw', {});
    expect(errSub).toHaveBeenCalledWith(expect.objectContaining({
      command: 'test:throw',
      reason: 'handler fail',
    }));
    unsub();
  });

  it('async command handler rejection emits namespace:error', async () => {
    const errSub = vi.fn();
    const unsub = subscribe('test:error', errSub);
    registerCommand('test:asyncthrow', async () => { throw new Error('async fail'); });
    emit('test:asyncthrow', {});
    // Wait for the promise rejection to propagate
    await new Promise(r => setTimeout(r, 10));
    expect(errSub).toHaveBeenCalledWith(expect.objectContaining({ reason: 'async fail' }));
    unsub();
  });
});

describe('clearRunScoped()', () => {
  it('clears run-scoped subscriptions and leaves non-run-scoped intact', () => {
    // Non-run-scoped (no active editor id)
    delete window.__ar_active_editor_id;
    const persistent = vi.fn();
    const unpersist = subscribe('test:scope', persistent);

    // Run-scoped (active editor present)
    window.__ar_active_editor_id = 42;
    const runScoped = vi.fn();
    subscribe('test:scope', runScoped);
    delete window.__ar_active_editor_id;

    clearRunScoped();

    emit('test:scope', {});
    expect(persistent).toHaveBeenCalled();
    expect(runScoped).not.toHaveBeenCalled();

    unpersist();
    // unscoped() would no-op since already cleared
  });
});

// ── EventSelector ─────────────────────────────────────────────────────────────

describe('on(event).do(fn)', () => {
  it('fires on each event', () => {
    const fn = vi.fn();
    const stop = on('test:selector-basic').do(fn);
    emit('test:selector-basic', { v: 1 });
    emit('test:selector-basic', { v: 2 });
    expect(fn).toHaveBeenCalledTimes(2);
    stop();
  });

  it('stop handle unsubscribes', () => {
    const fn = vi.fn();
    const stop = on('test:selector-stop').do(fn);
    stop();
    emit('test:selector-stop', {});
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('on(event).every(n)', () => {
  it('fires only on nth occurrence', () => {
    const fn = vi.fn();
    const stop = on('test:every').every(3).do(fn);
    emit('test:every', {});  // 1
    emit('test:every', {});  // 2
    emit('test:every', {});  // 3 → fire
    emit('test:every', {});  // 4
    emit('test:every', {});  // 5
    emit('test:every', {});  // 6 → fire
    expect(fn).toHaveBeenCalledTimes(2);
    stop();
  });
});

describe('on(event).when(pred)', () => {
  it('fires only when predicate is true', () => {
    const fn = vi.fn();
    const stop = on('test:when').when(d => d.v > 5).do(fn);
    emit('test:when', { v: 3 });
    emit('test:when', { v: 8 });
    emit('test:when', { v: 2 });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(expect.objectContaining({ v: 8 }));
    stop();
  });
});

describe('on(event).within(ms)', () => {
  it('fires when elapsed since last is < ms', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    // within(200) — only fire if less than 200ms since last event
    const stop = on('test:within').within(200).do(fn);
    emit('test:within', {}); // first event — no previous, fires (or not? let's check implementation)
    // Actually the first event has no "last" — it fires unconditionally
    // Subsequent events within 200ms should fire
    vi.advanceTimersByTime(100);
    emit('test:within', {}); // 100ms gap < 200 → fire
    vi.advanceTimersByTime(300);
    emit('test:within', {}); // 300ms gap > 200 → no fire
    // 2 fires: the first (no previous), the 100ms one
    expect(fn).toHaveBeenCalledTimes(2);
    stop();
    vi.useRealTimers();
  });
});

describe('on(event).after(trigger)', () => {
  it('only fires after trigger event fires once', () => {
    const fn = vi.fn();
    const stop = on('test:gate').after('test:unlock').do(fn);
    emit('test:gate', {}); // before trigger — should NOT fire
    emit('test:gate', {}); // before trigger — should NOT fire
    emit('test:unlock', {}); // trigger fires
    emit('test:gate', {}); // now should fire
    emit('test:gate', {}); // should fire again
    expect(fn).toHaveBeenCalledTimes(2);
    stop();
  });
});

describe('any(...events)', () => {
  it('fires on any of the listed events', () => {
    const fn = vi.fn();
    const stop = any('test:a', 'test:b').do(fn);
    emit('test:a', { src: 'a' });
    emit('test:b', { src: 'b' });
    emit('test:a', { src: 'a2' });
    expect(fn).toHaveBeenCalledTimes(3);
    stop();
  });

  it('stop handle unsubscribes from all events', () => {
    const fn = vi.fn();
    const stop = any('test:xa', 'test:xb').do(fn);
    stop();
    emit('test:xa', {});
    emit('test:xb', {});
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('faking beat:tick', () => {
  it('emit("beat:tick") notifies on() subscribers without needing real transport', () => {
    const fn = vi.fn();
    const stop = on('beat:tick').do(fn);
    emit('beat:tick', { bpm: 120, bar: 0, beat: 0 });
    expect(fn).toHaveBeenCalledWith(expect.objectContaining({ bpm: 120, beat: 0 }));
    stop();
  });
});

// ── registerSource — lazy source lifecycle ─────────────────────────────────────

describe('registerSource()', () => {
  it('start called on first subscriber, stop on last', () => {
    const start = vi.fn(() => null);
    const stop  = vi.fn();
    registerSource('test:lazy-src', { start, stop });

    expect(start).not.toHaveBeenCalled();
    const u1 = subscribe('test:lazy-src', () => {});
    expect(start).toHaveBeenCalledTimes(1);
    const u2 = subscribe('test:lazy-src', () => {});
    expect(start).toHaveBeenCalledTimes(1); // no second start

    u1();
    expect(stop).not.toHaveBeenCalled(); // still 1 subscriber
    u2();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('teardown returned by start is called on stop', () => {
    const teardown = vi.fn();
    registerSource('test:lazy-teardown', { start: () => teardown });
    const u = subscribe('test:lazy-teardown', () => {});
    u();
    expect(teardown).toHaveBeenCalledTimes(1);
  });

  it('clearRunScoped decrements source count', () => {
    const start = vi.fn(() => null);
    const stop  = vi.fn();
    registerSource('test:lazy-scope', { start, stop });

    window.__ar_active_editor_id = 42;
    subscribe('test:lazy-scope', () => {});
    delete window.__ar_active_editor_id;
    expect(stop).not.toHaveBeenCalled();

    clearRunScoped();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('pattern match function triggers source once (shared count across matched events)', () => {
    const start = vi.fn(() => null);
    registerSource(e => e.startsWith('test:pattern-'), { start });
    const u1 = subscribe('test:pattern-a', () => {});
    const u2 = subscribe('test:pattern-b', () => {});
    // Both events increment the same source's count; start fires only on 0→1 (first sub)
    expect(start).toHaveBeenCalledTimes(1);
    u1(); u2();
  });
});

// ── getLastPayload ─────────────────────────────────────────────────────────────

describe('getLastPayload()', () => {
  it('returns undefined before any fire', () => {
    expect(getLastPayload('test:no-fire-yet')).toBeUndefined();
  });

  it('returns last payload after emit', () => {
    emit('test:last-payload', { x: 42 });
    expect(getLastPayload('test:last-payload')).toEqual({ x: 42 });
    emit('test:last-payload', { x: 99 });
    expect(getLastPayload('test:last-payload')).toEqual({ x: 99 });
  });
});

// ── .when() — three modes ─────────────────────────────────────────────────────

describe('on(event).when(object pattern) — filter mode', () => {
  it('filters by exact property value', () => {
    const fn = vi.fn();
    const stop = on('test:when-obj').when({ v: 5 }).do(fn);
    emit('test:when-obj', { v: 3 });
    emit('test:when-obj', { v: 5 });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(expect.objectContaining({ v: 5 }));
    stop();
  });

  it('array value = OR match', () => {
    const fn = vi.fn();
    const stop = on('test:when-arr').when({ key: ['a', 'b'] }).do(fn);
    emit('test:when-arr', { key: 'a' });
    emit('test:when-arr', { key: 'c' });
    emit('test:when-arr', { key: 'b' });
    expect(fn).toHaveBeenCalledTimes(2);
    stop();
  });

  it('multiple properties = AND match', () => {
    const fn = vi.fn();
    const stop = on('test:when-multi').when({ type: 'on', note: 60 }).do(fn);
    emit('test:when-multi', { type: 'on', note: 60 });
    emit('test:when-multi', { type: 'on', note: 64 });
    emit('test:when-multi', { type: 'off', note: 60 });
    expect(fn).toHaveBeenCalledTimes(1);
    stop();
  });
});

describe('on(event).when(prop, map) — explicit dispatch terminal', () => {
  it('dispatches to correct handler by property value', () => {
    const fnA = vi.fn(), fnB = vi.fn();
    const stop = on('test:dispatch-explicit').when('key', { a: fnA, b: fnB });
    emit('test:dispatch-explicit', { key: 'a', extra: 1 });
    emit('test:dispatch-explicit', { key: 'b', extra: 2 });
    emit('test:dispatch-explicit', { key: 'c', extra: 3 });
    expect(fnA).toHaveBeenCalledTimes(1);
    expect(fnA).toHaveBeenCalledWith(expect.objectContaining({ key: 'a' }));
    expect(fnB).toHaveBeenCalledTimes(1);
    stop();
  });

  it('stop handle unsubscribes', () => {
    const fn = vi.fn();
    const stop = on('test:dispatch-stop').when('k', { x: fn });
    stop();
    emit('test:dispatch-stop', { k: 'x' });
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('on(event).when(fn-map) — terse dispatch via primary (window:key:down)', () => {
  it('dispatches by primary field', () => {
    const w = vi.fn(), s = vi.fn();
    const stop = on('window:key:down').when({ w, s });
    emit('window:key:down', { key: 'w', winId: null });
    emit('window:key:down', { key: 's', winId: null });
    emit('window:key:down', { key: 'a', winId: null });
    expect(w).toHaveBeenCalledTimes(1);
    expect(s).toHaveBeenCalledTimes(1);
    stop();
  });

  it('throws for event without primary field', () => {
    expect(() => on('beat:bar').when({ 0: () => {} })).toThrow(/primary/);
  });
});

// ── tick(ms) ──────────────────────────────────────────────────────────────────

describe('tick(ms)', () => {
  it('fires fn on each interval', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const stop = tick(100).do(fn);
    vi.advanceTimersByTime(350);
    expect(fn).toHaveBeenCalledTimes(3);
    stop();
    vi.useRealTimers();
  });

  it('stop handle cancels interval', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const stop = tick(100).do(fn);
    vi.advanceTimersByTime(250);
    stop();
    vi.advanceTimersByTime(300);
    expect(fn).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('.every(n) fires only on nth tick', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const stop = tick(100).every(3).do(fn);
    vi.advanceTimersByTime(350);
    expect(fn).toHaveBeenCalledTimes(1); // only on 3rd tick
    vi.advanceTimersByTime(300);
    expect(fn).toHaveBeenCalledTimes(2); // 6th tick
    stop();
    vi.useRealTimers();
  });

  it('.after(event) only fires after trigger fires', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const stop = tick(100).after('test:tick-unlock').do(fn);
    vi.advanceTimersByTime(250); // 2 ticks before unlock
    expect(fn).toHaveBeenCalledTimes(0);
    emit('test:tick-unlock', {});
    vi.advanceTimersByTime(250); // ticks at 300, 400, 500 ms — 3 fires
    expect(fn).toHaveBeenCalledTimes(3);
    stop();
    vi.useRealTimers();
  });

  // Regression: tick MUST route through the active editor's TRACKED setInterval
  // so its interval lands in _intervals and is cleared on reset/stop. Before the
  // fix it used the unpatched global window.setInterval → untracked native timers
  // that no reset ever cleared (zombie loops kept firing after window close).
  it('routes through the active editor tracked setInterval (so reset can clear it)', () => {
    const realSet = window.setInterval, realClear = window.clearInterval;
    const trackedSet = vi.fn((cb, ms) => realSet(cb, ms));
    const trackedClear = vi.fn((id) => realClear(id));
    window.__ar_active_editor_id = 7;
    window.__ar_e7_setInterval = trackedSet;
    window.__ar_e7_clearInterval = trackedClear;
    try {
      const stop = tick(50).do(() => {});
      expect(trackedSet).toHaveBeenCalledTimes(1);  // used the tracked one, not native global
      stop();
      expect(trackedClear).toHaveBeenCalledTimes(1);
    } finally {
      delete window.__ar_active_editor_id;
      delete window.__ar_e7_setInterval;
      delete window.__ar_e7_clearInterval;
    }
  });

  it('falls back to native timers when there is no active editor (e.g. tests)', () => {
    delete window.__ar_active_editor_id;
    vi.useFakeTimers();
    const fn = vi.fn();
    const stop = tick(100).do(fn);     // must still work with no tracker present
    vi.advanceTimersByTime(250);
    expect(fn).toHaveBeenCalledTimes(2);
    stop();
    vi.useRealTimers();
  });
});

// ── .hold() ───────────────────────────────────────────────────────────────────

describe('on(event).hold() — Set mode (paired events)', () => {
  it('returns live Set, adds on event, deletes on release', () => {
    const keys = on('window:key:down').hold();
    expect(keys instanceof Set).toBe(true);
    emit('window:key:down', { key: 'w', code: 'KeyW', winId: null });
    emit('window:key:down', { key: 'a', code: 'KeyA', winId: null });
    expect(keys.has('w')).toBe(true);
    expect(keys.has('a')).toBe(true);
    emit('window:key:up',   { key: 'w', code: 'KeyW', winId: null });
    expect(keys.has('w')).toBe(false);
    expect(keys.has('a')).toBe(true);
  });
});

describe('on(event).hold() — object mode (no release)', () => {
  it('returns live object updated on each payload', () => {
    const state = on('test:hold-obj').hold();
    expect(typeof state).toBe('object');
    emit('test:hold-obj', { x: 10, y: 20 });
    expect(state.x).toBe(10);
    expect(state.y).toBe(20);
    emit('test:hold-obj', { x: 99 });
    expect(state.x).toBe(99);
    expect(state.y).toBe(20); // retains previous
  });
});

describe('global hold(event)', () => {
  it('memoizes — same call returns same object', () => {
    const a = hold('test:hold-memo');
    const b = hold('test:hold-memo');
    expect(a).toBe(b);
  });

  it('updates live state from emits', () => {
    const state = hold('test:hold-live');
    emit('test:hold-live', { v: 1 });
    expect(state.v).toBe(1);
    emit('test:hold-live', { v: 2 });
    expect(state.v).toBe(2);
  });
});

// ── Bus taps ──────────────────────────────────────────────────────────────────

describe('addBusTap', () => {
  let addBusTap;
  beforeEach(async () => {
    ({ addBusTap } = await import('../src/events/bus.js'));
  });

  it('tap fires on emit (notification-only event)', () => {
    const fn = vi.fn();
    const remove = addBusTap(fn);
    emit('test:tap:notify', { a: 1 });
    expect(fn).toHaveBeenCalledWith('test:tap:notify', { a: 1 });
    remove();
  });

  it('tap fires on notify', () => {
    const fn = vi.fn();
    const remove = addBusTap(fn);
    notify('test:tap:direct', { b: 2 });
    expect(fn).toHaveBeenCalledWith('test:tap:direct', { b: 2 });
    remove();
  });

  it('unsubscribe stops tap from firing', () => {
    const fn = vi.fn();
    const remove = addBusTap(fn);
    remove();
    emit('test:tap:removed', {});
    expect(fn).not.toHaveBeenCalled();
  });

  it('tap error does not break _fire or other taps', () => {
    const bad = vi.fn(() => { throw new Error('tap boom'); });
    const good = vi.fn();
    const r1 = addBusTap(bad);
    const r2 = addBusTap(good);
    expect(() => emit('test:tap:err', {})).not.toThrow();
    expect(good).toHaveBeenCalled();
    r1(); r2();
  });

  it('taps survive clearRunScoped', () => {
    const fn = vi.fn();
    const remove = addBusTap(fn);
    clearRunScoped();
    emit('test:tap:persist', {});
    expect(fn).toHaveBeenCalled();
    remove();
  });
});

// ── hasSubscribers — used by wm.js to yield body-drag to an interactive sketch ──

describe('hasSubscribers', () => {
  it('false when no one subscribes', () => {
    expect(hasSubscribers('hs:none')).toBe(false);
  });

  it('true when a plain subscriber exists', () => {
    const unsub = subscribe('hs:plain', () => {});
    expect(hasSubscribers('hs:plain')).toBe(true);
    unsub();
    expect(hasSubscribers('hs:plain')).toBe(false);
  });

  it('runScopedOnly ignores persistent subscribers', () => {
    const unsub = subscribe('hs:persist', () => {}, { persistent: true });
    expect(hasSubscribers('hs:persist')).toBe(true);
    expect(hasSubscribers('hs:persist', { runScopedOnly: true })).toBe(false);
    unsub();
  });

  it('runScopedOnly true for subscriptions created during an active run', () => {
    const prev = window.__ar_active_editor_id;
    window.__ar_active_editor_id = 1;          // simulate an active editor run
    const unsub = subscribe('hs:run', () => {});
    expect(hasSubscribers('hs:run', { runScopedOnly: true })).toBe(true);
    unsub();
    window.__ar_active_editor_id = prev;
  });

  it('clearRunScoped drops run-scoped subscribers from the check', () => {
    const prev = window.__ar_active_editor_id;
    window.__ar_active_editor_id = 1;
    subscribe('hs:wiped', () => {});
    expect(hasSubscribers('hs:wiped', { runScopedOnly: true })).toBe(true);
    clearRunScoped();
    expect(hasSubscribers('hs:wiped', { runScopedOnly: true })).toBe(false);
    window.__ar_active_editor_id = prev;
  });
});
