# ADR 008: A Reset-Handler Registry (no hand-maintained cleanup list)

**Status:** Decided
**Date:** 2026-06-25

## Decision

Each API module registers its own teardown function with a central registry
(`src/runtime/reset-registry.js`) via `onReset(cleanupX)`, placed beside its own
code. `editor-instance.js` calls `runResetHandlers()` in both `reset()` and
`_softReset()` instead of hand-maintaining a list of ~27 `cleanupX()` calls.

## Context

The execution-reset path tore down 27 subsystems by calling `cleanupAudio()`,
`cleanupShaders()`, … in a hand-maintained list — and that list was pasted
**verbatim twice** (`reset()` and `_softReset()`). Adding a subsystem meant:
write the cleanup fn, import it into `editor-instance.js`, and add it to *both*
lists. Miss one and you got a leak that only surfaced later as a stale window or
a zombie timer — the hardest class of bug to attribute. `editor-instance.js` had
no business knowing the names of 27 unrelated subsystems.

## Design

```js
// reset-registry.js
export function onReset(fn) { /* dedup + push */ }
export function runResetHandlers() { /* iterate, per-handler try/catch */ }
```

Each module self-registers at load:

```js
// e.g. bottom of src/api/audio/audio.js
onReset(cleanupAudio);
```

`editor-instance.js`:

```js
reset()      { … runResetHandlers(); … }
_softReset() { … runResetHandlers(); … }
```

## Trade-offs

- **Registration order = module load order**, not the old hand-tuned order. This
  is safe because the cleanups are mutually independent and idempotent — each
  disposes only its own subsystem's resources (timers, nodes, DOM, streams) and
  reads no other subsystem's state. (Idempotency was already a documented
  invariant.)
- **Loading guarantee:** a module only self-registers if it is imported. All 27
  owning modules are imported by `src/runtime/app.js` (the composition root) at
  boot — except `draw.js`, which `editor-instance.js` still imports for
  `getDraw`. So every handler is registered before any reset can run. A new
  subsystem must therefore be reachable from the import graph (it already must
  be, to put its API on `window`).
- **Resilience gained:** `runResetHandlers()` wraps each handler in try/catch,
  removing the old silent-cascade failure mode where one throwing cleanup left
  every later subsystem un-cleaned.

## Consequences

- A subsystem's teardown lives next to its setup; the cleanup contract is
  co-located with the thing it cleans.
- New subsystem → `onReset(cleanupX)` in its own module. `editor-instance.js` is
  never touched, and the duplicate list is gone.
- The CLAUDE.md "idempotent cleanup, called every reset" rule is now structurally
  enforced rather than maintained by hand.
