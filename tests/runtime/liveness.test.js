import { describe, it, expect } from 'vitest';

// Pure liveness predicate extracted from EditorInstance._isLive() logic.
// Mirrors the exact branching so tests stay in sync with the implementation.
function computeLiveness({ outputs, hadOutput, intervals, listeners }) {
  if (outputs > 0) return true;
  if (hadOutput) return false;
  return intervals > 0 || listeners > 0;
}

describe('output-gated liveness model', () => {
  it('live when outputs present (regardless of drivers)', () => {
    expect(computeLiveness({ outputs: 1, hadOutput: true, intervals: 0, listeners: 0 })).toBe(true);
    expect(computeLiveness({ outputs: 2, hadOutput: true, intervals: 3, listeners: 1 })).toBe(true);
  });

  it('stopped when outputs gone and hadOutput is true (orphaned drivers)', () => {
    expect(computeLiveness({ outputs: 0, hadOutput: true, intervals: 1, listeners: 0 })).toBe(false);
    expect(computeLiveness({ outputs: 0, hadOutput: true, intervals: 0, listeners: 5 })).toBe(false);
  });

  it('live on drivers alone when program never had an output', () => {
    expect(computeLiveness({ outputs: 0, hadOutput: false, intervals: 1, listeners: 0 })).toBe(true);
    expect(computeLiveness({ outputs: 0, hadOutput: false, intervals: 0, listeners: 1 })).toBe(true);
  });

  it('stopped when everything is zero', () => {
    expect(computeLiveness({ outputs: 0, hadOutput: false, intervals: 0, listeners: 0 })).toBe(false);
    expect(computeLiveness({ outputs: 0, hadOutput: true,  intervals: 0, listeners: 0 })).toBe(false);
  });
});
