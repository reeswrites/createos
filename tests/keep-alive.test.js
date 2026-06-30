import { describe, it, expect, afterEach } from 'vitest';
import { liveOutput, forEachLive, liveCount } from '../src/runtime/keep-alive.js';

afterEach(() => { delete window.__ar_keepAlive; });

describe('liveOutput', () => {
  it('adds the token to the active keepAlive set', () => {
    window.__ar_keepAlive = new Set();
    const token = {};
    liveOutput(token);
    expect(window.__ar_keepAlive.has(token)).toBe(true);
  });

  it('lazily creates the set if none exists', () => {
    const h = liveOutput({});
    expect(window.__ar_keepAlive).toBeInstanceOf(Set);
    expect(window.__ar_keepAlive.size).toBe(1);
    h.release();
  });

  it('release() removes the token; double release is a no-op', () => {
    window.__ar_keepAlive = new Set();
    const token = {};
    const h = liveOutput(token);
    h.release();
    expect(window.__ar_keepAlive.has(token)).toBe(false);
    expect(() => h.release()).not.toThrow();
  });

  it('release removes from the SAME set even after the active set is swapped', () => {
    // This is the bug the handle fixes: the old open-coded sites re-read
    // window.__ar_keepAlive on delete, so a stop after an editor switch deleted
    // from the wrong (new) set and leaked the output in the original.
    const editor1 = new Set();
    window.__ar_keepAlive = editor1;
    const token = {};
    const h = liveOutput(token);

    const editor2 = new Set();        // another editor runs → active set swapped
    window.__ar_keepAlive = editor2;

    h.release();
    expect(editor1.has(token)).toBe(false);   // cleaned from the original set
    expect(editor2.size).toBe(0);             // untouched
  });
});

// ── forEachLive / liveCount ───────────────────────────────────────────────────

describe('forEachLive', () => {
  it('iterates all live tokens', () => {
    window.__ar_keepAlive = new Set();
    const a = {}, b = {}, c = {};
    liveOutput(a); liveOutput(b); liveOutput(c);

    const seen = [];
    forEachLive(obj => seen.push(obj));
    expect(seen).toContain(a);
    expect(seen).toContain(b);
    expect(seen).toContain(c);
    expect(seen).toHaveLength(3);
  });

  it('is a no-op when no set exists', () => {
    delete window.__ar_keepAlive;
    expect(() => forEachLive(() => { throw new Error('should not call'); })).not.toThrow();
  });
});

describe('liveCount', () => {
  it('returns 0 when no set', () => {
    delete window.__ar_keepAlive;
    expect(liveCount()).toBe(0);
  });

  it('returns current Set size', () => {
    window.__ar_keepAlive = new Set();
    const h1 = liveOutput({});
    liveOutput({});
    expect(liveCount()).toBe(2);
    h1.release();
    expect(liveCount()).toBe(1);
  });
});
