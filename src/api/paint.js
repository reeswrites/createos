// paint.js — freehand doodle canvas editor window
// Entry: new Paint(opts), paint(opts) factory, toolbar 🖌️ button
// Sibling to SpriteEditor; reuses WidgetHistory, wm.addHistoryControls, desktop autosave.

import { WidgetEvents }  from './widget-events.js';
import { insertSnippet } from '../editor/active-editor.js';
import { FrameDoc } from './frame-doc.js';
import { mountWidgetShell, buildFrameStrip, buildTransport, wireCaptureButton } from './widget-shell.js';
import { onReset } from '../runtime/reset-registry.js';
import { TextLayer } from './text-layer.js';
import { Take } from './performance-recorder.js';
import { replayActions } from './replay-clock.js';

const _paints = [];

export function cleanupPaints() {
  for (const p of [..._paints]) p._destroy();
  _paints.length = 0;
}

// ── Default palette (same 12 swatches as sprite editor) ───────────────────────
const PALETTE = [
  '#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff',
  '#ffff00', '#ff00ff', '#00ffff', '#ff8800', '#8800ff',
  '#00ff88', '#ff0088',
];

// ── Tool definitions ────────────────────────────────────────────────────────────
const TOOLS = [
  { id: 'pen',     icon: '<i class="fa-solid fa-pen"></i>',           title: 'Pen (freehand)' },
  { id: 'eraser',  icon: '<i class="fa-solid fa-eraser"></i>',        title: 'Eraser' },
  { id: 'line',    icon: '<i class="fa-solid fa-minus"></i>',         title: 'Line' },
  { id: 'rect',    icon: '<i class="fa-regular fa-square"></i>',      title: 'Rectangle (outline)' },
  { id: 'ellipse', icon: '<i class="fa-regular fa-circle"></i>',      title: 'Ellipse (outline)' },
  { id: 'fill',    icon: '<i class="fa-solid fa-fill-drip"></i>',     title: 'Fill bucket (flood fill)' },
  { id: 'eye',     icon: '<i class="fa-solid fa-eye-dropper"></i>',   title: 'Eyedropper (pick color)' },
  { id: 'text',    icon: '<i class="fa-solid fa-font"></i>',          title: 'Text (T)' },
];

// ── Canvas-size presets ─────────────────────────────────────────────────────────
const SIZE_PRESETS = [
  { label: '400×300', w: 400, h: 300 },
  { label: '800×600', w: 800, h: 600 },
  { label: '320×240', w: 320, h: 240 },
  { label: '512×512', w: 512, h: 512 },
  { label: '1280×720', w: 1280, h: 720 },
];

const ACTIVE_COLOR    = '#cba6f7';
const INACTIVE_BORDER = '#45475a';

export class Paint {
  constructor({
    width  = 400,
    height = 300,
    frames = 1,
    bg     = '#ffffff',
    fps    = 8,
    title  = 'Paint',
    _desktopIconId = null,
    x, y,
    // Backdrop: image/video shown beneath strokes as a reference layer.
    // backdrop:     URL string | HTMLImageElement | HTMLVideoElement | dataURL | null
    // backdropMode: 'image' (static / frozen frame) | 'live' (video keeps playing)
    backdrop     = null,
    backdropMode = 'image',
    // Internal: pre-loaded frame canvases (from restore)
    _frameCanvases = null,
  } = {}) {
    this._w     = width;
    this._h     = height;
    this._bg    = bg;
    this._title = title;
    this._desktopIconId = _desktopIconId;

    this._tool    = 'pen';
    this._color   = '#000000';
    this._brush   = 6;
    this._drawing = false;
    this._startXY = null;   // { x, y } screen coords for shape tools
    this._lastXY  = null;   // previous pointer pos for smooth curves
    this._prevXY  = null;   // two-back pointer pos for smooth curves
    this._strokeBbox = null; // { minX, minY, maxX, maxY } accumulated during stroke
    this._textLayer = null;  // TextLayer — created in _buildCanvasArea
    this._hitCanvas = null;  // transparent event-catching canvas in wrap

    this._events = new WidgetEvents();
    this._take    = new Take(this);  // Performance capture (ADR 031)
    this._recStroke = null;          // in-flight captured stroke action
    this._recLast   = 0;             // last point timestamp (for per-point dt)

    // Frame model (canvas frames) — see frame-doc.js. Hooks supply the
    // raster-specific operations; the model owns frames/index/transport/onion.
    const mkCanvas = () => {
      const fc = document.createElement('canvas');
      fc.width = this._w; fc.height = this._h;
      if (this._bg !== 'transparent') {
        const c = fc.getContext('2d');
        c.fillStyle = this._bg;
        c.fillRect(0, 0, this._w, this._h);
      }
      return fc;
    };
    const seed = [];
    const count = _frameCanvases ? _frameCanvases.length : frames;
    for (let i = 0; i < count; i++) {
      if (_frameCanvases) {
        const fc = document.createElement('canvas');
        fc.width = width; fc.height = height;
        fc.getContext('2d').drawImage(_frameCanvases[i], 0, 0);
        seed.push(fc);
      } else {
        seed.push(mkCanvas());
      }
    }
    this._fd = new FrameDoc({
      frames: seed,
      fps,
      createBlank: mkCanvas,
      copyFrame: (src) => { const fc = mkCanvas(); fc.getContext('2d').drawImage(src, 0, 0); return fc; },
      clearFrame: (fc) => {
        const ctx = fc.getContext('2d');
        ctx.clearRect(0, 0, this._w, this._h);
        if (this._bg !== 'transparent') { ctx.fillStyle = this._bg; ctx.fillRect(0, 0, this._w, this._h); }
      },
      drawThumb: (tc, fc) => {
        tc.width = this._w; tc.height = this._h;
        const tctx = tc.getContext('2d');
        if (this._bg !== 'transparent') { tctx.fillStyle = this._bg; tctx.fillRect(0, 0, this._w, this._h); }
        tctx.drawImage(fc, 0, 0);
      },
    });

    this._winId      = null;
    this._canvas     = null;   // display canvas (native size)
    this._overlay    = null;   // shape-preview + onion composite overlay
    this._colorInput = null;

    // Replaced per-instance by the shell in _init(); no-ops until then (and when
    // there is no window manager, e.g. headless tests).
    this._autoSave      = () => {};
    this._refreshThumbs = () => {};

    // Backdrop state
    this._backdropInfo     = null;  // { mode:'image'|'live', src:string|null }
    this._backdropEl       = null;  // <canvas> (image mode) or <video> (live mode)
    this._checkerEl        = null;  // reference to checker canvas to show/hide
    this._backdropDropdown = null;  // floating dropdown menu

    _paints.push(this);
    this._init(title, x, y);
    if (backdrop) this.setBackdrop(backdrop, { mode: backdropMode });
    if (!_desktopIconId) this._autoSave();
  }

