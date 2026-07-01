// Performance capture / replay (ADR 031) — recorder buffer, scheduler, timeline.
import {
  Take, armGlobal, disarmGlobal, isGlobalArmed,
  buildReplayCode, buildTimelineCode,
} from '../../../../src/api/signal/performance-recorder.js';
import { scheduleReplay, replayActions, _activeReplayCount } from '../../../../src/api/signal/replay-clock.js';
import { runResetHandlers } from '../../../../src/runtime/reset-registry.js';
import { timeline } from '../../../../src/api/signal/timeline.js';

// A minimal widget that implements the capture/replay contract.
function fakeWidget(varName = 'w') {
  return {
    applied: [],
    _applyAction(a) { this.applied.push(a); },
    _perfCtor() { return { varName, code: `const ${varName} = make();` }; },
  };
}

describe('Take — per-widget capture buffer', () => {
  test('records nothing until armed', () => {
    const t = new Take(fakeWidget());
    expect(t.push({ vi: 0 })).toBeNull();
    expect(t.disarm()).toEqual([]);
  });

  test('stamps wall-clock t from arm() and returns stored action', () => {
    const t = new Take(fakeWidget());
    t.arm();
    const a = t.push({ vi: 3 });
    expect(a).toMatchObject({ vi: 3 });
    expect(typeof a.t).toBe('number');
    expect(a.t).toBeGreaterThanOrEqual(0);
    const log = t.disarm();
    expect(log).toHaveLength(1);
    expect(log[0]).toBe(a); // same object — back-fillable
  });

  test('arm() resets the previous log', () => {
    const t = new Take(fakeWidget());
    t.arm(); t.push({ vi: 1 }); t.disarm();
    t.arm();
    expect(t.disarm()).toEqual([]);
  });

  test('returned action object is mutable for duration back-fill (piano)', () => {
    const t = new Take(fakeWidget());
    t.arm();
    const a = t.push({ note: 'C4', dur: 0 });
    a.dur = 250;
    expect(t.disarm()[0].dur).toBe(250);
  });
});

describe('Global take — shared clock across widgets', () => {
  afterEach(() => { if (isGlobalArmed()) disarmGlobal(); });

  test('routes pushes into per-widget tracks, ignoring solo arm state', () => {
    const w1 = new Take(fakeWidget('a'));
    const w2 = new Take(fakeWidget('b'));
    armGlobal();
    expect(isGlobalArmed()).toBe(true);
    w1.push({ vi: 0 });          // not solo-armed, but global captures it
    w2.push({ op: 'pixel', x: 1, y: 2 });
    w1.push({ vi: 1 });
    const tracks = disarmGlobal();
    expect(isGlobalArmed()).toBe(false);
    expect(tracks).toHaveLength(2);
    const byWidget = new Map(tracks.map(t => [t.widget, t.actions]));
    expect(byWidget.get(w1._widget)).toHaveLength(2);
    expect(byWidget.get(w2._widget)).toHaveLength(1);
  });

  test('drops empty tracks', () => {
    const w1 = new Take(fakeWidget('a'));
    armGlobal();
    w1.push({ vi: 0 });
    new Take(fakeWidget('b')); // never pushes
    expect(disarmGlobal()).toHaveLength(1);
  });
});

describe('Code builders', () => {
  test('buildReplayCode emits ctor + one-line-per-action replay', () => {
    const w = fakeWidget('dp');
    const code = buildReplayCode(w, [{ t: 0, vi: 0 }, { t: 100, vi: 2 }]);
    expect(code).toContain('const dp = make();');
    expect(code).toContain('dp.replay([');
    expect(code).toContain('{"t":0,"vi":0}');
    expect(code).toContain('{"t":100,"vi":2}');
  });

  test('buildReplayCode loop option', () => {
    expect(buildReplayCode(fakeWidget('p'), [{ t: 0 }], { loop: true }))
      .toContain('{ loop: true }');
  });

  test('buildTimelineCode composes one track per widget', () => {
    const a = fakeWidget('p'); const b = fakeWidget('dp');
    const code = buildTimelineCode([
      { widget: a, actions: [{ t: 0, note: 'C4' }] },
      { widget: b, actions: [{ t: 50, vi: 0 }] },
    ]);
    expect(code).toContain('const p = make();');
    expect(code).toContain('const dp = make();');
    expect(code).toContain('timeline()');
    expect(code).toContain('.track(p,');
    expect(code).toContain('.track(dp,');
    expect(code).toContain('.play();');
  });
});

