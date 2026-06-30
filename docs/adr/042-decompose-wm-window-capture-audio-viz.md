# ADR 042 — Decompose wm.js: extract window-capture and audio-viz

**Status**: Implemented
**Date**: 2026-06-30

> **Implementation note**: `window-capture.js` (snapshot/record compositing + recorder wiring) and `audio-viz.js` (the spectrum render core) extracted from the `initWM` closure. wm.js keeps thin wrappers (`_snapshotVisual`/`_recordVisual`/`_createSpectrumCore`) over the imports + the DOM panel/button glue. recorder.js import moved out of wm.js. **Slice 3 (paint-overlay) was deferred here and subsequently landed in ADR 045** (behind a new wm spawn/overlay integration harness). All three clusters now extracted; 1364 tests green.

## Context

`src/api/wm.js` is one 3106-line `initWM` closure. `spawn()` is a god-function assembling every concern, and the window DOM element (`win._*` fields) is the de-facto shared mutable bag. The file has no unit tests, and three clusters inside it are self-contained enough to stand alone:

1. **Snapshot/record compositing** (`_zSortedCanvases`/`_snapshotVisual`/`_recordVisual`) — already DOM-clean after ADR 040 (it walks z-sorted `<canvas>` planes, no `win._getOverlay` poking). Only outward dep is recorder.js.
2. **Spectrum/analyser render core** (`_createSpectrumCore`) — already a `(canvas, getStyle, opts)` factory; the FFT normalization + three render styles are the deep, reusable part. Its only wm-private reach was `_winStrips` (the `ch:` source).
3. **In-window paint overlay** (`_addPaintOverlay`, ~390 lines) — a self-contained pointer/drawing engine with its own undo stack, toolbar, and `WidgetEvents`.

## Decision

Extract clusters 1 and 2 into their own modules; leave the DOM glue in wm.

- **`window-capture.js`** — `snapshotWindow(win, body, visualEl, opts)`, `recordWindow(...)`, `zSortedCanvases(body)`. Owns the z-sorted composite + recorder.js wiring; converges on `desktop.addBlob`. Reads only public DOM (the body's `<canvas>` planes, `.wm-title` for a default name) — never a `win._*` private field, so wm stays the owner of window internals. wm keeps one-line wrappers so the `_addCaptureButtons` call sites are unchanged.
- **`audio-viz.js`** — `createSpectrumCore(canvas, getStyle, opts)`. The one wm-private lookup (window-strip → channel for `ch:` sources) is **injected** as `opts.resolveChannel`, so the core never touches `_winStrips`. wm's `_createSpectrumCore` becomes a thin wrapper that supplies `resolveChannel`. The panel/window builders (`_buildSourceSelect`/`_addVizPanel`/`_buildVizWindow`) stay in wm — they are DOM glue bound to closure state (`desktop`, `_winStrips`, `spawn`).

## Consequences

- **AI-navigability**: two concerns leave the god-closure; `spawn()` shrinks toward orchestration.
- **Testability**: `window-capture` is testable with a fake body of canvases; `createSpectrumCore` is importable with an injected `resolveChannel` + fake analyser.
- recorder.js is imported by `window-capture` now, not wm.
- The injected `resolveChannel` is the seam that keeps `audio-viz` from reaching wm's private strip map.

## Out of scope / deferred

- **Slice 3 — `paint-overlay.js` (`_addPaintOverlay`).** Was deferred here (390-line DOM/pointer engine fused to window lifecycle, on a file with no test net). **Landed in ADR 045** — a wm spawn/overlay integration harness was written first, then the overlay extracted behind it.
- Extracting `spawn()` itself, the history/persistence pair, or window physics — not attempted.