  // ── Public getters ────────────────────────────────────────────────────────────

  get frameCount() { return this._fd.count; }

  // Frame model lives in FrameDoc; these proxies keep the widget's existing
  // `this._frames` / `this._fi` / `this._fps` / `this._onion` references working.
  get _frames() { return this._fd.frames; }
  get _fi()     { return this._fd.index; }
  set _fi(v)    { this._fd.index = v; }
  get _fps()    { return this._fd.fps; }
  set _fps(v)   { this._fd.fps = v; }
  get _onion()  { return this._fd.onion; }
  set _onion(v) { this._fd.onion = v; }

  // ── Frame API (mirrors Sprite) ───────────────────────────────────────────────

  addFrame() { return this._fd.push(); }          // public: append, no index move

  frame(n) {
    if (n === undefined) return this._fd.index;
    this._fd.index = n;
    this._render();
    return this;
  }

  // ── Performance capture / replay (ADR 031) ──────────────────────────────────
  // Draw a captured brush path. Points carry per-point `dt` (ms); the stroke
  // animates over time via the patched setTimeout (run-scoped, pauses/cleans
  // with the harness). Mirrors the pen/eraser midpoint-smoothing in _bindPointer.
  stroke(pts, { tool = 'pen', color = this._color, size = this._brush } = {}) {
    if (!pts || !pts.length) return this;
    const fc = this._frames[this._fi];
    if (!fc) return this;
    const ctx = fc.getContext('2d');
    const style = () => {
      ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = size;
      if (tool === 'eraser') { ctx.globalCompositeOperation = 'destination-out'; ctx.strokeStyle = ctx.fillStyle = 'rgba(0,0,0,1)'; }
      else                   { ctx.globalCompositeOperation = 'source-over';     ctx.strokeStyle = ctx.fillStyle = color; }
    };
    const dot = (cur) => { ctx.save(); style(); ctx.beginPath(); ctx.arc(cur.x, cur.y, size / 2, 0, Math.PI * 2); ctx.fill(); ctx.restore(); this._render(); };
    const seg = (prev2, prev, cur) => {
      ctx.save(); style(); ctx.beginPath();
      if (prev2) {
        ctx.moveTo((prev2.x + prev.x) / 2, (prev2.y + prev.y) / 2);
        ctx.quadraticCurveTo(prev.x, prev.y, (prev.x + cur.x) / 2, (prev.y + cur.y) / 2);
      } else { ctx.moveTo(prev.x, prev.y); ctx.lineTo(cur.x, cur.y); }
      ctx.stroke(); ctx.restore(); this._render();
    };
    let acc = 0;
    pts.forEach((pt, i) => {
      acc += (pt.dt || 0);
      const run = () => { if (i === 0) dot(pt); else seg(pts[i - 2] || null, pts[i - 1], pt); };
      if (acc <= 0) run(); else window.setTimeout(run, acc);
    });
    return this;
  }

  _applyAction(a) {
    if (!a) return;
    if (a.op === 'frame')       this.frame(a.i);
    else if (a.op === 'stroke') this.stroke(a.pts, { tool: a.tool, color: a.color, size: a.size });
  }

  replay(actions, opts) {
    return replayActions(act => this._applyAction(act), actions, opts);
  }

  _perfCtor() {
    return {
      varName: 'pt',
      code: `const pt = new Paint({ title: '${String(this._title).replace(/'/g, "\\'")}', width: ${this._w}, height: ${this._h} });`,
    };
  }

  play(fps = 8) { this._fd.play(fps); return this; }
  stop()        { this._fd.stop(); return this; }

  // ── Window init ───────────────────────────────────────────────────────────────

