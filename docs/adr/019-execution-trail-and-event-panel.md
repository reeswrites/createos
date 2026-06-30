# ADR 019 — Execution Trail + Event Stream Panel

**Status**: Implemented  
**Date**: 2026-06-26

---

## Context

The runtime has no live observability into code execution beyond `console.log`. Two gaps:

1. **No visual feedback of which lines are running.** Learners and power users cannot see which callbacks are firing, which branches are taken, or which lines are hot vs cold. The canvas shows *output* but not *execution*.

2. **No event stream visibility.** The bus carries all runtime activity (`beat:tick`, `midi:note:on`, `window:key:press`, user `emit()` calls) but there is no way to observe this flow without manually adding `console.log` around every subscriber.

---

## Decision

### 1. Execution Trail (line highlight)

Inject `window.__ar_trace(line)` calls before each statement at execute time via the AST transform pipeline (see §3). The trace function:

- Adds the line number to a dirty `Set`
- Flushes the Set once per RAF via a persistent `requestAnimationFrame` loop
- Dispatches a CM6 `StateEffect` that adds a highlight `Decoration` to each dirty line
- Schedules removal of that decoration after **800 ms** via `_nativeSetTimeout`

Hot lines (firing ≥60×/sec) never get a chance to fade — they glow permanently while active. Cold lines (one-shot setup) flash once and fade. This emergent behavior serves both the pedagogical (D) and observability (B) use cases without explicit heatmap mode.

**Toggle**: a button in the console label row (alongside the existing hide button). Auto-on by default. State persisted to `localStorage` per editor instance (`vl-trace-{id}`).

### 2. Event Stream Panel

A floating WM window (`wm.spawn(...)`) showing a live filtered feed of bus events. Layout: header row with filter input + clear button; scrolling list of event rows.

**Bus tap**: `addBusTap(fn)` / `removeBusTap(fn)` exported from `bus.js`. Taps are called from `_fire()` before subscribers. Not run-scoped, not clearable by `clearRunScoped()`. The panel registers one persistent tap.

**Run-scope filter**: panel ignores events when `window.__ar_active_editor_id == null` (no run active). User can override via the filter input.

**Rate limiting**: one row per unique event name. On repeat fires within 200 ms, the existing row's counter badge increments (`×N`) and payload updates in place. After 200 ms quiet, the next fire creates a new row at the top. This keeps `beat:tick` readable.

**Rows**: expandable. Collapsed = `event:name ×N  {truncated payload}` on one line. Click to expand full payload as a shallow JSON tree (depth 2, arrays truncated at 5 items).

**Default filter**: excludes `editor:`, `session:`, `wm:` prefixes. User edits the filter string inline.

### 3. AST Transform Pipeline

`live-patch.js` is refactored to export `transformCode(code, visitors)`. One Esprima parse, multiple visitor passes applied in registration order. Returns the transformed string.

Each transform registers an object `{ Statement?, ForStatement?, WhileStatement?, … }` — the same node-type hooks Esprima's `parseScript` visitor supports. `live-patch.js` registers the loop-protection visitor; a new `live-trace.js` registers the trace visitor.

`editor-instance.js` composes them:

```js
import { transformCode } from './live-patch.js';
import { traceVisitor }  from './live-trace.js';

// At execute time (when trace is enabled):
const patched = transformCode(code, [loopProtectionVisitor, traceVisitor]);
```

When trace is disabled the `traceVisitor` is simply omitted — zero injection, zero overhead.

---

## Consequences

- **`bus.js`** gains `addBusTap` / `removeBusTap` (3 lines in `_fire()`). Existing bus behaviour unchanged.
- **`live-patch.js`** becomes a visitor-pipeline host. Loop protection becomes `loopProtectionVisitor` (same logic, new shape). `addInfiniteLoopProtection(code)` becomes a thin wrapper over `transformCode(code, [loopProtectionVisitor])` for backwards compat.
- **`editor-instance.js`** gains: trace toggle button in console row, `_traceEnabled` flag, a CM6 `StateEffect`/`StateField` for highlight decorations, and a `_nativeRAF` loop for flush.
- **New file `src/editor/live-trace.js`**: exports `traceVisitor` and `window.__ar_trace` implementation.
- **New file `src/api/wm/event-panel.js`**: WM window, tap registration, rate-limit logic, row render.
- Decorations use a new CSS class `.ar-trace-line` — a left-border or background tint that fades via `@keyframes`. Color should be distinct from the existing error-line highlight.
- Trace toggle state stored as `vl-trace-{id}` in localStorage so preference survives reload.
- No impact on blocks mode — trace only applies to text-mode execution.
- Shaders (`GLShader`, `Shader`) run on GPU; no JS statements to trace. Lines calling `.start()` or `new Shader(...)` will trace normally; the GPU body will not.

---

## Alternatives Rejected

- **Stepping / breakpoints**: destructive for event-driven code tied to Tone.js transport. Pausing a `tick()` callback freezes audio. Trail gives observability without pausing.
- **Value probes (quokka-style)**: weak fit — canvas output is the primary feedback loop; `console.log` already serves the variable-inspection case.
- **Wildcard `'*'` subscription**: bus tap is semantically distinct from a subscription (observability infra, not user logic). Tap keeps the subscriber model clean.
- **Two-pass AST transform**: double parse, line-number offset problems from first-pass injections. Single-parse visitor pipeline avoids both.
