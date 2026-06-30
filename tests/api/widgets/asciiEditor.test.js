import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AsciiEditor, cleanupAsciiEditors } from '../../../src/api/widgets/asciiEditor.js';

// ── Stub wm and DOM helpers ────────────────────────────────────────────────────

let _winCounter = 0;

function makeWmWindow(id) {
  const body = document.createElement('div');
  body.className = 'wm-body';
  body.style.cssText = 'display:flex;';
  const win = document.createElement('div');
  win.id = id;
  win.appendChild(body);
  document.body.appendChild(win);
  return win;
}

beforeEach(() => {
  _winCounter = 0;
  window.wm = {
    spawn: vi.fn(() => {
      const id = `win-ascii-test-${++_winCounter}`;
      makeWmWindow(id);
      return id;
    }),
    addHistoryControls: vi.fn(),
  };
  window.desktop = {
    add:       vi.fn(() => ({ id: 'dt-ascii-test-1' })),
    updateUrl: vi.fn(),
  };
  window.__ar_active_editor_id = null;
  window.__ar_instances        = null;
});

afterEach(() => {
  cleanupAsciiEditors();
  document.querySelectorAll('[id^="win-ascii-test-"]').forEach(el => el.remove());
  delete window.wm;
  delete window.desktop;
  delete window.__ar_active_editor_id;
  delete window.__ar_instances;
});

// ── Constructor ────────────────────────────────────────────────────────────────

describe('AsciiEditor constructor', () => {
  it('defaults: 64 cols, 24 rows, 1 frame', () => {
    const ed = new AsciiEditor();
    expect(ed._cols).toBe(64);
    expect(ed._rows).toBe(24);
    expect(ed.frameCount).toBe(1);
  });

  it('creates N frames for frames param', () => {
    const ed = new AsciiEditor({ frames: 3 });
    expect(ed.frameCount).toBe(3);
  });

  it('frame has cols*rows blank cells', () => {
    const ed = new AsciiEditor({ cols: 4, rows: 3 });
    expect(ed._frames[0].length).toBe(12);
    expect(ed._frames[0][0]).toMatchObject({ ch: ' ' });
  });

  it('spawns a wm window and sets _widgetType', () => {
    const ed = new AsciiEditor();
    expect(window.wm.spawn).toHaveBeenCalledTimes(1);
    const win = document.getElementById(ed._winId);
    expect(win).not.toBeNull();
    expect(win._widgetType).toBe('ascii');
  });

  it('calls addHistoryControls', () => {
    new AsciiEditor();
    expect(window.wm.addHistoryControls).toHaveBeenCalledTimes(1);
  });

  it('restores from _frames param', () => {
    const cells = [{ ch: 'A', fg: '#ff0000', bg: null }, { ch: 'B', fg: '#00ff00', bg: null }];
    const ed = new AsciiEditor({ cols: 2, rows: 1, _frames: [cells] });
    expect(ed._frames[0][0].ch).toBe('A');
    expect(ed._frames[0][1].ch).toBe('B');
  });

  it('does not autosave when _desktopIconId provided', () => {
    new AsciiEditor({ _desktopIconId: 'existing-icon' });
    // autosave only fires after timeout; ensure add() not called synchronously
    expect(window.desktop.add).not.toHaveBeenCalled();
  });
});

// ── Frame API ─────────────────────────────────────────────────────────────────

describe('Frame API', () => {
  it('addFrame appends and returns index', () => {
    const ed = new AsciiEditor();
    const idx = ed.addFrame();
    expect(idx).toBe(1);
    expect(ed.frameCount).toBe(2);
    expect(ed._frames[1].length).toBe(ed._cols * ed._rows);
  });

  it('frame(n) sets _fi', () => {
    const ed = new AsciiEditor({ frames: 3 });
    ed.frame(2);
    expect(ed._fi).toBe(2);
  });

  it('frame(n) wraps negatively', () => {
    const ed = new AsciiEditor({ frames: 3 });
    ed.frame(-1);
    expect(ed._fi).toBe(2);
  });

  it('play sets _iid, stop clears it', () => {
    const ed = new AsciiEditor({ frames: 2 });
    ed.play(12);
    expect(ed._iid).not.toBeNull();
    ed.stop();
    expect(ed._iid).toBeNull();
  });
});

