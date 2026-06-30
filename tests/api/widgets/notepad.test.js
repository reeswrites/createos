// notepad.test.js — unit tests for Notepad widget (src/api/widgets/notepad.js).
// Runs in jsdom. Mocks: window.wm, window.desktop, document.execCommand.
//
// Coverage:
//   - Widget construction → .np-edit element + .np-toolbar
//   - note.text / note.html getters
//   - note.set() / note.clear()
//   - Flat offset model: _offsetToDOM + _domToOffset
//   - note.insert / note.delete / note.replace
//   - note.cursor / note.select
//   - note.type() / note.backspace() — fake timers, Promise resolves
//   - Formatting methods call document.execCommand with right command
//   - Bus events: note:char, note:done, note:change, note:type fire with winId
//   - cleanupNotepads() stops in-flight type() timers (window survives)
//   - getState() returns { title, content, _desktopIconId }
//   - SYSTEM_EVENTS includes all six note:* events

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Setup minimal jsdom globals ───────────────────────────────────────────────

let winIdSeq = 0;

function makeWmMock() {
  const windows = {};
  return {
    spawn(title, { w = 380, h = 300, x, y } = {}) {
      const id = `win-note-${++winIdSeq}`;
      const win = document.createElement('div');
      win.id = id;
      const body = document.createElement('div');
      body.className = 'wm-body';
      body.style.display = 'flex';
      body.style.flexDirection = 'column';
      win.appendChild(body);
      document.body.appendChild(win);
      win._wmCleanup = null;
      win._widgetType = null;
      win._widgetState = null;
      win._x = x ?? 100; win._y = y ?? 100; win._w = w; win._h = h;
      windows[id] = win;
      return id;
    },
    close(id) {
      const win = windows[id];
      if (win) {
        win._wmCleanup?.();
        win.remove();
        delete windows[id];
      }
    },
    show(_id) {},
    addHistoryControls() {},
    getWindows: () => windows,
  };
}

function makeDesktopMock() {
  let iconSeq = 0;
  return {
    add: vi.fn(() => ({ id: `icon-${++iconSeq}` })),
    updateUrl: vi.fn(),
  };
}

// Import the module under test — needs mocks in place first
let Notepad, cleanupNotepads;
let subscribe;

