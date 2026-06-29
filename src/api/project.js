import { saveWorkspaceJSON, loadWorkspaceJSON } from '../blocks/blocks.js';
import { serializeDesktop, restoreDesktop } from './desktop-files.js';
import { serializeMixer, restoreMixer } from './mixer.js';

// ── Serialize ─────────────────────────────────────────────────────────────────

function _readAudio(win) {
  const muteBtn   = win.querySelector('.wm-mute');
  const volSlider = win.querySelector('.wm-vol');
  return {
    muted:  muteBtn?.classList.contains('muted') ?? false,
    volume: volSlider ? parseFloat(volSlider.value) / 100 : 1,
  };
}

function _geo(win) {
  return {
    x: parseInt(win.style.left)   || 0,
    y: parseInt(win.style.top)    || 0,
    w: parseInt(win.style.width)  || 320,
    h: parseInt(win.style.height) || 240,
    visible:     win.style.display !== 'none',
    nochrome:    win.classList.contains('wm-no-chrome'),
    transparent: win.classList.contains('wm-transparent'),
  };
}

export function serializeProject(wm, instances) {
  const windows = [];

  document.querySelectorAll('.wm-win').forEach(win => {
    const opts = win._wmSpawnOpts;

    if (win._wmIsEditor) {
      const editorId = parseInt(win.id.replace('win-editor-', ''));
      const inst = instances.get(editorId);
      if (!inst) return;
      windows.push({
        type: 'editor',
        editorId,
        title: win.querySelector('.wm-title')?.textContent?.trim() ?? 'Editor',
        ..._geo(win),
        audio:          _readAudio(win),
        code:           inst.cm.state.doc.toString(),
        mode:           inst.blocksMode ? 'blocks' : 'text',
        blocksJson:     inst.blocksMode && inst.blocklyWorkspace
                          ? saveWorkspaceJSON(inst.blocklyWorkspace)
                          : null,
        executionState: inst.btnState,
      });
      return;
    }

    if (!opts) return;

    if (opts.type === 'canvas') {
      const editorId = parseInt(win.id.replace('win-canvas-', ''));
      if (isNaN(editorId)) return;
      windows.push({ type: 'output', editorId, ..._geo(win) });
      return;
    }

    if (opts.type === 'viz') {
      windows.push({
        type:   'visualizer',
        title:  win.querySelector('.wm-title')?.textContent?.trim() ?? 'Visualizer',
        ..._geo(win),
        source: win._vizSourceEl?.value ?? opts.source ?? 'master',
        style:  win._vizStyleEl?.value  ?? opts.style  ?? 'wave',
      });
      return;
    }

    if (win.id.startsWith('win-toolkit')) {
      windows.push({
        type:  'toolkit',
        title: win.querySelector('.wm-title')?.textContent?.trim() ?? 'API Toolbox',
        ..._geo(win),
      });
      return;
    }

    if (opts.type === 'image' || opts.type === 'video') {
      const isBlobSrc = opts.src?.startsWith('blob:');
      const entry = {
        type:  opts.type,
        title: win.querySelector('.wm-title')?.textContent?.trim() ?? opts.title,
        ..._geo(win),
        loop: opts.loop,
      };
      if (isBlobSrc) {
        const key = wm.fileKey(win.id);
        if (key) entry.fileKey = key;
      } else if (opts.src) {
        entry.src = opts.src;
      }
      if (opts.type === 'video') entry.audio = _readAudio(win);
      windows.push(entry);
      return;
    }

    if (opts.type === 'html' && opts.html !== undefined) {
      windows.push({
        type:  'html',
        title: win.querySelector('.wm-title')?.textContent?.trim() ?? opts.title ?? '',
        ..._geo(win),
        html:  opts.html ?? '',
      });
    }
  });

  return {
    version: 1,
    windows,
    desktop: serializeDesktop({ forProject: true }),
    mixer: serializeMixer(),
  };
}

// ── Deserialize ───────────────────────────────────────────────────────────────

function _applyGeo(win, w) {
  if (!win) return;
  win.style.left    = `${w.x}px`;
  win.style.top     = `${w.y}px`;
  win.style.width   = `${w.w}px`;
  win.style.height  = `${w.h}px`;
  win.style.display = w.visible ? 'flex' : 'none';
  if (w.nochrome)    win.classList.add('wm-no-chrome');
  if (w.transparent) win.classList.add('wm-transparent');
}

