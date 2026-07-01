import { describe, it, expect, vi } from 'vitest';
import { WidgetEvents } from '../../../../src/api/widgets/widget-events.js';

// jsdom does not implement requestAnimationFrame; stub it globally.
let _rafCbs = [];
global.requestAnimationFrame  = (fn) => { const id = _rafCbs.push(fn); return id; };
global.cancelAnimationFrame   = (id)  => { _rafCbs[id - 1] = null; };
function _flushRaf()           { const cbs = [..._rafCbs]; _rafCbs = []; cbs.forEach(fn => fn?.()); }

// ── on / emit ────────────────────────────────────────────────────────────────

describe('on + emit', () => {
  it('fires a registered listener', () => {
    const ev = new WidgetEvents();
    const calls = [];
    ev.on('stroke', p => calls.push(p));
    ev.emit('stroke', { tool: 'pen' });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ tool: 'pen' });
  });

  it('fires wildcard * listener for every event', () => {
    const ev = new WidgetEvents();
    const calls = [];
    ev.on('*', p => calls.push(p));
    ev.emit('stroke', { a: 1 });
    ev.emit('color',  { b: 2 });
    expect(calls).toHaveLength(2);
  });

  it('fires both specific and * listeners', () => {
    const ev = new WidgetEvents();
    const log = [];
    ev.on('stroke', () => log.push('specific'));
    ev.on('*',      () => log.push('wild'));
    ev.emit('stroke', {});
    expect(log).toEqual(['specific', 'wild']);
  });

  it('does not fire listener for different event', () => {
    const ev = new WidgetEvents();
    const calls = [];
    ev.on('color', () => calls.push(1));
    ev.emit('stroke', {});
    expect(calls).toHaveLength(0);
  });

  it('catches and logs errors in listeners without stopping others', () => {
    const ev = new WidgetEvents();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const results = [];
    ev.on('stroke', () => { throw new Error('boom'); });
    ev.on('stroke', () => results.push('ok'));
    ev.emit('stroke', {});
    expect(results).toEqual(['ok']);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('multiple on calls accumulate listeners', () => {
    const ev = new WidgetEvents();
    const calls = [];
    ev.on('hit', () => calls.push(1));
    ev.on('hit', () => calls.push(2));
    ev.emit('hit', {});
    expect(calls).toEqual([1, 2]);
  });
});

// ── signal — basic decay ──────────────────────────────────────────────────────

describe('signal — decay', () => {
  it('value is 0 before any emit', () => {
    const ev = new WidgetEvents();
    const sig = ev.signal('stroke', { decay: 300 });
    expect(sig.value).toBe(0);
  });

  it('value is 1 immediately after emit (frozen clock)', () => {
    const ev = new WidgetEvents();
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const sig = ev.signal('stroke', { decay: 300 });
    ev.emit('stroke', {});
    expect(sig.value).toBeCloseTo(1, 5);
    vi.restoreAllMocks();
  });

  it('value decays linearly to 0', () => {
    const ev = new WidgetEvents();
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const sig = ev.signal('stroke', { decay: 200 });
    ev.emit('stroke', {});
    now = 100;
    expect(sig.value).toBeCloseTo(0.5, 3);
    now = 200;
    expect(sig.value).toBe(0);
    now = 400;
    expect(sig.value).toBe(0);
    vi.restoreAllMocks();
  });

  it('velocity is an alias for value', () => {
    const ev = new WidgetEvents();
    const sig = ev.signal('stroke');
    expect(sig.velocity).toBe(sig.value);
  });

  it('wildcard event * fires on any emitted event', () => {
    const ev = new WidgetEvents();
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const sig = ev.signal('*', { decay: 100 });
    ev.emit('color', {});
    expect(sig.value).toBeCloseTo(1, 5);
    vi.restoreAllMocks();
  });

  it('first arg as opts object (no event string) → defaults to *', () => {
    const ev = new WidgetEvents();
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const sig = ev.signal({ decay: 100 });
    ev.emit('stroke', {});
    expect(sig.value).toBeCloseTo(1, 5);
    vi.restoreAllMocks();
  });

  it('signal ignores events it did not subscribe to', () => {
    const ev = new WidgetEvents();
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const sig = ev.signal('stroke', { decay: 100 });
    ev.emit('color', {}); // different event
    expect(sig.value).toBe(0);
    vi.restoreAllMocks();
  });
});

// ── signal — region scoping ───────────────────────────────────────────────────

