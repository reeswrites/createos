# Pixel Art — `Sprite` & `spriteEditor`

Two complementary ways to make pixel-art sprites: the **programmatic API** (`Sprite`) for code-driven animation, and the **visual editor** (`spriteEditor` / `Sprite.edit()`) for painting interactively.

---

## Sprite — Programmatic API

```js
const sp = new Sprite({ width: 16, height: 16, scale: 20, frames: 1 });
```

| Option | Default | Description |
|--------|---------|-------------|
| `width` | `16` | Pixel grid width |
| `height` | `16` | Pixel grid height |
| `scale` | `20` | Display scale (CSS px per pixel) |
| `frames` | `1` | Number of animation frames |

### Drawing pixels

```js
sp.pixel(x, y, color)          // set one pixel; color = CSS string or 'transparent'
sp.fill(x, y, w, h, color)     // fill a rectangle of pixels
sp.clear()                      // clear entire frame to transparent
```

### Frames

```js
sp.frame(i)                    // switch active frame (0-indexed)
sp.addFrame()                  // append blank frame, returns new index
sp.frameCount                  // total number of frames (getter)
```

### Onion skin

```js
sp.onionSkin(0.3)              // ghost previous frame at 30% opacity
sp.onionSkin(0)                // disable
```

### Playback

```js
sp.play(fps)                   // start animation loop (default 8 fps)
sp.stop()                      // stop animation
sp.show('My Sprite')           // open a wm window showing this sprite → returns handle
```

### Raw context

```js
const ctx = sp.ctx()           // 2D context for the active frame canvas
sp.canvas                      // the display HTMLCanvasElement (scaled)
```

### Example — animated sprite

```js
const sp = new Sprite({ width: 8, height: 8, scale: 32, frames: 2 });

// Frame 0 — smiley
sp.frame(0);
sp.fill(2, 1, 4, 1, '#ffdd44');
sp.fill(1, 2, 6, 4, '#ffdd44');
sp.fill(2, 5, 4, 1, '#ffdd44');
sp.pixel(2, 2, '#000'); sp.pixel(5, 2, '#000');
sp.fill(2, 4, 4, 1, '#cc6600');

// Frame 1 — sad face variant
sp.addFrame(); sp.frame(1);
sp.fill(2, 1, 4, 1, '#ffdd44');
sp.fill(1, 2, 6, 4, '#ffdd44');
sp.fill(2, 5, 4, 1, '#ffdd44');
sp.pixel(2, 2, '#000'); sp.pixel(5, 2, '#000');
sp.fill(2, 5, 4, 1, '#cc6600');

sp.play(4);
sp.show('Emote');
```

---

## spriteEditor — Visual Paint GUI

Open an Aseprite-style editor window directly from code, or click the paintbrush＋ button in the toolbar.

```js
// New blank sprite + editor
spriteEditor({ width: 16, height: 16, scale: 20 })

// Open editor on an existing sprite
const sp = new Sprite({ width: 32, height: 32, scale: 16 });
sp.show('Preview');
sp.edit();                    // opens GUI on sp; live-edits the same pixel data

// Static variant — new sprite, open immediately
Sprite.edit({ width: 32, height: 32, scale: 16 })
```

### Constructor options

| Option | Default | Description |
|--------|---------|-------------|
| `sprite` | `null` | Existing `Sprite` to edit in-place |
| `width` | `16` | New sprite width (ignored if `sprite` passed) |
| `height` | `16` | New sprite height |
| `scale` | `20` | Display scale in editor |
| `frames` | `1` | Initial frame count |
| `title` | `'Sprite Editor'` | Window title |
| `x`, `y` | centered | Window position |

### Tools

| Icon | Tool | Behaviour |
|------|------|-----------|
| pencil | Pencil | Draw pixels on pointer-down + drag |
| eraser | Eraser | Erase pixels (set to transparent) |
| fill-drip | Fill bucket | BFS flood-fill from clicked pixel |
| eye-dropper | Eyedropper | Pick color from canvas, sets active color |
| minus | Line | Bresenham line — drag start→end |
| square (outline) | Rectangle | Hollow rect — drag to size |
| square (filled) | Rectangle fill | Solid rect — drag to size |
| circle (outline) | Circle | Midpoint circle — drag from center, radius = drag distance |
| circle (filled) | Circle fill | Solid disc — drag from center |

After the tool icons, a divider separates two **view controls**:

| Icon | Control | Behaviour |
|------|---------|-----------|
| border-all | Toggle grid | Show/hide the pixel grid overlay (on by default) |
| expand | Resize grid | Prompts `W × H` and resizes the resolution; existing art kept top-left aligned |

