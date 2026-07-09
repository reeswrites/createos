import { preloadVision } from '../api/media/vision.js';
import { initToolkitWindow, toolkitWindowAdapter } from '../api/wm/toolkit-window.js';
import { EDITOR_MANIFEST, editorCodeKey, editorExecKey } from './storage-keys.js';
import { activeEditorId } from './run-context.js';
import { _registerBuiltin } from './api-registry.js';
import { registerBuiltins } from './register-builtins.js';
import { initCamera } from '../api/media/camera.js';
import { initMic } from '../api/media/mic.js';
import { initPixi } from '../api/visual/pixi.js';
import '../api/io/device-sources.js'; // lazy device event sources (no exported API)
import '../api/io/serial.js'; // WebSerial + GPIO on the bus (ADR 020, no window API)
import '../api/io/native-bridge.js'; // Electron hotkeys + OSC → bus (no window API; ADR 048)
import { nativeCap } from './native.js'; // native capability registry (provenance; ADR 050)
import {
  initDesktop,
  getIconSerializedData,
  removeIconById,
} from '../api/platform/desktop-files.js';
import { initDOMCaptures, captureWindow as _captureWindow } from '../editor/editor-capture.js';
import { registerWindowType } from '../api/wm/window-registry.js';
import { library, initLibrary, populateLibraryToolkit } from '../api/platform/library.js';
import { initWM } from '../api/wm/wm.js';
import { initTooltips } from '../api/wm/tooltips.js';
import { installWidgetHistoryKeys } from '../api/widgets/widget-history.js';
import { initVoices } from '../api/audio/voice.js';
import { EditorInstance } from '../editor/editor-instance.js';
import { applyProject } from '../api/platform/project.js';
import { installTestHarness } from './test-harness.js';
import '../api/io/input.js'; // keyboard + mouse → bus (must load after events/index.js)

import { initSpawnButtons } from './toolbar/spawn-buttons.js';
import { initDesktopContextMenu } from './toolbar/desktop-context-menu.js';
import { initSensorDropdown } from './toolbar/sensor-dropdown.js';
import { initDemoGallery } from './toolbar/demo-gallery.js';
import { initProjectToolbar } from './toolbar/project-toolbar.js';
import { initMiscChrome } from './toolbar/misc-chrome.js';

// ── Capture native timer/event functions before any user-code patching ────────
const _nativeSetInterval = window.setInterval.bind(window);
const _nativeClearInterval = window.clearInterval.bind(window);
const _nativeSetTimeout = window.setTimeout.bind(window);
const _nativeClearTimeout = window.clearTimeout.bind(window);
const _nativeELAdd = EventTarget.prototype.addEventListener;

const nativeTimers = {
  setInterval: _nativeSetInterval,
  clearInterval: _nativeClearInterval,
  setTimeout: _nativeSetTimeout,
  clearTimeout: _nativeClearTimeout,
};

// ── Register every startup built-in on window (register-builtins.js) ──────────
// Runs synchronously at module load (before onload), so registrations exist before
// the first run and the Strudel reassert is armed early — same timing as when this
// block lived inline in app.js. Runtime-dependent registrations (wm/pixi/library/
// captureWindow) stay in onload below.
registerBuiltins();

// ── Global addEventListener patch — routes listeners to active editor ──────────
EventTarget.prototype.addEventListener = function (type, handler, options) {
  const edId = activeEditorId();
  if (edId != null) {
    const inst = window.__ar_instances?.get(edId);
    if (inst) inst._listeners.push({ target: this, type, handler, options });
  }
  return _nativeELAdd.call(this, type, handler, options);
};

preloadVision();

// ── Embed / viewer mode ─────────────────────────────────────────────────────
const _embedParams = new URLSearchParams(location.search);
const _isEmbed = _embedParams.has('embed');
const _embedCode = (() => {
  const raw = _embedParams.get('code');
  if (!raw) return null;
  try {
    return decodeURIComponent(atob(raw));
  } catch (_) {
    return null;
  }
})();
const _embedProject = (() => {
  const raw = _embedParams.get('project');
  if (!raw) return null;
  try {
    return JSON.parse(decodeURIComponent(atob(raw)));
  } catch (_) {
    return null;
  }
})();

