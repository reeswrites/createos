# ADR 040 — Replace global `draw` with `Canvas`; layers become a WM compositor

**Status**: Implemented
**Date**: 2026-06-29

> **Implementation note**: Landed across wm.js (layer compositor + audio chip + z-sorted snapshot/record), canvas.js (sole 2D surface; `c.layer`/`c.fx`; identity-reuse + soft-survival; cascade), shader-layer-base.js + pixi.js (`.mount`/`.show`), render-pipeline.js (`pipe.layer(target,z)`), editor-instance.js, blocks (implicit-canvas codegen), completions, demos, API.md/README/CLAUDE.md. All 1354 tests green.
>
> **editor-instance shedding (done)**: removed `mainCanvas`, `_layers`/`_layerObjects`/`_drawTargets`, `_makeGetLayerCanvas`/`_getLayerCanvas`/`_getDraw`/`_getLayerObj`, `_refreshDraw`, `_ensureOutputWin`/`_showOutputWin`, `canvasWinId`, `_getOutputGeom`/`_saveOutputGeom`, `this.draw`, the canvas-stack DOM (`canvasWrapper`/`fsContainer`), the clear-canvas button, and the `__ar_canvasWrapper`/`__ar_fsContainer` exports. Cross-file callers updated: app.js (editor-spawn layout drops the output-window column), project.js (legacy `type:'output'` windows ignored on load).
>
> **three-scene.js (done)**: `ThreeScene` got the same `.mount(target)`/`.show()` treatment as pixi/shader — no longer falls back to the editor wrapper; sizes to its mount target; `.show()` spawns its own window; `_destroy` closes it. Tests updated to the mount model.
>
> **Shader mouse (done)**: the `mouse` uniform is now per-shader-window — a module-level listener stores the raw viewport pointer (`__ar_shaderMouseRaw`) and `ShaderLayerBase._mouseXY()` maps it against each shader's own canvas rect (no more shared editor wrapper).
>
> **Stragglers swept**: paint.js Code export now emits `new Canvas()` + `canvas.image` (was broken `draw.image`); param-hints.js drops dead `draw.*`/`getCanvas`/`getLayer` keys and adds a Canvas-instance method fallback (`CANVAS_METHOD_HINTS`, matches `c.circle`/`canvas.rect`); shader-signal-picker mouse snippets use `window.innerWidth/Height`; CONTEXT.md gained **Canvas** + **Window Layer Stack** glossary entries and updated Output Window / Per-Editor Locals / Snapshot.
>
> **Truly remaining (cosmetic)**: a `console.warn('draw.backdrop: …')` label in draw.js; layer.js's `mountLayerCanvas` keeps a `?? getElementById('canvasWrapper')` fallback that's now always null (only hit if called with no container — never happens). Both harmless.

## Context

ADR 038 introduced `Canvas` — a window-scoped drawing surface that does everything the global `draw` does, plus two things `draw` cannot: it maps its own pointer (it owns a window) and it can be instantiated N times. `Canvas extends DrawTarget`, so it is the *same fluent API*, just window-scoped.

That left two surfaces that draw 2D pixels into a window:

- **global `draw`** — zero-config (`draw.circle(...)`, no `new`), but bound to one editor-owned `mainCanvas` (editor-instance.js:306-333), and **cannot read its own pointer** (input.js emits `window:mouse:*` in viewport pixels; `draw` has no window rect to map against — ADR 038 §Context).
- **`Canvas`** — the superset, but requires `new Canvas()` and a variable.

Costs of keeping both:

1. **The cliff.** `draw` is the advertised easy path, but the moment a sketch wants pointer interaction it dead-ends and must be rewritten into `Canvas`. An easy path with a cliff is worse than a slightly-less-easy path with none.
2. **Teaching-surface tax.** "Put pixels in a window" had three answers (`draw`, `new Canvas()`, `pipe.show()`), two of which are the same class minus a window.
3. **A bespoke singleton.** `draw` is backed by hand-rolled editor plumbing (`mainCanvas`, `_layers`, `_getLayerCanvas`, `_showOutputWin`, `canvasWinId`, `_getOutputGeom`) that exists *only* to serve the default surface.

### Why not keep `draw` as a zero-config front door