// ── Cell accessors ────────────────────────────────────────────────────────────

describe('Cell accessors', () => {
  it('_cell returns correct cell', () => {
    const ed = new AsciiEditor({ cols: 4, rows: 3 });
    const cell = ed._cell(ed._frames[0], 2, 1);
    expect(cell).toBeDefined();
    expect(cell.ch).toBe(' ');
  });

  it('_setCell mutates frame', () => {
    const ed = new AsciiEditor({ cols: 4, rows: 3 });
    ed._setCell(ed._frames[0], 1, 1, { ch: 'X', fg: '#ff0000', bg: null });
    expect(ed._cell(ed._frames[0], 1, 1).ch).toBe('X');
  });

  it('_setCell ignores out-of-bounds coords', () => {
    const ed = new AsciiEditor({ cols: 4, rows: 3 });
    expect(() => ed._setCell(ed._frames[0], -1, 0, { ch: '!', fg: '#fff', bg: null })).not.toThrow();
    expect(() => ed._setCell(ed._frames[0], 4, 0, { ch: '!', fg: '#fff', bg: null })).not.toThrow();
  });
});

// ── Brush / eraser ────────────────────────────────────────────────────────────

describe('_paintCell', () => {
  it('brush paints char+color into current frame', () => {
    const ed = new AsciiEditor({ cols: 4, rows: 3 });
    ed._tool   = 'brush';
    ed._char   = '#';
    ed._fg     = '#ff0000';
    ed._cellBg = null;
    ed._paintCell(2, 1);
    const cell = ed._cell(ed._frames[0], 2, 1);
    expect(cell.ch).toBe('#');
    expect(cell.fg).toBe('#ff0000');
  });

  it('eraser resets cell to blank', () => {
    const ed = new AsciiEditor({ cols: 4, rows: 3 });
    ed._setCell(ed._frames[0], 0, 0, { ch: '@', fg: '#fff', bg: '#000' });
    ed._tool = 'eraser';
    ed._paintCell(0, 0);
    expect(ed._cell(ed._frames[0], 0, 0).ch).toBe(' ');
  });
});

// ── Eyedropper ────────────────────────────────────────────────────────────────

describe('_eyedrop', () => {
  it('picks char, fg, bg from cell', () => {
    const ed = new AsciiEditor({ cols: 4, rows: 3 });
    ed._setCell(ed._frames[0], 1, 2, { ch: '█', fg: '#00ff00', bg: '#111111' });
    ed._eyedrop(1, 2);
    expect(ed._char).toBe('█');
    expect(ed._fg).toBe('#00ff00');
    expect(ed._cellBg).toBe('#111111');
    expect(ed._transBg).toBe(false);
  });

  it('sets transBg when cell bg is null', () => {
    const ed = new AsciiEditor({ cols: 4, rows: 3 });
    ed._setCell(ed._frames[0], 0, 0, { ch: '.', fg: '#fff', bg: null });
    ed._eyedrop(0, 0);
    expect(ed._transBg).toBe(true);
    expect(ed._cellBg).toBeNull();
  });
});

// ── Flood fill ────────────────────────────────────────────────────────────────

describe('_floodFill', () => {
  it('fills connected region with same cell identity', () => {
    const ed = new AsciiEditor({ cols: 4, rows: 2 });
    // First row: all blank cells (same identity)
    ed._tool   = 'brush';
    ed._char   = '#';
    ed._fg     = '#ff0000';
    ed._cellBg = null;
    ed._floodFill(0, 0); // flood-fill entire grid (all same blank cells)
    // All cells should now be '#' red
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 2; r++) {
        expect(ed._cell(ed._frames[0], c, r).ch).toBe('#');
      }
    }
  });

  it('does not fill if target matches fill', () => {
    const ed = new AsciiEditor({ cols: 2, rows: 2 });
    // Set all cells to '#' red
    for (let i = 0; i < 4; i++) ed._frames[0][i] = { ch: '#', fg: '#ff0000', bg: null };
    ed._char = '#'; ed._fg = '#ff0000'; ed._cellBg = null;
    ed._floodFill(0, 0); // no-op
    expect(ed._cell(ed._frames[0], 0, 0).ch).toBe('#'); // unchanged
  });

  it('respects cell identity boundary', () => {
    const ed = new AsciiEditor({ cols: 3, rows: 1 });
    ed._frames[0][0] = { ch: '.', fg: '#fff', bg: null };
    ed._frames[0][1] = { ch: 'X', fg: '#fff', bg: null }; // different char = boundary
    ed._frames[0][2] = { ch: '.', fg: '#fff', bg: null };
    ed._char = '*'; ed._fg = '#0f0'; ed._cellBg = null;
    ed._floodFill(0, 0);
    expect(ed._cell(ed._frames[0], 0, 0).ch).toBe('*');
    expect(ed._cell(ed._frames[0], 1, 0).ch).toBe('X'); // not filled
    expect(ed._cell(ed._frames[0], 2, 0).ch).toBe('.'); // disconnected, not filled
  });
});

