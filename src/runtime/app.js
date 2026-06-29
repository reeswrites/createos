import { vision, stopVision, preloadVision } from "../api/vision.js";
import { TOOLKIT_CATEGORIES, addToolkitEntries } from "../editor/completions.js";
import { _registerBuiltin, registerAPI, _setToolkitApplier, _setBlocksApplier } from "./api-registry.js";
import { initCamera, Camera, cleanupCameras } from "../api/camera.js";
import { initMic } from "../api/mic.js";
import { audio, startAudio, cleanupAudio } from "../api/audio.js";
import { initStrudel, strudelGlobals } from "../api/strudel.js";
import { Shader, ShaderFX, cleanupShaders } from "../api/shader.js";
import { GLShader, GLSL_PRESETS } from "../api/glsl-shader.js";
import { initPixi, PIXI } from "../api/pixi.js";
import { AudioViz, SpectrogramCanvas, PianoRollViz, cleanupViz } from "../api/viz.js";
import { mixer, openMixerPanel } from "../api/mixer.js";
import { Drumpad } from "../api/drumpad.js";
import { Piano, cleanupPianos } from "../api/piano.js";
import { Notepad } from "../api/notepad.js";
import { Recording, recordStream, compositeCanvasStream } from "../api/recorder.js";
import { Media, cleanupMedia } from "../api/media.js";
import { VideoSignalAPI, cleanupVideoSignal } from "../api/video-signal.js";
import "../api/device-sources.js"; // lazy device event sources (no exported API)
import "../api/serial.js";         // WebSerial + GPIO on the bus (ADR 020, no window API)
import { DesktopAPI, initDesktop, cleanupDesktop, addFolderIcon, getIconSerializedData, removeIconById } from "../api/desktop-files.js";
import { initProjectManager } from "../api/project-manager.js";
import { initDOMCaptures, captureWindow as _captureWindow, cleanupCaptures } from "../editor/editor-capture.js";
import { pipe, Source, cleanupPipelines } from "../api/render-pipeline.js";
import { route } from "../api/route.js";
import { timeline } from "../api/timeline.js";
import { armGlobal, disarmGlobal, isGlobalArmed, buildTimelineCode } from "../api/performance-recorder.js";
import { insertSnippet } from "../editor/active-editor.js";
import { library, initLibrary, populateLibraryToolkit, populateLibraryBlocks } from "../api/library.js";
import { initWM } from "../api/wm.js";
import { installWidgetHistoryKeys } from "../api/widget-history.js";
import {
  initPaletteWorkspace, onPaletteClick, resizeBlockly,
  TOOLBOX_CATEGORY_META, finishBlockRenders, applyExternalBlocks,
  addBlockToCategoryMeta,
} from "../blocks/blocks.js";
import { editImage } from "../api/image-edit.js";
import { ThreeScene, THREE } from "../api/three-scene.js";
import { signalGraph } from "../api/signal-graph.js";
import { ascii } from "../api/ascii.js";
import { Sprite } from "../api/sprite.js";
import { SpriteEditor } from "../api/sprite-editor.js";
import { Paint } from "../api/paint.js";
import { AsciiEditor } from "../api/asciiEditor.js";
import { PluginHost, cleanupPlugins } from "../api/plugin-host.js";
import { shell } from "../api/shell.js";
import { midi, cleanupMidi } from "../api/midi.js";
import { external, cleanupExternal } from "../api/external.js";
import { statusBar, cleanupStatusBar } from "../api/status-bar.js";
import { EditorInstance } from "../editor/editor-instance.js";
import { saveProject, loadProject, serializeProject, applyProject } from "../api/project.js";
import { on, emit, any, tick, hold, tween, registerCommand, subscribe } from "../events/index.js";
import { openEventPanel } from "../api/event-panel.js";
import "../api/input.js"; // keyboard + mouse → bus (must load after events/index.js)

// ── Capture native timer/event functions before any user-code patching ────────
const _nativeSetInterval  = window.setInterval.bind(window);
const _nativeClearInterval = window.clearInterval.bind(window);
const _nativeSetTimeout   = window.setTimeout.bind(window);
const _nativeClearTimeout = window.clearTimeout.bind(window);
const _nativeELAdd = EventTarget.prototype.addEventListener;

const nativeTimers = {
  setInterval:   _nativeSetInterval,
  clearInterval: _nativeClearInterval,
  setTimeout:    _nativeSetTimeout,
  clearTimeout:  _nativeClearTimeout,
};

// ── Shared globals exposed to all user code ───────────────────────────────────
// All public APIs go through _registerBuiltin so the registry is the single source
// of truth. Users call registerAPI() to override or extend any built-in.
_registerBuiltin('vision',   vision);
_registerBuiltin('video',    VideoSignalAPI);
// sensors global removed — use on('sensor:*') / hold('sensor:*') / emit('haptics:*') instead
_registerBuiltin('desktop',  DesktopAPI);
_registerBuiltin('audio',    audio);
_registerBuiltin('Shader',   Shader);
_registerBuiltin('ShaderFX', ShaderFX);
_registerBuiltin('GLShader', GLShader);
_registerBuiltin('GLSL_PRESETS', GLSL_PRESETS);
_registerBuiltin('pipe',    pipe);
_registerBuiltin('Source',  Source);
_registerBuiltin('route',   route);
_registerBuiltin('timeline', timeline);
_registerBuiltin('PIXI',     PIXI);
// Vector constructor stubs — used as type hints in Shader JS function params.
// In the JS function body these are real values; the transpiler maps them to WGSL vec types.
_registerBuiltin('vec2', (x = 0, y = 0)             => ({ x, y, _wgsl: 'vec2f' }));
_registerBuiltin('vec3', (x = 0, y = 0, z = 0)      => ({ x, y, z, _wgsl: 'vec3f' }));
_registerBuiltin('vec4', (x = 0, y = 0, z = 0, w=1) => ({ x, y, z, w, _wgsl: 'vec4f' }));
_registerBuiltin('Camera',   Camera);
_registerBuiltin('AudioViz',          AudioViz);
_registerBuiltin('SpectrogramCanvas', SpectrogramCanvas);
_registerBuiltin('PianoRollViz',      PianoRollViz);
_registerBuiltin('mixer',             mixer);
_registerBuiltin('Drumpad',           Drumpad);
_registerBuiltin('Piano',             Piano);
_registerBuiltin('Notepad',           Notepad);
_registerBuiltin('notepad',           (opts) => new Notepad(opts));
_registerBuiltin('Recording',         Recording);
_registerBuiltin('recordStream',      recordStream);
_registerBuiltin('compositeCanvasStream', compositeCanvasStream);
_registerBuiltin('recordWindow',      (winId, opts) => window.wm?.record(winId, opts));
_registerBuiltin('snapshot',          (winId, opts) => window.wm?.snapshot(winId, opts));
_registerBuiltin('Media',    Media);