beforeEach(async () => {
  // Fresh mocks per test
  window.wm      = makeWmMock();
  window.desktop = makeDesktopMock();

  // Mock execCommand so formatting tests can assert on it
  document.execCommand = vi.fn(() => true);

  // Reset getSelection stub
  const mockSel = { rangeCount: 0, ranges: [], removeAllRanges() { this.ranges = []; this.rangeCount = 0; }, addRange(r) { this.ranges.push(r); this.rangeCount = this.ranges.length; }, getRangeAt(i) { return this.ranges[i]; }, isCollapsed: true };
  window.getSelection = vi.fn(() => mockSel);

  vi.useFakeTimers();

  // Re-import fresh copies to avoid cross-test state pollution
  vi.resetModules();
  ({ Notepad, cleanupNotepads } = await import('../../../src/api/widgets/notepad.js'));
  ({ subscribe } = await import('../../../src/events/bus.js'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  // Clean up any DOM windows added
  document.body.innerHTML = '';
});

// ── Construction ───────────────────────────────────────────────────────────────

describe('Notepad construction', () => {
  it('mounts a .np-edit contenteditable div', () => {
    const note = new Notepad({ title: 'Test' });
    expect(note._el).not.toBeNull();
    expect(note._el.className).toBe('np-edit');
    expect(note._el.contentEditable).toBe('true');
  });

  it('mounts a .np-toolbar', () => {
    const note = new Notepad({ title: 'Test' });
    const body = document.getElementById(note._winId)?.querySelector('.wm-body');
    const toolbar = body?.querySelector('.np-toolbar');
    expect(toolbar).not.toBeNull();
  });

  it('assigns a winId from wm.spawn', () => {
    const note = new Notepad({ title: 'Test' });
    expect(typeof note._winId).toBe('string');
    expect(note._winId).toMatch(/^win-note-/);
  });

  it('calls autoSave on first spawn (no existingIconId)', () => {
    new Notepad({ title: 'Test' });
    vi.runAllTimers();
    expect(window.desktop.add).toHaveBeenCalled();
  });

  it('does not create new icon when _desktopIconId provided', () => {
    new Notepad({ title: 'Test', _desktopIconId: 'icon-99' });
    vi.runAllTimers();
    expect(window.desktop.add).not.toHaveBeenCalled();
  });

  it('sets initial content from opts.content (plain text)', () => {
    const note = new Notepad({ title: 'Test', content: 'hello world' });
    expect(note.text).toBe('hello world');
  });

  it('sets initial content from opts.content (HTML)', () => {
    const note = new Notepad({ title: 'Test', content: '<b>bold</b>' });
    expect(note._el.innerHTML).toContain('bold');
  });
});

// ── Text / html getters ────────────────────────────────────────────────────────

describe('note.text and note.html', () => {
  it('note.text returns plain textContent', () => {
    const note = new Notepad();
    note._el.textContent = 'hello';
    expect(note.text).toBe('hello');
  });

  it('note.html returns sanitized innerHTML', () => {
    const note = new Notepad();
    note._el.innerHTML = '<b>bold</b><script>evil()</script>';
    // script tag should be stripped by _sanitize
    expect(note.html).not.toContain('script');
    expect(note.html).toContain('bold');
  });
});

// ── set / clear ────────────────────────────────────────────────────────────────

describe('note.set / note.clear', () => {
  it('set plain text', () => {
    const note = new Notepad();
    note.set('hello world');
    expect(note.text).toBe('hello world');
  });

  it('set HTML string sets innerHTML (sanitized)', () => {
    const note = new Notepad();
    note.set('<b>bold text</b>');
    expect(note._el.innerHTML).toContain('bold');
  });

  it('clear empties the editor', () => {
    const note = new Notepad();
    note.set('some content');
    note.clear();
    expect(note.text).toBe('');
    expect(note._el.innerHTML).toBe('');
  });

  it('clear calls autoSave', () => {
    const note = new Notepad();
    note._autoSave = vi.fn();
    note.clear();
    expect(note._autoSave).toHaveBeenCalled();
  });
});

// ── Flat offset model ─────────────────────────────────────────────────────────

describe('flat offset model — insert / delete / cursor / select', () => {
  it('insert appends text at offset 0', () => {
    const note = new Notepad();
    note._el.textContent = 'world';
    note.insert('hello ', 0);
    expect(note.text).toBe('hello world');
  });

  it('insert at end', () => {
    const note = new Notepad();
    note._el.textContent = 'hello';
    note.insert(' world', 5);
    expect(note.text).toBe('hello world');
  });

  it('insert in middle', () => {
    const note = new Notepad();
    note._el.textContent = 'helo';
    note.insert('l', 3);
    expect(note.text).toBe('hello');
  });

  it('delete removes range', () => {
    const note = new Notepad();
    note._el.textContent = 'hello world';
    note.delete(5, 11);
    expect(note.text).toBe('hello');
  });

  it('replace replaces range with new text', () => {
    const note = new Notepad();
    note._el.textContent = 'hello world';
    note.replace(6, 11, 'earth');
    expect(note.text).toBe('hello earth');
  });

  it('cursor sets a DOM range at flat offset', () => {
    const note = new Notepad();
    note._el.textContent = 'hello';
    // Should not throw, and selection mock should receive addRange
    expect(() => note.cursor(2)).not.toThrow();
    const sel = window.getSelection();
    // addRange was called (mock tracks it)
    expect(sel.ranges.length).toBeGreaterThanOrEqual(1);
  });

  it('select sets DOM range from to to', () => {
    const note = new Notepad();
    note._el.textContent = 'hello';
    expect(() => note.select(1, 4)).not.toThrow();
    const sel = window.getSelection();
    expect(sel.ranges.length).toBeGreaterThanOrEqual(1);
  });

  it('insert calls autoSave', () => {
    const note = new Notepad();
    note._autoSave = vi.fn();
    note._el.textContent = 'hi';
    note.insert(' there', 2);
    expect(note._autoSave).toHaveBeenCalled();
  });
});

// ── Formatting ────────────────────────────────────────────────────────────────

describe('formatting — bold / italic / underline / color / highlight', () => {
  it('note.bold() calls execCommand("bold")', () => {
    const note = new Notepad();
    note.bold();
    expect(document.execCommand).toHaveBeenCalledWith('bold', false, null);
  });

  it('note.italic() calls execCommand("italic")', () => {
    const note = new Notepad();
    note.italic();
    expect(document.execCommand).toHaveBeenCalledWith('italic', false, null);
  });

  it('note.underline() calls execCommand("underline")', () => {
    const note = new Notepad();
    note.underline();
    expect(document.execCommand).toHaveBeenCalledWith('underline', false, null);
  });

  it('note.color(col) calls execCommand("foreColor", false, col)', () => {
    const note = new Notepad();
    note.color('#ff0000');
    expect(document.execCommand).toHaveBeenCalledWith('foreColor', false, '#ff0000');
  });

  it('note.highlight(col) calls execCommand("hiliteColor", false, col)', () => {
    const note = new Notepad();
    note.highlight('#ffff00');
    expect(document.execCommand).toHaveBeenCalledWith('hiliteColor', false, '#ffff00');
  });

  it('note.bold(from, to) sets selection before execCommand', () => {
    const note = new Notepad();
    note._el.textContent = 'hello';
    note.bold(0, 5);
    const sel = window.getSelection();
    expect(sel.ranges.length).toBeGreaterThanOrEqual(1);
    expect(document.execCommand).toHaveBeenCalledWith('bold', false, null);
  });
});

// ── Typing animation ───────────────────────────────────────────────────────────

describe('note.type() animation', () => {
  it('inserts characters one at a time and resolves', async () => {
    const note = new Notepad();
    const text = 'hi';
    const p = note.type(text, { cps: 100 });
    // Each char fires after ms = max(16, round(1000/100)) = 16ms
    vi.advanceTimersByTime(16);
    expect(note.text).toBe('h');
    vi.advanceTimersByTime(16);
    expect(note.text).toBe('hi');
    vi.advanceTimersByTime(16); // final tick → resolve
    await p;
    expect(note.text).toBe('hi');
  });

  it('fires note:char for each character', async () => {
    const note = new Notepad();
    const chars = [];
    const unsub = subscribe('note:char', (d) => chars.push(d));
    const p = note.type('ab', { cps: 100 });
    vi.advanceTimersByTime(32); // 2 chars
    vi.advanceTimersByTime(16); // resolve tick
    await p;
    unsub();
    expect(chars.map(d => d.char)).toEqual(['a', 'b']);
    expect(chars[0].winId).toBe(note._winId);
    expect(chars[0].index).toBe(0);
    expect(chars[1].index).toBe(1);
  });

  it('fires note:done after all chars', async () => {
    const note = new Notepad();
    const done = vi.fn();
    const unsub = subscribe('note:done', done);
    const p = note.type('x', { cps: 100 });
    vi.advanceTimersByTime(32);
    await p;
    unsub();
    expect(done).toHaveBeenCalledTimes(1);
    expect(done.mock.calls[0][0].winId).toBe(note._winId);
  });

  it('fires note:type at start', () => {
    const note = new Notepad();
    const typeEvt = vi.fn();
    const unsub = subscribe('note:type', typeEvt);
    note.type('x', { cps: 100 });
    unsub();
    expect(typeEvt).toHaveBeenCalledWith(expect.objectContaining({ winId: note._winId, text: 'x' }));
  });

  it('returns a Promise that resolves when done', async () => {
    const note = new Notepad();
    const p = note.type('abc', { cps: 100 });
    expect(p).toBeInstanceOf(Promise);
    vi.advanceTimersByTime(64);
    await expect(p).resolves.toBeUndefined();
  });
});

// ── Backspace animation ────────────────────────────────────────────────────────

describe('note.backspace() animation', () => {
  it('deletes characters one at a time', async () => {
    const note = new Notepad();
    note._el.textContent = 'hi';
    // Provide a mock _caretPos that decrements from 2 → 1 → 0 as deletions occur
    let caretVal = 2;
    note._caretPos = vi.fn(() => caretVal > 0 ? caretVal-- : 0);

    const p = note.backspace(2, { cps: 100 });
    vi.advanceTimersByTime(16); // delete char at pos 2-1=1 ('i')
    vi.advanceTimersByTime(16); // delete char at pos 1-1=0 ('h')
    vi.advanceTimersByTime(16); // final tick → resolve
    await p;
    expect(note.text).toBe('');
  });

  it('fires note:char with char=backspace', async () => {
    const note = new Notepad();
    note._el.textContent = 'a';
    note._caretPos = vi.fn().mockReturnValue(1);
    const chars = [];
    const unsub = subscribe('note:char', (d) => chars.push(d));
    const p = note.backspace(1, { cps: 100 });
    vi.advanceTimersByTime(32);
    await p;
    unsub();
    expect(chars[0].char).toBe('\b');
  });
});

// ── Bus events ─────────────────────────────────────────────────────────────────

describe('note:change bus event', () => {
  it('fires after input event on editor', async () => {
    const note = new Notepad();
    const changed = vi.fn();
    const unsub = subscribe('note:change', changed);
    // Simulate user typing (trigger input event)
    note._el.textContent = 'typed';
    note._el.dispatchEvent(new Event('input', { bubbles: true }));
    vi.advanceTimersByTime(200); // let the 150ms debounce fire
    unsub();
    expect(changed).toHaveBeenCalledWith(expect.objectContaining({ winId: note._winId }));
  });

  it('includes winId in payload', async () => {
    const note = new Notepad();
    const changed = vi.fn();
    const unsub = subscribe('note:change', changed);
    note._el.textContent = 'hello';
    note._el.dispatchEvent(new Event('input'));
    vi.advanceTimersByTime(200);
    unsub();
    const call = changed.mock.calls[0]?.[0];
    expect(call?.winId).toBe(note._winId);
    expect(typeof call?.text).toBe('string');
  });
});

// ── Scoped events ──────────────────────────────────────────────────────────────

describe('scoped wm:{winId}:note:* events', () => {
  it('type() fires scoped note:char event', async () => {
    const note = new Notepad();
    const scopedChars = vi.fn();
    const unsub = subscribe(`wm:${note._winId}:note:char`, scopedChars);
    const p = note.type('a', { cps: 100 });
    vi.advanceTimersByTime(32);
    await p;
    unsub();
    expect(scopedChars).toHaveBeenCalled();
  });
});

// ── Reset / cleanup ───────────────────────────────────────────────────────────

describe('cleanupNotepads() — reset behavior', () => {
  it('stops in-flight type() — timer set cleared', async () => {
    const note = new Notepad();
    note.type('hello world', { cps: 1 }); // very slow — won't finish
    expect(note._typingTimers.size).toBe(1);
    cleanupNotepads();
    expect(note._typingTimers.size).toBe(0);
  });

  it('window survives reset (not destroyed)', () => {
    const note = new Notepad();
    const winId = note._winId;
    cleanupNotepads();
    // Window element should still be in the DOM
    expect(document.getElementById(winId)).not.toBeNull();
  });
});

// ── getState / restore ────────────────────────────────────────────────────────

describe('getState() for persistence', () => {
  it('returns title + content + _desktopIconId', () => {
    const note = new Notepad({ title: 'My Poem', _desktopIconId: 'icon-42' });
    note._el.textContent = 'test content';
    // Manually wire up _widgetState (shell wires this; in tests the mock wm doesn't)
    const win = document.getElementById(note._winId);
    expect(win._widgetState).toBeTruthy();
    const state = win._widgetState();
    expect(state.title).toBe('My Poem');
    expect(state._desktopIconId).toBe('icon-42');
    expect(typeof state.content).toBe('string');
  });
});

// ── note.on convenience ────────────────────────────────────────────────────────

describe('note.on(event, fn)', () => {
  it('subscribes to note:event filtered to this winId', async () => {
    const note = new Notepad();
    const cb = vi.fn();
    const stop = note.on('change', cb);

    // Manually fire note:change for this window
    const { notify: _notify } = await import('../../../src/events/bus.js');
    _notify('note:change', { winId: note._winId, text: 'hello' });
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ winId: note._winId }));

    // Should NOT fire for a different winId
    _notify('note:change', { winId: 'other-win', text: 'other' });
    expect(cb).toHaveBeenCalledTimes(1);

    stop();
  });
});

