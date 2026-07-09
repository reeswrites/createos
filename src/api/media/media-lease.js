// media-lease.js — demand-driven refcounted leases for toolbar camera (#camera) + mic analyser.
//
// Pattern mirrors registerSource (device-sources.js) for the refcount and liveOutput
// (keep-alive.js) for the handle shape. Camera/mic are INPUTS, not outputs — do not
// register with liveOutput (see CLAUDE.md). ADR 023.
//
// Usage (window-scoped, e.g. WM window):
//   const lease = acquireCamera();
//   // ... use #camera canvas / window.__ar_video ...
//   wm.window(win.id).onDispose(() => lease.release());
//
// Usage (run-scoped, i.e. user code consumers):
//   acquireCameraRunScoped();   // released automatically on reset — no manual release needed
//   acquireMicRunScoped();

import { runScoped } from '../../runtime/run-scoped.js';
import { refcounted } from './refcounted.js';

let _cameraStart = null,
  _cameraStop = null;
let _micStart = null,
  _micStop = null;

// Toolbar camera/mic are global singletons — one refcount each, firing the
// registered start/stop on the 0→1 / 1→0 edges (indirected so registration can
// land after these instances are built). Owner-scoping stays in the runScoped
// helpers below; the primitive is scope-agnostic.
const _cameraRc = refcounted({ open: () => _cameraStart?.(), close: () => _cameraStop?.() });
const _micRc = refcounted({ open: () => _micStart?.(), close: () => _micStop?.() });

// ── Registration (called by camera.js / mic.js at init time) ─────────────────

export function initCameraLease(start, stop) {
  _cameraStart = start;
  _cameraStop = stop;
}
export function initMicLease(start, stop) {
  _micStart = start;
  _micStop = stop;
}

// ── Lease primitives ─────────────────────────────────────────────────────────

/** Acquire the toolbar camera stream. Returns a handle with release(). */
export function acquireCamera() {
  return _cameraRc.acquire();
}

/** Acquire the toolbar mic analyser. Returns a handle with release(). */
export function acquireMic() {
  return _micRc.acquire();
}

// ── Run-scoped helpers (auto-released on reset) ───────────────────────────────

/**
 * Acquire the toolbar camera for a user-code consumer.
 * The lease is released automatically on every reset — caller need not call release().
 * Guard with a module-level flag to avoid re-acquiring on each frame in a tight loop.
 */
export function acquireCameraRunScoped() {
  const h = acquireCamera();
  // Camera is an INPUT — runScoped CORE (no keep-alive). Owner-scoped so resetting
  // editor B does not drop a lease editor A's still-live output depends on. The lease
  // handle's own release() is idempotent, so a manual release before reset is safe.
  runScoped({ onStop: () => h.release() });
  return h;
}

/** Acquire the toolbar mic for a user-code consumer. Auto-released on reset. */
export function acquireMicRunScoped() {
  const h = acquireMic();
  runScoped({ onStop: () => h.release() });
  return h;
}

// ── Diagnostics ──────────────────────────────────────────────────────────────

export function getCameraCount() {
  return _cameraRc.count;
}
export function getMicCount() {
  return _micRc.count;
}

// Reset teardown is owned by run-scoped.js (owner-filtered onReset) — see ADR 008.
