// run-context.js — the single owner of the per-run lifecycle fields the codebase
// reads to know "what is running right now": the active editor, the active blocks
// editor, the paused flag, and the audio-state flags. Replaces ~6 raw window.__ar_*
// globals that a dozen files used to read and several wrote with no accessor.
//
// Deliberately NARROW — lifecycle state only. App-wiring factory handles
// (__ar_instances, __ar_projectManager, widget restorers) and device singletons
// (__ar_mic_*, __ar_video) keep their own owners; they have a different lifetime.
//
// During migration each field stays BACKED on window.__ar_*, so unmigrated readers
// keep working while callers convert to these accessors file-by-file. The writes all
// flow through here (editor-instance is the sole writer), so there is one source of
// truth even while some reads are still raw. See CONTEXT.md "Run Context".

export function activeEditorId() {
  return window.__ar_active_editor_id ?? null;
}
export function setActiveEditorId(id) {
  window.__ar_active_editor_id = id;
}

export function activeBlocksEditor() {
  return window.__ar_active_blocks_editor ?? null;
}
export function setActiveBlocksEditor(inst) {
  window.__ar_active_blocks_editor = inst;
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