// ── SYSTEM_EVENTS catalog ──────────────────────────────────────────────────────

describe('SYSTEM_EVENTS catalog', () => {
  it('includes all six note:* events', async () => {
    const { SYSTEM_EVENTS } = await import('../../../src/events/system-events.js');
    const noteNames = SYSTEM_EVENTS.filter(e => e.name?.startsWith('note:')).map(e => e.name);
    expect(noteNames).toContain('note:type');
    expect(noteNames).toContain('note:char');
    expect(noteNames).toContain('note:done');
    expect(noteNames).toContain('note:change');
    expect(noteNames).toContain('note:cursor');
    expect(noteNames).toContain('note:select');
    expect(noteNames).toHaveLength(6);
  });

  it('note:char has primary:"char"', async () => {
    const { SYSTEM_EVENTS } = await import('../../../src/events/system-events.js');
    const charEvt = SYSTEM_EVENTS.find(e => e.name === 'note:char');
    expect(charEvt?.primary).toBe('char');
  });
});

// ── HTML sanitizer ─────────────────────────────────────────────────────────────

describe('HTML sanitizer (_html round-trip)', () => {
  it('strips script tags', () => {
    const note = new Notepad();
    note._el.innerHTML = '<b>safe</b><script>evil()</script>';
    expect(note.html).not.toContain('script');
    expect(note.html).toContain('safe');
  });

  it('keeps b / i / u / span with color style', () => {
    const note = new Notepad();
    note._el.innerHTML = '<b>bold</b><i>italic</i><span style="color:#f00">red</span>';
    const html = note.html;
    expect(html).toContain('<b>');
    expect(html).toContain('<i>');
    expect(html).toContain('color:#f00');
  });

  it('strips non-color style props', () => {
    const note = new Notepad();
    note._el.innerHTML = '<span style="color:red;font-size:50px;background-color:blue">txt</span>';
    const html = note.html;
    expect(html).not.toContain('font-size');
    expect(html).toContain('color:red');
    expect(html).toContain('background-color:blue');
  });

  it('strips onclick and other event attributes', () => {
    const note = new Notepad();
    note._el.innerHTML = '<span onclick="evil()" style="color:red">txt</span>';
    expect(note.html).not.toContain('onclick');
  });
});
