# ADR 038 — Window-scoped drawing surface (`Canvas`)

**Status**: Accepted
**Date**: 2026-06-29

## Context

The global `draw` object renders to a single layer-0 canvas with a **fixed 1600×900 logical backing store, CSS-stretched** to fill its output window (ADR 001; `mountLayerCanvas` in `src/api/layer.js`). Two limits follow from "one fixed canvas":

1. **One size for everyone.** Every sketch shares the same 1600×900 space. There is no way to open a second drawing surface, or one with a different aspect ratio, without leaving the `draw` API.

2. **Pointer coordinates don't match draw coordinates.** `window:mouse:*` reports `e.clientX/clientY` — **viewport pixels** (`src/api/input.js`). `draw` lives in fixed 1600×900. The two are different coordinate systems related only by the output window's current rect. Every interactive sketch (a game, a paint tool, the billiards break demo) must re-derive `getBoundingClientRect()` scaling by hand to turn a click into a canvas coordinate. This is boilerplate, and it is the kind of math the platform should do once.

A tempting "fix" is to make the global canvas *resize its logical space* to the window (the way `Shader`/`GLShader` layers already do via a `devicePixelRatio` `ResizeObserver`). That is the wrong direction for 2D: shaders are written in normalized `uv` 0..1 + a `res` uniform and are resolution-independent by construction, whereas `draw` is absolute-pixel. If the logical space tracked the window, `draw.circle(800, 450, …)` would only be centered at one specific window size, and every sketch's layout would drift on resize. The "Canvas is 1600×900" contract in API.md exists precisely so art reproduces identically across screens and embeds.

A second friction surfaced while wiring an interactive sketch into an output window: output/canvas windows are **body-draggable** (`wm-draggable-body`, added in `editor-instance.js` and `wm.js`). A drag anywhere in the body moves the window — which steals the very drag an interactive sketch needs to read. The body-drag affordance is right for *passive* content (image/video/camera) and wrong for an interactive surface.

## Decision

Add a **window-scoped drawing surface** constructed with an explicit size, defaulting to 16:9.

```js
const c = new Canvas({ w: 800, h: 600, title: 'Pong' });   // default w/h → 1600×900
c.bg('#0a0').circle(400, 300, 40, '#fff');                 // full fluent draw API, scoped
c.pointer                       // { x, y } live, in THIS canvas's 0..w / 0..h space
c.on('down', ({ x, y }) => …)   // 'down' | 'move' | 'up', coords pre-mapped to canvas space
c.winId  c.width  c.height  c.clear()
```

### Coordinate model: fixed logical, CSS-fill

Each `Canvas` keeps a **fixed logical backing store** at the constructed `w×h`, CSS-stretched to fill its window body — the same model as the global canvas, but with a per-instance size. Coordinates are stable on resize: `circle(400, 300, …)` stays put regardless of window dimensions. We explicitly **reject** native-resize (backing store tracks window px), which would give 1:1 pointer mapping at the cost of layouts that drift on resize.

### Pointer is delivered pre-mapped

The surface subscribes to the **window-scoped** mouse events for its own window (`wm:{winId}:mouse:*`, which `input.js` already emits relative to `.wm-body`) and divides by the body rect, multiplying by the logical `w×h`. The sketch reads `c.pointer` / `c.on('down'|'move'|'up')` in **canvas-logical coordinates** — never `getBoundingClientRect()`. This is the entire reason the surface owns its window: a window-scoped surface can map its own pointer; the global `draw` cannot, because it does not own a window.

### Reuse `DrawTarget` unchanged

`DrawTarget` (`src/api/draw.js`) is already parameterized by `(z, getLayerCanvas)` — it resolves its canvas through a getter and reads `width`/`height` off whatever canvas comes back. `Canvas` constructs `new DrawTarget(0, () => myCanvas)` over its own `<canvas>`; the full fluent API works against it with no change to `draw.js`. `Canvas` adds only the window + pointer + lifecycle wrapper.

### Body-drag yields to a mouse-claiming sketch (enabling sub-decision)

The `wm.js` body-drag handler now bails when the running sketch subscribes to mouse events for that window — `hasSubscribers('window:mouse:*' | 'wm:{winId}:mouse:*', { runScopedOnly: true })`. Titlebar and hover-strip drags still move the window; only body-drag yields, and only while a sketch is listening. This makes an interactive `Canvas` usable (its body drives the sketch, not the window) and is checked per-event against live subscriptions rather than guessed at spawn time. A new `hasSubscribers()` was added to `src/events/bus.js` for this. (Shipped with this ADR; covered by `tests/event-bus.test.js`.)

### Lifecycle

`Canvas` is **run-scoped**: created during a run, torn down on reset (`onReset`) and on window close. While a sketch is actively driving it (an event subscription or draw loop alive), it holds a `liveOutput` keep-alive so the run does not idle out — the same contract as other outputs (ADR 009 / run-scoped module). Closing the window stops the surface; resetting the editor disposes it.

## Consequences

- Sketches can open **multiple** drawing surfaces, each with its own size and aspect ratio. The 1600×900 monopoly is gone without sacrificing per-surface coordinate stability.
- Interactive 2D becomes first-class: `c.pointer` and `c.on(...)` are in the same coordinate space as the draw calls, so input→draw needs no rect math.
- The global `draw` and the layer z-stack are **unchanged** — `Canvas` lives alongside them, not instead of them. Existing sketches keep working.
- New public surface: `window.Canvas`. The constructor signature and the `pointer` / `on('down'|'move'|'up')` shape are now a commitment, and must carry an API.md entry, a toolkit entry, and a blocks expression (CLAUDE.md doc + blocks-coverage rules).
- `hasSubscribers()` is now public bus API. The body-drag-yield is a non-obvious wm invariant: a window stops being body-draggable while its sketch listens to the mouse. Documented in CLAUDE.md wm gotchas.
- The pointer coordinate mapping assumes the canvas fills its window body (CSS `100%`). Letterboxing (preserving aspect when the window aspect differs from `w:h`) is **not** in scope here — the canvas stretches; if a future surface wants letterboxing, the mapping must account for the inset bars.
