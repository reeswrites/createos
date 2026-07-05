import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WidgetHistory } from '../../../../src/api/widgets/widget-history.js';

// WidgetHistory tests — no DOM needed (pure JS)

describe('WidgetHistory', () => {
  let state;
  let hist;
  let onChange;

  beforeEach(() => {
    vi.useFakeTimers();
    state = { val: 0 };
    onChange = vi.fn();
    hist = new WidgetHistory({
      capture: () => ({ val: state.val }),
      restore: (snap) => {
        state.val = snap.val;
      },
      debounce: 100,
      max: 5,
      onChange,
    });
  });

  it('starts with no undo/redo', () => {
    expect(hist.canUndo()).toBe(false);
    expect(hist.canRedo()).toBe(false);
  });

  it('commit + advance timer → canUndo becomes true', () => {
    state.val = 1;
    hist.commit();
    vi.advanceTimersByTime(200);
    expect(hist.canUndo()).toBe(true);
    expect(hist.canRedo()).toBe(false);
  });

  it('undo restores previous state', () => {
    state.val = 1;
    hist.commit();
    vi.advanceTimersByTime(200);
    state.val = 2;
    hist.commit();
    vi.advanceTimersByTime(200);

    expect(state.val).toBe(2);
    hist.undo();
    expect(state.val).toBe(1);
  });

  it('redo re-applies undone change', () => {
    state.val = 1;
    hist.commit();
    vi.advanceTimersByTime(200);

    hist.undo();
    expect(state.val).toBe(0);
    expect(hist.canRedo()).toBe(true);

    hist.redo();
    expect(state.val).toBe(1);
  });

  it('new commit clears redo stack', () => {
    state.val = 1;
    hist.commit();
    vi.advanceTimersByTime(200);

    hist.undo();
    expect(hist.canRedo()).toBe(true);

    state.val = 99;
    hist.commit();
    vi.advanceTimersByTime(200);
    expect(hist.canRedo()).toBe(false);
  });

  it('rapid commits collapse into one undo step (debounce)', () => {
    // Three rapid mutations — should produce only ONE undo step
    state.val = 1;
    hist.commit();
    state.val = 2;
    hist.commit();
    state.val = 3;
    hist.commit();
    vi.advanceTimersByTime(200);

    expect(hist.canUndo()).toBe(true);
    hist.undo();
    expect(state.val).toBe(0); // back to pre-burst
    expect(hist.canUndo()).toBe(false);
  });

  it('respects max stack size', () => {
    for (let i = 1; i <= 8; i++) {
      state.val = i;
      hist.commit();
      vi.advanceTimersByTime(200);
    }
    // max=5, so only 5 undo steps should remain
    let count = 0;
    while (hist.canUndo()) {
      hist.undo();
      count++;
    }
    expect(count).toBe(5);
  });

  it('canUndo/canRedo false on empty stacks', () => {
    expect(hist.canUndo()).toBe(false);
    expect(hist.canRedo()).toBe(false);
    hist.undo(); // no-op
    hist.redo(); // no-op
    expect(state.val).toBe(0);
  });

  it('calls onChange after commit timer fires', () => {
    state.val = 1;
    hist.commit();
    expect(onChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('calls onChange after undo and redo', () => {
    state.val = 1;
    hist.commit();
    vi.advanceTimersByTime(200);
    onChange.mockClear();

    hist.undo();
    expect(onChange).toHaveBeenCalledTimes(1);
    hist.redo();
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('restoring flag is true during restore, false after', () => {
    let flagDuringRestore = null;
    const hist2 = new WidgetHistory({
      capture: () => ({ val: state.val }),
      restore: (snap) => {
        flagDuringRestore = hist2.restoring;
        state.val = snap.val;
      },
      debounce: 100,
    });
    state.val = 1;
    hist2.commit();
    vi.advanceTimersByTime(200);
    hist2.undo();
    expect(flagDuringRestore).toBe(true);
    expect(hist2.restoring).toBe(false);
  });

  it('commit() is ignored when restoring is true', () => {
    const hist2 = new WidgetHistory({
      capture: () => ({ val: state.val }),
      restore: (snap) => {
        state.val = snap.val;
        hist2.commit(); // re-entrant call — should be ignored
      },
      debounce: 100,
    });
    state.val = 1;
    hist2.commit();
    vi.advanceTimersByTime(200);

    hist2.undo(); // triggers restore which tries to commit
    vi.advanceTimersByTime(200);
    // undo stack should still be empty after the restore
    expect(hist2.canUndo()).toBe(false);
  });

  it('undo with canUndo=false is a no-op, does not crash', () => {
    // No commits yet — calling undo should be a safe no-op
    hist.undo();
    expect(state.val).toBe(0);
    expect(hist.canUndo()).toBe(false);
    expect(hist.canRedo()).toBe(false);
  });

  it('undo cancels a pending commit timer', () => {
    state.val = 1;
    hist.commit();
    vi.advanceTimersByTime(200); // first commit fires: undo=[{val:0}], _current={val:1}

    state.val = 2;
    hist.commit(); // second commit pending (not yet fired), snap={val:1}

    hist.undo(); // cancels second commit; pops first snap ({val:0}); restores state.val=0
    vi.advanceTimersByTime(200); // second commit timer was cancelled — no extra step

    expect(state.val).toBe(0); // restored to pre-first-commit state
    expect(hist.canUndo()).toBe(false); // undo stack exhausted
    expect(hist.canRedo()).toBe(true); // {val:2} was pushed to redo on undo
  });

  it('multi-step undo/redo round-trip', () => {
    for (let i = 1; i <= 3; i++) {
      state.val = i;
      hist.commit();
      vi.advanceTimersByTime(200);
    }
    hist.undo(); // 3→2
    hist.undo(); // 2→1
    expect(state.val).toBe(1);
    hist.redo(); // 1→2
    expect(state.val).toBe(2);
    hist.redo(); // 2→3
    expect(state.val).toBe(3);
    expect(hist.canRedo()).toBe(false);
  });
});
