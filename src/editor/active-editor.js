// active-editor.js — the single seam for inserting generated code into the
// active Editor Instance. Widgets (Paint/Sprite/Ascii/Drumpad export buttons,
// the toolkit drawer, blocks) call insertSnippet() instead of reaching into
// `window.__ar_instances.get(id).cm.dispatch(...)` directly. This keeps
// CodeMirror's dispatch shape behind one seam — see CONTEXT.md "Active Editor".

// The active instance is whichever editor most recently ran (set in
// editor-instance.js on execute). `__ar_instances` is a Map keyed by editor id.
import { activeEditorId } from '../runtime/run-context.js';

export function getActiveInstance() {
  const map = window.__ar_instances;
  const id = activeEditorId();
  const active = id != null ? map?.get(id) : null;
  if (active) return active;
  // No editor has run yet (active id unset) — fall back to the primary editor
  // (id=1), then to any sole instance, so snippets land in the editor instead
  // of the clipboard on a fresh session (e.g. the Tutorial's Run button before
  // the user has pressed play once).
  return map?.get(1) ?? (map && map.size ? [...map.values()][0] : null) ?? null;
}

// Append `code` at the end of the active editor's document, padded with blank
// lines, place the cursor at the end of the inserted code, and focus the
// editor. Returns true if inserted. With no active editor, falls back to the
// clipboard so the snippet is never lost; returns false.
export function insertSnippet(code) {
  const inst = getActiveInstance();
  if (inst?.cm) {
    const offset = inst.cm.state.doc.length;
    inst.cm.dispatch({
      changes: { from: offset, to: offset, insert: '\n' + code + '\n' },
      selection: { anchor: offset + code.length + 2 },
    });
    inst.cm.focus();
    return true;
  }
  navigator.clipboard?.writeText(code).catch(() => {});
  return false;
}

// Replace an editor's entire document with `code`. Same cm.dispatch seam as
// insertSnippet, but overwrites instead of appending — the entry point the
// dev/e2e test harness (window.__ar_test.loadCode) drives. Targets `editorId`
// when given, else the active instance. Returns true if replaced.
export function replaceCode(code, { editorId } = {}) {
  const inst = editorId != null ? window.__ar_instances?.get(editorId) : getActiveInstance();
  if (!inst?.cm) return false;
  inst.cm.dispatch({ changes: { from: 0, to: inst.cm.state.doc.length, insert: code } });
  return true;
}
