# ADR 041 — Complete the run-scoped adoption; keep-alive tokens carry labels

**Status**: Implemented
**Date**: 2026-06-30

> **Implementation note**: route.js + render-pipeline.js adopt `runScopedOutput`/`runScoped`; viz.js (3 classes), three-scene.js, camera.js adopt `runScoped` owner-filtering. Four per-module `onReset` handlers deleted (route, viz, three; render-pipeline keeps a one-line residual for the global `_stageRegistry`). Per-module registries (`_routes`, `_pipelines`, `_vizs`, `_scenes`) kept for enumeration and converted to self-removing Sets. `signal-graph.js` reads `token.label`. All 1351 tests green.

## Context

`src/runtime/run-scoped.js` (ADR 008/009) was built to absorb the owner-tag + keep-alive + owner-filtered-`onReset` ritual that ~12 subsystems each re-derived. CONTEXT.md ("Run-Scoped Process") and the module's own header both claimed it already *replaced* those re-derivations. It did not: only `media-lease.js` and `replay-clock.js` had adopted it. `route`, `render-pipeline`, `viz`, `three-scene`, `camera` (and the audio/mixer transient markers) still hand-rolled `_ownerEditorId = window.__ar_active_editor_id` + `liveOutput(...)` + a per-module `onReset`.

Two of those re-derivations were also **buggy**: `cleanupViz`/`cleanupThree` ignored `editorId` entirely and tore down *every* viz/scene on *any* reset — so re-running editor B killed editor A's viz/ThreeScene output.

Separately, the **Signal Graph** labelled live keep-alive entries by `token.constructor.name`. For routes the token was `{}` → `'Object'` (useless); under minification any class rename silently relabels graph nodes. This is the same knot as the migration, because `runScopedOutput` keeps a caller-supplied token *specifically* to preserve that (fragile) labelling.

## Decision

1. **Finish the adoption.** Each run-created output registers through `run-scoped.js`:
   - **`route`, `render-pipeline`** → `runScopedOutput` (live for their whole lifetime once started). route registers in `_register()` at start; pipeline in its ctor.
   - **`viz` (AudioViz/SpectrogramCanvas/PianoRollViz), `three-scene`** → `runScoped` (owner teardown) **plus** their own `liveOutput` start/stop toggle, because their liveness *toggles* (start/stop) rather than spanning the whole object lifetime — so they must not join keep-alive for life.
   - **`camera`** → `runScoped` (an INPUT: never keep-alive; ADR 009/023), owner passed explicitly because `open()` awaits.
2. **Delete the per-module reset handlers.** The single owner-filtered `onReset` in `run-scoped.js` disposes every handle; `dispose() → onStop → _destroy/_release`, guarded against re-entry. `render-pipeline` keeps a **one-line residual** `onReset` only for the *global* `_stageRegistry.clear()` on a full reset.
3. **Keep per-module registries for enumeration.** `_routes`/`_pipelines`/`_vizs`/`_scenes` stay (the Signal Graph reads `getLiveRoutes()`/`_descriptor()`; pipeline commands look up by id). They carry domain methods run-scoped must not know about — run-scoped owns *lifecycle*, the registry owns *enumeration*. They become self-removing Sets (each `_destroy` deletes itself), so owner-scoped disposal keeps them consistent without a bulk `cleanup*` loop on reset. `cleanupViz`/`cleanupThree`/`cleanupPipelines`/`cleanupCameras` survive only as **manual "destroy-all" helpers** (used by app.js + tests), not as reset handlers.
4. **Keep-alive tokens carry a `label`.** `runScopedOutput` tokens are `{ label }`; the Signal Graph reads `token.label ?? token.constructor?.name`. Folds in the old "owned accessor for signal-graph" friction — a rename can't relabel a node, and routes/pipes get meaningful names instead of `'Object'`.

## Consequences

- **Locality**: run-scoped lifecycle bugs (zombie drivers, cross-editor teardown) concentrate in one module.
- **Correctness fix**: viz/three now tear down per-owner — re-running one editor no longer kills another's viz/ThreeScene.
- Four per-module `onReset` handlers deleted; one one-line residual kept (stage registry).
- The stateless/stateful and toggle-vs-whole-life distinction is now explicit: whole-life outputs use `runScopedOutput`; toggling outputs use `runScoped` + their own `liveOutput`; inputs use bare `runScoped`.
- Signal Graph labelling no longer depends on `constructor.name`.

## Out of scope

- Audio's transient `liveOutput({_audioStarting})` (released right after `Tone.start()`) and the singleton mixer panel `_panel.live` are **not** migrated — neither is an owner-scoped run output.
- Generalizing the per-module enumeration registries into one typed run-scoped directory — deferred; the domain methods differ per subsystem.
