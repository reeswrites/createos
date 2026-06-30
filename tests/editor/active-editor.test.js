import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getActiveInstance, insertSnippet } from '../../src/editor/active-editor.js';

// The single seam for inserting generated code into the active editor.
// Replaces ad-hoc window.__ar_instances pokes in the four creative widgets.

function fakeInstance() {
  const calls = [];
  return {
    cm: {
      state: { doc: { length: 10 } },
      dispatch: (tx) => calls.push(tx),
      focus: vi.fn(),
    },
    _dispatched: calls,
  };
}

describe('active-editor seam', () => {
  beforeEach(() => {
    window.__ar_active_editor_id = 1;
    window.__ar_instances = new Map();
  });
  afterEach(() => {
    delete window.__ar_active_editor_id;
    delete window.__ar_instances;
  });

  it('getActiveInstance returns the instance for the active id', () => {
    const inst = fakeInstance();
    window.__ar_instances.set(1, inst);
    expect(getActiveInstance()).toBe(inst);
  });

  it('getActiveInstance returns null when no active id', () => {
    delete window.__ar_active_editor_id;
    expect(getActiveInstance()).toBe(null);
  });

  it('insertSnippet appends padded code, sets selection at code end, focuses', () => {
    const inst = fakeInstance();
    window.__ar_instances.set(1, inst);

    const ok = insertSnippet('draw.rect(0,0,1,1)');
    expect(ok).toBe(true);

    const tx = inst._dispatched[0];
    expect(tx.changes).toEqual({ from: 10, to: 10, insert: '\ndraw.rect(0,0,1,1)\n' });
    expect(tx.selection).toEqual({ anchor: 10 + 'draw.rect(0,0,1,1)'.length + 2 });
    expect(inst.cm.focus).toHaveBeenCalled();
  });

  it('falls back to clipboard and returns false when no editor', () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText } });

    const ok = insertSnippet('foo()');
    expect(ok).toBe(false);
    expect(writeText).toHaveBeenCalledWith('foo()');
  });

  it('uses Map.get (not Array.find) — guards the old Drumpad bug', () => {
    // __ar_instances is a Map; the pre-seam Drumpad used .find(), which a Map
    // does not have. This test would throw if the seam regressed to .find().
    const inst = fakeInstance();
    window.__ar_instances.set(1, inst);
    expect(() => insertSnippet('x()')).not.toThrow();
    expect(inst._dispatched.length).toBe(1);
  });
});
