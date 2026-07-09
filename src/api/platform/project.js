import { serializeDesktop, restoreDesktop } from './desktop-files.js';
import { serializeMixer, restoreMixer } from '../audio/mixer.js';
import { getWindowAdapter, geoOf, titleOf, readAudio, applyGeo } from '../wm/window-registry.js';
import { nativeCap } from '../../runtime/native.js';

// ── Serialize ─────────────────────────────────────────────────────────────────
// Editor windows are serialized inline (they need the editor `instances`); every
// other window type defers to its registered Window Type Adapter via the handle's
// serialize() — no per-type switch here. See CONTEXT.md "Window Type Adapter".

export function serializeProject(wm, instances) {
  const windows = [];

  document.querySelectorAll('.wm-win').forEach((win) => {
    if (win._wmIsEditor) {
      const editorId = parseInt(win.id.replace('win-editor-', ''));
      const inst = instances.get(editorId);
      if (!inst) return;
      windows.push({
        type: 'editor',
        editorId,
        title: titleOf(win, 'Editor'),
        ...geoOf(win),
        audio: readAudio(win),
        ...inst.serialize(),
      });
      return;
    }

    const record = wm.window(win.id)?.serialize();
    if (record) windows.push(record);
  });

  return {
    version: 1,
    windows,
    desktop: serializeDesktop({ forProject: true }),
    mixer: serializeMixer(),
  };
}

// ── Deserialize ───────────────────────────────────────────────────────────────

export async function applyProject(data, wm, instances, appAPI) {
  if (!data?.windows) return;

  wm.closeAll();
  // Restore desktop positions before editors are created — addEditorIcon picks them up.
  restoreDesktop(data.desktop ?? []);
  restoreMixer(data.mixer);

  const editorEntries = data.windows.filter((w) => w.type === 'editor');
  const editorIds = [];

  for (const w of editorEntries) {
    const inst = appAPI.createEditor(w.editorId);
    editorIds.push(w.editorId);

    inst.applyRecord(w);

    applyGeo(document.getElementById(inst.editorWinId), w);
  }

  appAPI.updateManifest(editorIds);

  // ADR 040: legacy `type:'output'` windows are ignored on load — there is no
  // editor output window; a project's `new Canvas()` code spawns its own.

  // Other windows — each type's restore lives in its Window Type Adapter.
  const restoreCtx = { wm, appAPI, applyGeo };
  for (const w of data.windows) {
    if (w.type === 'editor' || w.type === 'output') continue;
    getWindowAdapter(w.type)?.restore?.(w, restoreCtx);
  }

  // Execution states — after all windows exist
  for (const w of editorEntries) {
    instances.get(w.editorId)?.restoreExecutionState(w.executionState);
  }

  // Toolbar state: mic/camera no longer serialized; streams are demand-driven (ADR 023).
}

// ── File I/O ──────────────────────────────────────────────────────────────────

export async function saveProject(wm, instances) {
  const data = serializeProject(wm, instances);
  const json = JSON.stringify(data, null, 2);

  const nativeSave = nativeCap('saveFile');
  if (nativeSave) {
    const res = await nativeSave({
      defaultPath: 'project.vljson',
      data: json,
      filters: [{ name: 'VL Project', extensions: ['vljson', 'json'] }],
    });
    // Saving locally makes it yours → authored/trusted (ADR 050).
    if (res) nativeCap('setProjectProvenance')?.('authored');
    return;
  }

  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: 'project.vljson',
        types: [
          { description: 'VL Project', accept: { 'application/json': ['.vljson', '.json'] } },
        ],
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
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'project.vljson';
  a.click();
  URL.revokeObjectURL(url);
}

export async function loadProject(wm, instances, appAPI) {
  let json;

  const nativeOpen = nativeCap('openProjectFile');
  if (nativeOpen) {
    // Ungated combined dialog+read — File>Open is the user gesture (ADR 050).
    const res = await nativeOpen({
      filters: [{ name: 'VL Project', extensions: ['vljson', 'json'] }],
    });
    if (!res) return; // cancelled
    json = res.text;
  } else if (window.showOpenFilePicker) {
    try {
      const [handle] = await window.showOpenFilePicker({
        types: [
          { description: 'VL Project', accept: { 'application/json': ['.vljson', '.json'] } },
        ],
      });
      json = await (await handle.getFile()).text();
    } catch (e) {
      if (e.name === 'AbortError') return;
      console.warn('showOpenFilePicker failed, falling back to input:', e);
    }
  }

  if (!json && !nativeOpen) {
    json = await new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.vljson,.json';
      input.onchange = async () => {
        const file = input.files?.[0];
        resolve(file ? await file.text() : null);
      };
      input.click();
    });
  }

  if (!json) return;

  let data;
  try {
    data = JSON.parse(json);
  } catch (e) {
    console.error('Invalid project file:', e);
    return;
  }
  await applyProject(data, wm, instances, appAPI);
  // Opened from disk → treat as imported: untrusted until the user grants native access
  // once (ADR 050). No-op in the browser build.
  nativeCap('setProjectProvenance')?.('imported');
}
