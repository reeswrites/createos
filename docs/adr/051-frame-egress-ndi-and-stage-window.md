# ADR 051 — Frame egress: NDI-first, replaceable transport, stage window defers to it

**Status**: Accepted — proposed (not yet implemented)
**Date**: 2026-06-30

## Context

The highest-value native addition is streaming any canvas/shader/scene out to other VJ tools
(Resolume, TouchDesigner, OBS) via NDI/Syphon/Spout. The frames live in a renderer `<canvas>` /
WebGL / WebGPU context; native texture-sharing libs live in the main process / a native addon.
Getting pixels across that process boundary is the whole problem.

A related feature — a second-monitor "stage" output (Phase 3 #4) — hits the same wall from the
other side: the runtime is **single-realm** (one `BrowserWindow`; the event bus, WM window
registry, keep-alive, run-context, mixer, and Canvas registry all live in one JS realm). WM
"windows" are DOM `<div>`s in that page and can't independently cross OS monitors. A true second
`BrowserWindow` is a separate realm that would need frames bridged to it — the same egress
problem again.

## Decision

**NDI is the first egress target**, chosen over Syphon/Spout because it is **cross-platform**
(Syphon is macOS-only, Spout is Windows-only) and the platform target is all three (ADR 052).

**Transport: readback + IPC now, designed for replacement.** v1 reads pixels back
(`readPixels`/`copyToBuffer`) → SharedArrayBuffer/IPC → native sender, accepting ~30fps@720p and
some latency, and measures. The sender module's public face is a stable output API; a later
GPU-interop / offscreen-render path (IOSurface+Syphon on mac, DXGI shared handle+Spout on
Windows) can replace the transport **without changing the API**. Pragmatic — validates the value
before deep GPU-sandbox work.

**Reuse the existing composite.** The readback source is `window-capture.js`'s
`zSortedCanvases`/`snapshotWindow` (ADR 042), which already flattens a window's whole layer stack
(draw@0, pixi@25, shader@30, overlay@50, text@51) into one canvas. The egress path does **not**
re-derive compositing.

**The multi-monitor stage window defers to NDI.** Rather than stand up a second `BrowserWindow`
realm now, a performer routes the stage out via NDI/Syphon to a fullscreen viewer (or OBS) on the
other display — reusing this egress work. A native in-app stage window is revisited only if
demanded, and it would ride the GPU-interop transport once that exists.

## Considered options

- **GPU zero-copy interop from day one** — true realtime, but deep per-platform native code that
  fights Chromium's GPU-process sandbox, large effort before any payoff. Deferred to the transport
  swap.
- **Offscreen NativeWindow / paintable capture** — couples egress to a stage-window feature that
  is itself deferred. Rejected as the starting point.
- **Second `BrowserWindow` for the stage now** — a second realm to feed/sync (frame bridge or
  re-run the sketch), the expensive path. Rejected in favour of NDI-to-viewer.

## Consequences

- NDI depends on a native addon per platform; readback keeps it CPU-bound until the GPU path
  lands. Frame rate/latency are measured, not assumed.
- Stage output has no in-app second window in v1; the docs point performers at an NDI/Syphon
  viewer or OBS on display 2.
- The sender API is the stable contract; the transport underneath is explicitly expected to be
  rewritten, so callers (`pipe()`/output side) must not depend on readback specifics.
