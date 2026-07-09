# ADR 063 — Tier 2 live chain inspector (`route().watch()`)

**Status**: Implemented
**Date**: 2026-07-08
**Follows**: ADR 061 (Tier 1 Inline Controls) / 062 (opts-object). This is Tier 2 of the
*Result-Before-Notation* ladder (ADR 060): "see one whole `route()`/`pipe()` expression."

> **Implementation**
> - `src/api/signal/route-inspector.js`: `openRouteInspector(route, {title, ownsRoute})`
>   spawns a WM window, renders the chain as role-tagged nodes, RAF-updates per-stage
>   values + active-stage glow, freezes to "stopped" on `route._destroyed`. `roleOf` /
>   `fmtVal` exported + unit-tested.
> - `route.js`: `_eval` records `_srcV`/`_outV` + each `_chain[i]._v`/`_at` **only while
>   `_inspecting`** (one boolean check per stage otherwise). New `watch(title)` method.
> - Toolkit entry + CONTEXT glossary. +7 tests. Browser-verified.

## Context

ADR 060's tier ladder named Tier 2 as a read-only chain inspector and left three
questions open (opaque-segment UX, read-only vs write-back, sync granularity). The
handoff described it as "renders stages, lights the active one, … a scoped version of
the Event Stream Panel." The chosen scope is the **live** version — not a static text
projection but a runtime view that lights the active stage and shows values flowing.

The runtime already makes this cheap: a `Route` is fully introspectable — `_src`
(label/kind), `_chain` (`[{name,args,stateful,step}]`), `_sinks`, `_taps`, `_descriptor()`
— and `signalGraph.show()` already renders *all* live routes as a whole graph. What the
runtime did **not** track was per-stage values.

## Decision

Add **`route(...).watch(title?)`**: a WM window rendering *that* route's chain as
role-tagged nodes with **live per-stage values and active-stage lighting**, RAF-updated,
**read-only**. It is a per-chain, detailed sibling of `signalGraph.show()`'s whole-graph
view.

**Source of truth is the live route object, not parsed text.** Because it is a *live*
view, the panel reads `_src`/`_chain`/`_sinks` directly and renders per-stage values from
instrumentation — no AST parse, no `chainHead`. (Tier 1's editor-side `chainHead` matcher
is for text-anchored controls; Tier 2 live is a runtime panel.)

**Per-stage values via opt-in instrumentation.** `_eval` records the source value, each
`_chain` step's output, and the final output **only while `route._inspecting`** — set by
`watch()`, cleared on close. Non-watched routes pay one boolean check per stage. This
avoids a value-forwarding channel or bus taps; the panel RAF-reads the recorded fields.

**Roles, resolved answers to ADR 060's open questions:**
- *Opaque segments (Q2)*: an op with no known role renders as a **muted node carrying its
  op name and live value** — honest about position and identity, just not role. "Opaque"
  means *no role*, not *invisible*; not collapsed into a "…" gap (which would hide how
  many steps there are).
- *Read-only (Q3)*: **yes.** It is a runtime observation; text stays canonical, and there
  is no meaningful write-back of a live value.
- *Sync (Q4)*: **RAF**, gated on `isPaused` like other viz — not the editor debounce.
  A live view wants per-frame values.

**Lifecycle.** If the route has no sink when `watch()` is called, it adds a no-op driver
sink so `_eval` runs (values flow) and *owns* the route — closing the window calls
`_destroy()` (releasing keep-alive). If the route already has real sinks, closing the
window only stops the RAF/inspection and leaves the route running.

**The method is `watch`, not `inspect`.** `inspect` collides with the Node/pretty-format
legacy custom-inspect protocol: a serializer probes `obj.inspect()`, and since the method
returns `this` (chainable), the serializer follows the return value and re-invokes it —
infinite recursion that broke an unrelated assertion the moment the method existed. A
domain method named `inspect` on a serializable, chainable object is a latent trap.

## Considered Options

- **Static structural inspector** (parse text, role-tag, no runtime). Cheaper, a pure
  editor-side projection reusing `chainHead`. Rejected in favour of live per the goal —
  "light the active stage / show values" is the point; static becomes a possible fallback,
  not the build.
- **Editor glyph linked to the running route.** Elegant text↔runtime tie, but mapping one
  text chain to its live instance (multiple routes, re-runs, soft-reset identity) is
  fragile. Deferred; `.watch()` in code is the robust entry.
- **Extend `signalGraph`** (click a graph node to expand its chain). Couples to the graph
  window; `.watch()` is a cleaner standalone entry. Could layer on later.
- **Always-on instrumentation.** Simpler flag-free `_eval`, but pays the record cost on
  every route every frame for a debug feature. Rejected: gate on `_inspecting`.
- **Bus taps / value-forwarding channel** (like the Event Stream Panel). Heavier plumbing
  than recording on the object the panel already holds a reference to. Rejected.

## Consequences

- `route.js` gains `_inspecting` + recorded `_srcV`/`_outV`/`_chain[i]._v`/`_at` fields and
  a `watch` method; the runtime coupling is confined to the `_eval` record + one import.
- **Frame routes** (camera/pipe, which bypass scalar `_eval` and delegate to `pipe()`)
  show structure but no per-stage scalar values — a known v1 limitation.
- The **text↔runtime glyph** entry and a **static** structural fallback are possible
  follow-ons; the active-stage RAF machinery is in place for either.
- Extends the **Inline Control** family conceptually but is its own surface (a WM panel,
  not an editor decoration) — recorded as **Chain Inspector** in CONTEXT.md.