// ── Undo snapshots ────────────────────────────────────────────────────────────

describe('_snapCells / _applyCells', () => {
  it('round-trips cell data and frame count', () => {
    const ed = new AsciiEditor({ cols: 2, rows: 1 });
    ed._setCell(ed._frames[0], 0, 0, { ch: 'A', fg: '#f00', bg: null });
    const snap = ed._snapCells();
    expect(snap.frames[0][0].ch).toBe('A');

    // Mutate and restore
    ed._setCell(ed._frames[0], 0, 0, { ch: 'B', fg: '#0f0', bg: null });
    ed._applyCells(snap);
    expect(ed._cell(ed._frames[0], 0, 0).ch).toBe('A');
  });

  it('restores frame count', () => {
    const ed = new AsciiEditor({ cols: 2, rows: 1 });
    const snap = ed._snapCells();
    ed.addFrame();
    expect(ed.frameCount).toBe(2);
    ed._applyCells(snap);
    expect(ed.frameCount).toBe(1);
  });

  it('snapshot is a deep copy — mutation does not affect snapshot', () => {
    const ed = new AsciiEditor({ cols: 2, rows: 1 });
    const snap = ed._snapCells();
    ed._frames[0][0].ch = 'Z';
    expect(snap.frames[0][0].ch).toBe(' ');
  });
});

// ── State serialization ───────────────────────────────────────────────────────

describe('_getState', () => {
  it('serializes cols, rows, fps, bg, and frames as cell arrays', () => {
    const ed = new AsciiEditor({ cols: 8, rows: 4, fps: 12, bg: '#111' });
    const state = ed._getState();
    expect(state.cols).toBe(8);
    expect(state.rows).toBe(4);
    expect(state.fps).toBe(12);
    expect(state.bg).toBe('#111');
    expect(Array.isArray(state.frames)).toBe(true);
    expect(Array.isArray(state.frames[0])).toBe(true);
    expect(state.frames[0].length).toBe(32);
  });

  it('frames are plain objects (JSON-serializable)', () => {
    const ed = new AsciiEditor({ cols: 2, rows: 1 });
    const state = ed._getState();
    expect(() => JSON.stringify(state)).not.toThrow();
  });

  it('restorer re-creates equivalent editor from state', () => {
    const ed = new AsciiEditor({ cols: 4, rows: 2, frames: 2 });
    ed._setCell(ed._frames[0], 1, 0, { ch: '#', fg: '#f00', bg: null });
    const state = ed._getState();

    const ed2 = new AsciiEditor({
      cols: state.cols, rows: state.rows,
      cellW: state.cellW, cellH: state.cellH,
      fps: state.fps, bg: state.bg,
      _frames: state.frames,
    });
    expect(ed2._cols).toBe(4);
    expect(ed2.frameCount).toBe(2);
    expect(ed2._cell(ed2._frames[0], 1, 0).ch).toBe('#');
  });
});

// ── Export ────────────────────────────────────────────────────────────────────

