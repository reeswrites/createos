# ADR 049 — Dual-target: browser and Electron both first-class

**Status**: Accepted — implemented (Phase 1 slice)
**Date**: 2026-06-30

> **Implementation note (Phase 1)**: The capability-registry seam (`src/runtime/native.js`)
> and the handle-shaped FS adapter (`src/api/wm/native-fs-adapter.js`) landed. `wm.pickFolder`,
> `wm.pickFile`, `wm.browse` (initial + "Add folder"), and `project.js` save/load
> (`showSaveFilePicker`/`showOpenFilePicker` → `native:saveFile` / `pickFile`+`readFile`) now
> prefer `nativeCap(...)` and fall back to the unchanged browser paths — dual-target proven
> end-to-end, Phase 2 fs read+write closed. The adapter quacks like
> FileSystemFileHandle/DirectoryHandle (`values()`, `getFile()`, `queryPermission→'granted'`)
> so `file-browser.js` is untouched. Global hotkeys + OSC (Phase 3 #2/#3) land the same way —
> additive bus events (`src/api/io/native-bridge.js`), no browser regression. Screen capture
> (#5) is `Source.screen` → `openScreenSource()` (`src/api/media/screen.js`) over
> `getDisplayMedia`, which works in BOTH targets (browser OS-picker; Electron auto-grants the
> primary screen via main's `setDisplayMediaRequestHandler`, provenance-gated) — a bare
> `<video>` the existing Drawable resolver already accepts.
> **Deferred**: persisting native path strings into the IDB handle store (native adapters are
> in-memory only for now — `storeWinHandle` already no-ops on non-cloneable handles).

## Context

Given the Electron desktop build (ADR 048), a keystone question gates every native feature:
does the browser-hosted app stay maintained, or does Electron become the sole product? The
answer decides whether Phase 2 can **hard-swap** browser APIs for native ones, or must keep a
**feature-detection fallback** on every native path — and how big the test matrix is.

The web build has real value the desktop build can't replicate: zero-install reach, a shareable
URL, the demo gallery, `?embed=` embedding. The desktop build has native reach the web can't:
MIDI reliability, real disk access, NDI/OSC/HID.

## Decision

**Both targets are first-class and stay fully maintained.** Every native capability is
**additive with a browser fallback** — never a hard swap that regresses the web build. The
directory picker keeps its `showDirectoryPicker` path *and* gains a native dialog; serial keeps
WebSerial (ADR 020) *and* may gain a native backend; screen capture keeps `getDisplayMedia` *and*
gains `desktopCapturer`. Nothing browser-side is removed to add a native feature.

To keep the two branches from scattering `if (window.electron)` across the codebase, native
capabilities are reached through a **single capability registry** (ADR 050) that both builds
populate — the browser build registers browser impls, Electron registers native ones, call sites
ask the registry by capability name.

The file-picker fork is resolved by a **handle-shaped adapter**: in Electron the native bridge
returns an object that quacks like a `FileSystemDirectoryHandle`/`FileSystemFileHandle`
(`.name`, `.getFile()`, async iterator, `queryPermission → 'granted'`), backed by native paths
over IPC. `wm.browse`'s live-folder-tree + persistence code (`src/api/wm/wm.js`,
`file-handle-store.js`) runs **unchanged** — only the acquisition swaps, and the IDB store
persists the native path string instead of a structured-cloned handle.

## Considered options

- **Electron primary, browser deprecated** — least code, hard-swaps allowed. Rejected: abandons
  the zero-install web reach and the embed/demo story.
- **Browser primary, Electron a superset** — additive-only, but treats desktop as secondary.
  Rejected in favour of true parity; performers are a primary audience.
- **Path-based FS model in Electron** (branch `wm.browse`) — rejected: two file-browser code
  paths vs. one adapter; the adapter reuses the most existing code.

## Consequences

- Every native feature owes a browser fallback path and both-branch coverage.
- Renderer-side branch logic is unit-testable via the registry mock in vitest (ADR 050); the
  fallback is exercised by omitting the native impl.
- The web build's `.vljson`/demo files stay portable; native-only capabilities degrade
  gracefully (a capability the browser lacks resolves to `null`, call site chooses fallback or
  no-op).
- Linux WebGPU inconsistency is handled the same way it always was — feature-detect WGSL and
  fall back to the WebGL `GLShader` path.
