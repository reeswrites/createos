// widget-history.js — Shared per-widget undo/redo history
// Used by SpriteEditor, Drumpad.
// The global toolbar undo/redo (wm.undo/redo) remains window-only (geometry/visibility).

let _installed = false;
let _activeHistoryWin = null;

/**
 * Install once from app.js onload. Tracks the last focused widget window and
 * routes Cmd/Ctrl+Z / Cmd/Ctrl+Shift+Z to its _widgetHistory — but only when
 * focus is NOT in a code editor, input, textarea, or contenteditable.
 */
export function installWidgetHistoryKeys() {
  if (_installed) return;
  _installed = true;

  const desktop = document.getElementById('desktop');
  if (!desktop) return;

  const trackActive = (e) => {
    const win = e.target.closest?.('.wm-win');
    if (win?._widgetHistory) _activeHistoryWin = win;
  };
  desktop.addEventListener('mousedown', trackActive, true);
  desktop.addEventListener('focusin', trackActive, true);

  document.addEventListener('keydown', (e) => {
    const meta = e.metaKey || e.ctrlKey;
    if (!meta) return;
    const key = e.key.toLowerCase();
    if (key !== 'z' && key !== 'y') return;
    // Let CodeMirror, inputs, and contenteditable keep native behaviour
    if (e.target.closest?.('.cm-editor, input, textarea, [contenteditable="true"]')) return;
    const hist = _activeHistoryWin?._widgetHistory;
    if (!hist) return;
    const isRedo = (key === 'z' && e.shiftKey) || key === 'y';
    if (isRedo ? hist.canRedo() : hist.canUndo()) {
      e.preventDefault();
      isRedo ? hist.redo() : hist.undo();
    }
  });
}

/**
 * Per-widget undo/redo history. Each widget creates one instance, passing
 * `capture` (returns current state) and `restore` (applies a snapshot).
 *
 * commit() should be called after every mutating action. It is debounced so
 * rapid edits (e.g. pixel-dragging, pad-clicking) collapse into one undo step.
 *
 * A re-entrancy guard (_restoring) prevents restore() from calling commit()
 * when a widget's setters are invoked internally during undo/redo.
 */
export class WidgetHistory {
  constructor({ capture, restore, max = 60, debounce = 350, onChange = () => {} } = {}) {
    this._capture = capture;
    this._restore = restore;
    this._max = max;
    this._debounce = debounce;
    this._onChange = onChange;
    this._undoStack = [];
    this._redoStack = [];
    this._current = capture(); // snapshot before any edits
    this._timer = null;
    this.restoring = false; // public flag: widgets check this to skip recursive commit
  }

  /**
   * Call after any mutating action. Debounced: the pre-mutation snapshot
   * (_current at the time of the FIRST call in a burst) is pushed onto the undo
   * stack once the burst settles. Clears the redo stack.
   */
  commit() {
    if (this.restoring) return;
    // Capture _current before the mutation (or from before this burst started).
    // Because _current is only refreshed when the timer fires, all calls within
    // the debounce window close over the same pre-edit state.
    const snap = this._current;
    clearTimeout(this._timer);
    this._timer = setTimeout(() => {
      this._timer = null;
      this._undoStack.push(snap);
      if (this._undoStack.length > this._max) this._undoStack.shift();
      this._redoStack = [];
      this._current = this._capture();
      this._onChange();
    }, this._debounce);
  }

  undo() {
    if (!this.canUndo()) return;
    clearTimeout(this._timer);
    this._timer = null;
    this._redoStack.push(this._capture());
    const snap = this._undoStack.pop();
    this.restoring = true;
    this._restore(snap);
    this.restoring = false;
    this._current = this._capture();
    this._onChange();
  }

  redo() {
    if (!this.canRedo()) return;
    clearTimeout(this._timer);
    this._timer = null;
    this._undoStack.push(this._capture());
    const snap = this._redoStack.pop();
    this.restoring = true;
    this._restore(snap);
    this.restoring = false;
    this._current = this._capture();
    this._onChange();
  }

  canUndo() {
    return this._undoStack.length > 0;
  }
  canRedo() {
    return this._redoStack.length > 0;
  }
}
