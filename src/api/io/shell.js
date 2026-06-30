// shell.js — Electron/Tauri desktop shell detection + API
// #36: window.shell exposes isDesktop, platform, and native bridge calls
// Works in browser too — all methods are safe no-ops when running as static site.
// Electron sets window.__ELECTRON__ in its preload; Tauri sets window.__TAURI__.

const _isElectron = !!(
  typeof window !== 'undefined' &&
  (window.__ELECTRON__ || (typeof process !== 'undefined' && process.versions?.electron))
);

const _isTauri = !!(typeof window !== 'undefined' && window.__TAURI__);

const _isDesktop = _isElectron || _isTauri;

// ── Status-bar integration ────────────────────────────────────────────────────
// In browser: nothing visible (static-site safe).
// In Electron: preload sets window.__ELECTRON__.statusBar = { set(text), clear() }
// In Tauri: invoke('set_status', { text }) via __TAURI__.invoke

function _setStatusBar(text) {
  if (_isElectron && window.__ELECTRON__?.statusBar) {
    window.__ELECTRON__.statusBar.set(text);
  } else if (_isTauri && window.__TAURI__?.invoke) {
    window.__TAURI__.invoke('set_status', { text }).catch(() => {});
  }
  // browser: no-op
}

function _clearStatusBar() {
  if (_isElectron && window.__ELECTRON__?.statusBar) {
    window.__ELECTRON__.statusBar.clear();
  } else if (_isTauri && window.__TAURI__?.invoke) {
    window.__TAURI__.invoke('set_status', { text: '' }).catch(() => {});
  }
}

// ── File system access ────────────────────────────────────────────────────────
// Desktop shells can bypass CORS / open paths directly.
// Browser: falls back to File System Access API (wm.pickFile already does this).

async function _openFile(opts = {}) {
  if (_isElectron && window.__ELECTRON__?.openFile) {
    return window.__ELECTRON__.openFile(opts);
  }
  if (_isTauri && window.__TAURI__?.dialog) {
    return window.__TAURI__.dialog.open(opts);
  }
  // Browser fallback — return null (caller should use wm.pickFile)
  return null;
}

async function _saveFile(data, opts = {}) {
  if (_isElectron && window.__ELECTRON__?.saveFile) {
    return window.__ELECTRON__.saveFile(data, opts);
  }
  if (_isTauri && window.__TAURI__?.fs) {
    const path = await window.__TAURI__.dialog.save(opts);
    if (path) await window.__TAURI__.fs.writeBinaryFile(path, data);
    return path;
  }
  // Browser fallback — trigger download
  const blob = new Blob([data]);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = opts.defaultPath?.split(/[\\/]/).pop() ?? 'export';
  a.click();
  return null;
}

// ── Window management (native) ────────────────────────────────────────────────
// Desktop shells can go fullscreen, set title, minimize, etc.

function _setTitle(text) {
  if (_isElectron && window.__ELECTRON__?.setTitle) {
    window.__ELECTRON__.setTitle(text);
  } else if (_isTauri && window.__TAURI__?.window) {
    window.__TAURI__.window.appWindow?.setTitle(text).catch(() => {});
  } else {
    document.title = text;
  }
}

function _fullscreen(on = true) {
  if (_isElectron && window.__ELECTRON__?.setFullscreen) {
    window.__ELECTRON__.setFullscreen(on);
  } else if (_isTauri && window.__TAURI__?.window) {
    window.__TAURI__.window.appWindow?.setFullscreen(on).catch(() => {});
  } else {
    if (on) document.documentElement.requestFullscreen?.();
    else document.exitFullscreen?.();
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export const shell = {
  // Environment detection
  get isDesktop() {
    return _isDesktop;
  },
  get isElectron() {
    return _isElectron;
  },
  get isTauri() {
    return _isTauri;
  },
  get isBrowser() {
    return !_isDesktop;
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

  // Low-level native invoke (Tauri only; no-op elsewhere)
  invoke(cmd, args = {}) {
    if (_isTauri && window.__TAURI__?.invoke) {
      return window.__TAURI__.invoke(cmd, args);
    }
    return Promise.resolve(null);
  },
};
