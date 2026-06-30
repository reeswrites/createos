// notepad.js — programmable rich-text window widget.
// Exposed as: new Notepad(opts) and notepad(opts).
// Spawns a WM window with a toolbar + contenteditable surface.
//
// Key invariants:
//   - Windows survive reset (like Drumpad). In-flight type() timers are cleared.
//   - Flat char-offset model: all public API uses textContent offsets, not DOM positions.
//   - Typing animation uses patched window.setInterval (pauses/cleans with the harness).
//   - Formatting via document.execCommand (deprecated-but-universal; see ADR 015).
//   - HTML persisted as sanitized innerHTML (whitelist: b/i/u/br/span/p/div + style:color/bg).
//   - Events on global bus: note:type/char/done/change/cursor/select (+ scoped wm:{id}:note:*).
//   - No WidgetHistory hooks — contenteditable uses native undo (widget-history.js:33 bails).

import { notify, subscribe } from '../../events/index.js';
import { mountWidgetShell, wireCaptureButton } from './widget-shell.js';
import { onReset } from '../../runtime/reset-registry.js';
import { Take } from '../signal/performance-recorder.js';
import { replayActions } from '../signal/replay-clock.js';

// ── Module-level registry ──────────────────────────────────────────────────────

const _notepads = [];

/** Stop in-flight type() animations on all live Notepads (called on reset). Windows survive. */
export function cleanupNotepads() {
  for (const n of _notepads) n._stopTyping();
}

// ── HTML sanitizer ─────────────────────────────────────────────────────────────
// Whitelist: structural tags (b,i,u,strong,em,br,p,div,span).
// Attribute whitelist: style with only color/background-color properties.

const _ALLOWED_TAGS = new Set(['b', 'strong', 'i', 'em', 'u', 'br', 'span', 'p', 'div']);

function _sanitize(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  _cleanNode(tmp);
  return tmp.innerHTML;
}

function _cleanNode(el) {
  for (let i = el.childNodes.length - 1; i >= 0; i--) {
    const child = el.childNodes[i];
    if (child.nodeType === 3) continue; // text node — keep
    if (child.nodeType !== 1) {
      el.removeChild(child);
      continue;
    } // other — strip
    const tag = child.tagName.toLowerCase();
    if (!_ALLOWED_TAGS.has(tag)) {
      // Unwrap: lift children in place, remove wrapper
      while (child.firstChild) el.insertBefore(child.firstChild, child);
      el.removeChild(child);
    } else {
      // Strip all attrs except whitelisted style props
      const rawStyle = child.getAttribute('style') ?? '';
      const keepStyle = rawStyle
        .split(';')
        .map((s) => s.trim())
        .filter((s) => /^(color|background-color)\s*:/i.test(s))
        .join(';');
      while (child.attributes.length) child.removeAttribute(child.attributes[0].name);
      if (keepStyle) child.setAttribute('style', keepStyle);
      _cleanNode(child);
    }
  }
}

// ── DOM helpers ────────────────────────────────────────────────────────────────

/** Map a flat textContent offset to { node, nodeOffset } for a Range. */
function _offsetToDOM(root, offset) {
  if (!root) return null;
  const walker = document.createTreeWalker(root, 0x4 /* NodeFilter.SHOW_TEXT */);
  let acc = 0;
  let lastNode = null;
  let node;
  while ((node = walker.nextNode())) {
    lastNode = node;
    if (acc + node.length >= offset) {
      return { node, nodeOffset: offset - acc };
    }
    acc += node.length;
  }
  // Offset beyond all text — clamp to end of last text node or root
  if (lastNode) return { node: lastNode, nodeOffset: lastNode.length };
  return { node: root, nodeOffset: root.childNodes.length };
}

/** Map a DOM { node, nodeOffset } back to a flat textContent offset. */
function _domToOffset(root, node, nodeOffset) {
  if (!root || !node) return 0;
  const walker = document.createTreeWalker(root, 0x4 /* NodeFilter.SHOW_TEXT */);
  let acc = 0;
  let n;
  while ((n = walker.nextNode())) {
    if (n === node) return acc + nodeOffset;
    acc += n.length;
  }
  return acc;
}

// ── UI builders ───────────────────────────────────────────────────────────────