We explored a symmetry with the audio API to justify keeping `draw`:

| audio world | visual world | role |
|---|---|---|
| `audio` (one `Destination`, sums everything) | `wm` (one desktop, owns all windows) | **master** — singleton, physically one |
| Instrument / synth (class) | `Canvas` (class) | **source** — many |
| `note` / `s` (zero-config fn) | `draw` | **front door** — zero-config |

Under that lens `draw` is the visual analogue of `note`/`s`: a zero-config front door over a default surface, and the real visual *master* is `wm` (you don't `new wm` for the same reason you don't `new audio` — output is physically singular). That argues for *keeping* `draw`.

**We considered this and chose to drop `draw` anyway**, accepting the loss of a zero-config draw front door in exchange for a single, explicit 2D primitive. The deciding judgment: the front-door convenience does not pay for a permanently special-cased singleton + its bespoke editor plumbing, and one obvious primitive (`Canvas`) is worth more than the saved keystrokes. (If a zero-config front door is ever wanted back, it should return as a thin `note`-style helper over `Canvas`, not as today's bespoke surface — see Out of scope.)

**Back-compat is explicitly not a gate.** Existing `.vljson` demos and sketches that use `draw`/`getLayer`/`getCanvas` will break and be migrated by hand afterward. This frees the decision to *delete* machinery, not wrap it.

## Decision

Two pronged:

1. **Delete global `draw` (and `getDraw`/`getCanvas`/`getLayer`). `Canvas` is the sole 2D drawing surface.** The fluent 2D API is reachable only via a `Canvas` instance (and its `.layer(z)`). There is no editor-owned default surface and no auto-opened output window. A sketch that draws starts with `new Canvas()`; a sketch that does not draw (audio, events, MIDI, shell) is unaffected.
2. **The z-layer stack becomes a WM-owned per-window compositor.** A window owns its stack of planes. `Canvas` consumes layer 0; `pixi`/`Shader`/`wm.applyShader`/paint-overlay/text are all planes in one window-owned stack; WM owns the snapshot/record composite order by walking that stack.

```js
const c = new Canvas({ w: 800, h: 600, title: 'Pong' });
c.bg('#0a0').circle(400, 300, 40, '#fff');
c.on('down', ({ x, y }) => …);          // pointer pre-mapped to canvas space (ADR 038)

// pure-audio sketch — no Canvas needed
note('c e g').play();
```

`DrawTarget` (draw.js) stays — it is the shared 2D implementation `Canvas extends`. Only the global `draw`/`getDraw` exports and the editor's default-surface plumbing are deleted.

### The z-layer stack is a WM-owned per-window compositor

Today the z-layer stack is a **per-editor singleton**: `mainCanvas` (z=0), the `_layers` Map, `_getLayerCanvas`, `_makeGetLayerCanvas` in editor-instance.js (235, 270-282, 306-333); pixi/shader mount into the editor's `__ar_canvasWrapper`.

The cleaner owner is the **window**. A "layer" is a z-ordered `<canvas>`, absolute-fill, inside a window body — a compositing plane in a window. WM is already the de facto owner of exactly this, in four unformalized places:

- `wm.applyShader(winId, …)` mounts a shader plane into **any** window (camera/video/canvas) — not Canvas-specific,
- paint overlay canvas @ z=50 (wm.js `_addPaintOverlay`),
- TextLayer posDiv @ z=51 (ADR 024),
- snapshot/record compositing: base → overlay → text (wm.js `_snapshotVisual`/`_recordVisual`).

So **formalize the per-window layer stack as a WM concept:**

- `wm.layer(winId, z)` returns/creates the managed **raw `<canvas>`** at `z` (what `mountLayerCanvas(container)` + the overlay/text planes already do informally). WM owns the element, stack position, resize, and clear-on-reset; it does **not** own styling. The `Layer` CSS-wrapper (layer.js — filter/transform/opacity/blendMode) stays a thin decorator on top. Lazy: a window grows a stack only when something mounts into it, so editor/console/toolkit windows never get one.
- `Canvas` is the **z=0 draw plane** of its window plus pointer mapping. It consumes layer 0; its `DrawTarget` `getLayerCanvas` resolver (draw.js:36-38) defers to `wm.layer(this.winId, z)`. `c.layer(z)` exposes higher planes of *its own* window.
- `pixi` / `Shader` / `GLShader` target a **window** via two entry points (resolved — see below): `.mount(target[, z])` is the primitive (add a plane to an existing window's stack — `canvas.shader(z, body)` / `pixi.mount(canvas)`); `.show()` is sugar that spawns a bare window and mounts into it (standalone, like `pipe.show()`). They no longer fall back to `__ar_canvasWrapper` (pixi.js:11, shader.js:20) — that default is gone. `wm.applyShader` collapses into "`.mount` a Shader plane onto a window."
- **Paint overlay (z=50) and TextLayer (z=51) register through `wm.layer`** — they stop being bespoke planes behind `_getOverlay`/`_getTextCanvas`. `wm.layer` is the single registry of every plane in a window.
- **WM owns the composite order.** `_snapshotVisual`/`_recordVisual` (wm.js:516-560) already walk `body.querySelectorAll('canvas')` and re-derive `base → overlay → text` via a filter dance; they are rewritten to walk the formal stack (`wm.layers(winId)`, z-sorted). recorder.js stays the dumb blitter (`compositeCanvasStream(arr)`); the order comes from the one registry. Net deletion of the filter dance + `_getOverlay`/`_getTextCanvas` indirection.

Consequence: **layering is per-window, one owner.** A `Shader` can composite over any window — Canvas, Camera, video — through one mechanism. The z-stack contract (draw@0 < pixi@25 < shader@30 < overlay@50 < text@51) is unchanged *within each window*; it stops being a per-editor singleton scattered across editor-instance + wm.js + text-layer.js.

editor-instance.js **sheds** `mainCanvas`, `_layers`, `_getLayerCanvas`, `_makeGetLayerCanvas`, `_getDraw`, `_getLayerObj`, `_refreshDraw`, `_showOutputWin`, `canvasWinId`, `_getOutputGeom`. The editor's job becomes "run lifecycle"; the layer plumbing moves to WM.

### Coordinate model: 1600×900 fixed-logical (kept on merit)

`Canvas` stays 1600×900 fixed-logical by default (canvas.js:18, ADR 038) — not for compat but because fixed-logical is correct for absolute-pixel 2D: layouts don't drift on resize, art reproduces across screens/embeds. Native-resize for 2D is rejected, same reasoning as ADR 038.

### Lifecycle: uniform — Canvas windows survive soft reset by identity

There is no special "default" lifecycle — every `Canvas` behaves identically. But to avoid flash-rebuilding the window on every ~1s auto-exec (soft reset re-runs user code, so a naive run-scoped `new Canvas()` would respawn each cycle — editor-instance.js:1121), Canvas windows are **reused across soft reset by identity**:

- Each `Canvas` has a stable key: explicit `{ id }`, else derived from `title + w + h`.
- **Soft reset** does *not* destroy Canvas windows; it marks them pending and wipes their run-scoped subscriptions (`clearRunScoped`, as today).
- On **re-run**, `new Canvas({…})` looks up a pending window by key: **match → reuse** the window (keep geometry, clear the layer-0 raster for a fresh frame, rebind handlers from the re-run); **no match → spawn** new.
- After the re-run settles, any still-pending Canvas not re-claimed is destroyed (handles a surface deleted from the code).
- **Hard reset** (stop) and **window close** destroy unconditionally, releasing the `liveOutput` keep-alive.

This keeps "every Canvas identical" (all soft-survivable, keyed) while killing flicker. Fragility is bounded: renaming a Canvas's `title` orphans the old window for one cycle, then it self-heals (reclaimed-or-destroyed). The same identity-reuse should eventually extend to `pipe.show()` and widget windows (they have the same respawn behavior today), but that generalization is out of scope here.

### Detection

The `draw`/`layer`/`pixi`/`Shader` branch of `detectAPIUsage` that opened `win-canvas-{id}` (editor-instance.js:1143 `_showOutputWin`, app.js execute step 1) is **deleted** — `Canvas` spawns its own window, and there is no default surface to open. Audio detection (`usesAudio` → start audio) is unchanged, but the audio-controls affordance moves off the (now-gone) output window: `ensureAudioControls`-on-output-window is deleted. Audio control lives in its right home — the audio master — as a **light master-volume chip in the desktop/taskbar chrome** (present whenever audio runs), with the existing mixer panel (`mixer.show()`, mixer.js:578) one click deeper. This decouples audio control from any drawing window, consistent with `audio` being the master (like `wm`), not a function of a canvas.

## Consequences

- **One 2D primitive.** `Canvas`. No `draw`, no `getDraw`/`getCanvas`/`getLayer` globals. Drawing sketches begin with `new Canvas()`; non-drawing sketches are untouched.
- **Loss accepted:** no zero-config draw front door. `draw.circle()` one-liners no longer exist; the shortest drawing sketch is `new Canvas().circle(...)` (or assign to a var).
- **Layering is per-window, one owner (WM).** `Shader`/`pixi`/`applyShader`/overlay/text are planes in one stack; "shader over a Camera window" is the same mechanism as over a Canvas.
- **editor-instance.js gets materially smaller** — the whole default-surface/layer plumbing is deleted.
- **WM grows a compositor responsibility** (`wm.layer(winId, z)` + composite-order ownership), consolidating logic currently scattered across editor-instance.js, wm.js, text-layer.js. Lazy.
- **The bespoke output window concept is gone.** No `win-canvas-{id}`, no `_getOutputGeom`, no auto-open-on-detect. Output windows are just `Canvas` (and `pipe.show()`/widget) windows.
- **We accept demo/sketch breakage.** Demos and `tests/blocks-coverage.test.js` (+ completions/toolkit/blocks entries for `draw`) are migrated/rewritten, not appeased.
- **Embed mode** (`?embed=1`) must map a `Canvas` window into `.ar-embed-output` fullscreen — but with no default surface, an embed of a drawing sketch shows whatever `Canvas` the code creates; an embed of a non-drawing sketch shows nothing visual. Verify the fullscreen mapping picks the right window.

## Out of scope / rejected

- **Keeping `draw` as a `note`-style front door** — considered (the audio symmetry), rejected in favor of one explicit primitive. If reintroduced later it must be a thin helper over `Canvas`, not the old bespoke surface.
- **Letterboxing** when window aspect ≠ 16:9 — still stretches (ADR 038 deferred).
- **Folding `pipe.show()` into Canvas** — different abstraction (pipeline vs bare surface); leave it.
- **Native-resize for 2D** — rejected, same reasoning as ADR 038.
- **A migration shim for old demos** — not building one; migrate by hand.

## Open questions

1. *(resolved — option c: both)* `pixi`/`Shader`/`GLShader` get `.mount(target[, z])` (the primitive — add a plane to an existing window's stack; also `canvas.shader(z,…)`) **and** `.show()` (sugar — spawn a bare window + mount). Standalone → `.show()`; over-a-surface → `.mount(c)`. Mirrors `pipe.show()` / `pipe.to()`. Detection: `.show()` self-spawns (nothing to auto-open); `.mount` needs a user-made target. The old detect→open-window branch dies.
2. *(resolved — option b)* Audio controls move off the output window to a **light master-volume chip in the desktop/taskbar chrome** (whenever audio runs), mixer panel (`mixer.show()`, already exists) one click deeper. Decoupled from any drawing window — `audio` is the master, like `wm`. `ensureAudioControls`-on-output-window deleted.
3. *(resolved — option b)* Canvas windows survive soft reset via **identity-reuse** (key = `{id}` or `title+w+h`): match on re-run → reuse window (clear raster, rebind), no match → spawn, unclaimed-after-run → destroy. Uniform across all Canvases; kills auto-exec flicker. Sub-questions for implementation: (i) clear vs keep raster on reuse — leaning clear (re-run redraws); (ii) extend the same scheme to `pipe.show()`/widget windows — out of scope here.
4. *(resolved — option c)* A `Canvas` **cascades** from a corner (offset from the last), editor untouched — handles 1..N surfaces uniformly. Per-identity geometry persistence (Q6 key) means a user's manual placement sticks after first spawn.
5. *(resolved — option c)* Paint overlay (z=50) + TextLayer (z=51) register through `wm.layer`; WM owns composite order via the stack. Cheap because composite logic already lives in wm.js and already body-walks the canvases (wm.js:516-560); recorder.js is already a dumb blitter.
