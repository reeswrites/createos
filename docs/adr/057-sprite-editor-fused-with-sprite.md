# ADR 057 — SpriteEditor and Sprite are one fused module (drop the nominal seam)

**Status**: Accepted
**Date**: 2026-07-06

> **Decision note**: `Sprite` (`sprite.js`) and `SpriteEditor` (`sprite-editor.js`) are treated as a **single coupled module**, not two modules across a private seam. The `drawFrameTo`/`drawImageToFrame` methods stay as convenience utilities, but they are **not** an encapsulation seam between the editor and the sprite — the editor accesses `_frames`/`_fi`/`_dctx`/`_render` directly and that is fine. Comments claiming these methods "keep `_frames` private" were corrected; no code was rewritten.

## Context

The 6th architecture-deepening pass (2026-07-06) flagged the `Sprite`↔`SpriteEditor`
relationship as a **nominal seam**: `sprite.js` advertised a "private" `_frames` array
reachable only through `drawFrameTo`/`drawImageToFrame`, but the primary consumer —
`SpriteEditor` — tunnels the internals at 15+ sites:

- `sp._w`/`sp._h`/`sp._fi`/`sp._iid`/`sp._scale` (dims, index, playing state);
- `sp._frames` + `sp._render()` in `_snapPixels`/`_applyPixels`;
- `sp._frames`/`sp._dctx.imageSmoothingEnabled` in `_resize` (rebuilds Sprite's frame
  canvases from outside);
- `sp._frames`/`sp._w`/`sp._h` in `_exportCode`/`_exportPng`.

So the seam had the *cost* of an interface (an indirection to learn, comments to keep
true) with none of the *encapsulation benefit* — the editor never actually stayed on
the public side of it.

Two directions were on the table:

1. **Widen** the Sprite interface (`resizeGrid`, `snapshot`/`applySnapshot`,
   `invalidate`) so the editor crosses a real interface and `_frames`/`_dctx`/`_render`
   become genuinely private.
2. **Fuse** — accept that Sprite and SpriteEditor ship together, are versioned together,
   and are tested together; the editor touching Sprite internals is not a leak because
   there is no independent Sprite consumer to protect the internals *from*.

## Decision

**Fuse.** The `Sprite` public surface (`pixel`/`fill`/`clear`/`ctx`/`play`/frame ops)
still exists for **user code** (`new Sprite()` is a documented widget). But between
`Sprite` and its own editor there is no seam to defend — widening it would rewrite ~15
call sites and add methods whose only caller is the editor (one adapter = a hypothetical
seam, not a real one). Fusing is the lower-churn, more honest shape.

**This does not weaken ADR 055.** The *platform* module `desktop-files.js` still never
touches Sprite fields — it calls the widget's registered desktop `open()` handler, which
lives in `sprite-editor.js` and restores frames via `drawImageToFrame`. That platform
seam (widget ↔ desktop registry) is real and stays. What ADR 057 drops is only the
fictional *editor ↔ sprite* seam **inside** the fused module.

## Consequences

- `drawFrameTo`/`drawImageToFrame` remain (thumbnail render + desktop restore door) but
  are documented as convenience methods, not privacy boundaries.
- SpriteEditor may access Sprite internals directly without it being a review finding.
- Future architecture reviews should **not** re-suggest "widen the Sprite seam" — the
  entanglement is by design (see the deletion test: a widened seam would move references
  around, not concentrate complexity).
- If a *second* independent Sprite consumer ever appears (not the editor, not desktop
  restore), revisit — two adapters would then justify a real seam.
