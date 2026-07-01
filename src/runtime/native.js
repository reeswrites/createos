// native.js — the single renderer-side registry for native (Electron) capabilities.
//
// ADR 049/050: dual-target means every native capability is reached by NAME through
// this one seam — call sites never touch `window.__createos_native` or `window.electron`
// directly, so detection logic lives in one place and there is one jsdom-mockable point
// for tests. The browser build simply registers nothing native, so `nativeCap(name)`
// returns null and the call site falls back to its browser path.
//
// Two sources, checked in order:
//   1. the in-process registry Map (programmatic / test mocks)
//   2. the preload bridge `window.__createos_native` (real Electron, contextBridge)
//
// This module imports NOTHING from Electron — it is safe to load under jsdom/vitest,
// where `window.__createos_native` is simply undefined.

const _caps = new Map();

/**
 * Register a native capability implementation by name. Used by the browser build to
 * supply browser-native impls, and by tests to mock the Electron bridge. Real Electron
 * capabilities arrive via the preload bridge instead (no explicit register call needed).
 * @param {string} name
 * @param {Function} fn
 */
export function registerNativeCapability(name, fn) {
  _caps.set(name, fn);
}

/** Remove a registered capability (test cleanup). */
export function unregisterNativeCapability(name) {
  _caps.delete(name);
}

function _bridge() {
  return typeof window !== 'undefined' ? window.__createos_native : undefined;
}

/**
 * Resolve a native capability to a callable, or null if unavailable in this build.
 * Registry takes precedence over the preload bridge so tests can override.
 * @param {string} name
 * @returns {Function|null}
 */
export function nativeCap(name) {
  if (_caps.has(name)) return _caps.get(name);
  const b = _bridge();
  if (b && typeof b[name] === 'function') return b[name].bind(b);
  return null;
}

/** True if running under a build that exposes any native bridge (i.e. Electron). */
export function hasNative() {
  return _caps.size > 0 || _bridge() != null;
}

/**
 * Subscribe to a main-pushed native event (hotkeys, incoming OSC). Returns an
 * unsubscribe fn. No-op (returns a noop unsub) when no bridge — so the browser build
 * wires the same taps harmlessly.
 * @param {string} name
 * @param {Function} cb
 * @returns {Function} unsubscribe
 */
export function onNativeEvent(name, cb) {
  const b = _bridge();
  if (b && typeof b.onEvent === 'function') return b.onEvent(name, cb);
  return () => {};
}
