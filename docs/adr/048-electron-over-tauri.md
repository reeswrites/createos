# ADR 048 — Electron over Tauri for the desktop build

**Status**: Accepted — implemented (Phase 1)
**Date**: 2026-06-30

> **Implementation note (Phase 1)**: Electron shell landed. `electron/main.cjs`
> (BrowserWindow with `sandbox`/`contextIsolation` on, `nodeIntegration` off; loads the
> Vite dev URL via `ELECTRON_START_URL` or `dist/index.html` over `file://`) +
> `electron/preload.cjs` (contextBridge). CJS extensions dodge the ESM/sandboxed-preload
> friction under `"type":"module"`. Scripts: `electron:dev` (concurrently + wait-on +
> cross-env), `electron:build` (`ELECTRON=1` vite build → electron-builder). Vite `base`
> is `'./'` under `ELECTRON=1` so `file://` asset paths resolve. electron-builder targets
> dmg/nsis/AppImage. Dev deps added but the Electron binary postinstall must be approved
> in a script-gated environment before launch.

## Context

CreateOS is packaged as a desktop app so live performers get MIDI, local-disk access,
and native VJ integrations that a browser tab can't reach. The two obvious wrappers are
**Electron** (bundles its own Chromium) and **Tauri** (renders through the OS's native
webview).

The app depends on Chromium-only web APIs across its core:

- **Web MIDI** (`src/api/audio/midi.js`, ADR 033) — unsupported in Safari/WebKit.
- **File System Access API** — `showDirectoryPicker`/`showOpenFilePicker` in `wm.browse`/
  `wm.pickFile` (`src/api/wm/wm.js`) and `showSaveFilePicker` in `project.js`. Chromium-only;
  WebKit ships only the sandboxed OPFS, no local-disk pickers.
- **WebGPU** (`window.Shader`, WGSL — ADR 030/038) — already gated in the README as
  inconsistent across engines.
- **Web Speech API** (`audio.say`, `onWord`/`onSpeech` — ADR 004/026) — historically uneven
  outside Chromium.

Tauri renders through **WKWebView** (Safari) on macOS and **WebKitGTK** on Linux — so MIDI
and the directory picker would silently break, with uncertain WebGPU behaviour. Closing those
gaps means Rust-side plugins (a `midir` MIDI bridge, an fs/dialog shim) — real engineering, not
a free wrap.

## Decision

Use **Electron**. One consistent bundled Chromium on all platforms runs the existing app
essentially unmodified — MIDI, the FS Access pickers, WebGPU/WGSL, and Web Speech all keep
working with **zero API rewrites**. The Chromium engine dependency is the deciding factor; it
is baked into the whole API surface, not a peripheral concern.

## Considered options

- **Tauri** — smaller binary, lower memory, but the WebKit webview breaks the core feature set
  (MIDI, disk pickers) and would require per-platform native shims to reach parity. Rejected:
  the "lightweight wrap" saving is erased by the native-bridge work needed to restore
  Chromium-only APIs.
- **Stay browser-only** — no desktop build. Rejected as a *replacement* but retained as a
  first-class target (ADR 049): the web reach is real, so both ship.

## Consequences

- Larger install size and memory footprint than Tauri — the accepted trade for zero rewrites.
- Ships a full Chromium per app; security posture must treat the renderer accordingly
  (ADR 050).
- The engine is now pinned by us, not the OS — WebGPU/MIDI behaviour is predictable across
  platforms (Linux WebGPU still degrades to the WebGL/`GLShader` path where absent).
