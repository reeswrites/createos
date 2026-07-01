// main.cjs — Electron main process (ADR 048/050).
//
// CommonJS (.cjs) so it loads regardless of the repo's "type":"module", and so the
// sandboxed preload can require('electron') without ESM friction.
//
// Security posture (ADR 050): the renderer runs ARBITRARY user code in its main world,
// so it is treated as untrusted. sandbox + contextIsolation are ON and load-bearing;
// nodeIntegration is OFF; the preload exposes only narrow, named bridge functions. Every
// filesystem read is gated HERE, in main — the only place a check can't be defeated by
// the user code it is gating. The gate is a set of user-granted roots: picking a file or
// folder via the OS dialog is the open-time consent gesture, and it grants exactly that
// path subtree. listDir/readFile refuse anything outside a granted root.

const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  globalShortcut,
  desktopCapturer,
  session,
} = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const dgram = require('node:dgram');
const osc = require('./osc-codec.cjs');
const { decideAccess } = require('./trust.cjs');

let mainWindow = null;

// Push a named event to the renderer (hotkeys, incoming OSC). One channel, {name,data};
// the preload fans it out to onEvent(name) subscribers → the signal bus.
function pushEvent(name, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('native-event', { name, data });
  }
}

// ── Consent: user-granted filesystem roots (ADR 050) ───────────────────────────────
const grantedRoots = new Set();

function grantRoot(p) {
  grantedRoots.add(path.resolve(p));
}

function isGranted(target) {
  const resolved = path.resolve(target);
  for (const root of grantedRoots) {
    const rel = path.relative(root, resolved);
    // under `root` iff rel doesn't climb out (`..`) and isn't absolute (other drive)
    if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) return true;
  }
  return false;
}

function assertGranted(target) {
  if (!isGranted(target)) {
    throw new Error(`Access denied: ${target} is outside any user-granted folder`);
  }
}

// ── Provenance: per-project native-access consent (ADR 050) ─────────────────────────
// The granted-roots gate above bounds WHICH paths; this bounds WHETHER an untrusted
// project (opened from a path / a demo, not authored here) may reach native data/device
// capabilities at all. Authored projects are trusted; imported/demo prompt once.
let projectTrust = 'authored';
let nativeConsent = null; // null unasked | true | false

async function requireNativeAccess() {
  const decision = decideAccess(projectTrust, nativeConsent);
  if (decision === 'allow') return;
  if (decision === 'deny') throw new Error('Native access blocked for this project');
  // 'ask' — prompt once, cache the answer for the session.
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    buttons: ['Block', 'Allow'],
    defaultId: 0,
    cancelId: 0,
    title: 'Native access',
    message: `This ${projectTrust} project is requesting native access (files, OSC, screen capture). Allow?`,
    detail: 'Only allow projects you trust — native access can read files and reach the network.',
  });
  nativeConsent = response === 1;
  if (!nativeConsent) throw new Error('Native access blocked for this project');
}