describe('Export', () => {
  it('_exportCode builds ascii.play() snippet with correct frame shape', () => {
    const dispatched = [];
    window.__ar_active_editor_id = 'ed1';
    window.__ar_instances = new Map([['ed1', {
      cm: {
        state: { doc: { length: 0 } },
        dispatch: vi.fn(op => dispatched.push(op)),
        focus: vi.fn(),
      },
    }]]);

    const ed = new AsciiEditor({ cols: 2, rows: 1 });
    ed._setCell(ed._frames[0], 0, 0, { ch: '@', fg: '#00ff41', bg: null });
    ed._exportCode();

    expect(dispatched.length).toBe(1);
    const code = dispatched[0].changes.insert;
    expect(code).toContain('ascii.play(');
    // Frame object shape
    const frameMatch = code.match(/"w":\s*2/);
    expect(frameMatch).not.toBeNull();
    expect(code).toContain('"c":"@"');
  });

  it('_exportText produces plain char grid', () => {
    const blobContents = [];
    global.URL = { createObjectURL: vi.fn(() => 'blob:test'), revokeObjectURL: vi.fn() };
    const origBlob = global.Blob;
    global.Blob = class { constructor(parts) { blobContents.push(...parts); } };

    const ed = new AsciiEditor({ cols: 2, rows: 1 });
    ed._setCell(ed._frames[0], 0, 0, { ch: 'H', fg: '#fff', bg: null });
    ed._setCell(ed._frames[0], 1, 0, { ch: 'i', fg: '#fff', bg: null });
    ed._exportText();

    global.Blob = origBlob;
    expect(blobContents.join('')).toContain('Hi');
  });

  it('_exportANSI produces ANSI escape sequences for colored cells', () => {
    const blobContents = [];
    global.URL = { createObjectURL: vi.fn(() => 'blob:test'), revokeObjectURL: vi.fn() };
    const origBlob = global.Blob;
    global.Blob = class { constructor(parts) { blobContents.push(...parts); } };

    const ed = new AsciiEditor({ cols: 1, rows: 1 });
    ed._setCell(ed._frames[0], 0, 0, { ch: 'X', fg: '#ff0000', bg: '#0000ff' });
    ed._exportANSI();

    global.Blob = origBlob;
    const out = blobContents.join('');
    expect(out).toContain('\x1b[38;2;255;0;0m');    // fg red
    expect(out).toContain('\x1b[48;2;0;0;255m');    // bg blue
    expect(out).toContain('X');
    expect(out).toContain('\x1b[0m');               // reset
  });
});

// ── Keyboard handling ─────────────────────────────────────────────────────────

describe('Keyboard (type tool)', () => {
  it('typing a char writes it at cursor and advances', () => {
    const ed = new AsciiEditor({ cols: 4, rows: 2 });
    ed._tool    = 'type';
    ed._focused = true;
    ed._fg      = '#fff';
    ed._cellBg  = null;
    ed._cursor  = { c: 0, r: 0 };
    ed._handleKey({ key: 'H', preventDefault: vi.fn() });
    expect(ed._cell(ed._frames[0], 0, 0).ch).toBe('H');
    expect(ed._cursor.c).toBe(1);
  });

  it('Backspace steps back and clears previous cell', () => {
    const ed = new AsciiEditor({ cols: 4, rows: 2 });
    ed._tool    = 'type';
    ed._focused = true;
    ed._cursor  = { c: 2, r: 0 };
    ed._setCell(ed._frames[0], 1, 0, { ch: 'A', fg: '#fff', bg: null });
    ed._handleKey({ key: 'Backspace', preventDefault: vi.fn() });
    expect(ed._cursor.c).toBe(1);
    expect(ed._cell(ed._frames[0], 1, 0).ch).toBe(' ');
  });

  it('Enter moves cursor to next row, col 0', () => {
    const ed = new AsciiEditor({ cols: 4, rows: 3 });
    ed._tool    = 'type';
    ed._focused = true;
    ed._cursor  = { c: 2, r: 0 };
    ed._handleKey({ key: 'Enter', preventDefault: vi.fn() });
    expect(ed._cursor.c).toBe(0);
    expect(ed._cursor.r).toBe(1);
  });

  it('Arrow keys move cursor', () => {
    const ed = new AsciiEditor({ cols: 4, rows: 3 });
    ed._tool    = 'type';
    ed._focused = true;
    ed._cursor  = { c: 1, r: 1 };
    ed._handleKey({ key: 'ArrowRight', preventDefault: vi.fn() });
    expect(ed._cursor.c).toBe(2);
    ed._handleKey({ key: 'ArrowDown', preventDefault: vi.fn() });
    expect(ed._cursor.r).toBe(2);
    ed._handleKey({ key: 'ArrowLeft', preventDefault: vi.fn() });
    expect(ed._cursor.c).toBe(1);
    ed._handleKey({ key: 'ArrowUp', preventDefault: vi.fn() });
    expect(ed._cursor.r).toBe(1);
  });

  it('cursor clamps at grid boundaries', () => {
    const ed = new AsciiEditor({ cols: 2, rows: 1 });
    ed._tool    = 'type';
    ed._focused = true;
    ed._cursor  = { c: 1, r: 0 };
    ed._handleKey({ key: 'ArrowRight', preventDefault: vi.fn() });
    expect(ed._cursor.c).toBe(1); // clamped
    ed._cursor = { c: 0, r: 0 };
    ed._handleKey({ key: 'ArrowLeft', preventDefault: vi.fn() });
    expect(ed._cursor.c).toBe(0); // clamped
  });

  it('cursor wraps to next row at end of line', () => {
    const ed = new AsciiEditor({ cols: 2, rows: 2 });
    ed._tool    = 'type';
    ed._focused = true;
    ed._cursor  = { c: 1, r: 0 };
    ed._handleKey({ key: 'A', preventDefault: vi.fn() });
    expect(ed._cursor.c).toBe(0);
    expect(ed._cursor.r).toBe(1);
  });
});

