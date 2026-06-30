# ADR 045 — Extract the paint overlay behind a wm spawn/overlay test harness

**Status**: Implemented
**Date**: 2026-06-30

> **Implementation note**: Slice 3 of the wm decomposition (ADR 042). A new integration harness `tests/wm-paint-overlay.test.js` (6 tests) exercises the overlay through wm's public surface — spawn → 🖌️ toggle → pointer stroke → addText → close — and went green against the *un*-extracted code first. `_addPaintOverlay` (~385 lines) then moved verbatim into `src/api/widgets/paint-overlay.js` as `addPaintOverlay(win, body, visualEl, ctx)`; wm keeps a thin wrapper injecting the registries + snapshot fn. Harness stayed green through the move. All 1364 tests green.

## Context

ADR 042 extracted two clean cores from the `initWM` god-closure (window-capture, audio-viz) but **deferred** the in-window paint overlay (`_addPaintOverlay`, ~390 lines). The reason was risk, not shape: the overlay is a self-contained drawing engine (own undo stack, toolbar, `WidgetEvents`, pen/eraser/text tools, the `win._ensureTextLayer` factory), but it is fused to window lifecycle and wm.js had **no unit-test net**. Moving 390 lines of pointer/drawing code blind could silently break the overlay, and canvas drawing is a no-op under jsdom so the engine can't be unit-tested in isolation — leaving no obvious guard.

The deferral named the right sequencing: **build a wm spawn/overlay integration harness first, then extract behind it.**

## Decision

1. **Write the harness against the un-extracted code.** `tests/wm-paint-overlay.test.js` bootstraps `initWM()` over a `#desktop` div (the existing `wm-spawn-id.test.js` pattern) and drives the overlay through wm's **public** surface:
   - spawn a visual window → `wm.paintEvents(id)` returns its `WidgetEvents`;
   - the 🖌️ toggle button builds (`win._getOverlay()` non-null) and tears down the overlay canvas;
   - a `pointerdown→pointerup` emits a `stroke` event with a bbox via `wm.onStroke`;
   - `wm.addText` creates a Text Layer + mirror canvas;
   - closing the window resolves `paintEvents` to null; `cleanupPaintOverlays()` doesn't throw.

   jsdom gaps are stubbed in the test (canvas 2d is already stubbed in `tests/setup.js`; the harness adds `setPointerCapture`). This is the **test surface the extraction needed** — it crosses the same seam callers do.

2. **Extract verbatim into `paint-overlay.js`.** `addPaintOverlay(win, body, visualEl, ctx)`. The overlay's free variables were exactly three: the module-level registries `_overlayEvents`/`_textLayers` and the `_snapshotVisual` wrapper. These stay **wm-owned** (the registries are also read by `wm.addText` and cleared by `cleanupPaintOverlays` on reset) and are **injected** as `ctx = { overlayEvents, textLayers, snapshot }`, so paint-overlay never reaches back into the wm closure. `WidgetEvents`/`TextLayer` are imported directly by the new module.

## Consequences

- **AI-navigability**: ~376 lines leave the god-closure; `spawn()` shrinks further. wm's only remaining `new WidgetEvents()` is gone (the import drops).
- **Regression safety**: the overlay now has integration coverage through its public seam — the first tests to reach inside a wm spawn. The harness is the durable guard for future wm changes, not just this refactor.
- **Ownership stays correct**: wm keeps the overlay registries + reset handler (they span `addText` too); paint-overlay owns only the builder. Same injected-context discipline as audio-viz's `resolveChannel` (ADR 042).
- Completes ADR 042 — all three identified clusters now extracted.

## Out of scope

- Extracting `spawn()` itself, the history/persistence pair, or the sensor/viz window builders — still in the closure.
- Making the drawing engine unit-testable below the integration level — blocked by jsdom's no-op canvas; the integration harness is the right altitude.
