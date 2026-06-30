# ADR 043 — Extract pause/resume into a testable PauseController

**Status**: Implemented
**Date**: 2026-06-30

> **Implementation note**: `src/runtime/pause-controller.js` owns the freeze/restore mechanics; `editor-instance.js` constructs one per instance and its `pauseRunning`/`resumeRunning`/`reset`/`stopRunning` delegate to it. `freezeTimers`/`restoreTimers` import moves out of editor-instance into the controller. New `tests/pause-controller.test.js` (12 tests) covers namespace-lazy-resolution, remaining-delay restore, and idempotency. All 1358 tests green.

## Context

Pausing a run must freeze its in-flight `setInterval`/`setTimeout` and, on resume, recreate them with their **remaining** delay through the editor's **namespaced** tracked setters (`window.__ar_e{id}_setInterval`) so the new timers re-register in the editor's `_intervals`/`_timeouts` maps and clear on the next reset.

The pure leaf — `freezeTimers`/`restoreTimers` (`timer-manager.js`) — was tested. But the **orchestration** that picks the namespaced setters, computes remaining delay, and toggles state sat inline in `editor-instance.js` (`pauseRunning`/`resumeRunning`), a 1300-line file with **no test**. That is exactly where a pause bug lives (wrong namespace → leaked/duplicated timers; wrong delay → mis-fire), and nothing covered it.

## Decision

Extract a **`PauseController`**, one per Editor Instance, with a two-method interface `pause()` / `resume()` (plus `clear()` for the hard-reset path and a `paused` getter). Behind it: freeze, remaining-delay restore, and namespace selection.

- Timers (`_intervals`/`_timeouts`), the native clears, and the namespaced setters are **injected**. The setters are passed as a `trackedSetters()` thunk resolved at *resume* time (they live on `window` for the editor's life), so the controller never reaches `window` itself — a test drives it with a fake clock through the same interface (two adapters: native clock in prod, fake clock in test).
- The **idle watcher**, the **UI state-setters** (`_setPaused`/`_setRunning`/`_startIdleWatcher`), and the **global `window.__ar_paused` flag** stay in `editor-instance.js`. They are run lifecycle, not pause mechanics; the flag is the editor surfacing its own Run State globally (other subsystems read it), so it stays a single owned write.

## Consequences

- **The interface is the test surface.** Remaining-delay and namespace correctness are asserted through `pause()/resume()` with a fake clock — the orchestration where bugs hide now has coverage.
- **Locality**: pause mechanics live in one module; `editor-instance.js` shrinks.
- `editor-instance.js` no longer imports `timer-manager` directly — it goes through the controller.

## Out of scope

- Moving the idle watcher or `window.__ar_paused` into the controller — they are lifecycle/global concerns, kept in editor-instance.
