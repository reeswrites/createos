// api-registry.js — single source of truth for all window.* API assignments.
//
// Lifecycle:
//   _registerBuiltin(name, impl) — called at app startup for each built-in API
//   registerAPI(name, impl, ext?)  — called by users / plugins to override/extend
//   _beginRun()    — called at execute() start; snapshots current registry
//   _endRun()      — called at reset(); restores snapshot (rolls back run-scoped overrides)
//
// Plugin registration: plugins should call registerAPI() at page-load time (before any
// run). Their registrations are captured in the snapshot and survive across runs.
// User code calling registerAPI() during a run is rolled back on reset().

const _registry = new Map(); // name → impl (live)
const _descriptors = new Map(); // name → descriptor (params / detect / …) — see CONTEXT.md "API Descriptor"
let _runBaseline = null; // impl snapshot taken at _beginRun(); restored at _endRun()
let _descBaseline = null; // descriptor snapshot, rolled back the same way

// ── Toolkit extensibility hook ───────────────────────────────────────────────
// Set by completions.js after it initialises.

let _toolkitApplier = null;
const _pendingToolkit = [];

function _applyToolkit(category, entries) {
  if (_toolkitApplier) {
    _toolkitApplier(category, entries);
  } else {
    _pendingToolkit.push({ category, entries });
  }
}

// ── Internal — used by app.js at startup ─────────────────────────────────────

export function _registerBuiltin(name, impl, descriptor = null) {
  _registry.set(name, impl);
  window[name] = impl;
  if (descriptor) _descriptors.set(name, descriptor);
}

// Re-apply every registered builtin to window. Defends against a *later* global
// writer clobbering an app builtin with a same-named value: Strudel's evalScope
// blind-writes ALL its exports to globalThis (@strudel/core index.mjs `globalThis[r]=o`),
// and @strudel/core exports `on as pipe` — which shadows the render-pipeline `pipe`.
// Because evalScope runs async during initStrudel(), it lands *after* the synchronous
// _registerBuiltin() calls at boot. Re-asserting from the registry (the source of
// truth for what the app owns) heals `pipe` and any current/future collision with no
// hardcoded name list. Call once strudel init settles. See ADR 035.
export function reassertBuiltins() {
  for (const [name, impl] of _registry) window[name] = impl;
}

// ── Public API — exposed on window.registerAPI ───────────────────────────────

/**
 * Register or override a window.* API.
 *
 * @param {string} name          The global name (e.g. 'audio', 'draw').
 * @param {*}      impl          The implementation to assign to window[name].
 * @param {object} [ext]         Optional extension descriptor:
 *   ext.toolkit — array of { label, code, hint } snippet entries
 *   ext.category — category name for toolkit entries (default: name)
 *   ext.params  — param-hint signatures: { method: [names] } and/or [names] for a
 *                 callable/constructor. Derived into the editor's param hints.
 *   ext.detect  — { effect, triggers? } usage-detection spec (see ADR 058).
 */
export function registerAPI(name, impl, ext = null) {
  _registry.set(name, impl);
  window[name] = impl;
  if (ext) _descriptors.set(name, ext);

  if (ext?.toolkit?.length) {
    _applyToolkit(ext.category ?? name, ext.toolkit);
  }
}

// ── Run lifecycle ─────────────────────────────────────────────────────────────

export function _beginRun() {
  _runBaseline = new Map(_registry);
  _descBaseline = new Map(_descriptors);
}

export function _endRun() {
  if (!_runBaseline) return;

  // Restore all names that existed at run-start
  for (const [name, impl] of _runBaseline) {
    _registry.set(name, impl);
    window[name] = impl;
  }
  // Remove names that were added during the run
  for (const name of [..._registry.keys()]) {
    if (!_runBaseline.has(name)) {
      _registry.delete(name);
      delete window[name];
    }
  }
  // Descriptors roll back the same way — run-scoped registerAPI() descriptors vanish.
  _descriptors.clear();
  for (const [name, desc] of _descBaseline) _descriptors.set(name, desc);
  _runBaseline = null;
  _descBaseline = null;
}

// ── Introspection ─────────────────────────────────────────────────────────────

export function getAPI(name) {
  return _registry.get(name);
}

export function listAPIs() {
  return [..._registry.keys()];
}

export function getDescriptor(name) {
  return _descriptors.get(name);
}

/**
 * Derive editor param-hint entries from registered descriptors — the single source
 * the editor's PARAM_HINTS table now defers to. A descriptor's `params` may be:
 *   { method: [names] }  → 'name.method' entries
 *   [names]              → a bare 'name' entry (callable / constructor signature)
 * @returns {Object<string, string[]>}  e.g. { 'pixi.tick': ['fn'] }
 */
export function deriveParamHints() {
  const out = {};
  for (const [name, desc] of _descriptors) {
    const p = desc?.params;
    if (!p) continue;
    if (Array.isArray(p)) {
      out[name] = p;
    } else if (typeof p === 'object') {
      for (const [method, names] of Object.entries(p)) out[`${name}.${method}`] = names;
    }
  }
  return out;
}

/**
 * Build the audio-usage detection regex from the registry (ADR 058). Every builtin
 * whose descriptor carries `detect: { effect: 'audio' }` contributes a trigger,
 * derived from its registered NAME so a rename can't silently break detection:
 *   - capitalised name → `\bnew\s+Name\b|\bName\s*\.`  — covers BOTH a constructor
 *     (`new Piano`) and a namespace object used via static methods (`Voice.make`);
 *     `Voice` is `typeof 'object'`, so `new Voice` is invalid and only `Voice.` fires.
 *   - lower-case name  → `\bname\s*[.(]`  (audio., note(, midi.…)
 * Plus any literal regex sources in `detect.triggers` (e.g. Strudel's universal
 * `.play()`). Injected into api-detector via setAudioDetectPattern() at boot; the
 * detector keeps a static fallback for the no-boot (test) case.
 * @returns {RegExp|null}
 */
export function deriveAudioDetectPattern() {
  const parts = [];
  for (const [name, desc] of _descriptors) {
    const d = desc?.detect;
    if (d?.effect !== 'audio') continue;
    const isCap = /^[A-Z]/.test(name);
    parts.push(isCap ? `\\bnew\\s+${name}\\b|\\b${name}\\s*\\.` : `\\b${name}\\s*[.(]`);
    for (const t of d.triggers || []) parts.push(t);
  }
  return parts.length ? new RegExp(parts.join('|')) : null;
}

// ── Deferred hook — called by completions.js after it inits ──────────────────

export function _setToolkitApplier(fn) {
  _toolkitApplier = fn;
  if (fn) {
    for (const { category, entries } of _pendingToolkit) fn(category, entries);
    _pendingToolkit.length = 0;
  }
}
