# ADR 016 — Capture & Recording: Webcam Photo/Video + Output-Window Recording

**Status**: Accepted  
**Date**: 2026-06-26

---

## Context

createos had no way to capture output:
- The 📷 Snapshot button (paint overlay) composited a frame to PNG and called `desktop.add(url, {type:'image'})` with a bare `blob:` object URL, which `serializeDesktop` skipped (the "blob URL without content = dropped file" rule at `desktop-files.js:788`). **Snapshot icons vanished on page reload.**
- No video recording of any kind existed.
- No webcam still-capture or video existed in the programmatic API.

The user's storage question: "Should blobs go in File handles or IDB?" — answered by analysis below.

---

## Decisions

### 1. Blob persistence: IndexedDB, not localStorage

Photos and videos are binary data. localStorage:
- Is limited to ~5–10 MB
- Requires base64 encoding (33% overhead, synchronous string serialization)
- Would cap photos at ~2 MB and make video impossible

IndexedDB:
- Stores `Blob` objects natively via structured clone (no encoding overhead)
- Has quota in the GB range
- Repo already uses IDB for structured-clone data: folder handles (`vl-folder-icons`) and WM file handles (`vl-wm-handles`)

**Decision:** New IDB store `vl-captures` (object store `blobs`, out-of-line string keys = icon id). Mirror of `_openFolderDB` pattern in `desktop-files.js`.

### 2. File System Access API not used for persistence

`showSaveFilePicker` is Chromium-only and prompts the user. It is not appropriate for transparent background persistence (where we want the capture to just appear on the desktop). Reserved for explicit user-initiated "save to filesystem" which is handled by `<a download>` (universal, no prompt for programmatic download).

### 3. Project files exclude capture blobs

`.vljson` project files are designed to be self-contained and shareable. IDB blobs are local storage — they don't travel. `serializeDesktop({ forProject: true })` skips `blobKey` stubs so project files remain clean. Reload from localStorage (same machine) restores captures; loading a project on a different machine will not include them (which is correct behavior).

### 4. `desktop.addBlob(blob, opts)` — single capture seam

All capture paths (webcam photo, webcam video, output-window snapshot, output-window recording) converge on `DesktopAPI.addBlob(blob, { name, type, download })`:
- Creates the icon immediately (live object URL for the thumbnail)
- Sets `icon.blobKey = icon.id`
- Calls `_putCaptureBlob(icon.id, blob)` (async, fire-and-forget)
- Saves desktop state (serializes the `blobKey` stub to localStorage)
- If `download: true`, triggers `<a download>` for immediate filesystem export

On restore, `_getCaptureBlob(blobKey).then(blob => ...)` fills in the live URL asynchronously; the icon shows a glyph placeholder until the IDB read completes.

### 5. Snapshot made persistent

The existing 📷 Snapshot button in the paint overlay mini-bar called `window.desktop?.add(url, { name, type: 'image' })` with a bare blob URL. This was ephemeral. The button now calls `_snapshotVisual()` which routes through `desktop.addBlob` → IDB-backed, persistent.

### 6. MediaRecorder + compositeCanvasStream for recording

`MediaRecorder` is not used anywhere else in the codebase. New module `src/api/media/recorder.js`:
- `Recording` class: wraps one `MediaRecorder`, accumulates `ondataavailable` chunks, calls `onStop(blob)` from `onstop`
- `recordStream(stream, { onStop })` — factory
- `compositeCanvasStream(canvases, fps)` — for multi-layer output windows (draw z=0 / pixi z=25 / shader z=30): rAF loop draws each canvas in z-order onto an offscreen canvas, then `offscreen.captureStream(fps)`; returns `{ stream, stop }`
- `cleanupRecorders()` — registered via `onReset`; stops in-flight recordings on code reset (partial blobs finalize via `onstop`, the icon lands on the desktop)

Single-canvas windows use `canvas.captureStream(fps)` directly (no compositor overhead). `<video>` / camera windows use `videoEl.captureStream()`.

### 7. Webcam API: `cam.photo()` and `cam.record()` on `CameraStream`

`CameraStream` already held `this.element` (`<video>`) and `this._stream`. Added:
- `photo({ name, download })` — draws the video frame to a canvas respecting `_flipped`, `toBlob('image/jpeg', 0.92)`, → `desktop.addBlob`
- `record({ name, fps })` — `recordStream(this._stream, { onStop })` → `Recording`

### 8. Titlebar capture buttons

`_addCaptureButtons(win, body, visualEl)` adds 📷 and 🔴 buttons to the titlebar of any `image`/`video`/`camera`/`canvas`/`shader` window (the same set that gets the paint overlay). Called alongside `_addPaintOverlay` in `spawn()`.
- `image` windows: 📷 only (static visual, no record)
- others: both 📷 and 🔴

The 🔴 button toggles between start/stop. Any in-flight recording is finalized on window close via the `_wmCleanup` chain.

Three hooks are wired onto the window element (`_wmSnapshot`, `_wmRecord`, `_wmStopRecording`) for the public `wm.snapshot(id)` / `wm.record(id)` / `wm.stopRecording(id)` API.

### 9. Paint overlay integration

`_addPaintOverlay` sets `win._getOverlay = () => overlay` so that `_snapshotVisual` and `_recordVisual` can exclude the overlay canvas from the "all canvases" compositor list (it should be drawn on top as a layer, not recorded as a separate stream).

---

## Consequences

**New files:**
- `src/api/media/recorder.js` — `Recording`, `recordStream`, `compositeCanvasStream`, `cleanupRecorders` + `onReset`
- `tests/recorder.test.js` — 10 tests
- `tests/capture.test.js` — 12 tests
- `docs/capture.md`

**Modified files:**
- `src/api/platform/desktop-files.js` — IDB capture store, `desktop.addBlob`, `_download`, `serializeDesktop({forProject})`, `restoreDesktop` blobKey branch, blob cleanup on trash/remove
- `src/api/media/camera.js` — `CameraStream.photo()`, `CameraStream.record()`
- `src/api/wm/wm.js` — `_snapshotVisual`, `_recordVisual`, `_addCaptureButtons`, `win._getOverlay`, `wm.snapshot/record/stopRecording`; `_doSnapshot` simplified to call `_snapshotVisual`
- `src/api/platform/project.js` — `serializeDesktop({ forProject: true })`
- `src/runtime/app.js` — import recorder, register `Recording`/`recordStream`/`compositeCanvasStream`/`recordWindow`/`snapshot` globals
- `src/editor/completions.js` — `"Capture"` toolkit category
- `tests/blocks-coverage.test.js` — `'Capture'` in `BLOCKS_TODO`
