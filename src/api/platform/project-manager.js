import { serializeProject, applyProject } from './project.js';
import { PROJECTS_DB, ACTIVE_PROJECT, ACTIVE_PROJECT_NAME } from '../../runtime/storage-keys.js';

// project-manager.js — named in-browser projects backed by IDB.
// Each project = { id, name, createdAt, updatedAt, data: serializeProject() output }.
// Active project pointer: localStorage['vl-active-project'].
// On first load with no saved projects, current desktop state → "Default".

const _IDB_NAME = PROJECTS_DB;
const _IDB_STORE = 'projects';
const _ACTIVE_KEY = ACTIVE_PROJECT;
const _NAME_KEY = ACTIVE_PROJECT_NAME;

let _appAPI = null;
let _getWm = null;
let _getInstances = null;

// ── IDB helpers ───────────────────────────────────────────────────────────────

function _openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(_IDB_NAME, 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(_IDB_STORE))
        db.createObjectStore(_IDB_STORE, { keyPath: 'id' });
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

async function _getAll() {
  const db = await _openDB();
  return new Promise((res, rej) => {
    const req = db.transaction(_IDB_STORE).objectStore(_IDB_STORE).getAll();
    req.onsuccess = () => {
      db.close();
      res(req.result ?? []);
    };
    req.onerror = () => {
      db.close();
      rej(req.error);
    };
  });
}

async function _get(id) {
  const db = await _openDB();
  return new Promise((res, rej) => {
    const req = db.transaction(_IDB_STORE).objectStore(_IDB_STORE).get(id);
    req.onsuccess = () => {
      db.close();
      res(req.result ?? null);
    };
    req.onerror = () => {
      db.close();
      rej(req.error);
    };
  });
}

async function _put(proj) {
  const db = await _openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(_IDB_STORE, 'readwrite');
    tx.objectStore(_IDB_STORE).put(proj);
    tx.oncomplete = () => {
      db.close();
      res();
    };
    tx.onerror = () => {
      db.close();
      rej(tx.error);
    };
  });
}

async function _del(id) {
  const db = await _openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(_IDB_STORE, 'readwrite');
    tx.objectStore(_IDB_STORE).delete(id);
    tx.oncomplete = () => {
      db.close();
      res();
    };
    tx.onerror = () => {
      db.close();
      rej(tx.error);
    };
  });
}

function _uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ── Cache (synchronous reads for context menus) ───────────────────────────────

function _refreshCache(all) {
  window.__ar_projectCache = all
    .map(({ id, name, updatedAt }) => ({ id, name, updatedAt }))
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  window.__ar_projectDropdownRefresh?.();
}

async function _syncCache() {
  _refreshCache(await _getAll());
}

// ── Public API ────────────────────────────────────────────────────────────────

export function getActiveProjectId() {
  return localStorage.getItem(_ACTIVE_KEY) ?? null;
}

export function getActiveProjectName() {
  return localStorage.getItem(_NAME_KEY) ?? 'Default';
}

