// asciiEditor.js — interactive colored ASCII art editor
// Entry: new AsciiEditor(opts), asciiEditor(opts) factory, toolbar ⌨️ button
// Sibling to SpriteEditor/Paint; reuses WidgetHistory, wm.addHistoryControls, desktop autosave.

import { WidgetEvents } from './widget-events.js';
import { downloadBlob } from './frame-snapshot.js';
import { registerWidgetRestorer } from '../wm/widget-restorer-registry.js';
import { insertSnippet } from '../../editor/active-editor.js';
import { FrameDoc } from './frame-doc.js';
import { hexToRgb } from '../visual/color.js';
import {
  mountWidgetShell,
  buildFrameStrip,
  buildTransport,
  wireCaptureButton,
  mkExportButton as mkExport,
} from './widget-shell.js';
import { onReset } from '../../runtime/reset-registry.js';
import { registerDesktopFileType } from '../platform/desktop-file-registry.js';
import { Take } from '../signal/performance-recorder.js';
import { replayActions } from '../signal/replay-clock.js';

const _editors = [];

export function cleanupAsciiEditors() {
  for (const ed of [..._editors]) ed._destroy();
  _editors.length = 0;
}

const CHAR_PALETTE = [
  '░',
  '▒',
  '▓',
  '█',
  '▀',
  '▄',
  '■',
  '·',
  '.',
  ':',
  '-',
  '=',
  '+',
  '*',
  '#',
  '%',
  '@',
  '/',
  '\\',
  '|',
  '~',
  '^',
  'O',
  'X',
  '0',
];

const TOOLS = [
  { id: 'type', icon: '<i class="fa-solid fa-i-cursor"></i>', title: 'Type (keyboard entry)' },
  { id: 'brush', icon: '<i class="fa-solid fa-pen"></i>', title: 'Brush (paint char+color)' },
  { id: 'eraser', icon: '<i class="fa-solid fa-eraser"></i>', title: 'Eraser (clear cell)' },
  {
    id: 'fill',
    icon: '<i class="fa-solid fa-fill-drip"></i>',
    title: 'Fill (flood fill by cell identity)',
  },
  {
    id: 'eye',
    icon: '<i class="fa-solid fa-eye-dropper"></i>',
    title: 'Eyedropper (pick char+colors)',
  },
  { id: 'line', icon: '<i class="fa-solid fa-minus"></i>', title: 'Line' },
  { id: 'rect', icon: '<i class="fa-regular fa-square"></i>', title: 'Rectangle (outline)' },
];

const GRID_PRESETS = [
  { label: '64×24', cols: 64, rows: 24 },
  { label: '80×40', cols: 80, rows: 40 },
  { label: '32×16', cols: 32, rows: 16 },
  { label: '40×20', cols: 40, rows: 20 },
  { label: '120×48', cols: 120, rows: 48 },
];

const ACTIVE_COLOR = '#cba6f7';
const INACTIVE_BORDER = '#45475a';

function _hexToRgbStr(hex) {
  return hexToRgb(hex).join(';');
}

function _blank(fg = '#00ff41') {
  return { ch: ' ', fg, bg: null };
}