if (_isEmbed) {
  document.body.classList.add('ar-embed');
  if (_embedProject) {
    // Full project embed: restore each editor's code into localStorage so the
    // normal manifest-restore loop picks them up, then applyProject() after init.
    const editorEntries = (_embedProject.windows ?? []).filter((w) => w.type === 'editor');
    const ids = editorEntries.map((w) => w.editorId);
    editorEntries.forEach((w) => {
      try {
        localStorage.setItem(editorCodeKey(w.editorId), w.code ?? '');
      } catch (_) {}
    });
    if (ids.length > 0) {
      try {
        localStorage.setItem(EDITOR_MANIFEST, JSON.stringify(ids));
      } catch (_) {}
    }
  } else if (_embedCode) {
    // Single-code embed: slot 1 only
    try {
      localStorage.setItem(editorCodeKey(1), _embedCode);
    } catch (_) {}
    try {
      localStorage.setItem(EDITOR_MANIFEST, JSON.stringify([1]));
    } catch (_) {}
  }
}

window.onload = () => {
  // ── Signal routing table — reset on each run by cleanupSignalGraph() ──────
  window.__ar_signalRoutes = [];

  // ── Styled hover tooltips for every [title] (widgets + wm titlebars) ──────
  initTooltips();

  // ── Camera / Mic ───────────────────────────────────────────────────────────
  initCamera();
  initMic();

  // ── DOM captures ──────────────────────────────────────────────────────────
  initDOMCaptures(_nativeSetInterval, _nativeClearInterval);
  _registerBuiltin('captureWindow', (target, fps) => _captureWindow(target, fps), {
    params: ['target', 'fps?'],
  });

  // ── Window manager ─────────────────────────────────────────────────────────
  const _wm = initWM(() => {
    window.__ar_instances?.forEach((inst) => {
      inst.cm.requestMeasure();
      inst.inlineWidgets.refresh();
    });
  });
  _registerBuiltin('wm', _wm, {
    params: {
      spawn: ['title', 'opts?'],
      move: ['id', 'x', 'y'],
      resize: ['id', 'w', 'h'],
      show: ['id'],
      hide: ['id'],
      close: ['id'],
      setZ: ['id', 'z'],
      setOpacity: ['id', 'opacity'],
    },
  });
  initDesktop(window.wm);
  // Wire project-manager bridge globals used by desktop-files.js context menus
  window.__ar_getIconSerializedData = getIconSerializedData;
  window.__ar_removeIconById = removeIconById;
  installWidgetHistoryKeys();

  // Widget restore factories now live BESIDE each widget class via
  // registerWidgetRestorer(type, fn) — see widget-restorer-registry.js (ADR 055
  // discipline). wm.restoreState resolves them through restoreWidget().

  // PIXI.js — init once at startup (synchronous in v7). Sets window.pixi + window.Stage.
  initPixi();
  // Register pixi/Stage through the registry after initPixi() assigns them to window.
  if (window.pixi) _registerBuiltin('pixi', window.pixi, { params: { tick: ['fn'] } });
  if (window.Stage) _registerBuiltin('Stage', window.Stage);

  // The API Toolbox window type lives in toolkit-window.js. initToolkitWindow builds
  // the shared tooltip + drag-out snippet panel and installs
  // window.__ar_addToolkitEntry (the live entry hook pipe.register / registerAPI use).
  const _toolkit = initToolkitWindow();

  // Boot user library — loads localStorage entries into memory, injects into toolkit
  initLibrary();
  _registerBuiltin('library', library);
  // Boot the Voice registry — seeds builtins + loads saved voices (ADR 046).
  initVoices();
  populateLibraryToolkit();

  // ── Editor instances ───────────────────────────────────────────────────────
  window.__ar_instances = new Map();
  const defaultCode = document.getElementById('code_text')?.textContent.trim() ?? '';
  let editorIdCounter = 0;

  function createEditor(id) {
    editorIdCounter = Math.max(editorIdCounter, id);
    const inst = new EditorInstance(id, {
      nativeTimers,
      wm: window.wm,
      toolkitWinId: 'win-toolkit',
      defaultCode: id === 1 ? defaultCode : '',
    });
    window.__ar_instances.set(id, inst);
    return inst;
  }
  window.__ar_createEditor = createEditor;
  window.__ar_createToolkit = _toolkit.createToolkit;

  // Bumps the id counter, appends to the manifest, and creates the editor. Shared by
  // the "New Editor" button and the desktop "New Code File" context item — the single
  // place editorIdCounter is advanced for interactive spawns.
  function newEditor() {
    const id = ++editorIdCounter;
    const m = EditorInstance.loadManifest();
    m.push(id);
    EditorInstance.saveManifest(m);
    return createEditor(id);
  }

  // Window Type Adapter for toolkit windows — restore needs appAPI (createToolkit).
  // Definition lives beside the toolkit code (toolkit-window.js); app.js registers it.
  registerWindowType('toolkit', toolkitWindowAdapter);
  window.__ar_newEditorWithCode = (code) => {
    const id = ++editorIdCounter;
    try {
      localStorage.setItem(editorCodeKey(id), code);
    } catch (_) {}
    const m = EditorInstance.loadManifest();
    if (!m.includes(id)) EditorInstance.saveManifest([...m, id]);
    return createEditor(id);
  };

  const appAPI = {
    createEditor,
    createToolkit: _toolkit.createToolkit,
    nextToolkitId: _toolkit.nextToolkitId,
    updateManifest: (ids) => EditorInstance.saveManifest(ids),
  };

  // Shared spawn-cascade offset — one counter across every "New X" spawner so
  // consecutive windows fan out from a corner instead of stacking (ADR 040).
  let _spawnN = 0;
  const spawnOffset = (mod = 8) => (_spawnN++ % mod) * 24;

  // Shared context threaded into every extracted toolbar module.
  const ctx = { appAPI, toolkit: _toolkit, createEditor, newEditor, spawnOffset };

  // Restore from manifest (fall back to editor 1 on first load)
  let manifest = EditorInstance.loadManifest();
  if (manifest.length === 0) {
    manifest = [1];
    EditorInstance.saveManifest(manifest);
  }
  for (const id of manifest) createEditor(id);

  window.wm.restoreState();

  // Dev/e2e-only automation seam (window.__ar_test). Absent from prod builds.
  if (import.meta.env.DEV || _embedParams.has('e2e')) {
    installTestHarness({ applyProject, appAPI });
  }

  // Embed mode: restore project state (if full project) then auto-run all editors
  if (_isEmbed) {
    (async () => {
      if (_embedProject) {
        await applyProject(_embedProject, window.wm, window.__ar_instances, appAPI);
        nativeCap('setProjectProvenance')?.('imported'); // embedded/shared = untrusted (ADR 050)
      }
      // Embed auto-run is execute-only (== 'running'); restore via the shared seam.
      window.__ar_instances.forEach((inst) => inst.restoreExecutionState('running'));
    })();
  } else {
    // Auto-execute editors that were running/paused before refresh
    for (const id of manifest) {
      const state = localStorage.getItem(editorExecKey(id));
      window.__ar_instances.get(id)?.restoreExecutionState(state);
    }
  }

  // ── Toolbar wiring (extracted modules) ─────────────────────────────────────
  initSpawnButtons(ctx);
  initDesktopContextMenu(ctx);
  initSensorDropdown(ctx);
  initDemoGallery(ctx);
  initProjectToolbar(ctx);
  initMiscChrome();
};