describe('signal — region', () => {
  it('accepts point payload inside region', () => {
    const ev = new WidgetEvents();
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const sig = ev.signal('pixel', { decay: 100, region: { x: 10, y: 10, w: 20, h: 20 } });
    ev.emit('pixel', { x: 15, y: 15 });
    expect(sig.value).toBeCloseTo(1, 5);
    vi.restoreAllMocks();
  });

  it('rejects point payload outside region', () => {
    const ev = new WidgetEvents();
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const sig = ev.signal('pixel', { decay: 100, region: { x: 10, y: 10, w: 20, h: 20 } });
    ev.emit('pixel', { x: 50, y: 50 });
    expect(sig.value).toBe(0);
    vi.restoreAllMocks();
  });

  it('accepts bbox overlapping region', () => {
    const ev = new WidgetEvents();
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const sig = ev.signal('stroke', { decay: 100, region: { x: 0, y: 0, w: 50, h: 50 } });
    ev.emit('stroke', { bbox: { x: 40, y: 40, w: 20, h: 20 } }); // overlaps
    expect(sig.value).toBeCloseTo(1, 5);
    vi.restoreAllMocks();
  });

  it('rejects bbox entirely outside region', () => {
    const ev = new WidgetEvents();
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const sig = ev.signal('stroke', { decay: 100, region: { x: 0, y: 0, w: 50, h: 50 } });
    ev.emit('stroke', { bbox: { x: 60, y: 60, w: 20, h: 20 } });
    expect(sig.value).toBe(0);
    vi.restoreAllMocks();
  });

  it('supports cell coords (c/r) for ascii-style region', () => {
    const ev = new WidgetEvents();
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const sig = ev.signal('cell', { decay: 100, region: { x: 0, y: 0, w: 10, h: 5 } });
    ev.emit('cell', { c: 5, r: 3 });
    expect(sig.value).toBeCloseTo(1, 5);
    ev.emit('cell', { c: 15, r: 3 }); // outside
    // value still 1 right now (still fresh from previous emit at now=0)
    vi.restoreAllMocks();
  });
});

// ── signal — match predicate ──────────────────────────────────────────────────

describe('signal — match predicate', () => {
  it('accepts payload passing the match fn', () => {
    const ev = new WidgetEvents();
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const sig = ev.signal('hit', { decay: 100, match: e => e.vi === 0 });
    ev.emit('hit', { vi: 0 });
    expect(sig.value).toBeCloseTo(1, 5);
    vi.restoreAllMocks();
  });

  it('rejects payload not passing the match fn', () => {
    const ev = new WidgetEvents();
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const sig = ev.signal('hit', { decay: 100, match: e => e.vi === 0 });
    ev.emit('hit', { vi: 3 });
    expect(sig.value).toBe(0);
    vi.restoreAllMocks();
  });
});

// ── signal.on ────────────────────────────────────────────────────────────────

describe('signal.on', () => {
  it('registers a filtered listener accessible from the signal', () => {
    const ev = new WidgetEvents();
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const sig = ev.signal('stroke', { decay: 100, region: { x: 0, y: 0, w: 50, h: 50 } });
    const calls = [];
    sig.on(p => calls.push(p));
    ev.emit('stroke', { bbox: { x: 5, y: 5, w: 10, h: 10 } }); // inside
    ev.emit('stroke', { bbox: { x: 100, y: 100, w: 10, h: 10 } }); // outside
    expect(calls).toHaveLength(1);
    vi.restoreAllMocks();
  });
});

// ── signal.stream ─────────────────────────────────────────────────────────────

describe('signal.stream', () => {
  it('pushes signal to fn on each RAF frame', () => {
    const ev = new WidgetEvents();
    const vals = [];
    const sig = ev.signal('stroke', { decay: 100 });
    sig.stream(s => vals.push(s));
    _flushRaf(); // one frame
    expect(vals).toHaveLength(1);
    expect(vals[0]).toBe(sig);
  });
});

// ── clear ─────────────────────────────────────────────────────────────────────

describe('clear', () => {
  it('removes all hooks so emit no longer fires listeners', () => {
    const ev = new WidgetEvents();
    const calls = [];
    ev.on('stroke', () => calls.push(1));
    ev.clear();
    ev.emit('stroke', {});
    expect(calls).toHaveLength(0);
  });

  it('cancels RAF streams', () => {
    const ev = new WidgetEvents();
    let calls = 0;
    ev.signal('stroke').stream(() => calls++);
    ev.clear();
    _flushRaf();
    expect(calls).toBe(0); // cancelled before frame ran
  });

  it('hooks can be re-registered after clear', () => {
    const ev = new WidgetEvents();
    const calls = [];
    ev.on('stroke', () => calls.push(1));
    ev.clear();
    ev.on('stroke', () => calls.push(2));
    ev.emit('stroke', {});
    expect(calls).toEqual([2]);
  });
});