// Strudel pattern engine (ADR 035). Replaces the removed in-house pat()/pattern()/
// stack()/Pattern. Bootstrap is async; globals are registered eagerly from the
// imported namespace so they exist before the first run, and .play() awaits init.
// Registered with literal names (not a loop) so the completion-coherence gate and
// the toolkit/detection surfaces can see each one.
initStrudel();
const _S = strudelGlobals();
// sources
_registerBuiltin('note',   _S.note);
_registerBuiltin('s',      _S.s);
_registerBuiltin('n',      _S.n);
_registerBuiltin('sound',  _S.sound);
_registerBuiltin('silence', _S.silence);
// combinators
_registerBuiltin('stack',    _S.stack);
_registerBuiltin('cat',      _S.cat);
_registerBuiltin('slowcat',  _S.slowcat);
_registerBuiltin('fastcat',  _S.fastcat);
_registerBuiltin('seq',      _S.seq);
_registerBuiltin('sequence', _S.sequence);
_registerBuiltin('timeCat',  _S.timeCat);
_registerBuiltin('arrange',  _S.arrange);
_registerBuiltin('polymeter', _S.polymeter);
_registerBuiltin('polyrhythm', _S.polyrhythm);
_registerBuiltin('run',      _S.run);
// random / signals
_registerBuiltin('rand',     _S.rand);
_registerBuiltin('rand2',    _S.rand2);
_registerBuiltin('perlin',   _S.perlin);
_registerBuiltin('irand',    _S.irand);
_registerBuiltin('choose',   _S.choose);
_registerBuiltin('wchoose',  _S.wchoose);
_registerBuiltin('chooseCycles', _S.chooseCycles);
_registerBuiltin('randcat',  _S.randcat);
_registerBuiltin('sine',     _S.sine);
_registerBuiltin('cosine',   _S.cosine);
_registerBuiltin('saw',      _S.saw);
_registerBuiltin('isaw',     _S.isaw);
_registerBuiltin('square',   _S.square);
_registerBuiltin('tri',      _S.tri);
_registerBuiltin('signal',   _S.signal);
_registerBuiltin('steady',   _S.steady);
// helpers + transport
_registerBuiltin('pure',     _S.pure);
_registerBuiltin('reify',    _S.reify);
_registerBuiltin('mini',     _S.mini);
_registerBuiltin('samples',  _S.samples);
_registerBuiltin('setcps',   _S.setcps);
_registerBuiltin('setcpm',   _S.setcpm);
_registerBuiltin('hush',     _S.hush);

class Color {
  static random() {
    return `hsl(${Math.floor(Math.random() * 360)},${50 + Math.floor(Math.random() * 50)}%,${40 + Math.floor(Math.random() * 30)}%)`;
  }
  static invert(color) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return `rgb(${255 - r}, ${255 - g}, ${255 - b})`;
  }
}
_registerBuiltin('Color', Color);
_registerBuiltin('on',      on);
_registerBuiltin('emit',    emit);
_registerBuiltin('any',     any);
_registerBuiltin('tick',    tick);
_registerBuiltin('hold',    hold);
_registerBuiltin('tween',   tween);
_registerBuiltin('monitor', openEventPanel);
_registerBuiltin('randUni', (lo, hi) => Math.random() * (hi - lo) + lo);
// Expose registerAPI to user code so plugins and snippets can extend the platform.
_registerBuiltin('registerAPI', registerAPI);
_registerBuiltin('editImage',  editImage);
_registerBuiltin('ThreeScene', ThreeScene);
_registerBuiltin('THREE',      THREE);
_registerBuiltin('signalGraph', signalGraph);
_registerBuiltin('ascii',      ascii);
_registerBuiltin('Sprite',        Sprite);
_registerBuiltin('SpriteEditor',  SpriteEditor);
_registerBuiltin('spriteEditor',  (opts) => new SpriteEditor(opts));
_registerBuiltin('Paint',         Paint);
_registerBuiltin('paint',         (opts) => new Paint(opts));
_registerBuiltin('AsciiEditor',   AsciiEditor);
_registerBuiltin('asciiEditor',   (opts) => new AsciiEditor(opts));
_registerBuiltin('PluginHost', PluginHost);
_registerBuiltin('shell',    shell);
_registerBuiltin('midi',      midi);
_registerBuiltin('external',  external);
_registerBuiltin('statusBar', statusBar);

// Wire up extensibility appliers so registerAPI(name, impl, { blocks, toolkit }) works.
_setBlocksApplier(applyExternalBlocks);
_setToolkitApplier(addToolkitEntries);

// ── Global addEventListener patch — routes listeners to active editor ──────────
EventTarget.prototype.addEventListener = function(type, handler, options) {
  const edId = window.__ar_active_editor_id;
  if (edId != null) {
    const inst = window.__ar_instances?.get(edId);
    if (inst) inst._listeners.push({ target: this, type, handler, options });
  }
  return _nativeELAdd.call(this, type, handler, options);
};

preloadVision();

// ── Embed / viewer mode ─────────────────────────────────────────────────────
const _embedParams  = new URLSearchParams(location.search);
const _isEmbed      = _embedParams.has('embed');
const _embedCode    = (() => {
  const raw = _embedParams.get('code');
  if (!raw) return null;
  try { return decodeURIComponent(atob(raw)); } catch (_) { return null; }
})();
const _embedProject = (() => {
  const raw = _embedParams.get('project');
  if (!raw) return null;
  try { return JSON.parse(decodeURIComponent(atob(raw))); } catch (_) { return null; }
})();

