# ADR 054 — Arbitrary/dynamic layer masking as an output compositing pass

**Status**: Implemented
**Date**: 2026-07-04

> **Implementation note**: `.mask(source, opts)` added to `ShaderLayerBase` (state + `_resolveMaskSrc`); masking realized as a **second full-screen pass** in `GLShader` (WebGL) and `Shader` (WebGPU) that multiplies the already-rendered framebuffer by a per-pixel coverage scalar — no user-fragment-source injection. `MaskStage` + `Pipeline.mask()` + `Route.mask()` + `STAGE_CTORS.mask` give the pipeline/route path (and multi-mask intersection for free via stage chaining). Tier-2 sugar: `Mask` global (`circle`/`feather`/`register`), `vision.handMask`, and the `shader:mask` bus command. New **Masking** toolkit category classified `BLOCKS_TODO`.

## Context

We want TouchDesigner-style masking: a shader (or any layer) applying only within an
arbitrary, possibly-animated region — a hand, a painted blob, another feed — not just
CSS geometry.

Two false starts framed the decision:

1. **Split masking by rendering backend** (shader / CSS / canvas2d). Wrong axis: it
   leaks implementation detail into the API and gives the learner three mental models
   for one idea.
2. **Inject the mask into the user's fragment source** — sample a `uMask` texture in
   the shader body and multiply `gl_FragColor.a`. This only works for the shader forms
   *we* wrap (body-form): full-GLSL (`void main`), ShaderToy (`void mainImage`), and
   full-WGSL (`@fragment`) all bypass our wrapper, so `.mask()` would silently no-op on
   them — the exact "silent capability loss" class the project treats as a bug. It also
   demands fragile source-string surgery (renaming the user's `gl_FragColor` write /
   intercepting the body's `return`) to find the alpha to multiply.

CSS `mask-image` was also considered and rejected as the *general* solution: there is
no standard way to hand CSS a **live** canvas/video as a mask source. Making it dynamic
means `canvas.toDataURL()` every frame — a synchronous, blocking encode costing multiple
ms of frame budget at 60fps. CSS masking is fast only when the mask is static.

## Decision

**The fault line is static-vs-dynamic content, not rendering backend.** Two tools:

- **`.clip(shape)`** — the *static* tool. Fixed or CSS-animatable geometry
  (circle/polygon/SVG path) via `clip-path` on the layer's DOM element. Compositor-thread,
  effectively free, works on any mounted layer. Already existed; now documented as the
  static masking tool beside `.mask()`.
- **`.mask(source, opts)`** — the *dynamic/arbitrary* tool. `source` is **any Drawable
  Source** (ADR 006) — a paint canvas, camera feed, another shader, a hand-tracking
  canvas — resolved through the existing `resolveDrawable()`. Arbitrary regions come
  from arbitrary drawables the project already has; no new "shape primitive" system.

**Masking is a compositing operation on rendered output — a second full-screen pass —
not a source injection.** After the layer renders normally:

- **WebGL**: bind a tiny dedicated mask program (passthrough vert + "sample mask,
  reduce to scalar `m`, output `vec4(m)`"), `gl.blendFunc(gl.ZERO, gl.SRC_COLOR)`, draw
  one fullscreen triangle → every channel of the canvas `*= m`.
- **WebGPU**: a second render pipeline into the same canvas texture with `loadOp:'load'`
  and blend `{srcFactor:'zero', dstFactor:'src'}` → same multiply.
- **2D canvas / pipeline** (`MaskStage`): `destination-in`, preceded by a luminance→alpha
  offscreen conversion so `channel:'luminance'` behaves identically to the GPU path.

`opts = { channel: 'luminance' | 'alpha', invert: false }`. `channel` selects how a
source pixel reduces to `m`; `invert` flips it. The mask stretches to the layer's uv
(same mapping as `.video()`). `.mask(null)` clears.

## Consequences

- **Form-agnostic.** Works identically on body-form, ShaderToy, full-GLSL and full-WGSL
  shaders — the pass never touches user source, so there is no form to special-case, and
  the fragile `gl_FragColor`/`return` surgery is gone entirely.
- **No binding collisions.** The mask texture/sampler live in the *second* pass's own
  program/pipeline and bind group, wholly separate from the main shader's video bindings
  (1/2) — the "which binding index" question dissolves.
- **Dynamic falls out for free.** A live mask source (paint canvas, camera, running
  shader) re-uploads every frame like `.video()`; a procedural mask animates via the
  factory's `.update()` / `route()` — no animation primitive.
- **Multiple masks decompose, no multi-mask state needed.** *Union* of regions = one
  source drawn with many shapes (what `vision.handMask` does for several hands).
  *Intersection* of separate sources = sequential passes: `pipe(cam).mask(a).mask(b)` is
  two `MaskStage`s = a product. The bare shader keeps a single `_maskSrc` (last-wins);
  promoting it to `_maskSrcs[]` later is backward-compatible.
- **Cost.** One extra draw call per frame and a small dedicated mask program/pipeline per
  shader (plus the mask-texture upload injection would have needed anyway). Accepted:
  slightly more setup than a one-line multiply, but no per-form branching and no source
  surgery, so it is net simpler to reason about.

### Tier 2 (ergonomics, same decision)

- **`Mask`** global: generic, data-less procedural shape factories — `Mask.circle`,
  `Mask.feather`, `Mask.register(name, factory)`. Return a white-on-black canvas (so the
  default `channel:'luminance'` reads it) with an `.update(opts)` method; normalized 0–1
  coords.
- **`vision.handMask(opts)`**: tracking-driven mask, in `vision.js` where `_applyMirror`
  and the landmark cache live. Self-driving (run-scoped RAF redraws from `vision.hands()`,
  torn down via `onReset`); **not** a keep-alive output (it is an input to the masked
  shader). Owns mirror + exponential landmark smoothing.
  `Mask.handTip` was **not** added — it would duplicate this and pull vision internals
  into the generic registry.
- **`shader:mask` bus command** mirrors `shader:uniform`: swap/update a running shader's
  mask from outside its own code (another editor pane, a UI panel). `bus.js` is in-process
  `Map` pub/sub, so a live canvas/video reference passes through the payload fine.

### Known gap (pre-existing, deferred)

`glshader`/`shader` are still absent from `Pipeline.STAGE_CTORS`, so shader *stages*
cannot yet live inside a `.wait()`-timelined route. Not caused by this work; making them
timeline-able needs separate verification (they self-RAF and own windows/hidden divs, so
repeated create/destroy toggling risks leaks/flicker). Temporal masking is unaffected —
it runs through `MaskStage`, which **is** in the whitelist.

### Authoring surfaces

Masking is drawable/closure-heavy (mask source is a live drawable) — genuinely awkward as
Blockly blocks, exactly like `Route`. It ships **text-first**: a dedicated **Masking**
toolkit category classified `BLOCKS_TODO` (grouping `clip` + `mask` + `Mask` +
`vision.handMask` so the static/dynamic split is taught side by side). No new blocks.
