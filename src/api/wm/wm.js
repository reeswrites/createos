// Window manager: draggable/resizable floating windows + named tiling layouts.
// All layout coords are 0–1 fractions of desktop size, resolved to px at apply time.

// All windows are spawned (no built-in/special windows). Layouts position tiled windows; floating windows manage themselves.

import * as Tone from 'tone';
import { WM_STATE } from '../../runtime/storage-keys.js';
import { activeEditorId } from '../../runtime/run-context.js';
import { installWindowPhysics } from './window-physics.js';
import {
  registerWindowType,
  getWindowAdapter,
  geoOf,
  titleOf,
  readAudio,
} from './window-registry.js';
import {
  storeWinHandle as _storeWinHandle,
  loadWinHandle as _loadWinHandle,
  deleteWinHandle as _deleteWinHandle,
} from './file-handle-store.js';
import { buildSensorWindow } from './sensor-window.js';
import { restoreWidget } from './widget-restorer-registry.js';
import { createWindowChrome } from './window-chrome.js';
import { buildVizWindow, addVizPanel } from './viz-window.js';
import { makeFileEntry, renderFlatFiles, renderDirContents } from './file-browser.js';
import { makeNativeDirHandle, makeNativeFileHandle } from './native-fs-adapter.js';
import { nativeCap } from '../../runtime/native.js';
import { onReset } from '../../runtime/reset-registry.js';
import { notify, registerCommand, tween, hasSubscribers } from '../../events/index.js';
import { acquireCamera } from '../media/media-lease.js';
import { acquireStrip, releaseStrip } from '../audio/mixer.js';
import { TextLayer } from '../widgets/text-layer.js';
import { liveOutput } from '../../runtime/keep-alive.js';
import { mountLayerCanvas } from '../visual/layer.js';

// ── Paint-overlay WidgetEvents registry (for cleanupPaintOverlays) ────────────

const _overlayEvents = new Set();
const _textLayers = new Set();

/** Called on every editor reset — clears overlay hooks and run-scoped text objects. */
export function cleanupPaintOverlays() {
  for (const ev of _overlayEvents) ev.clear();
  for (const tl of _textLayers) tl.clearRunScoped();
}

// ── File browser helpers ──────────────────────────────────────────────────────

function _pickDirViaInput() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.webkitdirectory = true;
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', () => {
      document.body.removeChild(input);
      const files = [...input.files];
      if (!files.length) {
        resolve(null);
        return;
      }
      const name = files[0].webkitRelativePath?.split('/')[0] || 'Files';
      resolve({ name, files });
    });
    input.click();
  });
}

async function _exitFullscreen() {
  if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
}

function _pickFileViaInput(opts = {}) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.style.display = 'none';
    if (opts.accept) input.accept = opts.accept;
    document.body.appendChild(input);
    input.addEventListener('change', () => {
      document.body.removeChild(input);
      const file = input.files[0];
      resolve(file ? URL.createObjectURL(file) : null);
    });
    input.click();
  });
}

// Focused window id — set when any window comes to front (bringToFront choke point).
// Used by input.js to tag key events with the focused window.
let _focusedWinId = null;
export function getFocusedWinId() {
  return _focusedWinId;
}

