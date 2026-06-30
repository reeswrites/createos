// api-registry.js — single source of truth for all window.* API assignments.
//
// Lifecycle:
//   _registerBuiltin(name, impl) — called at app startup for each built-in API
//   registerAPI(name, impl, blocks?)  — called by users / plugins to override/extend
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

// ── Blocks / toolkit extensibility hooks ─────────────────────────────────────
// Set by blocks.js and completions.js respectively after they initialise.

let _blocksApplier = null;
let _toolkitApplier = null;
const _pendingBlocks = [];
const _pendingToolkit = [];

function _applyBlocks(name, blocksDefs) {
  if (_blocksApplier) {
    _blocksApplier(name, blocksDefs);
  } else {
    _pendingBlocks.push({ name, blocksDefs });
  }
}

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

// ── Public API — exposed on window.registerAPI ───────────────────────────────

/**
 * Register or override a window.* API.
 *
 * @param {string} name          The global name (e.g. 'audio', 'draw').
 * @param {*}      impl          The implementation to assign to window[name].
 * @param {object} [ext]         Optional extension descriptor:
 *   ext.blocks  — array of { definition, generator } Blockly block descriptors
 *   ext.toolkit — array of { label, code, hint } snippet entries
 *   ext.category — category name for toolkit entries (default: name)
 *   ext.params  — param-hint signatures: { method: [names] } and/or [names] for a
 *                 callable/constructor. Derived into the editor's param hints.
 *   ext.detect  — { effect, triggers? } usage-detection spec (reserved; see ADR 012).
 */
export function registerAPI(name, impl, ext = null) {
  _registry.set(name, impl);
  window[name] = impl;
  if (ext) _descriptors.set(name, ext);

  if (ext?.blocks?.length) {
    _applyBlocks(name, ext.blocks);
  }
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

// ── Deferred hooks — called by blocks.js / completions.js after they init ────

export function _setBlocksApplier(fn) {
  _blocksApplier = fn;
  if (fn) {
    for (const { name, blocksDefs } of _pendingBlocks) fn(name, blocksDefs);
    _pendingBlocks.length = 0;
  }
}

export function _setToolkitApplier(fn) {
  _toolkitApplier = fn;
  if (fn) {
    for (const { category, entries } of _pendingToolkit) fn(category, entries);
    _pendingToolkit.length = 0;
  }
}