function _escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export class AsciiEditor {
  constructor({
    cols = 64,
    rows = 24,
    cellW = 10,
    cellH = 18,
    frames = 1,
    fps = 8,
    bg = '#0d0208',
    title = 'ASCII Editor',
    _desktopIconId = null,
    x,
    y,
    _frames = null,
  } = {}) {
    this._cols = cols;
    this._rows = rows;
    this._cellW = cellW;
    this._cellH = cellH;
    this._bg = bg;
    this._title = title;
    this._desktopIconId = _desktopIconId;

    this._tool = 'type';
    this._char = '█';
    this._fg = '#00ff41';
    this._cellBg = null;
    this._transBg = true;

    this._drawing = false;
    this._startCell = null;
    this._focused = false;

    this._cursor = { c: 0, r: 0 };

    this._winId = null;
    this._canvas = null;
    this._overlay = null;
    this._fgInput = null;
    this._bgInput = null;
    this._charInput = null;
    this._keydownFn = null;
    this._mousedownFn = null;

    this._events = new WidgetEvents();
    this._take = new Take(this); // Performance capture (ADR 031)
    this._replaying = false; // gates capture during replay/programmatic apply
    this._strokeBbox = null; // { minC, minR, maxC, maxR } during pointer drag
    this._cellEventsOn = true; // false during _resizeGrid / programmatic frame load

    // Replaced per-instance by the shell in _init(); no-ops until then.
    this._autoSave = () => {};
    this._refreshThumbs = () => {};

    // Frame model (cell-array frames) — see frame-doc.js. Hooks supply the
    // ASCII-specific blank/copy/clear/thumbnail operations.
    const seed = _frames
      ? _frames.map((f) => f.map((cell) => ({ ...cell })))
      : Array.from({ length: frames }, () => this._blankFrame());
    this._fd = new FrameDoc({
      frames: seed,
      fps,
      thumbAspect: (this._cols * this._cellW) / (this._rows * this._cellH),
      thumbPixelated: true,
      createBlank: () => this._blankFrame(),
      copyFrame: (f) => f.map((cell) => ({ ...cell })),
      clearFrame: (f) => {
        for (let i = 0; i < f.length; i++) f[i] = _blank(this._fg);
      },
      drawThumb: (tc, frame) => {
        tc.width = this._cols;
        tc.height = this._rows;
        const tctx = tc.getContext('2d');
        tctx.fillStyle = this._bg;
        tctx.fillRect(0, 0, this._cols, this._rows);
        for (let r = 0; r < this._rows; r++) {
          for (let c = 0; c < this._cols; c++) {
            const cell = this._cell(frame, c, r);
            if (cell && cell.ch !== ' ') {
              tctx.fillStyle = cell.fg ?? '#00ff41';
              tctx.fillRect(c, r, 1, 1);
            }
          }
        }
      },
    });

    _editors.push(this);
    this._init(title, x, y);
    if (!_desktopIconId) this._autoSave();
  }

  // ── Public getters ────────────────────────────────────────────────────────────

  get frameCount() {
    return this._fd.count;
  }

  // Frame model lives in FrameDoc; these proxies keep existing `this._frames` /
  // `this._fi` / `this._fps` / `this._onion` / `this._iid` references working.
  get _frames() {
    return this._fd.frames;
  }
  set _frames(v) {
    this._fd.frames = v;
  }
  get _fi() {
    return this._fd.index;
  }
  set _fi(v) {
    this._fd.index = v;
  }
  get _fps() {
    return this._fd.fps;
  }
  set _fps(v) {
    this._fd.fps = v;
  }
  get _onion() {
    return this._fd.onion;
  }
  set _onion(v) {
    this._fd.onion = v;
  }
  get _iid() {
    return this._fd.isPlaying ? 1 : null;
  } // _render reads this

  // ── Frame helpers ─────────────────────────────────────────────────────────────

  _blankFrame() {
    const n = this._cols * this._rows;
    const frame = [];
    for (let i = 0; i < n; i++) frame.push(_blank(this._fg));
    return frame;
  }

  addFrame() {
    return this._fd.push();
  } // public: append, no index move

  frame(n) {
    if (n === undefined) return this._fd.index;
    this._fd.index = n;
    this._render();
    return this;
  }

  play(fps = 8) {
    this._fd.play(fps);
    return this;
  }
  stop() {
    this._fd.stop();
    return this;
  }

  // ── Cell accessors ────────────────────────────────────────────────────────────

  _cell(frameArr, c, r) {
    return frameArr[r * this._cols + c];
  }

  _setCell(frameArr, c, r, cell) {
    if (c < 0 || c >= this._cols || r < 0 || r >= this._rows) return;
    frameArr[r * this._cols + c] = cell;
    if (this._cellEventsOn) {
      this._events.emit('cell', { c, r, ch: cell.ch, fg: cell.fg, bg: cell.bg, frame: this._fi });
      // Performance capture: every user cell mutation (brush/line/rect/fill funnels
      // through here). Skipped during replay so re-applying does not re-record.
      if (!this._replaying)
        this._take.push({ op: 'cell', c, r, ch: cell.ch, fg: cell.fg, bg: cell.bg });
    }
  }

  // ── Performance capture / replay (ADR 031) ──────────────────────────────────
  // Public cell setter — the replay verb and a scriptable single-cell write.
  cell(c, r, ch, fg = this._fg, bg = this._cellBg) {
    const frame = this._frames[this._fi];
    if (!frame) return this;
    this._setCell(frame, c, r, { ch, fg, bg });
    this._render();
    return this;
  }

  _applyAction(a) {
    if (!a) return;
    this._replaying = true;
    try {
      if (a.op === 'frame') this.frame(a.i);
      else if (a.op === 'cell') this.cell(a.c, a.r, a.ch, a.fg, a.bg);
    } finally {
      this._replaying = false;
    }
  }

  replay(actions, opts) {
    return replayActions((act) => this._applyAction(act), actions, opts);
  }

  _perfCtor() {
    return {
      varName: 'ed',
      code: `const ed = new AsciiEditor({ title: '${String(this._title).replace(/'/g, "\\'")}', cols: ${this._cols}, rows: ${this._rows} });`,
    };
  }

  // ── Window init ───────────────────────────────────────────────────────────────

  _init(title, x, y) {
    if (!window.wm) return;

    const cw = this._cols * this._cellW;
    const ch = this._rows * this._cellH;
    const dispW = Math.min(cw, 800);
    const dispH = Math.min(ch, 480);
    const winW = dispW + 4;
    const winH = 32 + 58 + dispH + 14 + 80 + 38;

    const fd = this._fd;
    const strip = buildFrameStrip(fd, { minThumbW: 24 });

    const transport = buildTransport(fd, {
      onFpsChange: () => this._autoSave(),
      extraButtons: [
        mkExport('<i class="fa-solid fa-code"></i> Code', '#89b4fa', () => this._exportCode()),
        mkExport('<i class="fa-solid fa-align-left"></i> Text', '#a6e3a1', () =>
          this._exportText(),
        ),
        mkExport('<i class="fa-solid fa-terminal"></i> ANSI', '#f9e2af', () => this._exportANSI()),
        wireCaptureButton(
          mkExport('<i class="fa-solid fa-circle"></i> Rec', '#f38ba8', () => {}),
          { take: this._take, widget: this, idleLabel: '⏺ Rec' },
        ),
      ],
    });

    const shell = mountWidgetShell({
      title,
      x,
      y,
      w: winW,
      h: winH,
      widgetType: 'ascii',
      rows: [
        this._buildToolRow(),
        this._buildPaletteRow(),
        this._buildCanvasArea(dispW, dispH),
        strip.el,
        transport,
      ],
      getState: () => this._getState(),
      save: {
        name: (this._title || 'ASCII Art') + '.ascii',
        type: 'ascii',
        getIconId: () => this._desktopIconId,
        setIconId: (id) => {
          this._desktopIconId = id;
        },
      },
      history: {
        capture: () => this._snapCells(),
        restore: (snap) => this._applyCells(snap),
      },
      onMount: () => this._render(),
      onDestroy: () => this._destroy(),
    });
    if (!shell) return;
    const win = shell.win;
    this._winId = shell.winId;
    this._autoSave = shell.save;
    this._refreshThumbs = strip.refreshThumbs;
    this._history = shell.history;

    fd.on('mutate', (e) => {
      this._render();
      this._history?.commit();
      this._autoSave();
      this._events.emit('frame', e);
    });
    fd.on('select', (e) => {
      this._render();
      if (!this._replaying) this._take.push({ op: 'frame', i: e.index });
      this._events.emit('frame', { action: 'select', index: e.index, count: e.count });
    });
    fd.on('tick', () => this._render());
    fd.on('onion', () => this._render());

    // Track focus for keyboard type tool
    win.addEventListener('mousedown', () => {
      this._focused = true;
    });
    this._mousedownFn = (e) => {
      if (!win.contains(e.target)) this._focused = false;
    };
    this._keydownFn = (e) => {
      if (!this._focused || this._tool !== 'type') return;
      const active = document.activeElement;
      if (
        active &&
        win.contains(active) &&
        (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')
      )
        return;
      this._handleKey(e);
    };
    document.addEventListener('mousedown', this._mousedownFn);
    document.addEventListener('keydown', this._keydownFn);
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  _render() {
    const dc = this._canvas;
    if (!dc) return;
    const ctx = dc.getContext('2d');

    ctx.fillStyle = this._bg;
    ctx.fillRect(0, 0, dc.width, dc.height);

    if (this._onion && this._frames.length > 1) {
      const prev = this._frames[(this._fi - 1 + this._frames.length) % this._frames.length];
      ctx.globalAlpha = 0.25;
      this._renderFrame(ctx, prev);
      ctx.globalAlpha = 1;
    }

    if (this._frames[this._fi]) this._renderFrame(ctx, this._frames[this._fi]);
    if (this._tool === 'type' && !this._iid) this._drawCaret();
  }

  _renderFrame(ctx, frame) {
    const cw = this._cellW,
      ch = this._cellH;
    const cols = this._cols;
    const fontSize = Math.round(ch * 0.75);
    ctx.font = `${fontSize}px monospace`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';

    for (let r = 0; r < this._rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cell = frame[r * cols + c];
        if (!cell) continue;
        const x = c * cw,
          y = r * ch;
        if (cell.bg) {
          ctx.fillStyle = cell.bg;
          ctx.fillRect(x, y, cw, ch);
        }
        if (cell.ch && cell.ch !== ' ') {
          ctx.fillStyle = cell.fg ?? '#00ff41';
          ctx.fillText(cell.ch, x + cw / 2, y + ch / 2);
        }
      }
    }
  }

  _drawCaret() {
    const ov = this._overlay;
    if (!ov) return;
    const ctx = ov.getContext('2d');
    ctx.clearRect(0, 0, ov.width, ov.height);
    const x = this._cursor.c * this._cellW;
    const y = this._cursor.r * this._cellH;
    ctx.strokeStyle = 'rgba(203,166,247,0.9)';
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, this._cellW - 2, this._cellH - 2);
  }

  _clearOverlay() {
    if (this._overlay) {
      this._overlay.getContext('2d').clearRect(0, 0, this._overlay.width, this._overlay.height);
    }
  }

  // ── Undo snapshots ────────────────────────────────────────────────────────────

  _snapCells() {
    return {
      fi: this._fi,
      frames: this._frames.map((f) => f.map((cell) => ({ ...cell }))),
    };
  }

  _applyCells(snap) {
    while (this._frames.length < snap.frames.length) this._frames.push(this._blankFrame());
    this._frames.length = snap.frames.length;
    snap.frames.forEach((f, i) => {
      this._frames[i] = f.map((cell) => ({ ...cell }));
    });
    this._fi = snap.fi;
    this._render();
    this._refreshThumbs();
  }

  // ── State serialization ───────────────────────────────────────────────────────

  _getState() {
    return {
      title: this._title,
      cols: this._cols,
      rows: this._rows,
      cellW: this._cellW,
      cellH: this._cellH,
      fps: this._fps,
      bg: this._bg,
      frames: this._frames,
      _desktopIconId: this._desktopIconId,
    };
  }

  // ── Tool row ──────────────────────────────────────────────────────────────────

  _buildToolRow() {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:3px;padding:5px 8px 3px;flex-shrink:0;flex-wrap:wrap;';

    TOOLS.forEach((t) => {
      const btn = document.createElement('button');
      btn.title = t.title;
      btn.dataset.tool = t.id;
      btn.style.cssText = [
        `background:#313244;border:2px solid ${t.id === this._tool ? ACTIVE_COLOR : INACTIVE_BORDER};`,
        'border-radius:5px;color:#cdd6f4;font-size:14px;width:30px;height:28px;',
        'cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;transition:border-color 0.1s;',
      ].join('');
      btn.innerHTML = t.icon;
      btn.addEventListener('click', () => {
        const prev = this._tool;
        this._tool = t.id;
        row.querySelectorAll('button[data-tool]').forEach((b) => {
          b.style.borderColor = b.dataset.tool === this._tool ? ACTIVE_COLOR : INACTIVE_BORDER;
        });
        if (this._tool !== 'type') this._clearOverlay();
        else this._drawCaret();
        this._events.emit('tool', { tool: this._tool, prev });
      });
      row.appendChild(btn);
    });

    return row;
  }

  // ── Palette row ───────────────────────────────────────────────────────────────

  _buildPaletteRow() {
    const row = document.createElement('div');
    row.style.cssText =
      'display:flex;gap:3px;padding:3px 8px 4px;flex-shrink:0;align-items:center;flex-wrap:wrap;row-gap:4px;';

    // Char palette
    const charLbl = document.createElement('span');
    charLbl.textContent = 'char:';
    charLbl.style.cssText = 'font-size:10px;color:#6c7086;font-family:monospace;flex-shrink:0;';
    row.appendChild(charLbl);

    CHAR_PALETTE.forEach((ch) => {
      const btn = document.createElement('button');
      btn.textContent = ch;
      btn.title = 'Paint char: ' + ch;
      btn.dataset.palChar = ch;
      btn.style.cssText = [
        `background:${ch === this._char ? '#313244' : 'transparent'};`,
        `border:1px solid ${ch === this._char ? ACTIVE_COLOR : INACTIVE_BORDER};`,
        'border-radius:3px;color:#00ff41;font-size:11px;font-family:monospace;',
        'width:18px;height:18px;cursor:pointer;padding:0;flex-shrink:0;line-height:1;',
      ].join('');
      btn.addEventListener('click', () => {
        const prev = this._char;
        this._char = ch;
        if (this._charInput) this._charInput.value = ch;
        row.querySelectorAll('button[data-pal-char]').forEach((b) => {
          b.style.borderColor = b.dataset.palChar === this._char ? ACTIVE_COLOR : INACTIVE_BORDER;
          b.style.background = b.dataset.palChar === this._char ? '#313244' : 'transparent';
        });
        this._events.emit('char', { char: ch, prev });
      });
      row.appendChild(btn);
    });

    // Custom char input
    const charIn = document.createElement('input');
    charIn.type = 'text';
    charIn.value = this._char;
    charIn.maxLength = 1;
    charIn.title = 'Custom char (any single character)';
    charIn.style.cssText =
      'width:22px;height:18px;background:#313244;color:#00ff41;border:1px solid #45475a;border-radius:3px;padding:0 3px;font-family:monospace;font-size:11px;text-align:center;flex-shrink:0;';
    charIn.addEventListener('input', () => {
      if (charIn.value) {
        const prev = this._char;
        this._char = charIn.value.slice(-1);
        charIn.value = this._char;
        this._events.emit('char', { char: this._char, prev });
      }
    });
    row.appendChild(charIn);
    this._charInput = charIn;

    // Separator
    const mkSep = () => {
      const s = document.createElement('div');
      s.style.cssText = 'width:1px;height:20px;background:#45475a;margin:0 4px;flex-shrink:0;';
      return s;
    };
    row.appendChild(mkSep());

    // FG color
    const fgLbl = document.createElement('span');
    fgLbl.textContent = 'fg:';
    fgLbl.style.cssText = 'font-size:10px;color:#6c7086;font-family:monospace;flex-shrink:0;';
    row.appendChild(fgLbl);

    const fgIn = document.createElement('input');
    fgIn.type = 'color';
    fgIn.value = this._fg;
    fgIn.title = 'Foreground (text) color';
    fgIn.style.cssText =
      'width:24px;height:24px;border:none;border-radius:3px;cursor:pointer;padding:0;background:none;flex-shrink:0;';
    fgIn.addEventListener('input', () => {
      const prev = this._fg;
      this._fg = fgIn.value;
      this._events.emit('color', { fg: this._fg, bg: this._cellBg, prev });
    });
    row.appendChild(fgIn);
    this._fgInput = fgIn;

    row.appendChild(mkSep());

    // BG color
    const bgLbl = document.createElement('span');
    bgLbl.textContent = 'bg:';
    bgLbl.style.cssText = 'font-size:10px;color:#6c7086;font-family:monospace;flex-shrink:0;';
    row.appendChild(bgLbl);

    const bgIn = document.createElement('input');
    bgIn.type = 'color';
    bgIn.value = this._cellBg ?? '#000000';
    bgIn.title = 'Cell background color';
    bgIn.style.cssText =
      'width:24px;height:24px;border:none;border-radius:3px;cursor:pointer;padding:0;background:none;flex-shrink:0;';
    bgIn.addEventListener('input', () => {
      this._cellBg = bgIn.value;
      this._transBg = false;
      transBtn.style.borderColor = INACTIVE_BORDER;
      this._events.emit('color', { fg: this._fg, bg: this._cellBg });
    });
    row.appendChild(bgIn);
    this._bgInput = bgIn;

    // Transparent bg toggle
    const transBtn = document.createElement('button');
    transBtn.title = 'Transparent cell background';
    transBtn.style.cssText = `background:transparent;border:1px solid ${this._transBg ? ACTIVE_COLOR : INACTIVE_BORDER};border-radius:3px;cursor:pointer;width:24px;height:24px;padding:0;flex-shrink:0;background-image:linear-gradient(45deg,#666 25%,transparent 25%,transparent 75%,#666 75%),linear-gradient(45deg,#666 25%,transparent 25%,transparent 75%,#666 75%);background-size:8px 8px;background-position:0 0,4px 4px;`;
    transBtn.addEventListener('click', () => {
      this._transBg = !this._transBg;
      this._cellBg = this._transBg ? null : (this._bgInput?.value ?? '#000000');
      transBtn.style.borderColor = this._transBg ? ACTIVE_COLOR : INACTIVE_BORDER;
      this._events.emit('color', { fg: this._fg, bg: this._cellBg });
    });
    row.appendChild(transBtn);

    row.appendChild(mkSep());

    // Grid size preset selector
    const gridLbl = document.createElement('span');
    gridLbl.textContent = 'grid:';
    gridLbl.style.cssText = 'font-size:10px;color:#6c7086;font-family:monospace;flex-shrink:0;';
    row.appendChild(gridLbl);

    const gridSel = document.createElement('select');
    gridSel.style.cssText =
      'background:#313244;color:#cdd6f4;border:1px solid #45475a;border-radius:3px;font-size:10px;padding:2px 3px;flex-shrink:0;cursor:pointer;';
    GRID_PRESETS.forEach((p) => {
      const opt = document.createElement('option');
      opt.value = JSON.stringify(p);
      opt.textContent = p.label;
      if (p.cols === this._cols && p.rows === this._rows) opt.selected = true;
      gridSel.appendChild(opt);
    });
    gridSel.addEventListener('change', () => {
      const p = JSON.parse(gridSel.value);
      this._resizeGrid(p.cols, p.rows);
    });
    row.appendChild(gridSel);

    return row;
  }

  // ── Canvas area ───────────────────────────────────────────────────────────────

  _buildCanvasArea(dispW, dispH) {
    const wrap = document.createElement('div');
    const cw = this._cols * this._cellW;
    const ch = this._rows * this._cellH;
    wrap.style.cssText = `position:relative;width:${dispW}px;height:${dispH}px;flex-shrink:0;overflow:auto;align-self:center;margin:6px auto;`;

    const dc = document.createElement('canvas');
    dc.width = cw;
    dc.height = ch;
    dc.style.cssText = 'position:absolute;top:0;left:0;';
    this._canvas = dc;

    const ov = document.createElement('canvas');
    ov.width = cw;
    ov.height = ch;
    ov.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;';
    this._overlay = ov;

    const hit = document.createElement('canvas');
    hit.width = cw;
    hit.height = ch;
    hit.style.cssText = 'position:absolute;top:0;left:0;cursor:crosshair;opacity:0;';

    wrap.appendChild(dc);
    wrap.appendChild(ov);
    wrap.appendChild(hit);

    this._bindPointer(hit);
    return wrap;
  }

  // ── Pointer handling ──────────────────────────────────────────────────────────

  _cellCoord(e) {
    const rect = e.target.getBoundingClientRect();
    const c = Math.max(
      0,
      Math.min(this._cols - 1, Math.floor((e.clientX - rect.left) / this._cellW)),
    );
    const r = Math.max(
      0,
      Math.min(this._rows - 1, Math.floor((e.clientY - rect.top) / this._cellH)),
    );
    return { c, r };
  }

  _expandBbox(c, r) {
    if (!this._strokeBbox) {
      this._strokeBbox = { minC: c, minR: r, maxC: c, maxR: r };
    } else {
      if (c < this._strokeBbox.minC) this._strokeBbox.minC = c;
      if (r < this._strokeBbox.minR) this._strokeBbox.minR = r;
      if (c > this._strokeBbox.maxC) this._strokeBbox.maxC = c;
      if (r > this._strokeBbox.maxR) this._strokeBbox.maxR = r;
    }
  }

  _emitStroke() {
    const b = this._strokeBbox;
    if (!b) return;
    this._events.emit('stroke', {
      tool: this._tool,
      fg: this._fg,
      bg: this._cellBg,
      char: this._char,
      frame: this._fi,
      bbox: { x: b.minC, y: b.minR, w: b.maxC - b.minC, h: b.maxR - b.minR },
    });
    this._strokeBbox = null;
  }

  _bindPointer(el) {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      this._drawing = true;
      this._focused = true;
      this._strokeBbox = null;
      const p = this._cellCoord(e);

      if (this._tool === 'fill') {
        this._floodFill(p.c, p.r);
        this._refreshThumbs();
        return;
      }
      if (this._tool === 'eye') {
        this._eyedrop(p.c, p.r);
        return;
      }
      if (this._tool === 'type') {
        this._cursor = { c: p.c, r: p.r };
        this._drawCaret();
        return;
      }
      if (this._tool === 'line' || this._tool === 'rect') {
        this._startCell = p;
        this._expandBbox(p.c, p.r);
        return;
      }
      this._paintCell(p.c, p.r);
      this._expandBbox(p.c, p.r);
      this._render();
      this._refreshThumbs();
    });

    el.addEventListener('pointermove', (e) => {
      if (!this._drawing) return;
      const p = this._cellCoord(e);
      if (this._tool === 'line' || this._tool === 'rect') {
        if (this._startCell) this._drawShapePreview(this._startCell, p);
        return;
      }
      if (this._tool === 'brush' || this._tool === 'eraser') {
        this._paintCell(p.c, p.r);
        this._expandBbox(p.c, p.r);
        this._render();
        this._refreshThumbs();
      }
    });

    el.addEventListener('pointerup', (e) => {
      if (!this._drawing) return;
      this._drawing = false;
      if (this._startCell && (this._tool === 'line' || this._tool === 'rect')) {
        const p = this._cellCoord(e);
        this._expandBbox(p.c, p.r);
        this._commitShape(this._startCell, p);
        this._startCell = null;
        this._clearOverlay();
        if (this._tool === 'type') this._drawCaret();
        this._render();
        this._refreshThumbs();
        this._history?.commit();
        this._autoSave();
        this._emitStroke();
        return;
      }
      if (this._tool !== 'fill' && this._tool !== 'eye' && this._tool !== 'type') {
        this._history?.commit();
        this._autoSave();
        this._emitStroke();
      }
    });
  }

  _paintCell(c, r) {
    const frame = this._frames[this._fi];
    if (!frame) return;
    const cell =
      this._tool === 'eraser'
        ? _blank(this._fg)
        : { ch: this._char, fg: this._fg, bg: this._cellBg };
    this._setCell(frame, c, r, cell);
  }

  _eyedrop(c, r) {
    const frame = this._frames[this._fi];
    if (!frame) return;
    const cell = this._cell(frame, c, r);
    if (!cell) return;
    const prevChar = this._char;
    const prevFg = this._fg;
    this._char = cell.ch ?? ' ';
    this._fg = cell.fg ?? '#00ff41';
    this._cellBg = cell.bg ?? null;
    this._transBg = cell.bg == null;
    if (this._charInput) this._charInput.value = this._char;
    if (this._fgInput) this._fgInput.value = this._fg;
    if (this._bgInput && cell.bg) this._bgInput.value = cell.bg;
    if (this._char !== prevChar) this._events.emit('char', { char: this._char, prev: prevChar });
    if (this._fg !== prevFg) this._events.emit('color', { fg: this._fg, bg: this._cellBg });
  }

  // ── Flood fill (BFS by cell identity) ────────────────────────────────────────

  _cellEq(a, b) {
    return a.ch === b.ch && a.fg === b.fg && a.bg === b.bg;
  }

  _floodFill(pc, pr) {
    const frame = this._frames[this._fi];
    if (!frame) return;
    const target = { ...this._cell(frame, pc, pr) };
    const fill = { ch: this._char, fg: this._fg, bg: this._cellBg };
    if (this._cellEq(target, fill)) return;

    const W = this._cols,
      H = this._rows;
    const stack = [[pc, pr]];
    while (stack.length) {
      const [c, r] = stack.pop();
      if (c < 0 || c >= W || r < 0 || r >= H) continue;
      if (!this._cellEq(this._cell(frame, c, r), target)) continue;
      this._setCell(frame, c, r, { ...fill });
      stack.push([c - 1, r], [c + 1, r], [c, r - 1], [c, r + 1]);
    }
    this._render();
    this._events.emit('stroke', {
      tool: 'fill',
      fg: this._fg,
      bg: this._cellBg,
      char: this._char,
      frame: this._fi,
      bbox: { x: 0, y: 0, w: this._cols, h: this._rows },
    });
    this._history?.commit();
    this._autoSave();
  }

  // ── Shape drawing ─────────────────────────────────────────────────────────────

  _shapeLineRect(start, end) {
    const cells = [];
    const c0 = start.c,
      r0 = start.r,
      c1 = end.c,
      r1 = end.r;
    if (this._tool === 'line') {
      let dc = Math.abs(c1 - c0),
        dr = Math.abs(r1 - r0);
      let sc = c0 < c1 ? 1 : -1,
        sr = r0 < r1 ? 1 : -1;
      let err = dc - dr,
        c = c0,
        r = r0;
      for (;;) {
        cells.push([c, r]);
        if (c === c1 && r === r1) break;
        const e2 = 2 * err;
        if (e2 > -dr) {
          err -= dr;
          c += sc;
        }
        if (e2 < dc) {
          err += dc;
          r += sr;
        }
      }
    } else {
      const lc = Math.min(c0, c1),
        rc = Math.max(c0, c1);
      const tr = Math.min(r0, r1),
        br = Math.max(r0, r1);
      for (let c = lc; c <= rc; c++) {
        cells.push([c, tr]);
        if (br !== tr) cells.push([c, br]);
      }
      for (let r = tr + 1; r < br; r++) {
        cells.push([lc, r]);
        if (rc !== lc) cells.push([rc, r]);
      }
    }
    return cells;
  }

  _drawShapePreview(start, end) {
    const ov = this._overlay;
    if (!ov) return;
    const ctx = ov.getContext('2d');
    ctx.clearRect(0, 0, ov.width, ov.height);
    const cw = this._cellW,
      ch = this._cellH;
    ctx.fillStyle = this._fg + '99';
    for (const [c, r] of this._shapeLineRect(start, end)) {
      ctx.fillRect(c * cw, r * ch, cw, ch);
    }
  }

  _commitShape(start, end) {
    const frame = this._frames[this._fi];
    if (!frame) return;
    const fill = { ch: this._char, fg: this._fg, bg: this._cellBg };
    for (const [c, r] of this._shapeLineRect(start, end)) {
      this._setCell(frame, c, r, { ...fill });
    }
  }

  // ── Keyboard (type tool) ──────────────────────────────────────────────────────

  _handleKey(e) {
    const cur = this._cursor;
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      cur.c = Math.min(cur.c + 1, this._cols - 1);
      this._drawCaret();
      return;
    }
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      cur.c = Math.max(cur.c - 1, 0);
      this._drawCaret();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      cur.r = Math.min(cur.r + 1, this._rows - 1);
      this._drawCaret();
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      cur.r = Math.max(cur.r - 1, 0);
      this._drawCaret();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      cur.r = Math.min(cur.r + 1, this._rows - 1);
      cur.c = 0;
      this._drawCaret();
      return;
    }
    if (e.key === 'Backspace') {
      e.preventDefault();
      if (cur.c > 0) cur.c--;
      else if (cur.r > 0) {
        cur.r--;
        cur.c = this._cols - 1;
      }
      const frame = this._frames[this._fi];
      if (frame) this._setCell(frame, cur.c, cur.r, _blank(this._fg));
      this._render();
      this._refreshThumbs();
      this._history?.commit();
      this._autoSave();
      this._drawCaret();
      return;
    }
    if (e.key.length === 1) {
      e.preventDefault();
      const frame = this._frames[this._fi];
      if (frame) {
        this._setCell(frame, cur.c, cur.r, { ch: e.key, fg: this._fg, bg: this._cellBg });
        this._render();
        this._refreshThumbs();
        this._history?.commit();
        this._autoSave();
      }
      cur.c++;
      if (cur.c >= this._cols) {
        cur.c = 0;
        cur.r = Math.min(cur.r + 1, this._rows - 1);
      }
      this._drawCaret();
    }
  }

  // ── Grid resize ───────────────────────────────────────────────────────────────

  _resizeGrid(cols, rows) {
    this._cellEventsOn = false;
    this._frames = this._frames.map((frame) => {
      const next = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          next.push(
            r < this._rows && c < this._cols
              ? (this._cell(frame, c, r) ?? _blank(this._fg))
              : _blank(this._fg),
          );
        }
      }
      return next;
    });
    this._cols = cols;
    this._rows = rows;
    this._cursor.c = Math.min(this._cursor.c, cols - 1);
    this._cursor.r = Math.min(this._cursor.r, rows - 1);
    if (this._canvas) {
      const cw = cols * this._cellW,
        ch = rows * this._cellH;
      this._canvas.width = cw;
      this._canvas.height = ch;
      if (this._overlay) {
        this._overlay.width = cw;
        this._overlay.height = ch;
      }
    }
    this._cellEventsOn = true;
    this._render();
    this._refreshThumbs();
    this._autoSave();
  }

  // ── Export ────────────────────────────────────────────────────────────────────

  _exportCode() {
    const frames = this._frames.map((frame) => ({
      w: this._cols,
      h: this._rows,
      cells: frame.map(({ ch, fg, bg }) => ({ c: ch, f: fg, b: bg ?? null })),
    }));
    const code = `ascii.play(${JSON.stringify(frames)}, ${this._fps});`;
    insertSnippet(code);
  }

  _exportText() {
    const frame = this._frames[this._fi];
    const lines = [];
    for (let r = 0; r < this._rows; r++) {
      let line = '';
      for (let c = 0; c < this._cols; c++) line += this._cell(frame, c, r)?.ch ?? ' ';
      lines.push(line);
    }
    const text = lines.join('\n');
    downloadBlob(new Blob([text], { type: 'text/plain' }), 'ascii-art.txt');
    navigator.clipboard?.writeText(text).catch(() => {});
  }

  _exportANSI() {
    const frame = this._frames[this._fi];
    let out = '';
    for (let r = 0; r < this._rows; r++) {
      for (let c = 0; c < this._cols; c++) {
        const cell = this._cell(frame, c, r);
        const ch = cell?.ch ?? ' ';
        const fg = cell?.fg ?? this._fg;
        const bg = cell?.bg;
        out += `\x1b[38;2;${_hexToRgbStr(fg)}m`;
        out += bg ? `\x1b[48;2;${_hexToRgbStr(bg)}m` : '\x1b[49m';
        out += ch;
      }
      out += '\x1b[0m\n';
    }
    downloadBlob(new Blob([out], { type: 'text/plain' }), 'ascii-ansi.txt');
  }

  // ── Event / signal public API ─────────────────────────────────────────────────

  /** fn({ c, r, ch, fg, bg, frame }) on every cell change (brush/erase/fill/type/shape). */
  onCell(fn) {
    this._events.on('cell', fn);
    return this;
  }
  /** fn({ tool, fg, bg, char, frame, bbox:{x,y,w,h} }) at end of each stroke / fill. bbox in cell coords. */
  onStroke(fn) {
    this._events.on('stroke', fn);
    return this;
  }
  /** fn({ fg, bg, prev? }) when fg or bg color changes. */
  onColor(fn) {
    this._events.on('color', fn);
    return this;
  }
  /** fn({ char, prev }) when the active character changes. */
  onChar(fn) {
    this._events.on('char', fn);
    return this;
  }
  /** fn({ tool, prev }) when the active tool changes. */
  onTool(fn) {
    this._events.on('tool', fn);
    return this;
  }
  /** fn({ action, index, count }) on frame add/duplicate/clear/delete/move/select. */
  onFrame(fn) {
    this._events.on('frame', fn);
    return this;
  }

  /**
   * Live decaying-pulse signal.
   * @param {string} [event='cell']   — 'cell' | 'stroke' | 'color' | 'char' | 'tool' | 'frame' | '*'
   * @param {object} [opts]
   * @param {number} [opts.decay=250] — ms until value → 0
   * @param {object} [opts.region]   — { x, y, w, h } filter in cell coords (c/r)
   * @returns {{ value, velocity, stream(fn), on(fn) }}
   */
  signal(event = 'cell', opts = {}) {
    return this._events.signal(event, opts);
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────────

  _destroy() {
    this.stop();
    this._events.clear();
    if (this._keydownFn) document.removeEventListener('keydown', this._keydownFn);
    if (this._mousedownFn) document.removeEventListener('mousedown', this._mousedownFn);
    const i = _editors.indexOf(this);
    if (i !== -1) _editors.splice(i, 1);
  }
}

