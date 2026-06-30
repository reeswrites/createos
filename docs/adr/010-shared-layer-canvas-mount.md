# ADR 010: Shared `mountLayerCanvas` for the Shader Pair

**Status:** Decided
**Date:** 2026-06-25

## Decision

Extract the non-GPU half of `Shader._init` and `GLShader._init` into one helper,
`mountLayerCanvas(opts)` in `src/api/visual/layer.js`. Both shader classes call it for
the canvas-mounting concern, then attach their own GPU context.

## Context

ADR 005 deliberately keeps `Shader` (WebGPU/WGSL) and `GLShader` (WebGL/GLSL) as
separate GPU backends. But the *non-GPU* half of their `_init()` was ~25 lines
copy-pasted between them: resolve `fsContainer`/`canvasWrapper`/`parent`/
`sizeRef`/`refCanvas`, create the canvas, apply the identical absolute-fill +
z-index + opacity style block, promote a `static` container to `relative`, and
install a `devicePixelRatio` `ResizeObserver`. That code is about *the IDE's
layer stack* (z=0 draw / z=25 PIXI / z=30 shader), not about GPU APIs — so it
belongs with the layer system, owned once.

## Design

```js
mountLayerCanvas({ z, opacity, container, webgpu, onResize })
  → { canvas, parent, sizeRef, refCanvas, resizeObserver }
```

The helper owns container resolution, the style block, the static→relative fix,
and the `ResizeObserver`. The two points of variation are parameters:

- `webgpu: true` tags the canvas `_ar_webgpu` (so the window-mirror copy loop
  skips the unreadable WebGPU canvas).
- `onResize(w, h)` is the context-specific resize step — `GLShader` calls
  `gl.viewport(0,0,w,h)`; `Shader` resizes its `_readable` shadow canvas.

The caller keeps the returned `resizeObserver` and disconnects it in its own
`_destroy` (unchanged). `Shader` still creates its `_readable` shadow canvas
itself — that is genuinely Shader-specific, not layer-stack plumbing.

## Consequences

- The z=0/25/30 layer-stack mounting rules live in one place, beside `Layer` and
  `getLayerForZ`.
- A future third renderer (e.g. a 2D effect canvas) mounts correctly for free.
- The GPU code — the genuinely different part — is untouched; ADR 005's backend
  split stands. Blast radius is small and test-guarded
  (`tests/layer-mount.test.js`).