  _init(title, x, y) {
    if (!window.wm) return;

    // Display canvas
    const dc = document.createElement('canvas');
    dc.width  = this._w;
    dc.height = this._h;
    dc.style.imageRendering = 'auto';
    this._canvas = dc;

    // Window sizing: cap display at 800 wide, let scrolling handle larger
    const dispW = Math.min(this._w, 800);
    const dispH = Math.min(this._h, 600);
    const winW  = dispW + 4;
    // tool row ~32, palette row ~36, canvas area + margins, frame strip ~80, transport ~38
    const winH  = 32 + 36 + dispH + 14 + 80 + 38;

    const fd    = this._fd;
    const strip = buildFrameStrip(fd);

    const mkExport = (html, color, fn) => {
      const b = document.createElement('button');
      b.innerHTML = html;
      b.style.cssText = `background:#1e1e2e;color:${color};border:1px solid #313244;
        border-radius:4px;padding:3px 8px;font-size:11px;cursor:pointer;`;
      b.addEventListener('click', fn);
      return b;
    };
    const transport = buildTransport(fd, {
      onFpsChange: () => this._autoSave(),
      extraButtons: [
        mkExport('<i class="fa-solid fa-code"></i> Code',    '#89b4fa', () => this._exportCode()),
        mkExport('<i class="fa-solid fa-download"></i> PNG', '#a6e3a1', () => this._exportPng(false)),
        mkExport('<i class="fa-solid fa-film"></i> Sheet',   '#f9e2af', () => this._exportPng(true)),
        wireCaptureButton(mkExport('<i class="fa-solid fa-circle"></i> Rec', '#f38ba8', () => {}),
                          { take: this._take, widget: this, idleLabel: '⏺ Rec' }),
      ],
    });

    const shell = mountWidgetShell({
      title, x, y, w: winW, h: winH,
      widgetType: 'paint',
      rows: [
        this._buildToolRow(),
        this._buildPaletteRow(),
        this._buildCanvasArea(dispW, dispH),
        strip.el,
        transport,
      ],
      getState: () => this._getState(),
      save: {
        name: (this._title || 'Paint') + '.paint',
        type: 'paint',
        getIconId: () => this._desktopIconId,
        setIconId: (id) => { this._desktopIconId = id; },
      },
      history: {
        capture: () => this._snapFrames(),
        restore: (snap) => this._applyFrames(snap),
      },
      onMount:   () => this._render(),
      onDestroy: () => this._destroy(),
    });
    if (!shell) return;
    this._winId         = shell.winId;
    this._autoSave      = shell.save;
    this._refreshThumbs = strip.refreshThumbs;
    this._history       = shell.history;

    // Wire the frame model to render + persistence. Structural mutations commit
    // history + autosave; selection only re-renders (matches the original).
    fd.on('mutate', (e) => { this._render(); this._history?.commit(); this._autoSave(); this._events.emit('frame', e); });
    fd.on('select', (e) => { this._render(); this._events.emit('frame', { action: 'select', index: e.index, count: e.count }); });
    fd.on('tick',   () => this._render());
    fd.on('onion',  () => this._render());
  }

  // ── Backdrop ──────────────────────────────────────────────────────────────────
  //
  // setBackdrop(source, { mode }) — set a reference image/video layer below strokes.
  //   source: URL string, dataURL, HTMLImageElement, or HTMLVideoElement
  //   mode:   'image' (static / baked freeze) | 'live' (video plays continuously)
  //
  // clearBackdrop() — remove backdrop, restore checker + bg.

  setBackdrop(source, { mode = 'image' } = {}) {
    // Tear down any previous backdrop
    this._destroyBackdrop();

    const slot = this._backdropSlot;
    if (!slot) return;

    if (mode === 'live') {
      // Live video underlay
      const vid = document.createElement('video');
      vid.autoplay    = true;
      vid.muted       = true;
      vid.loop        = true;
      vid.playsInline = true;
      vid.style.cssText = `position:absolute;top:0;left:0;width:${this._w}px;height:${this._h}px;object-fit:contain;`;
      if (typeof source === 'string') vid.src = source;
      else if (source instanceof HTMLVideoElement) {
        vid.src = source.src || source.currentSrc || '';
        if (!vid.src) {
          // Mirror the element by drawing to canvas — fall back to image mode
          const bc = document.createElement('canvas');
          bc.width  = this._w;
          bc.height = this._h;
          bc.style.cssText = `position:absolute;top:0;left:0;`;
          const bctx = bc.getContext('2d');
          let _rafId = null;
          const tick = () => { bctx.clearRect(0,0,this._w,this._h); if (source.videoWidth) bctx.drawImage(source,0,0,this._w,this._h); _rafId = requestAnimationFrame(tick); };
          _rafId = requestAnimationFrame(tick);
          this._backdropEl = bc;
          this._backdropEl._stopRaf = () => cancelAnimationFrame(_rafId);
          slot.innerHTML = '';
          slot.appendChild(bc);
          slot.style.display = 'block';
          if (this._checkerEl) this._checkerEl.style.display = 'none';
          this._backdropInfo = { mode: 'live', src: null };
          this._autoSave();
          return;
        }
      }
      vid.play().catch(() => {});
      this._backdropEl = vid;
      slot.innerHTML = '';
      slot.appendChild(vid);
    } else {
      // Static image mode — draw source into an off-screen canvas
      const bc = document.createElement('canvas');
      bc.width  = this._w;
      bc.height = this._h;
      bc.style.cssText = `position:absolute;top:0;left:0;`;
      const bctx = bc.getContext('2d');

      const drawSrc = (img) => {
        bctx.clearRect(0, 0, this._w, this._h);
        const sw = img.videoWidth  ?? img.naturalWidth  ?? img.width  ?? this._w;
        const sh = img.videoHeight ?? img.naturalHeight ?? img.height ?? this._h;
        if (!sw || !sh) return;
        const scale = Math.min(this._w / sw, this._h / sh);
        bctx.drawImage(img, (this._w - sw * scale) / 2, (this._h - sh * scale) / 2, sw * scale, sh * scale);
      };

      if (typeof source === 'string') {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => drawSrc(img);
        img.src = source;
      } else if (source instanceof HTMLImageElement) {
        if (source.complete && source.naturalWidth) drawSrc(source);
        else source.addEventListener('load', () => drawSrc(source), { once: true });
      } else if (source instanceof HTMLVideoElement) {
        // Freeze current video frame
        drawSrc(source);
      } else {
        // Treat as drawable
        try { bctx.drawImage(source, 0, 0, this._w, this._h); } catch (_) {}
      }

      this._backdropEl = bc;
      slot.innerHTML = '';
      slot.appendChild(bc);
    }

    slot.style.display = 'block';
    if (this._checkerEl) this._checkerEl.style.display = 'none';

    // When backdrop is active, make the display canvas transparent so backdrop
    // shows through unpainted areas (reuse bg:'transparent' render path)
    this._backdropInfo = {
      mode,
      src: typeof source === 'string' ? source : null,
    };
    this._autoSave();
    this._refreshThumbs?.();
    this._updateBackdropUI?.();
  }

  clearBackdrop() {
    this._destroyBackdrop();
    if (this._checkerEl) this._checkerEl.style.display = '';
    this._backdropInfo = null;
    this._autoSave();
    this._updateBackdropUI?.();
    this._render();
  }

