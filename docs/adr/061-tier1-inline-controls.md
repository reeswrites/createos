# ADR 061 — Tier 1 inline controls: bespoke per-call editing for `route()` chains

**Status**: Accepted (design) — not yet implemented
**Date**: 2026-07-08
**Follows**: ADR 060 (retired Blockly; committed to *Result-Before-Notation* tiers).
This is the Tier 1 ("edit one call's args") decision that ADR 060 left to a
follow-on. Reuses the AST-attach + write-back machinery of the Tier 0 inline
widgets (`inline-widgets.js`).

## Context

ADR 060 deleted Blockly and committed to delivering visual authoring as
**directional projections** of canonical text, on a tier ladder. Tier 0 (number
scrubbers, colour swatches) and Tier 3 (widgets → Snapshot) already ship. Tier 1
— *edit one whole call's arguments through a purpose-built inline control* — was
named but not designed.

The motivating surface is the `route()` fluent chain, whose transforms hide real
structure behind uniform `.method()` syntax. `.scale(0, 1, 0, 100)` is *two
coupled ranges* (an input range mapped to an output range), but Tier 0 shows it as
four identical, unrelated scrubbers.

Two things about the existing code shape the decision:

1. **The attach/edit machinery already exists.** `buildWidgetDecorations`
   (`inline-widgets.js`) parses the doc with esprima, walks `CallExpression`s, and
   attaches `WidgetType` decorations that `view.dispatch` edits back to precise arg
   char-ranges. Tier 0 scrubbers and swatches are exactly this. Tier 1 needs a new
   *control*, not new infrastructure.
2. **Chained methods have no metadata and no resolver.** `calleePath`
   (`param-hints.js`) resolves `a.b.c` identifier chains but returns `null` for
   `route(cam).scale(...)` — the callee's object is a `CallExpression`. So route
   transforms today have neither param hints nor a way to be named by the matcher.

## Decision

**Tier 1 is bespoke, semantic controls — not a generic auto-panel.** A generic
"labeled field per arg" panel is redundant: inlay hints already print each param
name and scrubbers already drag each numeric literal, so a generic panel is those
two features in a floating box. The only thing that justifies Tier 1 as a distinct
tier is a control shaped to the call's *meaning* (a coupled two-range editor for
`.scale`) — something Tier 0 structurally cannot express. `descriptor.fields` is a
red herring for this: it says "cols is a number," not "args 0–1 are one range" — it
carries no semantic-grouping vocabulary.

**Controls are a static, editor-side registry (`Inline Control`).** A control is
CodeMirror DOM (a `WidgetType` that dispatches edits), so it cannot live beside its
runtime API (`route.js`/`render-pipeline.js` must never import `@codemirror/view`).
New `src/editor/inline-controls.js`: `registerInlineControl(headType, method,
builderFn)`, keyed `route.scale` etc. `buildWidgetDecorations` consults it. The set
is **project-shipped**; a user's `pipe.register(...)` custom stage gets **no**
bespoke control (nobody authored one) and degrades to Tier 0 scrubbers. No
runtime control-registration path in v1.

**The matcher anchors on the chain head.** JS is dynamic — there are no types to
say a `.scale` is a route's. So the matcher walks `callee.object` down to the base
`CallExpression` and checks its callee is a known head (`route`/`pipe`); only then
does `headType + methodName` resolve to a control. This is **false-positive-free**
(the head is a registered global) and **naturally scopes** Tier 1 to exactly the
fluent-chain APIs that motivated it — a stray `foo.scale(1,2,3,4)` never matches.
The chain-head resolver is extracted as a shared editor AST helper (beside
`calleePath`) because **Tier 2's chain inspector needs the same walk** — built once
here.

**All-or-nothing literal guard.** A control attaches only if *every* arg it edits
is a `Literal`. Any non-literal (`route(x).scale(lo, 1, 0, 100)`) → no control, and
Tier 0 scrubbers still cover the remaining literal args. A control is present only
when it can fully and safely round-trip.

**Per-arg atomic write-back.** Dragging the range-map emits a single
`view.dispatch({ changes: [...] })` with one change per touched arg's char-range —
preserving the user's exact formatting, spacing, and untouched args. The range-map
is N coupled scrubbers sharing one drag gesture and one dispatch; it does **not**
regenerate/replace the whole arg-list (which would clobber formatting).

**Inline glyph → popup presentation.** A small affordance next to the call (like
the colour-swatch dot) opens the range-map in a floating popup, reusing the
`getColorPopup` pattern. The scrubber is inline-always because it is *tiny*; a
coupled-range editor is popup-sized, so inlining it for every call would reflow the
document into a wall of widgets.

**v1 scope: route positional-numeric methods only.**

| Method | Args | Control |
|---|---|---|
| `scale(a,b,c,d)` | 4 numbers | two coupled ranges (in→out) |
| `clamp`/`norm`/`gate(lo,hi)` | 2 numbers | one min–max range (shared widget) |

Two control types over four methods — proves the registry holds >1 shape and that
controls compose, at trivial cost over `scale` alone. Single-arg methods
(`threshold`/`smooth`/`strobe`) stay on Tier 0 (a 1-number control is just a
scrubber). **`mix` is excluded from Tier 1 entirely** — `mix(otherSrc, combineFn)`
takes a route and a function, never literals, so it never satisfies the guard and a
"fader" has no numeric weight to edit; if ever addressed it needs a different
mechanism.

## Considered Options

- **Generic auto-panel from param metadata / `descriptor.fields`.** Rejected:
  redundant with inlay hints + scrubbers; adds a floating box around features that
  already exist. Bespoke controls are the only real lift.
- **Method-name heuristic matcher** (any `.scale` with 4 numbers). Rejected:
  false-positives on unrelated objects; can't distinguish a route's `.scale`.
- **Register controls beside the runtime API** (route.js owns its control).
  Rejected: drags `@codemirror/view` into the signal-graph layer.
- **Partial/locked controls** for non-literal args. Rejected: half-broken widget,
  and positioning the other handles would require *reading* the variable's value,
  impossible at edit time.
- **Whole-arg-list regenerate** on edit. Rejected: clobbers user formatting and
  comments inside the call.
- **Include `mix` / pipe opts-object stages in v1.** Rejected for v1: `mix` doesn't
  fit the literal model at all; pipe stages take an **opts object**, a *different*
  mechanism (object-field editor) whose bespoke value is weakest — its own
  follow-on decision, not a free ride here.

## Consequences

- New `src/editor/inline-controls.js` (registry + the `scale` and `(lo,hi)`
  control builders) and a shared chain-head AST resolver beside `calleePath`.
  `buildWidgetDecorations` gains a chain-aware pass; the runtime layer is untouched.
- The chain-head resolver is **shared infrastructure with Tier 2** — its inspector
  walks the same route/pipe chains. Tier 2 should build on it, not re-derive.
- **Custom `pipe.register` stages have no bespoke control** by design — Tier 0 only.
  This is the accepted asymmetry between project-shipped and user-defined methods.
- **Follow-on ADRs**: the **pipe opts-object control** (object-field editor over
  `{name: value}` stage opts) and **Tier 2** (read-only chain inspector). `mix` is
  parked indefinitely.
- Introduces the **Inline Control** glossary term (CONTEXT.md), distinct from the
  Tier 0 scrubber/swatch (single token) and Tier 2 inspector (whole chain,
  read-only).
