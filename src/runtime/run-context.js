// run-context.js — the single owner of the per-run lifecycle fields the codebase
// reads to know "what is running right now": the active editor, the paused flag,
// and the audio-state flags. Replaces ~6 raw window.__ar_*
// globals that a dozen files used to read and several wrote with no accessor.
//
// Deliberately NARROW — lifecycle state only. App-wiring factory handles
// (__ar_instances, __ar_projectManager, widget restorers) and device singletons
// (__ar_mic_*, __ar_video) keep their own owners; they have a different lifetime.
//
// Each field stays BACKED on window.__ar_* as the implementation detail, but every
// reader now crosses this seam: the active-editor and paused idioms that were smeared
// raw across ~25 sites (owner-capture in route/viz/canvas/camera/three-scene/pipeline
// constructors; the paused-raf-gate in input/sensors/shader/pixi/vision loops) all go
// through activeEditorId()/isPaused(). The globals are private state, not the interface.
// See CONTEXT.md "Run Context". (ADR 044 migration completed.)

export function activeEditorId() {
  return window.__ar_active_editor_id ?? null;
}
export function setActiveEditorId(id) {
  window.__ar_active_editor_id = id;
}

export function isPaused() {
  return !!window.__ar_paused;
}
export function setPaused(paused) {
  window.__ar_paused = paused;
}

export function usesAudio() {
  return window.__ar_usesAudio ?? false;
}
export function setUsesAudio(value) {
  window.__ar_usesAudio = value;
}

export function audioReady() {
  return window.__ar_audioReady ?? Promise.resolve();
}
export function setAudioReady(promise) {
  window.__ar_audioReady = promise;
}

export function friendlyError() {
  return window.__ar_friendlyError;
}
export function setFriendlyError(fn) {
  window.__ar_friendlyError = fn;
}
