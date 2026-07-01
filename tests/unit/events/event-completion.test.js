// event-completion.test.js — tests for the event name completion source.
// Verifies: cursor inside on()/any() returns SYSTEM_EVENTS + user emit() strings.
// Pattern borrowed from tests/param-hints.test.js.

import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';
import { eventCompletionSource } from '../../../src/editor/event-completion.js';
import { SYSTEM_EVENTS } from '../../../src/events/system-events.js';

function makeContext(code, cursorOffset) {
  const state = EditorState.create({
    doc: code,
    extensions: [javascript()],
    selection: { anchor: cursorOffset },
  });
  return {
    state,
    pos: cursorOffset,
    explicit: false,
    matchBefore(re) {
      const line = state.doc.lineAt(cursorOffset);
      const textBefore = line.text.slice(0, cursorOffset - line.from);
      const m = textBefore.match(re);
      return m ? { from: cursorOffset - m[0].length, to: cursorOffset, text: m[0] } : null;
    },
  };
}

describe('eventCompletionSource', () => {
  it('returns null when cursor is not inside on()', () => {
    const code = `const x = 1;`;
    const ctx = makeContext(code, 4);
    expect(eventCompletionSource(ctx)).toBeNull();
  });

  it('returns null when cursor is outside the string arg', () => {
    const code = `on('beat:tick').do(() => {})`;
    // cursor after the closing paren of on()
    const ctx = makeContext(code, code.indexOf(').do'));
    expect(eventCompletionSource(ctx)).toBeNull();
  });

  it('returns completion result when cursor inside on() string arg', () => {
    const code = `on('beat:tick')`;
    // cursor between the quotes: on('|beat:tick')
    const insideQuote = code.indexOf("'") + 1; // position after opening '
    const ctx = makeContext(code, insideQuote + 2); // midway through 'beat'
    const result = eventCompletionSource(ctx);
    expect(result).not.toBeNull();
    expect(result.from).toBe(insideQuote); // just after opening quote
    expect(result.options.length).toBeGreaterThan(0);
  });

  it('includes SYSTEM_EVENTS in completion options', () => {
    const code = `on('')`;
    const insideQuote = code.indexOf("'") + 1;
    const ctx = makeContext(code, insideQuote);
    const result = eventCompletionSource(ctx);
    expect(result).not.toBeNull();
    const labels = result.options.map(o => o.label);
    // Check a sample of known system events
    expect(labels).toContain('beat:tick');
    expect(labels).toContain('wm:spawn');
    expect(labels).toContain('audio:start');
    expect(labels).toContain('session:start');
  });

  it('SYSTEM_EVENTS have type=keyword', () => {
    const code = `on('')`;
    const insideQuote = code.indexOf("'") + 1;
    const result = eventCompletionSource(makeContext(code, insideQuote));
    const beatTick = result.options.find(o => o.label === 'beat:tick');
    expect(beatTick).toBeDefined();
    expect(beatTick.type).toBe('keyword');
  });

  it('includes user-defined events from emit() in same document', () => {
    const code = `emit('my-custom-event', { x: 1 });\non('')`;
    const onLine = code.lastIndexOf("on('')");
    const insideQuote = onLine + 4; // on('| ')
    const ctx = makeContext(code, insideQuote);
    const result = eventCompletionSource(ctx);
    expect(result).not.toBeNull();
    const labels = result.options.map(o => o.label);
    expect(labels).toContain('my-custom-event');
  });

  it('user-defined events have type=variable', () => {
    const code = `emit('user:thing', {});\non('')`;
    const onLine = code.lastIndexOf("on('')");
    const insideQuote = onLine + 4;
    const result = eventCompletionSource(makeContext(code, insideQuote));
    const userEvt = result.options.find(o => o.label === 'user:thing');
    expect(userEvt).toBeDefined();
    expect(userEvt.type).toBe('variable');
  });

  it('does not duplicate system events as user-defined', () => {
    // 'beat:tick' appears in emit() AND is a system event — should appear once as keyword
    const code = `emit('beat:tick', {});\non('')`;
    const insideQuote = code.lastIndexOf("on('") + 4;
    const result = eventCompletionSource(makeContext(code, insideQuote));
    const beatTickEntries = result.options.filter(o => o.label === 'beat:tick');
    expect(beatTickEntries).toHaveLength(1);
    expect(beatTickEntries[0].type).toBe('keyword');
  });

  it('works inside any() string arg', () => {
    const code = `any('beat:tick', 'wm:spawn')`;
    const insideFirstArg = code.indexOf("'") + 1; // inside 'beat:tick'
    const result = eventCompletionSource(makeContext(code, insideFirstArg + 2));
    expect(result).not.toBeNull();
    const labels = result.options.map(o => o.label);
    expect(labels).toContain('beat:tick');
  });

  it('validFor pattern is /:[w.-]*/', () => {
    const code = `on('')`;
    const insideQuote = code.indexOf("'") + 1;
    const result = eventCompletionSource(makeContext(code, insideQuote));
    expect(result.validFor).toBeTruthy();
    expect(result.validFor.test('beat')).toBe(true);
    expect(result.validFor.test('beat:tick')).toBe(true);
  });

  it('SYSTEM_EVENTS all present (catalog integrity)', () => {
    const code = `on('')`;
    const insideQuote = code.indexOf("'") + 1;
    const result = eventCompletionSource(makeContext(code, insideQuote));
    const labels = new Set(result.options.map(o => o.label));
    for (const evt of SYSTEM_EVENTS) {
      expect(labels.has(evt.name)).toBe(true);
    }
  });
});