function _buildToolbar(note) {
  const bar = document.createElement('div');
  bar.className = 'np-toolbar';
  Object.assign(bar.style, {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    padding: '4px 8px',
    background: '#f0ede6',
    borderBottom: '1px solid #ddd8cc',
    flexShrink: '0',
    fontFamily: 'system-ui,sans-serif',
    fontSize: '12px',
    userSelect: 'none',
  });

  // Bold / Italic / Underline
  for (const [label, cmd, title] of [
    ['B', 'bold', 'Bold'],
    ['I', 'italic', 'Italic'],
    ['U', 'underline', 'Underline'],
  ]) {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.title = title;
    Object.assign(btn.style, {
      background: '#e8e4dc',
      border: '1px solid #ccc8be',
      borderRadius: '3px',
      padding: '2px 6px',
      cursor: 'pointer',
      fontSize: '11px',
      fontWeight: 'bold',
      minWidth: '22px',
      lineHeight: '1.4',
    });
    if (label === 'I') btn.style.fontStyle = 'italic';
    if (label === 'U') btn.style.textDecoration = 'underline';
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      document.execCommand(cmd, false, null);
    });
    bar.appendChild(btn);
  }

  // Separator
  const addSep = () => {
    const s = document.createElement('div');
    Object.assign(s.style, { width: '1px', height: '16px', background: '#ccc', margin: '0 2px' });
    bar.appendChild(s);
  };
  addSep();

  // Text color
  const fgLabel = document.createElement('label');
  fgLabel.title = 'Text color';
  Object.assign(fgLabel.style, {
    display: 'flex',
    alignItems: 'center',
    gap: '2px',
    cursor: 'pointer',
  });
  const fgIcon = document.createElement('span');
  fgIcon.textContent = 'A';
  Object.assign(fgIcon.style, { fontWeight: 'bold', fontSize: '12px', color: '#222' });
  const fgInput = document.createElement('input');
  fgInput.type = 'color';
  fgInput.value = '#000000';
  Object.assign(fgInput.style, {
    width: '18px',
    height: '18px',
    border: 'none',
    padding: '0',
    cursor: 'pointer',
  });
  fgInput.addEventListener('input', () => {
    note._el?.focus();
    document.execCommand('foreColor', false, fgInput.value);
  });
  fgLabel.appendChild(fgIcon);
  fgLabel.appendChild(fgInput);
  bar.appendChild(fgLabel);

  // Highlight color
  const hlLabel = document.createElement('label');
  hlLabel.title = 'Highlight';
  Object.assign(hlLabel.style, {
    display: 'flex',
    alignItems: 'center',
    gap: '2px',
    cursor: 'pointer',
  });
  const hlIcon = document.createElement('span');
  hlIcon.textContent = '◼';
  Object.assign(hlIcon.style, { fontSize: '13px', color: '#ffeb3b', lineHeight: '1' });
  const hlInput = document.createElement('input');
  hlInput.type = 'color';
  hlInput.value = '#ffeb3b';
  Object.assign(hlInput.style, {
    width: '18px',
    height: '18px',
    border: 'none',
    padding: '0',
    cursor: 'pointer',
  });
  hlInput.addEventListener('input', () => {
    note._el?.focus();
    document.execCommand('hiliteColor', false, hlInput.value);
  });
  hlLabel.appendChild(hlIcon);
  hlLabel.appendChild(hlInput);
  bar.appendChild(hlLabel);

  addSep();

  // Clear all
  const clearBtn = document.createElement('button');
  clearBtn.textContent = '✕';
  clearBtn.title = 'Clear all text';
  Object.assign(clearBtn.style, {
    background: '#e8e4dc',
    border: '1px solid #ccc8be',
    borderRadius: '3px',
    padding: '2px 6px',
    cursor: 'pointer',
    fontSize: '11px',
    color: '#888',
    lineHeight: '1.4',
  });
  clearBtn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    note.clear();
  });
  bar.appendChild(clearBtn);

  addSep();

  // Capture ● (Performance recording → replay code)
  const capBtn = document.createElement('button');
  capBtn.textContent = '● Rec';
  capBtn.title = 'Capture a performance → replay code';
  Object.assign(capBtn.style, {
    background: '#e8e4dc',
    border: '1px solid #ccc8be',
    borderRadius: '3px',
    padding: '2px 6px',
    cursor: 'pointer',
    fontSize: '11px',
    color: '#c0392b',
    lineHeight: '1.4',
  });
  wireCaptureButton(capBtn, { take: note._take, widget: note });
  bar.appendChild(capBtn);

  return bar;
}

