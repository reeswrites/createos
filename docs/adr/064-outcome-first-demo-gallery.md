# ADR 064 — Outcome-first Demo Gallery

**Status**: Implemented
**Date**: 2026-07-08
**Follows**: ADR 060's *Result-Before-Notation* thesis. This is the discovery-reorg
piece the original handoff raised (open question 7) — orthogonal to the tiers, serving
the same accessibility goal from the entry point.

> **Implementation**
> - `public/demos/index.json`: each demo gains a primary `goal` key.
> - `demo-gallery.js`: `GOAL_ORDER` / `GOAL_LABELS` + pure `groupDemos()` (exported,
>   tested); `_renderInto` renders a headed section per non-empty goal instead of one
>   flat grid.
> - CSS: `.gallery-sections` / `.gallery-section-title` (index.html).
> - +6 tests incl. a data-integrity gate (every demo has a valid `goal`). Browser-verified.

## Context

The Demo Gallery listed all demos in one flat grid. Demos are the strongest onboarding
surface — a whole runnable example is *result before notation* by construction. But a
beginner does not arrive thinking "I want a Vision demo"; they think "I want it to react
to my face." The old grid (and the API-category axis generally) organizes by *how it is
built*, not *what you want to make* — the wrong axis for a first-time user.

## Decision

Group the gallery by **outcome**, using **beginner-facing verbs**, not API category. A
curated 7-bucket taxonomy: **React to your face & hands**, **React to sound**, **Make
music & sound**, **Make it move**, **Play with it**, **Camera effects**, **Paint &
pixels**. Each demo declares a **primary `goal`** in `index.json`; the gallery renders a
headed section per non-empty goal in a fixed order.

**Curated `goal` field, not derived from tags.** A demo has many `tags` (audio, canvas,
vision, game…) but one *outcome*. Deriving a section from tags is ambiguous and would
scatter a demo across sections; a hand-assigned primary goal is precise and editorial —
exactly the judgment onboarding wants. `tags` stay for future search/filter.

**One section per demo** (its primary goal) — no duplicate cards. A demo's other facets
live in its tags.

**Empty buckets don't render**, but stay in the taxonomy so future demos have a home
(today `camera`/`paint` are empty). An unknown/missing goal falls into a trailing
"More" section — never dropped — and a test flags it so the taxonomy can't silently
drift.

## Considered Options

- **Derive sections from existing `tags`.** Zero per-demo editing, but ambiguous (which
  of 5 tags is the section?) and scatters demos. Rejected — outcome is a single
  editorial choice, not a tag.
- **Keep API-category grouping / add outcome as a second filter.** More UI, and the
  API axis is the wrong default for beginners. Rejected for v1; a tag/category filter
  bar can layer on later without disturbing the outcome sections.
- **Reorganize the toolkit (API drawer) too.** The toolkit is a *reference* surface
  (per-snippet), a much larger and lower-onboarding-value change. Deferred — the gallery
  (whole runnable examples) is where result-before-notation lands hardest.
- **Free-form goals per demo.** Rejected — an open vocabulary drifts; the fixed 7-bucket
  set + the integrity test keep the taxonomy coherent.

## Consequences

- Adding a demo now means assigning a `goal` (enforced by the integrity test) — a tiny,
  deliberate editorial step, same discipline as the toolkit-coverage rule (ADR 060).
- The gallery is the first *outcome-organized* surface; the API-drawer reorg and a
  tag/goal filter bar are possible follow-ons that reuse this taxonomy.
- The 7 buckets are a product-voice artifact — renaming/merging them is cheap (labels +
  the `GOAL_LABELS` map), but changing a `goal` *key* means re-tagging demos.
