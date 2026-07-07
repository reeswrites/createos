// window-chrome.js — the titlebar decorators a WM window can grow: flip, capture
// (photo/record), in-window paint overlay, widget undo/redo, audio mute/volume,
// video play/sync, and copy-URL.
//
// These were ~312 lines sealed inside the initWM closure (ADR 042 pulled the capture
// *logic* into window-capture.js but left the button builders behind). They are pure
// DOM decorators over a window element: each `addX(win, …)` inserts controls into the
// window's `.wm-titlebar` and wires their behaviour. Extracted here as a factory so
// they are reachable — and testable — without instantiating the whole window manager.
//
// createWindowChrome(deps) captures the few things the decorators need from the WM
// (the desktop element, the onDispose accumulator, the window-strip helpers, the
// paint-overlay registries) and returns the decorators bound to them.

import { snapshotWindow, recordWindow } from '../media/window-capture.js';
import { addPaintOverlay } from '../widgets/paint-overlay.js';
import { subscribe } from '../../events/index.js';

export function createWindowChrome({
  desktop,
  onDispose,
  getWindowStrip,
  routeMediaToStrip,
  overlayEvents,
  textLayers,
}) {
  // Snapshot/record compositing lives in window-capture.js (ADR 042); these thin
  // wrappers keep the call sites below short.
  const snapshotVisual = (win, body, visualEl, opts) => snapshotWindow(win, body, visualEl, opts);
  const recordVisual = (win, body, visualEl, opts) => recordWindow(win, body, visualEl, opts);

  // Inject ↔ / ↕ flip buttons into a window's titlebar.
  // target: the element to apply transform to (wm-body).
  function addFlipBtns(win, target) {
    const tb = win.querySelector('.wm-titlebar');
    if (!tb) return;
    let flipH = false,
      flipV = false;
    const apply = () => {
      const sx = flipH ? -1 : 1,
        sy = flipV ? -1 : 1;
      target.style.transform = sx === 1 && sy === 1 ? '' : `scale(${sx},${sy})`;
    };
    const mk = (icon, title, onClick) => {
      const b = document.createElement('span');
      b.className = 'wm-btn';
      b.title = title;
      b.innerHTML = `<i class="fa-solid ${icon}"></i>`;
      b.addEventListener('click', onClick);
      return b;
    };
    const bH = mk('fa-left-right', 'Flip horizontal', () => {
      flipH = !flipH;
      bH.classList.toggle('active', flipH);
      apply();
    });
    const bV = mk('fa-up-down', 'Flip vertical', () => {
      flipV = !flipV;
      bV.classList.toggle('active', flipV);
      apply();
    });
    const firstBtn = tb.querySelector('.wm-btn');
    tb.insertBefore(bV, firstBtn);
    tb.insertBefore(bH, bV);
  }

  // Add 📷 / 🔴 capture buttons to a visual window's titlebar.
  function addCaptureButtons(win, body, visualEl) {
    const tb = win.querySelector('.wm-titlebar');
    if (!tb) return;
    const mkBtn = (html, title, fn) => {
      const b = document.createElement('span');
      b.className = 'wm-btn';
      b.title = title;
      b.innerHTML = html;
      b.addEventListener('click', fn);
      return b;
    };
    let activeRec = null;
    const isStatic = visualEl?.tagName === 'IMG';
    let recBtn;
    if (!isStatic) {
      recBtn = mkBtn(
        '<i class="fa-solid fa-circle" style="color:#f38ba8"></i>',
        'Record → desktop WebM',
        () => {
          if (activeRec) {
            activeRec.stop();
            activeRec = null;
            recBtn.innerHTML = '<i class="fa-solid fa-circle" style="color:#f38ba8"></i>';
            recBtn.title = 'Record → desktop WebM';
          } else {
            activeRec = recordVisual(win, body, visualEl);
            if (activeRec) {
              recBtn.innerHTML = '<i class="fa-solid fa-stop"></i>';
              recBtn.title = 'Stop recording';
            }
          }
        },
      );
    }
    const photoBtn = mkBtn('<i class="fa-solid fa-camera"></i>', 'Snapshot → desktop PNG', () =>
      snapshotVisual(win, body, visualEl),
    );
    const firstBtn = tb.querySelector('.wm-btn');
    if (recBtn) tb.insertBefore(recBtn, firstBtn);
    tb.insertBefore(photoBtn, recBtn ?? firstBtn);
    // Stop any in-flight recording when window closes
    onDispose(win, () => {
      if (activeRec) {
        activeRec.stop();
        activeRec = null;
      }
    });
    // Public wm.snapshot/record/stopRecording hooks
    win._wmSnapshot = (opts) => snapshotVisual(win, body, visualEl, opts);
    win._wmRecord = (opts) => {
      if (!activeRec) {
        activeRec = recordVisual(win, body, visualEl, opts);
        if (activeRec && recBtn) {
          recBtn.innerHTML = '<i class="fa-solid fa-stop"></i>';
          recBtn.title = 'Stop recording';
        }
      }
      return activeRec;
    };
    win._wmStopRecording = () => {
      if (activeRec) {
        activeRec.stop();
        activeRec = null;
        if (recBtn) {
          recBtn.innerHTML = '<i class="fa-solid fa-circle" style="color:#f38ba8"></i>';
          recBtn.title = 'Record → desktop WebM';
        }
      }
    };
  }

  // In-window paint overlay (ADR 045). wm owns the overlay registries + snapshot
  // compositing and injects them; this binds the builder to this window.
  function addPaintOverlayChrome(win, body, visualEl) {
    return addPaintOverlay(win, body, visualEl, {
      overlayEvents,
      textLayers,
      snapshot: snapshotVisual,
      onDispose: (fn) => onDispose(win, fn),
    });
  }

  // Inject per-widget undo/redo buttons into a window's titlebar.
  // history is a WidgetHistory instance; onChange keeps button state current.
  function addHistoryControls(win, history) {
    const tb = win.querySelector('.wm-titlebar');
    if (!tb) return;
    const mk = (icon, title, fn) => {
      const b = document.createElement('span');
      b.className = 'wm-btn wm-history-btn';
      b.title = title;
      b.innerHTML = `<i class="fa-solid ${icon}"></i>`;
      b.style.opacity = '0.4';
      b.addEventListener('click', fn);
      return b;
    };
    const undoBtn = mk('fa-rotate-left', 'Undo (Cmd/Ctrl+Z)', () => history.undo());
    const redoBtn = mk('fa-rotate-right', 'Redo (Cmd/Ctrl+Shift+Z)', () => history.redo());
    const update = () => {
      undoBtn.style.opacity = history.canUndo() ? '1' : '0.4';
      redoBtn.style.opacity = history.canRedo() ? '1' : '0.4';
      undoBtn.toggleAttribute('disabled', !history.canUndo());
      redoBtn.toggleAttribute('disabled', !history.canRedo());
    };
    // Hook onChange so buttons reflect state after every commit/undo/redo
    const prevOnChange = history._onChange;
    history._onChange = () => {
      prevOnChange();
      update();
    };
    update();
    const firstBtn = tb.querySelector('.wm-btn');
    tb.insertBefore(redoBtn, firstBtn);
    tb.insertBefore(undoBtn, redoBtn);
    win._widgetHistory = history;
  }

  // Inject mute + volume controls into a window's titlebar.
  // videoEl: optional <video> element to co-control (for spawned video windows).
  function addAudioControls(win, videoEl) {
    const tb = win.querySelector('.wm-titlebar');
    if (!tb) return;

    const ctrl = document.createElement('span');
    ctrl.className = 'wm-audio-ctrl';

    const muteBtn = document.createElement('button');
    muteBtn.className = 'wm-mute';
    muteBtn.title = 'Mute';
    muteBtn.innerHTML = '<i class="fa-solid fa-volume-high"></i>';

    const volSlider = document.createElement('input');
    volSlider.type = 'range';
    volSlider.className = 'wm-vol';
    volSlider.min = '0';
    volSlider.max = '100';
    volSlider.value = '100';
    volSlider.title = 'Volume';

    ctrl.appendChild(muteBtn);
    ctrl.appendChild(volSlider);

    const firstBtn = tb.querySelector('.wm-btn');
    tb.insertBefore(ctrl, firstBtn);

    // Sketch window: its owning editor (tagged at spawn). Its mute/volume persist
    // per-editor in the mixer, so restore that state into the button + slider on
    // spawn — the control shows "muted" after a refresh instead of silently resetting.
    const _owner =
      !videoEl && win.dataset.ownerEditor ? parseInt(win.dataset.ownerEditor, 10) : null;
    const _ownerId = _owner != null && !Number.isNaN(_owner) ? _owner : null;
    const _saved = _ownerId != null ? window.mixer?.editorAudioState?.(_ownerId) : null;
    if (_saved && typeof _saved.db === 'number') {
      const lin = _saved.db <= -60 ? 0 : _saved.db / 40 + 1;
      volSlider.value = String(Math.round(Math.max(0, Math.min(1, lin)) * 100));
    }

    let _muted = videoEl ? videoEl.muted : (_saved?.muted ?? false);
    if (_muted) {
      muteBtn.innerHTML = '<i class="fa-solid fa-volume-xmark"></i>';
      muteBtn.classList.add('muted');
      volSlider.style.opacity = '0.4';
    }

    // Rebridge media into the window's mixer strip (idempotent).
    if (videoEl) routeMediaToStrip(win.id, videoEl);

    function _apply() {
      const linear = parseFloat(volSlider.value) / 100;
      const db = linear <= 0 ? -60 : (linear - 1) * 40;
      if (videoEl) {
        // Media window: drive this window's mixer strip (the media is bridged into
        // it). Keep element volume too as a fallback for cross-origin media the
        // graph can't capture.
        videoEl.muted = _muted;
        videoEl.volume = _muted ? 0 : linear;
        const strip = getWindowStrip(win.id);
        window.mixer?.strip(strip.name).volume(db).mute(_muted);
      } else {
        // Sketch window (canvas/html): scope mute/volume to THIS sketch's own audio
        // via its editor submaster bus, so muting the window doesn't nuke the global
        // master (and doesn't persist a master-mute that survives refresh). Falls
        // back to master only if the sketch has no owning editor / made no sound yet.
        const scoped =
          _ownerId != null && window.mixer?.editorAudio?.(_ownerId, { db, muted: _muted });
        if (!scoped) window.mixer?.master?.volume(db).mute(_muted);
      }
    }

    // A sketch re-run rebuilds its editor bus at unity, which would leave the
    // titlebar showing "muted" while sound returns. Re-apply our state when this
    // window's editor bus is (re)built so button and audio stay in sync.
    if (_ownerId != null) {
      // persistent: this sub lives with the WINDOW (cleaned via onDispose), not the
      // run — else clearRunScoped() on the next reset would wipe it and the
      // re-mute-on-rerun would never fire.
      const unsub = subscribe(
        'mixer:editorbus',
        ({ editorId }) => {
          if (editorId === _ownerId) _apply();
        },
        { persistent: true },
      );
      onDispose(win, unsub);
    }

    muteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      _muted = !_muted;
      muteBtn.innerHTML = _muted
        ? '<i class="fa-solid fa-volume-xmark"></i>'
        : '<i class="fa-solid fa-volume-high"></i>';
      muteBtn.classList.toggle('muted', _muted);
      volSlider.style.opacity = _muted ? '0.4' : '1';
      _apply();
    });

    volSlider.addEventListener('input', (e) => {
      e.stopPropagation();
      if (_muted) {
        _muted = false;
        muteBtn.innerHTML = '<i class="fa-solid fa-volume-high"></i>';
        muteBtn.classList.remove('muted');
        volSlider.style.opacity = '1';
      }
      _apply();
    });

    // Prevent slider drag from bubbling to window drag handler
    volSlider.addEventListener('mousedown', (e) => e.stopPropagation());
  }

  function addVideoControls(win, vid) {
    const tb = win.querySelector('.wm-titlebar');
    if (!tb) return;

    const playBtn = document.createElement('button');
    playBtn.className = 'wm-mute';
    playBtn.title = 'Play / Pause';
    playBtn.innerHTML = '<i class="fa-solid fa-pause"></i>';

    const update = () => {
      playBtn.innerHTML = vid.paused
        ? '<i class="fa-solid fa-play"></i>'
        : '<i class="fa-solid fa-pause"></i>';
    };

    playBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      vid.paused ? vid.play() : vid.pause();
    });

    vid.addEventListener('play', update);
    vid.addEventListener('pause', update);

    const syncBtn = document.createElement('button');
    syncBtn.className = 'wm-mute';
    syncBtn.title = 'Sync playback time with all other video windows';
    syncBtn.innerHTML = '<i class="fa-solid fa-rotate"></i>';
    syncBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const t = vid.currentTime;
      desktop.querySelectorAll('.wm-body video').forEach((v) => {
        if (v !== vid) {
          v.currentTime = t;
          if (!v.paused) v.play().catch(() => {});
        }
      });
    });

    const audioCtrl = tb.querySelector('.wm-audio-ctrl');
    tb.insertBefore(syncBtn, audioCtrl);
    tb.insertBefore(playBtn, audioCtrl);
  }

  function addCopyPathBtn(win, url) {
    const tb = win.querySelector('.wm-titlebar');
    if (!tb || !url) return;
    const btn = document.createElement('span');
    btn.className = 'wm-btn wm-copy-path';
    btn.title = 'Copy URL';
    btn.innerHTML = '<i class="fa-regular fa-clipboard"></i>';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      navigator.clipboard?.writeText(url).catch(() => {});
      btn.innerHTML = '<i class="fa-solid fa-check"></i>';
      setTimeout(() => {
        btn.innerHTML = '<i class="fa-regular fa-clipboard"></i>';
      }, 1200);
    });
    const firstBtn = tb.querySelector('.wm-btn');
    tb.insertBefore(btn, firstBtn);
  }

  return {
    addFlipBtns,
    addCaptureButtons,
    addPaintOverlay: addPaintOverlayChrome,
    addHistoryControls,
    addAudioControls,
    addVideoControls,
    addCopyPathBtn,
    snapshotVisual,
    recordVisual,
  };
}
