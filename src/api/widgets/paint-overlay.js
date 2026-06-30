// paint-overlay.js — the in-window paint overlay (ADR 045).
// Extracted verbatim from wm.js's _addPaintOverlay. A self-contained drawing
// engine: a 🖌️ titlebar toggle that builds a z=50 overlay canvas over a window's
// visual, with pen/eraser/text tools, its own undo/redo stack, a mini toolbar,
// and stroke/clear/color/tool WidgetEvents. It also owns the window's TextLayer
// factory (win._ensureTextLayer) used by wm.addText.
//
// wm stays the owner of the overlay registries (overlayEvents/textLayers Sets,
// cleared by cleanupPaintOverlays on reset) and of snapshot compositing — those
// are passed in as ctx so this module never reaches back into the wm closure.

import { WidgetEvents } from './widget-events.js';
import { TextLayer } from './text-layer.js';

// win, body, visualEl: the window, its .wm-body, and the visual element to cover.
// ctx.overlayEvents / ctx.textLayers: wm's registries (for reset cleanup).
// ctx.snapshot(win, body, visualEl): the window-capture snapshot fn.
export function addPaintOverlay(win, body, visualEl, ctx = {}) {
  const { overlayEvents, textLayers, snapshot, onDispose } = ctx;
  const tb = win.querySelector('.wm-titlebar');
  if (!tb || !visualEl) return;

  let active = false;
  let drawing = false;
  let lastX = 0,
    lastY = 0;
  let prevX = null,
    prevY = null;
  let tool = 'pen'; // 'pen' | 'eraser' | 'text'
  let color = '#ff0000';
  let brushSize = 6;

  // ── WidgetEvents ─────────────────────────────────────────────────────────
  const events = new WidgetEvents();
  win._paintEvents = events;
  overlayEvents.add(events);

  // stroke bbox tracking
  let _bbox = null;
  const _bboxExpand = (x, y) => {
    if (!_bbox) {
      _bbox = { minX: x, minY: y, maxX: x, maxY: y };
      return;
    }
    if (x < _bbox.minX) _bbox.minX = x;
    if (y < _bbox.minY) _bbox.minY = y;
    if (x > _bbox.maxX) _bbox.maxX = x;
    if (y > _bbox.maxY) _bbox.maxY = y;
  };

  // overlay canvas (created lazily when first activated)
  let overlay = null;
  let miniBar = null;
  let colorIn = null;
  let textLayer = null;
  win._getOverlay = () => overlay;
  win._getTextCanvas = () => textLayer?.canvas ?? null;

  // Create (or return) the TextLayer for this window — deferred so we run
  // after the window is in the DOM and getBoundingClientRect is valid.
  win._ensureTextLayer = () => {
    if (textLayer) return textLayer;
    body.style.position = 'relative';
    const r = getVisualRect();
    textLayer = new TextLayer({
      container: body,
      left: r.left,
      top: r.top,
      width: Math.round(r.w) || 320,
      height: Math.round(r.h) || 240,
    });
    textLayers.add(textLayer);
    return textLayer;
  };

  // ── Undo / Redo ───────────────────────────────────────────────────────────
  let _undoStack = [];
  let _undoPos = -1;
  let _updateHistBtns = null;

  const _histPush = () => {
    if (!overlay) return;
    const snap = overlay.getContext('2d').getImageData(0, 0, overlay.width, overlay.height);
    _undoStack = _undoStack.slice(0, _undoPos + 1);
    _undoStack.push(snap);
    _undoPos = _undoStack.length - 1;
    _updateHistBtns?.();
  };

  const _histUndo = () => {
    if (!overlay || _undoPos <= 0) return;
    _undoPos--;
    const ctx = overlay.getContext('2d');
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    ctx.putImageData(_undoStack[_undoPos], 0, 0);
    _updateHistBtns?.();
  };

  const _histRedo = () => {
    if (!overlay || _undoPos >= _undoStack.length - 1) return;
    _undoPos++;
    overlay.getContext('2d').putImageData(_undoStack[_undoPos], 0, 0);
    _updateHistBtns?.();
  };

  const _onKey = (e) => {
    if (!overlay) return;
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;
    if (e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      _histUndo();
    } else if ((e.key === 'z' && e.shiftKey) || e.key === 'y') {
      e.preventDefault();
      _histRedo();
    }
  };

  // ── Cursor ────────────────────────────────────────────────────────────────
  const _makeCursor = () => {
    if (tool === 'text') return 'text';
    const r = Math.max(2, brushSize / 2);
    const d = Math.ceil(r * 2 + 4);
    const c = d / 2;
    const stroke = tool === 'eraser' ? 'rgba(255,120,120,0.9)' : 'rgba(255,255,255,0.85)';
    const dash = tool === 'eraser' ? 'stroke-dasharray="3 2"' : '';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${d}" height="${d}"><circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${stroke}" stroke-width="1.5" ${dash}/></svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${c} ${c}, crosshair`;
  };

  const _updateCursor = () => {
    if (overlay) overlay.style.cursor = _makeCursor();
  };

  // ── Helpers ──────────────────────────────────────────────────────────────

  const getVisualRect = () => {
    const vr = visualEl.getBoundingClientRect();
    const br = body.getBoundingClientRect();
    return { left: vr.left - br.left, top: vr.top - br.top, w: vr.width, h: vr.height };
  };

  const getPos = (e) => {
    if (!overlay) return { x: 0, y: 0 };
    const rect = overlay.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (overlay.width / rect.width),
      y: (e.clientY - rect.top) * (overlay.height / rect.height),
    };
  };

  const buildOverlay = () => {
    if (overlay) return;
    const r = getVisualRect();
    // Ensure text layer exists and is correctly sized/positioned.
    const tl = win._ensureTextLayer();
    tl.updateRect(r.left, r.top, Math.round(r.w) || 320, Math.round(r.h) || 240);

    overlay = document.createElement('canvas');
    overlay.width = Math.round(r.w) || 320;
    overlay.height = Math.round(r.h) || 240;
    Object.assign(overlay.style, {
      position: 'absolute',
      left: r.left + 'px',
      top: r.top + 'px',
      width: r.w + 'px',
      height: r.h + 'px',
      cursor: _makeCursor(),
      pointerEvents: 'auto',
      zIndex: '50',
      touchAction: 'none',
    });
    body.style.position = 'relative';
    body.appendChild(overlay);

    _undoStack = [overlay.getContext('2d').getImageData(0, 0, overlay.width, overlay.height)];
    _undoPos = 0;
    _updateHistBtns?.();

    overlay.addEventListener('pointerdown', onDown);
    overlay.addEventListener('pointermove', onMove);
    overlay.addEventListener('pointerup', onUp);
    overlay.addEventListener('pointerleave', onUp);
    document.addEventListener('keydown', _onKey);
  };

  const removeOverlay = () => {
    if (!overlay) return;
    overlay.removeEventListener('pointerdown', onDown);
    overlay.removeEventListener('pointermove', onMove);
    overlay.removeEventListener('pointerup', onUp);
    overlay.removeEventListener('pointerleave', onUp);
    overlay.remove();
    overlay = null;
    document.removeEventListener('keydown', _onKey);
  };

  const buildMiniBar = () => {
    if (miniBar) return;
    miniBar = document.createElement('div');
    miniBar.style.cssText = [
      'position:absolute;bottom:6px;left:50%;transform:translateX(-50%);',
      'display:flex;gap:5px;align-items:center;padding:4px 8px;',
      'background:rgba(18,18,30,0.88);border:1px solid #45475a;',
      'border-radius:8px;z-index:51;backdrop-filter:blur(4px);flex-wrap:wrap;',
    ].join('');

    const mkBtn = (label, title, fn) => {
      const b = document.createElement('button');
      b.innerHTML = label;
      b.title = title;
      b.style.cssText = [
        'background:#313244;color:#cdd6f4;border:1px solid #45475a;border-radius:5px;',
        'padding:3px 7px;font-size:11px;cursor:pointer;white-space:nowrap;',
      ].join('');
      b.addEventListener('click', fn);
      return b;
    };

    // Tool buttons
    let penBtn, eraserBtn, textBtn;
    const _setTool = (t) => {
      tool = t;
      penBtn.style.borderColor = t === 'pen' ? '#cba6f7' : '#45475a';
      eraserBtn.style.borderColor = t === 'eraser' ? '#cba6f7' : '#45475a';
      textBtn.style.borderColor = t === 'text' ? '#cba6f7' : '#45475a';
      if (t === 'text') {
        const tl = win._ensureTextLayer();
        tl.setDefaults({ color, fontSize: Math.max(12, brushSize * 2) });
        tl.setActive(true);
      } else {
        textLayer?.setActive(false);
      }
      _updateCursor();
      events.emit('tool', { tool: t, winId: win.id });
    };
    penBtn = mkBtn('<i class="fa-solid fa-pen"></i>', 'Pen (P)', () => _setTool('pen'));
    eraserBtn = mkBtn('<i class="fa-solid fa-eraser"></i>', 'Eraser (E)', () => _setTool('eraser'));
    textBtn = mkBtn('T', 'Text (T)', () => _setTool('text'));
    penBtn.style.borderColor = '#cba6f7';

    // Color picker — hidden native input + visible swatch
    colorIn = document.createElement('input');
    colorIn.type = 'color';
    colorIn.value = color;
    colorIn.style.cssText = 'position:absolute;width:0;height:0;opacity:0;pointer-events:none;';

    let _pickerOpen = false;
    const colorSwatch = document.createElement('div');
    colorSwatch.title = 'Stroke color';
    colorSwatch.style.cssText = `width:22px;height:22px;border-radius:4px;cursor:pointer;border:2px solid #45475a;background:${color};flex-shrink:0;`;
    colorSwatch.addEventListener('click', () => {
      if (_pickerOpen) {
        colorIn.blur();
        _pickerOpen = false;
      } else {
        colorIn.click();
        _pickerOpen = true;
      }
    });
    colorIn.addEventListener('input', () => {
      const prev = color;
      color = colorIn.value;
      colorSwatch.style.background = color;
      textLayer?.setDefaults({ color });
      events.emit('color', { color, prev, winId: win.id });
    });
    colorIn.addEventListener('change', () => {
      _pickerOpen = false;
    });
    colorIn.addEventListener('blur', () => {
      _pickerOpen = false;
    });

    // Brush size
    const sizeSlider = document.createElement('input');
    sizeSlider.type = 'range';
    sizeSlider.min = '1';
    sizeSlider.max = '48';
    sizeSlider.value = String(brushSize);
    sizeSlider.title = 'Brush size';
    sizeSlider.style.cssText = 'width:55px;accent-color:#cba6f7;flex-shrink:0;';
    sizeSlider.addEventListener('input', () => {
      brushSize = parseInt(sizeSlider.value, 10);
      textLayer?.setDefaults({ fontSize: Math.max(12, brushSize * 2) });
      _updateCursor();
    });

    // Undo / Redo
    let undoBtn, redoBtn;
    _updateHistBtns = () => {
      if (undoBtn) undoBtn.style.opacity = _undoPos > 0 ? '1' : '0.35';
      if (redoBtn) redoBtn.style.opacity = _undoPos < _undoStack.length - 1 ? '1' : '0.35';
    };
    undoBtn = mkBtn('<i class="fa-solid fa-rotate-left"></i>', 'Undo (⌘Z)', _histUndo);
    redoBtn = mkBtn('<i class="fa-solid fa-rotate-right"></i>', 'Redo (⌘⇧Z)', _histRedo);
    _updateHistBtns();

    // Clear
    const clearBtn = mkBtn('<i class="fa-solid fa-trash"></i>', 'Clear drawing', () => {
      if (!overlay) return;
      overlay.getContext('2d').clearRect(0, 0, overlay.width, overlay.height);
      _histPush();
      events.emit('clear', { winId: win.id });
    });

    // Snapshot
    const snapBtn = mkBtn(
      '<i class="fa-solid fa-camera"></i> Snap',
      'Composite visual + drawing → PNG on desktop',
      () => _doSnapshot(),
    );

    miniBar.appendChild(penBtn);
    miniBar.appendChild(eraserBtn);
    miniBar.appendChild(textBtn);
    miniBar.appendChild(colorIn);
    miniBar.appendChild(colorSwatch);
    miniBar.appendChild(sizeSlider);
    miniBar.appendChild(undoBtn);
    miniBar.appendChild(redoBtn);
    miniBar.appendChild(clearBtn);
    miniBar.appendChild(snapBtn);

    body.appendChild(miniBar);
  };

  const removeMiniBar = () => {
    miniBar?.remove();
    miniBar = null;
    _updateHistBtns = null;
  };

  // ── Drawing ──────────────────────────────────────────────────────────────
  // Text tool clicks are handled by TextLayer's posDiv — onDown ignores them.

  const onDown = (e) => {
    if (tool === 'text') return;
    e.preventDefault();
    overlay.setPointerCapture(e.pointerId);
    drawing = true;
    _bbox = null;
    const { x, y } = getPos(e);
    lastX = x;
    lastY = y;
    prevX = null;
    prevY = null;
    _bboxExpand(x, y);
    const ctx = overlay.getContext('2d');
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = brushSize;
    if (tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0,0,0,1)';
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = color;
    }
    ctx.beginPath();
    ctx.arc(x, y, brushSize / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  const onMove = (e) => {
    if (!drawing) return;
    const { x, y } = getPos(e);
    _bboxExpand(x, y);
    const ctx = overlay.getContext('2d');
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = brushSize;
    if (tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0,0,0,1)';
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = color;
    }
    ctx.beginPath();
    if (prevX !== null) {
      const mx = (lastX + x) / 2,
        my = (lastY + y) / 2;
      ctx.moveTo((prevX + lastX) / 2, (prevY + lastY) / 2);
      ctx.quadraticCurveTo(lastX, lastY, mx, my);
    } else {
      ctx.moveTo(lastX, lastY);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
    prevX = lastX;
    prevY = lastY;
    lastX = x;
    lastY = y;
  };

  const onUp = () => {
    if (!drawing) return;
    drawing = false;
    prevX = null;
    prevY = null;
    _histPush();
    if (_bbox) {
      events.emit('stroke', {
        tool,
        color,
        winId: win.id,
        bbox: {
          x: _bbox.minX,
          y: _bbox.minY,
          w: _bbox.maxX - _bbox.minX,
          h: _bbox.maxY - _bbox.minY,
        },
      });
      _bbox = null;
    }
  };

  // ── Snapshot ─────────────────────────────────────────────────────────────

  const _doSnapshot = () => snapshot(win, body, visualEl);

  // ── Toggle ────────────────────────────────────────────────────────────────

  const toggle = () => {
    active = !active;
    paintBtn.classList.toggle('active', active);
    if (active) {
      buildOverlay();
      buildMiniBar();
    } else {
      removeOverlay();
      removeMiniBar();
    }
  };

  // ── Titlebar button ───────────────────────────────────────────────────────

  const paintBtn = document.createElement('span');
  paintBtn.className = 'wm-btn';
  paintBtn.title = 'Paint overlay — draw on top of this window';
  paintBtn.innerHTML = '🖌️';
  paintBtn.style.fontSize = '13px';
  paintBtn.addEventListener('click', toggle);
  const firstBtn = tb.querySelector('.wm-btn');
  tb.insertBefore(paintBtn, firstBtn);

  // Cleanup: remove overlay + minibar + text layer when window closes
  onDispose?.(() => {
    removeOverlay();
    removeMiniBar();
    events.clear();
    overlayEvents.delete(events);
    if (textLayer) {
      textLayers.delete(textLayer);
      textLayer.destroy();
      textLayer = null;
    }
  });
}
