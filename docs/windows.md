# Windows

`window.wm` — spawn, show, hide, move, resize, and tile the IDE's floating windows from code. All methods are also available in the Blocks panel (Windows category) and the API drawer.

---

## Built-in window IDs

| ID | Panel |
|----|-------|
| `win-editor` | Code editor |
| `win-canvas` | Output / canvas |
| `win-console` | Console |
| `win-toolkit` | API toolbox |
| `win-camera` | Camera feed |
| `win-mic` | Mic visualizer |

---

## Visibility

```js
wm.show('win-canvas')      // show + bring to front
wm.hide('win-console')     // hide (built-ins) or remove (spawned)
wm.toggle('win-toolkit')   // flip visibility
wm.focus('win-editor')     // bring to front without showing/hiding
wm.maximize('win-canvas')  // fill the desktop
wm.restore('win-canvas')   // undo maximize
wm.close(id)               // alias for hide
```

---

## Move & resize

Coordinates are pixels from the top-left of the desktop.

```js
wm.move('win-canvas', 200, 0)       // move to x=200, y=0
wm.resize('win-canvas', 800, 600)   // set size in px
```

---

## Layouts

Named presets that tile built-in windows to fill the desktop.

```js
wm.layout('split')   // toolkit + editor side by side (default, Ctrl+1)
```

Add new layouts in `js/wm.js` → `LAYOUTS`.

---

## Spawning windows

`wm.spawn(title, opts)` creates a new floating window and returns its id. The window is draggable, resizable, and closeable like any built-in window. Use the returned id to show/hide/close it programmatically.

### HTML content

```js
const id = wm.spawn('Info', {
  type: 'html',
  html: '<h2>hello</h2><p>world</p>',
  w: 320, h: 240,
});
wm.close(id);
```

### Camera mirror

Mirrors the live camera feed (camera must be enabled).

```js
const id = wm.spawn('Cam', { type: 'camera', w: 320, h: 240 });
```

### Canvas mirror

Mirrors any canvas layer at z-index `z` (default 0 = main canvas).

```js
const id = wm.spawn('Output', { type: 'canvas', z: 0, w: 640, h: 480 });
```

### Shader mirror

Mirrors a `Shader` instance's output canvas.

```js
const s = new Shader(`
  let col = vec3f(uv.x, uv.y, sin(time) * 0.5 + 0.5);
  return vec4f(col, 1.0);
`).start();

const id = wm.spawn('FX', { type: 'shader', shader: s, w: 640, h: 480 });
```

### Image

```js
const src = await wm.pickFile('photo');
wm.spawn('Photo', { type: 'image', src, w: 480, h: 360 });
```

### Video

```js
const src = await wm.pickFile('clip');
wm.spawn('Clip', { type: 'video', src, w: 640, h: 480, controls: true });
// loop: true (default), muted: true (required for autoplay)
```

---

## Picking files

`wm.pickFile(key)` opens the browser file picker once, caches the handle under `key`, and returns a blob URL. Subsequent calls with the same key reuse the cached handle — no re-prompt as long as the browser permission is active.

```js
const url = await wm.pickFile('myFile');
// url is a blob: URL — valid for this session
```

Optional second arg passes options to `showOpenFilePicker`:

```js
const url = await wm.pickFile('img', {
  types: [{ description: 'Images', accept: { 'image/*': [] } }],
});
```

> `showOpenFilePicker` requires a secure context (localhost or HTTPS) and is not supported in Firefox.

---

## Listing windows

```js
wm.list()   // → ['win-toolkit', 'win-editor', 'win-spawn-1', ...]
```

---

## spawn() options reference

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `type` | string | `'html'` | Content type: `html`, `image`, `video`, `camera`, `canvas`, `shader` |
| `x` | number | centered | Left offset in px |
| `y` | number | centered | Top offset in px |
| `w` | number | 320 | Width in px |
| `h` | number | 240 | Height in px |
| `id` | string | auto | Custom window id |
| `html` | string | `''` | HTML string (type: html) |
| `src` | string | — | URL or blob URL (type: image / video) |
| `loop` | boolean | true | Loop video (type: video) |
| `controls` | boolean | false | Show video controls (type: video) |
| `z` | number | 0 | Canvas z-index to mirror (type: canvas) |
| `shader` | Shader | — | Shader instance to mirror (type: shader) |
| `noChrome` | boolean | false | Hide titlebar entirely |
| `transparent` | boolean | false | Semi-transparent window background |
| `onClose` | function | — | Callback fired when window is closed |

---

## Live methods

```js
wm.setZ(id, 50)                            // change CSS z-index
wm.setOpacity(id, 0.7)                     // set window opacity (0–1)
wm.filter(id, 'brightness(2) hue-rotate(30deg)')  // CSS filter on .wm-body
wm.filter(id, '')                          // clear filter
const id = wm.getByTitle('My Window')      // look up id by titlebar text (case-insensitive)
```

### Drum/beat flash pattern

```js
// Pulse a window's brightness on each beat
const id = wm.spawn('Flash', { type: 'html', html: '<canvas id="c"></canvas>', w: 300, h: 300 });
note("c2*4").play();
on('beat:tick').do(() => {   // Strudel is locked to the Tone transport
  wm.filter(id, 'brightness(3)');
  setTimeout(() => wm.filter(id, ''), 80);
});
```

---

## Video windows — viz fold-out

Video windows include a ♪ button in the titlebar. Clicking it folds out a live spectrum/waveform panel beneath the video. The panel has a source selector (the video's own audio, master output, or mic) and a style selector (wave / bars / spectrogram).

---

## Embed / distribution mode

Share the entire desktop as a URL — all editors, window positions, and code — using the **⇒ share** button in the app toolbar (`#shareProjectBtn`). Clicking it serializes the project and copies a URL to the clipboard:

```
https://your-ide.example.com/?embed=1&project=<base64>
```

Loading that URL activates embed mode:
- All editor windows are hidden.
- Canvas output windows fill the viewport (no titlebar, no chrome).
- User-spawned `wm.spawn()` windows remain visible at their saved positions.
- All editors auto-execute immediately.

Single-editor variant (just code, no layout):

```
?embed=1&code=<base64>
```

The base64 encoding is `btoa(encodeURIComponent(code))` — safe for all characters.
