// tracked-group.js — a leaf for the "module-level tracked collection + onReset
// teardown loop" shape that ~6 subsystems hand-rolled (media layers, recorders,
// screen captures, plugins, data signals, DOM captures). Each had its own Set /
// Array / Map + its own onReset(cleanup) + its own teardown verb; this collapses
// the bookkeeping into ONE Set-backed group that registers its OWN onReset once
// at construction. See ADR 008 (reset handlers).
//
// SIBLING to run-scoped.js — NOT a replacement. run-scoped.js is for OUTPUTS: it
// layers keep-alive on top so the run stays live while something is on screen.
// trackedGroup is for INPUTS / ARTIFACTS (recorders, plugins, data signals,
// captures) that must be torn down on reset but must NOT join keep-alive — a
// running recorder should not, by itself, keep an otherwise-idle sketch alive.
// If your thing is a visible output, use runScopedOutput; otherwise this.
//
//   const g = trackedGroup({ teardown: x => x._destroy() });
//   g.add(obj);      // tracked; returns obj. Set-backed → idempotent.
//   g.remove(obj);   // self-removal (no teardown), e.g. a recorder that ended.
//   g.forEach(cb);   // iterate live items.
//   g.teardownAll(); // dispose every item now (the exported cleanup* helpers).
//
// Owner scoping (opt-in, mirrors run-scoped): pass `owner: true` and each add()
// captures the Active Editor id, so a reset for editor B tears down only B's
// items and leaves A's alone. Default (no owner) → global teardown every reset.

import { onReset } from './reset-registry.js';
import { activeEditorId } from './run-context.js';

/**
 * @param {object}    opts
 * @param {(x:any)=>void} opts.teardown  Per-item teardown. Must be idempotent-safe
 *                                        — the group removes the item before
 *                                        calling it, but the item may also self-remove.
 * @param {boolean}   [opts.owner]        Enable owner scoping (capture activeEditorId
 *                                        on add; reset filters by it). Default false →
 *                                        every item is global (torn down on every reset).
 */
export function trackedGroup({ teardown, owner: ownerScoped = false } = {}) {
  // Set-backed so add() is idempotent (dedupe); owner id rides alongside in a Map.
  const items = new Set();
  const owners = new Map(); // item → owner id (only when ownerScoped)

  function _teardown(x) {
    // Remove first so a teardown that re-enters (self-remove / async onstop) is a
    // no-op, and iteration snapshots stay correct.
    items.delete(x);
    owners.delete(x);
    try {
      teardown?.(x);
    } catch (e) {
      console.error('[tracked-group] teardown failed:', e);
    }
  }

  // One owner-filtered reset handler per group, registered once at construction.
  onReset((editorId) => {
    for (const x of [...items]) {
      const owner = owners.get(x) ?? null;
      if (!ownerScoped || editorId == null || owner == null || owner === editorId) {
        _teardown(x);
      }
    }
  });

  return {
    add(x) {
      items.add(x);
      if (ownerScoped) owners.set(x, activeEditorId() ?? null);
      return x;
    },
    remove(x) {
      items.delete(x);
      owners.delete(x);
    },
    forEach(cb) {
      for (const x of [...items]) cb(x);
    },
    has(x) {
      return items.has(x);
    },
    get size() {
      return items.size;
    },
    // Dispose every item now, ignoring owner — the manual "destroy-all" seam the
    // exported cleanup* helpers (tests / app.js) delegate to.
    teardownAll() {
      for (const x of [...items]) _teardown(x);
    },
  };
}