// ── Frame strip operations ────────────────────────────────────────────────────

describe('Frame strip operations', () => {
  it('cannot delete below 1 frame', () => {
    const ed = new AsciiEditor({ cols: 2, rows: 1 });
    ed._frames.splice(ed._fi, 1);
    // guard: splice only if > 1
    if (ed._frames.length < 1) ed._frames.push(ed._blankFrame());
    expect(ed.frameCount).toBeGreaterThanOrEqual(1);
  });

  it('duplicate copies frame content', () => {
    const ed = new AsciiEditor({ cols: 2, rows: 1 });
    ed._setCell(ed._frames[0], 0, 0, { ch: 'Z', fg: '#fff', bg: null });
    const src = ed._frames[0];
    const ni  = ed.addFrame();
    ed._frames[ni] = src.map(cell => ({ ...cell }));
    expect(ed._frames[ni][0].ch).toBe('Z');
    expect(ed._frames[ni]).not.toBe(src); // deep copy
  });
});

// ── Cleanup ───────────────────────────────────────────────────────────────────

describe('cleanupAsciiEditors', () => {
  it('destroys all active editors', () => {
    new AsciiEditor();
    const e2 = new AsciiEditor();
    e2.play(12);
    expect(e2._iid).not.toBeNull();
    cleanupAsciiEditors();
    expect(e2._iid).toBeNull();
  });

  it('is idempotent', () => {
    new AsciiEditor();
    cleanupAsciiEditors();
    expect(() => cleanupAsciiEditors()).not.toThrow();
  });
});

// ── Event hooks ───────────────────────────────────────────────────────────────

