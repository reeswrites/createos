# ADR 060 — Retire the Blockly blocks modality

**Status**: Implemented
**Date**: 2026-07-08
**Supersedes**: ADR 002 (text↔blocks translation), ADR 011 (blocks-coverage gate),
ADR 037 (blocks round-trip raw-JS passthrough). Removes the blocks half of the
**API Descriptor** (the `blocks:` extension) and of ADR 007's `pipe.register`
authoring surface.

> **Implementation**
> - **Delete `src/blocks/`** (`blocks.js` / `blocks-defs.js` / `blocks-generators.js`
>   / `js-to-blocks.js`, ~4.5k LOC) and `tests/unit/blocks/` (coverage / generators /
>   js-raw-passthrough).
> - **Editor becomes text-only.** `editor-instance.js` loses the mode toggle,
>   `blocksMode`/`blocklyWorkspace`, the blocks DOM area, `_openBlocks`/`_closeBlocks`/
>   `loadBlocksJSON`/`_addBlockToWorkspace`, the `jsToBlocks` restore, the Blockly-sound
>   mute control, and the `blocksJson` half of `serialize()`. `execute()` always reads
>   from CodeMirror.
> - **Coupling sites stripped** (6): `api-registry.js` (`ext.blocks`/`_applyBlocks`/
>   `_setBlocksApplier`), `toolkit-window.js` (lazy palette + `blockType` drag),
>   `pipe-register.js` (`_generatePipeBlock`; keeps the toolkit-snippet half + the
>   `descriptor.fields` schema), `render-pipeline.js` (comment), `library.js`
>   (`library.block` + `_buildBlockDef`/`populateLibraryBlocks`; keeps snippet/wgsl/glsl),
>   `app.js` (`__ar_applyLibraryBlock` wiring). `run-context.js` drops
>   `activeBlocksEditor`/`setActiveBlocksEditor`; `storage-keys.js` drops
>   `editorBlocksOpenKey`.
> - **No migration.** No users; saved `mode:'blocks'` records simply load their
>   `code` (already the canonical, executed text).
> - **Discovery gate re-pointed** to the toolkit: `blocks-coverage.test.js` deleted;
>   `completion-coherence.test.js` remains the toolkit integrity gate (every snippet
>   references a real global; every category has code).

## Context

The IDE ships two authoring modalities: canonical **text** (CodeMirror) and a
**Blockly** blocks mode. Blocks were introduced (ADR 002) as a lower-floor on-ramp,
grown per API category (ADR 005/007/…), gated for coverage (ADR 011), and made
round-trippable (ADR 037). That machinery is ~4.5k LOC plus a standing tax: the
CLAUDE.md doc rule *"every learner-reachable capability needs a blocks expression"*
and the ADR-011 gate force **dual authoring** — every new API must be re-expressed as
a block or explicitly classified, forever.

Three facts undercut the modality:

1. **Blocks are already compiled to text on every run.** `workspaceToCode()` is *how*
   blocks execute; user code is always text. Text is already canonical — the blocks
   surface is a front-end that emits it, holding no program the text form doesn't.

2. **The APIs that most want visual authoring never got blocks.** `route()` and
   `pipe()` — fluent, closure-heavy chains — sit in `BLOCKS_TODO` and always would:
   transliterating a semantically-mixed dot-chain (source / bridge / transform /
   combinator / sink / listener / mutator, all written `.method()`) into flat blocks
   re-skins the flatness instead of resolving it. Blocks are a poor fit for exactly
   the surface that motivated revisiting authoring.

3. **A cheaper answer to both jobs already exists.** Blocks conflate *seeing* code
   with *producing* code without typing. The codebase already solves both without a
   parallel language: **Creative Widgets → Snapshot/Performance → the Active Editor
   seam** (Drumpad/Piano/Paint/Sprite/Ascii emit real, runnable JS), and **token-level
   editors** (number scrubbers, colour swatches). Both are *result-before-notation* —
   you make something first, code is the souvenir — which sidesteps the documented
   Scratch failure where blocks-fluency doesn't transfer to code literacy.