function _buildEditor() {
  const el = document.createElement('div');
  el.className = 'np-edit';
  el.contentEditable = 'true';
  el.setAttribute('spellcheck', 'false');
  Object.assign(el.style, {
    flex: '1',
    overflowY: 'auto',
    padding: '12px 14px',
    fontFamily: 'Georgia,"Times New Roman",serif',
    fontSize: '14px',
    lineHeight: '1.7',
    color: '#2c2c2c',
    background: '#faf8f3',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    outline: 'none',
    cursor: 'text',
    minHeight: '60px',
    boxSizing: 'border-box',
  });
  return el;
}

// ── Notepad class ──────────────────────────────────────────────────────────────

export class Notepad {
  /**
   * @param {object} opts
   * @param {string}  [opts.title='Notepad']
   * @param {number}  [opts.x]
   * @param {number}  [opts.y]
   * @param {number}  [opts.w=380]
   * @param {number}  [opts.h=300]
   * @param {string}  [opts.content='']    initial HTML or plain text content
   * @param {string}  [opts._desktopIconId]  internal: existing icon id for restore
   */
  constructor({ title = 'Notepad', x, y, w = 380, h = 300, content = '', _desktopIconId } = {}) {
    this._title = title;
    this._winId = null;
    this._el = null; // the contenteditable div
    this._desktopIconId = _desktopIconId ?? null;
    this._autoSave = () => {}; // replaced by shell in _init
    this._typingTimers = new Set(); // active type()/backspace() setInterval ids
    this._changeTimer = null; // debounce timer for note:change
    this._selListener = null; // document selectionchange handler
    this._take = new Take(this); // Performance capture (ADR 031)
    this._replaying = false; // gates capture during replay/programmatic apply

    _notepads.push(this);
    this._init(title, x, y, w, h, content);
    if (!_desktopIconId) this._autoSave(); // create desktop icon on first spawn
  }

  // ── Initialise window + DOM ────────────────────────────────────────────────

  _init(title, x, y, w, h, initialContent) {
    if (!window.wm) return;

    const toolbar = _buildToolbar(this);
    const editor = _buildEditor();
    this._el = editor;

    const shell = mountWidgetShell({
      title,
      x,
      y,
      w,
      h,
      widgetType: 'note',
      bg: '#faf8f3',
      rows: [toolbar, editor],
      getState: () => ({
        title: this._title,
        content: this._html(),
        _desktopIconId: this._desktopIconId,
      }),
      save: {
        name: (this._title || 'Notepad') + '.note',
        type: 'note',
        getIconId: () => this._desktopIconId,
        setIconId: (id) => {
          this._desktopIconId = id;
        },
      },
      // No history hooks — native browser undo works for contenteditable (widget-history.js:33)
      onDestroy: () => this._destroy(),
    });

    if (!shell) return;
    this._winId = shell.winId;
    this._autoSave = shell.save;

    // Restore initial content
    if (initialContent) {
      const hasHtml = /<[a-z][^>]*>/i.test(initialContent);
      this._el.innerHTML = hasHtml ? _sanitize(initialContent) : '';
      if (!hasHtml) this._el.textContent = initialContent;
    }

    // User-typed input → autosave + note:change (+ Performance capture)
    this._el.addEventListener('input', (e) => {
      if (!this._replaying) {
        const it = e.inputType;
        if ((it === 'insertText' || it === 'insertCompositionText') && e.data) {
          for (const ch of e.data) this._take.push({ ch });
        } else if (it === 'insertParagraph' || it === 'insertLineBreak') {
          this._take.push({ ch: '\n' });
        } else if (typeof it === 'string' && it.startsWith('deleteContent')) {
          this._take.push({ ch: '\b' });
        }
      }
      this._mutate();
      this._autoSave();
    });

    // Track caret + selection → note:cursor / note:select
    this._selListener = () => this._onSelectionChange();
    document.addEventListener('selectionchange', this._selListener);
  }

