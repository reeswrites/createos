// widget-shell.js — the shared chassis for the creative widgets (Paint,
// SpriteEditor, AsciiEditor, Drumpad). Owns the cross-cutting concerns that were
// previously copy-pasted across all four: the WM window + body styling, the
// debounced autosave→desktop-icon loop, the WidgetHistory wiring, and the frame
// strip + transport UI built over a FrameController (see frame-doc.js).
//
// Composition, not inheritance: a widget builds its own rows (canvas, tools) and
// hands them to mountWidgetShell; frame widgets additionally build a strip +
// transport from their FrameDoc. Drumpad (no frames) simply skips those.

import { WidgetHistory } from './widget-history.js';
import { insertSnippet } from '../../editor/active-editor.js';
import { buildReplayCode } from '../signal/performance-recorder.js';

const ACTIVE_COLOR = '#cba6f7';
const INACTIVE_BORDER = '#45475a';

// ── Capture button (Performance recording, ADR 031) ───────────────────────────
// Wire a widget-supplied button to toggle a Take: first click arms, second click
// disarms and inserts `<ctor>; <var>.replay([...])` into the active editor. Solo
// capture; the desktop-level Global Capture is a separate path. `idleLabel` is
// restored on stop. The widget must implement `_perfCtor()`/`_applyAction()`.
export function wireCaptureButton(btn, { take, widget, idleLabel = '● Rec' }) {
  btn.title = 'Capture a performance → replay code';
  let recording = false;
  btn.addEventListener('click', () => {
    recording = !recording;
    if (recording) {
      take.arm();
      btn.textContent = '■ Stop';
      btn.style.color = '#f38ba8';
      btn.dataset.recording = '1';
    } else {
      const actions = take.disarm();
      btn.textContent = idleLabel;
      btn.style.color = '';
      delete btn.dataset.recording;
      if (actions.length) insertSnippet(buildReplayCode(widget, actions));
    }
  });
  return btn;
}

