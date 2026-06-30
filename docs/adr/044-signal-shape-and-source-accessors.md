# ADR 044 — Route signal shapes and cross-module reads through owned seams

**Status**: Implemented
**Date**: 2026-06-30

> **Implementation note**: four signal-shape duck-types routed through `signal-shape.js` (route.js ×2, viz.js, video-signal.js — `_isSignal` deleted); `ShaderLayerBase.getUniform()` added and used by route's swizzle; `sourceKind`/`sourceField` added beside the `Source` definition in render-pipeline.js and used by route + pipe. One audio-viz test mock corrected to a two-field signal. All tests green.

## Context

Three cross-module shapes were read by hand instead of through an owned seam:

1. **Signal predicates.** `signal-shape.js` exists as the canonical `isVideoSignal`/`isAudioSignal`/`isBandsSignal` — yet four sites re-inlined the duck-type: `route.js` (`'brightness' in …`, `'motion' in …`), `viz.js` (`'fft' in source`), and `video-signal.js` (`_isSignal`, a verbatim re-implementation of `isVideoSignal`). Add a field to a signal shape and four places must change in lockstep, with no test asserting they agree.
2. **Shader uniform store.** `route.js` read `sink._uniforms?.[uname]` directly for its read-modify-write swizzle — there was no `getUniform()`, so a rename of the private store would silently write zeros for the un-touched components.
3. **Source sentinel.** `render-pipeline.js` defines `Source` as frozen `{_src, field}` sentinels; `route.js` (and `pipe`) hand-matched `x?._src === '...'`. The contract lived in neither a shared predicate nor a type — a rename on either side broke the other with no signal.

## Decision

- **Predicates**: replace the four inline checks with imports from `signal-shape.js`. The canonical predicates are intentionally **two-field** (`isVideoSignal` ⇒ `brightness` ∧ `motion`; `isAudioSignal` ⇒ `value` ∧ `fft`) — strictly more correct than the one-field inline checks and identical for real signal objects (producers always emit both).
- **Uniform read**: add `ShaderLayerBase.getUniform(name)` — the read twin of `setUniform`, returning a zeroed `{x,y,z,w}` default for vector names. route reads through it.
- **Source kind**: add `sourceKind(x)`/`sourceField(x)` *beside* the `Source` definition (render-pipeline.js), exported. route and pipe match through them. The contract is owned where it is defined.

## Consequences

- **Locality**: each shape is defined and read in one place; a rename fails loudly (missing import / accessor) instead of silently.
- **The interface is the test surface**: `signal-shape.test.js` is the sole predicate guard; a coherence test can assert no `'brightness' in` / `'fft' in` survives outside `signal-shape.js`.
- Cheap, mechanical, zero behavior change for real inputs.

## Out of scope

- Deriving `detectAPIUsage` from the API Descriptor (the remaining "owned accessor" friction) — blocked by the ADR-012 coherence gate; not reopened here.