  // ── Internal helpers ───────────────────────────────────────────────────────

  /** Sanitized innerHTML for persistence. */
  _html() {
    if (!this._el) return '';
    return _sanitize(this._el.innerHTML);
  }

  /** Current caret position as flat offset. */
  _caretPos() {
    const sel = window.getSelection?.();
    if (!sel || !sel.rangeCount || !this._el) return 0;
    const r = sel.getRangeAt(0);
    if (!this._el.contains(r.startContainer)) return 0;
    return _domToOffset(this._el, r.startContainer, r.startOffset);
  }

  /** Fire note:change (debounced 150ms). */
  _mutate() {
    clearTimeout(this._changeTimer);
    this._changeTimer = window.setTimeout(() => {
      const text = this._el?.textContent ?? '';
      notify('note:change', { winId: this._winId, text });
      if (this._winId) notify(`wm:${this._winId}:note:change`, { winId: this._winId, text });
    }, 150);
  }

  /** Handle document selectionchange — emit note:cursor / note:select when this editor is focused. */
  _onSelectionChange() {
    const sel = window.getSelection?.();
    if (!sel || !sel.rangeCount || !this._el) return;
    const r = sel.getRangeAt(0);
    if (!this._el.contains(r.startContainer)) return;

    const pos = _domToOffset(this._el, r.startContainer, r.startOffset);
    notify('note:cursor', { winId: this._winId, pos });
    if (this._winId) notify(`wm:${this._winId}:note:cursor`, { winId: this._winId, pos });

    if (!sel.isCollapsed) {
      const from = pos;
      const to = _domToOffset(this._el, r.endContainer, r.endOffset);
      notify('note:select', { winId: this._winId, from, to });
      if (this._winId) notify(`wm:${this._winId}:note:select`, { winId: this._winId, from, to });
    }
  }

  /** Stop all in-flight type()/backspace() timers (called by cleanupNotepads on reset). */
  _stopTyping() {
    for (const id of this._typingTimers) clearInterval(id);
    this._typingTimers.clear();
  }

  /** Insert raw text at a flat offset (no execCommand — works in tests + preserves spans). */
  _insertRaw(text, pos) {
    const loc = _offsetToDOM(this._el, pos);
    if (!loc) {
      if (this._el) this._el.textContent += text;
      return;
    }
    const { node, nodeOffset } = loc;
    if (node.nodeType === 3 /* TEXT_NODE */) {
      node.textContent =
        node.textContent.slice(0, nodeOffset) + text + node.textContent.slice(nodeOffset);
    } else {
      node.insertBefore(document.createTextNode(text), node.childNodes[nodeOffset] ?? null);
    }
  }

  /** Delete [from, to) by building a Range and calling deleteContents(). */
  _deleteRaw(from, to) {
    const startLoc = _offsetToDOM(this._el, from);
    const endLoc = _offsetToDOM(this._el, to);
    if (!startLoc || !endLoc) return;
    const range = document.createRange();
    range.setStart(startLoc.node, startLoc.nodeOffset);
    range.setEnd(endLoc.node, endLoc.nodeOffset);
    range.deleteContents();
  }

  /** Apply a selection [from, to) (for programmatic format/delete). */
  _applySelection(from, to) {
    const startLoc = _offsetToDOM(this._el, from);
    const endLoc = _offsetToDOM(this._el, to);
    if (!startLoc || !endLoc) return;
    const range = document.createRange();
    range.setStart(startLoc.node, startLoc.nodeOffset);
    range.setEnd(endLoc.node, endLoc.nodeOffset);
    try {
      const sel = window.getSelection?.();
      if (sel) {
        sel.removeAllRanges();
        sel.addRange(range);
      }
    } catch (_) {}
  }

  /** Tear down: stop typing, remove selectionchange listener, splice from registry. */
  _destroy() {
    this._stopTyping();
    clearTimeout(this._changeTimer);
    if (this._selListener) {
      document.removeEventListener('selectionchange', this._selListener);
      this._selListener = null;
    }
    const idx = _notepads.indexOf(this);
    if (idx >= 0) _notepads.splice(idx, 1);
  }