  _destroyBackdrop() {
    const slot = this._backdropSlot;
    if (slot) { slot.style.display = 'none'; slot.innerHTML = ''; }
    if (this._backdropEl?._stopRaf) this._backdropEl._stopRaf();
    if (this._backdropEl instanceof HTMLVideoElement) {
      this._backdropEl.pause();
      this._backdropEl.src = '';
    }
    this._backdropEl = null;
  }

  // Snapshot the current backdrop as a PNG dataURL (used for export + save).
  // For live video mode, freezes the current frame.
  _backdropSnapshot() {
    if (!this._backdropEl) return null;
    const bc = document.createElement('canvas');
    bc.width  = this._w;
    bc.height = this._h;
    try { bc.getContext('2d').drawImage(this._backdropEl, 0, 0, this._w, this._h); } catch (_) { return null; }
    return bc.toDataURL('image/png');
  }

  // ── Render — composite onion + current frame into display canvas ──────────────

  _render() {
    const dc  = this._canvas;
    if (!dc) return;
    const ctx = dc.getContext('2d');
    ctx.clearRect(0, 0, this._w, this._h);

    // Background — suppressed when a backdrop is active (backdrop slot shows through)
    if (!this._backdropInfo && this._bg !== 'transparent') {
      ctx.fillStyle = this._bg;
      ctx.fillRect(0, 0, this._w, this._h);
    }

    // Onion skin: draw previous frame at low alpha
    if (this._onion && this._frames.length > 1) {
      const prev = this._frames[(this._fi - 1 + this._frames.length) % this._frames.length];
      ctx.globalAlpha = 0.25;
      ctx.drawImage(prev, 0, 0);
      ctx.globalAlpha = 1;
    }

    // Current frame
    if (this._frames[this._fi]) ctx.drawImage(this._frames[this._fi], 0, 0);
  }

  // ── Undo snapshot (raw RGBA per frame, mirrors SpriteEditor._snapPixels) ──────

  _snapFrames() {
    return {
      fi: this._fi,
      frames: this._frames.map(fc => {
        const id = fc.getContext('2d').getImageData(0, 0, this._w, this._h);
        return new Uint8ClampedArray(id.data);
      }),
    };
  }

  _applyFrames(snap) {
    while (this._frames.length < snap.frames.length) this.addFrame();
    this._frames.length = snap.frames.length;
    snap.frames.forEach((data, i) => {
      const ctx = this._frames[i].getContext('2d');
      const id  = ctx.createImageData(this._w, this._h);
      id.data.set(new Uint8ClampedArray(data));
      ctx.putImageData(id, 0, 0);
    });
    this._fi = snap.fi;
    this._render();
    this._refreshThumbs();
  }

  // ── State serialization ───────────────────────────────────────────────────────

  _getState() {
    const state = {
      title:          this._title,
      width:          this._w,
      height:         this._h,
      bg:             this._bg,
      fps:            this._fps,
      frames:         this._frames.map(fc => fc.toDataURL('image/png')),
      _desktopIconId: this._desktopIconId,
    };
    // Persist backdrop: for live mode store the frozen snapshot as image mode
    // (live video sources can't be serialised as a URL into the .paint file).
    if (this._backdropInfo) {
      const snap = this._backdropSnapshot();
      if (snap) {
        state.backdrop     = snap;
        state.backdropMode = 'image';
      } else if (this._backdropInfo.src) {
        state.backdrop     = this._backdropInfo.src;
        state.backdropMode = this._backdropInfo.mode;
      }
    }
    return state;
  }

  // ── Tool row ──────────────────────────────────────────────────────────────────

