// sprite-editor.js — Aseprite-inspired visual sprite editor window
// Entry: new SpriteEditor(opts), Sprite.edit(opts), sp.edit(opts), toolbar button

import { Sprite } from './sprite.js';
import { floodFill, resolveColorRGBA, expandBbox } from './raster-tools.js';
import { snapshotFrameCanvases, paintFrameCanvas, downloadCanvasPng } from './frame-snapshot.js';
import { registerWidgetRestorer } from '../wm/widget-restorer-registry.js';
import { WidgetEvents } from './widget-events.js';
import { insertSnippet } from '../../editor/active-editor.js';
import { drawCheckerboard } from '../visual/color.js';
import {
  mountWidgetShell,
  buildFrameStrip,
  buildTransport,
  wireCaptureButton,
  mkExportButton,
} from './widget-shell.js';
import { onReset } from '../../runtime/reset-registry.js';
import { registerDesktopFileType } from '../platform/desktop-file-registry.js';
import { Take } from '../signal/performance-recorder.js';
import { replayActions } from '../signal/replay-clock.js';

// FrameController adapter over a Sprite — the second implementation of the
// interface buildFrameStrip()/buildTransport() consume (FrameDoc is the first).
// Sprite owns the frame model + rendering; this adapter exposes it as a
// controller and emits the events the shared strip subscribes to. See ADR 007.
class SpriteFrameAdapter {
  constructor(sprite, fps = 8) {
    this.sp = sprite;
    this.fps = fps;
    this._onion = false;
    this._events = new WidgetEvents();
    this.thumbPixelated = true;
    this.thumbAspect = sprite._w / sprite._h;
  }
  get count() {
    return this.sp.frameCount;
  }
  get index() {
    return this.sp._fi;
  }
  get isPlaying() {
    return this.sp._iid != null;
  }
  get onion() {
    return this._onion;
  }
  set onion(v) {
    this._onion = !!v;
    this.sp.onionSkin(this._onion ? 0.3 : 0);
    this._events.emit('onion', { on: this._onion });
  }
  _mutate(action) {
    this._events.emit('mutate', { action, index: this.sp._fi, count: this.count });
  }

  go(i) {
    this.sp.frame(i);
    this._events.emit('select', { index: i, count: this.count });
  }
  add() {
    this.sp.addFrame();
    this.sp.frame(this.count - 1);
    this._mutate('add');
  }
  duplicate() {
    this.sp.duplicateFrame();
    this._mutate('duplicate');
  }
  clearCurrent() {
    this.sp.clear();
    this._mutate('clear');
  }
  remove() {
    if (this.sp.frameCount <= 1) return;
    this.sp.removeFrame();
    this._mutate('delete');
  }
  move(dir) {
    const before = this.index;
    this.sp.moveFrame(dir);
    if (this.index !== before) this._mutate('move');
  }
  play(fps) {
    this.sp.play(fps);
  }
  stop() {
    this.sp.stop();
  }
  drawThumb(tc, i) {
    this.sp.drawFrameTo(tc, i);
  }
  on(evt, fn) {
    this._events.on(evt, fn);
  }
}

const _editors = [];

export function cleanupSpriteEditors() {
  for (const ed of [..._editors]) ed._destroy();
  _editors.length = 0;
}

const PALETTE = [
  '#000000',
  '#ffffff',
  '#ff0000',
  '#00ff00',
  '#0000ff',
  '#ffff00',
  '#ff00ff',
  '#00ffff',
  '#ff8800',
  '#8800ff',
  '#00ff88',
  '#ff0088',
];

const TOOLS = [
  { id: 'pencil', icon: '<i class="fa-solid fa-pencil"></i>', title: 'Pencil (draw)' },
  { id: 'eraser', icon: '<i class="fa-solid fa-eraser"></i>', title: 'Eraser' },
  { id: 'fill', icon: '<i class="fa-solid fa-fill-drip"></i>', title: 'Fill bucket (flood fill)' },
  { id: 'eye', icon: '<i class="fa-solid fa-eye-dropper"></i>', title: 'Eyedropper (pick color)' },
  { id: 'line', icon: '<i class="fa-solid fa-minus"></i>', title: 'Line' },
  { id: 'rect', icon: '<i class="fa-regular fa-square"></i>', title: 'Rectangle (outline)' },
  { id: 'rectfill', icon: '<i class="fa-solid fa-square"></i>', title: 'Rectangle (filled)' },
  {
    id: 'circle',
    icon: '<i class="fa-regular fa-circle"></i>',
    title: 'Circle (outline) — drag from center',
  },
  {
    id: 'circlefill',
    icon: '<i class="fa-solid fa-circle"></i>',
    title: 'Circle (filled) — drag from center',
  },
];