// ── Frame strip ──────────────────────────────────────────────────────────────
// `ctrl` is a FrameController (FrameDoc, or a Sprite adapter). The builder owns
// only the thumbnail row; the widget wires ctrl events to render/history/save.
export function buildFrameStrip(ctrl, { thumbH = 36, minThumbW = 0 } = {}) {
  const strip = document.createElement('div');
  strip.style.cssText =
    'display:flex;flex-direction:column;flex-shrink:0;background:#181825;border-top:1px solid #313244;';

  const thumbRow = document.createElement('div');
  thumbRow.style.cssText =
    'display:flex;gap:4px;padding:4px 8px;overflow-x:auto;align-items:center;min-height:50px;max-height:58px;';
  strip.appendChild(thumbRow);

  const btnRow = document.createElement('div');
  btnRow.style.cssText =
    'display:flex;gap:4px;padding:2px 8px 5px;align-items:center;flex-wrap:wrap;';

  const mk = (html, title, fn) => {
    const b = document.createElement('button');
    b.innerHTML = html;
    b.title = title;
    b.style.cssText = `background:#313244;color:#cdd6f4;border:1px solid ${INACTIVE_BORDER};
      border-radius:4px;padding:2px 7px;font-size:11px;cursor:pointer;`;
    b.addEventListener('click', fn);
    return b;
  };

  btnRow.appendChild(mk('<i class="fa-solid fa-plus"></i>', 'Add frame', () => ctrl.add()));
  btnRow.appendChild(
    mk('<i class="fa-solid fa-clone"></i>', 'Duplicate current frame', () => ctrl.duplicate()),
  );
  btnRow.appendChild(
    mk('<i class="fa-solid fa-broom"></i>', 'Clear frame', () => ctrl.clearCurrent()),
  );
  btnRow.appendChild(
    mk('<i class="fa-solid fa-trash"></i>', 'Delete current frame', () => ctrl.remove()),
  );
  btnRow.appendChild(
    mk('<i class="fa-solid fa-chevron-left"></i>', 'Move frame left', () => ctrl.move(-1)),
  );
  btnRow.appendChild(
    mk('<i class="fa-solid fa-chevron-right"></i>', 'Move frame right', () => ctrl.move(+1)),
  );

  const onionBtn = mk('<i class="fa-solid fa-layer-group"></i>', 'Toggle onion skin', () => {
    ctrl.onion = !ctrl.onion;
  });
  const syncOnion = () => {
    onionBtn.style.borderColor = ctrl.onion ? ACTIVE_COLOR : INACTIVE_BORDER;
  };
  ctrl.on('onion', syncOnion);
  btnRow.appendChild(onionBtn);
  strip.appendChild(btnRow);

  function refreshThumbs() {
    thumbRow.innerHTML = '';
    for (let i = 0; i < ctrl.count; i++) {
      const wrap = document.createElement('div');
      wrap.style.cssText =
        'display:flex;flex-direction:column;align-items:center;gap:2px;cursor:pointer;flex-shrink:0;';

      const tc = document.createElement('canvas');
      ctrl.drawThumb(tc, i); // widget sizes + paints tc
      // Display aspect: controller may override (e.g. non-square ASCII cells);
      // otherwise derive from the thumbnail canvas's own pixel ratio.
      const ar = ctrl.thumbAspect ?? (tc.width / tc.height || 1);
      const tw = Math.max(minThumbW, Math.round(thumbH * ar));
      const px = ctrl.thumbPixelated ? 'image-rendering:pixelated;' : '';
      tc.style.cssText = `width:${tw}px;height:${thumbH}px;border:2px solid ${i === ctrl.index ? ACTIVE_COLOR : INACTIVE_BORDER};border-radius:3px;${px}`;

      const lbl = document.createElement('span');
      lbl.textContent = i + 1;
      lbl.style.cssText = 'font-size:9px;color:#6c7086;font-family:monospace;';

      wrap.appendChild(tc);
      wrap.appendChild(lbl);
      wrap.addEventListener('click', () => ctrl.go(i));
      thumbRow.appendChild(wrap);
    }
  }

  // Keep the strip in sync with the model regardless of who mutated it.
  ctrl.on('mutate', refreshThumbs);
  ctrl.on('select', refreshThumbs);
  refreshThumbs();

  return { el: strip, refreshThumbs };
}

// ── Transport ─────────────────────────────────────────────────────────────────
// play/stop/fps over a FrameController. `extraButtons` are widget-specific
// export buttons (Code/PNG/Sheet) appended after the spacer — see Fork C, ADR.
export function buildTransport(ctrl, { onFpsChange, extraButtons = [] } = {}) {
  const row = document.createElement('div');
  row.style.cssText =
    'display:flex;align-items:center;gap:5px;padding:5px 8px;background:#13131f;border-top:1px solid #2a2a3e;flex-shrink:0;flex-wrap:wrap;';

  const mkBtn = (html, color, title, fn) => {
    const b = document.createElement('button');
    b.innerHTML = html;
    b.title = title;
    b.style.cssText = `background:#1e1e2e;color:${color};border:1px solid #313244;
      border-radius:4px;padding:3px 8px;font-size:11px;cursor:pointer;`;
    b.addEventListener('click', fn);
    return b;
  };

  const playBtn = mkBtn('<i class="fa-solid fa-play"></i>', '#a6e3a1', 'Play animation', () => {
    const fps = parseInt(fpsIn.value, 10) || 8;
    ctrl.play(fps);
    playBtn.style.background = '#1a3d1a';
  });
  const stopBtn = mkBtn('<i class="fa-solid fa-stop"></i>', '#f38ba8', 'Stop animation', () => {
    ctrl.stop();
    playBtn.style.background = '#1e1e2e';
  });

  const fpsLbl = document.createElement('span');
  fpsLbl.textContent = 'fps:';
  fpsLbl.style.cssText = 'color:#6c7086;font-size:10px;font-family:monospace;';

  const fpsIn = document.createElement('input');
  fpsIn.type = 'number';
  fpsIn.value = String(ctrl.fps ?? 8);
  fpsIn.min = '1';
  fpsIn.max = '60';
  fpsIn.style.cssText =
    'width:38px;background:#1e1e2e;color:#cdd6f4;border:1px solid #313244;border-radius:3px;padding:2px 4px;font-size:11px;font-family:monospace;text-align:center;';
  fpsIn.addEventListener('change', () => {
    const fps = parseInt(fpsIn.value, 10) || 8;
    ctrl.fps = fps;
    onFpsChange?.(fps);
  });

  const spacer = document.createElement('span');
  spacer.style.flex = '1';

  row.appendChild(playBtn);
  row.appendChild(stopBtn);
  row.appendChild(fpsLbl);
  row.appendChild(fpsIn);
  row.appendChild(spacer);
  for (const b of extraButtons) row.appendChild(b);

  return row;
}