export function initWM(onContentResize) {
  const desktop = document.getElementById('desktop');
  let zTop = 100;
  const savedGeometry = new Map();
  const spawnedIds = new Set();
  const fileHandles = new Map();
  const _droppedFileHandles = [];
  const _browseRefreshCbs = new Set();
  let spawnCounter = 0;

  // Release a window from the keep-alive set it was registered into (if any).
  // Uses the captured liveOutput handle — survives active-editor switches (ADR 009).
  function _releaseWin(win) {
    win._live?.release();
    win._live = null;
  }

  // ── Undo / redo history ───────────────────────────────────────────────────
  const _wmHistory = [];
  const _wmRedoHistory = [];
  const _WM_HISTORY_MAX = 50;
  let _wmHistoryDebounce = null;

  // Common window geometry + class fields — used by both _captureState (undo) and _flushState (persist).
  function _winBaseEntry(win) {
    return {
      id: win.id,
      x: parseInt(win.style.left) || 0,
      y: parseInt(win.style.top) || 0,
      w: parseInt(win.style.width) || 320,
      h: parseInt(win.style.height) || 240,
      visible: win.style.display !== 'none' && !win._wmMinimized,
      maximized: win.classList.contains('wm-maximized'),
      nochrome: win.classList.contains('wm-no-chrome'),
      transparent: win.classList.contains('wm-transparent'),
    };
  }

  // Shared type-payload writer for the two IN-SESSION serializers (undo `_captureState`
  // and localStorage `_flushState`). Geometry lives in `_winBaseEntry`; this adds the
  // spawned window's type-specific fields (title, toolkit, html/src/loop, blob handle,
  // viz source/style/colors, widget state) so the two paths cannot drift — the bug this
  // closes was undo omitting viz style + widget state + toolkit, respawning them bare.
  // Returns false when the window must not be persisted at all (transient run-artifact).
  // The portable-project path (Window Type Adapters) is deliberately NOT unified here:
  // it emits an id-less, cross-machine record (fileKey not hasHandle, 'visualizer' not
  // 'viz') — a different contract. See window-registry.js.
  function _serializeSpawnedType(win, entry) {
    const opts = win._wmSpawnOpts;
    if (!opts || opts.transient) return false;
    entry.spawned = true;
    entry.title = win.querySelector('.wm-title')?.textContent ?? opts.title;
    // Toolkit windows restored via app-level handler, not generic html spawn
    if (win.id.startsWith('win-toolkit')) {
      entry.type = 'toolkit';
      return true;
    }
    entry.type = opts.type;
    const isBlobSrc = opts.src?.startsWith('blob:');
    if (opts.html !== undefined) entry.html = opts.html;
    if (!isBlobSrc && opts.src !== undefined) entry.src = opts.src;
    if (opts.loop !== undefined) entry.loop = opts.loop;
    if (isBlobSrc) entry.hasHandle = true; // handle stored in IndexedDB
    // Persist viz source/style so restored windows reuse them
    if (opts.type === 'viz') {
      entry.source = win._vizSourceEl?.value ?? opts.source ?? 'master';
      entry.style = win._vizStyleEl?.value ?? opts.style ?? 'wave';
      if (win._vizColors) entry.colors = { ...win._vizColors };
    }
    if (win._widgetType) {
      entry.widgetType = win._widgetType;
      entry.widgetState = win._widgetState?.() ?? {};
    }
    return true;
  }

  // Recreate a spawned window that no longer exists in the DOM, from a serialized entry.
  // Shared by localStorage restore (restoreState) and undo apply (_applySnapshot) so both
  // faithfully rebuild viz/widget/toolkit windows instead of a bare geometry spawn.
  function _respawnEntry(s) {
    if (s.hasHandle || s.fileKey) {
      _restoreFileWindow(s);
      return null;
    }
    if (s.widgetType) {
      restoreWidget(s.widgetType, s);
      return document.getElementById(s.id);
    }
    if (s.type === 'html' && !s.html) return null; // code-generated html — nothing static to rebuild
    if (s.type === 'toolkit' && typeof window.__ar_createToolkit === 'function') {
      const tkNum = s.id === 'win-toolkit' ? 1 : parseInt(s.id?.replace('win-toolkit-', '')) || 1;
      const win = window.__ar_createToolkit(tkNum);
      if (win) {
        win.style.left = `${s.x}px`;
        win.style.top = `${s.y}px`;
        win.style.width = `${s.w}px`;
        win.style.height = `${s.h}px`;
        win.style.display = s.visible ? 'flex' : 'none';
        if (s.maximized) _toggleMaximize(win);
        if (s.nochrome) win.classList.add('wm-no-chrome');
        if (s.transparent) win.classList.add('wm-transparent');
      }
      return win;
    }
    const id = api.spawn(s.title, {
      id: s.id,
      type: s.type,
      x: s.x,
      y: s.y,
      w: s.w,
      h: s.h,
      html: s.html,
      src: s.src,
      loop: s.loop,
      source: s.source,
      style: s.style,
      colors: s.colors,
    });
    const win = document.getElementById(id);
    if (win) {
      if (s.nochrome) win.classList.add('wm-no-chrome');
      if (s.transparent) win.classList.add('wm-transparent');
    }
    return win;
  }

  function _captureState() {
    const wins = [];
    desktop.querySelectorAll('.wm-win').forEach((win) => {
      const entry = { ..._winBaseEntry(win), _restore: win._wmRestoreHandler ?? null };
      if (spawnedIds.has(win.id)) {
        const opts = win._wmSpawnOpts;
        // Undo deliberately excludes canvas/shader (run-artifacts) AND camera
        // (respawning would re-grab the webcam) — an intentional difference from persist.
        if (opts && !['canvas', 'shader', 'camera'].includes(opts.type)) {
          _serializeSpawnedType(win, entry);
        }
      }
      wins.push(entry);
    });
    return wins;
  }

  function _applySnapshot(snapshot) {
    snapshot.forEach((entry) => {
      const win = document.getElementById(entry.id);
      if (win) {
        win.style.left = `${entry.x}px`;
        win.style.top = `${entry.y}px`;
        win.style.width = `${entry.w}px`;
        win.style.height = `${entry.h}px`;
        if (entry.visible && win.style.display === 'none') {
          win.style.display = 'flex';
          win._wmMinimized = false;
          taskbar.querySelector(`[data-win-id="${entry.id}"]`)?.remove();
          if (!taskbar.querySelector('.wm-taskbar-chip')) taskbar.style.display = 'none';
        }
        win.classList.toggle('wm-no-chrome', !!entry.nochrome);
        win.classList.toggle('wm-transparent', !!entry.transparent);
      } else if (entry.spawned) {
        _respawnEntry(entry);
      } else if (entry._restore) {
        entry._restore();
      }
    });
  }

  function _pushSnapshot(snapshot) {
    _wmRedoHistory.length = 0;
    _wmHistory.push(snapshot);
    if (_wmHistory.length > _WM_HISTORY_MAX) _wmHistory.shift();
    _updateHistoryBtns();
  }

  function _pushHistory() {
    // Capture immediately so snapshot reflects state *before* the op.
    // Debounce: rapid ops (e.g. drag) collapse into one undo step.
    if (_wmHistoryDebounce) return;
    const snapshot = _captureState();
    _wmHistoryDebounce = setTimeout(() => {
      _wmHistoryDebounce = null;
      _pushSnapshot(snapshot);
    }, 500);
  }

  function _undoHistory() {
    const snapshot = _wmHistory.pop();
    if (!snapshot) return;
    _wmRedoHistory.push(_captureState());
    _applySnapshot(snapshot);
    _updateHistoryBtns();
    _saveState();
  }

  function _redoHistory() {
    const snapshot = _wmRedoHistory.pop();
    if (!snapshot) return;
    _wmHistory.push(_captureState());
    _applySnapshot(snapshot);
    _updateHistoryBtns();
    _saveState();
  }

  function _updateHistoryBtns() {
    const u = document.getElementById('undoWinBtn');
    const r = document.getElementById('redoWinBtn');
    if (u) {
      u.toggleAttribute('disabled', !_wmHistory.length);
      u.style.opacity = _wmHistory.length ? '1' : '0.4';
    }
    if (r) {
      r.toggleAttribute('disabled', !_wmRedoHistory.length);
      r.style.opacity = _wmRedoHistory.length ? '1' : '0.4';
    }
  }

  // ── State persistence ─────────────────────────────────────────────────────
  const _SAVE_KEY = WM_STATE;
  let _savePending = null;

  function _flushState() {
    const wins = [];
    desktop.querySelectorAll('.wm-win').forEach((win) => {
      const entry = _winBaseEntry(win);
      if (spawnedIds.has(win.id)) {
        const opts = win._wmSpawnOpts;
        if (!opts) return;
        // Persist excludes canvas/shader (ADR 040 run-artifacts); transient dropped by
        // the shared serializer. camera IS persisted here (unlike undo — see _captureState).
        if (['canvas', 'shader'].includes(opts.type)) return;
        if (!_serializeSpawnedType(win, entry)) return; // transient → drop, don't push
      }
      wins.push(entry);
    });
    try {
      localStorage.setItem(_SAVE_KEY, JSON.stringify({ wins }));
    } catch (_) {}
  }

  function _saveState() {
    clearTimeout(_savePending);
    _savePending = setTimeout(_flushState, 400);
  }

  // ── Taskbar ────────────────────────────────────────────────────────────────
  const taskbar = document.createElement('div');
  taskbar.id = 'wm-taskbar';
  desktop.appendChild(taskbar);

  function _minimizeToTaskbar(win) {
    const winId = win.id;
    const title = win.querySelector('.wm-title')?.textContent ?? winId;
    savedGeometry.set(winId + '_min', {
      left: win.style.left,
      top: win.style.top,
      width: win.style.width,
      height: win.style.height,
    });
    win.style.display = 'none';
    win._wmMinimized = true;

    const chip = document.createElement('div');
    chip.className = 'wm-taskbar-chip';
    chip.dataset.winId = winId;
    const dot = document.createElement('span');
    dot.className = 'wm-chip-dot';
    const label = document.createElement('span');
    label.textContent = title;
    chip.appendChild(dot);
    chip.appendChild(label);
    chip.addEventListener('click', () => _restoreFromTaskbar(winId));
    taskbar.appendChild(chip);
    taskbar.style.display = 'flex';
  }

  function _restoreFromTaskbar(winId) {
    const win = document.getElementById(winId);
    if (!win) return;
    const saved = savedGeometry.get(winId + '_min');
    if (saved) {
      win.style.left = saved.left;
      win.style.top = saved.top;
      win.style.width = saved.width;
      win.style.height = saved.height;
    }
    win.style.display = 'flex';
    win._wmMinimized = false;
    taskbar.querySelector(`[data-win-id="${winId}"]`)?.remove();
    if (!taskbar.querySelector('.wm-taskbar-chip')) taskbar.style.display = 'none';
    bringToFront(win);
    onContentResize?.();
  }

  // Master-audio taskbar chip (ADR 040): audio control no longer lives on an
  // output window (there isn't one) — it lives in the desktop chrome. The chip
  // appears once a sketch uses audio; clicking it opens the full mixer panel.
  function ensureAudioChip() {
    if (taskbar.querySelector('.wm-audio-chip')) return;
    const chip = document.createElement('div');
    chip.className = 'wm-taskbar-chip wm-audio-chip';
    chip.title = 'Audio — open mixer';
    const icon = document.createElement('span');
    icon.innerHTML = '<i class="fa-solid fa-volume-high"></i>';
    const label = document.createElement('span');
    label.textContent = 'Audio';
    chip.appendChild(icon);
    chip.appendChild(label);
    chip.addEventListener('click', () => {
      window.mixer?.show?.();
    });
    taskbar.appendChild(chip);
    taskbar.style.display = 'flex';
  }

  // Per-window mixer Strip (ADR 032) — window audio flows through the Mixer.
  // _winStrips: winId → Strip. wm.channel(id) exposes the strip's Tone.Channel
  // so Tone sources routed into it are mixable; window media is rebridged into
  // the strip input so it appears as a Strip in the console.
  const _winStrips = new Map();

  // Context handed to the extracted viz-window builders so they never touch the wm
  // closure's private state directly (desktop scan, mixer strips, dispose accumulator).
  const _vizCtx = {
    desktop,
    hasStrip: (id) => _winStrips.has(id),
    resolveChannel: (winStripId) => _winStrips.get(winStripId)?._channel,
    onDispose: (win, fn) => _onDispose(win, fn),
  };

  function _getWindowStrip(winId) {
    let strip = _winStrips.get(winId);
    if (!strip) {
      const win = document.getElementById(winId);
      const title = win?.querySelector('.wm-title')?.textContent?.trim() || winId;
      strip = acquireStrip(title, { type: 'window', owner: winId, lifecycle: 'window' });
      _winStrips.set(winId, strip);
    }
    return strip;
  }

  function _getChannel(winId) {
    return _getWindowStrip(winId)._channel;
  }

  function _disposeChannel(winId) {
    const strip = _winStrips.get(winId);
    if (strip) {
      releaseStrip(strip.name);
      _winStrips.delete(winId);
    }
  }

  // Capture a window's <video>/<audio> element into the Web Audio graph and route
  // it through its mixer strip. Same-origin / blob media (uploaded files) works;
  // cross-origin without CORS may go silent, so the titlebar keeps element-volume
  // as a fallback. Idempotent (MediaElementSource can only be created once).
  function _routeMediaToStrip(winId, mediaEl) {
    if (!mediaEl || mediaEl._ar_routedToStrip) return;
    try {
      const audioCtx = Tone.getContext().rawContext;
      if (!mediaEl._ar_mediaSource)
        mediaEl._ar_mediaSource = audioCtx.createMediaElementSource(mediaEl);
      Tone.connect(mediaEl._ar_mediaSource, _getWindowStrip(winId).input);
      mediaEl._ar_routedToStrip = true;
    } catch (_) {}
  }

  // Titlebar decorators (flip / capture / paint-overlay / history / audio / video /
  // copy-path) live in window-chrome.js — pure DOM builders bound here to the WM
  // internals they need. See ADR 042 (this continues that decomposition).
  const _chrome = createWindowChrome({
    desktop,
    onDispose: _onDispose,
    getWindowStrip: _getWindowStrip,
    routeMediaToStrip: _routeMediaToStrip,
    overlayEvents: _overlayEvents,
    textLayers: _textLayers,
  });

  function getWin(id) {
    const eid = activeEditorId() ?? 1;
    if (id === 'win-canvas') id = `win-canvas-${eid}`;
    if (id === 'win-editor') id = `win-editor-${eid}`;
    if (id === 'win-console') id = `win-console-${eid}`;
    return document.getElementById(id);
  }

  // ── Window handle: dispose accumulator + type + serialize (ADR: Window handle)
  // Replaces the `win._wmCleanup` expando slot. `onDispose(fn)` accumulates; close
  // fires every listener LIFO (matching the old prev?.() chain order). The per-type
  // base cleanup registers first, so it fires last. Removes the clobber leak where a
  // bare `win._wmCleanup = fn` silently dropped an earlier cleanup.
  function _onDispose(win, fn) {
    if (!win || typeof fn !== 'function') return;
    (win._disposers ||= []).push(fn);
  }
  function _runDisposers(win) {
    const fns = win?._disposers;
    if (fns) {
      win._disposers = null;
      for (let i = fns.length - 1; i >= 0; i--) {
        try {
          fns[i]();
        } catch (_) {}
      }
    }
    // Safety net for any unmigrated slot — no known writer remains.
    try {
      win._wmCleanup?.();
      win._wmCleanup = null;
    } catch (_) {}
  }

  // The canonical type of a spawned window, for serialize + the handle's `type`.
  function _winType(win) {
    if (!win) return 'unknown';
    if (win._wmIsEditor) return 'editor';
    if (win.id?.startsWith('win-toolkit')) return 'toolkit';
    if (win.id?.startsWith('win-canvas-')) return 'canvas';
    return win._wmSpawnOpts?.type ?? 'unknown';
  }

  // wm.window(id) → handle facade over the .wm-win element. handle.id === id, so the
  // id stays the stable DOM/IndexedDB/serialize key across all call sites.
  function _windowHandle(win) {
    if (!win) return null;
    return {
      id: win.id,
      el: win,
      get type() {
        return _winType(win);
      },
      onDispose(fn) {
        _onDispose(win, fn);
        return this;
      },
      dispose() {
        api.close(win.id);
        return this;
      },
      serialize() {
        return serializeWindowEl(win);
      },
    };
  }

  // Serialize one window element via its registered Window Type Adapter; null = skip.
  function serializeWindowEl(win) {
    if (!win) return null;
    const type = _winType(win);
    const adapter = getWindowAdapter(type);
    if (!adapter?.serialize) return null;
    return adapter.serialize(win, {
      type,
      geoOf,
      titleOf,
      readAudio,
      opts: win._wmSpawnOpts,
      wm: api,
    });
  }

  function bringToFront(win) {
    win.style.zIndex = String(zTop++);
    if (win.id && win.id !== _focusedWinId) {
      const prev = _focusedWinId;
      _focusedWinId = win.id;
      if (prev) notify('wm:blur', { id: prev });
      notify('wm:focus', { id: win.id });
    }
  }

  // Does the running sketch claim the pointer for this window? If user code
  // subscribes to mouse events (globally or scoped to this window), body drags
  // belong to the sketch — the window moves from the titlebar instead.
  const _mouseClaimed = (winId) =>
    hasSubscribers('window:mouse:down', { runScopedOnly: true }) ||
    hasSubscribers('window:mouse:move', { runScopedOnly: true }) ||
    hasSubscribers('window:mouse:up', { runScopedOnly: true }) ||
    (winId &&
      (hasSubscribers(`wm:${winId}:mouse:down`, { runScopedOnly: true }) ||
        hasSubscribers(`wm:${winId}:mouse:move`, { runScopedOnly: true }) ||
        hasSubscribers(`wm:${winId}:mouse:up`, { runScopedOnly: true })));

  // Drag via titlebar, hover-strip, or body of content-only windows
  desktop.addEventListener('mousedown', (e) => {
    const tb = e.target.closest('.wm-titlebar');
    const hs = !tb && e.target.closest('.wm-hover-strip');
    const bd =
      !tb &&
      !hs &&
      (() => {
        const b = e.target.closest('.wm-body');
        return b?.closest('.wm-win')?.classList.contains('wm-draggable-body') ? b : null;
      })();
    if (!tb && !hs && !bd) return;
    if (e.target.closest('.wm-btn')) return;
    if (e.target.closest('[contenteditable="true"]')) return;
    if (bd && e.target.closest('select, input, button, a, textarea')) return;
    const win = (tb || hs || bd).closest('.wm-win');
    // Body drag yields to an interactive sketch that's listening to the mouse;
    // titlebar/hover-strip drags always move the window.
    if (bd && _mouseClaimed(win.id)) return;
    bringToFront(win);
    const ox = e.clientX - win.offsetLeft;
    const oy = e.clientY - win.offsetTop;
    const preSnap = _captureState();
    let _moved = false;
    const onMove = (e) => {
      _moved = true;
      const dw = desktop.offsetWidth,
        dh = desktop.offsetHeight;
      win.style.left = `${Math.max(0, Math.min(dw - 80, e.clientX - ox))}px`;
      win.style.top = `${Math.max(0, Math.min(dh - 28, e.clientY - oy))}px`;
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (_moved) {
        _pushSnapshot(preSnap);
        notify('wm:move', { id: win.id, x: win.offsetLeft, y: win.offsetTop });
      }
      onContentResize?.();
      _saveState();
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    e.preventDefault();
  });

  // Resize via edge/corner handles
  desktop.addEventListener('mousedown', (e) => {
    const handle = e.target.closest('.wm-resize-handle');
    if (!handle) return;
    const dir = handle.dataset.resize;
    const win = handle.closest('.wm-win');
    bringToFront(win);
    const sx = e.clientX,
      sy = e.clientY;
    const sw = win.offsetWidth,
      sh = win.offsetHeight;
    const sl = win.offsetLeft,
      st = win.offsetTop;
    const preSnap = _captureState();
    let _resized = false;
    const onMove = (e) => {
      _resized = true;
      const dx = e.clientX - sx,
        dy = e.clientY - sy;
      if (dir.includes('e')) win.style.width = `${Math.max(180, sw + dx)}px`;
      if (dir.includes('s')) win.style.height = `${Math.max(80, sh + dy)}px`;
      if (dir.includes('w')) {
        const nw = Math.max(180, sw - dx);
        win.style.width = `${nw}px`;
        win.style.left = `${sl + sw - nw}px`;
      }
      if (dir.includes('n')) {
        const nh = Math.max(80, sh - dy);
        win.style.height = `${nh}px`;
        win.style.top = `${st + sh - nh}px`;
      }
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (_resized) {
        _pushSnapshot(preSnap);
        notify('wm:resize', { id: win.id, w: win.offsetWidth, h: win.offsetHeight });
      }
      onContentResize?.();
      _saveState();
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    e.preventDefault();
    e.stopPropagation();
  });

  // Click window to bring to front
  desktop.addEventListener(
    'mousedown',
    (e) => {
      const win = e.target.closest('.wm-win');
      if (win) bringToFront(win);
    },
    true,
  );

  // Duplicate button
  desktop.addEventListener('click', (e) => {
    if (!e.target.closest('.wm-dup')) return;
    const win = e.target.closest('.wm-win');
    if (!win?._wmSpawnOpts) return;
    const { title: t, ...savedOpts } = win._wmSpawnOpts;
    api.spawn(t, {
      ...savedOpts,
      id: undefined,
      x: win.offsetLeft + 24,
      y: win.offsetTop + 24,
      w: win.offsetWidth,
      h: win.offsetHeight,
    });
  });

  // Minimize button
  desktop.addEventListener('click', (e) => {
    if (!e.target.closest('.wm-min')) return;
    const win = e.target.closest('.wm-win');
    if (win) {
      _pushHistory();
      _minimizeToTaskbar(win);
    }
  });

  // Full teardown + DOM removal of a spawned window. Used by the close button and
  // by programmatic api.remove() (e.g. pipeline/route closing the window it spawned on reset).
  // animate=false removes synchronously (no wm-closing transition) — for reset paths.
  function _destroyWin(win, { animate = true } = {}) {
    if (!win || !spawnedIds.has(win.id)) return false;
    _releaseWin(win);
    // Tear down any layer-stack planes (ADR 040) — disconnect DPR observers.
    if (win._layerStack) {
      for (const c of win._layerStack.values()) {
        try {
          c._ar_resizeObserver?.disconnect();
        } catch (_) {}
      }
      win._layerStack.clear();
    }
    _runDisposers(win);
    win._wmRescueContent?.();
    _disposeChannel(win.id);
    _deleteWinHandle(win.id);
    spawnedIds.delete(win.id);
    const _onClose = win._wmUserOnClose;
    const _closedTitle = win.querySelector('.wm-title')?.textContent?.trim() ?? '';
    const _closedType = win._wmSpawnOpts?.type ?? 'unknown';
    const _closedId = win.id;
    // If this window was focused, blur it before removal.
    if (_closedId === _focusedWinId) {
      _focusedWinId = null;
      notify('wm:blur', { id: _closedId });
    }
    const finalize = () => {
      win.remove();
      _onClose?.();
      notify('wm:close', { id: _closedId, title: _closedTitle, type: _closedType });
    };
    if (animate) {
      win.classList.add('wm-closing');
      win.addEventListener('animationend', finalize, { once: true });
    } else {
      finalize();
    }
    return true;
  }

  // Close button — supports custom _wmOnClose handler (e.g. editor)
  desktop.addEventListener('click', (e) => {
    if (!e.target.classList.contains('wm-close')) return;
    const win = e.target.closest('.wm-win');
    _pushHistory();
    if (win._wmOnClose) {
      win._wmOnClose(); // handler responsible for removal
      _saveState();
      return;
    }
    if (!_destroyWin(win)) {
      win.style.display = 'none';
      notify('wm:hide', { id: win.id });
    }
    _saveState();
  });

  // Maximize / restore button
  desktop.addEventListener('click', (e) => {
    const btn = e.target.closest('.wm-max');
    if (!btn) return;
    const win = btn.closest('.wm-win');
    _pushHistory();
    _toggleMaximize(win, btn);
    onContentResize?.();
    _saveState();
  });

  function _toggleMaximize(win, btn) {
    btn = btn || win.querySelector('.wm-max');
    if (win.classList.contains('wm-maximized')) {
      const saved = savedGeometry.get(win.id);
      if (saved) {
        win.style.left = saved.left;
        win.style.top = saved.top;
        win.style.width = saved.width;
        win.style.height = saved.height;
      }
      win.classList.remove('wm-maximized');
      if (btn) {
        btn.innerHTML = '<i class="fa-regular fa-window-maximize"></i>';
        btn.title = 'Maximize';
      }
    } else {
      savedGeometry.set(win.id, {
        left: win.style.left,
        top: win.style.top,
        width: win.style.width,
        height: win.style.height,
      });
      win.style.left = '0';
      win.style.top = '0';
      win.style.width = '100%';
      win.style.height = '100%';
      win.style.zIndex = String(zTop++);
      win.classList.add('wm-maximized');
      if (btn) {
        btn.innerHTML = '<i class="fa-solid fa-window-restore"></i>';
        btn.title = 'Restore';
      }
    }
  }

  // True only when the click lands on the text content itself (not empty flex space)
  function _onTitleText(titleEl, e) {
    const range = document.createRange();
    range.selectNodeContents(titleEl);
    for (const rect of range.getClientRects()) {
      if (
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom
      )
        return true;
    }
    return false;
  }

  // Rename: double-click title label text only
  desktop.addEventListener('dblclick', (e) => {
    const title = e.target.closest('.wm-title');
    if (!title || !_onTitleText(title, e)) return;
    const original = title.textContent;
    title.contentEditable = 'true';
    title.focus();
    const range = document.createRange();
    range.selectNodeContents(title);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    const commit = () => {
      title.contentEditable = 'false';
      title.removeEventListener('blur', commit);
      title.removeEventListener('keydown', onKey);
      const win = title.closest('.wm-win');
      win?._wmOnTitleChange?.(title.textContent.trim());
    };
    const onKey = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commit();
      }
      if (e.key === 'Escape') {
        title.textContent = original;
        commit();
      }
    };
    title.addEventListener('blur', commit);
    title.addEventListener('keydown', onKey);
  });

  // Dblclick titlebar background → toggle chrome-less mode
  desktop.addEventListener('dblclick', (e) => {
    const tb = e.target.closest('.wm-titlebar');
    if (!tb) return;
    if (e.target.closest('.wm-btn')) return;
    const titleEl = e.target.closest('.wm-title');
    if (titleEl && _onTitleText(titleEl, e)) return; // let rename handler take it
    tb.closest('.wm-win').classList.toggle('wm-no-chrome');
  });

  // Dblclick hover-strip → restore titlebar
  desktop.addEventListener('dblclick', (e) => {
    if (!e.target.closest('.wm-hover-strip')) return;
    e.target.closest('.wm-win').classList.remove('wm-no-chrome');
  });

  // Ghost button → toggle transparent window
  desktop.addEventListener('click', (e) => {
    const btn = e.target.closest('.wm-ghost');
    if (!btn) return;
    const win = btn.closest('.wm-win');
    if (!win) return;
    win.classList.toggle('wm-transparent');
    btn.classList.toggle('wm-ghost-on', win.classList.contains('wm-transparent'));
  });

  // Drop files from OS onto desktop → spawn image/video window at cursor
  desktop.addEventListener('dragover', (e) => {
    if (e.dataTransfer && [...e.dataTransfer.items].some((i) => i.kind === 'file')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  });
  desktop.addEventListener('drop', async (e) => {
    if (!e.dataTransfer || ![...e.dataTransfer.items].some((i) => i.kind === 'file')) return;
    // A drop that lands ON a window belongs to that window (e.g. a sketch that
    // takes a dropped video), not the desktop — swallow it here so we don't ALSO
    // spawn an image/video window + open the file browser. Drops on bare desktop
    // (target is #desktop or an icon, not inside a .wm-win) still spawn.
    if (e.target?.closest?.('.wm-win')) {
      e.preventDefault();
      return;
    }
    e.preventDefault();
    // Capture handles synchronously before event clears (getAsFileSystemHandle is async but must be initiated now)
    const items = [...e.dataTransfer.items];
    const handlePromises = items.map((i) => i.getAsFileSystemHandle?.() ?? Promise.resolve(null));
    const deskRect = desktop.getBoundingClientRect();
    const dropX = e.clientX - deskRect.left;
    const dropY = e.clientY - deskRect.top;
    const handles = await Promise.all(handlePromises);
    let offsetX = 0;
    let anyNew = false;
    for (const handle of handles) {
      if (!handle || handle.kind !== 'file') continue;
      _droppedFileHandles.push(handle);
      anyNew = true;
      const file = await handle.getFile();
      const ext = file.name.split('.').pop().toLowerCase();
      const isImg = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'].includes(
        ext,
      );
      const isVid = ['mp4', 'webm', 'mov', 'avi', 'mkv'].includes(ext);
      if (isImg || isVid) {
        const url = URL.createObjectURL(file);
        const x = Math.max(0, dropX - 160 + offsetX);
        const y = Math.max(0, dropY - 14);
        const id = api.spawn(file.name, { type: isImg ? 'image' : 'video', src: url, x, y });
        await _storeWinHandle(id, handle);
        offsetX += 24;
      }
    }
    if (anyNew) {
      if (_browseRefreshCbs.size === 0) {
        api
          .browse(
            '__nav_files__',
            (url, name) => {
              const ext = name.split('.').pop().toLowerCase();
              const isImg = [
                'jpg',
                'jpeg',
                'png',
                'gif',
                'webp',
                'svg',
                'bmp',
                'ico',
                'avif',
              ].includes(ext);
              const isVid = ['mp4', 'webm', 'mov', 'avi', 'mkv'].includes(ext);
              if (isImg) api.spawn(name, { type: 'image', src: url, w: 480, h: 360 });
              else if (isVid) api.spawn(name, { type: 'video', src: url, w: 640, h: 480 });
            },
            { x: Math.max(0, dropX + 20), y: Math.max(0, dropY - 100) },
          )
          .catch(() => {});
      } else {
        _browseRefreshCbs.forEach((fn) => fn());
      }
    }
  });

  // Pre-existing built-in windows have no audio output — no controls needed.

  // Restore a file-backed window from IndexedDB handle
  async function _restoreFileWindow(s) {
    const handle = await _loadWinHandle(s.id);
    if (!handle) return;
    let perm = await handle.queryPermission({ mode: 'read' });
    if (perm === 'prompt') {
      // Can't call requestPermission without user gesture — show placeholder
      const plId = api.spawn(s.title, {
        type: 'html',
        html: `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:8px;font-family:Arial,sans-serif;font-size:12px;color:#666;padding:16px;text-align:center;">
          <i class="fa-solid fa-file-circle-question" style="font-size:24px;color:#aaa;"></i>
          <div>${s.title}</div>
          <button id="_restore_${s.id}" style="margin-top:4px;padding:5px 12px;border:none;border-radius:4px;background:#1565c0;color:#fff;cursor:pointer;font-size:11px;">Restore file</button>
        </div>`,
        x: s.x,
        y: s.y,
        w: s.w,
        h: s.h,
        id: s.id,
      });
      const win = document.getElementById(plId);
      if (s.nochrome) win?.classList.add('wm-no-chrome');
      if (s.transparent) win?.classList.add('wm-transparent');
      document.getElementById(`_restore_${s.id}`)?.addEventListener('click', async () => {
        perm = await handle.requestPermission({ mode: 'read' });
        if (perm !== 'granted') return;
        const file = await handle.getFile();
        const url = URL.createObjectURL(file);
        const img = win?.querySelector('.wm-body img');
        const vid = win?.querySelector('.wm-body video');
        if (img) {
          img.src = url;
          return;
        }
        if (vid) {
          vid.src = url;
          return;
        }
        // Replace placeholder with real content
        const ext = file.name.split('.').pop().toLowerCase();
        const isImg = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'].includes(
          ext,
        );
        win?.remove();
        spawnedIds.delete(s.id);
        const newId = api.spawn(s.title, {
          type: isImg ? 'image' : 'video',
          src: url,
          x: s.x,
          y: s.y,
          w: s.w,
          h: s.h,
        });
        await _storeWinHandle(newId, handle);
      });
      return;
    }
    if (perm !== 'granted') return;
    const file = await handle.getFile();
    const url = URL.createObjectURL(file);
    const ext = file.name.split('.').pop().toLowerCase();
    const isImg = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'].includes(ext);
    const id = api.spawn(s.title, {
      type: isImg ? 'image' : 'video',
      src: url,
      x: s.x,
      y: s.y,
      w: s.w,
      h: s.h,
      id: s.id,
    });
    await _storeWinHandle(id, handle);
    const win = document.getElementById(id);
    if (s.nochrome) win?.classList.add('wm-no-chrome');
    if (s.transparent) win?.classList.add('wm-transparent');
  }

  // One directory-picker cascade: native (Electron) → File System Access API →
  // hidden <input webkitdirectory> fallback. Returns { handle, name } (a dir handle),
  // { fallback, name } (an input file list), or null on cancel. Callers own their own
  // caching + cancel policy — this collapses the ladder that was copy-pasted three
  // times (browse initial prompt, browse "+ Add folder", pickFolder).
  async function _pickDirectory() {
    const nativePick = nativeCap('pickDirectory');
    if (nativePick) {
      const res = await nativePick();
      return res ? { handle: makeNativeDirHandle(res.path, res.name), name: res.name } : null;
    }
    if (window.showDirectoryPicker) {
      try {
        await _exitFullscreen();
        const handle = await window.showDirectoryPicker({ mode: 'read' });
        return { handle, name: handle.name };
      } catch (err) {
        if (err?.name === 'AbortError') return null;
        // API present but blocked → fall through to the <input> fallback
      }
    }
    const fallback = await _pickDirViaInput();
    return fallback ? { fallback, name: fallback.name } : null;
  }

  // ── Public API (exposed as window.wm) ────────────────────────────────────

  const api = {
    /** Show a window by id */
    show(id) {
      const win = getWin(id);
      if (!win) return api;
      win.style.display = 'flex';
      bringToFront(win);
      notify('wm:show', { id });
      return api;
    },

    /** Hide a window by id (spawned windows removed) */
    hide(id) {
      const win = getWin(id);
      if (!win) return api;
      const _title = win.querySelector('.wm-title')?.textContent?.trim() ?? '';
      const _type = win._wmSpawnOpts?.type ?? 'unknown';
      if (spawnedIds.has(id)) {
        _releaseWin(win);
        _runDisposers(win);
        win.remove();
        spawnedIds.delete(id);
        notify('wm:close', { id, title: _title, type: _type });
      } else {
        win.style.display = 'none';
        notify('wm:hide', { id });
      }
      _saveState();
      return api;
    },

    /** Alias for hide */
    close(id) {
      api.hide(id);
      return api;
    },

    /** Permanently tear down a spawned window and remove it from the DOM (no-op if not spawned). */
    remove(id, opts = {}) {
      _destroyWin(getWin(id), opts);
      return api;
    },

    /** Undo last destructive window operation */
    undo() {
      _undoHistory();
      return api;
    },

    /** Redo last undone window operation */
    redo() {
      _redoHistory();
      return api;
    },

    /** Snapshot current state onto undo stack (call before custom destructive ops) */
    pushHistory() {
      _pushHistory();
      return api;
    },

    /** Inject per-widget ↶/↷ buttons into a widget window's titlebar and wire keyboard routing.
     *  history must be a WidgetHistory instance. win._widgetHistory is set for key dispatch. */
    addHistoryControls(winId, history) {
      const win = getWin(winId);
      if (win) _chrome.addHistoryControls(win, history);
      return api;
    },

    /** Close (delete) all windows */
    closeAll() {
      _pushHistory();
      [...spawnedIds].forEach((id) => {
        const win = getWin(id);
        if (!win) {
          spawnedIds.delete(id);
          return;
        }
        _releaseWin(win);
        _runDisposers(win);
        _disposeChannel(id);
        _deleteWinHandle(id);
        win.remove();
        spawnedIds.delete(id);
      });
      clearTimeout(_savePending);
      _savePending = null;
      try {
        localStorage.setItem(_SAVE_KEY, JSON.stringify({ wins: [] }));
      } catch (_) {}
      return api;
    },

    // Apply a WebGPU shader directly inside a window.
    // code: WGSL fragment body string or full WGSL.
    // opts: any Shader constructor opts — pass video: to feed a source, or omit to auto-detect.
    // Returns the started Shader instance.
    applyShader(id, code, opts = {}) {
      const win = getWin(id);
      if (!win) return null;
      const body = win.querySelector('.wm-body');
      if (!body) return null;

      // Auto-detect video source from window type if not provided
      let video = opts.video ?? null;
      if (!video) {
        const wo = win._wmSpawnOpts;
        if (wo?.type === 'camera') {
          video = document.getElementById('camera');
        } else if (wo?.type === 'shader') {
          video = wo.shader?.canvas ?? null;
        } else {
          // pick the first canvas or video element already in the body
          video = body.querySelector('canvas, video') ?? null;
        }
      }

      const { Shader: S } = window; // avoid import cycle — Shader is on window
      if (!S) {
        console.warn('wm.applyShader: Shader not available');
        return null;
      }
      const s = new S(code, { ...opts, video, container: body });
      s.start();
      return s;
    },

    // ── Per-window layer compositor (ADR 040) ──────────────────────────────────
    // A window owns a z-ordered stack of <canvas> planes in its body. This is the
    // single registry of every plane (draw@0, pixi@25, shader@30, overlay@50,
    // text@51). Lazy — a window grows a stack only when something mounts into it.
    //
    // wm.layer(id, z, opts):
    //   - opts.adopt: register a caller-made <canvas> at z (used for Canvas's
    //     fixed-logical z=0 plane, which must NOT get mountLayerCanvas's DPR
    //     native-resize). The caller owns appending/styling it.
    //   - else: create a managed plane via mountLayerCanvas (DPR-resized; right
    //     for resolution-independent shaders / pixi). opts: {opacity, webgpu, onResize}.
    // Returns the raw <canvas>. WM owns the element + stack position + teardown;
    // it does NOT own styling (the Layer CSS-wrapper in layer.js stays a decorator).
    layer(id, z = 0, opts = {}) {
      const win = getWin(id);
      if (!win) return null;
      const body = win.querySelector('.wm-body');
      if (!body) return null;
      const stack = (win._layerStack ??= new Map());
      if (stack.has(z)) return stack.get(z);
      let canvas;
      if (opts.adopt) {
        // Register a caller-made canvas (Canvas's fixed-logical z=0 plane).
        canvas = opts.adopt;
      } else if (opts.raster) {
        // Fixed-logical 2D sibling sized to the base plane — for extra draw
        // layers (old getLayer(z) at editor-instance.js:272). No DPR observer.
        canvas = document.createElement('canvas');
        canvas.width = opts.w ?? stack.get(0)?.width ?? 1600;
        canvas.height = opts.h ?? stack.get(0)?.height ?? 900;
        Object.assign(canvas.style, {
          position: 'absolute',
          top: '0',
          left: '0',
          width: '100%',
          height: '100%',
          zIndex: String(z),
          pointerEvents: 'none',
        });
        if (getComputedStyle(body).position === 'static') body.style.position = 'relative';
        // Make the body its own stacking context so planes order among themselves —
        // crucially, a BELOW-base backdrop plane (z<0, e.g. Canvas.backdrop's z=-1)
        // stays contained here instead of escaping to an ancestor context and sinking
        // behind the window's own background (it would render invisible otherwise).
        if (z < 0) body.style.isolation = 'isolate';
        body.appendChild(canvas);
      } else {
        // Managed GPU/pixi plane — DPR-resized (resolution-independent shaders).
        const m = mountLayerCanvas({
          z,
          opacity: opts.opacity ?? 1,
          container: body,
          webgpu: !!opts.webgpu,
          onResize: opts.onResize ?? null,
        });
        canvas = m.canvas;
        canvas._ar_resizeObserver = m.resizeObserver;
      }
      canvas._ar_z = z;
      stack.set(z, canvas);
      return canvas;
    },

    /** z-sorted array of a window's plane <canvas>es (for snapshot/record compositing). */
    layers(id) {
      const stack = getWin(id)?._layerStack;
      if (!stack) return [];
      return [...stack.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]);
    },

    /** Remove a plane at z (disconnect observer, detach canvas). Idempotent. */
    removeLayer(id, z) {
      const stack = getWin(id)?._layerStack;
      const canvas = stack?.get(z);
      if (!canvas) return api;
      try {
        canvas._ar_resizeObserver?.disconnect();
      } catch (_) {}
      try {
        canvas.remove();
      } catch (_) {}
      stack.delete(z);
      return api;
    },

    /** Toggle visibility */
    toggle(id) {
      const win = getWin(id);
      if (!win) return api;
      if (win.style.display === 'none') api.show(id);
      else api.hide(id);
      return api;
    },

    /** Bring window to front */
    focus(id) {
      const win = getWin(id);
      if (win) bringToFront(win); // bringToFront emits wm:focus (and wm:blur for previous)
      return api;
    },

    /** Move window to pixel coords */
    move(id, x, y) {
      const win = getWin(id);
      if (!win) return api;
      win.style.left = `${x}px`;
      win.style.top = `${y}px`;
      notify('wm:move', { id, x, y });
      return api;
    },

    /** Resize window in pixels */
    resize(id, w, h) {
      const win = getWin(id);
      if (!win) return api;
      const rw = Math.max(180, w),
        rh = Math.max(80, h);
      win.style.width = `${rw}px`;
      win.style.height = `${rh}px`;
      onContentResize?.();
      notify('wm:resize', { id, w: rw, h: rh });
      return api;
    },

    /** Maximize a window */
    maximize(id) {
      const win = getWin(id);
      if (!win || win.classList.contains('wm-maximized')) return api;
      _toggleMaximize(win);
      onContentResize?.();
      notify('wm:maximize', { id });
      return api;
    },

    /** Restore a maximized window */
    restore(id) {
      const win = getWin(id);
      if (!win || !win.classList.contains('wm-maximized')) return api;
      _toggleMaximize(win);
      onContentResize?.();
      notify('wm:restore', { id });
      return api;
    },

    /** Set CSS z-index on a window (stacking order) — live, no re-spawn needed */
    setZ(id, z) {
      const win = getWin(id);
      if (win) win.style.zIndex = String(z);
      return api;
    },

    /** Set CSS opacity on a window (0 = invisible, 1 = fully opaque) — live */
    setOpacity(id, v) {
      const win = getWin(id);
      if (win) win.style.opacity = String(v);
      return api;
    },

    /** Find a window id by its title text. Returns null if not found. */
    getByTitle(title) {
      const t = (title ?? '').trim().toLowerCase();
      const found = [...desktop.querySelectorAll('.wm-win')].find(
        (w) => w.querySelector('.wm-title')?.textContent?.trim().toLowerCase() === t,
      );
      return found?.id ?? null;
    },

    /**
     * Window handle for `id` — a facade over the .wm-win element. handle.id === id.
     * Use handle.onDispose(fn) to register teardown (accumulates, fires LIFO on close)
     * instead of writing win._wmCleanup. Returns null if no such window.
     */
    window(id) {
      return _windowHandle(getWin(id));
    },

    /**
     * Return the WidgetEvents instance for the paint overlay on window `id`, or null.
     * The overlay may not yet exist (it is created lazily on first activation), but
     * events are registered eagerly — so hooks registered early will fire correctly.
     * @param {string} id  — window id (use wm.getByTitle() to resolve by name)
     * @returns {WidgetEvents|null}
     */
    paintEvents(id) {
      const win = getWin(id);
      return win?._paintEvents ?? null;
    },

    /**
     * Register a stroke hook on the paint overlay for window `id`.
     * @param {string}   id  — window id
     * @param {function} fn  — called with { tool, color, winId, bbox:{x,y,w,h} }
     */
    onStroke(id, fn) {
      const ev = this.paintEvents(id);
      if (!ev) {
        console.warn('[wm.onStroke] no paint overlay on window', id);
        return;
      }
      ev.on('stroke', fn);
    },

    /**
     * Live decaying-pulse signal from the paint overlay on window `id`.
     * @param {string} id               — window id
     * @param {string} [event='stroke'] — 'stroke' | 'color' | 'tool' | 'clear' | '*'
     * @param {object} [opts]           — { decay, region:{x,y,w,h} } (overlay-canvas px)
     * @returns {{ value, velocity, stream(fn), on(fn) } | null}
     */
    paintSignal(id, event = 'stroke', opts = {}) {
      const ev = this.paintEvents(id);
      if (!ev) {
        console.warn('[wm.paintSignal] no paint overlay on window', id);
        return null;
      }
      return ev.signal(event, opts);
    },

    /**
     * Current inner bounds of a window's body, in canvas px.
     * Re-read each call so it tracks live resizes. Returns null if no window.
     * @param {string} id — window id
     * @returns {{w:number, h:number, left:number, top:number} | null}
     */
    bounds(id) {
      const win = getWin(id);
      if (!win) return null;
      const body = win.querySelector('.wm-body');
      if (!body) return null;
      return {
        w: body.clientWidth || 0,
        h: body.clientHeight || 0,
        left: body.clientLeft || 0,
        top: body.clientTop || 0,
      };
    },

    /**
     * Place a persistent text object on top of any visual window.
     * Returns a handle: { id, setText, setStyle, moveTo, remove, on }
     * handle.on supports: 'move' | 'edit' | 'select' | 'deselect'
     * Run-scoped — removed on editor reset. Interactive objects (placed via 🖌️ T tool) survive resets.
     * @param {string} id       — window id
     * @param {string} text     — initial text content
     * @param {number} x        — x position in canvas px
     * @param {number} y        — y position in canvas px
     * @param {object} [opts]   — { fontSize, fontFamily, color, bold, italic, align, rotation, kerning, curve }
     *   curve: null | { type:'arc', radius:number }  (radius>0=arc up, <0=arc down)
     */
    addText(id, text, x, y, opts = {}) {
      const win = getWin(id);
      if (!win) {
        console.warn('[wm.addText] window not found:', id);
        return null;
      }
      if (!win._ensureTextLayer) {
        const body = win.querySelector('.wm-body');
        if (!body) {
          console.warn('[wm.addText] window not found:', id);
          return null;
        }
        body.style.position = 'relative';
        const tl = new TextLayer({
          container: body,
          width: body.clientWidth || 400,
          height: body.clientHeight || 300,
        });
        _textLayers.add(tl);
        win._ensureTextLayer = () => tl;
        win._getTextCanvas = () => tl.canvas;
        // Track live window resize so the mirror canvas (snapshot/record) stays full-size.
        const ro = new ResizeObserver(() =>
          tl.updateRect(0, 0, body.clientWidth || 400, body.clientHeight || 300),
        );
        ro.observe(body);
        _onDispose(win, () => ro.disconnect());
      }
      const handle = win._ensureTextLayer().addText(text, x, y, opts, { runScoped: true });
      if (!handle) return null;

      const { decay, animate } = opts;

      if (animate) {
        const { duration = 1000, easing, onDone, ...props } = animate;
        const styleKeys = ['fontSize', 'rotation', 'kerning', 'opacity'];
        const entries = Object.entries(props).filter(([k]) => styleKeys.includes(k));
        const cancel = tween(
          duration,
          (t) => {
            const patch = {};
            entries.forEach(([k, [from, to]]) => {
              patch[k] = from + (to - from) * t;
            });
            if (Object.keys(patch).length) handle.setStyle(patch);
          },
          { easing, onDone },
        );
        handle.cancelAnimate = () => {
          cancel();
          return handle;
        };
      }

      if (decay) {
        tween(decay, (t) => handle.setStyle({ opacity: 1 - t }), { onDone: () => handle.remove() });
      }

      return handle;
    },

    /** Set a CSS filter on a window body (e.g. 'brightness(2)' to flash it). Pass null/'' to clear. */
    filter(id, cssFilter) {
      const win = getWin(id);
      if (win) win.querySelector('.wm-body').style.filter = cssFilter ?? '';
      return api;
    },

    /**
     * Spawn a new floating window.
     * @param {string} title  - Titlebar label
     * @param {object} [opts] - { type, x, y, w, h, id, ...type-specific }
     *   type: 'html'   → opts.html (string)
     *   type: 'image'  → opts.src (URL or blob URL)
     *   type: 'video'  → opts.src (URL or blob URL), opts.loop
     *   type: 'camera' → mirrors #camera canvas
     *   type: 'canvas' → opts.z (default 0) mirrors layer canvas at z
     *   type: 'shader' → opts.shader (Shader instance)
     *   type: 'viz'    → audio visualizer; source/style picker built-in
     * @returns {string}  window id
     */
    spawn(title, opts = {}) {
      const dw = desktop.offsetWidth,
        dh = desktop.offsetHeight;
      let id = opts.id || `win-spawn-${++spawnCounter}`;
      // Generated ids must not collide with windows restored from a project/localStorage
      // (spawnCounter resets to 0 on reload, but restored win-spawn-N persist in the DOM).
      // Duplicate ids break getElementById lookups (wm.addText/bounds/etc). Bump past any clash.
      if (!opts.id) {
        while (document.getElementById(id)) id = `win-spawn-${++spawnCounter}`;
      }
      const w = opts.w ?? 320;
      const h = opts.h ?? 240;
      const x = opts.x ?? Math.round((dw - w) / 2);
      const y = opts.y ?? Math.round((dh - h) / 2);
      const type = opts.type ?? 'html';

      const win = document.createElement('div');
      win.className = 'wm-win';
      win.id = id;
      // Owner editor (set when spawned during a run) — lets a sketch window's audio
      // control scope mute/volume to that editor's submaster bus, not the master.
      const _ownerEd = activeEditorId();
      if (_ownerEd != null) win.dataset.ownerEditor = String(_ownerEd);
      win.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${h}px;display:flex;`;
      win.innerHTML = `
        <div class="wm-titlebar">
          <span class="wm-title">${title}</span>
          <span class="wm-btn wm-ghost" title="Toggle transparent"><i class="fa-solid fa-circle-half-stroke"></i></span>
          <span class="wm-btn wm-dup" title="Duplicate"><i class="fa-regular fa-copy"></i></span>
          <span class="wm-btn wm-min" title="Minimize">─</span>
          <span class="wm-btn wm-max" title="Maximize"><i class="fa-regular fa-window-maximize"></i></span>
          <span class="wm-btn wm-close" title="Close">×</span>
        </div>
        <div class="wm-body" style="overflow:auto;position:relative;"></div>
        <div class="wm-hover-strip"></div>
        <div class="wm-resize-handle" data-resize="n"></div>
        <div class="wm-resize-handle" data-resize="s"></div>
        <div class="wm-resize-handle" data-resize="e"></div>
        <div class="wm-resize-handle" data-resize="w"></div>
        <div class="wm-resize-handle" data-resize="ne"></div>
        <div class="wm-resize-handle" data-resize="nw"></div>
        <div class="wm-resize-handle" data-resize="se"></div>
        <div class="wm-resize-handle" data-resize="sw"></div>
      `;
      const body = win.querySelector('.wm-body');

      let _cleanup = null;

      if (type === 'html') {
        body.innerHTML = opts.html ?? '';
      } else if (type === 'image') {
        const img = document.createElement('img');
        img.src = opts.src ?? '';
        img.style.cssText = 'width:100%;height:100%;object-fit:contain;display:block;';
        body.style.overflow = 'hidden';
        body.appendChild(img);
      } else if (type === 'video') {
        const vid = document.createElement('video');
        vid.src = opts.src ?? '';
        vid.style.cssText = 'width:100%;display:block;';
        vid.autoplay = true;
        vid.muted = true;
        vid.loop = opts.loop !== false;
        vid.disablePictureInPicture = true;
        vid.setAttribute('controlsList', 'nodownload nofullscreen noremoteplayback');
        body.style.overflow = 'hidden';
        body.style.background = '#000';
        body.appendChild(vid);
        vid.addEventListener(
          'loadedmetadata',
          () => {
            const tb = win.querySelector('.wm-titlebar');
            const chrome = tb ? tb.getBoundingClientRect().height + 1 : 29;
            const desk = win.parentElement ?? document.getElementById('desktop');
            const capW = opts.w ?? 320;
            const capH = opts.h ?? 240;
            const maxW = Math.min(capW, desk ? desk.offsetWidth * 0.9 : vid.videoWidth);
            const maxH = Math.min(capH, desk ? desk.offsetHeight * 0.9 - chrome : vid.videoHeight);
            const scale = Math.min(1, maxW / vid.videoWidth, maxH / vid.videoHeight);
            win.style.width = `${Math.round(vid.videoWidth * scale)}px`;
            win.style.height = `${Math.round(vid.videoHeight * scale + chrome)}px`;
          },
          { once: true },
        );
        _cleanup = () => {
          vid.pause();
          vid.src = '';
        };
      } else if (type === 'viz') {
        buildVizWindow(win, body, opts, _vizCtx);
      } else if (type === 'sensor') {
        buildSensorWindow(win, body, opts, { onDispose: (fn) => _onDispose(win, fn) });
      } else if (type === 'camera' || type === 'canvas' || type === 'shader') {
        let src;
        let _camLease = null;
        if (type === 'camera') {
          // Acquire toolbar camera — window-scoped lease (ADR 023).
          _camLease = acquireCamera();
          src = document.getElementById('camera');
        } else if (type === 'canvas') {
          src =
            opts.canvas instanceof HTMLCanvasElement
              ? opts.canvas
              : window.__ar_layers?.get(opts.z ?? 0);
        } else {
          src = opts.shader?.canvas;
        }
        const getLayers = opts.getLayers; // () => sorted HTMLCanvasElement[]
        if (getLayers || src) {
          const dst = document.createElement('canvas');
          dst.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;';
          body.style.overflow = 'hidden';
          body.style.background = '#000';
          body.appendChild(dst);
          const ctx = dst.getContext('2d');
          let rafId;
          const copy = () => {
            if (getLayers) {
              const layers = getLayers().filter((c) => !c._ar_webgpu);
              // Ping shader readable canvases so they blit within their own RAF
              layers.forEach((c) => {
                if (c._ar_shaderReadable) c._ar_watched = true;
              });
              if (layers.length && layers[0].width) {
                dst.width = layers[0].width;
                dst.height = layers[0].height;
                ctx.clearRect(0, 0, dst.width, dst.height);
                for (const c of layers) {
                  if (c.width && c.height) ctx.drawImage(c, 0, 0, dst.width, dst.height);
                }
              }
            } else if (src.width && src.height) {
              dst.width = src.width;
              dst.height = src.height;
              ctx.drawImage(src, 0, 0);
            }
            rafId = requestAnimationFrame(copy);
          };
          rafId = requestAnimationFrame(copy);
          _cleanup = () => {
            cancelAnimationFrame(rafId);
            _camLease?.release();
          };
        }
      }

      if (_cleanup) _onDispose(win, _cleanup);
      win._wmSpawnOpts = { title, ...opts };

      if (['image', 'video', 'camera', 'canvas', 'shader', 'viz', 'sensor'].includes(type)) {
        win.classList.add('wm-draggable-body');
      }

      const _defaultAudio = type === 'video' ? true : (window.__ar_usesAudio ?? true);
      const _showAudio = opts.audio !== undefined ? opts.audio !== false : _defaultAudio;
      if ((type === 'video' || type === 'html') && _showAudio) {
        const videoEl = type === 'video' ? body.querySelector('video') : null;
        _chrome.addAudioControls(win, videoEl);
        if (videoEl) {
          _chrome.addVideoControls(win, videoEl);
          addVizPanel(win, body, id, {}, _vizCtx);
        }
      }
      // Camera windows get the audio viz panel too (source locked while embedded)
      if (type === 'camera') addVizPanel(win, body, id, { locked: true }, _vizCtx);

      if (['image', 'video'].includes(type) && opts.src) _chrome.addCopyPathBtn(win, opts.src);
      if (
        ['image', 'video', 'camera', 'canvas', 'shader', 'viz', 'html', 'sensor'].includes(type)
      ) {
        // Flip only the visual element so UI chrome (dropdowns, controls) stays upright
        const _flipVisual =
          type === 'image'
            ? body.querySelector('img') || body
            : type === 'video'
              ? body.querySelector('video') || body
              : ['camera', 'canvas', 'shader', 'viz', 'sensor'].includes(type)
                ? body.querySelector('canvas') || body
                : body; // html — body is the output visual, flip it whole
        _chrome.addFlipBtns(win, _flipVisual);
        // Paint overlay + capture buttons — available on visual windows only (not viz/sensor/html)
        if (['image', 'video', 'camera', 'canvas', 'shader'].includes(type)) {
          _chrome.addPaintOverlay(win, body, _flipVisual);
          _chrome.addCaptureButtons(win, body, _flipVisual);
        }
      }
      if (opts.noChrome) win.classList.add('wm-no-chrome');
      if (opts.transparent) win.classList.add('wm-transparent');

      if (opts.onClose) win._wmUserOnClose = opts.onClose;

      desktop.appendChild(win);
      win.classList.add('wm-spawning');
      win.addEventListener('animationend', () => win.classList.remove('wm-spawning'), {
        once: true,
      });
      spawnedIds.add(id);
      bringToFront(win);
      if (opts.z != null) win.style.zIndex = String(opts.z);

      // Register as a live output for the active editor run (if any).
      // liveOutput() captures window.__ar_keepAlive at this moment (ADR 009) so
      // release() works correctly even if the active editor changes before close.
      // The editor's _isLive() checks _keepAlive; releasing here lets the idle
      // watcher detect that all outputs are gone and auto-stop.
      const _activeEdId = activeEditorId();
      const _activeInst = _activeEdId != null ? window.__ar_instances?.get(_activeEdId) : null;
      if (_activeInst?.btnState === 'running' && id !== _activeInst.canvasWinId) {
        win._live = liveOutput(win);
        _activeInst._hadOutput = true;
      }

      _saveState();
      notify('wm:spawn', {
        id,
        title,
        type,
        x: parseInt(win.style.left),
        y: parseInt(win.style.top),
        w,
        h,
      });
      return id;
    },

    /** List all window ids currently in the desktop */
    list() {
      return [...desktop.querySelectorAll('.wm-win')].map((w) => w.id);
    },

    /**
     * Pick a file via the browser file picker. Returns a blob URL.
     * Pass a key to cache the handle — subsequent calls reuse it without re-prompting.
     * @param {string} [key]   - cache key for the handle
     * @param {object} [opts]  - showOpenFilePicker options (types, multiple, etc.)
     * @returns {Promise<string>}  blob URL
     */
    async pickFile(key, opts = {}) {
      if (key && fileHandles.has(key)) {
        const handle = fileHandles.get(key);
        try {
          const perm = await handle.queryPermission({ mode: 'read' });
          if (perm === 'granted') {
            return URL.createObjectURL(await handle.getFile());
          }
        } catch (_) {
          /* handle stale — fall through to picker */
        }
      }
      await _exitFullscreen();
      const nativePickFile = nativeCap('pickFile');
      if (nativePickFile) {
        const res = await nativePickFile(opts);
        if (!res) throw Object.assign(new Error('Cancelled'), { name: 'AbortError' });
        const handle = makeNativeFileHandle(res.path, res.name);
        if (key) fileHandles.set(key, handle);
        return URL.createObjectURL(await handle.getFile());
      }
      if (window.showOpenFilePicker) {
        try {
          const [handle] = await window.showOpenFilePicker({ multiple: false, ...opts });
          if (key) fileHandles.set(key, handle);
          return URL.createObjectURL(await handle.getFile());
        } catch (err) {
          if (err?.name === 'AbortError') throw err;
          // API blocked — fall through to input fallback
        }
      }
      const url = await _pickFileViaInput(opts);
      if (!url) throw Object.assign(new Error('Cancelled'), { name: 'AbortError' });
      return url;
    },

    /**
     * Open a local file browser window. Re-uses previously granted folder handles
     * without prompting; only shows a picker when no access has been granted yet
     * or when the user explicitly clicks "Add folder".
     * @param {string} [key]        - cache key for persisting handles across opens
     * @param {function} [onSelect] - called with (blobUrl, filename, fileHandle)
     * @param {object} [spawnOpts]  - { w, h, x, y, id } forwarded to spawn()
     * @returns {Promise<string>}  window id
     */
    async browse(key, onSelect, spawnOpts = {}) {
      const multiKey = key ? key + '_multi' : null;
      const fallbackKey = key ? key + '_fallback' : null;

      let handles = multiKey
        ? fileHandles.get(multiKey)
          ? [...fileHandles.get(multiKey)]
          : []
        : [];
      let fallback = fallbackKey ? (fileHandles.get(fallbackKey) ?? null) : null;

      // Only prompt when we have nothing cached yet (skip if dropped files already available)
      if (!handles.length && !fallback && !_droppedFileHandles.length) {
        const picked = await _pickDirectory();
        if (!picked) throw Object.assign(new Error('Cancelled'), { name: 'AbortError' });
        if (picked.handle) {
          handles.push(picked.handle);
          if (multiKey) fileHandles.set(multiKey, handles);
        } else if (picked.fallback) {
          fallback = picked.fallback;
          if (fallbackKey) fileHandles.set(fallbackKey, fallback);
        }
      }

      const winId = api.spawn('Local Files', {
        type: 'html',
        html: '',
        audio: false,
        w: spawnOpts.w ?? 260,
        h: spawnOpts.h ?? Math.min(120 + handles.length * 160, 520),
        x: spawnOpts.x,
        y: spawnOpts.y,
        id: spawnOpts.id,
      });
      const win = document.getElementById(winId);
      const body = win.querySelector('.wm-body');
      body.innerHTML = '';
      body.style.overflow = 'hidden';
      body.style.flexDirection = 'column';
      body.style.padding = '0';

      const list = document.createElement('div');
      list.style.cssText = 'flex:1;overflow:auto;padding:2px 0;';

      const footer = document.createElement('div');
      footer.style.cssText =
        'flex-shrink:0;padding:5px 6px;border-top:1px solid #e0e0e0;background:#fafafa;';
      const addBtn = document.createElement('button');
      addBtn.textContent = '+ Add folder';
      addBtn.style.cssText =
        'width:100%;font-size:11px;padding:3px 8px;cursor:pointer;background:#f0f0f0;border:1px solid #ccc;border-radius:3px;';
      footer.appendChild(addBtn);
      body.appendChild(list);
      body.appendChild(footer);

      async function renderFolderSection(dh, container) {
        const header = document.createElement('div');
        header.style.cssText =
          'padding:5px 8px 2px;font-size:9px;font-weight:bold;letter-spacing:0.6px;text-transform:uppercase;color:#888;border-top:1px solid #e8e8e8;margin-top:2px;';
        header.textContent = dh.name;
        container.appendChild(header);
        await renderDirContents(container, dh, 0, onSelect);
      }

      async function renderAll() {
        list.innerHTML = '';
        if (fallback) {
          renderFlatFiles(list, fallback.files, onSelect);
        } else {
          for (const h of handles) await renderFolderSection(h, list);
        }
        if (_droppedFileHandles.length) {
          const hdr = document.createElement('div');
          hdr.style.cssText =
            'padding:5px 8px 2px;font-size:9px;font-weight:bold;letter-spacing:0.6px;text-transform:uppercase;color:#888;border-top:1px solid #e8e8e8;margin-top:2px;';
          hdr.textContent = 'Dropped';
          list.appendChild(hdr);
          for (const fh of _droppedFileHandles) {
            list.appendChild(makeFileEntry(fh, 0, onSelect));
          }
        }
      }

      _browseRefreshCbs.add(renderAll);
      _onDispose(win, () => {
        _browseRefreshCbs.delete(renderAll);
      });

      addBtn.addEventListener('click', async () => {
        const picked = await _pickDirectory();
        if (!picked) return;
        if (picked.handle) {
          handles.push(picked.handle);
          if (multiKey) fileHandles.set(multiKey, handles);
        } else if (picked.fallback) {
          fallback = fallback
            ? { name: fallback.name, files: [...fallback.files, ...picked.fallback.files] }
            : picked.fallback;
          if (fallbackKey) fileHandles.set(fallbackKey, fallback);
        }
        try {
          const desk = win.parentElement;
          const maxH = desk ? desk.offsetHeight * 0.9 : 800;
          win.style.height = Math.min(parseInt(win.style.height) + 160, maxH) + 'px';
          await renderAll();
        } catch (err) {
          if (err?.name !== 'AbortError') console.warn('folder access denied', err);
        }
      });

      await renderAll();
      return winId;
    },

    /**
     * Get (or create) the Tone.Channel for a window.
     * Route audio to it: synth.connect(wm.channel('win-editor'))
     * The window's mute/volume controls will then affect that audio.
     */
    channel(id) {
      return _getChannel(id);
    },

    /** Register a FileSystemDirectoryHandle under a key so browse(key) re-uses it */
    registerFolder(key, handle) {
      fileHandles.set(key + '_multi', [handle]);
    },
    registerFolderFallback(key, fallback) {
      fileHandles.set(key + '_fallback', fallback);
    },

    async pickFolder() {
      return _pickDirectory();
    },

    /** Idempotently add mute/volume controls to a window (e.g. output windows that use audio) */
    ensureAudioControls(id) {
      const win = document.getElementById(id);
      if (!win || win.querySelector('.wm-audio-ctrl')) return;
      _chrome.addAudioControls(win, null);
    },

    /** Idempotently show the master-audio chip in the taskbar (ADR 040). */
    ensureAudioChip() {
      ensureAudioChip();
      return api;
    },

    /** Snapshot a visual window → persistent PNG on the desktop */
    snapshot(winId, opts = {}) {
      document.getElementById(winId)?._wmSnapshot?.(opts);
    },

    /** Start recording a visual window → desktop WebM. Returns the Recording or null. */
    record(winId, opts = {}) {
      return document.getElementById(winId)?._wmRecord?.(opts) ?? null;
    },

    /** Stop an in-progress recording on a window. */
    stopRecording(winId) {
      document.getElementById(winId)?._wmStopRecording?.();
    },

    /** Return the IndexedDB key for a file-backed window (key = winId) */
    fileKey(id) {
      return fileHandles.has(id) ? id : null;
    },

    /** Restore a file-backed window from IndexedDB (for project load) */
    restoreFileWindow(s) {
      _restoreFileWindow(s);
    },

    /** Force an immediate WM state save (call after removing windows from DOM) */
    saveState() {
      clearTimeout(_savePending);
      _flushState();
    },

    /** Restore window state saved in localStorage */
    restoreState() {
      let state;
      try {
        state = JSON.parse(localStorage.getItem(_SAVE_KEY));
      } catch (_) {
        return;
      }
      if (!state?.wins) return;

      for (const s of state.wins) {
        if (!s.spawned) continue;
        if (s.hasHandle) {
          _restoreFileWindow(s);
          continue;
        }
        // Window already exists (e.g. editor created from manifest) — restore geometry only
        const existing = s.id ? document.getElementById(s.id) : null;
        if (existing) {
          existing.style.display = s.visible ? 'flex' : 'none';
          existing.style.left = `${s.x}px`;
          existing.style.top = `${s.y}px`;
          existing.style.width = `${s.w}px`;
          existing.style.height = `${s.h}px`;
          if (s.maximized) _toggleMaximize(existing);
          if (s.nochrome) existing.classList.add('wm-no-chrome');
          if (s.transparent) existing.classList.add('wm-transparent');
          continue;
        }
        // Recreate widget / toolkit / html / media windows via the shared respawn
        // dispatch (also used by undo apply — one place owns type-aware rebuild).
        _respawnEntry(s);
      }

      onContentResize?.();
    },
  };

  // Window Physics (#42) — installed as a bolt-on (no closure coupling).
  installWindowPhysics(api);

  _updateHistoryBtns(); // init state — both disabled on load

  // ── Event bus command handlers ─────────────────────────────────────────────
  // Each handler performs the action by calling the public API method (which fires
  // the notify() inside it) and returns the result payload. The bus does NOT fire
  // again because notify() bypasses the command handler path.
  // Methods call notify() internally, so command handlers are thin wrappers.
  registerCommand('wm:spawn', (opts) => {
    api.spawn(opts.title ?? 'Window', opts);
  });
  registerCommand('wm:close', ({ id }) => {
    api.close(id);
  });
  registerCommand('wm:hide', ({ id }) => {
    api.hide(id);
  });
  registerCommand('wm:show', ({ id }) => {
    api.show(id);
  });
  registerCommand('wm:focus', ({ id }) => {
    api.focus(id);
  });
  registerCommand('wm:move', ({ id, x, y }) => {
    api.move(id, x, y);
  });
  registerCommand('wm:resize', ({ id, w, h }) => {
    api.resize(id, w, h);
  });
  registerCommand('wm:maximize', ({ id }) => {
    api.maximize(id);
  });
  registerCommand('wm:restore', ({ id }) => {
    api.restore(id);
  });

  // ── Window Type Adapters owned by the WM (media / html / canvas-output) ──────
  // viz lives in viz.js, toolkit in app.js, editor inline in project.js.
  const _mediaAdapter = {
    serialize(win, ctx) {
      const opts = win._wmSpawnOpts;
      const isBlobSrc = opts.src?.startsWith('blob:');
      const entry = {
        type: ctx.type,
        title: ctx.titleOf(win, opts.title),
        ...ctx.geoOf(win),
        loop: opts.loop,
      };
      if (isBlobSrc) {
        const key = api.fileKey(win.id);
        if (key) entry.fileKey = key;
      } else if (opts.src) {
        entry.src = opts.src;
      }
      if (ctx.type === 'video') entry.audio = ctx.readAudio(win);
      return entry;
    },
    restore(w, ctx) {
      if (w.fileKey) {
        ctx.wm.restoreFileWindow({
          id: w.fileKey,
          title: w.title,
          type: w.type,
          x: w.x,
          y: w.y,
          w: w.w,
          h: w.h,
          nochrome: w.nochrome,
          transparent: w.transparent,
        });
      } else if (w.src) {
        const id = ctx.wm.spawn(w.title, {
          type: w.type,
          src: w.src,
          loop: w.loop,
          x: w.x,
          y: w.y,
          w: w.w,
          h: w.h,
        });
        const win = document.getElementById(id);
        if (win && !w.visible) win.style.display = 'none';
      }
    },
  };
  registerWindowType('image', _mediaAdapter);
  registerWindowType('video', _mediaAdapter);

  // viz window: buildVizWindow (viz-window.js) sets win._vizSourceEl/_vizStyleEl on the
  // element, which this adapter reads. Registered under both the window type ('viz',
  // used by serialize via _winType) and the legacy record type ('visualizer', used by
  // restore via record.type).
  const _vizAdapter = {
    serialize(win, ctx) {
      const opts = win._wmSpawnOpts;
      return {
        type: 'visualizer',
        title: ctx.titleOf(win, 'Visualizer'),
        ...ctx.geoOf(win),
        source: win._vizSourceEl?.value ?? opts.source ?? 'master',
        style: win._vizStyleEl?.value ?? opts.style ?? 'wave',
      };
    },
    restore(w, ctx) {
      const id = ctx.wm.spawn(w.title ?? 'Visualizer', {
        type: 'viz',
        source: w.source,
        style: w.style,
        x: w.x,
        y: w.y,
        w: w.w,
        h: w.h,
      });
      const win = document.getElementById(id);
      if (win && !w.visible) win.style.display = 'none';
    },
  };
  registerWindowType('viz', _vizAdapter);
  registerWindowType('visualizer', _vizAdapter);

  registerWindowType('html', {
    serialize(win, ctx) {
      const opts = win._wmSpawnOpts;
      if (opts?.html === undefined) return null;
      return {
        type: 'html',
        title: ctx.titleOf(win, opts.title ?? ''),
        ...ctx.geoOf(win),
        html: opts.html ?? '',
      };
    },
    restore(w, ctx) {
      const id = ctx.wm.spawn(w.title ?? '', {
        type: 'html',
        html: w.html ?? '',
        x: w.x,
        y: w.y,
        w: w.w,
        h: w.h,
      });
      const win = document.getElementById(id);
      if (win && !w.visible) win.style.display = 'none';
    },
  });

  // Canvas output windows serialize their geo only; ADR 040 ignores them on restore.
  registerWindowType('canvas', {
    serialize(win, ctx) {
      const editorId = parseInt(win.id.replace('win-canvas-', ''));
      if (isNaN(editorId)) return null;
      return { type: 'output', editorId, ...ctx.geoOf(win) };
    },
    // No restore: a project's `new Canvas()` code respawns its own window (ADR 040).
  });

  return api;
}

// Register teardown with the reset registry (ADR 008).
onReset(cleanupPaintOverlays);