// ── IPC handlers (invoked by preload bridge) ────────────────────────────────────────
function registerIpc() {
  // Pick a directory. The dialog itself is the consent gesture → grant the picked root.
  ipcMain.handle('native:pickDirectory', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openDirectory'],
    });
    if (canceled || !filePaths.length) return null;
    const dir = filePaths[0];
    grantRoot(dir);
    return { path: dir, name: path.basename(dir) };
  });

  // Pick a single file. Grants that file's own path (readFile of it will pass).
  ipcMain.handle('native:pickFile', async (_e, opts = {}) => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: opts.filters,
    });
    if (canceled || !filePaths.length) return null;
    const file = filePaths[0];
    grantRoot(file);
    return { path: file, name: path.basename(file) };
  });

  // Tell main the provenance of the project now loaded (renderer drives this).
  ipcMain.handle('native:setProjectProvenance', (_e, source) => {
    projectTrust = source === 'authored' || source === 'imported' || source === 'demo'
      ? source
      : 'imported';
    nativeConsent = null; // re-ask for the new project
  });

  // Open a project file: dialog + read in one user-gesture. UNGATED — the user
  // explicitly choosing File>Open IS consent to read that one file (and it must not be
  // blocked by a previously-blocked project, or you could never open a new one).
  ipcMain.handle('native:openProjectFile', async (_e, opts = {}) => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: opts.filters,
    });
    if (canceled || !filePaths.length) return null;
    const file = filePaths[0];
    grantRoot(file);
    const text = await fs.readFile(file, 'utf8');
    return { text, path: file, name: path.basename(file) };
  });

  // List a directory — gated (path AND provenance). Returns [{ name, path, kind }].
  ipcMain.handle('native:listDir', async (_e, dir) => {
    await requireNativeAccess();
    assertGranted(dir);
    const dirents = await fs.readdir(dir, { withFileTypes: true });
    return dirents.map((d) => ({
      name: d.name,
      path: path.join(dir, d.name),
      kind: d.isDirectory() ? 'directory' : 'file',
    }));
  });

  // Read a file — gated (path AND provenance). Returns { bytes, type }.
  ipcMain.handle('native:readFile', async (_e, file) => {
    await requireNativeAccess();
    assertGranted(file);
    const buf = await fs.readFile(file);
    return { bytes: new Uint8Array(buf), type: null };
  });

  // Save via native dialog. The user choosing a path IS the write consent (ADR 050);
  // grant it so a follow-up read of the same file passes. `data` is a string or bytes.
  ipcMain.handle('native:saveFile', async (_e, { defaultPath, data, filters } = {}) => {
    const { canceled, filePath } = await dialog.showSaveDialog({ defaultPath, filters });
    if (canceled || !filePath) return null;
    grantRoot(filePath);
    const payload = typeof data === 'string' ? data : Buffer.from(data);
    await fs.writeFile(filePath, payload);
    return { path: filePath, name: path.basename(filePath) };
  });

  // ── OSC over UDP (dgram) — no native addon; codec is pure JS ──────────────────────
  ipcMain.handle('native:oscListen', async (_e, port) => {
    await requireNativeAccess();
    if (oscSockets.has(port)) return { port };
    const sock = dgram.createSocket('udp4');
    sock.on('message', (msg, rinfo) => {
      try {
        const { address, args } = osc.decode(msg);
        pushEvent('osc', { address, args, from: rinfo.address, port });
      } catch (err) {
        pushEvent('osc-error', { error: String(err) });
      }
    });
    await new Promise((res, rej) => {
      sock.once('error', rej);
      sock.bind(port, res);
    });
    oscSockets.set(port, sock);
    return { port };
  });

  ipcMain.handle('native:oscClose', async (_e, port) => {
    const sock = oscSockets.get(port);
    if (sock) {
      sock.close();
      oscSockets.delete(port);
    }
  });

  ipcMain.handle('native:oscSend', async (_e, { host = '127.0.0.1', port, address, args }) => {
    await requireNativeAccess();
    const buf = osc.encode(address, args);
    const sock = _sendSock ?? (_sendSock = dgram.createSocket('udp4'));
    await new Promise((res, rej) => sock.send(buf, port, host, (err) => (err ? rej(err) : res())));
  });
}

// ── OSC socket registry ───────────────────────────────────────────────────────────
const oscSockets = new Map();
let _sendSock = null;

// ── Global hotkeys → bus (ADR: Phase 3 #3) ──────────────────────────────────────────
// Fixed performer set; each fires a `hotkey:<id>` on the renderer bus, unfocused.
const HOTKEYS = {
  'CommandOrControl+Shift+B': 'panic',
  'CommandOrControl+Shift+R': 'record',
  'CommandOrControl+Shift+Right': 'next',
  'CommandOrControl+Shift+Left': 'prev',
};

function registerHotkeys() {
  for (const [accel, id] of Object.entries(HOTKEYS)) {
    try {
      globalShortcut.register(accel, () => pushEvent('hotkey', { id, accel }));
    } catch (_) {
      /* accelerator taken by the OS — skip */
    }
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    backgroundColor: '#101014',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const devUrl = process.env.ELECTRON_START_URL;
  if (devUrl) {
    mainWindow.loadURL(devUrl);
  } else {
    // Production: the Vite build (built with base './') sits in ../dist.
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  registerIpc();
  registerHotkeys();

  // Screen capture (#5): make renderer getDisplayMedia() work under Electron by auto-
  // granting the primary screen — provenance-gated, so an untrusted project can't grab the
  // screen without consent. A per-window picker UI is future work. Browser build uses the
  // OS getDisplayMedia picker directly (this handler doesn't exist there).
  session.defaultSession.setDisplayMediaRequestHandler(
    async (_request, callback) => {
      try {
        await requireNativeAccess();
        const sources = await desktopCapturer.getSources({ types: ['screen'] });
        callback(sources.length ? { video: sources[0] } : {});
      } catch (_) {
        callback({}); // blocked → getDisplayMedia rejects in the renderer
      }
    },
    { useSystemPicker: false },
  );

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  for (const sock of oscSockets.values()) sock.close();
  oscSockets.clear();
  if (_sendSock) _sendSock.close();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