if (_isEmbed) {
  document.body.classList.add('ar-embed');
  if (_embedProject) {
    // Full project embed: restore each editor's code into localStorage so the
    // normal manifest-restore loop picks them up, then applyProject() after init.
    const editorEntries = (_embedProject.windows ?? []).filter(w => w.type === 'editor');
    const ids = editorEntries.map(w => w.editorId);
    editorEntries.forEach(w => {
      try { localStorage.setItem(`vl-ide-code-${w.editorId}`, w.code ?? ''); } catch (_) {}
    });
    if (ids.length > 0) {
      try { localStorage.setItem('vl-ide-editors', JSON.stringify(ids)); } catch (_) {}
    }
  } else if (_embedCode) {
    // Single-code embed: slot 1 only
    try { localStorage.setItem('vl-ide-code-1', _embedCode); } catch (_) {}
    try { localStorage.setItem('vl-ide-editors', JSON.stringify([1])); } catch (_) {}
  }
}

window.onload = () => {
  // ── Signal routing table — reset on each run by cleanupSignalGraph() ──────
  window.__ar_signalRoutes = [];

  // ── Camera / Mic ───────────────────────────────────────────────────────────
  initCamera();
  initMic();

  // ── DOM captures ──────────────────────────────────────────────────────────
  initDOMCaptures(_nativeSetInterval, _nativeClearInterval);
  _registerBuiltin('captureWindow', (target, fps) => _captureWindow(target, fps));

  // ── Window manager ─────────────────────────────────────────────────────────
  window.__ar_widgetRestorers = {};
  const _wm = initWM(() => {
    window.__ar_instances?.forEach(inst => {
      inst.cm.requestMeasure();
      inst.inlineWidgets.refresh();
    });
  });
  _registerBuiltin('wm', _wm);
  initDesktop(window.wm);
  // Wire project-manager bridge globals used by desktop-files.js context menus
  window.__ar_getIconSerializedData = getIconSerializedData;
  window.__ar_removeIconById        = removeIconById;
  installWidgetHistoryKeys();

  // Widget restore factories — called by wm.restoreState for code-generated windows
  window.__ar_widgetRestorers['drumpad'] = (s) => new Drumpad({
    title: s.title, x: s.x, y: s.y, w: s.w, h: s.h,
    bpm: s.widgetState?.bpm, patterns: s.widgetState?.patterns,
    _desktopIconId: s.widgetState?._desktopIconId,
  });
  window.__ar_widgetRestorers['piano'] = (s) => new Piano({
    title: s.title, x: s.x, y: s.y, w: s.w, h: s.h,
    preset: s.widgetState?.preset, bpm: s.widgetState?.bpm,
    duration: s.widgetState?.duration, baseOctave: s.widgetState?.baseOctave,
    octaves: s.widgetState?.octaves, steps: s.widgetState?.steps,
    _desktopIconId: s.widgetState?._desktopIconId,
  });
  window.__ar_widgetRestorers['note'] = (s) => new Notepad({
    title: s.title, x: s.x, y: s.y, w: s.w, h: s.h,
    content: s.widgetState?.content,
    _desktopIconId: s.widgetState?._desktopIconId,
  });
  // Legacy projects may carry an 'eq' widget — graceful no-op (ADR 032 removed EQWidget).
  window.__ar_widgetRestorers['eq'] = () => {};
  window.__ar_widgetRestorers['mixer'] = () => openMixerPanel();
  window.__ar_widgetRestorers['paint'] = (s) => {
    const ws = s.widgetState ?? {};
    const frameUrls = ws.frames ?? [];
    let loaded = 0;
    const canvases = frameUrls.map(() => {
      const c = document.createElement('canvas');
      c.width  = ws.width  ?? 400;
      c.height = ws.height ?? 300;
      return c;
    });
    const open = () => new Paint({
      width: ws.width ?? 400, height: ws.height ?? 300,
      bg: ws.bg ?? '#ffffff', fps: ws.fps ?? 8,
      title: s.title ?? 'Paint', x: s.x, y: s.y,
      _desktopIconId: ws._desktopIconId,
      _frameCanvases: canvases.length ? canvases : null,
    });
    if (!frameUrls.length) { open(); return; }
    frameUrls.forEach((url, i) => {
      const img = new Image();
      img.onload  = () => { canvases[i].getContext('2d').drawImage(img, 0, 0); if (++loaded === frameUrls.length) open(); };
      img.onerror = () => {                                                       if (++loaded === frameUrls.length) open(); };
      img.src = url;
    });
  };

  window.__ar_widgetRestorers['spriteEditor'] = (s) => {
    const ws = s.widgetState ?? {};
    const sp = new Sprite({ width: ws.width ?? 16, height: ws.height ?? 16, scale: ws.scale ?? 20, frames: ws.frames?.length ?? 1 });
    const frameUrls = ws.frames ?? [];
    let loaded = 0;
    const open = () => new SpriteEditor({ sprite: sp, title: s.title, x: s.x, y: s.y, _desktopIconId: ws._desktopIconId });
    if (!frameUrls.length) { open(); return; }
    frameUrls.forEach((url, i) => {
      const img = new Image();
      img.onload = () => {
        sp._frames[i].getContext('2d').drawImage(img, 0, 0);
        sp._render();
        if (++loaded === frameUrls.length) open();
      };
      img.onerror = () => { if (++loaded === frameUrls.length) open(); };
      img.src = url;
    });
  };

  window.__ar_widgetRestorers['ascii'] = (s) => {
    const ws = s.widgetState ?? {};
    new AsciiEditor({
      cols: ws.cols ?? 64, rows: ws.rows ?? 24,
      cellW: ws.cellW ?? 10, cellH: ws.cellH ?? 18,
      fps: ws.fps ?? 8, bg: ws.bg ?? '#0d0208',
      title: s.title ?? 'ASCII Editor', x: s.x, y: s.y,
      _desktopIconId: ws._desktopIconId,
      _frames: ws.frames ?? null,
    });
  };

  // PIXI.js — init once at startup (synchronous in v7). Sets window.pixi + window.Stage.
  initPixi();
  // Register pixi/Stage through the registry after initPixi() assigns them to window.
  if (window.pixi)  _registerBuiltin('pixi',  window.pixi, { params: { tick: ['fn'] } });
  if (window.Stage) _registerBuiltin('Stage', window.Stage);

  const _stage = document.getElementById('wm-stage');

  // ── Shared tooltip for toolkit snippets ───────────────────────────────────
  const toolTipEl = document.createElement('div');
  toolTipEl.id = 'toolkit-tooltip';
  document.body.appendChild(toolTipEl);
  const showTooltip = (text, anchorEl) => {
    toolTipEl.textContent = text;
    toolTipEl.style.display = 'block';
    const rect = anchorEl.getBoundingClientRect();
    toolTipEl.style.left = `${rect.right + 8}px`;
    toolTipEl.style.top  = `${rect.top + rect.height / 2}px`;
    toolTipEl.style.transform = 'translateY(-50%)';
  };
  const hideTooltip = () => { toolTipEl.style.display = 'none'; };

  function _makeToolkitBtn(cmd, catName) {
    const btn = document.createElement('div');
    btn.className = 'toolkit-btn';
    btn.draggable = true;
    btn.dataset.search = `${cmd.label} ${cmd.hint ?? ''} ${(cmd.tags ?? []).join(' ')}`.toLowerCase();
    btn.dataset.cat = catName.toLowerCase();
    btn.innerHTML = `<span>${cmd.label}</span><span class="toolkit-info" title="">ℹ</span>`;
    btn.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('application/x-ar-toolkit', cmd.code);
      if (cmd.blockType) e.dataTransfer.setData('application/x-ar-block-type', cmd.blockType);
      e.dataTransfer.effectAllowed = 'copy';
      btn.classList.add('dragging');
      hideTooltip();
    });
    btn.addEventListener('dragend', () => btn.classList.remove('dragging'));
    if (cmd.hint) {
      const infoSpan = btn.querySelector('.toolkit-info');
      infoSpan.addEventListener('mouseenter', () => showTooltip(cmd.hint, infoSpan));
      infoSpan.addEventListener('mouseleave', hideTooltip);
      infoSpan.addEventListener('mousedown', (e) => e.stopPropagation());
    }
    return btn;
  }

  function _populateTextPanel(panel) {
    for (const cat of TOOLKIT_CATEGORIES) {
      const catEl = document.createElement('div');
      catEl.className = 'toolkit-category';
      catEl.dataset.catName = cat.name.toLowerCase();
      catEl.textContent = cat.name;
      panel.appendChild(catEl);
      for (const cmd of cat.commands) {
        panel.appendChild(_makeToolkitBtn(cmd, cat.name));
      }
    }
  }

  // Live toolkit entry insertion — called by pipe.register() and any runtime registerAPI() use.
  // Updates all currently-open toolkit text panels without requiring a re-open.
  window.__ar_addToolkitEntry = (catName, cmd) => {
    addToolkitEntries(catName, [cmd]);
    document.querySelectorAll('.ar-toolkit-text').forEach(panel => {
      let header = panel.querySelector(`.toolkit-category[data-cat-name="${catName.toLowerCase()}"]`);
      if (!header) {
        header = document.createElement('div');
        header.className = 'toolkit-category';
        header.dataset.catName = catName.toLowerCase();
        header.textContent = catName;
        panel.appendChild(header);
      }
      panel.appendChild(_makeToolkitBtn(cmd, catName));
    });
  };

  // Boot user library — loads localStorage entries into memory, injects into toolkit + palette
  initLibrary();
  _registerBuiltin('library', library);
  // wire block applier before populating so stored blocks register immediately
  window.__ar_applyLibraryBlock = (definition, generator) => {
    applyExternalBlocks(definition.type, [{ definition, generator }]);
    addBlockToCategoryMeta('My Library', definition.type);
  };
  populateLibraryToolkit();
  populateLibraryBlocks();

  function _filterTextPanel(panel, q) {
    const query = q.trim().toLowerCase();
    const cats = panel.querySelectorAll('.toolkit-category');
    const btns = panel.querySelectorAll('.toolkit-btn');
    if (!query) {
      cats.forEach(c => { c.style.display = ''; });
      btns.forEach(b => { b.style.display = ''; });
      return;
    }
    cats.forEach(c => { c.style.display = 'none'; });
    btns.forEach(b => {
      const match = b.dataset.search?.includes(query);
      b.style.display = match ? '' : 'none';
      if (match) {
        const catEl = panel.querySelector(`.toolkit-category[data-cat-name="${b.dataset.cat}"]`);
        if (catEl) catEl.style.display = '';
      }
    });
  }

  function _buildToolkitContent(win) {
    const body = win.querySelector('.wm-body');
    body.style.overflow = 'hidden';
    body.style.flexDirection = 'column';
    body.style.padding = '0';
    body.style.background = '#f0f2f5';

    const modeBar = document.createElement('div');
    modeBar.className = 'ar-toolkit-modebar';

    const textModeBtn = document.createElement('button');
    textModeBtn.className = 'ar-toolkit-mode ar-toolkit-mode-active';
    textModeBtn.title = 'Text snippets';
    textModeBtn.innerHTML = '<i class="fa-solid fa-code"></i>';

    const blocksModeBtn = document.createElement('button');
    blocksModeBtn.className = 'ar-toolkit-mode';
    blocksModeBtn.title = 'Block palette';
    blocksModeBtn.innerHTML = '<i class="fa-solid fa-puzzle-piece"></i>';

    const searchInput = document.createElement('input');
    searchInput.type = 'search';
    searchInput.placeholder = 'Filter…';
    searchInput.className = 'ar-toolkit-search';
    searchInput.addEventListener('mousedown', e => e.stopPropagation());

    modeBar.appendChild(textModeBtn);
    modeBar.appendChild(blocksModeBtn);
    body.appendChild(modeBar);

    const searchRow = document.createElement('div');
    searchRow.className = 'ar-toolkit-searchrow';
    searchRow.appendChild(searchInput);
    body.appendChild(searchRow);

    const textPanel = document.createElement('div');
    textPanel.className = 'ar-toolkit-text';
    _populateTextPanel(textPanel);
    body.appendChild(textPanel);

    const blocksPanel = document.createElement('div');
    blocksPanel.className = 'ar-toolkit-blocks';
    blocksPanel.style.display = 'none';

    const catPanel = document.createElement('div');
    catPanel.className = 'ar-toolkit-cats';

    const listPanel = document.createElement('div');
    listPanel.className = 'ar-toolkit-list';

    const backBtn = document.createElement('button');
    backBtn.className = 'blockly-back-btn';
    backBtn.textContent = '← Back';

    const paletteDiv = document.createElement('div');
    paletteDiv.className = 'ar-toolkit-palette';

    listPanel.appendChild(backBtn);
    listPanel.appendChild(paletteDiv);
    blocksPanel.appendChild(catPanel);
    blocksPanel.appendChild(listPanel);
    body.appendChild(blocksPanel);

    let paletteWorkspace = null;
    let inBlocksMode = false;

    function ensurePalette() {
      if (paletteWorkspace) return;
      paletteWorkspace = initPaletteWorkspace(paletteDiv);
      onPaletteClick(paletteWorkspace, (type) => {
        window.__ar_active_blocks_editor?._addBlockToWorkspace(type);
      });
      backBtn.addEventListener('click', () => {
        listPanel.style.display = 'none';
        catPanel.style.display = '';
      });
      for (const { name, hue, blocks } of TOOLBOX_CATEGORY_META) {
        const btn = document.createElement('button');
        btn.className = 'blockly-cat-btn';
        btn.textContent = name;
        btn.style.background = `hsl(${hue}, 50%, 42%)`;
        btn.addEventListener('click', async () => {
          catPanel.style.display = 'none';
          listPanel.style.display = 'flex';
          backBtn.textContent = '← ' + name;
          paletteWorkspace.clear();
          const addedBlocks = [];
          for (const { type } of blocks) {
            const block = paletteWorkspace.newBlock(type);
            block.initSvg(); block.render();
            addedBlocks.push(block);
          }
          await finishBlockRenders();
          let y = 10;
          for (const block of addedBlocks) {
            block.moveTo({ x: 10, y });
            y += block.getHeightWidth().height + 14;
          }
          resizeBlockly(paletteWorkspace);
          requestAnimationFrame(() => paletteWorkspace.scroll(0, 0));
        });
        catPanel.appendChild(btn);
      }
    }

    function openText() {
      textPanel.style.display = '';
      blocksPanel.style.display = 'none';
      textModeBtn.classList.add('ar-toolkit-mode-active');
      blocksModeBtn.classList.remove('ar-toolkit-mode-active');
      inBlocksMode = false;
    }

    function openBlocks() {
      ensurePalette();
      textPanel.style.display = 'none';
      blocksPanel.style.display = 'flex';
      textModeBtn.classList.remove('ar-toolkit-mode-active');
      blocksModeBtn.classList.add('ar-toolkit-mode-active');
      inBlocksMode = true;
      resizeBlockly(paletteWorkspace);
    }

    searchInput.addEventListener('input', () => {
      if (!inBlocksMode) _filterTextPanel(textPanel, searchInput.value);
    });
    textModeBtn.addEventListener('click', () => { if (inBlocksMode) { openText(); searchRow.style.display = ''; } });
    blocksModeBtn.addEventListener('click', () => { if (!inBlocksMode) { openBlocks(); searchRow.style.display = 'none'; } });

    new ResizeObserver(() => {
      if (inBlocksMode && paletteWorkspace) resizeBlockly(paletteWorkspace);
    }).observe(body);
  }

  let toolkitIdCounter = 0;

  function createToolkit(id) {
    toolkitIdCounter = Math.max(toolkitIdCounter, id);
    const winId = id === 1 ? 'win-toolkit' : `win-toolkit-${id}`;
    const title = id === 1 ? 'API Toolbox' : `API Toolbox ${id}`;
    window.wm.spawn(title, { id: winId, type: 'html', html: '', audio: false });
    const win = document.getElementById(winId);
    _buildToolkitContent(win);
    win.querySelector('.wm-dup')?.remove();
    return win;
  }

  // ── Editor instances ───────────────────────────────────────────────────────
  window.__ar_instances = new Map();
  const defaultCode = document.getElementById("code_text")?.textContent.trim() ?? '';
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
  window.__ar_createEditor  = createEditor;
  window.__ar_createToolkit = createToolkit;
  window.__ar_newEditorWithCode = (code) => {
    const id = ++editorIdCounter;
    try { localStorage.setItem(`vl-ide-code-${id}`, code); } catch (_) {}
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
      }
      window.__ar_instances.forEach(inst => inst.execute());
    })();
  } else {
    // Auto-execute editors that were running/paused before refresh
    for (const id of manifest) {
      const state = localStorage.getItem(`vl-ide-exec-${id}`);
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
    const dw = desk.offsetWidth, dh = desk.offsetHeight;
    const offset = ((id - 1) % 6) * 28;
    const w = Math.round(dw * 0.42), h = Math.round(dh * 0.6);
    const x = Math.min(offset + 60, dw - w - 10);
    const y = Math.min(offset + 40, dh - h - 44);
    const edWin  = document.getElementById(inst.editorWinId);
    const outWin = document.getElementById(inst.canvasWinId);
    if (edWin)  { edWin.style.cssText  += `;left:${x}px;top:${y}px;width:${w}px;height:${h}px;display:flex;`; }
    if (outWin) { outWin.style.cssText += `;left:${x + w + 6}px;top:${y}px;width:${Math.min(500, dw - x - w - 16)}px;height:${h}px;display:flex;`; }
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

      const cx = e.clientX, cy = e.clientY;
      menu = document.createElement('div');
      menu.className = 'desktop-ctx-menu';

      const items = [
        { icon: 'fa-file-code', label: 'New Code File', action() {
          const id = ++editorIdCounter;
          const m = EditorInstance.loadManifest();
          m.push(id);
          EditorInstance.saveManifest(m);
          const inst = createEditor(id);
          const desk = document.getElementById('desktop');
          const dw = desk.offsetWidth, dh = desk.offsetHeight;
          const w = Math.round(dw * 0.42), h = Math.round(dh * 0.6);
          const x = Math.min(cx, dw - w - 10);
          const y = Math.min(cy, dh - h - 44);
          const edWin = document.getElementById(inst.editorWinId);
          if (edWin) edWin.style.cssText += `;left:${x}px;top:${y}px;width:${w}px;height:${h}px;display:flex;`;
        }},
        { icon: 'fa-folder-open', label: 'Grant Folder Access…', async action() {
          const folderData = await window.wm.pickFolder();
          if (!folderData) return;
          const desk = document.getElementById('desktop');
          const rect = desk.getBoundingClientRect();
          const iconId = addFolderIcon(folderData, cx - rect.left, cy - rect.top);
          if (folderData.handle) window.wm.registerFolder(iconId, folderData.handle);
          else if (folderData.fallback) window.wm.registerFolderFallback(iconId, folderData.fallback);
          window.wm.browse(iconId, null, { x: cx, y: cy }).catch(() => {});
        }},
        { icon: 'fa-wave-square', label: 'New Visualizer', action() {
          const offset = (_vizCount++ % 8) * 24;
          window.wm.spawn('Visualizer', { type: 'viz', w: 400, h: 240, x: cx + offset, y: cy + offset });
        }},
        { icon: 'fa-sliders', label: 'Mixer', action() {
          openMixerPanel();
        }},
        { icon: 'fa-gauge-high', label: 'Motion Sensor', action() {
          window.wm.spawn('Motion Sensor', { type: 'sensor', source: 'motion', w: 280, h: 300, x: cx, y: cy });
        }},
        { icon: 'fa-gamepad', label: 'Gamepad', action() {
          window.wm.spawn('Gamepad', { type: 'sensor', source: 'gamepad', w: 280, h: 300, x: cx, y: cy });
        }},
        { icon: 'fa-location-dot', label: 'Geolocation', action() {
          window.wm.spawn('Geolocation', { type: 'sensor', source: 'geo', w: 280, h: 300, x: cx, y: cy });
        }},
        { icon: 'fa-toolbox', label: 'New Toolkit', action() {
          const id = ++toolkitIdCounter;
          const win = createToolkit(id);
          const w = 200, h = 500;
          win.style.cssText += `;left:${Math.min(cx, window.innerWidth - w - 10)}px;top:${Math.min(cy, window.innerHeight - h - 44)}px;width:${w}px;height:${h}px;display:flex;`;
        }},
        { icon: 'fa-play', label: 'Run All Editors', action() {
          window.__ar_instances.forEach(inst => inst.execute());
        }},
      ];

      items.forEach(({ icon, label, action }) => {
        const item = document.createElement('div');
        item.className = 'desktop-ctx-item';
        item.innerHTML = `<i class="fa-solid ${icon}"></i> ${label}`;
        item.addEventListener('click', () => { closeMenu(); action(); });
        menu.appendChild(item);
      });

      document.body.appendChild(menu);

      const mw = menu.offsetWidth, mh = menu.offsetHeight;
      menu.style.left = `${Math.min(cx, window.innerWidth  - mw - 4)}px`;
      menu.style.top  = `${Math.min(cy, window.innerHeight - mh - 4)}px`;
    });

    document.addEventListener('mousedown', (e) => { if (menu && !menu.contains(e.target)) closeMenu(); });
    document.addEventListener('keydown',   (e) => { if (e.key === 'Escape') closeMenu(); });
  })();

  // ── "New Toolkit" button ───────────────────────────────────────────────────
  document.getElementById('newToolkitBtn')?.addEventListener('click', () => {
    const id = ++toolkitIdCounter;
    const win = createToolkit(id);
    const desk = document.getElementById('desktop');
    const dw = desk.offsetWidth, dh = desk.offsetHeight;
    const offset = ((id - 1) % 6) * 28;
    const w = Math.round(dw * 0.13), h = Math.round(dh * 0.7);
    const x = Math.min(offset + 30, dw - w - 10);
    const y = Math.min(offset + 30, dh - h - 44);
    win.style.cssText += `;left:${x}px;top:${y}px;width:${w}px;height:${h}px;display:flex;`;
  });

  // ── "Run All" button ──────────────────────────────────────────────────────
  document.getElementById('runAllBtn')?.addEventListener('click', () => {
    window.__ar_instances.forEach(inst => inst.execute());
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
    const dw = desk.offsetWidth, dh = desk.offsetHeight;
    window.wm.spawn('Visualizer', {
      type: 'viz', w: 400, h: 240,
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
    const dw = desk.offsetWidth, dh = desk.offsetHeight;
    const offset = (_vizCount++ % 6) * 24;
    new Drumpad({
      title: 'Drum Pad', w: 500, h: 360,
      x: Math.round((dw - 500) / 2) + offset,
      y: Math.round((dh - 360) / 2) + offset,
    });
  });

  // ── "New Piano" button ────────────────────────────────────────────────────
  document.getElementById('newPianoBtn')?.addEventListener('click', () => {
    const desk = document.getElementById('desktop');
    const dw = desk.offsetWidth, dh = desk.offsetHeight;
    const offset = (_vizCount++ % 6) * 24;
    new Piano({
      title: 'Piano', w: 560, h: 420,
      x: Math.round((dw - 560) / 2) + offset,
      y: Math.round((dh - 420) / 2) + offset,
    });
  });

  // ── "New Paint" button ────────────────────────────────────────────────────
  document.getElementById('newPaintBtn')?.addEventListener('click', () => {
    const desk = document.getElementById('desktop');
    const dw = desk.offsetWidth, dh = desk.offsetHeight;
    const offset = (_vizCount++ % 6) * 24;
    const ed = new Paint({ width: 400, height: 300, title: 'Paint' });
    if (ed._winId) {
      const win = document.getElementById(ed._winId);
      if (win) {
        const ww = parseInt(win.style.width)  || 404;
        const wh = parseInt(win.style.height) || 520;
        win.style.left = Math.round((dw - ww) / 2) + offset + 'px';
        win.style.top  = Math.round((dh - wh) / 2) + offset + 'px';
      }
    }
  });

  // ── "New ASCII Editor" button ─────────────────────────────────────────────
  document.getElementById('newAsciiEditorBtn')?.addEventListener('click', () => {
    const desk = document.getElementById('desktop');
    const dw = desk.offsetWidth, dh = desk.offsetHeight;
    const offset = (_vizCount++ % 6) * 24;
    const ed = new AsciiEditor({ cols: 64, rows: 24, title: 'ASCII Editor' });
    if (ed._winId) {
      const win = document.getElementById(ed._winId);
      if (win) {
        const ww = parseInt(win.style.width)  || 648;
        const wh = parseInt(win.style.height) || 580;
        win.style.left = Math.round((dw - ww) / 2) + offset + 'px';
        win.style.top  = Math.round((dh - wh) / 2) + offset + 'px';
      }
    }
  });

  // ── "New Sprite Editor" button ────────────────────────────────────────────
  document.getElementById('newSpriteEditorBtn')?.addEventListener('click', () => {
    const desk = document.getElementById('desktop');
    const dw = desk.offsetWidth, dh = desk.offsetHeight;
    const offset = (_vizCount++ % 6) * 24;
    const ed = new SpriteEditor({ width: 16, height: 16, scale: 20, title: 'Pixel Art' });
    // center the window after the wm spawn placed it
    if (ed._winId) {
      const win = document.getElementById(ed._winId);
      if (win) {
        const ww = parseInt(win.style.width) || 344;
        const wh = parseInt(win.style.height) || 520;
        win.style.left = Math.round((dw - ww) / 2) + offset + 'px';
        win.style.top  = Math.round((dh - wh) / 2) + offset + 'px';
      }
    }
  });

  // ── "New Sensor Monitor" button (dropdown) ─────────────────────────────────
  (() => {
    const btn  = document.getElementById('newSensorBtn');
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
      const titles = { motion: 'Motion Sensor', gamepad: 'Gamepad', geo: 'Geolocation', battery: 'Battery' };
      const desk = document.getElementById('desktop');
      const dw = desk.offsetWidth, dh = desk.offsetHeight;
      const offset = (_vizCount++ % 8) * 24;
      window.wm.spawn(titles[source] ?? 'Sensor', {
        type: 'sensor', source,
        w: 280, h: 300,
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
        const visible = [...drop.querySelectorAll('li[data-source]')].filter(l => l.style.display !== 'none');
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

  // ── "Demo Gallery" button ──────────────────────────────────────────────────
  (() => {
    const galleryBtn   = document.getElementById('galleryBtn');
    const galleryModal = document.getElementById('galleryModal');
    const galleryGrid  = document.getElementById('galleryGrid');
    const galleryClose = document.getElementById('galleryCloseBtn');
    if (!galleryBtn || !galleryModal) return;

    let _demosLoaded = false;

    async function _loadGallery() {
      if (_demosLoaded) return;
      _demosLoaded = true;
      try {
        const res  = await fetch('/createos/demos/index.json');
        const list = await res.json();
        galleryGrid.innerHTML = '';
        for (const demo of list) {
          const card = document.createElement('div');
          card.className = 'gallery-card';
          const tags = (demo.tags ?? []).map(t => `<span class="gallery-tag">${t}</span>`).join('');
          card.innerHTML = `
            <h3 class="gallery-card-title">${demo.title}</h3>
            <p class="gallery-card-desc">${demo.desc}</p>
            <div class="gallery-card-tags">${tags}</div>
            <button class="gallery-load-btn" data-file="${demo.file}">
              <i class="fa-solid fa-play" style="font-size:9px;margin-right:4px;"></i>Load Demo
            </button>`;
          galleryGrid.appendChild(card);
        }
      } catch (err) {
        galleryGrid.innerHTML = `<p style="color:#f38ba8;font-family:Arial;padding:12px;">Failed to load demos: ${err.message}</p>`;
      }
    }

    galleryGrid.addEventListener('click', async (e) => {
      const btn = e.target.closest('.gallery-load-btn');
      if (!btn) return;
      const file = btn.dataset.file;
      btn.textContent = 'Loading…';
      btn.disabled = true;
      try {
        const res  = await fetch(`/createos/demos/${file}`);
        const data = await res.json();
        galleryModal.close();
        await applyProject(data, window.wm, window.__ar_instances, appAPI);
      } catch (err) {
        btn.textContent = 'Error — try again';
        btn.disabled = false;
        console.error('Gallery load failed:', err);
      }
    });

    galleryBtn.addEventListener('click', async () => {
      await _loadGallery();
      galleryModal.showModal();
    });

    galleryClose.addEventListener('click', () => galleryModal.close());
    galleryModal.addEventListener('click', (e) => { if (e.target === galleryModal) galleryModal.close(); });
  })();

  // Camera / mic toolbar icons — spawn a viz window on click (ADR 023).
  // No toggle semantics; streams are demand-driven via media-lease.js.

  const _spawnMicViz = () => {
    const desk = document.getElementById('desktop');
    const dw = desk.offsetWidth, dh = desk.offsetHeight;
    const offset = (_vizCount++ % 8) * 24;
    window.wm.spawn('Mic Visualizer', {
      type: 'viz', source: 'mic', style: 'bars',
      w: 400, h: 180,
      x: Math.round((dw - 400) / 2) + offset,
      y: Math.round((dh - 180) / 2) + offset,
    });
  };

  const _spawnCamWin = () => {
    const desk = document.getElementById('desktop');
    const dw = desk.offsetWidth, dh = desk.offsetHeight;
    const offset = (_vizCount++ % 8) * 24;
    window.wm.spawn('Camera', {
      type: 'camera',
      w: 320, h: 240,
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
    let _cameraLive = 0, _micLive = 0;
    const camBtn = document.getElementById('cameraToggle');
    const micBtn = document.getElementById('micToggle');
    subscribe('camera:open',  () => { _cameraLive++; camBtn?.classList.toggle('media-live', _cameraLive > 0); });
    subscribe('camera:close', () => { _cameraLive = Math.max(0, _cameraLive - 1); camBtn?.classList.toggle('media-live', _cameraLive > 0); });
    subscribe('mic:open',     () => { _micLive++;    micBtn?.classList.toggle('media-live', _micLive > 0); });
    subscribe('mic:close',    () => { _micLive = Math.max(0, _micLive - 1);    micBtn?.classList.toggle('media-live', _micLive > 0); });
  }

  // ── Files button ──────────────────────────────────────────────────────────
  const filesBtn = document.getElementById('filesBtn');
  const imageExts = new Set(['jpg','jpeg','png','gif','webp','svg','bmp','ico']);
  const videoExts = new Set(['mp4','webm','mov','avi','mkv']);
  const audioExts = new Set(['mp3','wav','ogg','flac','aac','m4a']);
  let _fileBrowseCount = 0;
  filesBtn?.addEventListener('click', async () => {
    const offset = (_fileBrowseCount++ % 8) * 24;
    const desk = document.getElementById('desktop');
    const x = 20 + offset, y = 20 + offset;
    try {
      await window.wm.browse('__nav_files__', (url, name) => {
        const ext = name.split('.').pop().toLowerCase();
        if (imageExts.has(ext)) window.wm.spawn(name, { type: 'image', src: url, w: 480, h: 360 });
        else if (videoExts.has(ext)) window.wm.spawn(name, { type: 'video', src: url, w: 640, h: 480 });
        else if (audioExts.has(ext)) {
          const a = new Audio(url); a.controls = true;
          const winId = window.wm.spawn(name, { type: 'html', html: '', w: 320, h: 60 });
          const body = document.getElementById(winId)?.querySelector('.wm-body');
          if (body) { body.style.cssText += 'align-items:center;padding:4px 8px;'; body.appendChild(a); a.play(); }
        }
      }, { x, y });
    } catch (_) {}
  });

  // ── Help modal ────────────────────────────────────────────────────────────
  const helpOverlay = document.getElementById("help-overlay");
  const helpBtn     = document.getElementById("helpBtn");
  const helpClose   = document.getElementById("help-close");
  const toggleHelp  = () => {
    const open = helpOverlay.style.display !== "none";
    helpOverlay.style.display = open ? "none" : "block";
    helpBtn?.classList.toggle("active", !open);
  };
  helpBtn?.addEventListener("click", toggleHelp);
  helpClose?.addEventListener("click", () => { helpOverlay.style.display = "none"; helpBtn?.classList.remove("active"); });
  helpOverlay?.addEventListener("click", (e) => { if (e.target === helpOverlay) { helpOverlay.style.display = "none"; helpBtn?.classList.remove("active"); } });
  document.addEventListener("keydown", (e) => {
    if (e.key === "?" && !e.ctrlKey && !e.metaKey && !["INPUT","TEXTAREA"].includes(document.activeElement?.tagName) && !document.activeElement?.classList.contains("CodeMirror-code")) toggleHelp();
    if (e.key === "Escape" && helpOverlay?.style.display !== "none") { helpOverlay.style.display = "none"; helpBtn?.classList.remove("active"); }
  });

  // ── Project save / load ───────────────────────────────────────────────────
  const appAPI = {
    createEditor,
    createToolkit,
    nextToolkitId: () => ++toolkitIdCounter,
    updateManifest: (ids) => EditorInstance.saveManifest(ids),
  };

  initProjectManager({
    appAPI,
    getWm:        () => window.wm,
    getInstances: () => window.__ar_instances,
  });

  document.getElementById('saveProjectBtn')?.addEventListener('click', () =>
    saveProject(window.wm, window.__ar_instances));

  document.getElementById('shareProjectBtn')?.addEventListener('click', () => {
    const data = serializeProject(window.wm, window.__ar_instances);
    const b64  = btoa(encodeURIComponent(JSON.stringify(data)));
    const url  = `${location.origin}${location.pathname}?embed=1&project=${b64}`;
    navigator.clipboard?.writeText(url).then(() => {
      const btn = document.getElementById('shareProjectBtn');
      if (btn) { btn.style.color = '#4f4'; _nativeSetTimeout(() => { btn.style.color = ''; }, 1500); }
    }).catch(() => { prompt('Copy embed URL:', url); });
  });

  document.getElementById('loadProjectBtn')?.addEventListener('click', () =>
    loadProject(window.wm, window.__ar_instances, appAPI));

  // ── Projects toolbar dropdown ──────────────────────────────────────────────
  (() => {
    const btn  = document.getElementById('projectsBtn');
    const drop = document.getElementById('projectsDropdown');
    if (!btn || !drop) return;

    const render = () => {
      drop.innerHTML = '';
      const pm       = window.__ar_projectManager;
      if (!pm) return;
      const activeId   = pm.getActiveProjectId();
      const activeName = pm.getActiveProjectName();
      const projects   = window.__ar_projectCache ?? [];

      const addItem = (label, fn, extra = '') => {
        const li = document.createElement('li');
        li.textContent = label;
        if (extra) li.style.cssText = extra;
        li.addEventListener('click', e => { e.stopPropagation(); drop.classList.remove('open'); fn(); });
        drop.appendChild(li);
      };
      const addSep = () => {
        const li = document.createElement('li');
        li.style.cssText = 'pointer-events:none;padding:2px 0;border-top:1px solid #dde;margin:2px 0;';
        drop.appendChild(li);
      };

      // Current project header
      const hdr = document.createElement('li');
      hdr.style.cssText = 'font-size:10px;color:#888;letter-spacing:0.5px;text-transform:uppercase;padding:6px 14px 2px;pointer-events:none;';
      hdr.textContent = 'Projects';
      drop.appendChild(hdr);

      for (const p of projects) {
        const isActive = p.id === activeId;
        addItem((isActive ? '▶ ' : '  ') + p.name, () => {
          if (!isActive) pm.switchProject(p.id);
        }, isActive ? 'font-weight:600;color:#3a5fe0;' : '');
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
        addItem('Delete "' + activeName + '"…', async () => {
          if (!confirm(`Delete project "${activeName}"? Cannot be undone.`)) return;
          pm.deleteProject(activeId);
        }, 'color:#c0392b;');
      }
    };

    window.__ar_projectDropdownRefresh = render;

    btn.addEventListener('click', e => {
      e.stopPropagation();
      if (!drop.classList.contains('open')) render();
      drop.classList.toggle('open');
    });

    document.addEventListener('click', e => {
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
    fullscreenBtn?.querySelector('i')?.setAttribute('class', fs ? 'fa-solid fa-compress' : 'fa-solid fa-expand');
    fullscreenBtn?.classList.toggle('active', fs);
  };
  fullscreenBtn?.addEventListener('click', () => {
    document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
  });
  document.addEventListener('fullscreenchange', _updateFsIcon);
  document.addEventListener('keydown', e => {
    if (e.key === 'F11') { e.preventDefault(); document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen(); }
  });

  // ── Global error fallback ─────────────────────────────────────────────────
  window.onerror = () => {
    window.__ar_instances?.forEach(inst => {
      if (inst.btnState === 'running' || inst.btnState === 'paused') inst._setStopped();
    });
    return false;
  };
  window.onunhandledrejection = () => {
    window.__ar_instances?.forEach(inst => {
      if (inst.btnState === 'running' || inst.btnState === 'paused') inst._setStopped();
    });
  };
};