  _buildToolRow() {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:3px;padding:5px 8px 3px;flex-shrink:0;flex-wrap:wrap;';

    TOOLS.forEach(t => {
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
        row.querySelectorAll('button[data-tool]').forEach(b => {
          b.style.borderColor = b.dataset.tool === this._tool ? ACTIVE_COLOR : INACTIVE_BORDER;
        });
        if (t.id === 'text') {
          if (this._textLayer) {
            this._textLayer.setDefaults({ color: this._color, fontSize: Math.max(12, this._brush * 2) });
            this._textLayer.setActive(true);
          }
          if (this._hitCanvas) this._hitCanvas.style.pointerEvents = 'none';
        } else {
          this._textLayer?.setActive(false);
          if (this._hitCanvas) this._hitCanvas.style.pointerEvents = 'auto';
        }
        this._events.emit('tool', { tool: this._tool, prev });
      });
      row.appendChild(btn);
    });

    // Separator before backdrop button
    const bdSep = document.createElement('div');
    bdSep.style.cssText = 'width:1px;height:20px;background:#45475a;margin:2px 2px;flex-shrink:0;align-self:center;';
    row.appendChild(bdSep);

    // Backdrop toggle button
    const bdBtn = document.createElement('button');
    bdBtn.title = 'Backdrop — load image/video as a reference layer beneath strokes';
    bdBtn.style.cssText = [
      `background:#313244;border:2px solid ${this._backdropInfo ? ACTIVE_COLOR : INACTIVE_BORDER};`,
      'border-radius:5px;color:#cdd6f4;font-size:14px;width:30px;height:28px;',
      'cursor:pointer;display:flex;align-items:center;justify-content:center;',
      'padding:0;transition:border-color 0.1s;',
    ].join('');
    bdBtn.innerHTML = '🖼';
    bdBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._toggleBackdropDropdown(bdBtn);
    });
    row.appendChild(bdBtn);

    // Keep reference so _updateBackdropUI can update border color
    this._backdropBtn = bdBtn;
    this._updateBackdropUI = () => {
      if (this._backdropBtn) {
        this._backdropBtn.style.borderColor = this._backdropInfo ? ACTIVE_COLOR : INACTIVE_BORDER;
      }
    };

    return row;
  }

  // ── Backdrop dropdown menu ────────────────────────────────────────────────────

  _toggleBackdropDropdown(anchor) {
    // Close if already open
    if (this._backdropDropdown) {
      this._backdropDropdown.remove();
      this._backdropDropdown = null;
      return;
    }

    const dd = document.createElement('div');
    dd.style.cssText = [
      'position:fixed;z-index:99999;background:#1e1e2e;border:1px solid #45475a;',
      'border-radius:6px;padding:4px;min-width:160px;box-shadow:0 4px 16px rgba(0,0,0,0.5);',
      'display:flex;flex-direction:column;gap:2px;',
    ].join('');

    const mkItem = (label, fn) => {
      const item = document.createElement('button');
      item.textContent = label;
      item.style.cssText = [
        'background:none;border:none;color:#cdd6f4;text-align:left;padding:5px 10px;',
        'font-size:12px;border-radius:4px;cursor:pointer;white-space:nowrap;',
      ].join('');
      item.addEventListener('mouseenter', () => { item.style.background = '#313244'; });
      item.addEventListener('mouseleave', () => { item.style.background = 'none'; });
      item.addEventListener('click', () => {
        dd.remove(); this._backdropDropdown = null;
        fn();
      });
      return item;
    };

    dd.appendChild(mkItem('📷 Load image…', () => {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = 'image/*';
      inp.addEventListener('change', () => {
        const f = inp.files?.[0]; if (!f) return;
        const url = URL.createObjectURL(f);
        this.setBackdrop(url, { mode: 'image' });
      });
      inp.click();
    }));

    dd.appendChild(mkItem('🎬 Load video (live)…', () => {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = 'video/*';
      inp.addEventListener('change', () => {
        const f = inp.files?.[0]; if (!f) return;
        const url = URL.createObjectURL(f);
        this.setBackdrop(url, { mode: 'live' });
      });
      inp.click();
    }));

    if (this._backdropInfo?.mode === 'live') {
      dd.appendChild(mkItem('📷 Freeze frame', () => {
        if (!this._backdropEl) return;
        const snap = this._backdropSnapshot();
        if (snap) this.setBackdrop(snap, { mode: 'image' });
      }));
    }

    if (this._backdropInfo) {
      dd.appendChild(mkItem('✕ Clear backdrop', () => this.clearBackdrop()));
    }

    // Position near the anchor button
    const rect = anchor.getBoundingClientRect();
    dd.style.left = `${rect.left}px`;
    dd.style.top  = `${rect.bottom + 4}px`;

    document.body.appendChild(dd);
    this._backdropDropdown = dd;

    // Close on outside click
    const onOut = (e) => {
      if (!dd.contains(e.target) && e.target !== anchor) {
        dd.remove(); this._backdropDropdown = null;
        document.removeEventListener('mousedown', onOut, true);
      }
    };
    document.addEventListener('mousedown', onOut, true);
  }

  // ── Palette + brush row ───────────────────────────────────────────────────────

  _buildPaletteRow() {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:3px;padding:3px 8px 4px;flex-shrink:0;align-items:center;flex-wrap:wrap;';

    const mkSwatch = (bg, title) => {
      const sw = document.createElement('button');
      sw.title = title;
      sw.style.cssText = `width:20px;height:20px;background:${bg};border:2px solid ${INACTIVE_BORDER};
        border-radius:3px;cursor:pointer;padding:0;flex-shrink:0;`;
      return sw;
    };

    PALETTE.forEach(c => {
      const sw = mkSwatch(c, c);
      sw.addEventListener('click', () => {
        this._setColor(c);
        this._highlightSwatch(row, null);
      });
      row.appendChild(sw);
    });

    // Custom color picker
    const colorIn = document.createElement('input');
    colorIn.type  = 'color';
    colorIn.value = this._color;
    colorIn.title = 'Custom color';
    colorIn.style.cssText = 'width:24px;height:24px;border:none;border-radius:3px;cursor:pointer;padding:0;background:none;flex-shrink:0;';
    colorIn.addEventListener('input', () => {
      this._setColor(colorIn.value);
      this._highlightSwatch(row, null);
    });
    row.appendChild(colorIn);
    this._colorInput = colorIn;

    // Separator
    const sep = document.createElement('div');
    sep.style.cssText = 'width:1px;height:20px;background:#45475a;margin:0 4px;flex-shrink:0;';
    row.appendChild(sep);

    // Brush size label + slider
    const brushLbl = document.createElement('span');
    brushLbl.textContent = '✏️';
    brushLbl.title = 'Brush size';
    brushLbl.style.cssText = 'font-size:12px;flex-shrink:0;';
    row.appendChild(brushLbl);

    const brushSlider = document.createElement('input');
    brushSlider.type  = 'range';
    brushSlider.min   = '1';
    brushSlider.max   = '64';
    brushSlider.value = String(this._brush);
    brushSlider.title = 'Brush size (1–64)';
    brushSlider.style.cssText = 'width:70px;flex-shrink:0;accent-color:#cba6f7;';
    const brushVal = document.createElement('span');
    brushVal.textContent = String(this._brush);
    brushVal.style.cssText = 'font-size:10px;color:#6c7086;font-family:monospace;min-width:18px;flex-shrink:0;';
    brushSlider.addEventListener('input', () => {
      this._brush = parseInt(brushSlider.value, 10);
      brushVal.textContent = String(this._brush);
    });
    row.appendChild(brushSlider);
    row.appendChild(brushVal);

    // Background color
    const sep2 = document.createElement('div');
    sep2.style.cssText = 'width:1px;height:20px;background:#45475a;margin:0 4px;flex-shrink:0;';
    row.appendChild(sep2);

    const bgLbl = document.createElement('span');
    bgLbl.textContent = 'bg';
    bgLbl.style.cssText = 'font-size:10px;color:#6c7086;font-family:monospace;flex-shrink:0;';
    row.appendChild(bgLbl);

    const bgIn = document.createElement('input');
    bgIn.type  = 'color';
    bgIn.value = this._bg === 'transparent' ? '#ffffff' : this._bg;
    bgIn.title = 'Background color';
    bgIn.style.cssText = 'width:24px;height:24px;border:none;border-radius:3px;cursor:pointer;padding:0;background:none;flex-shrink:0;';
    bgIn.addEventListener('input', () => {
      this._bg = bgIn.value;
      // Re-fill all frames background (non-destructive in bg layer sense — fills current frame's transparent bg regions using compositing is complex; we simply store new bg for new frames + render)
      this._render();
      this._autoSave();
    });
    row.appendChild(bgIn);

    return row;
  }

  _highlightSwatch(row, active) {
    row.querySelectorAll('button').forEach(b => { b.style.borderColor = INACTIVE_BORDER; });
    if (active) active.style.borderColor = ACTIVE_COLOR;
  }

  // Centralised color setter — emits 'color' event
  _setColor(c) {
    const prev = this._color;
    this._color = c;
    if (this._colorInput) this._colorInput.value = c;
    this._textLayer?.setDefaults({ color: c });
    this._events.emit('color', { color: c, prev });
  }

  // ── Canvas area ───────────────────────────────────────────────────────────────

  _buildCanvasArea(dispW, dispH) {
    const wrap = document.createElement('div');
    wrap.style.cssText = `position:relative;width:${dispW}px;height:${dispH}px;
      flex-shrink:0;overflow:auto;align-self:center;margin:6px auto;`;

    // Checkerboard (transparency indicator)
    const checker = document.createElement('canvas');
    checker.width  = this._w;
    checker.height = this._h;
    const cctx = checker.getContext('2d');
    const cs   = 8;
    for (let y = 0; y < checker.height; y += cs) {
      for (let x = 0; x < checker.width; x += cs) {
        cctx.fillStyle = ((x / cs + y / cs) % 2 === 0) ? '#888' : '#aaa';
        cctx.fillRect(x, y, cs, cs);
      }
    }
    checker.style.cssText = 'position:absolute;top:0;left:0;';
    this._checkerEl = checker;

    // Backdrop slot (hidden until setBackdrop is called — positioned between
    // checker and the display canvas so strokes always render on top)
    const bdSlot = document.createElement('div');
    bdSlot.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;overflow:hidden;display:none;';
    this._backdropSlot = bdSlot;

    // Display canvas
    const dc = this._canvas;
    dc.style.cssText = 'position:absolute;top:0;left:0;';

    // Overlay for shape preview
    const ov = document.createElement('canvas');
    ov.width  = this._w;
    ov.height = this._h;
    ov.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;';
    this._overlay = ov;

    // Transparent hit canvas
    const hit = document.createElement('canvas');
    hit.width  = this._w;
    hit.height = this._h;
    hit.style.cssText = 'position:absolute;top:0;left:0;cursor:crosshair;opacity:0;';

    wrap.appendChild(checker);
    wrap.appendChild(bdSlot);
    wrap.appendChild(dc);
    wrap.appendChild(ov);
    wrap.appendChild(hit);

    this._hitCanvas = hit;
    this._textLayer = new TextLayer({
      container: wrap,
      left: 0, top: 0,
      width:  this._w,
      height: this._h,
    });

    this._bindPointer(hit);
    return wrap;
  }

  // ── Pointer handling ──────────────────────────────────────────────────────────

  _xyCoord(e) {
    const rect = e.target.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(this._w - 1, Math.floor(e.clientX - rect.left))),
      y: Math.max(0, Math.min(this._h - 1, Math.floor(e.clientY - rect.top))),
    };
  }

  // Expand the stroke bounding-box to include point (x, y)
  _expandBbox(x, y) {
    if (!this._strokeBbox) {
      this._strokeBbox = { minX: x, minY: y, maxX: x, maxY: y };
    } else {
      if (x < this._strokeBbox.minX) this._strokeBbox.minX = x;
      if (y < this._strokeBbox.minY) this._strokeBbox.minY = y;
      if (x > this._strokeBbox.maxX) this._strokeBbox.maxX = x;
      if (y > this._strokeBbox.maxY) this._strokeBbox.maxY = y;
    }
  }

  _emitStroke(bbox) {
    this._events.emit('stroke', {
      tool:  this._tool,
      color: this._color,
      frame: this._fi,
      bbox,
    });
  }

  _bindPointer(el) {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      this._drawing = true;
      this._strokeBbox = null;
      const p = this._xyCoord(e);

      if (this._tool === 'fill') {
        this._floodFill(p.x, p.y);
        this._refreshThumbs();
        return;
      }
      if (this._tool === 'eye') {
        this._eyedrop(p.x, p.y);
        return;
      }
      if (this._tool === 'line' || this._tool === 'rect' || this._tool === 'ellipse') {
        this._startXY = p;
        this._expandBbox(p.x, p.y);
        return;
      }

      // pen / eraser
      const fc = this._frames[this._fi];
      if (!fc) return;
      const ctx = fc.getContext('2d');
      this._lastXY = p;
      this._prevXY = null;
      this._expandBbox(p.x, p.y);
      // Performance capture: open a stroke action; points appended on move. `t`
      // is stamped at stroke start, internal dt drives animated replay.
      this._recStroke = this._take.push({ op: 'stroke', tool: this._tool, color: this._color, size: this._brush, pts: [{ x: p.x, y: p.y, dt: 0 }] });
      this._recLast   = performance.now();
      ctx.save();
      ctx.lineCap  = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = this._brush;
      if (this._tool === 'eraser') {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.strokeStyle = 'rgba(0,0,0,1)';
      } else {
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = this._color;
      }
      // dot on down
      ctx.beginPath();
      ctx.arc(p.x, p.y, this._brush / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      this._render();
    });

    el.addEventListener('pointermove', (e) => {
      if (!this._drawing) return;
      const p = this._xyCoord(e);

      if (this._tool === 'line' || this._tool === 'rect' || this._tool === 'ellipse') {
        if (this._startXY) this._drawPreview(this._startXY, p);
        return;
      }
      if (this._tool !== 'pen' && this._tool !== 'eraser') return;

      const fc = this._frames[this._fi];
      if (!fc) return;
      const ctx = fc.getContext('2d');
      const lp  = this._lastXY;
      if (!lp) { this._lastXY = p; return; }

      ctx.save();
      ctx.lineCap   = 'round';
      ctx.lineJoin  = 'round';
      ctx.lineWidth = this._brush;
      if (this._tool === 'eraser') {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.strokeStyle = 'rgba(0,0,0,1)';
      } else {
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = this._color;
      }

      // Smooth: midpoint quadratic curve
      ctx.beginPath();
      if (this._prevXY) {
        const mx = (lp.x + p.x) / 2;
        const my = (lp.y + p.y) / 2;
        ctx.moveTo((this._prevXY.x + lp.x) / 2, (this._prevXY.y + lp.y) / 2);
        ctx.quadraticCurveTo(lp.x, lp.y, mx, my);
      } else {
        ctx.moveTo(lp.x, lp.y);
        ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
      ctx.restore();

      this._prevXY = lp;
      this._lastXY = p;
      this._expandBbox(p.x, p.y);
      if (this._recStroke) {
        const now = performance.now();
        this._recStroke.pts.push({ x: p.x, y: p.y, dt: Math.round(now - this._recLast) });
        this._recLast = now;
      }
      this._render();
    });

    el.addEventListener('pointerup', (e) => {
      if (!this._drawing) return;
      this._drawing = false;
      this._prevXY  = null;
      this._lastXY  = null;
      this._recStroke = null;   // close captured stroke

      if (this._startXY && (this._tool === 'line' || this._tool === 'rect' || this._tool === 'ellipse')) {
        const p = this._xyCoord(e);
        this._expandBbox(p.x, p.y);
        this._commitShape(this._startXY, p);
        this._startXY = null;
        this._clearOverlay();
        this._refreshThumbs();
      }

      if (this._strokeBbox) {
        const b = this._strokeBbox;
        this._emitStroke({ x: b.minX, y: b.minY, w: b.maxX - b.minX, h: b.maxY - b.minY });
        this._strokeBbox = null;
      }
      this._history?.commit();
      this._autoSave();
    });
  }

  _eyedrop(x, y) {
    const fc = this._frames[this._fi];
    if (!fc) return;
    const [r, g, b, a] = fc.getContext('2d').getImageData(x, y, 1, 1).data;
    const c = a === 0
      ? '#000000'
      : '#' + [r, g, b].map(n => n.toString(16).padStart(2, '0')).join('');
    this._setColor(c);
  }

  // ── Flood fill (BFS on frame ImageData, ported from sprite-editor.js) ─────────

  _floodFill(px, py) {
    const fc = this._frames[this._fi];
    if (!fc) return;
    const ctx = fc.getContext('2d');
    const W = this._w, H = this._h;
    const img = ctx.getImageData(0, 0, W, H);
    const d   = img.data;

    const idx = (x, y) => (y * W + x) * 4;
    const i0  = idx(px, py);
    const [tr, tg, tb, ta] = [d[i0], d[i0+1], d[i0+2], d[i0+3]];

    let [fr, fg, fb, fa] = [0, 0, 0, 0];
    if (this._color !== 'transparent') {
      const tmp = document.createElement('canvas');
      tmp.width  = tmp.height = 1;
      const tx   = tmp.getContext('2d');
      tx.fillStyle = this._color;
      tx.fillRect(0, 0, 1, 1);
      const td = tx.getImageData(0, 0, 1, 1).data;
      [fr, fg, fb, fa] = [td[0], td[1], td[2], td[3]];
    }

    if (tr === fr && tg === fg && tb === fb && ta === fa) return;

    const stack = [[px, py]];
    while (stack.length) {
      const [cx, cy] = stack.pop();
      if (cx < 0 || cx >= W || cy < 0 || cy >= H) continue;
      const ci = idx(cx, cy);
      if (d[ci] !== tr || d[ci+1] !== tg || d[ci+2] !== tb || d[ci+3] !== ta) continue;
      d[ci] = fr; d[ci+1] = fg; d[ci+2] = fb; d[ci+3] = fa;
      stack.push([cx-1,cy],[cx+1,cy],[cx,cy-1],[cx,cy+1]);
    }

    ctx.putImageData(img, 0, 0);
    this._render();
    this._emitStroke({ x: px, y: py, w: this._w - px, h: this._h - py });
    this._history?.commit();
    this._autoSave();
  }

  // ── Shape preview + commit ────────────────────────────────────────────────────

  _clearOverlay() {
    if (this._overlay) this._overlay.getContext('2d').clearRect(0, 0, this._w, this._h);
  }

  _drawPreview(start, end) {
    this._clearOverlay();
    const ctx = this._overlay.getContext('2d');
    const col = this._color === 'transparent' ? 'rgba(128,128,128,0.6)' : this._color;
    ctx.strokeStyle = col;
    ctx.fillStyle   = col;
    ctx.lineWidth   = this._brush;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';

    const x1 = start.x, y1 = start.y, x2 = end.x, y2 = end.y;
    ctx.beginPath();
    if (this._tool === 'line') {
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    } else if (this._tool === 'rect') {
      const rx = Math.min(x1, x2), ry = Math.min(y1, y2);
      const rw = Math.abs(x2 - x1),  rh = Math.abs(y2 - y1);
      ctx.strokeRect(rx, ry, rw, rh);
    } else if (this._tool === 'ellipse') {
      const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
      const rx = Math.abs(x2 - x1) / 2, ry = Math.abs(y2 - y1) / 2;
      if (rx > 0 && ry > 0) {
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  _commitShape(start, end) {
    const fc = this._frames[this._fi];
    if (!fc) return;
    const ctx = fc.getContext('2d');
    const col = this._color === 'transparent' ? 'rgba(0,0,0,0)' : this._color;
    ctx.strokeStyle = col;
    ctx.fillStyle   = col;
    ctx.lineWidth   = this._brush;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';

    const x1 = start.x, y1 = start.y, x2 = end.x, y2 = end.y;
    ctx.beginPath();
    if (this._tool === 'line') {
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    } else if (this._tool === 'rect') {
      const rx = Math.min(x1, x2), ry = Math.min(y1, y2);
      const rw = Math.abs(x2 - x1),  rh = Math.abs(y2 - y1);
      if (this._color === 'transparent') {
        ctx.save();
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillStyle = 'rgba(0,0,0,1)';
        ctx.fillRect(rx, ry, rw, rh);
        ctx.restore();
      } else {
        ctx.strokeRect(rx, ry, rw, rh);
      }
    } else if (this._tool === 'ellipse') {
      const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
      const rx = Math.abs(x2 - x1) / 2, ry = Math.abs(y2 - y1) / 2;
      if (rx > 0 && ry > 0) {
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    this._render();
  }

  // ── Export ────────────────────────────────────────────────────────────────────

  // Helper: composite backdrop + bg + frame into a canvas (used by export + code).
  _compositeFrame(frameCanvas) {
    const c = document.createElement('canvas');
    c.width  = this._w;
    c.height = this._h;
    const ctx = c.getContext('2d');
    // Backdrop first
    if (this._backdropEl) {
      try { ctx.drawImage(this._backdropEl, 0, 0, this._w, this._h); } catch (_) {}
    } else if (this._bg !== 'transparent') {
      ctx.fillStyle = this._bg;
      ctx.fillRect(0, 0, this._w, this._h);
    }
    ctx.drawImage(frameCanvas, 0, 0);
    if (this._textLayer) this._textLayer.renderToContext(ctx);
    return c;
  }

  _exportCode() {
    // Composite backdrop + current frame for the exported code snippet
    const composed = this._compositeFrame(this._frames[this._fi]);
    const dataUrl  = composed.toDataURL('image/png');
    // ADR 040: export against a `new Canvas()` (global draw is gone).
    let code;
    if (this._backdropEl) {
      const bdUrl  = this._backdropSnapshot();
      code = bdUrl
        ? `const canvas = new Canvas();\ncanvas.backdrop('${bdUrl}');\ncanvas.image('${this._frames[this._fi].toDataURL('image/png')}', 0, 0);`
        : `const canvas = new Canvas();\ncanvas.image('${dataUrl}', 0, 0);`;
    } else {
      code = `const canvas = new Canvas();\ncanvas.image('${dataUrl}', 0, 0);`;
    }
    insertSnippet(code);
  }

  _exportPng(sheet) {
    const src = sheet
      ? (() => {
          const c = document.createElement('canvas');
          c.width  = this._w * this._frames.length;
          c.height = this._h;
          const ctx = c.getContext('2d');
          this._frames.forEach((fc, i) => {
            // Draw backdrop (frozen snapshot for this position)
            if (this._backdropEl) {
              try { ctx.drawImage(this._backdropEl, i * this._w, 0, this._w, this._h); } catch (_) {}
            } else if (this._bg !== 'transparent') {
              ctx.fillStyle = this._bg;
              ctx.fillRect(i * this._w, 0, this._w, this._h);
            }
            ctx.drawImage(fc, i * this._w, 0);
          });
          // Text objects at current positions appear on every sheet frame
          if (this._textLayer) {
            ctx.save();
            ctx.translate(0, 0);
            this._textLayer.renderToContext(ctx);
            ctx.restore();
          }
          return c;
        })()
      : this._compositeFrame(this._frames[this._fi]);

    src.toBlob(blob => {
      const a   = document.createElement('a');
      a.href     = URL.createObjectURL(blob);
      a.download = sheet ? 'paint-sheet.png' : 'paint-frame.png';
      a.click();
      URL.revokeObjectURL(a.href);
    }, 'image/png');
  }

  // ── Event / signal public API ─────────────────────────────────────────────────

  /** fn({ tool, color, frame, bbox:{x,y,w,h} }) on each stroke / fill. */
  onStroke(fn) { this._events.on('stroke', fn); return this; }
  /** fn({ color, prev }) when the active color changes. */
  onColor(fn)  { this._events.on('color',  fn); return this; }
  /** fn({ tool, prev }) when the active tool changes. */
  onTool(fn)   { this._events.on('tool',   fn); return this; }
  /** fn({ action, index, count }) on add/duplicate/clear/delete/move/select frame ops. */
  onFrame(fn)  { this._events.on('frame',  fn); return this; }

  /**
   * Place a persistent text object on the canvas.
   * @param {string} text
   * @param {number} x
   * @param {number} y
   * @param {object} [opts] — { fontSize, fontFamily, color, bold, italic, align, rotation, kerning, curve }
   * @returns {object} handle — { id, setText, setStyle, moveTo, remove, on }
   */
  addText(text, x, y, opts = {}) {
    if (!this._textLayer) return null;
    return this._textLayer.addText(text, x, y, { color: this._color, ...opts }, { runScoped: false });
  }

  /**
   * Live decaying-pulse signal.
   * @param {string}  [event='stroke']   — 'stroke' | 'color' | 'tool' | 'frame' | '*'
   * @param {object}  [opts]
   * @param {number}  [opts.decay=250]   — ms until value → 0
   * @param {object}  [opts.region]      — { x, y, w, h } bbox filter in canvas pixels
   * @returns {{ value, velocity, stream(fn), on(fn) }}
   */
  signal(event = 'stroke', opts = {}) {
    return this._events.signal(event, opts);
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────────

  _destroy() {
    this.stop();
    this._destroyBackdrop();
    this._textLayer?.destroy();
    this._textLayer = null;
    this._events.clear();
    const i = _paints.indexOf(this);
    if (i !== -1) _paints.splice(i, 1);
  }
}

// Register teardown with the reset registry (ADR 008).
onReset(cleanupPaints);
