# ADR 007: A Composition Chassis for the Creative Widgets

**Status:** Decided
**Date:** 2026-06-25

## Decision

Extract the cross-cutting machinery shared by the four creative widgets
(Paint, SpriteEditor, AsciiEditor, Drumpad) into composable modules instead of
leaving it copy-pasted in each widget:

- **`src/api/widgets/frame-doc.js`** — `FrameDoc`, the DOM-free animation frame model
  (frames + index + transport + onion), element-agnostic via hooks
  (`createBlank`/`copyFrame`/`clearFrame`/`drawThumb`).
- **`src/api/widgets/widget-shell.js`** — `mountWidgetShell()` (WM window + body styling
  + debounced autosave→desktop + WidgetHistory wiring + lifecycle), plus
  `buildFrameStrip()` / `buildTransport()` UI built over a **FrameController**.
- **`src/editor/active-editor.js`** — `insertSnippet()`, the single seam for
  exporting generated code into the active editor (see CONTEXT.md, used by all
  four widgets' export buttons).

Composition, not inheritance: each widget builds its own canvas + tools, then
hands rows to `mountWidgetShell`. Frame widgets additionally build a strip +
transport from their frame controller; Drumpad (no frames) skips those.

## Context

The four widgets were four parallel 550–1260-line files that each
reimplemented six concerns by copy-paste: the animation frame strip, the
play/stop/fps transport, the debounced autosave-to-desktop loop, the
export-to-editor poke, the WM window spawn + lifecycle, and the tool palette.
A bug fix in any of these meant editing up to four files; the frame model had
no test surface because it was only reachable through four separate widget UIs.

## Why composition over a base class

A `CreativeWidget` base class would force Drumpad — which has **no frames**,
only an 8-pad / 16-step sequencer — to inherit a frame model it does not use
(the fat-base-class smell). The four widgets also differ structurally (raster
canvas vs pixel grid vs cell grid vs sequencer), so shared behaviour via
override hooks would need many escape hatches. Composition lets each widget take
exactly the pieces it needs and keeps `FrameDoc` a pure, independently testable
data model.

## FrameController — one interface, two adapters

`buildFrameStrip()` / `buildTransport()` consume a **FrameController**
interface: `count`, `index`, `isPlaying`, `onion`, `go/add/duplicate/
clearCurrent/remove/move`, `play/stop`, `drawThumb`, and an `on(evt,fn)` event
emitter (`mutate` / `select` / `onion` / `tick`).

There are two implementations — and two adapters means this is a **real seam**,
not a hypothetical one:

1. **`FrameDoc`** — owns its own frame array (Paint, AsciiEditor).
2. **`SpriteFrameAdapter`** (in sprite-editor.js) — wraps the public `Sprite`
   class, which already owns the frame model and rendering. SpriteEditor cannot
   use a bare `FrameDoc` because `Sprite` is the single source of the frame
   array and current index (`sp._fi`) that the user's `Sprite` handle exposes;
   the adapter exposes Sprite as a controller without duplicating that state.

## Consequences

- A frame-model bug is fixed once, in `FrameDoc`, with a DOM-free test surface
  (`tests/frame-doc.test.js`) it never had before.
- The strip/transport DOM exists once (`tests/widget-shell.test.js`).
- A fifth creative widget costs its domain logic, not another 600 lines of
  chrome.
- Each widget keeps thin proxy getters (`_frames`/`_fi`/`_fps`/`_onion`) so its
  existing internal references kept working through the migration — the change
  was mechanical and test-guarded (the four widget suites, 184 tests, stayed
  green).
- The Drumpad export path previously called `Array.prototype.find` on
  `window.__ar_instances` (a `Map`) — a latent bug fixed for free by routing
  through `insertSnippet`.