export async function listProjects() {
  const all = await _getAll();
  return all
    .map(({ id, name, updatedAt }) => ({ id, name, updatedAt }))
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

export async function saveCurrentProject() {
  const id = getActiveProjectId();
  if (!id) return;
  const data = serializeProject(_getWm(), _getInstances());
  const existing = await _get(id);
  const proj = {
    id,
    name: existing?.name ?? getActiveProjectName(),
    createdAt: existing?.createdAt ?? Date.now(),
    updatedAt: Date.now(),
    data,
  };
  await _put(proj);
  await _syncCache();
}

export async function createProject(name = 'New Project') {
  const id = _uid();
  await _put({
    id,
    name,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    data: { version: 1, windows: [], desktop: [] },
  });
  await _syncCache();
  return id;
}

export async function switchProject(id) {
  await saveCurrentProject();
  const proj = await _get(id);
  if (!proj) return;
  localStorage.setItem(_ACTIVE_KEY, id);
  localStorage.setItem(_NAME_KEY, proj.name);
  await applyProject(proj.data, _getWm(), _getInstances(), _appAPI);
  await _syncCache();
}

export async function deleteProject(id) {
  await _del(id);
  const activeId = getActiveProjectId();
  if (activeId === id) {
    const rest = (await _getAll()).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
    if (rest.length > 0) {
      await switchProject(rest[0].id);
    } else {
      const newId = await createProject('Default');
      localStorage.setItem(_ACTIVE_KEY, newId);
      localStorage.setItem(_NAME_KEY, 'Default');
    }
  }
  await _syncCache();
}

export async function renameProject(id, name) {
  const proj = await _get(id);
  if (!proj) return;
  proj.name = name;
  proj.updatedAt = Date.now();
  await _put(proj);
  if (id === getActiveProjectId()) localStorage.setItem(_NAME_KEY, name);
  await _syncCache();
}

// ── Move / copy icons across projects ─────────────────────────────────────────

export async function moveIconToProject(iconId, targetProjectId, copy = false) {
  const data = window.__ar_getIconSerializedData?.(iconId);
  if (!data || data.type === 'editor') return;

  const proj = await _get(targetProjectId);
  if (!proj) return;
  proj.data.desktop = proj.data.desktop ?? [];
  proj.data.desktop.push(data);
  proj.updatedAt = Date.now();
  await _put(proj);

  if (!copy) window.__ar_removeIconById?.(iconId);

  await saveCurrentProject();
  await _syncCache();
}

export async function moveEditorToProject(editorId, targetProjectId, copy = false) {
  const inst = _getInstances()?.get(editorId);
  if (!inst) return;

  const win = document.getElementById(inst.editorWinId);
  const editorEntry = {
    type: 'editor',
    title: win?.querySelector('.wm-title')?.textContent?.trim() ?? inst.title ?? 'Editor',
    x: parseInt(win?.style.left) || 0,
    y: parseInt(win?.style.top) || 0,
    w: parseInt(win?.style.width) || 320,
    h: parseInt(win?.style.height) || 240,
    visible: win?.style.display !== 'none',
    audio: { muted: false, volume: 1 },
    ...inst.serialize(),
    executionState: 'idle', // a moved editor lands idle regardless of live state
  };

  const proj = await _get(targetProjectId);
  if (!proj) return;
  proj.data.windows = proj.data.windows ?? [];
  // Assign a non-colliding editorId in the target project
  const maxId = Math.max(
    0,
    ...proj.data.windows.filter((w) => w.type === 'editor').map((w) => w.editorId ?? 0),
  );
  editorEntry.editorId = maxId + 1;
  proj.data.windows.push(editorEntry);
  proj.updatedAt = Date.now();
  await _put(proj);

  if (!copy) inst.destroy();

  await saveCurrentProject();
  await _syncCache();
}

// ── Init ──────────────────────────────────────────────────────────────────────

export async function initProjectManager({ appAPI, getWm, getInstances }) {
  _appAPI = appAPI;
  _getWm = getWm;
  _getInstances = getInstances;

  // Register globally so desktop-files.js can call without circular import
  window.__ar_projectManager = {
    listProjects,
    saveCurrentProject,
    createProject,
    switchProject,
    deleteProject,
    renameProject,
    moveIconToProject,
    moveEditorToProject,
    getActiveProjectId,
    getActiveProjectName,
  };

  const all = await _getAll();
  if (all.length === 0) {
    // First load — snapshot current state into "Default"
    const id = _uid();
    const data = serializeProject(_getWm(), _getInstances());
    await _put({ id, name: 'Default', createdAt: Date.now(), updatedAt: Date.now(), data });
    localStorage.setItem(_ACTIVE_KEY, id);
    localStorage.setItem(_NAME_KEY, 'Default');
    _refreshCache([{ id, name: 'Default', updatedAt: Date.now() }]);
  } else {
    const activeId = localStorage.getItem(_ACTIVE_KEY);
    if (!activeId || !all.find((p) => p.id === activeId)) {
      const sorted = [...all].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
      localStorage.setItem(_ACTIVE_KEY, sorted[0].id);
      localStorage.setItem(_NAME_KEY, sorted[0].name);
    }
    _refreshCache(all);
  }
}
