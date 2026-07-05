# ADR 055 — Desktop File-Type Adapter registry

**Status**: Implemented
**Date**: 2026-07-04

> **Implementation note**: New leaf `src/api/platform/desktop-file-registry.js` (`registerDesktopFileType(type, { glyph, cssClass, open })`, `getDesktopFileType`, `isDesktopFileType`, `desktopFileGlyphs`, `desktopFileCssClass`). Each widget registers its own type beside its module (drumpad → `beat`, launchpad → `launchpad`, piano → `piano`, notepad → `note`, sprite-editor → `sprite`, paint → `paint`, asciiEditor → `ascii`). `desktop-files.js` derives glyph, icon CSS class, double-click open-dispatch, and restore branch from the registry. Added `Sprite.drawImageToFrame(i, img)` so sprite restore no longer reaches into `Sprite._frames`. New `_placeIcon(icon, saved)` helper folds the ~9× position-patch tail.

## Context

`desktop-files.js` enumerated the set of JSON-blob widget file types —
`{beat, launchpad, sprite, paint, ascii, note, piano}` — in six independent places:

1. the `_FA_GLYPH` map (Font Awesome glyph per type),
2. the icon CSS-class ternary in `_buildEl` (7-deep),
3. the `_makeThumb` glyph fallback,
4. the `_activate` double-click open-dispatch (7 `fetch→json→new Widget` branches),
5. the `restoreDesktop` icon-recreate (7 near-identical 15-line blocks),
6. each widget's own `getState().type` literal.

Adding an eighth widget type meant shotgun surgery across all six sites. Worse, the
`_activate` branches reconstructed widget frame state **from outside** — reaching into
`Sprite._frames` + private `Sprite._render()`, smuggling `_frameCanvases` / `_frames`
through undocumented constructor options, replaying `p.note(...)` in a loop. The
"how do I rebuild this widget from its `.vljson`" knowledge lived in `desktop-files.js`
and leaked through widget private fields.

ADR 044 had already solved the same shape for **WM windows** — the Window Type Adapter
registry (`registerWindowType(type, { serialize, restore })`) co-located each window
type's round-trip beside the module that owns its state, so `project.js` stopped
switching on `opts.type`. The desktop-icon half never got the equivalent.

## Decision

Mirror ADR 044 on the desktop side. A leaf **Desktop File-Type Adapter registry**
holds one record per JSON-blob widget file type:

```
registerDesktopFileType(type, {
  glyph,          // Font Awesome class for the desktop glyph
  cssClass,       // the dt-*-icon CSS class
  open(data, pos) // reconstruct + spawn the widget from its saved JSON blob
})
```

Each widget registers its own type at module load (the same "register beside your own
code" discipline as `onReset` / `registerSource` / `registerWindowType`). `open` owns
the widget's **own restore** — frame reconstruction, step replay — so `desktop-files.js`
never reaches across the seam into widget internals.

`desktop-files.js` becomes a consumer of the registry:

- `_faGlyph(type)` = base map (`editor`/`folder`) ∪ `desktopFileGlyphs()`.
- `_buildEl` icon class = `desktopFileCssClass(type)` (base types stay inline).
- `_activate` = one branch: `getDesktopFileType(type)?.open(data, pos)`.
- `restoreDesktop` = one branch: `isDesktopFileType(type)` → the generic blob-icon block.
- `_placeIcon(icon, saved)` folds the repeated position-patch tail.

To keep sprite restore off `Sprite._frames`, `Sprite` gains `drawImageToFrame(i, img)`
(the inverse of the ADR-044-era `drawFrameTo`), so the sprite adapter's `open` paints
restored PNGs through a public seam.

## Consequences

- **Locality**: a widget file type lives in one record beside its widget. Adding a type
  is one registration, not six edits.
- **Leverage**: `desktop-files.js` iterates the registry — one loop, N types. ~150
  duplicated lines deleted from the two type-switches.
- The private reach-ins (`sp._frames`, `_frameCanvases`, `_frames` back-doors) collapse
  into each widget's own `open` closure — reconstruction lives with the state it rebuilds.
- **Test surface**: the registry is a small pure module (`tests/unit/api/platform/desktop-file-registry.test.js`)
  and each widget's registration is asserted on import.
- Bootstrapping: registrations are import side-effects, reachable from app.js's boot
  import graph (same guarantee as `onReset`), so the registry is populated well before
  any double-click or project load runs.

## Alternatives considered

- **`static Widget.fromData(data, pos)`** instead of an `open` closure in the registry
  record. Rejected: the closure already co-locates restore beside the widget and avoids
  adding a second public surface; the registry record *is* the adapter.
- **Leave it** — rejected: the six-site scatter is exactly the friction ADR 044 named,
  and the private reach-ins are a real leak, not a stylistic one.
