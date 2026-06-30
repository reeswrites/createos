// run-scoped.js — owner-scoped lifecycle for run-created processes.
// See CONTEXT.md: "Run-Scoped Process" / "Run-Scoped Output". ADR 008/009.
//
// A process created during a run must tear down when ITS OWNING editor resets —
// and only then, so resetting editor B never kills editor A's work. Before this
// module ~12 subsystems each re-derived the same three facts: tag the handle with
// window.__ar_active_editor_id, hold it somewhere, and register an owner-filtered
// onReset. This collapses all of that into ONE module-level Set + ONE onReset.
//
//   runScoped({ owner, onStop })        — owner-scoped teardown, no keep-alive.
//                                          Used by INPUTS (camera/mic leases) which
//                                          must NOT join keep-alive (see CLAUDE.md).
//   runScopedOutput({ owner, onStop, token }) — runScoped + keep-alive membership.
//                                          Used by visible OUTPUTS (route, pipe, viz…).
//
// Both return a handle with one idempotent dispose() reachable from BOTH triggers:
// the global onReset (filtered by owner) and the caller's own .stop()/_destroy.
// Teardown lives once, in onStop.

import { onReset } from './reset-registry.js';
import { liveOutput } from './keep-alive.js';
import { activeEditorId } from './run-context.js';

const _handles = new Set();

/**
 * Register an owner-scoped run process.
 * @param {object}   opts
 * @param {number?}  opts.owner  Owning editor id. Defaults to the Active Editor at
 *                               call time (eager). Pass explicitly when creation is
 *                               async and the active editor may drift before binding
 *                               (e.g. camera open() awaits — capture owner post-await).
 *                               null → torn down on every reset (tests / no context).
 * @param {function?} opts.onStop  Teardown body. Runs once, on dispose.
 * @returns {{ owner:number|null, dispose:()=>void, get disposed():boolean }}
 */
export function runScoped({ owner = activeEditorId(), onStop } = {}) {
  const h = {
    owner: owner ?? null,
    _disposed: false,
    get disposed() {
      return h._disposed;
    },
    dispose() {
      if (h._disposed) return;
      h._disposed = true;
      _handles.delete(h);
      try {
        onStop?.();
      } catch (e) {
        console.error('[run-scoped] onStop failed:', e);
      }
    },
  };
  _handles.add(h);
  return h;
}

/**
 * Register an owner-scoped run process that is ALSO a visible output, so it joins
 * the keep-alive Set that holds a run alive while something is on screen.
 * dispose() releases keep-alive in the same idempotent step (after onStop).
 * @param {object}   opts
 * @param {number?}  opts.owner   See runScoped.
 * @param {function?} opts.onStop Teardown body.
 * @param {object?}  opts.token   Keep-alive token (default {}). Stays caller-supplied
 *                                because the Signal Graph labels entries by
 *                                token.constructor.name and audio/mixer tag markers.
 */
export function runScopedOutput({ owner = activeEditorId(), onStop, token } = {}) {
  const live = liveOutput(token ?? {});
  return runScoped({
    owner,
    onStop() {
      try {
        onStop?.();
      } finally {
        live.release();
      }
    },
  });
}

// ── The single owner-filtered reset handler (replaces ~12 per-module ones) ──────
onReset((editorId) => {
  // Snapshot: dispose() mutates _handles.
  for (const h of [..._handles]) {
    if (editorId == null || h.owner == null || h.owner === editorId) h.dispose();
  }
});

// ── Diagnostics / test helper ───────────────────────────────────────────────────
export function _scopedCount() {
  return _handles.size;
}