describe('replay-clock scheduler', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.runOnlyPendingTimers(); vi.useRealTimers(); });

  test('fires ops at their offsets', () => {
    const fired = [];
    scheduleReplay([
      { at: 0,   fn: () => fired.push('a') },
      { at: 100, fn: () => fired.push('b') },
      { at: 300, fn: () => fired.push('c') },
    ]);
    vi.advanceTimersByTime(0);   expect(fired).toEqual(['a']);
    vi.advanceTimersByTime(100); expect(fired).toEqual(['a', 'b']);
    vi.advanceTimersByTime(200); expect(fired).toEqual(['a', 'b', 'c']);
  });

  test('releases keep-alive and deregisters when a non-looping take finishes', () => {
    const before = _activeReplayCount();
    scheduleReplay([{ at: 0, fn: () => {} }, { at: 50, fn: () => {} }]);
    expect(_activeReplayCount()).toBe(before + 1);
    vi.advanceTimersByTime(60);
    expect(_activeReplayCount()).toBe(before);
  });

  test('loop re-schedules the cycle', () => {
    let n = 0;
    const clock = scheduleReplay([{ at: 0, fn: () => n++ }, { at: 100, fn: () => {} }], { loop: true });
    vi.advanceTimersByTime(0);   expect(n).toBe(1);
    vi.advanceTimersByTime(250); expect(n).toBeGreaterThanOrEqual(2); // wrapped at least once
    clock.stop();
  });

  test('stop() cancels pending ops', () => {
    const fired = [];
    const clock = scheduleReplay([{ at: 0, fn: () => fired.push('a') }, { at: 100, fn: () => fired.push('b') }]);
    vi.advanceTimersByTime(0);
    clock.stop();
    vi.advanceTimersByTime(200);
    expect(fired).toEqual(['a']);
  });

  test('replayActions maps {t,...} actions through applyFn with offset', () => {
    const seen = [];
    replayActions(a => seen.push(a.v), [{ t: 0, v: 'x' }, { t: 100, v: 'y' }], { offset: 50 });
    vi.advanceTimersByTime(40); expect(seen).toEqual([]);
    vi.advanceTimersByTime(20); expect(seen).toEqual(['x']);   // 50ms
    vi.advanceTimersByTime(100); expect(seen).toEqual(['x', 'y']); // 150ms
  });

  test('reset stops active clocks', () => {
    scheduleReplay([{ at: 1000, fn: () => {} }], { loop: true });
    expect(_activeReplayCount()).toBeGreaterThan(0);
    runResetHandlers();   // global reset (no editor id)
    expect(_activeReplayCount()).toBe(0);
  });
});

describe('timeline()', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.runOnlyPendingTimers(); vi.useRealTimers(); });

  test('dispatches each track action to its widget _applyAction at offset', () => {
    const p  = fakeWidget('p');
    const dp = fakeWidget('dp');
    timeline()
      .track(p,  [{ t: 0, note: 'C4' }, { t: 100, note: 'E4' }], { at: 0 })
      .track(dp, [{ t: 0, vi: 0 }], { at: 200 })
      .play();
    vi.advanceTimersByTime(0);   expect(p.applied).toHaveLength(1);
    vi.advanceTimersByTime(100); expect(p.applied).toHaveLength(2);
    vi.advanceTimersByTime(100); expect(dp.applied).toHaveLength(1); // at:200
  });

  test('skips tracks whose target lacks _applyAction', () => {
    const bad = { _perfCtor() {} };
    const tl = timeline().track(bad, [{ t: 0 }]);
    expect(() => tl.play()).not.toThrow();
  });
});
