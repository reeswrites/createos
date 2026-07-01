// event-panel.test.js — tests for pure helpers in event-panel.js
// DOM-light: tests only the exported pure functions.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { matchesFilter, repr, makeRateState, applyRateLimit } from '../../../../src/api/wm/event-panel.js';

// ── matchesFilter ─────────────────────────────────────────────────────────────

describe('matchesFilter', () => {
  it('empty filter allows all', () => {
    expect(matchesFilter('beat:tick', '')).toBe(true);
    expect(matchesFilter('editor:change', '  ')).toBe(true);
  });

  it('exclude prefix drops matching events', () => {
    expect(matchesFilter('editor:change', '-editor:')).toBe(false);
    expect(matchesFilter('beat:tick', '-editor:')).toBe(true);
  });

  it('multiple excludes all apply', () => {
    const f = '-editor: -session: -wm:';
    expect(matchesFilter('editor:save', f)).toBe(false);
    expect(matchesFilter('session:reset', f)).toBe(false);
    expect(matchesFilter('wm:spawn', f)).toBe(false);
    expect(matchesFilter('beat:tick', f)).toBe(true);
    expect(matchesFilter('midi:note:on', f)).toBe(true);
  });

  it('positive include requires a match', () => {
    expect(matchesFilter('beat:tick', 'beat:')).toBe(true);
    expect(matchesFilter('midi:note:on', 'beat:')).toBe(false);
  });

  it('mixed include+exclude: include first, exclude also applies', () => {
    expect(matchesFilter('beat:tick', 'beat: -beat:bar')).toBe(true);
    expect(matchesFilter('beat:bar', 'beat: -beat:bar')).toBe(false);
  });
});

// ── repr ──────────────────────────────────────────────────────────────────────

describe('repr', () => {
  it('renders numbers', () => { expect(repr(42)).toBe('42'); });
  it('renders null', () => { expect(repr(null)).toBe('null'); });
  it('renders undefined', () => { expect(repr(undefined)).toBe('undefined'); });
  it('renders booleans', () => { expect(repr(true)).toBe('true'); });
  it('renders strings quoted', () => { expect(repr('hi')).toBe('"hi"'); });

  it('renders shallow array', () => {
    expect(repr([1, 2, 3])).toBe('[1, 2, 3]');
  });

  it('truncates arrays >5 items', () => {
    const result = repr([1, 2, 3, 4, 5, 6]);
    expect(result).toContain('…');
    expect(result).not.toContain('6');
  });

  it('renders shallow object', () => {
    const result = repr({ a: 1, b: 'x' });
    expect(result).toContain('a: 1');
    expect(result).toContain('b: "x"');
  });

  it('stops at depth 2 for nested objects', () => {
    const result = repr({ a: { b: { c: 1 } } });
    expect(result).toContain('{…}');
  });

  it('stops at depth 2 for deeply nested arrays', () => {
    const result = repr([[[1, 2]]]);
    expect(result).toContain('[…');
  });
});

// ── applyRateLimit ────────────────────────────────────────────────────────────

describe('applyRateLimit', () => {
  let rateMap, container, rows;

  function makeContainer() {
    container = { children: [], firstChild: null, lastChild: null, insertBefore: vi.fn(), removeChild: vi.fn() };
    rows = [];
    container.insertBefore.mockImplementation((el) => {
      rows.unshift(el);
      container.children = rows;
      container.firstChild = rows[0] ?? null;
      container.lastChild = rows[rows.length - 1] ?? null;
    });
    container.removeChild.mockImplementation((el) => {
      rows = rows.filter(r => r !== el);
      container.children = rows;
      container.firstChild = rows[0] ?? null;
      container.lastChild = rows[rows.length - 1] ?? null;
    });
  }

  function makeRow(event, data) {
    const badgeEl = { textContent: '' };
    const payloadEl = { textContent: repr(data) };
    const rowEl = { _event: event };
    return { rowEl, badgeEl, payloadEl };
  }

  beforeEach(() => {
    rateMap = makeRateState();
    makeContainer();
  });

  it('first fire creates a new row', () => {
    applyRateLimit(rateMap, 'beat:tick', { bar: 1 }, container, 80, makeRow);
    expect(container.insertBefore).toHaveBeenCalledTimes(1);
    expect(rateMap.has('beat:tick')).toBe(true);
  });

  it('second fire within 200ms increments counter, no new row', () => {
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    applyRateLimit(rateMap, 'beat:tick', {}, container, 80, makeRow);
    vi.spyOn(Date, 'now').mockReturnValue(now + 100);
    applyRateLimit(rateMap, 'beat:tick', {}, container, 80, makeRow);
    expect(container.insertBefore).toHaveBeenCalledTimes(1);
    expect(rateMap.get('beat:tick').count).toBe(2);
    vi.restoreAllMocks();
  });

  it('fire after 200ms creates a new row', () => {
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    applyRateLimit(rateMap, 'beat:tick', {}, container, 80, makeRow);
    vi.spyOn(Date, 'now').mockReturnValue(now + 300);
    applyRateLimit(rateMap, 'beat:tick', {}, container, 80, makeRow);
    expect(container.insertBefore).toHaveBeenCalledTimes(2);
    vi.restoreAllMocks();
  });

  it('caps rows at maxRows', () => {
    for (let i = 0; i < 5; i++) {
      // Each is a distinct event name so all get new rows
      applyRateLimit(rateMap, `evt:${i}`, {}, container, 3, makeRow);
    }
    expect(container.removeChild).toHaveBeenCalled();
    expect(rows.length).toBeLessThanOrEqual(3);
  });
});