  // ── Public API — content ───────────────────────────────────────────────────

  /** Plain text content (read-only). */
  get text() {
    return this._el?.textContent ?? '';
  }

  /** Sanitized HTML content (read-only). */
  get html() {
    return this._html();
  }

  /**
   * Replace all content. Pass plain text or an HTML string.
   * HTML detection: presence of a tag like `<b>`, `<span ...>` etc.
   */
  set(content) {
    if (!this._el) return this;
    const hasHtml = /<[a-z][^>]*>/i.test(content);
    if (hasHtml) {
      this._el.innerHTML = _sanitize(content);
    } else {
      this._el.textContent = content;
    }
    this._mutate();
    this._autoSave();
    return this;
  }

  /** Clear all content. */
  clear() {
    if (!this._el) return this;
    this._el.innerHTML = '';
    this._mutate();
    this._autoSave();
    return this;
  }

  // ── Public API — cursor & selection ───────────────────────────────────────

  /** Move caret to a flat textContent offset. */
  cursor(pos) {
    if (!this._el) return this;
    const loc = _offsetToDOM(this._el, pos);
    if (!loc) return this;
    const range = document.createRange();
    range.setStart(loc.node, loc.nodeOffset);
    range.collapse(true);
    try {
      const sel = window.getSelection?.();
      if (sel) {
        sel.removeAllRanges();
        sel.addRange(range);
      }
    } catch (_) {}
    this._el.focus?.();
    return this;
  }

  /** Select text from flat offset `from` to `to`. */
  select(from, to) {
    if (!this._el) return this;
    this._applySelection(from, to);
    this._el.focus?.();
    return this;
  }

  // ── Public API — editing ──────────────────────────────────────────────────

  /**
   * Insert text at a flat offset (default: current caret position).
   * Preserves existing formatting in surrounding nodes.
   */
  insert(text, at) {
    if (!this._el) return this;
    const pos = at ?? this._caretPos();
    this._insertRaw(text, pos);
    this.cursor(pos + text.length);
    this._mutate();
    this._autoSave();
    return this;
  }

  /**
   * Delete text from flat offset `from` to `to` (exclusive).
   */
  delete(from, to) {
    if (!this._el) return this;
    this._deleteRaw(from, to);
    this.cursor(from);
    this._mutate();
    this._autoSave();
    return this;
  }

  /**
   * Replace text in [from, to) with `text`.
   */
  replace(from, to, text) {
    this.delete(from, to);
    this.insert(text, from);
    return this;
  }

  // ── Performance capture / replay (ADR 031) ──────────────────────────────────
  // Apply one recorded char. '\b' deletes the char before the caret; '\n' and
  // text both insert. Guarded by _replaying so the resulting 'input' event from
  // insert()/delete() (execCommand) does not re-record.
  _applyAction(a) {
    if (!a || a.ch == null) return;
    this._replaying = true;
    try {
      if (a.ch === '\b') {
        const p = this._caretPos();
        if (p > 0) this.delete(p - 1, p);
      } else {
        this.insert(a.ch);
      }
    } finally {
      this._replaying = false;
    }
  }

  replay(actions, opts) {
    return replayActions((act) => this._applyAction(act), actions, opts);
  }

  _perfCtor() {
    return {
      varName: 'np',
      code: `const np = new Notepad({ title: '${String(this._title).replace(/'/g, "\\'")}' });`,
    };
  }

  // ── Public API — animation ────────────────────────────────────────────────

  /**
   * Animate typing `text` character by character.
   * @param {string} text
   * @param {object} [opts]
   * @param {number} [opts.cps=20]   characters per second
   * @param {number} [opts.at]       starting offset (default: current caret)
   * @returns {Promise<void>} resolves when all chars are inserted
   */
  type(text, { cps = 20, at } = {}) {
    return new Promise((resolve) => {
      if (!this._el) {
        resolve();
        return;
      }
      if (at != null) this.cursor(at);

      let i = 0;
      const ms = Math.max(16, Math.round(1000 / cps));
      notify('note:type', { winId: this._winId, text });
      if (this._winId) notify(`wm:${this._winId}:note:type`, { winId: this._winId, text });

      const timer = window.setInterval(() => {
        if (i >= text.length) {
          clearInterval(timer);
          this._typingTimers.delete(timer);
          const done = this._el?.textContent ?? '';
          notify('note:done', { winId: this._winId, text: done });
          if (this._winId)
            notify(`wm:${this._winId}:note:done`, { winId: this._winId, text: done });
          this._autoSave();
          resolve();
          return;
        }
        const ch = text[i];
        const pos = this._caretPos();
        this._insertRaw(ch, pos);
        this.cursor(pos + ch.length);
        notify('note:char', { winId: this._winId, char: ch, index: i });
        if (this._winId)
          notify(`wm:${this._winId}:note:char`, { winId: this._winId, char: ch, index: i });
        i++;
      }, ms);

      this._typingTimers.add(timer);
    });
  }