export async function applyProject(data, wm, instances, appAPI) {
  if (!data?.windows) return;

  wm.closeAll();
  // Restore desktop positions before editors are created — addEditorIcon picks them up.
  restoreDesktop(data.desktop ?? []);
  restoreMixer(data.mixer);

  const editorEntries = data.windows.filter(w => w.type === 'editor');
  const editorIds = [];

  for (const w of editorEntries) {
    const inst = appAPI.createEditor(w.editorId);
    editorIds.push(w.editorId);

    inst.cm.dispatch({ changes: { from: 0, to: inst.cm.state.doc.length, insert: w.code ?? '' } });
    if (w.mode === 'blocks' && w.blocksJson) inst.loadBlocksJSON(w.blocksJson);

    _applyGeo(document.getElementById(inst.editorWinId), w);
  }

  appAPI.updateManifest(editorIds);

  // ADR 040: legacy `type:'output'` windows are ignored on load — there is no
  // editor output window; a project's `new Canvas()` code spawns its own.

  // Other windows
  for (const w of data.windows) {
    if (w.type === 'editor' || w.type === 'output') continue;

    if (w.type === 'toolkit') {
      const id = appAPI.nextToolkitId();
      const win = appAPI.createToolkit(id);
      _applyGeo(win, w);
      continue;
    }

    if (w.type === 'visualizer') {
      const id = wm.spawn(w.title ?? 'Visualizer', {
        type: 'viz', source: w.source, style: w.style,
        x: w.x, y: w.y, w: w.w, h: w.h,
      });
      const win = document.getElementById(id);
      if (win && !w.visible) win.style.display = 'none';
      continue;
    }

    if (w.type === 'image' || w.type === 'video') {
      if (w.fileKey) {
        wm.restoreFileWindow({ id: w.fileKey, title: w.title, type: w.type, x: w.x, y: w.y, w: w.w, h: w.h, nochrome: w.nochrome, transparent: w.transparent });
      } else if (w.src) {
        const id = wm.spawn(w.title, { type: w.type, src: w.src, loop: w.loop, x: w.x, y: w.y, w: w.w, h: w.h });
        const win = document.getElementById(id);
        if (win && !w.visible) win.style.display = 'none';
      }
      continue;
    }

    if (w.type === 'html') {
      const id = wm.spawn(w.title ?? '', { type: 'html', html: w.html ?? '', x: w.x, y: w.y, w: w.w, h: w.h });
      const win = document.getElementById(id);
      if (win && !w.visible) win.style.display = 'none';
    }
  }

  // Execution states — after all windows exist
  for (const w of editorEntries) {
    const inst = instances.get(w.editorId);
    if (!inst) continue;
    if (w.executionState === 'running' || w.executionState === 'paused') {
      inst.execute();
      if (w.executionState === 'paused') {
        setTimeout(() => inst.pauseRunning(), 200);
      }
    }
  }

  // Toolbar state: mic/camera no longer serialized; streams are demand-driven (ADR 023).
}

// ── File I/O ──────────────────────────────────────────────────────────────────

export async function saveProject(wm, instances) {
  const data = serializeProject(wm, instances);
  const json = JSON.stringify(data, null, 2);

  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: 'project.vljson',
        types: [{ description: 'VL Project', accept: { 'application/json': ['.vljson', '.json'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(json);
      await writable.close();
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
      console.warn('showSaveFilePicker failed, falling back to download:', e);
    }
  }

  // Fallback: download
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = 'project.vljson'; a.click();
  URL.revokeObjectURL(url);
}

export async function loadProject(wm, instances, appAPI) {
  let json;

  if (window.showOpenFilePicker) {
    try {
      const [handle] = await window.showOpenFilePicker({
        types: [{ description: 'VL Project', accept: { 'application/json': ['.vljson', '.json'] } }],
      });
      json = await (await handle.getFile()).text();
    } catch (e) {
      if (e.name === 'AbortError') return;
      console.warn('showOpenFilePicker failed, falling back to input:', e);
    }
  }

  if (!json) {
    json = await new Promise(resolve => {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = '.vljson,.json';
      input.onchange = async () => {
        const file = input.files?.[0];
        resolve(file ? await file.text() : null);
      };
      input.click();
    });
  }

  if (!json) return;

  let data;
  try { data = JSON.parse(json); } catch (e) { console.error('Invalid project file:', e); return; }
  await applyProject(data, wm, instances, appAPI);
}