// Register teardown with the reset registry (ADR 008).
onReset(cleanupAsciiEditors);

// Desktop File-Type Adapter (ADR 055) — owns 'ascii' icon glyph + restore.
registerDesktopFileType('ascii', {
  glyph: 'fa-solid fa-font',
  cssClass: 'dt-ascii-icon',
  open: (data, pos) =>
    new AsciiEditor({
      cols: data.cols ?? 64,
      rows: data.rows ?? 24,
      cellW: data.cellW ?? 10,
      cellH: data.cellH ?? 18,
      fps: data.fps ?? 8,
      bg: data.bg ?? '#0d0208',
      title: data.title ?? 'ASCII Editor',
      _frames: data.frames ?? null,
      ...pos,
    }),
});

// Code-generated window restore. See widget-restorer-registry.js.
registerWidgetRestorer('ascii', (s) => {
  const ws = s.widgetState ?? {};
  new AsciiEditor({
    cols: ws.cols ?? 64,
    rows: ws.rows ?? 24,
    cellW: ws.cellW ?? 10,
    cellH: ws.cellH ?? 18,
    fps: ws.fps ?? 8,
    bg: ws.bg ?? '#0d0208',
    title: s.title ?? 'ASCII Editor',
    x: s.x,
    y: s.y,
    _desktopIconId: ws._desktopIconId,
    _frames: ws.frames ?? null,
  });
});