  /**
   * Animate deleting `n` characters backwards from the current caret.
   * @param {number} [n=1]
   * @param {object} [opts]
   * @param {number} [opts.cps=20]
   * @returns {Promise<void>}
   */
  backspace(n = 1, { cps = 20 } = {}) {
    return new Promise((resolve) => {
      if (!this._el) {
        resolve();
        return;
      }
      let remaining = n;
      const ms = Math.max(16, Math.round(1000 / cps));
      notify('note:type', { winId: this._winId, text: '' });

      const timer = window.setInterval(() => {
        if (remaining <= 0) {
          clearInterval(timer);
          this._typingTimers.delete(timer);
          const done = this._el?.textContent ?? '';
          notify('note:done', { winId: this._winId, text: done });
          if (this._winId)
            notify(`wm:${this._winId}:note:done`, { winId: this._winId, text: done });
          this._autoSave();
          resolve();
          return;
        }
        const pos = this._caretPos();
        if (pos > 0) {
          this._deleteRaw(pos - 1, pos);
          this.cursor(pos - 1);
          notify('note:char', { winId: this._winId, char: '\b', index: n - remaining });
          if (this._winId)
            notify(`wm:${this._winId}:note:char`, {
              winId: this._winId,
              char: '\b',
              index: n - remaining,
            });
        }
        remaining--;
      }, ms);

      this._typingTimers.add(timer);
    });
  }

  // ── Public API — formatting ────────────────────────────────────────────────

  /**
   * Toggle bold on a range. Omit from/to to apply to current selection.
   */
  bold(from, to) {
    return this._fmt('bold', from, to);
  }

  /** Toggle italic on a range. */
  italic(from, to) {
    return this._fmt('italic', from, to);
  }

  /** Toggle underline on a range. */
  underline(from, to) {
    return this._fmt('underline', from, to);
  }

  /**
   * Set foreground color on a range.
   * @param {string} col  CSS color string
   */
  color(col, from, to) {
    return this._fmt('foreColor', from, to, col);
  }

  /**
   * Set background highlight on a range.
   * @param {string} col  CSS color string
   */
  highlight(col, from, to) {
    return this._fmt('hiliteColor', from, to, col);
  }

  _fmt(cmd, from, to, value = null) {
    if (!this._el) return this;
    if (from != null && to != null) this._applySelection(from, to);
    this._el.focus?.();
    try {
      document.execCommand(cmd, false, value);
    } catch (_) {}
    this._mutate();
    this._autoSave();
    return this;
  }

  // ── Public API — window control ────────────────────────────────────────────

  /** Bring the Notepad window to front. */
  show() {
    if (this._winId) window.wm?.show(this._winId);
    return this;
  }

  /** Focus the contenteditable. */
  focus() {
    this._el?.focus?.();
    return this;
  }

  /** Close the Notepad window. */
  close() {
    if (this._winId) window.wm?.close(this._winId);
    return this;
  }

  // ── Public API — event subscription ───────────────────────────────────────

  /**
   * Subscribe to a note event for this window only.
   * `event` is the suffix: 'char', 'done', 'change', 'cursor', 'select', 'type'.
   * Returns an unsubscribe handle.
   * @param {string}   event
   * @param {function} fn
   * @returns {function} stop
   */
  on(event, fn) {
    const myId = this._winId;
    return subscribe(`note:${event}`, (d) => {
      if (d.winId === myId) fn(d);
    });
  }
}

// Register teardown with the reset registry (ADR 008).
onReset(cleanupNotepads);
