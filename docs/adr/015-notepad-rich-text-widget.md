# ADR 015 — Notepad: Programmable Rich-Text Window Widget

**Status**: Accepted  
**Date**: 2026-06-26

---

## Context

createos had visual creative widgets (Paint, SpriteEditor, AsciiEditor, Drumpad) but no text widget. The request was a window that:
- Looks like a normal rich-text notepad (NOT an IDE) — serif font, light background, soft wrap
- Has programmatic cursor placement, text selection, insert/replace/delete
- Supports animated "fake typing" and "backspace" for poetry and kinetic-text pieces
- Has a small formatting toolbar (bold / italic / underline / text color / highlight) plus code API equivalents
- Autosaves to a desktop icon and restores on project load
- Emits events on the global bus so other subsystems can react (e.g., play a sound per keystroke)

---

## Decision

### 1. Editor core: `contenteditable` (not CodeMirror)

CodeMirror 6 is already present but is IDE-oriented. Applying formatting (bold, color, highlight) in CM6 requires decorations + a state layer — significant complexity. `contenteditable` is native rich text:
- `document.execCommand('bold'|'italic'|'underline'|'foreColor'|'hiliteColor')` works natively
- wm.js drag handling already special-cases `[contenteditable="true"]` to prevent drag conflicts
- WidgetHistory (global Cmd+Z) already bails on `contenteditable`, so the browser's native undo stack is used without conflict
- No new dependencies

### 2. Flat char-offset model

Formatting nests text inside `<b>`, `<span style="color:...">`, etc. The public API exposes **flat character offsets over `textContent`** only. Two private helpers translate:
- `_offsetToDOM(root, offset)` — TreeWalker over text nodes, accumulates lengths → `{ node, nodeOffset }` for a DOM `Range`
- `_domToOffset(root, node, nodeOffset)` — reverse walk → flat offset

All positional API methods (`cursor`, `select`, `insert`, `delete`, `replace`, `type`, `backspace`, `bold`, `color`, etc.) use these mappers. Users never deal with DOM nodes.

### 3. Animated typing uses patched `window.setInterval`

Per ADR 014 precedent (`tick()`): user-visible animations should pause and clean up with the harness. Using the patched `setInterval` (not `_nativeSetInterval`) means typing pauses when the sketch pauses and clears on reset. Each `type()`/`backspace()` call tracks its timer ID in `this._typingTimers`; `cleanupNotepads()` clears the Set on reset (windows survive, same as Drumpad).

`type()` and `backspace()` return Promises so callers can `await` sequential animations.

### 4. Formatting via `document.execCommand`

`execCommand` is deprecated but universally supported in all modern browsers for `contenteditable` formatting. No alternative exists without a full rich-text library (which would be a new dependency). The tradeoff is acceptable: the feature still works in all target environments, the deprecation signals a possible future direction rather than an imminent removal.

Toolbar buttons call `execCommand` directly with `e.preventDefault()` on `mousedown` (to prevent the editor losing focus before the command fires). Programmatic API methods set the DOM selection via `Range`/`getSelection`, focus the editor, then call `execCommand`.

### 5. Persistence: sanitized innerHTML

`getState()` returns `{ title, content: sanitizedInnerHTML, _desktopIconId }`. The sanitizer (`_sanitize`) whitelists:
- Tags: `b`, `strong`, `i`, `em`, `u`, `br`, `span`, `p`, `div`
- Style attributes: only `color` and `background-color` CSS properties

All other tags are unwrapped (children kept), all other attributes are stripped. This prevents XSS when restoring from a saved file.

Restoration sets `this._el.innerHTML = sanitizedContent`. If the restored content is plain text (no HTML tags), `textContent` is used instead.

### 6. Global bus events

All six `note:*` events fire via `notify()` (not `emit()` — these are notifications, not commandable). Each also fires a scoped `wm:{winId}:note:*` variant so per-window subscriptions work:

| Event | Payload | When |
|-------|---------|------|
| `note:type` | `{ winId, text }` | `type()` animation starts |
| `note:char` | `{ winId, char, index }` | each character during `type()` |
| `note:done` | `{ winId, text }` | `type()` or `backspace()` finishes |
| `note:change` | `{ winId, text }` | content changed (debounced 150ms) |
| `note:cursor` | `{ winId, pos }` | caret moved |
| `note:select` | `{ winId, from, to }` | selection changed |

`note:cursor` and `note:select` are driven by a `document` `selectionchange` listener (not `window`; not tracked by the harness), manually removed in `_destroy()`.

### 7. Widget chassis: Drumpad pattern (no frames)

`Notepad` follows `Drumpad` exactly — no `FrameDoc`, no `buildFrameStrip`, no `WidgetHistory` hooks. `mountWidgetShell` is called with `widgetType:'note'`, `getState`, `save`, and `onDestroy`. Desktop icon is created on first spawn; updates are debounced inside the shell.

### 8. Blocks coverage

A new `TOOLKIT_CATEGORIES` entry `'Notepad'` is added to `BLOCKS_TODO` in `tests/blocks-coverage.test.js`. No Blockly block is built now; this is a visible backlog item per ADR 011's self-cleaning gate.

---

## Consequences

- New file: `src/api/widgets/notepad.js` — `Notepad` class + `cleanupNotepads` + `onReset` registration
- Modified: `src/events/system-events.js` — 6 `note:*` entries + 5 `wm:{winId}:note:*` patterns
- Modified: `src/api/platform/desktop-files.js` — `note` glyph/CSS/`_activate`/`restoreDesktop`
- Modified: `src/runtime/app.js` — import + `_registerBuiltin` + `__ar_widgetRestorers['note']`
- Modified: `src/editor/completions.js` — `'Notepad'` toolkit category
- Modified: `tests/blocks-coverage.test.js` — `'Notepad'` in `BLOCKS_TODO`
- New tests: `tests/notepad.test.js` (47 tests)
- New docs: `docs/notepad.md`