// ── Window shell + autosave + history ──────────────────────────────────────────
//
// opts:
//   title, x, y, w, h          — window placement/size
//   widgetType                 — win._widgetType tag ('paint'|'spriteEditor'|...)
//   rows                       — ordered body child elements the widget built
//   getState                   — () => serializable state (window state + autosave content)
//   save: { name, type, getIconId, setIconId }  — desktop autosave config
//   history: { capture, restore }               — optional WidgetHistory hooks
//   onMount()                  — optional, called after rows are appended
//   onDestroy()                — optional teardown (backdrop, module-array splice, etc.)
//
// returns { winId, win, body, save, history } — `save` is the debounced autosave.
export function mountWidgetShell(opts) {
  const {
    title,
    x,
    y,
    w,
    h,
    widgetType,
    rows = [],
    bg = '#1e1e2e',
    getState,
    save: saveCfg,
    history: historyHooks,
    onMount,
    onDestroy,
    keepIconOnClose = false,
  } = opts;

  if (!window.wm) return null;

  const winId = window.wm.spawn(title, {
    type: 'html',
    html: '',
    w,
    h,
    audio: false,
    ...(x != null ? { x } : {}),
    ...(y != null ? { y } : {}),
  });

  const win = document.getElementById(winId);
  if (!win) return null;
  const body = win.querySelector('.wm-body');
  if (!body) return null;

  body.style.cssText += `background:${bg};overflow:hidden;padding:0;flex-direction:column;gap:0;`;
  for (const row of rows) if (row) body.appendChild(row);

  win._widgetType = widgetType;
  win._widgetState = () => getState();

  let history = null;
  if (historyHooks) {
    history = new WidgetHistory(historyHooks);
    window.wm?.addHistoryControls(winId, history);
  }

  // Debounced autosave → desktop icon. getIconId/setIconId let the widget keep
  // owning _desktopIconId (round-trips through getState) with no behaviour change.
  const _wasFresh = !saveCfg.getIconId(); // true when created new (not restored)
  let _saveCallCount = 0;
  let _saveTimer = null;
  const save = () => {
    _saveCallCount++;
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => {
      const content = JSON.stringify(getState());
      const blob = new Blob([content], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const id = saveCfg.getIconId();
      if (!id) {
        const newId = window.desktop?.add(url, {
          name: saveCfg.name,
          type: saveCfg.type,
          content,
        })?.id;
        saveCfg.setIconId(newId);
      } else {
        window.desktop?.updateUrl(id, url, content);
      }
    }, 300);
  };

  // If widget was born fresh and closed without any real interaction (only the
  // init autosave ran), remove the desktop icon — mirrors empty-editor behavior.
  // keepIconOnClose skips deletion for widgets with meaningful default content (Drumpad).
  win._wmCleanup = () => {
    onDestroy?.();
    if (!keepIconOnClose && _wasFresh && _saveCallCount <= 1) {
      const id = saveCfg.getIconId();
      if (id) window.desktop?.remove(id);
    }
  };

  onMount?.();
  return { winId, win, body, save, history };
}
