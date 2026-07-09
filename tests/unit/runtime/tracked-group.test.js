import { describe, it, expect, beforeEach } from 'vitest';
import { trackedGroup } from '../../../src/runtime/tracked-group.js';
import { runResetHandlers } from '../../../src/runtime/reset-registry.js';

// Each trackedGroup() registers its own global onReset. Reset context between tests.
beforeEach(() => {
  window.__ar_active_editor_id = undefined;
});

describe('trackedGroup — add / remove / iterate', () => {
  it('add() returns the item and tracks it; forEach visits live items', () => {
    const g = trackedGroup({ teardown() {} });
    const a = { id: 'a' };
    expect(g.add(a)).toBe(a);
    g.add({ id: 'b' });
    const seen = [];
    g.forEach((x) => seen.push(x.id));
    expect(seen.sort()).toEqual(['a', 'b']);
    expect(g.size).toBe(2);
  });

  it('add() is Set-backed → idempotent (adding the same item twice is one entry)', () => {
    const g = trackedGroup({ teardown() {} });
    const a = { id: 'a' };
    g.add(a);
    g.add(a);
    expect(g.size).toBe(1);
    expect(g.has(a)).toBe(true);
  });

  it('remove() drops an item without running teardown', () => {
    let torn = 0;
    const g = trackedGroup({ teardown: () => torn++ });
    const a = {};
    g.add(a);
    g.remove(a);
    expect(g.size).toBe(0);
    expect(torn).toBe(0); // remove is self-removal, not teardown
  });
});

describe('trackedGroup — reset teardown', () => {
  it('a reset tears down every tracked item (default: global)', () => {
    const torn = [];
    const g = trackedGroup({ teardown: (x) => torn.push(x.id) });
    g.add({ id: 'a' });
    g.add({ id: 'b' });
    runResetHandlers(); // no editor context → global teardown
    expect(torn.sort()).toEqual(['a', 'b']);
    expect(g.size).toBe(0);
  });

  it('default (no owner) tears down on ANY editor reset', () => {
    let torn = 0;
    const g = trackedGroup({ teardown: () => torn++ });
    g.add({});
    runResetHandlers(42); // unrelated editor id still tears down (global)
    expect(torn).toBe(1);
  });

  it('teardownAll() disposes everything now, ignoring owner', () => {
    const torn = [];
    const g = trackedGroup({ teardown: (x) => torn.push(x.id), owner: true });
    window.__ar_active_editor_id = 1;
    g.add({ id: 'a' });
    window.__ar_active_editor_id = 2;
    g.add({ id: 'b' });
    g.teardownAll();
    expect(torn.sort()).toEqual(['a', 'b']);
    expect(g.size).toBe(0);
  });
});

describe('trackedGroup — idempotency', () => {
  it('teardown runs exactly once per item across reset + teardownAll', () => {
    const counts = new Map();
    const g = trackedGroup({
      teardown: (x) => counts.set(x, (counts.get(x) ?? 0) + 1),
    });
    const a = {};
    g.add(a);
    runResetHandlers();
    runResetHandlers();
    g.teardownAll();
    expect(counts.get(a)).toBe(1);
  });

  it('a teardown that self-removes (re-enters remove) does not double-run', () => {
    let torn = 0;
    let g;
    const a = {};
    g = trackedGroup({
      teardown: (x) => {
        torn++;
        g.remove(x); // simulate an item that removes itself during teardown
      },
    });
    g.add(a);
    runResetHandlers();
    expect(torn).toBe(1);
    expect(g.size).toBe(0);
  });

  it('a throwing teardown does not abort the loop or leave the item tracked', () => {
    const g = trackedGroup({
      teardown: (x) => {
        if (x.bad) throw new Error('boom');
      },
    });
    g.add({ bad: true });
    const good = { bad: false };
    g.add(good);
    expect(() => runResetHandlers()).not.toThrow();
    expect(g.size).toBe(0); // both removed despite one throwing
  });
});

describe('trackedGroup — owner scoping', () => {
  it('resetting editor B leaves editor A items; resetting A tears them down', () => {
    const torn = [];
    const g = trackedGroup({ teardown: (x) => torn.push(x.id), owner: true });
    window.__ar_active_editor_id = 1;
    g.add({ id: 'a' });
    window.__ar_active_editor_id = 2;
    g.add({ id: 'b' });

    runResetHandlers(2);
    expect(torn).toEqual(['b']); // only B's owner matched
    expect(g.size).toBe(1); // A survives

    runResetHandlers(1);
    expect(torn).toEqual(['b', 'a']);
    expect(g.size).toBe(0);
  });

  it('owner-scoped item with null owner (no editor context) is torn down by any reset', () => {
    const torn = [];
    const g = trackedGroup({ teardown: (x) => torn.push(x.id), owner: true });
    window.__ar_active_editor_id = undefined;
    g.add({ id: 'x' });
    runResetHandlers(99); // unrelated id, but null-owner item is global
    expect(torn).toEqual(['x']);
  });

  it('editorId == null reset disposes owner-scoped items regardless of owner', () => {
    const torn = [];
    const g = trackedGroup({ teardown: (x) => torn.push(x.id), owner: true });
    window.__ar_active_editor_id = 5;
    g.add({ id: 'a' });
    runResetHandlers(); // null editorId → full global teardown
    expect(torn).toEqual(['a']);
  });
});
