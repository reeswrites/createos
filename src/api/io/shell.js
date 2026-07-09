// shell.js — desktop shell detection + API (ADR 048/049).
// #36: window.shell exposes isDesktop, platform, and native bridge calls.
// Works in browser too — every method is a safe no-op / browser fallback when running
// as a static site.
//
// The native seam is `nativeCap(name)` from src/runtime/native.js (ADR 049): in the
// Electron build it resolves the preload bridge fn by name; in the browser build it
// returns null and the call site uses its DOM fallback. Each verb below is
// nativeCap-or-browser — one branch, no per-shell dispatch. Tauri was never built
// (ADR 048 chose Electron), so there are no Tauri arms.

import { nativeCap, hasNative } from '../../runtime/native.js';

// ── Status-bar integration ────────────────────────────────────────────────────
// No native cap exposes a status bar; browser only (no-op). If one is ever added to
// the preload bridge, route status()/clearStatus() through nativeCap('setStatusBar').

function _setStatusBar(_text) {
  // no native cap; browser only (no visible status bar in a static site)
}

function _clearStatusBar() {
  // no native cap; browser only
}

// ── File system access ────────────────────────────────────────────────────────
// Native picker (Electron) bypasses CORS / opens paths directly; browser falls back
// to the File System Access API path used by wm.pickFile (returns null here).

async function _openFile(opts = {}) {
  const pick = nativeCap('pickFile');
  if (pick) return pick(opts);
  // Browser fallback — return null (caller should use wm.pickFile)
  return null;
}

async function _saveFile(data, opts = {}) {
  const save = nativeCap('saveFile');
  if (save) return save({ ...opts, data });
  // Browser fallback — trigger download
  const blob = new Blob([data]);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = opts.defaultPath?.split(/[\\/]/).pop() ?? 'export';
  a.click();
  return null;
}

// ── Window management ──────────────────────────────────────────────────────────
// No native cap exposes window title / fullscreen; browser only.

function _setTitle(text) {
  // no native cap; browser only
  document.title = text;
}

function _fullscreen(on = true) {
  // no native cap; browser only
  if (on) document.documentElement.requestFullscreen?.();
  else document.exitFullscreen?.();
}

// ── Public API ────────────────────────────────────────────────────────────────

export const shell = {
  // Environment detection
  get isDesktop() {
    return hasNative();
  },
  get isElectron() {
    return hasNative();
  },
  get isTauri() {
    return false; // Tauri never built (ADR 048); kept for interface compat
  },
  get isBrowser() {
    return !hasNative();
  },

  // Status bar (visible in desktop shell titlebar area; no-op in browser)
  status(text) {
    _setStatusBar(String(text));
    return shell;
  },
  clearStatus() {
    _clearStatusBar();
    return shell;
  },

  // File system
  openFile: _openFile,
  saveFile: _saveFile,

  // Native window
  setTitle(text) {
    _setTitle(String(text));
    return shell;
  },
  fullscreen(on = true) {
    _fullscreen(on);
    return shell;
  },

  // Low-level native invoke — no generic invoke cap is exposed; always a no-op stub
  // (kept for interface compat).
  invoke(_cmd, _args = {}) {
    return Promise.resolve(null);
  },
};