### Palette

- 12 preset swatches + transparent checker + native color picker
- Eyedropper writes back to the active color
- Custom picker syncs with selected swatch

### Frame strip

| Button | Action |
|--------|--------|
| + | Add blank frame |
| clone | Duplicate current frame |
| trash | Delete current frame (guarded — keeps ≥ 1) |
| chevron-left / chevron-right | Reorder frames |
| layer-group | Toggle onion skin (ghosts previous frame at 30%) |

Click any thumbnail to switch to that frame.

### Transport

- **▶ / ■** — play / stop animation at chosen fps
- **fps** — frames per second input (1–60)

### Export

| Button | Output |
|--------|--------|
| Import | Loads a PNG / sprite sheet back into the editor. Slices a multi-frame sheet horizontally into N equal cells (prompts for frame count); resizes the grid to the cell size |
| Code | Inserts `new Sprite(…)` + draw calls into the active editor; falls back to clipboard |
| PNG | Downloads current frame at editor scale |
| Sheet | Downloads all frames composited horizontally as a spritesheet |

**Portability / handoff.** Three round-trip paths: **Code** (plain-text `Sprite` calls — paste into any createos instance, diffable, best for collaboration), a project `.vljson` export (carries full frame data on the sprite desktop icon), and **Sheet → Import** (PNG out, PNG back in).

The generated code uses `sp.fill(x, y, w, 1, color)` for horizontal runs of the same color, keeping output compact.

### Live handle

```js
const ed = spriteEditor({ width: 16, height: 16, scale: 24 });
// ed.sprite is the live Sprite — read/write pixels programmatically
// while the GUI is open; changes reflect immediately
setInterval(() => {
  const t = Date.now() / 300;
  ed.sprite.pixel(Math.floor(Math.random() * 16), Math.floor(Math.random() * 16),
    `hsl(${t * 60 % 360}, 80%, 60%)`);
}, 100);
ed.sprite.show('Live Preview');
```

### Cleanup

Editor windows are cleaned up on code reset (`cleanupSpriteEditors()`). The underlying `Sprite` is cleaned by `cleanupSprites()`. Close the window to stop the sprite and remove pointer listeners — no lingering timers.

---

## Blocks

The **Pixel Art** category in the API Toolbox (drag-to-editor) has entries for:
- `pixel-art sprite` — programmatic skeleton
- `draw frame with raw ctx` — direct 2D context access
- `onion skin` — enable ghost frame
- `addFrame + loop` — multi-frame animation setup
- `open sprite editor (GUI)` — `spriteEditor({…})`
- `edit existing sprite` — `sp.edit()` on an existing Sprite

---

## Examples

### Checkerboard flag

```js
const sp = new Sprite({ width: 8, height: 8, scale: 40 });
for (let y = 0; y < 8; y++)
  for (let x = 0; x < 8; x++)
    sp.pixel(x, y, (x + y) % 2 === 0 ? '#e63946' : '#f1faee');
sp.show('Flag');
```

### Animated walk cycle (4 frames)

```js
const sp = new Sprite({ width: 8, height: 16, scale: 20, frames: 4 });

const body = [[3,4,'#e63946'],[4,4,'#e63946'],[3,5,'#e63946'],[4,5,'#e63946']];
const head = [[3,2,'#ffb4a2'],[4,2,'#ffb4a2'],[3,3,'#ffb4a2'],[4,3,'#ffb4a2']];

const legs = [
  [[3,6,'#457b9d'],[4,7,'#457b9d']],
  [[3,7,'#457b9d'],[4,6,'#457b9d']],
  [[3,6,'#457b9d'],[4,7,'#457b9d']],
  [[4,6,'#457b9d'],[3,7,'#457b9d']],
];

for (let f = 0; f < 4; f++) {
  if (f > 0) sp.addFrame();
  sp.frame(f);
  [...body, ...head, ...legs[f]].forEach(([x, y, c]) => sp.pixel(x, y, c));
}

sp.play(8);
sp.show('Walk');
```

### Paint + export

```js
// Open the editor, paint manually, then click "Code" to generate the Sprite code
spriteEditor({ width: 32, height: 32, scale: 14 });
```

### Edit in-place from code

```js
const sp = new Sprite({ width: 16, height: 16, scale: 24 });
sp.show('Preview');

// Edit visually while driving pixels from code simultaneously
sp.edit();
sp.fill(4, 4, 8, 8, '#89b4fa');
sp.pixel(7, 7, '#ffffff');
```
