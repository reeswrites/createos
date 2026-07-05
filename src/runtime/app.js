import { vision, preloadVision } from '../api/media/vision.js';
import { initToolkitWindow } from '../api/wm/toolkit-window.js';
import { EDITOR_MANIFEST, editorCodeKey, editorExecKey } from './storage-keys.js';
import { activeEditorId } from './run-context.js';
import { lang } from '../api/lang/lang.js';
import { addToolkitEntries } from '../editor/completions.js';
import {
  _registerBuiltin,
  registerAPI,
  reassertBuiltins,
  _setToolkitApplier,
  _setBlocksApplier,
} from './api-registry.js';
import { initCamera, Camera } from '../api/media/camera.js';
import { initMic } from '../api/media/mic.js';
import { audio } from '../api/audio/audio.js';
import { initStrudel, strudelGlobals } from '../api/audio/strudel.js';
import { Shader, ShaderFX } from '../api/shader/shader.js';
import { GLShader, GLSL_PRESETS } from '../api/shader/glsl-shader.js';
import { Canvas } from '../api/visual/canvas.js';
import { initPixi, PIXI } from '../api/visual/pixi.js';
import { AudioViz, SpectrogramCanvas, PianoRollViz } from '../api/visual/viz.js';
import { mixer, openMixerPanel } from '../api/audio/mixer.js';
import { Drumpad } from '../api/audio/drumpad.js';
import { Piano } from '../api/audio/piano.js';
import { Voice, initVoices } from '../api/audio/voice.js';
import { openSynthDesigner } from '../api/audio/synth-designer.js';
import { Launchpad } from '../api/audio/launchpad.js';
import { Notepad } from '../api/widgets/notepad.js';
import { Recording, recordStream, compositeCanvasStream } from '../api/media/recorder.js';
import { Media } from '../api/media/media.js';
import { VideoSignalAPI } from '../api/signal/video-signal.js';
import '../api/io/device-sources.js'; // lazy device event sources (no exported API)
import '../api/io/serial.js'; // WebSerial + GPIO on the bus (ADR 020, no window API)
import '../api/io/native-bridge.js'; // Electron hotkeys + OSC → bus (no window API; ADR 048)
import { nativeCap } from './native.js'; // native capability registry (provenance; ADR 050)
import {
  DesktopAPI,
  initDesktop,
  addFolderIcon,
  getIconSerializedData,
  removeIconById,
} from '../api/platform/desktop-files.js';
import { initProjectManager } from '../api/platform/project-manager.js';
import { initDOMCaptures, captureWindow as _captureWindow } from '../editor/editor-capture.js';
import { pipe, Source } from '../api/visual/render-pipeline.js';
import { Mask } from '../api/visual/mask-registry.js';
import { registerWindowType } from '../api/wm/window-registry.js';
import { route } from '../api/signal/route.js';
import { timeline } from '../api/signal/timeline.js';
import {
  armGlobal,
  disarmGlobal,
  isGlobalArmed,
  buildTimelineCode,
} from '../api/signal/performance-recorder.js';
import { insertSnippet } from '../editor/active-editor.js';
import {
  library,
  initLibrary,
  populateLibraryToolkit,
  populateLibraryBlocks,
} from '../api/platform/library.js';
import { initWM } from '../api/wm/wm.js';
import { initTooltips } from '../api/wm/tooltips.js';
import { installWidgetHistoryKeys } from '../api/widgets/widget-history.js';
import { applyExternalBlocks, addBlockToCategoryMeta } from '../blocks/blocks.js';
import { editImage } from '../api/media/image-edit.js';
import { ThreeScene, THREE } from '../api/visual/three-scene.js';
import { signalGraph } from '../api/signal/signal-graph.js';
import { ascii } from '../api/widgets/ascii.js';
import { Sprite } from '../api/widgets/sprite.js';
import { SpriteEditor } from '../api/widgets/sprite-editor.js';
import { Paint } from '../api/widgets/paint.js';
import { AsciiEditor } from '../api/widgets/asciiEditor.js';
import { PluginHost } from '../api/platform/plugin-host.js';
import { shell } from '../api/io/shell.js';
import { midi } from '../api/audio/midi.js';
import { external } from '../api/io/external.js';
import { statusBar } from '../api/wm/status-bar.js';
import { EditorInstance } from '../editor/editor-instance.js';
import {
  saveProject,
  loadProject,
  serializeProject,
  applyProject,
} from '../api/platform/project.js';
import { on, emit, any, tick, hold, tween, subscribe } from '../events/index.js';
import { openEventPanel } from '../api/wm/event-panel.js';
import { openTutorial } from '../api/platform/tutorial.js';
import '../api/io/input.js'; // keyboard + mouse → bus (must load after events/index.js)

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

