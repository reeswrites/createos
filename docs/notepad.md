# Notepad — `Notepad`

A rich-text window widget for prose, poetry, and kinetic text. Looks like a notepad (serif font, light background, proportional text) with a small formatting toolbar. Fully programmable: place the cursor, select ranges, insert/delete text, apply color and bold, and animate fake-typing character by character.

```js
const note = new Notepad({ title: 'Poem', w: 420, h: 340 });
await note.type('the quiet\nbetween words', { cps: 12 });
note.color('#c0392b', 0, 9);    // color "the quiet"
note.italic(10, 17);             // italic "between"
```

---

## Spawn

```js
const note = new Notepad(opts);
notepad(opts);   // factory shorthand
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `title` | string | `'Notepad'` | Window title bar label |
| `x` | number | auto | Left position on desktop |
| `y` | number | auto | Top position on desktop |
| `w` | number | `380` | Window width px |
| `h` | number | `300` | Window height px |
| `content` | string | `''` | Initial content — plain text or sanitized HTML |

The window opens immediately. Content autosaves to a `.note` desktop icon within 300ms of any change.

---

## Toolbar

The window includes a compact toolbar:

| Control | Function |
|---------|----------|
| **B** | Toggle bold on selection |
| *I* | Toggle italic on selection |
| <u>U</u> | Toggle underline on selection |
| Color swatch (A) | Set foreground text color |
| Highlight swatch (◼) | Set background highlight color |
| ✕ | Clear all content |

Toolbar applies to the **current text selection** made by mouse/keyboard. Programmatic API (below) can also be used from code.

---

## Content API

```js
note.text          // getter: plain textContent (no tags)
note.html          // getter: sanitized innerHTML

note.set('hello world')        // replace all — plain text
note.set('<b>hello</b>')       // replace all — HTML (sanitized)
note.clear()                   // empty the editor
```

---

## Cursor & Selection

All positions are **flat character offsets over `textContent`** — span/bold nesting is invisible to the API.

```js
note.cursor(pos)         // move caret to flat offset
note.select(from, to)    // select range [from, to)
```

```js
note._el.focus();
note.cursor(5);    // caret after 5th character
note.select(0, 3); // select first 3 characters
```

---

## Insert / Delete / Replace

```js
note.insert(text, at?)         // insert at offset (default: current caret)
note.delete(from, to)          // delete [from, to)
note.replace(from, to, text)   // replace range with new text
```

```js
note.set('hello world');
note.replace(6, 11, 'earth');  // → "hello earth"
note.insert(' there', 5);      // → "hello there earth"
note.delete(0, 6);             // → "there earth"
```

Surrounding formatting (bold, color spans) is preserved when inserting.

---

## Animated Typing

`type()` and `backspace()` return Promises so you can `await` them in sequence:

```js
await note.type('the quiet', { cps: 15 });
await note.type('\nbetween', { cps: 10 });
await note.backspace(7, { cps: 30 });        // delete "between"
```

| Method | Description |
|--------|-------------|
| `note.type(text, { cps=20, at? })` | Animate typing `text` at `cps` chars/sec. `at` sets start offset. |
| `note.backspace(n=1, { cps=20 })` | Animate deleting `n` chars backwards from caret. |

Typing animations use the patched `setInterval` — they **pause** when the sketch pauses and **clean up** on reset. The window (and its content) survive reset.

---

## Formatting

All formatting methods accept an optional `from, to` range. Without a range, they apply to the **current text selection**.

```js
note.bold(from?, to?)
note.italic(from?, to?)
note.underline(from?, to?)
note.color(cssColor, from?, to?)
note.highlight(cssColor, from?, to?)
```

```js
note.set('the quiet between words');
note.bold(0, 9);              // bold "the quiet"
note.color('#e74c3c', 4, 9);  // red "quiet"
note.highlight('#fff9c4', 10, 17); // yellow highlight "between"
```

Formatting uses `document.execCommand` under the hood — the pragmatic choice for contenteditable.

---

## Bus Events

All events fire on the global bus via `notify()`. Subscribe with `on()`:

```js
on('note:char').do(({ char, winId }) => {
  if (char !== '\n') note("c6").play();
});
```

| Event | Payload | When |
|-------|---------|------|
| `note:type` | `{ winId, text }` | `type()` starts |
| `note:char` | `{ winId, char, index }` | each character during `type()` |
| `note:done` | `{ winId, text }` | `type()` or `backspace()` finishes |
| `note:change` | `{ winId, text }` | content changed (debounced 150ms) |
| `note:cursor` | `{ winId, pos }` | caret moved |
| `note:select` | `{ winId, from, to }` | selection changed |

**Per-window scoped events** — prefix with `wm:{winId}:` to listen to a specific notepad only:

```js
const note = new Notepad({ title: 'Poem' });
on(`wm:${note._winId}:note:char`).do(({ char }) => {
  console.log('this notepad typed:', char);
});
```

### Per-instance convenience

```js
const stop = note.on('change', ({ text }) => console.log(text));
// ...
stop();  // unsubscribe
```

`note.on(event, fn)` is shorthand for `on('note:event').when(d => d.winId === note._winId).do(fn)`.

---

## Window Control

```js
note.show()    // bring window to front
note.focus()   // focus the editor
note.close()   // close the window
```

---

## Autosave & Restore

Content autosaves to a desktop `.note` icon whenever the text changes (debounced). Double-clicking the icon reopens the notepad with its content and formatting intact.

Project save/load also restores Notepad windows via `__ar_widgetRestorers['note']`.

---

## Example: Poetry with sound

```js
const note = new Notepad({ title: 'Rain', w: 420, h: 300 });

// Play a soft click per character typed
on('note:char').do(({ char }) => {
  if (char !== ' ' && char !== '\n') note("c6").sound("sine").play();
});

await note.type('listen\n', { cps: 8 });
note.color('#4a90d9', 0, 6);           // blue "listen"

await note.type('to the rain', { cps: 10 });
note.highlight('#e3f2fd', 7, 18);      // highlight "to the rain"
note.italic(7, 9);                     // italic "to"
```

---

## Example: Kinetic reveal

```js
const words = ['silence', 'distance', 'echo', 'return'];
const note  = new Notepad({ title: 'Fragments', w: 380, h: 240 });

for (const w of words) {
  await note.type(w + '\n', { cps: 20 });
  await new Promise(r => setTimeout(r, 600));
  await note.backspace(w.length + 1, { cps: 40 });
}
note.set('silence');
note.color('#e74c3c', 0, 7);
```

---

## See also

- [control.md](control.md) — keyboard/mouse events on the bus  
- [ADR 015](adr/015-notepad-rich-text-widget.md) — design decisions  
- [ADR 014](adr/014-input-control-sensors-on-the-bus.md) — event bus patterns
