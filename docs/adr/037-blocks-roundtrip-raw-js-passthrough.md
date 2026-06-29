# ADR 037 — Unrecognized JS survives the blocks round-trip (raw-JS passthrough)

**Status:** Accepted (implementation pending)
**Date:** 2026-06-28
**Relates to:** ADR 011 (blocks coverage gate), ADR 002 (text-to-blocks translation), ADR 035 (Strudel replaces the in-house pattern engine)

## Context

`src/blocks/js-to-blocks.js` translates text-mode code into Blockly blocks and historically
**"silently skips unrecognized statements"** (its own comment). That collides with the CLAUDE.md
data-loss invariant — *"capability existing in text with NO blocks path causes data loss on mode
switch"* — the moment a text-only API is exposed: write it in text, flip to blocks, it vanishes.

ADR 035 makes Strudel exactly such an API. Strudel is a **text-first DSL**; mirroring its dozen+
function algebra as native Blockly blocks would be lossy, unergonomic, and re-create the very
maintenance burden Strudel was adopted to shed. So Strudel is classified `TEXT_ONLY_INTENTIONAL`
under the ADR 011 gate — which leaves the data-loss hole open unless we close it generally.

The only pre-existing escape hatch is shader-specific (`shader_js_fn` stores
`_src.slice(range)` for an un-decomposable arrow body) — there is no statement-level passthrough.

## Decision

Add a **general raw-JS passthrough block**. When `js-to-blocks` meets a statement it cannot
translate, it **wraps the verbatim source text in the passthrough block** instead of dropping
it; the block's generator re-emits that text unchanged. Text → blocks → text therefore
round-trips **any** unrecognized JS losslessly — Strudel calls included — without a native block
per construct.

## Consequences

- The data-loss invariant holds for Strudel and for every other unrecognized call, not just the
  cases someone remembered to build a block for. The guarantee is general, which is why it earns
  an ADR: a future reader seeing arbitrary JS preserved in block form should know it is deliberate.
- Blocks mode is no longer a strict subset of expressible programs — it can carry opaque text
  islands. That is the accepted trade for never silently losing user code.

## Considered Options

- **Build native Strudel blocks (Path A)** — rejected: lossy for a text DSL, huge surface,
  re-creates the maintenance burden ADR 035 removes.
- **Leave the skip behaviour and just document "don't switch modes"** — rejected: violates the
  data-loss invariant and fails the ADR 011 gate's intent.
