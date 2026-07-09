# ADR 062 — Pipe opts-object Inline Control (generic-by-inference)

**Status**: Implemented
**Date**: 2026-07-08
**Follows**: ADR 061 (Tier 1 Inline Controls). This is the "pipe opts-object control"
ADR 061 named as an explicit follow-on and deferred. Reuses ADR 061's chain-head
matcher, editor-side registry module, and glyph→popup presentation.

> **Implementation**
> - `inline-controls.js`: `inferOptFields(objExpr)` (pure — infers `{name,kind,value,
>   from,to}` per literal-valued property; `kind` ∈ number/color/text/boolean) and
>   `formatOptValue(kind, value)` (source formatting). Both CodeMirror-free/testable.
> - `inline-widgets.js`: `ObjectControlWidget` (⚙ glyph → popup, one row per field;
>   number input / colour swatch reusing the HSL popup / text / checkbox; per-field
>   single-change write-back with position shift). New Pass 1b in
>   `buildWidgetDecorations` attaches it to a chain-head call whose sole arg is an
>   `ObjectExpression` with ≥1 literal property.
> - +19 tests. Browser-verified.

## Context

ADR 061 shipped Tier 1 Inline Controls for `route()`'s **positional** numeric methods
(`scale`, `clamp/norm/gate`) and explicitly deferred the **pipe stage opts** case —
`pixelate({ blockSize: 8 })`, `ascii({ cols, color })` — because it is a different
shape (an object-field editor, not a positional range) whose value was unproven.

Two facts (verified in the code):

1. **Pipe opts get zero Tier 0 coverage.** `buildWidgetDecorations` iterates
   `call.arguments` and skips any non-`Literal` arg, so the `{ … }` object arg — and
   every value inside it — is never reached. There is no scrubber on `blockSize`'s `8`,
   no swatch on `color`'s `'#0f0'`.
2. **Built-in stages declare no opt-field metadata.** Opts are read ad-hoc
   (`opts.cols ?? 80`); there is no schema to drive a field editor from.

## Decision

Add an **opts-object Inline Control**: a ⚙ glyph after a recognized chain method whose
sole argument is an object literal, opening a popup with **one field per property**.

**Fields are inferred from the object literal, not declared.** Each property's
value-literal type picks the widget: `number` → number input, colour-string → the
existing swatch + HSL popup, other string → text input, `boolean` → checkbox. Zero
metadata; works for built-in *and* user `pipe.register` stages identically.

**This deliberately reverses ADR 061's "bespoke, not generic" stance — for a reasoned
exception.** Generic-by-inference was rejected for Tier 1 *positional* args because
Tier 0 (scrubbers + inlay hints) already covered them, so a generic panel was a
redundant box. Here the opposite holds: Tier 0 covers **nothing** inside the object, so
inference adds genuinely new capability. The test is "does it duplicate an existing
surface," not "is it generic."

**Per-property, not whole-control.** Only literal-valued properties become fields;
non-literal ones (`{ cols: n, color: '#0f0' }`) are silently skipped, and the control
attaches if ≥1 property is literal. This differs from ADR 061's whole-control
all-or-nothing because object properties are **independent knobs**, whereas `scale`'s
four args are one coupled semantic.

**Matches a chain-head call whose sole arg is an `ObjectExpression`** (`chainHead`
non-null). Head-agnostic but pipe in practice (route has no opts-object methods).
Disjoint from ADR 061's positional pass (which needs numeric positional args) and from
the scrubber/swatch pass (which never reaches object properties), so no suppression is
needed.

**Consequence for custom stages:** ADR 061 said a user `pipe.register` stage "gets no
control, falls back to Tier 0." That still holds for *positional* bespoke controls — but
inference now gives a custom stage's **opts** an editor for free, which ADR 061's Tier 0
fallback could not (Tier 0 never reaches object props). A net gain, not a contradiction.

## Considered Options

- **Declared `descriptor.fields` per stage.** Custom stages have it (kept by ADR 060);
  built-ins do not. Rejected: authoring + sync tax on every built-in, and still fails a
  custom stage whose author omitted fields. Inference needs nothing and never drifts.
- **Whole-control all-or-nothing** (any non-literal property suppresses the control).
  Rejected: object properties are independent; a variable `cols` should not hide an
  editable `color`.
- **Bespoke per-stage controls** (a hand-authored panel for pixelate, for ascii, …).
  Rejected: high authoring cost for what is uniformly "a few typed scalars"; inference
  yields the same panel with none of it. Bespoke stays the right call only where the
  args carry *structure* (a coupled range) — that is ADR 061's positional case.
- **Match last-arg object** (support `show(title, { w, h })`). Deferred: sole-arg is the
  stage-opts pattern; multi-arg opts (`show`) can be a later extension.

## Consequences

- New inferred-field mechanism alongside ADR 061's registered-control mechanism; both
  ride the same chain-head matcher, popup, and glyph.
- Colour opts reuse the existing swatch + HSL popup; nesting the colour popup inside the
  control popup works because each popup `stopImmediatePropagation`s its own mousedown,
  so an inner-popup click never reaches the outer's outside-click handler.
- **Limitation**: only a *sole* object argument is matched; `show(title, opts)` and
  other trailing-opts calls are not covered yet.
- Extends the **Inline Control** glossary entry (CONTEXT.md) with the inferred
  opts-object variant.
