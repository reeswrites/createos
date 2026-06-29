// bus.js — global event bus. The nervous system of the entire application.
//
// emit(event, data)                         — fires command handler (if any) then notifies subscribers
// subscribe(event, fn, { persistent })      — internal: add a subscriber, returns unsubscribe fn
// registerCommand(event, handler)           — internal: subsystem command handlers only
// registerSource(matchOrEvent, {start,stop})— internal: lazy on-demand event sources (ADR 014)
// getLastPayload(event)                     — internal: last data fired for an event
// clearRunScoped()                          — wipe user-code subscriptions on every reset
//
// Invariant: command handlers NEVER call emit() — they do work and return the
// notification payload. The emit()/fire() split prevents infinite loops.
// See ADR 013.

import { onReset } from '../runtime/reset-registry.js';

const _commandHandlers = new Map(); // event → handler(data) → payload
const _subscribers     = new Map(); // event → Set<{ fn, runScoped }>
const _lastPayloads    = new Map(); // event → last data payload fired
const _sources         = [];        // [{ match, start, stop, count, teardown }] — lazy sources
const _taps            = new Set(); // persistent observer fns (not run-scoped, not clearable)

// Extract the namespace prefix of an event ('wm' from 'wm:spawn').
function _ns(event) {
  const i = event.indexOf(':');
  return i >= 0 ? event.slice(0, i) : event;
}

// Private helpers for lazy-source subscriber counting.
function _srcInc(event) {
  for (const s of _sources) {
    if (!s.match(event)) continue;
    if (++s.count === 1) s.teardown = s.start?.() ?? null;
  }
}
function _srcDec(event) {
  for (const s of _sources) {
    if (!s.match(event)) continue;
    if (--s.count === 0) { s.teardown?.(); s.teardown = null; s.stop?.(); }
  }
}

// Private fire — direct notification to subscribers, no command dispatch.
// NEVER export this function.
function _fire(event, data) {
  _lastPayloads.set(event, data);
  for (const t of _taps) { try { t(event, data); } catch (e) { console.error('[bus] tap error:', e); } }
  const set = _subscribers.get(event);
  if (!set) return;
  for (const entry of set) {
    try { entry.fn(data); }
    catch (e) { console.error('[bus] listener error:', e); }
  }
}

// Public emit — dispatches through command handler (if any), then fires subscribers.
//
// For commandable events: the command handler performs the action. Method bodies
// call notify() to fire subscribers at the exact completion point. emit() does NOT
// fire again after the handler to avoid double-notification.
//
// For notification-only events (no command handler): emit() fires subscribers directly.
// This means emit('beat:tick', {…}) from user code notifies subscribers but does NOT
// affect the Tone.js transport — useful for testing reactive code.
export function emit(event, data = {}) {
  const handler = _commandHandlers.get(event);
  if (handler) {
    try {
      const result = handler(data);
      // Async handlers: surface errors as namespace:error events
      if (result instanceof Promise) {
        result.catch(err => _fire(`${_ns(event)}:error`, { command: event, reason: err?.message ?? String(err) }));
      }
    } catch (err) {
      _fire(`${_ns(event)}:error`, { command: event, reason: err?.message ?? String(err) });
    }
    // Notifications are fired by the method body via notify() — NOT here.
    // This prevents double-notification when the method and command both attempt to fire.
  } else {
    _fire(event, data);
  }
}

// Notify subscribers directly — bypasses command handler dispatch. Use this from
// inside subsystem methods to emit their own lifecycle events without re-entering
// the command handler (which would cause infinite loops). Not exposed to user code.
export function notify(event, data = {}) {
  _fire(event, data);
}

// Add a subscriber. Tagged as run-scoped when an editor run is currently active
// (reuses window.__ar_active_editor_id, the same tag app.js uses for addEventListener).
// Pass { persistent: true } to force non-run-scoped (used by global hold()).
// Returns an unsubscribe handle that also decrements the lazy-source count.
export function subscribe(event, fn, { persistent = false } = {}) {
  _srcInc(event);
  const runScoped = !persistent && window.__ar_active_editor_id != null;
  let set = _subscribers.get(event);
  if (!set) { set = new Set(); _subscribers.set(event, set); }
  const entry = { fn, runScoped };
  set.add(entry);
  return () => { set.delete(entry); _srcDec(event); };
}

// Register a command handler for a system event. Internal use by subsystems only —
// not exposed to user code. Each commandable event has exactly one handler.
export function registerCommand(event, handler) {
  _commandHandlers.set(event, handler);
}

// Register a lazy event source. On 0→1 subscribers: calls start() (may return a teardown fn).
// On 1→0 subscribers: calls teardown (if any) then stop(). Internal use by input.js / device-sources.js.
// matchOrEvent: string for exact-match, or a function (event) => bool for prefix/pattern matching.
export function registerSource(matchOrEvent, { start, stop } = {}) {
  const match = typeof matchOrEvent === 'function' ? matchOrEvent : (e) => e === matchOrEvent;
  _sources.push({ match, start: start ?? null, stop: stop ?? null, count: 0, teardown: null });
}

// Return the last payload fired for an event, or undefined. Used to seed hold() initial state.
export function getLastPayload(event) {
  return _lastPayloads.get(event);
}

// Does anyone subscribe to this exact event? `runScopedOnly` restricts the check
// to subscriptions created during the current editor run (user-code on()/tick()),
// ignoring persistent system listeners — i.e. "is the running sketch listening?".
export function hasSubscribers(event, { runScopedOnly = false } = {}) {
  const set = _subscribers.get(event);
  if (!set || set.size === 0) return false;
  if (!runScopedOnly) return true;
  for (const entry of set) if (entry.runScoped) return true;
  return false;
}

// Add a persistent observer called for every fired event (before subscribers).
// Not run-scoped — not cleared by clearRunScoped(). Returns an unsubscribe fn.
export function addBusTap(fn) {
  _taps.add(fn);
  return () => _taps.delete(fn);
}

// Wipe all run-scoped subscriptions. Called on every editor reset so user-code
// on() listeners from a previous run do not stack and double-fire.
// Also decrements lazy-source counts so sources stop when no persistent subscribers remain.
export function clearRunScoped() {
  for (const [event, set] of _subscribers.entries()) {
    for (const entry of Array.from(set)) {
      if (entry.runScoped) { set.delete(entry); _srcDec(event); }
    }
  }
}

// Self-register bus teardown (ADR 008). session:reset fires before clearRunScoped
// so run-scoped handlers still receive the reset notification.
onReset(() => {
  _fire('session:reset', {});  // fire directly — session:reset has a command handler for artist use
  clearRunScoped();
});
