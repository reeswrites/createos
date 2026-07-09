// ── Miscellaneous toolbar chrome ──────────────────────────────────────────────
// STT, Tutorial, camera/mic live indicator, Files browser, Help modal, Fullscreen,
// window undo/redo/close-all, and the global error fallback. Extracted from app.js
// window.onload. No shared onload ctx needed — all wiring is DOM + globals.
import { openTutorial } from '../../api/platform/tutorial.js';
import { subscribe } from '../../events/index.js';
import { mediaKind } from '../../api/media/media-kind.js';

export function initMiscChrome() {
  // ── "Speech-to-Text" button — opens the model-manager panel (ADR 039) ────────
  const sttBtn = document.getElementById('sttBtn');
  sttBtn?.addEventListener('click', () => {
    import('../../stt/settings-ui.js')
      .then(({ openSTTSettings }) => openSTTSettings())
      .catch((err) => console.error('STT settings open failed:', err));
  });

  // ── "Tutorial" button ───────────────────────────────────────────────────────
  // Opens the tutorial WM window, or focuses/restores it if already open.
  document.getElementById('tutorialBtn')?.addEventListener('click', () => {
    openTutorial().catch((err) => console.error('Tutorial open failed:', err));
  });

  // ── Live indicator ────────────────────────────────────────────────────────────
  // Counts all camera:open / camera:close / mic:open / mic:close bus events
  // (toolbar AND Camera.open() multi-cam streams) and toggles .media-live on
  // the respective toolbar icon (ADR 023).
  {
    let _cameraLive = 0,
      _micLive = 0;
    const camBtn = document.getElementById('cameraToggle');
    const micBtn = document.getElementById('micToggle');
    subscribe('camera:open', () => {
      _cameraLive++;
      camBtn?.classList.toggle('media-live', _cameraLive > 0);
    });
    subscribe('camera:close', () => {
      _cameraLive = Math.max(0, _cameraLive - 1);
      camBtn?.classList.toggle('media-live', _cameraLive > 0);
    });
    subscribe('mic:open', () => {
      _micLive++;
      micBtn?.classList.toggle('media-live', _micLive > 0);
    });
    subscribe('mic:close', () => {
      _micLive = Math.max(0, _micLive - 1);
      micBtn?.classList.toggle('media-live', _micLive > 0);
    });
  }

  // ── Files button ──────────────────────────────────────────────────────────────
  const filesBtn = document.getElementById('filesBtn');
  const imageExts = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico']);
  let _fileBrowseCount = 0;
  filesBtn?.addEventListener('click', async () => {
    const offset = (_fileBrowseCount++ % 8) * 24;
    const x = 20 + offset,
      y = 20 + offset;
    try {
      await window.wm.browse(
        '__nav_files__',
        (url, name) => {
          const ext = name.split('.').pop().toLowerCase();
          if (imageExts.has(ext))
            window.wm.spawn(name, { type: 'image', src: url, w: 480, h: 360 });
          else if (mediaKind(name) === 'video')
            window.wm.spawn(name, { type: 'video', src: url, w: 640, h: 480 });
          else if (mediaKind(name) === 'audio') {
            const a = new Audio(url);
            a.controls = true;
            const winId = window.wm.spawn(name, {
              type: 'html',
              html: '',
              w: 320,
              h: 60,
            });
            const body = document.getElementById(winId)?.querySelector('.wm-body');
            if (body) {
              body.style.cssText += 'align-items:center;padding:4px 8px;';
              body.appendChild(a);
              a.play();
            }
          }
        },
        { x, y },
      );
    } catch (_) {}
  });

  // ── Help modal ──────────────────────────────────────────────────────────────
  const helpOverlay = document.getElementById('help-overlay');
  const helpBtn = document.getElementById('helpBtn');
  const helpClose = document.getElementById('help-close');
  const toggleHelp = () => {
    const open = helpOverlay.style.display !== 'none';
    helpOverlay.style.display = open ? 'none' : 'block';
    helpBtn?.classList.toggle('active', !open);
  };
  helpBtn?.addEventListener('click', toggleHelp);
  helpClose?.addEventListener('click', () => {
    helpOverlay.style.display = 'none';
    helpBtn?.classList.remove('active');
  });
  helpOverlay?.addEventListener('click', (e) => {
    if (e.target === helpOverlay) {
      helpOverlay.style.display = 'none';
      helpBtn?.classList.remove('active');
    }
  });
  document.addEventListener('keydown', (e) => {
    if (
      e.key === '?' &&
      !e.ctrlKey &&
      !e.metaKey &&
      !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName) &&
      !document.activeElement?.classList.contains('CodeMirror-code')
    )
      toggleHelp();
    if (e.key === 'Escape' && helpOverlay?.style.display !== 'none') {
      helpOverlay.style.display = 'none';
      helpBtn?.classList.remove('active');
    }
  });

  // ── Window undo / redo / close-all + Fullscreen ──────────────────────────────
  document.getElementById('undoWinBtn')?.addEventListener('click', () => window.wm.undo());
  document.getElementById('redoWinBtn')?.addEventListener('click', () => window.wm.redo());
  document.getElementById('closeAllWinsBtn')?.addEventListener('click', () => window.wm.closeAll());

  const fullscreenBtn = document.getElementById('fullscreenBtn');
  const _updateFsIcon = () => {
    const fs = !!document.fullscreenElement;
    fullscreenBtn
      ?.querySelector('i')
      ?.setAttribute('class', fs ? 'fa-solid fa-compress' : 'fa-solid fa-expand');
    fullscreenBtn?.classList.toggle('active', fs);
  };
  fullscreenBtn?.addEventListener('click', () => {
    document.fullscreenElement
      ? document.exitFullscreen()
      : document.documentElement.requestFullscreen();
  });
  document.addEventListener('fullscreenchange', _updateFsIcon);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'F11') {
      e.preventDefault();
      document.fullscreenElement
        ? document.exitFullscreen()
        : document.documentElement.requestFullscreen();
    }
  });

  // ── Global error fallback ────────────────────────────────────────────────────
  window.onerror = () => {
    window.__ar_instances?.forEach((inst) => {
      if (inst.btnState === 'running' || inst.btnState === 'paused') inst._setStopped();
    });
    return false;
  };
  window.onunhandledrejection = () => {
    window.__ar_instances?.forEach((inst) => {
      if (inst.btnState === 'running' || inst.btnState === 'paused') inst._setStopped();
    });
  };
}