// ── Shared globals exposed to all user code ───────────────────────────────────
// All public APIs go through _registerBuiltin so the registry is the single source
// of truth. Users call registerAPI() to override or extend any built-in.
_registerBuiltin('vision', vision, {
  params: { onGesture: ['name', 'fn'], onExpression: ['name', 'fn'] },
});
_registerBuiltin('lang', lang, {
  params: {
    isProfane: ['text'],
    profanity: ['text'],
    censor: ['text', 'mask?'],
    block: ['...words'],
    allow: ['...words'],
    sentiment: ['text'],
    classify: ['text'],
    configure: ['opts?'],
  },
});
_registerBuiltin('video', VideoSignalAPI, {
  params: {
    signal: ['source', 'opts?'],
    onMotion: ['source', 'threshold', 'onEnter', 'onExit?'],
    onBrightness: ['source', 'threshold', 'onEnter', 'onExit?'],
  },
});
// sensors global removed — use on('sensor:*') / hold('sensor:*') / emit('haptics:*') instead
_registerBuiltin('desktop', DesktopAPI, {
  params: { add: ['url', 'opts?'], remove: ['id'] },
});
_registerBuiltin('audio', audio, {
  params: {
    onLevel: ['threshold', 'onEnter', 'onExit?'],
    onWord: ['word', 'fn'],
    onSpeech: ['fn'],
    say: ['text', 'opts?'],
    load: ['url'],
    spectrogram: ['source', 'opts?'],
    pianoRoll: ['opts?'],
  },
});
_registerBuiltin('Shader', Shader, { params: ['fragmentBody', 'opts?'] });
_registerBuiltin('ShaderFX', ShaderFX, { params: ['fragmentBody', 'opts?'] });
_registerBuiltin('GLShader', GLShader, { params: ['fragmentBody', 'opts?'] });
_registerBuiltin('GLSL_PRESETS', GLSL_PRESETS);
_registerBuiltin('Canvas', Canvas, { params: ['opts?'] });
_registerBuiltin('pipe', pipe);
_registerBuiltin('Mask', Mask, {
  params: { register: ['name', 'factory'], circle: ['opts?'], feather: ['opts?'] },
});
_registerBuiltin('Source', Source);
_registerBuiltin('route', route);
_registerBuiltin('timeline', timeline);
_registerBuiltin('PIXI', PIXI);
// Vector constructor stubs — used as type hints in Shader JS function params.
// In the JS function body these are real values; the transpiler maps them to WGSL vec types.
_registerBuiltin('vec2', (x = 0, y = 0) => ({ x, y, _wgsl: 'vec2f' }));
_registerBuiltin('vec3', (x = 0, y = 0, z = 0) => ({ x, y, z, _wgsl: 'vec3f' }));
_registerBuiltin('vec4', (x = 0, y = 0, z = 0, w = 1) => ({ x, y, z, w, _wgsl: 'vec4f' }));
_registerBuiltin('Camera', Camera, { params: ['opts?'] });
_registerBuiltin('AudioViz', AudioViz);
_registerBuiltin('SpectrogramCanvas', SpectrogramCanvas);
_registerBuiltin('PianoRollViz', PianoRollViz);
_registerBuiltin('mixer', mixer, {
  params: { strip: ['name'], add: ['node', 'opts?'] },
});
_registerBuiltin('Drumpad', Drumpad);
_registerBuiltin('Launchpad', Launchpad);
_registerBuiltin('Piano', Piano);
_registerBuiltin('Voice', Voice, {
  params: {
    define: ['name', 'desc'],
    make: ['nameOrDesc'],
    get: ['name'],
    remove: ['name'],
    design: ['seed?'],
    sample: ['opts'],
    faust: ['name', 'code', 'opts?'],
  },
});
_registerBuiltin('openSynthDesigner', openSynthDesigner, { params: ['seed?'] });
_registerBuiltin('Notepad', Notepad);
_registerBuiltin('notepad', (opts) => new Notepad(opts));
_registerBuiltin('Recording', Recording);
_registerBuiltin('recordStream', recordStream);
_registerBuiltin('compositeCanvasStream', compositeCanvasStream);
_registerBuiltin('recordWindow', (winId, opts) => window.wm?.record(winId, opts));
_registerBuiltin('snapshot', (winId, opts) => window.wm?.snapshot(winId, opts));
_registerBuiltin('Media', Media);

// Strudel pattern engine (ADR 035). Replaces the removed in-house pat()/pattern()/
// stack()/Pattern. Bootstrap is async; globals are registered eagerly from the
// imported namespace so they exist before the first run, and .play() awaits init.
// Registered with literal names (not a loop) so the completion-coherence gate and
// the toolkit/detection surfaces can see each one.
// Strudel's evalScope (async) blind-writes all its exports onto globalThis after
// this returns, clobbering same-named builtins (notably @strudel/core's `on as pipe`
// vs the render-pipeline `pipe`). Re-assert the app's builtins once it settles so the
// registry wins. `.finally` covers the case where evalScope ran (clobbered) then a
// later init step threw. See api-registry.reassertBuiltins() + ADR 035.
Promise.resolve(initStrudel()).finally(reassertBuiltins);
const _S = strudelGlobals();
// sources
_registerBuiltin('note', _S.note, { params: ['pattern'] });
_registerBuiltin('s', _S.s, { params: ['pattern'] });
_registerBuiltin('n', _S.n, { params: ['pattern'] });
_registerBuiltin('sound', _S.sound, { params: ['pattern'] });
_registerBuiltin('silence', _S.silence);
// combinators
_registerBuiltin('stack', _S.stack, { params: ['...patterns'] });
_registerBuiltin('cat', _S.cat, { params: ['...patterns'] });
_registerBuiltin('slowcat', _S.slowcat);
_registerBuiltin('fastcat', _S.fastcat);
_registerBuiltin('seq', _S.seq, { params: ['...patterns'] });
_registerBuiltin('sequence', _S.sequence);
_registerBuiltin('timeCat', _S.timeCat);
_registerBuiltin('arrange', _S.arrange);
_registerBuiltin('polymeter', _S.polymeter);
_registerBuiltin('polyrhythm', _S.polyrhythm);
_registerBuiltin('run', _S.run);
// random / signals
_registerBuiltin('rand', _S.rand);
_registerBuiltin('rand2', _S.rand2);
_registerBuiltin('perlin', _S.perlin);
_registerBuiltin('irand', _S.irand);
_registerBuiltin('choose', _S.choose);
_registerBuiltin('wchoose', _S.wchoose);
_registerBuiltin('chooseCycles', _S.chooseCycles);
_registerBuiltin('randcat', _S.randcat);
_registerBuiltin('sine', _S.sine);
_registerBuiltin('cosine', _S.cosine);
_registerBuiltin('saw', _S.saw);
_registerBuiltin('isaw', _S.isaw);
_registerBuiltin('square', _S.square);
_registerBuiltin('tri', _S.tri);
_registerBuiltin('signal', _S.signal);
_registerBuiltin('steady', _S.steady);
// helpers + transport
_registerBuiltin('pure', _S.pure);
_registerBuiltin('reify', _S.reify);
_registerBuiltin('mini', _S.mini);
_registerBuiltin('samples', _S.samples, { params: ['urlOrMap'] });
_registerBuiltin('setcps', _S.setcps, { params: ['cps'] });
_registerBuiltin('setcpm', _S.setcpm);
_registerBuiltin('hush', _S.hush);