// Drag-shape tools: pointerdown sets a start cell, drag previews, pointerup commits.
const SHAPE_TOOLS = ['line', 'rect', 'rectfill', 'circle', 'circlefill'];

const ACTIVE_COLOR = '#cba6f7';
const INACTIVE_BORDER = '#45475a';

export class SpriteEditor {
  constructor({
    sprite = null,
    width = 16,
    height = 16,
    scale = 20,
    frames = 1,
    title = 'Pixel Art',
    _desktopIconId = null,
    x,
    y,
  } = {}) {
    if (sprite) {
      this.sprite = sprite;
      this._ownSprite = false;
    } else {
      this.sprite = new Sprite({ width, height, scale, frames });
      this._ownSprite = true;
    }

    this._scale = this.sprite._scale;
    this._tool = 'pencil';
    this._color = '#ff0000';
    this._drawing = false;
    this._startPx = null;
    this._strokeBbox = null;
    this._winId = null;
    this._overlay = null;
    this._gridOn = true;
    this._gridSnap = null;
    this._colorInput = null;
    this._title = title;
    this._desktopIconId = _desktopIconId;

    // Frame controller over the Sprite (see SpriteFrameAdapter / ADR 007).
    this._fd = new SpriteFrameAdapter(this.sprite, 8);

    // Replaced per-instance by the shell in _init(); no-ops until then.
    this._autoSave = () => {};
    this._refreshThumbs = () => {};

    this._events = new WidgetEvents();
    this._take = new Take(this); // Performance capture (ADR 031)
    _editors.push(this);
    this._init(title, x, y);
    if (!_desktopIconId) this._autoSave();
  }

  // fps/onion live on the frame controller; proxies keep existing references.
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

  // ── Window ───────────────────────────────────────────────────────────────────