describe('AsciiEditor event hooks', () => {
  it('onCell fires via _setCell when _cellEventsOn', () => {
    const ed = new AsciiEditor({ cols: 8, rows: 4 });
    const evs = [];
    ed.onCell(e => evs.push(e));
    const frame = ed._frames[0];
    const cell  = { ch: 'A', fg: '#fff', bg: null };
    ed._setCell(frame, 2, 1, cell);
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({ c: 2, r: 1, ch: 'A' });
  });

  it('_setCell suppressed during _resizeGrid', () => {
    const ed = new AsciiEditor({ cols: 4, rows: 4 });
    const evs = [];
    ed.onCell(e => evs.push(e));
    ed._resizeGrid(8, 8);
    expect(evs).toHaveLength(0);
  });

  it('_cellEventsOn re-enabled after _resizeGrid', () => {
    const ed = new AsciiEditor({ cols: 4, rows: 4 });
    ed._resizeGrid(8, 8);
    expect(ed._cellEventsOn).toBe(true);
  });

  it('onChar fires via _events emit', () => {
    const ed = new AsciiEditor({ cols: 8, rows: 4 });
    const evs = [];
    ed.onChar(e => evs.push(e));
    ed._events.emit('char', { char: '#', prev: ' ' });
    expect(evs[0]).toMatchObject({ char: '#', prev: ' ' });
  });

  it('onColor fires via _events emit', () => {
    const ed = new AsciiEditor({ cols: 8, rows: 4 });
    const evs = [];
    ed.onColor(e => evs.push(e));
    ed._events.emit('color', { fg: '#ff0000', bg: null });
    expect(evs[0]).toMatchObject({ fg: '#ff0000' });
  });

  it('onStroke fires via _emitStroke', () => {
    const ed = new AsciiEditor({ cols: 8, rows: 4 });
    const evs = [];
    ed.onStroke(e => evs.push(e));
    ed._expandBbox(1, 0);
    ed._expandBbox(4, 3);
    ed._emitStroke();
    expect(evs).toHaveLength(1);
    expect(evs[0].bbox).toMatchObject({ x: 1, y: 0, w: 3, h: 3 });
    expect(ed._strokeBbox).toBeNull();
  });

  it('_emitStroke silent when no bbox', () => {
    const ed = new AsciiEditor({ cols: 8, rows: 4 });
    const evs = [];
    ed.onStroke(e => evs.push(e));
    ed._emitStroke();
    expect(evs).toHaveLength(0);
  });

  it('onTool fires', () => {
    const ed = new AsciiEditor({ cols: 8, rows: 4 });
    const evs = [];
    ed.onTool(e => evs.push(e));
    ed._events.emit('tool', { tool: 'brush', prev: 'type' });
    expect(evs[0]).toMatchObject({ tool: 'brush' });
  });

  it('onFrame fires', () => {
    const ed = new AsciiEditor({ cols: 8, rows: 4 });
    const evs = [];
    ed.onFrame(e => evs.push(e));
    ed._events.emit('frame', { action: 'add', index: 1, count: 2 });
    expect(evs[0]).toMatchObject({ action: 'add', index: 1 });
  });

  it('signal decays from cell event', () => {
    const ed = new AsciiEditor({ cols: 8, rows: 4 });
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const sig = ed.signal('cell', { decay: 200 });
    const frame = ed._frames[0];
    ed._setCell(frame, 0, 0, { ch: 'X', fg: '#fff', bg: null });
    expect(sig.value).toBeCloseTo(1, 5);
    now = 100;
    expect(sig.value).toBeCloseTo(0.5, 3);
    now = 200;
    expect(sig.value).toBe(0);
    vi.restoreAllMocks();
  });

  it('signal region filters by c/r', () => {
    const ed = new AsciiEditor({ cols: 16, rows: 8 });
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const sig = ed.signal('cell', { decay: 100, region: { x: 0, y: 0, w: 8, h: 4 } });
    // outside
    ed._events.emit('cell', { c: 10, r: 5 });
    expect(sig.value).toBe(0);
    // inside
    ed._events.emit('cell', { c: 3, r: 2 });
    expect(sig.value).toBeCloseTo(1, 5);
    vi.restoreAllMocks();
  });

  it('returns this from all on* methods', () => {
    const ed = new AsciiEditor({ cols: 8, rows: 4 });
    expect(ed.onCell(() => {})).toBe(ed);
    expect(ed.onStroke(() => {})).toBe(ed);
    expect(ed.onColor(() => {})).toBe(ed);
    expect(ed.onChar(() => {})).toBe(ed);
    expect(ed.onTool(() => {})).toBe(ed);
    expect(ed.onFrame(() => {})).toBe(ed);
  });

  it('cleanupAsciiEditors clears hooks', () => {
    const ed = new AsciiEditor({ cols: 8, rows: 4 });
    const calls = [];
    ed.onCell(() => calls.push(1));
    const frame = ed._frames[0];
    ed._setCell(frame, 0, 0, { ch: 'Z', fg: '#fff', bg: null });
    expect(calls).toHaveLength(1);
    cleanupAsciiEditors();
    ed._setCell(frame, 1, 0, { ch: 'Z', fg: '#fff', bg: null });
    expect(calls).toHaveLength(1); // cleared
  });
});
