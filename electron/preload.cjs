// preload.cjs — the contextBridge seam (ADR 048/050).
//
// Runs in an isolated, sandboxed context. Exposes ONLY narrow, named functions on
// `window.__createos_native` — never raw `fs`, never `ipcRenderer`. The renderer's
// capability registry (src/runtime/native.js) picks these up by name; user code reaches
// them through nativeCap(), and every one of them lands in the main process where the
// consent gate lives. Adding a capability here is a deliberate, reviewable act.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('__createos_native', {
  // Open-time consent gestures — the dialogs grant their picked path (main-side).
  pickDirectory: () => ipcRenderer.invoke('native:pickDirectory'),
  pickFile: (opts) => ipcRenderer.invoke('native:pickFile', opts),
  saveFile: (opts) => ipcRenderer.invoke('native:saveFile', opts),
  openProjectFile: (opts) => ipcRenderer.invoke('native:openProjectFile', opts),
  setProjectProvenance: (source) => ipcRenderer.invoke('native:setProjectProvenance', source),
  // Gated reads — main refuses paths outside a granted root.
  listDir: (dir) => ipcRenderer.invoke('native:listDir', dir),
  readFile: (file) => ipcRenderer.invoke('native:readFile', file),
  // OSC over UDP.
  oscListen: (port) => ipcRenderer.invoke('native:oscListen', port),
  oscClose: (port) => ipcRenderer.invoke('native:oscClose', port),
  oscSend: (msg) => ipcRenderer.invoke('native:oscSend', msg),
  // Subscribe to main-pushed events (hotkeys, incoming OSC). Returns an unsubscribe fn.
  onEvent: (name, cb) => {
    const handler = (_e, msg) => {
      if (msg && msg.name === name) cb(msg.data);
    };
    ipcRenderer.on('native-event', handler);
    return () => ipcRenderer.removeListener('native-event', handler);
  },
});