  _init(title, x, y) {
    if (!window.wm) return;
    const sp = this.sprite;
    const cw = sp.canvas.width;
    const ch = sp.canvas.height;
    const winW = cw + 28;
    const winH = 40 + 30 + ch + 14 + 78 + 38;

    const fd = this._fd;
    const strip = buildFrameStrip(fd);

    // title-first ergonomics over the shared chassis button (canonical order is
    // html, color, fn, title — see widget-shell.mkExportButton).
    const mkExport = (html, color, title, fn) => mkExportButton(html, color, fn, title);
    const transport = buildTransport(fd, {
      onFpsChange: () => this._autoSave(),
      extraButtons: [
        mkExport(
          '<i class="fa-solid fa-file-import"></i> Import',
          '#cba6f7',
          'Import a PNG or sprite sheet',
          () => this._importImage(),
        ),
        mkExport(
          '<i class="fa-solid fa-code"></i> Code',
          '#89b4fa',
          'Insert sprite as code into the editor',
          () => this._exportCode(),
        ),
        mkExport(
          '<i class="fa-solid fa-download"></i> PNG',
          '#a6e3a1',
          'Download current frame as PNG',
          () => this._exportPng(false),
        ),
        mkExport(
          '<i class="fa-solid fa-film"></i> Sheet',
          '#f9e2af',
          'Download all frames as a sprite sheet PNG',
          () => this._exportPng(true),
        ),
        wireCaptureButton(
          mkExport(
            '<i class="fa-solid fa-circle"></i> Rec',
            '#f38ba8',
            'Capture a performance → replay code',
            () => {},
          ),
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
      widgetType: 'spriteEditor',
      rows: [
        this._buildToolRow(),
        this._buildPaletteRow(),
        this._buildCanvasArea(),
        strip.el,
        transport,
      ],
      getState: () => this._getState(),
      save: {
        name: (this._title || 'Sprite') + '.sprite',
        type: 'sprite',
        getIconId: () => this._desktopIconId,
        setIconId: (id) => {
          this._desktopIconId = id;
        },
      },
      history: {
        capture: () => this._snapPixels(),
        restore: (snap) => this._applyPixels(snap),
      },
      onMount: () => this._drawGrid(),
      onDestroy: () => this._destroy(),
    });
    if (!shell) return;
    this._winId = shell.winId;
    this._autoSave = shell.save;
    this._refreshThumbs = strip.refreshThumbs;
    this._history = shell.history;

    // Sprite renders inside the adapter ops; here we only persist + re-emit.
    fd.on('mutate', (e) => {
      this._history?.commit();
      this._autoSave();
      this._events.emit('frame', e);
    });
    fd.on('select', (e) => {
      this._take.push({ op: 'frame', i: e.index });
      this._events.emit('frame', { action: 'select', index: e.index, count: e.count });
    });
  }

  // ── Pixel snapshots (for undo/redo — raw RGBA, not PNG) ──────────────────────

  _snapPixels() {
    const sp = this.sprite;
    return { fi: sp._fi, frames: snapshotFrameCanvases(sp._frames, sp._w, sp._h) };
  }

  _applyPixels(snap) {
    const sp = this.sprite;
    // Reconcile frame count
    while (sp._frames.length < snap.frames.length) sp.addFrame();
    sp._frames.length = snap.frames.length;
    snap.frames.forEach((data, i) => paintFrameCanvas(sp._frames[i], sp._w, sp._h, data));
    sp.frame(snap.fi);
    sp._render();
    this._refreshThumbs();
  }

  _getState() {
    const sp = this.sprite;
    return {
      title: this._title,
      width: sp._w,
      height: sp._h,
      scale: sp._scale,
      fps: this._fps,
      frames: sp._frames.map((fc) => fc.toDataURL('image/png')),
      _desktopIconId: this._desktopIconId,
    };
  }

  // ── Tool row ─────────────────────────────────────────────────────────────────

  // Centralised color setter — emits 'color' event
  _setColor(c) {
    const prev = this._color;
    this._color = c;
    if (this._colorInput) this._colorInput.value = c;
    this._events.emit('color', { color: c, prev });
  }

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
        'cursor:pointer;display:flex;align-items:center;justify-content:center;',
        'padding:0;transition:border-color 0.1s;',
      ].join('');
      btn.innerHTML = t.icon;
      btn.addEventListener('click', () => {
        const prev = this._tool;
        this._tool = t.id;
        row.querySelectorAll('button[data-tool]').forEach((b) => {
          b.style.borderColor = b.dataset.tool === this._tool ? ACTIVE_COLOR : INACTIVE_BORDER;
        });
        this._events.emit('tool', { tool: this._tool, prev });
      });
      row.appendChild(btn);
    });

    // Divider between tools and view controls.
    const sep = document.createElement('span');
    sep.style.cssText = 'width:1px;background:#45475a;margin:2px 3px;align-self:stretch;';
    row.appendChild(sep);

    const mkCtrl = (icon, title, fn) => {
      const b = document.createElement('button');
      b.title = title;
      b.innerHTML = icon;
      b.style.cssText = [
        'background:#313244;border:2px solid ' + INACTIVE_BORDER + ';',
        'border-radius:5px;color:#cdd6f4;font-size:14px;width:30px;height:28px;',
        'cursor:pointer;display:flex;align-items:center;justify-content:center;',
        'padding:0;transition:border-color 0.1s;',
      ].join('');
      b.addEventListener('click', () => fn(b));
      return b;
    };

    // Grid toggle — starts active (grid on).
    const gridBtn = mkCtrl('<i class="fa-solid fa-border-all"></i>', 'Toggle pixel grid', (b) => {
      this._gridOn = !this._gridOn;
      b.style.borderColor = this._gridOn ? ACTIVE_COLOR : INACTIVE_BORDER;
      this._drawGrid();
    });
    gridBtn.style.borderColor = ACTIVE_COLOR;
    row.appendChild(gridBtn);

    // Resize the pixel grid (resolution).
    row.appendChild(
      mkCtrl(
        '<i class="fa-solid fa-up-right-and-down-left-from-center"></i>',
        'Resize the pixel grid',
        () => this._promptResize(),
      ),
    );

    return row;
  }

  // ── Palette row ───────────────────────────────────────────────────────────────

  _buildPaletteRow() {
    const row = document.createElement('div');
    row.style.cssText =
      'display:flex;gap:3px;padding:3px 8px 4px;flex-shrink:0;align-items:center;flex-wrap:wrap;';

    const mkSwatch = (bg, title) => {
      const sw = document.createElement('button');
      sw.title = title;
      sw.style.cssText = `width:20px;height:20px;background:${bg};border:2px solid ${INACTIVE_BORDER};
        border-radius:3px;cursor:pointer;padding:0;flex-shrink:0;`;
      return sw;
    };

    PALETTE.forEach((c) => {
      const sw = mkSwatch(c, c);
      sw.addEventListener('click', () => {
        this._setColor(c);
        this._highlightSwatch(row, null);
      });
      row.appendChild(sw);
    });

    // Transparent (checker) swatch
    const transSw = mkSwatch('transparent', 'Transparent / erase');
    transSw.style.backgroundImage = [
      'linear-gradient(45deg,#666 25%,transparent 25%,transparent 75%,#666 75%)',
      'linear-gradient(45deg,#666 25%,transparent 25%,transparent 75%,#666 75%)',
    ].join(',');
    transSw.style.backgroundSize = '8px 8px';
    transSw.style.backgroundPosition = '0 0,4px 4px';
    transSw.addEventListener('click', () => {
      const prev = this._color;
      this._color = 'transparent';
      this._highlightSwatch(row, transSw);
      this._events.emit('color', { color: 'transparent', prev });
    });
    row.appendChild(transSw);

    const colorIn = document.createElement('input');
    colorIn.type = 'color';
    colorIn.value = this._color;
    colorIn.title = 'Custom color';
    colorIn.style.cssText =
      'width:24px;height:24px;border:none;border-radius:3px;cursor:pointer;padding:0;background:none;flex-shrink:0;';
    colorIn.addEventListener('input', () => {
      this._setColor(colorIn.value);
      this._highlightSwatch(row, null);
    });
    row.appendChild(colorIn);
    this._colorInput = colorIn;

    return row;
  }

  _highlightSwatch(row, active) {
    row.querySelectorAll('button').forEach((b) => {
      b.style.borderColor = INACTIVE_BORDER;
    });
    if (active) active.style.borderColor = ACTIVE_COLOR;
  }

  // ── Canvas area ───────────────────────────────────────────────────────────────

  _buildCanvasArea() {
    const sp = this.sprite;
    const wrap = document.createElement('div');
    wrap.style.cssText = `position:relative;width:${sp.canvas.width}px;height:${sp.canvas.height}px;
      flex-shrink:0;overflow:hidden;align-self:center;margin:6px auto;`;

    // Checkerboard layer (transparency indicator)
    const checker = document.createElement('canvas');
    checker.width = sp.canvas.width;
    checker.height = sp.canvas.height;
    const cctx = checker.getContext('2d');
    drawCheckerboard(cctx, checker.width, checker.height, 4);
    checker.style.cssText = 'position:absolute;top:0;left:0;image-rendering:pixelated;';
    this._checker = checker;

    // Sprite display canvas
    sp.canvas.style.position = 'absolute';
    sp.canvas.style.top = '0';
    sp.canvas.style.left = '0';
    sp.canvas.style.imageRendering = 'pixelated';

    // Overlay (grid + shape preview)
    const ov = document.createElement('canvas');
    ov.width = sp.canvas.width;
    ov.height = sp.canvas.height;
    ov.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;';
    this._overlay = ov;

    // Hit target (transparent, captures pointer events)
    const hit = document.createElement('canvas');
    hit.width = sp.canvas.width;
    hit.height = sp.canvas.height;
    hit.style.cssText = 'position:absolute;top:0;left:0;cursor:crosshair;opacity:0;';
    this._hit = hit;

    wrap.appendChild(checker);
    wrap.appendChild(sp.canvas);
    wrap.appendChild(ov);
    wrap.appendChild(hit);
    this._wrap = wrap;

    this._bindPointer(hit);
    return wrap;
  }

  // ── Pointer handling ──────────────────────────────────────────────────────────

  _pxCoord(e) {
    const rect = e.target.getBoundingClientRect();
    const sc = this._scale;
    const sp = this.sprite;
    return {
      x: Math.max(0, Math.min(sp._w - 1, Math.floor((e.clientX - rect.left) / sc))),
      y: Math.max(0, Math.min(sp._h - 1, Math.floor((e.clientY - rect.top) / sc))),
    };
  }

  _expandBbox(x, y) {
    this._strokeBbox = expandBbox(this._strokeBbox, x, y);
  }

  _emitStroke() {
    const b = this._strokeBbox;
    if (!b) return;
    this._events.emit('stroke', {
      tool: this._tool,
      color: this._color,
      frame: this.sprite._fi,
      bbox: { x: b.minX, y: b.minY, w: b.maxX - b.minX, h: b.maxY - b.minY },
    });
    this._strokeBbox = null;
  }

  _bindPointer(el) {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      this._drawing = true;
      this._strokeBbox = null;
      const p = this._pxCoord(e);

      if (this._tool === 'fill') {
        this._floodFill(p.x, p.y);
        this._refreshThumbs();
        return;
      }
      if (this._tool === 'eye') {
        this._eyedrop(p.x, p.y);
        return;
      }
      if (SHAPE_TOOLS.includes(this._tool)) {
        this._startPx = p;
        this._expandBbox(p.x, p.y);
        return;
      }
      // pencil / eraser
      this._paintAt(p.x, p.y);
      this._expandBbox(p.x, p.y);
      this._refreshThumbs();
    });

    el.addEventListener('pointermove', (e) => {
      if (!this._drawing) return;
      const p = this._pxCoord(e);
      if (SHAPE_TOOLS.includes(this._tool)) {
        if (this._startPx) this._drawPreview(this._startPx, p);
        return;
      }
      if (this._tool === 'pencil' || this._tool === 'eraser') {
        this._paintAt(p.x, p.y);
        this._expandBbox(p.x, p.y);
        this._refreshThumbs();
      }
    });

    el.addEventListener('pointerup', (e) => {
      if (!this._drawing) return;
      this._drawing = false;
      if (this._startPx && SHAPE_TOOLS.includes(this._tool)) {
        const p = this._pxCoord(e);
        this._expandBbox(p.x, p.y);
        this._commitShape(this._startPx, p);
        this._startPx = null;
        this._restoreGrid();
        this._refreshThumbs();
        this._history?.commit();
        this._autoSave();
      }
      this._emitStroke();
    });
  }

  _paintAt(px, py) {
    const color = this._tool === 'eraser' ? 'transparent' : this._color;
    this.sprite.pixel(px, py, color);
    this._take.push({ op: 'pixel', x: px, y: py, color });
    this._events.emit('pixel', { x: px, y: py, color, frame: this.sprite._fi });
    this._history?.commit();
    this._autoSave();
  }

  // ── Performance capture / replay (ADR 031) ──────────────────────────────────
  _applyAction(a) {
    if (!a) return;
    if (a.op === 'frame') this.sprite.frame(a.i);
    else if (a.op === 'pixel') this.sprite.pixel(a.x, a.y, a.color);
  }

  replay(actions, opts) {
    return replayActions((act) => this._applyAction(act), actions, opts);
  }

  _perfCtor() {
    const sp = this.sprite;
    return {
      varName: 'sp',
      code: `const sp = new SpriteEditor({ title: '${String(this._title).replace(/'/g, "\\'")}', width: ${sp._w}, height: ${sp._h}, scale: ${this._scale} });`,
    };
  }

  _eyedrop(px, py) {
    const ctx = this.sprite.ctx();
    if (!ctx) return;
    const [r, g, b, a] = ctx.getImageData(px, py, 1, 1).data;
    const c =
      a === 0
        ? 'transparent'
        : '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('');
    this._setColor(c);
  }

  // ── Flood fill (BFS on frame pixel data) ─────────────────────────────────────

  _floodFill(px, py) {
    const sp = this.sprite;
    const ctx = sp.ctx();
    if (!ctx) return;
    if (!floodFill(ctx, sp._w, sp._h, px, py, resolveColorRGBA(this._color))) return;
    sp._render();
    this._events.emit('stroke', {
      tool: 'fill',
      color: this._color,
      frame: sp._fi,
      bbox: { x: 0, y: 0, w: sp._w, h: sp._h },
    });
    this._history?.commit();
    this._autoSave();
  }

  // ── Overlay — grid + shape preview ───────────────────────────────────────────

  _drawGrid() {
    const ov = this._overlay;
    if (!ov) return;
    const ctx = ov.getContext('2d');
    ctx.clearRect(0, 0, ov.width, ov.height);
    const sc = this._scale;
    if (this._gridOn) {
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 0.5;
      for (let x = sc; x < ov.width; x += sc) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, ov.height);
        ctx.stroke();
      }
      for (let y = sc; y < ov.height; y += sc) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(ov.width, y);
        ctx.stroke();
      }
    }
    this._gridSnap = ctx.getImageData(0, 0, ov.width, ov.height);
  }

  _restoreGrid() {
    if (this._overlay && this._gridSnap) {
      this._overlay.getContext('2d').putImageData(this._gridSnap, 0, 0);
    }
  }

  // Midpoint circle / filled disc — pixel coords centered on (cx,cy), radius r.
  _circlePixels(cx, cy, r, filled) {
    const pts = [];
    if (r <= 0) {
      pts.push([cx, cy]);
      return pts;
    }
    if (filled) {
      for (let dy = -r; dy <= r; dy++) {
        const dx = Math.round(Math.sqrt(r * r - dy * dy));
        for (let x = cx - dx; x <= cx + dx; x++) pts.push([x, cy + dy]);
      }
      return pts;
    }
    let x = r,
      y = 0,
      err = 1 - r;
    while (x >= y) {
      pts.push(
        [cx + x, cy + y],
        [cx - x, cy + y],
        [cx + x, cy - y],
        [cx - x, cy - y],
        [cx + y, cy + x],
        [cx - y, cy + x],
        [cx + y, cy - x],
        [cx - y, cy - x],
      );
      y++;
      if (err < 0) err += 2 * y + 1;
      else {
        x--;
        err += 2 * (y - x) + 1;
      }
    }
    return pts;
  }

  _drawPreview(start, end) {
    this._restoreGrid();
    const ctx = this._overlay.getContext('2d');
    const sc = this._scale;
    const previewColor = this._color === 'transparent' ? 'rgba(255,255,255,0.5)' : this._color;
    ctx.fillStyle = previewColor;
    ctx.strokeStyle = previewColor;
    ctx.lineWidth = sc;
    ctx.lineCap = 'square';

    if (this._tool === 'circle' || this._tool === 'circlefill') {
      const r = Math.round(Math.hypot(end.x - start.x, end.y - start.y));
      const pts = this._circlePixels(start.x, start.y, r, this._tool === 'circlefill');
      for (const [px, py] of pts) ctx.fillRect(px * sc, py * sc, sc, sc);
      return;
    }

    const x1 = start.x * sc + sc / 2,
      y1 = start.y * sc + sc / 2;
    const x2 = end.x * sc + sc / 2,
      y2 = end.y * sc + sc / 2;

    if (this._tool === 'line') {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    } else {
      const rx = Math.min(x1, x2) - sc / 2;
      const ry = Math.min(y1, y2) - sc / 2;
      const rw = Math.abs(x2 - x1) + sc;
      const rh = Math.abs(y2 - y1) + sc;
      if (this._tool === 'rectfill') {
        ctx.fillRect(rx, ry, rw, rh);
      } else {
        ctx.lineWidth = sc;
        ctx.strokeRect(rx + sc / 2, ry + sc / 2, rw - sc, rh - sc);
      }
    }
  }

  _commitShape(start, end) {
    const sp = this.sprite;
    const color = this._color;
    const x0 = start.x,
      y0 = start.y,
      x1 = end.x,
      y1 = end.y;

    if (this._tool === 'circle' || this._tool === 'circlefill') {
      const r = Math.round(Math.hypot(x1 - x0, y1 - y0));
      for (const [x, y] of this._circlePixels(x0, y0, r, this._tool === 'circlefill')) {
        if (x >= 0 && x < sp._w && y >= 0 && y < sp._h) sp.pixel(x, y, color);
      }
    } else if (this._tool === 'line') {
      // Bresenham
      let dx = Math.abs(x1 - x0),
        dy = Math.abs(y1 - y0);
      let sx = x0 < x1 ? 1 : -1,
        sy = y0 < y1 ? 1 : -1;
      let err = dx - dy,
        x = x0,
        y = y0;
      for (;;) {
        sp.pixel(x, y, color);
        if (x === x1 && y === y1) break;
        const e2 = 2 * err;
        if (e2 > -dy) {
          err -= dy;
          x += sx;
        }
        if (e2 < dx) {
          err += dx;
          y += sy;
        }
      }
    } else {
      const lx = Math.min(x0, x1),
        rx = Math.max(x0, x1);
      const ty = Math.min(y0, y1),
        by = Math.max(y0, y1);
      if (this._tool === 'rectfill') {
        for (let y = ty; y <= by; y++) for (let x = lx; x <= rx; x++) sp.pixel(x, y, color);
      } else {
        for (let x = lx; x <= rx; x++) {
          sp.pixel(x, ty, color);
          sp.pixel(x, by, color);
        }
        for (let y = ty + 1; y < by; y++) {
          sp.pixel(lx, y, color);
          sp.pixel(rx, y, color);
        }
      }
    }
  }

  // ── Resize / Import ───────────────────────────────────────────────────────────

  _paintChecker() {
    const ch = this._checker;
    if (!ch) return;
    drawCheckerboard(ch.getContext('2d'), ch.width, ch.height, 4);
  }

  // Resize the pixel grid to w×h. Existing art is kept top-left aligned (clipped).
  // Pass `replaceFrames` to swap the frame set wholesale (used by import).
  _resize(w, h, replaceFrames = null) {
    const sp = this.sprite;
    w = Math.max(1, Math.min(256, Math.floor(w)));
    h = Math.max(1, Math.min(256, Math.floor(h)));

    if (replaceFrames) {
      sp._frames = replaceFrames;
      sp._fi = Math.min(sp._fi, replaceFrames.length - 1);
    } else {
      sp._frames = sp._frames.map((old) => {
        const nc = document.createElement('canvas');
        nc.width = w;
        nc.height = h;
        nc.getContext('2d').drawImage(old, 0, 0); // top-left, clips overflow
        return nc;
      });
    }
    sp._w = w;
    sp._h = h;

    const cw = w * sp._scale,
      ch = h * sp._scale;
    sp.canvas.width = cw;
    sp.canvas.height = ch;
    sp._dctx.imageSmoothingEnabled = false; // reset by canvas resize

    for (const el of [this._checker, this._overlay, this._hit]) {
      if (el) {
        el.width = cw;
        el.height = ch;
      }
    }
    this._paintChecker();
    if (this._wrap) {
      this._wrap.style.width = cw + 'px';
      this._wrap.style.height = ch + 'px';
    }
    this._fd.thumbAspect = w / h;

    if (this._winId && window.wm) {
      window.wm.resize(this._winId, cw + 28, 40 + 30 + ch + 14 + 78 + 38);
    }

    sp._render();
    this._drawGrid();
    this._refreshThumbs();
    this._history?.commit();
    this._autoSave();
  }

  _promptResize() {
    const sp = this.sprite;
    const ans = window.prompt('Grid size (width × height):', `${sp._w} x ${sp._h}`);
    if (!ans) return;
    const m = ans.match(/(\d+)\s*[x×,\s]\s*(\d+)/i);
    if (!m) return;
    this._resize(parseInt(m[1], 10), parseInt(m[2], 10));
  }

  // Import a PNG / sprite sheet. A multi-frame sheet is sliced horizontally into
  // `frames` cells of equal width (each cell becomes a frame).
  _importImage() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return;
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(img.src);
        const guess =
          img.naturalWidth > img.naturalHeight && img.naturalWidth % img.naturalHeight === 0
            ? img.naturalWidth / img.naturalHeight
            : 1;
        let frames = guess;
        if (img.naturalWidth !== img.naturalHeight || guess > 1) {
          const ans = window.prompt(
            'How many frames in this image? (1 = single sprite)',
            String(guess),
          );
          if (ans === null) return;
          frames = Math.max(1, parseInt(ans, 10) || 1);
        }
        const fw = Math.floor(img.naturalWidth / frames);
        const fh = img.naturalHeight;
        const newFrames = [];
        for (let i = 0; i < frames; i++) {
          const c = document.createElement('canvas');
          c.width = fw;
          c.height = fh;
          c.getContext('2d').drawImage(img, i * fw, 0, fw, fh, 0, 0, fw, fh);
          newFrames.push(c);
        }
        this._resize(fw, fh, newFrames);
      };
      img.src = URL.createObjectURL(file);
    });
    input.click();
  }

  // ── Export ────────────────────────────────────────────────────────────────────

  _exportCode() {
    const sp = this.sprite;
    const lines = [
      `const sp = new Sprite({ width: ${sp._w}, height: ${sp._h}, scale: ${sp._scale}, frames: ${sp.frameCount} });`,
    ];

    sp._frames.forEach((fc, fi) => {
      if (fi > 0) lines.push(`sp.addFrame();`);
      if (fi !== 0 || sp.frameCount > 1) lines.push(`sp.frame(${fi});`);

      const ctx = fc.getContext('2d');
      const data = ctx.getImageData(0, 0, sp._w, sp._h).data;

      for (let y = 0; y < sp._h; y++) {
        let runStart = -1,
          runColor = null,
          runLen = 0;

        const flush = () => {
          if (runColor === null) return;
          if (runLen === 1) lines.push(`sp.pixel(${runStart}, ${y}, '${runColor}');`);
          else lines.push(`sp.fill(${runStart}, ${y}, ${runLen}, 1, '${runColor}');`);
          runColor = null;
          runLen = 0;
        };

        for (let x = 0; x < sp._w; x++) {
          const i = (y * sp._w + x) * 4;
          if (data[i + 3] === 0) {
            flush();
            continue;
          }
          const hex =
            '#' +
            [data[i], data[i + 1], data[i + 2]]
              .map((n) => n.toString(16).padStart(2, '0'))
              .join('');
          if (hex === runColor) {
            runLen++;
          } else {
            flush();
            runStart = x;
            runColor = hex;
            runLen = 1;
          }
        }
        flush();
      }
    });

    if (sp.frameCount > 1) lines.push(`sp.play(8);`);
    lines.push(`sp.show('Sprite');`);

    const code = lines.join('\n');
    insertSnippet(code);
  }

  _exportPng(sheet) {
    const sp = this.sprite;
    const src = sheet
      ? (() => {
          const c = document.createElement('canvas');
          c.width = sp._w * sp.frameCount;
          c.height = sp._h;
          const ctx = c.getContext('2d');
          sp._frames.forEach((fc, i) => ctx.drawImage(fc, i * sp._w, 0));
          return c;
        })()
      : sp._frames[sp._fi];

    const out = document.createElement('canvas');
    out.width = src.width * sp._scale;
    out.height = src.height * sp._scale;
    const octx = out.getContext('2d');
    octx.imageSmoothingEnabled = false;
    octx.drawImage(src, 0, 0, out.width, out.height);

    downloadCanvasPng(out, sheet ? 'sprite-sheet.png' : 'sprite-frame.png');
  }

  // ── Event / signal public API ─────────────────────────────────────────────────

  /** fn({ x, y, color, frame }) on every pixel painted (per-pixel granularity). */
  onPixel(fn) {
    this._events.on('pixel', fn);
    return this;
  }
  /** fn({ tool, color, frame, bbox:{x,y,w,h} }) at the end of each stroke / fill. */
  onStroke(fn) {
    this._events.on('stroke', fn);
    return this;
  }
  /** fn({ color, prev }) when the active color changes. */
  onColor(fn) {
    this._events.on('color', fn);
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
   * @param {string} [event='pixel']  — 'pixel' | 'stroke' | 'color' | 'tool' | 'frame' | '*'
   * @param {object} [opts]
   * @param {number} [opts.decay=250] — ms until value → 0
   * @param {object} [opts.region]   — { x, y, w, h } filter in sprite px (scale-independent)
   * @returns {{ value, velocity, stream(fn), on(fn) }}
   */
  signal(event = 'pixel', opts = {}) {
    return this._events.signal(event, opts);
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────────

  _destroy() {
    this.sprite.stop();
    this._events.clear();
    const i = _editors.indexOf(this);
    if (i !== -1) _editors.splice(i, 1);
  }
}

// Register teardown with the reset registry (ADR 008).
onReset(cleanupSpriteEditors);

// Desktop File-Type Adapter (ADR 055) — owns 'sprite' icon glyph + restore.
// Frame reconstruction lives here so the platform module (desktop-files.js) never
// reaches into Sprite fields; drawImageToFrame is the door it restores through.
registerDesktopFileType('sprite', {
  glyph: 'fa-solid fa-border-all',
  cssClass: 'dt-sprite-icon',
  open: (data, pos) => {
    const sp = new Sprite({
      width: data.width,
      height: data.height,
      scale: data.scale,
      frames: data.frames?.length ?? 1,
    });
    const frameUrls = data.frames ?? [];
    const open = () => new SpriteEditor({ sprite: sp, title: data.title, ...pos });
    if (!frameUrls.length) return open();
    let loaded = 0;
    frameUrls.forEach((url, i) => {
      const img = new Image();
      img.onload = () => {
        sp.drawImageToFrame(i, img);
        if (++loaded === frameUrls.length) open();
      };
      img.onerror = () => {
        if (++loaded === frameUrls.length) open();
      };
      img.src = url;
    });
  },
});

// Code-generated window restore. Paints frames through the public
// Sprite.drawImageToFrame (ADR 055) — no reach into Sprite privates.
registerWidgetRestorer('spriteEditor', (s) => {
  const ws = s.widgetState ?? {};
  const sp = new Sprite({
    width: ws.width ?? 16,
    height: ws.height ?? 16,
    scale: ws.scale ?? 20,
    frames: ws.frames?.length ?? 1,
  });
  const frameUrls = ws.frames ?? [];
  let loaded = 0;
  const open = () =>
    new SpriteEditor({
      sprite: sp,
      title: s.title,
      x: s.x,
      y: s.y,
      _desktopIconId: ws._desktopIconId,
    });
  if (!frameUrls.length) {
    open();
    return;
  }
  frameUrls.forEach((url, i) => {
    const img = new Image();
    img.onload = () => {
      sp.drawImageToFrame(i, img);
      if (++loaded === frameUrls.length) open();
    };
    img.onerror = () => {
      if (++loaded === frameUrls.length) open();
    };
    img.src = url;
  });
});