class Color {
  static random() {
    return `hsl(${Math.floor(Math.random() * 360)},${50 + Math.floor(Math.random() * 50)}%,${40 + Math.floor(Math.random() * 30)}%)`;
  }
  static invert(color) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return `rgb(${255 - r}, ${255 - g}, ${255 - b})`;
  }
}
_registerBuiltin('Color', Color);
_registerBuiltin('on', on);
_registerBuiltin('emit', emit);
_registerBuiltin('any', any);
_registerBuiltin('tick', tick, { params: ['ms'] });
_registerBuiltin('hold', hold, { params: ['event'] });
_registerBuiltin('tween', tween);
_registerBuiltin('monitor', openEventPanel);
_registerBuiltin('randUni', (lo, hi) => Math.random() * (hi - lo) + lo);
// Expose registerAPI to user code so plugins and snippets can extend the platform.
_registerBuiltin('registerAPI', registerAPI);
_registerBuiltin('editImage', editImage);
_registerBuiltin('ThreeScene', ThreeScene);
_registerBuiltin('THREE', THREE);
_registerBuiltin('signalGraph', signalGraph);
_registerBuiltin('ascii', ascii);
_registerBuiltin('Sprite', Sprite);
_registerBuiltin('SpriteEditor', SpriteEditor);
_registerBuiltin('spriteEditor', (opts) => new SpriteEditor(opts));
_registerBuiltin('Paint', Paint);
_registerBuiltin('paint', (opts) => new Paint(opts));
_registerBuiltin('AsciiEditor', AsciiEditor);
_registerBuiltin('asciiEditor', (opts) => new AsciiEditor(opts));
_registerBuiltin('PluginHost', PluginHost);
_registerBuiltin('shell', shell);
_registerBuiltin('midi', midi);
_registerBuiltin('external', external);
_registerBuiltin('statusBar', statusBar);

