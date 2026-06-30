# ADR 024 — Text Layer (Persistent Text Objects on WM Windows and Paint)

## Status
Proposed

## Context

The WM paint overlay and standalone `Paint` widget both needed text rendering. The existing paint overlay already had a bare-bones text tool (click → type → rasterize immediately). That approach forecloses editing, moving, or styling text after placement.

Use cases driving this:
- Annotate a camera feed with a live sensor readout that updates each tick
- Place styled titles on a Paint canvas that can be repositioned before flattening
- Overlay rotating/arced text on any WM window for recording

## Decision

### `TextLayer` class (`src/api/widgets/text-layer.js`)

A shared class instantiated by both `_addPaintOverlay` (wm.js) and `Paint` (paint.js). It owns:

- An array of **text object** data records
- A positioned DOM `<div>` per object (for pointer interaction — click, drag, double-click to edit)
- A **mirror canvas** that re-renders all text objects whenever any object changes — used for snapshot/record compositing

### Text object data model

```js
{
  id,           // stable string id
  text,         // string content
  x, y,         // position in overlay coordinate space
  fontSize,     // number (px)
  fontFamily,   // string
  color,        // CSS color string
  bold,         // boolean
  italic,       // boolean
  align,        // 'left' | 'center' | 'right'
  rotation,     // degrees
  kerning,      // letter-spacing in px
  curve,        // null | { type: 'arc', radius: number }  (positive=arc up, negative=down)
  _runScoped,   // boolean — true for programmatic objects, false for interactive
}
```

### Interaction model

- **Click** existing object → select (shows outline + drag handles)
- **Drag** selected object → move
- **Double-click** → enter edit mode (contenteditable cursor)
- **Escape** → deselect / exit edit mode
- **Delete/Backspace** (selected, not editing) → remove object
- **Click empty area** (text tool active) → place new object, enter edit mode

### Font controls

- Size and color: already in the minibar (shared with pen tool) — apply to newly placed text and to selected object
- Font family, bold, italic, alignment: appear in a small **contextual panel** near the selected object; disappear on deselect

### Mirror canvas

`TextLayer` maintains a canvas sized to match the overlay. On every text object change (move, edit, style update), it clears and re-renders all objects via Canvas 2D. Curved text uses per-glyph placement along a circular arc. Rotation uses `ctx.rotate`. Kerning uses `ctx.letterSpacing` (Canvas 2D Level 2).

Snapshot and record code gains a `win._getTextCanvas?.()` alongside the existing `win._getOverlay?.()`. Both are composited in `_snapshotVisual` and `_recordVisual` in that order: base canvases → overlay (raster paint) → text mirror.

### Programmatic API (`wm.addText`)

```js
const t = wm.addText(winId, 'Hello', x, y, {
  fontSize, fontFamily, color, bold, italic, align,
  rotation, kerning, curve,
})
// handle methods:
t.setText(str)
t.setStyle({ fontSize, color, bold, italic, align, rotation, kerning, curve })
t.moveTo(x, y)
t.remove()
// handle events:
t.on('move',     ({ x, y }) => {})
t.on('edit',     ({ text }) => {})
t.on('select',   () => {})
t.on('deselect', () => {})
```

### Reset / lifetime

- **Interactive** objects (placed via the text tool in the minibar): persistent — survive code resets, cleared only via the Clear button or window close.
- **Programmatic** objects (`wm.addText()`): run-scoped — `TextLayer.clearRunScoped()` removes them on every reset. `onReset` in `text-layer.js` drives this.

### Paint widget integration

`Paint` instantiates a `TextLayer` with its main canvas container. The text tool appears in the `TOOLS` array alongside pen/eraser/etc. The same contextual font panel and selection model apply. `paint.addText(text, x, y, opts)` mirrors the `wm.addText` API. The mirror canvas is composited when Paint exports a frame.

## Alternatives considered

- **Raster-only text:** No move/restyle after placement. Rejected — always a trap.
- **SVG text-on-path for curves:** More faithful to bezier curves but requires switching the overlay from `<canvas>` to an SVG layer. Rejected in favour of arc-only canvas rendering. Bezier can extend later via `curve: { type: 'bezier', points: [...] }`.
- **html2canvas for snapshot/record:** Unreliable, slow, CORS issues. Rejected in favour of mirror canvas.
- **Bus events instead of handle `.on()`:** Harder to scope to a specific object. Handle-local `.on()` is self-contained and matches WidgetEvents patterns elsewhere.

## Consequences

- `_snapshotVisual` and `_recordVisual` in wm.js need one extra `drawImage(textCanvas, ...)` call each.
- `_addPaintOverlay` loses its inline `_spawnTextInput` — text tool now delegates to `TextLayer`.
- `TOOLKIT_CATEGORIES` in completions.js gains `wm.addText` entry (blocks coverage gate).
- `CONTEXT.md` gains a **Text Object** and **Text Layer** term.
