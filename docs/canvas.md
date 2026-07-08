# Canvas API

Two drawing APIs: `draw` (fluent, opinionated) and raw `getCanvas()` (full 2D context access). Layer system for z-ordering and CSS effects.

For chained visual effects across sources (camera → ASCII → shader), see the [Render Pipeline](#render-pipeline--pipe) section at the bottom of this doc.

---

## draw — Fluent Drawing API

`draw` is a global targeting z=0. All methods are chainable.

```js
draw.bg('#111')
    .circle(800, 450, 100, '#ff0')
    .rect(100, 100, 200, 50, 'red')
    .text('hello', 400, 300, 32, '#fff');
```

### Background & Clear

```js
draw.bg('#111')       // fill entire canvas with color
draw.clear()          // clear to transparent
```

### Filled Shapes

```js
draw.rect(x, y, w, h, color)
draw.circle(x, y, r, color)
draw.arc(x, y, r, startRad, endRad, color)
draw.poly([[x1,y1],[x2,y2],[x3,y3]], color)  // filled polygon
```

### Stroked Shapes

```js
draw.rectStroke(x, y, w, h, color, thickness)
draw.ring(x, y, r, color, thickness)           // stroked circle
draw.arcStroke(x, y, r, startRad, endRad, color, thickness)
draw.line(x1, y1, x2, y2, color, thickness)
draw.polyStroke([[x1,y1],[x2,y2]], color, thickness, closed)
```

### Text

```js
draw.text(str, x, y, size, color)
draw.text(str, x, y, size, color, {
  font:        'monospace',          // font family
  align:       'center',             // 'left' | 'center' | 'right'
  baseline:    'middle',             // 'alphabetic' | 'middle' | 'top' | 'bottom'
  weight:      'bold',               // CSS font-weight
  style:       'italic',             // CSS font-style
  stroke:      true,                 // add outline
  strokeColor: '#000',               // outline color
  strokeWidth: 3,                    // outline width (px)
  shadow:      true,                 // drop shadow
  shadowColor: 'rgba(0,0,0,0.6)',    // shadow color
  shadowBlur:  8,                    // shadow blur radius
  shadowX:     3, shadowY: 3,        // shadow offset
  gradient:    ['#f0f', '#0ff'],     // vertical gradient fill (top→bottom array of colors)
})
```

Load a web font (FontFace API) before using it:

```js
await draw.loadFont('Orbitron', 'https://fonts.gstatic.com/s/orbitron/v31/yMJMMIlzdpvBhQQL_SC3X9yhF25-T1nyGy6BoWgz.woff2');
draw.text('SPACE', 400, 300, 64, '#0ff', { font: 'Orbitron', weight: 'bold' });
```

`draw.loadFont(name, url)` returns a Promise — `await` it before drawing.

### Images

```js
const img = await Media.image('https://example.com/photo.jpg');
draw.image(img, x, y)           // natural size
draw.image(img, x, y, w, h)     // stretched to w×h
```

### Transform

```js
draw.translate(x, y)
draw.rotate(radians)
draw.scale(x, y)          // scale(2) or scale(2, 0.5)
draw.resetTransform()     // identity matrix

// Always push/pop around transforms
draw.push()
  .translate(800, 450)
  .rotate(Math.PI / 4)
  .rect(-50, -50, 100, 100, 'cyan')
  .pop();
```

### Compositing & Alpha

```js
draw.alpha(0.5)                    // global opacity
draw.blend('screen')               // composite mode
// modes: 'source-over' 'screen' 'multiply' 'overlay' 'lighter' 'difference' etc.
draw.push().alpha(0.3).circle(400, 400, 50, '#f00').pop();
```

### State

```js
draw.push()   // save transform, alpha, blend mode
draw.pop()    // restore
draw.reset()  // reset transform, alpha, blend, shadow, lineWidth
```

### Multi-layer

```js
draw.at(1).bg('#000')          // draw to z=1 layer
draw.at(2).circle(400, 300, 80, '#f0f')  // draw to z=2 layer

// draw.at(z) returns the same DrawTarget interface
const bg = draw.at(-1);     // behind camera
const fg = draw.at(5);      // above main canvas
```

### Size

```js
draw.width   // canvas width in pixels (1600)
draw.height  // canvas height in pixels (900)
```

---

## getCanvas — Raw 2D Context

Direct access to the HTMLCanvasElement:

```js
const canvas = getCanvas(0);          // z=0 (default)
const ctx = canvas.getContext('2d');

ctx.fillStyle = 'red';
ctx.fillRect(100, 100, 200, 200);

// Draw with alpha trail
ctx.fillStyle = 'rgba(0,0,0,0.1)';
ctx.fillRect(0, 0, canvas.width, canvas.height);
```

Use `getCanvas()` when you need features not in `draw`: gradients, bezier paths, pixel manipulation, patterns, shadows, `createImageData`, etc.

---

## getLayer — CSS Effects

`getLayer(z)` returns a Layer object that applies CSS filters and transforms to the entire canvas at that z-index.

```js
const layer = getLayer(0);

// Filters (combine freely)
layer.blur(5)            // Gaussian blur in px
layer.hue(90)            // hue-rotate in degrees
layer.brightness(1.5)    // 1 = normal, 2 = double
layer.saturate(2)        // 1 = normal, 0 = grayscale
layer.invert(1)          // 0–1, 1 = full invert
layer.filter('sepia(0.5) contrast(1.2)')  // raw CSS filter string

// Opacity
layer.opacity(0.7)

// Transforms
layer.rotate(45)         // degrees
layer.rotateX(30)        // 3D flip X
layer.rotateY(30)        // 3D flip Y
layer.scale(1.5)         // uniform scale
layer.scale(2, 0.5)      // x, y scale
layer.perspective(800)   // perspective depth for rotateX/Y

// Clip
layer.clip('circle(50%)')
layer.clip('polygon(50% 0%, 100% 100%, 0% 100%)')

// Remove all effects
layer.reset()
```

All Layer methods return `this` — chainable:
```js
getLayer(0).blur(2).brightness(1.3).hue(45).blendMode('screen');
```

### Blend Modes

`blendMode(mode)` sets CSS `mix-blend-mode` on the layer canvas — composites it with layers below using the browser's GPU blending. Cleared by `reset()`.

```js
// Two-layer multiply: draw on layer 0, shader on layer 1 blended through
getLayer(1).blendMode('multiply');

// Screen blend: lighten-only compositing, good for glow/fire effects
getLayer(1).blendMode('screen');
```

Available modes (any valid CSS `mix-blend-mode`): `multiply` `screen` `overlay` `difference` `lighten` `darken` `hard-light` `soft-light` `exclusion` `color-burn` (and all others the browser supports).

---

## Pixel FX

### draw.pixelate

`draw.pixelate(source, blockSize, x?, y?, w?, h?)` — downsamples `source` to `blockSize`-pixel blocks and draws it back at full size. Useful for pixel-art effects, retro looks, or privacy masking.

```js
// Pixelate layer 0 onto itself
draw.pixelate(getCanvas(0), 12);

// Pixelate live camera feed at 16px blocks
const cam = new Camera();
setInterval(() => draw.pixelate(cam.element, 16), 33);

// Pixelate into a sub-region
draw.pixelate(getCanvas(1), 8, 200, 100, 400, 300);
```

### draw.backdrop

`draw.backdrop(source, opts?)` — renders an image, video, camera feed, or any canvas below all draw calls. The backdrop lives on the layer *below* the draw target (default `z − 1`), so every `draw.rect/circle/text` call naturally appears on top.

Source can be: a URL string, `'camera'`, `HTMLImageElement`, `HTMLVideoElement`, a `CameraStream`, `HTMLCanvasElement`, `GLShader`, `Shader`, or `Layer`.

Options: `{ z, fit: 'cover'|'contain'|'stretch', loop: true }` — `fit:'cover'` (default) fills the layer, `contain` letterboxes, `stretch` ignores aspect ratio. `loop:false` skips the RAF loop (for static images).

Returns `{ stop(), layer }`. Call `.stop()` to cancel a live video loop early; the backdrop is auto-cleaned on every reset.

```js
// Static photo as tracing guide
draw.backdrop('https://example.com/photo.jpg');
draw.text('traced!', 100, 100, 48, '#f00');

// Live camera underlay
const cam = await Camera.open();
draw.backdrop(cam);
draw.circle(800, 450, 50, 'rgba(255,0,0,0.5)');

// Live video, contained (letterboxed)
const vid = await Media.video('clip.mp4');
draw.backdrop(vid, { fit: 'contain' });
```

> **Tip:** For a no-code drawing-over-video workflow, open any image/video/camera output window and click the 🖌️ titlebar button to activate the built-in paint overlay.

### draw.toASCII

`draw.toASCII(canvas, opts)` → `{ el: <pre>, update(canvas) }` — converts pixel brightness to ASCII characters. Returns a `<pre>` element with a live `update()` method.

Options: `{ cols: 80, rows, charset: ' .:-=+*#%@', bg: '#000', color: '#0f0' }`

```js
const art = draw.toASCII(getCanvas(0), { cols: 80, charset: ' .,:;+*#%@' });
const id = wm.spawn('ASCII', { type: 'html', html: '', w: 600, h: 400 });
document.getElementById(id)?.querySelector('.wm-body').appendChild(art.el);

setInterval(() => {
  draw.circle(800, 450, 100 + Math.sin(Date.now()/500)*60, '#fff');
  art.update(getCanvas(0));   // re-renders every frame
}, 50);
```

---

## editImage — Non-destructive Image Pipeline

`editImage(source)` → `EditableImage` — wraps any canvas, image, or video in a non-destructive editing pipeline. Operations accumulate; `toCanvas()` applies them all and caches the result.

```js
const img = editImage(await Media.image('https://example.com/photo.jpg'));
img.crop(100, 0, 800, 600)
   .rotate(15)
   .filter('hue-rotate(90deg) saturate(2)')
   .flipH();

draw.image(img.toCanvas(), 0, 0);
```

### Methods

```js
img.crop(x, y, w, h)        // cut a region
img.rotate(deg)              // rotate (canvas expands to fit)
img.filter(cssFilterStr)     // apply CSS filter (blur, sepia, hue-rotate, etc.)
img.flipH()                  // horizontal mirror
img.flipV()                  // vertical mirror
img.blend(other, mode)       // composite with another canvas/EditableImage (default: 'screen')
img.reset()                  // discard all ops, back to source
img.toCanvas()               // → HTMLCanvasElement (cached; call after ops)
img.draw(drawTarget, x, y, w?, h?)  // convenience: draws toCanvas() onto a DrawTarget
img.width / img.height       // current output dimensions
```

---

## Z-order Reference

`draw.at(z)` / `getCanvas(z)` take a **logical z** mapped to CSS z-index as `20 + z`. Media and Shader set CSS z-index directly.

| Logical z | CSS z-index | Default use |
|-----------|-------------|-------------|
| negative  | negative    | Behind camera feed |
| 0         | 20          | Main canvas — `draw`, `getCanvas()` |
| 1–4       | 21–24       | Safe user layers (`draw.at(1)` etc.) |
| 5+        | 25+         | Collides with Media (CSS 25) / Shader (CSS 30) defaults |
| —         | 25          | Media layers (`Media.image`, `Media.video`) |
| —         | 30          | Shader layers (`new Shader(...)`) |

---

## Examples

### Animated particle system

```js
draw.bg('#0a0a0a');

let particles = Array.from({length: 60}, () => ({
  x: Math.random() * 1600,
  y: Math.random() * 900,
  vx: (Math.random() - 0.5) * 3,
  vy: (Math.random() - 0.5) * 3,
  r: 2 + Math.random() * 6,
  hue: Math.random() * 360,
}));

setInterval(() => {
  draw.alpha(0.08).bg('#000').alpha(1);
  particles.forEach(p => {
    p.x = (p.x + p.vx + 1600) % 1600;
    p.y = (p.y + p.vy + 900) % 900;
    draw.circle(p.x, p.y, p.r, `hsl(${p.hue}, 80%, 60%)`);
  });
}, 16);
```

### Beat-reactive with layer blur

```js
draw.bg('#111');

const sig = audio.fft; // master amplitude — captures Strudel via the shared context

setInterval(() => {
  const amp = sig.value;
  draw.clear()
      .circle(800, 450, 100 + amp * 200, `hsl(${Date.now() / 20 % 360}, 80%, 60%)`);
  getLayer(0).blur(amp * 8);
}, 16);

note("c2 ~ c2 ~ c2 c2 ~ c2").play();
setcps(0.54); // ~130 bpm
```

### Two-layer compositing

```js
// Background on layer 0
draw.at(0).bg('#000');

// Foreground on layer 1 with screen blend
const fg = draw.at(1);
getLayer(1).opacity(0.8);

let t = 0;
setInterval(() => {
  t += 0.02;
  draw.at(0).alpha(0.05).bg('#000').alpha(1);
  fg.clear();
  for (let i = 0; i < 5; i++) {
    const x = 800 + Math.cos(t + i * 1.26) * 300;
    const y = 450 + Math.sin(t * 0.7 + i * 1.1) * 200;
    fg.circle(x, y, 40, `hsl(${i * 72 + t * 30}, 90%, 65%)`);
  }
}, 16);
```

---

## Render Pipeline — `pipe`

Chain visual stages from any source. One shared raf loop — no `captureWindow`, no `setInterval`, auto-cleanup on reset.

### Sources

`pipe()` accepts: `CameraStream`, `HTMLCanvasElement`, `HTMLVideoElement`, `GLShader`, `Shader`, or `Layer`.

### Stages (chainable)

| Stage | Call | What it does |
|-------|------|--------------|
| ASCII | `.ascii({ cols, rows, charset, bg, color, cellW, cellH })` | Renders luminance-mapped glyphs to a canvas. Same luma weights as `draw.toASCII`. |
| Pixelate | `.pixelate({ blockSize })` | Mosaic effect — downscale/upscale without smoothing. Reuses `draw.pixelate` logic. |
| CSS FX | `.fx(cssFilter)` | Any CSS filter string: `'blur(4px)'`, `'hue-rotate(90deg)'`, `'invert(1)'`, etc. |
| GLShader | `.glshader(body, { z, opacity })` | WebGL/GLSL stage. `uVideo` samples upstream canvas. Works in all browsers. |
| Shader | `.shader(body, { z, opacity })` | WebGPU/WGSL stage. Chrome 113+ / Safari 18+. |
| Subtitle | `.subtitle(srtText, opts)` | Overlay SRT-format captions synced to `source.currentTime`. opts: `fontSize`, `color`, `bg`, `font`, `weight`, `stroke`, `strokeColor`, `marginBottom`. |
| Custom | `.use(factory)` | Escape hatch. `factory(srcDrawable)` called once at start, returns `{ canvas, read() }`. `read()` called every frame. |

Stages can be chained arbitrarily. Shader stages self-raf; canvas stages are driven by the shared loop. Shader stages work as terminal **or** intermediate (downstream samples the shader canvas).

### Sinks

```js
.show(title, { w, h, noChrome, transparent })  // spawn a wm window
.layer(z)                                       // render onto canvas layer at z-index z
.to(el)                                         // mount into any DOM element
.start()                                        // headless — access output via .canvas
```

`.show()` auto-stops the pipeline when the window is closed.

### Examples

```js
// Camera → ASCII → show
const cam = await Camera.open();
pipe(cam)
  .ascii({ cols: 120, color: '#00ff41', bg: '#0d0208' })
  .show('ASCII Cam', { w: 700, h: 500 });

// Camera → ASCII → GLShader → show
pipe(cam)
  .ascii({ cols: 150, color: '#00ff41', bg: '#0d0208' })
  .glshader(`
    vec4 a = texture2D(uVideo, uv);
    float l = dot(a.rgb, vec3(.299,.587,.114));
    vec3 rain = .5+.5*cos(6.28*(uv.y+time*.4+vec3(0,.33,.67)));
    gl_FragColor = vec4(rain*l, 1.);
  `)
  .show('ASCII Cam', { w: 700, h: 500 });

// Pixelate + CSS fx
pipe(cam).pixelate({ blockSize: 20 }).fx('hue-rotate(120deg)').show('Retro', { w: 700, h: 500 });

// Render to canvas layer (no window)
pipe(cam).ascii({ cols: 80 }).layer(2);

// SRT subtitle overlay on a video
const srt = `1
00:00:00,000 --> 00:00:02,500
Hello world

2
00:00:02,500 --> 00:00:05,000
This is a subtitle`;

const vid = await Media.video('https://example.com/video.mp4');
pipe(vid)
  .subtitle(srt, { fontSize: 32, color: '#fff', bg: 'rgba(0,0,0,0.7)' })
  .show('Subtitled', { w: 800, h: 520 });
```

### Custom stages — `pipe.register(name, factory, descriptor)`

Package reusable processing logic as a named stage. Registered stages become chainable methods on every pipeline and appear in the text-toolkit sidebar as draggable snippets.

```js
// Register once (e.g., in a "setup" snippet you run before your sketch)
pipe.register('glowAscii', (src, opts = {}) => {
  const canvas = document.createElement('canvas');
  canvas.width = 800; canvas.height = 600;
  const ctx = canvas.getContext('2d');
  // ... setup using opts.cols, opts.color, etc.
  return {
    canvas,
    read() {
      // called every frame — src is the upstream drawable (canvas or video)
      ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
      // apply glow, ascii mapping, etc.
    },
  };
}, {
  label:  'Glow ASCII',
  hint:   'ASCII art with bloom glow',
  fields: [
    { name: 'cols',  label: 'cols',  type: 'number', default: 120 },
    { name: 'color', label: 'color', type: 'color',  default: '#00ff41' },
  ],
});

// Then anywhere in your code:
const cam = await Camera.open();
pipe(cam).glowAscii({ cols: 120, color: '#00ff41' }).show('Glow Cam', { w: 700, h: 500 });
```

**descriptor fields:**

| Field | Type | Description |
|-------|------|-------------|
| `label` | string | Display name in toolkit (default: `name`) |
| `hint` | string | Tooltip shown in toolkit sidebar |
| `fields` | array | Builds the default snippet opts. Each: `{ name, label?, type, default }` |
| `code` | string | Custom toolkit snippet (auto-generated from `fields` if omitted) |

**field types:** `'number'` → numeric scrubber, `'color'` → colour picker, `'text'` → text input, `'boolean'` → checkbox.

**Factory contract:** `factory(src, opts)` — `src` is the upstream drawable (HTMLCanvasElement or HTMLVideoElement). Return `{ canvas: HTMLCanvasElement, read() }`. `read()` is called every raf tick to pull upstream and write to `canvas`.

Stages chain with all built-ins:
```js
pipe(cam).ascii({ cols: 60 }).glowAscii({ cols: 60 }).fx('blur(2px)').show('output', { w: 700, h: 500 });
```