// Wire up extensibility appliers so registerAPI(name, impl, { blocks, toolkit }) works.
_setBlocksApplier(applyExternalBlocks);
_setToolkitApplier(addToolkitEntries);

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

  const _stage = document.getElementById('wm-stage');

  // The API Toolbox window type lives in toolkit-window.js. initToolkitWindow builds
  // the shared tooltip + drag-out snippet panel + lazy Blockly palette and installs
  // window.__ar_addToolkitEntry (the live entry hook pipe.register / registerAPI use).
  const _toolkit = initToolkitWindow();

  // Boot user library — loads localStorage entries into memory, injects into toolkit + palette
  initLibrary();
  _registerBuiltin('library', library);
  // Boot the Voice registry — seeds builtins + loads saved voices (ADR 046).
  initVoices();
  // wire block applier before populating so stored blocks register immediately
  window.__ar_applyLibraryBlock = (definition, generator) => {
    applyExternalBlocks(definition.type, [{ definition, generator }]);
    addBlockToCategoryMeta('My Library', definition.type);
  };
  populateLibraryToolkit();
  populateLibraryBlocks();

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

  // Window Type Adapter for toolkit windows — restore needs appAPI (createToolkit).
  registerWindowType('toolkit', {
    serialize(win, ctx) {
      return { type: 'toolkit', title: ctx.titleOf(win, 'API Toolbox'), ...ctx.geoOf(win) };
    },
    restore(w, ctx) {
      const id = ctx.appAPI.nextToolkitId();
      const win = ctx.appAPI._toolkit.createToolkit(id);
      ctx.applyGeo(win, w);
    },
  });
  window.__ar_newEditorWithCode = (code) => {
    const id = ++editorIdCounter;
    try {
      localStorage.setItem(editorCodeKey(id), code);
    } catch (_) {}
    const m = EditorInstance.loadManifest();
    if (!m.includes(id)) EditorInstance.saveManifest([...m, id]);
    return createEditor(id);
  };

  // Restore from manifest (fall back to editor 1 on first load)
  let manifest = EditorInstance.loadManifest();
  if (manifest.length === 0) {
    manifest = [1];
    EditorInstance.saveManifest(manifest);
  }
  for (const id of manifest) createEditor(id);

  window.wm.restoreState();

  // Embed mode: restore project state (if full project) then auto-run all editors
  if (_isEmbed) {
    (async () => {
      if (_embedProject) {
        await applyProject(_embedProject, window.wm, window.__ar_instances, appAPI);
        nativeCap('setProjectProvenance')?.('imported'); // embedded/shared = untrusted (ADR 050)
      }
      window.__ar_instances.forEach((inst) => inst.execute());
    })();
  } else {
    // Auto-execute editors that were running/paused before refresh
    for (const id of manifest) {
      const state = localStorage.getItem(editorExecKey(id));
      if (state === 'running' || state === 'paused') {
        const inst = window.__ar_instances.get(id);
        if (inst) {
          inst.execute();
          if (state === 'paused') setTimeout(() => inst.pauseRunning(), 200);
        }
      }
    }
  }

  // ── "New Editor" button ────────────────────────────────────────────────────
  document.getElementById('newEditorBtn')?.addEventListener('click', () => {
    const id = ++editorIdCounter;
    const m = EditorInstance.loadManifest();
    m.push(id);
    EditorInstance.saveManifest(m);
    const inst = createEditor(id);

    const desk = document.getElementById('desktop');
    const dw = desk.offsetWidth,
      dh = desk.offsetHeight;
    const offset = ((id - 1) % 6) * 28;
    const w = Math.round(dw * 0.42),
      h = Math.round(dh * 0.6);
    const x = Math.min(offset + 60, dw - w - 10);
    const y = Math.min(offset + 40, dh - h - 44);
    const edWin = document.getElementById(inst.editorWinId);
    if (edWin) {
      edWin.style.cssText += `;left:${x}px;top:${y}px;width:${w}px;height:${h}px;display:flex;`;
    }
    // ADR 040: no editor output window — visual output is `new Canvas()` (own window).
  });

  // ── Desktop right-click context menu ──────────────────────────────────────
  (() => {
    let menu = null;

    function closeMenu() {
      menu?.remove();
      menu = null;
    }

    document.getElementById('desktop').addEventListener('contextmenu', (e) => {
      if (e.target.closest('.wm-win') || e.target.closest('#taskbar')) return;
      e.preventDefault();
      closeMenu();

      const cx = e.clientX,
        cy = e.clientY;
      menu = document.createElement('div');
      menu.className = 'desktop-ctx-menu';

      const items = [
        {
          icon: 'fa-file-code',
          label: 'New Code File',
          action() {
            const id = ++editorIdCounter;
            const m = EditorInstance.loadManifest();
            m.push(id);
            EditorInstance.saveManifest(m);
            const inst = createEditor(id);
            const desk = document.getElementById('desktop');
            const dw = desk.offsetWidth,
              dh = desk.offsetHeight;
            const w = Math.round(dw * 0.42),
              h = Math.round(dh * 0.6);
            const x = Math.min(cx, dw - w - 10);
            const y = Math.min(cy, dh - h - 44);
            const edWin = document.getElementById(inst.editorWinId);
            if (edWin)
              edWin.style.cssText += `;left:${x}px;top:${y}px;width:${w}px;height:${h}px;display:flex;`;
          },
        },
        {
          icon: 'fa-folder-open',
          label: 'Grant Folder Access…',
          async action() {
            const folderData = await window.wm.pickFolder();
            if (!folderData) return;
            const desk = document.getElementById('desktop');
            const rect = desk.getBoundingClientRect();
            const iconId = addFolderIcon(folderData, cx - rect.left, cy - rect.top);
            if (folderData.handle) window.wm.registerFolder(iconId, folderData.handle);
            else if (folderData.fallback)
              window.wm.registerFolderFallback(iconId, folderData.fallback);
            window.wm.browse(iconId, null, { x: cx, y: cy }).catch(() => {});
          },
        },
        {
          icon: 'fa-wave-square',
          label: 'New Visualizer',
          action() {
            const offset = (_vizCount++ % 8) * 24;
            window.wm.spawn('Visualizer', {
              type: 'viz',
              w: 400,
              h: 240,
              x: cx + offset,
              y: cy + offset,
            });
          },
        },
        {
          icon: 'fa-sliders',
          label: 'Mixer',
          action() {
            openMixerPanel();
          },
        },
        {
          icon: 'fa-gauge-high',
          label: 'Motion Sensor',
          action() {
            window.wm.spawn('Motion Sensor', {
              type: 'sensor',
              source: 'motion',
              w: 280,
              h: 300,
              x: cx,
              y: cy,
            });
          },
        },
        {
          icon: 'fa-gamepad',
          label: 'Gamepad',
          action() {
            window.wm.spawn('Gamepad', {
              type: 'sensor',
              source: 'gamepad',
              w: 280,
              h: 300,
              x: cx,
              y: cy,
            });
          },
        },
        {
          icon: 'fa-location-dot',
          label: 'Geolocation',
          action() {
            window.wm.spawn('Geolocation', {
              type: 'sensor',
              source: 'geo',
              w: 280,
              h: 300,
              x: cx,
              y: cy,
            });
          },
        },
        {
          icon: 'fa-toolbox',
          label: 'New Toolkit',
          action() {
            const id = _toolkit.nextToolkitId();
            const win = _toolkit.createToolkit(id);
            const w = 200,
              h = 500;
            win.style.cssText += `;left:${Math.min(cx, window.innerWidth - w - 10)}px;top:${Math.min(cy, window.innerHeight - h - 44)}px;width:${w}px;height:${h}px;display:flex;`;
          },
        },
        {
          icon: 'fa-play',
          label: 'Run All Editors',
          action() {
            window.__ar_instances.forEach((inst) => inst.execute());
          },
        },
      ];

      items.forEach(({ icon, label, action }) => {
        const item = document.createElement('div');
        item.className = 'desktop-ctx-item';
        item.innerHTML = `<i class="fa-solid ${icon}"></i> ${label}`;
        item.addEventListener('click', () => {
          closeMenu();
          action();
        });
        menu.appendChild(item);
      });

      document.body.appendChild(menu);

      const mw = menu.offsetWidth,
        mh = menu.offsetHeight;
      menu.style.left = `${Math.min(cx, window.innerWidth - mw - 4)}px`;
      menu.style.top = `${Math.min(cy, window.innerHeight - mh - 4)}px`;
    });

    document.addEventListener('mousedown', (e) => {
      if (menu && !menu.contains(e.target)) closeMenu();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeMenu();
    });
  })();

  // ── "New Toolkit" button ───────────────────────────────────────────────────
  document.getElementById('newToolkitBtn')?.addEventListener('click', () => {
    const id = _toolkit.nextToolkitId();
    const win = _toolkit.createToolkit(id);
    const desk = document.getElementById('desktop');
    const dw = desk.offsetWidth,
      dh = desk.offsetHeight;
    const offset = ((id - 1) % 6) * 28;
    const w = Math.round(dw * 0.13),
      h = Math.round(dh * 0.7);
    const x = Math.min(offset + 30, dw - w - 10);
    const y = Math.min(offset + 30, dh - h - 44);
    win.style.cssText += `;left:${x}px;top:${y}px;width:${w}px;height:${h}px;display:flex;`;
  });

  // ── "Run All" button ──────────────────────────────────────────────────────
  document.getElementById('runAllBtn')?.addEventListener('click', () => {
    window.__ar_instances.forEach((inst) => inst.execute());
  });

  // ── Global Capture (Performance recording across all widgets, ADR 031) ───────
  // First click arms every open widget on one shared clock; second click stops
  // and inserts a single timeline() composing one track per widget.
  const _gcBtn = document.getElementById('globalCaptureBtn');
  _gcBtn?.addEventListener('click', () => {
    if (!isGlobalArmed()) {
      armGlobal();
      _gcBtn.classList.add('recording');
      _gcBtn.style.color = '#f38ba8';
      _gcBtn.dataset.tip = 'Stop global capture → timeline code';
    } else {
      const tracks = disarmGlobal();
      _gcBtn.classList.remove('recording');
      _gcBtn.style.color = '';
      _gcBtn.dataset.tip = 'Capture all widgets → timeline code';
      if (tracks.length) insertSnippet(buildTimelineCode(tracks));
    }
  });

  // ── "New Visualizer" button ────────────────────────────────────────────────
  let _vizCount = 0;
  document.getElementById('newVizBtn')?.addEventListener('click', () => {
    const offset = (_vizCount++ % 8) * 24;
    const desk = document.getElementById('desktop');
    const dw = desk.offsetWidth,
      dh = desk.offsetHeight;
    window.wm.spawn('Visualizer', {
      type: 'viz',
      w: 400,
      h: 240,
      x: Math.round((dw - 400) / 2) + offset,
      y: Math.round((dh - 240) / 2) + offset,
    });
  });

  // ── "Mixer" button ─────────────────────────────────────────────────────────
  document.getElementById('mixerBtn')?.addEventListener('click', () => {
    openMixerPanel();
  });

  // ── "New Drum Pad" button ──────────────────────────────────────────────────
  document.getElementById('newDrumpadBtn')?.addEventListener('click', () => {
    const desk = document.getElementById('desktop');
    const dw = desk.offsetWidth,
      dh = desk.offsetHeight;
    const offset = (_vizCount++ % 6) * 24;
    new Drumpad({
      title: 'Drum Pad',
      w: 500,
      h: 360,
      x: Math.round((dw - 500) / 2) + offset,
      y: Math.round((dh - 360) / 2) + offset,
    });
  });

  // ── "New Piano" button ────────────────────────────────────────────────────
  document.getElementById('newPianoBtn')?.addEventListener('click', () => {
    const desk = document.getElementById('desktop');
    const dw = desk.offsetWidth,
      dh = desk.offsetHeight;
    const offset = (_vizCount++ % 6) * 24;
    new Piano({
      title: 'Piano',
      w: 560,
      h: 420,
      x: Math.round((dw - 560) / 2) + offset,
      y: Math.round((dh - 420) / 2) + offset,
    });
  });

  // ── "New Launchpad" button ────────────────────────────────────────────────
  document.getElementById('newLaunchpadBtn')?.addEventListener('click', () => {
    const desk = document.getElementById('desktop');
    const dw = desk.offsetWidth,
      dh = desk.offsetHeight;
    const offset = (_vizCount++ % 6) * 24;
    const lp = new Launchpad({ title: 'Launchpad' });
    if (lp._winId) {
      const win = document.getElementById(lp._winId);
      if (win) {
        const ww = parseInt(win.style.width) || 380;
        const wh = parseInt(win.style.height) || 430;
        win.style.left = Math.round((dw - ww) / 2) + offset + 'px';
        win.style.top = Math.round((dh - wh) / 2) + offset + 'px';
      }
    }
  });

  // ── "Synth Designer" button ───────────────────────────────────────────────
  document.getElementById('synthDesignerBtn')?.addEventListener('click', () => {
    openSynthDesigner();
  });

  // ── "New Paint" button ────────────────────────────────────────────────────
  document.getElementById('newPaintBtn')?.addEventListener('click', () => {
    const desk = document.getElementById('desktop');
    const dw = desk.offsetWidth,
      dh = desk.offsetHeight;
    const offset = (_vizCount++ % 6) * 24;
    const ed = new Paint({ width: 400, height: 300, title: 'Paint' });
    if (ed._winId) {
      const win = document.getElementById(ed._winId);
      if (win) {
        const ww = parseInt(win.style.width) || 404;
        const wh = parseInt(win.style.height) || 520;
        win.style.left = Math.round((dw - ww) / 2) + offset + 'px';
        win.style.top = Math.round((dh - wh) / 2) + offset + 'px';
      }
    }
  });

  // ── "New ASCII Editor" button ─────────────────────────────────────────────
  document.getElementById('newAsciiEditorBtn')?.addEventListener('click', () => {
    const desk = document.getElementById('desktop');
    const dw = desk.offsetWidth,
      dh = desk.offsetHeight;
    const offset = (_vizCount++ % 6) * 24;
    const ed = new AsciiEditor({ cols: 64, rows: 24, title: 'ASCII Editor' });
    if (ed._winId) {
      const win = document.getElementById(ed._winId);
      if (win) {
        const ww = parseInt(win.style.width) || 648;
        const wh = parseInt(win.style.height) || 580;
        win.style.left = Math.round((dw - ww) / 2) + offset + 'px';
        win.style.top = Math.round((dh - wh) / 2) + offset + 'px';
      }
    }
  });

  // ── "New Sprite Editor" button ────────────────────────────────────────────
  document.getElementById('newSpriteEditorBtn')?.addEventListener('click', () => {
    const desk = document.getElementById('desktop');
    const dw = desk.offsetWidth,
      dh = desk.offsetHeight;
    const offset = (_vizCount++ % 6) * 24;
    const ed = new SpriteEditor({ width: 16, height: 16, scale: 20, title: 'Pixel Art' });
    // center the window after the wm spawn placed it
    if (ed._winId) {
      const win = document.getElementById(ed._winId);
      if (win) {
        const ww = parseInt(win.style.width) || 344;
        const wh = parseInt(win.style.height) || 520;
        win.style.left = Math.round((dw - ww) / 2) + offset + 'px';
        win.style.top = Math.round((dh - wh) / 2) + offset + 'px';
      }
    }
  });

  // ── "New Sensor Monitor" button (dropdown) ─────────────────────────────────
  (() => {
    const btn = document.getElementById('newSensorBtn');
    const drop = document.getElementById('sensorDropdown');
    if (!btn || !drop) return;

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      drop.classList.toggle('open');
    });

    drop.addEventListener('click', (e) => {
      e.stopPropagation();
      const li = e.target.closest('li[data-source]');
      if (!li) return;
      const source = li.dataset.source;
      const titles = {
        motion: 'Motion Sensor',
        gamepad: 'Gamepad',
        geo: 'Geolocation',
        battery: 'Battery',
      };
      const desk = document.getElementById('desktop');
      const dw = desk.offsetWidth,
        dh = desk.offsetHeight;
      const offset = (_vizCount++ % 8) * 24;
      window.wm.spawn(titles[source] ?? 'Sensor', {
        type: 'sensor',
        source,
        w: 280,
        h: 300,
        x: Math.round((dw - 280) / 2) + offset,
        y: Math.round((dh - 300) / 2) + offset,
      });
      drop.classList.remove('open');
    });

    document.addEventListener('click', (e) => {
      if (!btn.contains(e.target)) drop.classList.remove('open');
    });

    // Probe sensor availability and hide items that have no real data.
    // DeviceMotionEvent exists on desktop but fires null values — detect by
    // listening to the first event or timing out after 600ms with no real data.
    (() => {
      const hideSensor = (source) => {
        const li = drop.querySelector(`li[data-source="${source}"]`);
        if (li) li.style.display = 'none';
        const visible = [...drop.querySelectorAll('li[data-source]')].filter(
          (l) => l.style.display !== 'none',
        );
        if (visible.length === 0) btn.style.display = 'none';
      };

      // Motion: probe first event; hide if all accelerometer values are null.
      if (!window.DeviceMotionEvent) {
        hideSensor('motion');
      } else {
        let probed = false;
        const onMotion = (e) => {
          if (probed) return;
          probed = true;
          window.removeEventListener('devicemotion', onMotion);
          const a = e.accelerationIncludingGravity;
          if (a == null || (a.x == null && a.y == null && a.z == null)) hideSensor('motion');
        };
        window.addEventListener('devicemotion', onMotion);
        setTimeout(() => {
          if (probed) return;
          probed = true;
          window.removeEventListener('devicemotion', onMotion);
          hideSensor('motion'); // never fired → no sensor
        }, 800);
      }

      // Battery: hide if API absent or promise rejects.
      if (!navigator.getBattery) {
        hideSensor('battery');
      } else {
        navigator.getBattery().catch(() => hideSensor('battery'));
      }
    })();
  })();

  // ── "Demo Gallery" button — opens as a WM window (not a modal) ───────────────
  // Same "everything is a window" treatment as the Tutorial: a draggable,
  // minimizable html window; clicking the toolbar icon again focuses/restores it.
  (() => {
    const galleryBtn = document.getElementById('galleryBtn');
    if (!galleryBtn) return;
    const WIN_ID = 'win-gallery';
    let _demos = null;

    async function _fetchDemos() {
      if (_demos) return _demos;
      const res = await fetch('/createos/demos/index.json');
      _demos = await res.json();
      return _demos;
    }

    function _renderInto(grid, list) {
      grid.innerHTML = '';
      for (const demo of list) {
        const card = document.createElement('div');
        card.className = 'gallery-card';
        const tags = (demo.tags ?? []).map((t) => `<span class="gallery-tag">${t}</span>`).join('');
        card.innerHTML = `
          <h3 class="gallery-card-title">${demo.title}</h3>
          <p class="gallery-card-desc">${demo.desc}</p>
          <div class="gallery-card-tags">${tags}</div>
          <button class="gallery-load-btn" data-file="${demo.file}">
            <i class="fa-solid fa-play" style="font-size:9px;margin-right:4px;"></i>Load Demo
          </button>`;
        grid.appendChild(card);
      }
    }

    async function openGallery() {
      // Open-or-focus: restore from taskbar if minimized, else bring to front.
      if (document.getElementById(WIN_ID)) {
        const chip = document.querySelector(`#wm-taskbar [data-win-id="${WIN_ID}"]`);
        if (chip) chip.click();
        else window.wm?.focus(WIN_ID);
        return;
      }

      const desk = document.getElementById('desktop');
      const w = 680;
      const h = Math.min(560, (desk?.offsetHeight ?? 700) - 60);
      const x = Math.max(20, Math.round(((desk?.offsetWidth ?? 1000) - w) / 2));
      window.wm?.spawn('Demo Gallery', {
        id: WIN_ID,
        type: 'html',
        html: '',
        w,
        h,
        x,
        y: 40,
        audio: false,
      });

      const body = document.getElementById(WIN_ID)?.querySelector('.wm-body');
      if (!body) return;
      body.innerHTML = `<div id="galleryGrid" class="gallery-grid"><p style="color:#888;font-family:Arial;padding:12px;">Loading…</p></div>`;
      const grid = body.querySelector('#galleryGrid');

      grid.addEventListener('click', async (e) => {
        const btn = e.target.closest('.gallery-load-btn');
        if (!btn) return;
        const file = btn.dataset.file;
        btn.textContent = 'Loading…';
        btn.disabled = true;
        try {
          const res = await fetch(`/createos/demos/${file}`);
          if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${file}`);
          const data = await res.json();
          await applyProject(data, window.wm, window.__ar_instances, appAPI);
          nativeCap('setProjectProvenance')?.('demo'); // gallery demo = untrusted (ADR 050)
          // Close only AFTER a successful load. applyProject() already calls wm.closeAll()
          // (project.js), so this is the safety-net no-op on success — but crucially it means
          // a failure leaves the gallery (and this button) alive so the catch UI is visible.
          window.wm?.hide(WIN_ID);
        } catch (err) {
          btn.textContent = 'Error — try again';
          btn.disabled = false;
          console.error('Gallery load failed:', err);
        }
      });

      try {
        _renderInto(grid, await _fetchDemos());
      } catch (err) {
        grid.innerHTML = `<p style="color:#f38ba8;font-family:Arial;padding:12px;">Failed to load demos: ${err.message}</p>`;
      }
    }

    galleryBtn.addEventListener('click', () =>
      openGallery().catch((err) => console.error('Gallery open failed:', err)),
    );
  })();

  // ── "Speech-to-Text" button — opens the model-manager panel (ADR 039) ───────
  (() => {
    const sttBtn = document.getElementById('sttBtn');
    if (!sttBtn) return;
    sttBtn.addEventListener('click', () => {
      import('../stt/settings-ui.js')
        .then(({ openSTTSettings }) => openSTTSettings())
        .catch((err) => console.error('STT settings open failed:', err));
    });
  })();

  // ── "Tutorial" button ──────────────────────────────────────────────────────
  // Opens the tutorial WM window, or focuses/restores it if already open.
  document.getElementById('tutorialBtn')?.addEventListener('click', () => {
    openTutorial().catch((err) => console.error('Tutorial open failed:', err));
  });

  // Camera / mic toolbar icons — spawn a viz window on click (ADR 023).
  // No toggle semantics; streams are demand-driven via media-lease.js.

  const _spawnMicViz = () => {
    const desk = document.getElementById('desktop');
    const dw = desk.offsetWidth,
      dh = desk.offsetHeight;
    const offset = (_vizCount++ % 8) * 24;
    window.wm.spawn('Mic Visualizer', {
      type: 'viz',
      source: 'mic',
      style: 'bars',
      w: 400,
      h: 180,
      x: Math.round((dw - 400) / 2) + offset,
      y: Math.round((dh - 180) / 2) + offset,
    });
  };

  const _spawnCamWin = () => {
    const desk = document.getElementById('desktop');
    const dw = desk.offsetWidth,
      dh = desk.offsetHeight;
    const offset = (_vizCount++ % 8) * 24;
    window.wm.spawn('Camera', {
      type: 'camera',
      w: 320,
      h: 240,
      x: Math.round((dw - 320) / 2) + offset,
      y: Math.round((dh - 240) / 2) + offset,
    });
  };

  document.getElementById('micToggle')?.addEventListener('click', _spawnMicViz);
  document.getElementById('cameraToggle')?.addEventListener('click', _spawnCamWin);

  // ── Live indicator ─────────────────────────────────────────────────────────
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

  // ── Files button ──────────────────────────────────────────────────────────
  const filesBtn = document.getElementById('filesBtn');
  const imageExts = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico']);
  const videoExts = new Set(['mp4', 'webm', 'mov', 'avi', 'mkv']);
  const audioExts = new Set(['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a']);
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
          else if (videoExts.has(ext))
            window.wm.spawn(name, { type: 'video', src: url, w: 640, h: 480 });
          else if (audioExts.has(ext)) {
            const a = new Audio(url);
            a.controls = true;
            const winId = window.wm.spawn(name, { type: 'html', html: '', w: 320, h: 60 });
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

  // ── Help modal ────────────────────────────────────────────────────────────
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

  // ── Project save / load ───────────────────────────────────────────────────
  const appAPI = {
    createEditor,
    createToolkit: _toolkit.createToolkit,
    nextToolkitId: _toolkit.nextToolkitId,
    updateManifest: (ids) => EditorInstance.saveManifest(ids),
  };

  initProjectManager({
    appAPI,
    getWm: () => window.wm,
    getInstances: () => window.__ar_instances,
  });

  document
    .getElementById('saveProjectBtn')
    ?.addEventListener('click', () => saveProject(window.wm, window.__ar_instances));

  document.getElementById('shareProjectBtn')?.addEventListener('click', () => {
    const data = serializeProject(window.wm, window.__ar_instances);
    const b64 = btoa(encodeURIComponent(JSON.stringify(data)));
    const url = `${location.origin}${location.pathname}?embed=1&project=${b64}`;
    navigator.clipboard
      ?.writeText(url)
      .then(() => {
        const btn = document.getElementById('shareProjectBtn');
        if (btn) {
          btn.style.color = '#4f4';
          _nativeSetTimeout(() => {
            btn.style.color = '';
          }, 1500);
        }
      })
      .catch(() => {
        prompt('Copy embed URL:', url);
      });
  });

  document
    .getElementById('loadProjectBtn')
    ?.addEventListener('click', () => loadProject(window.wm, window.__ar_instances, appAPI));

  // ── Projects toolbar dropdown ──────────────────────────────────────────────
  (() => {
    const btn = document.getElementById('projectsBtn');
    const drop = document.getElementById('projectsDropdown');
    if (!btn || !drop) return;

    const render = () => {
      drop.innerHTML = '';
      const pm = window.__ar_projectManager;
      if (!pm) return;
      const activeId = pm.getActiveProjectId();
      const activeName = pm.getActiveProjectName();
      const projects = window.__ar_projectCache ?? [];

      const addItem = (label, fn, extra = '') => {
        const li = document.createElement('li');
        li.textContent = label;
        if (extra) li.style.cssText = extra;
        li.addEventListener('click', (e) => {
          e.stopPropagation();
          drop.classList.remove('open');
          fn();
        });
        drop.appendChild(li);
      };
      const addSep = () => {
        const li = document.createElement('li');
        li.style.cssText =
          'pointer-events:none;padding:2px 0;border-top:1px solid #dde;margin:2px 0;';
        drop.appendChild(li);
      };

      // Current project header
      const hdr = document.createElement('li');
      hdr.style.cssText =
        'font-size:10px;color:#888;letter-spacing:0.5px;text-transform:uppercase;padding:6px 14px 2px;pointer-events:none;';
      hdr.textContent = 'Projects';
      drop.appendChild(hdr);

      for (const p of projects) {
        const isActive = p.id === activeId;
        addItem(
          (isActive ? '▶ ' : '  ') + p.name,
          () => {
            if (!isActive) pm.switchProject(p.id);
          },
          isActive ? 'font-weight:600;color:#3a5fe0;' : '',
        );
      }

      addSep();
      addItem('+ New project…', async () => {
        const name = prompt('Project name:');
        if (!name?.trim()) return;
        const id = await pm.createProject(name.trim());
        pm.switchProject(id);
      });
      addItem('Rename "' + activeName + '"…', async () => {
        const name = prompt('Rename project:', activeName);
        if (!name?.trim() || name.trim() === activeName) return;
        pm.renameProject(activeId, name.trim());
      });
      if (projects.length > 1) {
        addItem(
          'Delete "' + activeName + '"…',
          async () => {
            if (!confirm(`Delete project "${activeName}"? Cannot be undone.`)) return;
            pm.deleteProject(activeId);
          },
          'color:#c0392b;',
        );
      }
    };

    window.__ar_projectDropdownRefresh = render;

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!drop.classList.contains('open')) render();
      drop.classList.toggle('open');
    });

    document.addEventListener('click', (e) => {
      if (!btn.contains(e.target)) drop.classList.remove('open');
    });
  })();

  // ── Fullscreen ───────────────────────────────────────────────────────────
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

  // ── Global error fallback ─────────────────────────────────────────────────
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
};
