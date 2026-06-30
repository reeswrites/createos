# ADR 006: One Sync Drawable-Source Resolver (strings stay separate)

**Status:** Decided
**Date:** 2026-06-25

## Decision

Extract a single leaf module `src/api/visual/drawable-source.js` exporting
`resolveDrawable(source)`, the one function that reduces a **Drawable Source**
(Layer, CameraStream, bare `<video>`/`<canvas>`, bare `<img>`, or a
`GLShader`/`Shader` instance) to its underlying `canvas`/`video`/`image`
element. `render-pipeline`, `glsl-shader`, `shader`, and `draw.backdrop` all
import it. The resolver is **synchronous** and handles **object forms only**.
String forms (`'camera'`, image URLs) and any async loading stay layered on top
by the individual callers.

## Context

The same duck-typing logic lived in four places:

- `_resolveSource` in `render-pipeline.js` (the most complete copy)
- `GLShader._resolveVideoSrc` in `glsl-shader.js`
- `Shader._resolveVideoSrc` in `shader.js`
- the `draw.backdrop()` wrapper in `draw.js`

CLAUDE.md described this as a "3-resolver rule" — a documented seam that did not
exist in code. The copies had **already drifted**: render-pipeline resolved a
`GLShader`/`Shader` instance via its `.canvas`; the two `_resolveVideoSrc`
copies did not, and `draw.backdrop` had bolted on its own `HTMLImageElement`
fallback because the canonical copy lacked image support. A markdown rule is
discoverable only by someone who already knew about it — the worst kind of seam.

## Why sync, object-forms-only

Two genuinely different concerns were tangled:

1. **Sync object resolution** — already-live objects → drawable. This is the
   part that was duplicated 4×; it is the real bug surface.
2. **Async / string resolution** — `'camera'` → the camera `<video>`; a URL →
   a loaded `<img>`. This lives in exactly **one** place (`draw.backdrop`), so
   it is not earning a seam.

A function whose return type flips between `canvas` and `Promise<canvas>` is a
worse interface than two honest functions. All callers (pipe, GLShader, Shader)
are synchronous today; making them `await` would be a gratuitous ripple for no
gain. So `resolveDrawable` stays sync and honest; `draw.backdrop` keeps its
string/async layer on top.

## Contract

```
resolveDrawable(source) → HTMLCanvasElement | HTMLVideoElement | HTMLImageElement | null

  source._canvas  → canvas   // Layer / ShaderFX / VideoLayer / ImageLayer
  source.element  → video    // CameraStream
  source (video)  → video    // bare <video>
  source (canvas) → canvas   // bare <canvas>
  source (image)  → image    // bare <img>
  source.canvas   → canvas   // GLShader / Shader instance
  else            → null
```

Duck-typed (not strict `instanceof`) so jsdom test mocks resolve too.

The resolver is **strict**: unknown input → `null`. `render-pipeline`'s
`InputAdapter` throws on `null` (it wants a hard error). The shader callers want
to remain permissive toward exotic GPU-uploadable objects (`ImageBitmap`,
`VideoFrame`), so they keep a thin local fallback at the call site —
`resolveDrawable(s) ?? s` — rather than pushing that permissiveness into the
shared resolver.

## Trade-offs accepted

- **`video-signal.js` keeps its own `_resolveSource`.** It resolves a
  *sampleable* source and includes the `'camera'` string case — that is the
  deferred string/async concern, not the drawable-object contract. Left
  separate by design.
- **Deferred:** folding the string/async cases (`'camera'`, URLs) into a single
  entry point was considered and deferred. If a second caller ever needs string
  resolution, revisit — promote the string/async layer into the shared module
  (likely returning a Promise) at that point. Recorded here so a future
  architecture review does not re-suggest "just make one async resolver."

## Consequences

- New Drawable Source type → one edit, in `drawable-source.js`. Drift becomes
  impossible; the CLAUDE.md "3-resolver rule" is deleted.
- Source-type coverage gets one parametrised test table instead of being
  scattered/absent.