Maintaining a full second authoring language to serve a narrowing slice, while the
motivating APIs are the ones it fits worst, is a bad trade.

## Decision

**Retire the Blockly modality entirely.** Delete `src/blocks/`, the editor mode
toggle, the `blocksJson` serialize half, and the ADR-002/011/037 machinery. The
editor is text-only.

**Commit to *result-before-notation* as the authoring thesis.** Visual authoring is
delivered as **directional projections** of canonical text — never a parallel,
independently-editable mirror. Text stays the single source of truth. The delivery
shape is a tier ladder (illustrative, **not** bound by this ADR):

| Tier | Job | Status |
|---|---|---|
| 0 — token | edit one literal (scrubber, swatch) | built |
| 1 — expression | edit one call's args (micro-widget from `descriptor.fields`) | future ADR |
| 2 — chain | read-only inspector for a `pipe()`/`route()` expression | future ADR |
| 3 — artifact | domain widget → Snapshot/Performance | built |
| 4 — canvas | manipulate rendered result, patch the spawning call | future ADR |

**Re-point the discovery rule.** The CLAUDE.md rule changes from *"needs a blocks
expression"* to *"needs a `TOOLKIT_CATEGORIES` entry"* — the text snippet drawer is
the baseline discovery surface, policed by `completion-coherence.test.js`. Richer
tiers are opt-in per domain, never required. `blocks-coverage.test.js` is deleted;
its only real job was the dual-authoring classification, which no longer exists.

**Keep `descriptor.fields`.** `pipe.register`'s field schema loses its block-generation
consumer but survives as toolkit metadata — and is exactly the metadata Tier 1
micro-widgets will consume. The deletion is a *handoff*, not a loss.

## Considered Options

- **Freeze, don't delete** (keep blocks working, stop requiring new blocks, kill the
  gate). Lower blast radius, reversible. Rejected: with no users there is nothing to
  preserve, and a frozen-but-present modality still carries UI, serialization, and
  ~4.5k LOC of drag on every refactor for zero upside.
- **Deprecate with migration** (auto-convert saved blocks → text on load, keep the
  generator a release as a shim). The right answer *if there were users*; here it is
  ceremony for an empty install base. Rejected as premature.
- **Full bidirectional blocks parity for `route()`** (the original narrow ask).
  Rejected: `route()` is not structurally uniform; a literal per-method mapping erases
  the role distinctions (`.mix()` is two-input, a stateful transform forks the
  execution path) a user must eventually see.
- **General node/patch-cable graph editor** (Max/MSP/TouchDesigner) as the `route()`
  modality. Its topology (fan-in via `.mix()`, multiple `.tap()`) is `route()`'s
  closest structural fit. Rejected: trades one parallel-modality maintenance cost for
  another; presupposes a "signals and ports" model that is not a lower floor for true
  beginners than *sequential text with a visible result*; and an explicit product
  goal is not to become a TouchDesigner clone.

## Consequences

- **Saved blocks projects** load as their `code` (their exact executed text). No data
  loss because text was always canonical; the `mode`/`blocksJson` record fields become
  inert and are dropped on next save.
- **The no-typing on-ramp narrows to what tiers 0 + 3 cover** (token literals; the
  artifact domains — audio/paint/sprite/ascii). The 7 categories that had blocks
  (Audio/Shader/GLShader/PIXI/Vision/Canvas/Media) temporarily lose their non-typing
  path *except* through those widgets. This is the trade recorded here — the bet is
  that tiers 1–2 refill the chain domains, each on its own ADR. `route()`/`pipe()` lose
  **nothing**: they never had blocks.
- **`descriptor.fields`** is now toolkit-only until Tier 1 lands; `pipe.register`'s
  block-generation branch is gone.
- **The `Blockly` dependency** can be removed from the bundle, shrinking it.
- **Follow-on ADRs** own the tier open-questions this ADR deliberately does *not*
  bind: Tier 1's `route()` metadata surface, Tier 2's opaque-segment UX / read-only-vs-
  write-back / sync granularity, and Tier 4's spawn-call patching. Vocabulary
  ("projection", "opaque node", "role-tagged") is seeded there, not here.
