import { describe, test, expect, afterEach, vi } from 'vitest';
import { roleOf, fmtVal } from '../../../../src/api/signal/route-inspector.js';
import { route } from '../../../../src/api/signal/route.js';

describe('roleOf (ADR 063 role classification)', () => {
  test('known transforms → transform', () => {
    for (const op of ['scale', 'clamp', 'norm', 'smooth', 'gate', 'threshold']) {
      expect(roleOf(op)).toBe('transform');
    }
  });
  test('mix → combinator', () => {
    expect(roleOf('mix')).toBe('combinator');
  });
  test('unknown op → opaque', () => {
    expect(roleOf('somethingCustom')).toBe('opaque');
  });
});

describe('fmtVal', () => {
  test('number rounds to 2 decimals', () => {
    expect(fmtVal(0.12345)).toBe('0.12');
    expect(fmtVal(50)).toBe('50');
  });
  test('undefined/null → dash; object → block; boolean', () => {
    expect(fmtVal(undefined)).toBe('–');
    expect(fmtVal(null)).toBe('–');
    expect(fmtVal({ a: 1 })).toBe('▮');
    expect(fmtVal(true)).toBe('true');
  });
});

describe('_eval instrumentation (records per-stage values when inspecting)', () => {
  test('records source, each stage, and output only while _inspecting', () => {
    const r = route(() => 0.5).scale(0, 1, 0, 100); // 0.5 → 50
    // Not inspecting: no recording.
    r._eval(0.5);
    expect(r._srcV).toBeUndefined();

    r._inspecting = true;
    const out = r._eval(0.5);
    expect(out).toBe(50);
    expect(r._srcV).toBe(0.5);
    expect(r._chain[0]._v).toBe(50); // the scale stage output
    expect(r._outV).toBe(50);
    expect(typeof r._chain[0]._at).toBe('number');
    r._destroy?.();
  });
});

describe('.watch() lifecycle', () => {
  afterEach(() => {
    delete window.wm;
  });

  test('is chainable and adds a no-op driver sink when the route has none', () => {
    window.wm = { spawn: vi.fn(() => null) }; // no window → openRouteInspector early-returns
    const r = route(() => 0.5).scale(0, 1, 0, 100);
    expect(r.watch('t')).toBe(r); // chainable
    expect(r._sinks.some((s) => s.label === 'inspect')).toBe(true);
    r._destroy?.();
  });

  test('not named `inspect` — the reserved name must not exist on routes', () => {
    const r = route(() => 0);
    expect(typeof r.inspect).toBe('undefined'); // guards the pretty-format recursion
    r._destroy?.();
  });
});
