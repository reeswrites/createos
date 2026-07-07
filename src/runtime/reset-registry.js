// reset-registry.js — the single registry of teardown handlers run on every
// execution reset. Each API module registers its own cleanup beside its own
// code via onReset(); editor-instance.js calls runResetHandlers() in reset()
// (soft and hard) instead of hand-maintaining (and duplicating) a 27-entry
// call list. New subsystem → onReset(cleanupX) in its module, nothing else.
// See ADR 008.

const _handlers = [];

// Register a teardown handler. Idempotent per function reference (ES modules are
// singletons, so a module's top-level onReset call runs exactly once anyway).
export function onReset(fn) {
  if (typeof fn === 'function' && !_handlers.includes(fn)) _handlers.push(fn);
}

// Run every registered handler. One throwing handler must not abort the rest —
// a leaked subsystem is bad, but a half-finished reset is worse.
//
// editorId (optional): the id of the editor instance being reset. Handlers that
// track per-editor outputs (e.g. route.js) use it to tear down only their own
// editor's artifacts, so running one editor does not kill another editor's live
// outputs. When omitted (undefined), handlers fall back to a full global reset.
//
// soft (optional): true for an auto-execute soft reset (output windows should
// survive — ADR 040 Canvas identity-reuse), false/undefined for a hard reset/stop
// (tear everything down). Most handlers ignore it; Canvas uses it to keep its
// window across re-runs instead of flash-rebuilding it every ~1s.
export function runResetHandlers(editorId, soft = false) {
  for (const fn of _handlers) {
    try {
      fn(editorId, soft);
    } catch (e) {
      console.error('[reset] handler failed:', e);
    }
  }
}

// Test/inspection helper.
export function _resetHandlerCount() {
  return _handlers.length;
}
