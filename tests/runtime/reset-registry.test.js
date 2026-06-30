import { describe, it, expect, vi } from 'vitest';
import { onReset, runResetHandlers, _resetHandlerCount } from '../../src/runtime/reset-registry.js';

// The registry is module-singleton state; these tests register their own
// handlers and assert behaviour relative to the starting count.

describe('reset-registry', () => {
  it('runs every registered handler', () => {
    const a = vi.fn(), b = vi.fn();
    onReset(a); onReset(b);
    runResetHandlers();
    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
  });

  it('does not register the same function twice', () => {
    const before = _resetHandlerCount();
    const fn = () => {};
    onReset(fn); onReset(fn); onReset(fn);
    expect(_resetHandlerCount()).toBe(before + 1);
  });

  it('ignores non-functions', () => {
    const before = _resetHandlerCount();
    onReset(null); onReset(undefined); onReset(42);
    expect(_resetHandlerCount()).toBe(before);
  });

  it('a throwing handler does not abort the rest', () => {
    const after = vi.fn();
    onReset(() => { throw new Error('boom'); });
    onReset(after);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => runResetHandlers()).not.toThrow();
    expect(after).toHaveBeenCalled();
    spy.mockRestore();
  });
});
