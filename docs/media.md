# Media API

Image and video layers composited over the canvas.

## Images

```js
// Full-canvas image layer (awaitable)
const layer = await Media.imageLayer('https://example.com/photo.jpg');

// With options
const layer = await Media.imageLayer('https://example.com/photo.jpg', {
  z: 25,          // z-index (default 25, above canvas)
  opacity: 0.8,   // 0–1
  fit: 'cover',   // 'cover' | 'contain' | 'stretch'
});

// Change fit after creation
layer.fit('contain');
layer.opacity(0.5);
layer.z(10);

// Raw image element (draw manually)
const img = await Media.image('https://example.com/photo.jpg');
const ctx = getCanvas().getContext('2d');
ctx.drawImage(img, 0, 0, 1600, 900);
```

### ImageLayer API

| Method | Description |
|--------|-------------|
| `layer.fit(mode)` | `'cover'` `'contain'` `'stretch'` |
| `layer.opacity(0–1)` | Layer transparency |
| `layer.z(n)` | CSS z-index |
| `layer.canvas` | Underlying HTMLCanvasElement |

---

## Video

```js
// Create and play a video layer
const vid = Media.video('https://example.com/clip.mp4');
vid.play();

// With options
const vid = Media.video('https://example.com/clip.mp4', {
  z: 25,
  opacity: 0.8,
  loop: true,    // default true
  muted: true,   // default true (required for autoplay)
});
vid.play();
```

### VideoLayer API

| Method | Description |
|--------|-------------|
| `vid.play()` | Start playback and render loop |
| `vid.pause()` | Pause playback |
| `vid.stop()` | Pause and seek to 0 |
| `vid.seek(seconds)` | Jump to time |
| `vid.mute(bool)` | Mute/unmute |
| `vid.opacity(0–1)` | Layer transparency |
| `vid.z(n)` | CSS z-index |
| `vid.loop(bool)` | Toggle looping |
| `vid.canvas` | Underlying HTMLCanvasElement |
| `vid.video` | Underlying HTMLVideoElement |

---

## Examples

### Crossfade two images

```js
const a = await Media.imageLayer('https://example.com/a.jpg', { opacity: 1 });
const b = await Media.imageLayer('https://example.com/b.jpg', { opacity: 0, z: 26 });

let t = 0;
setInterval(() => {
  t = (t + 0.01) % 1;
  a.opacity(1 - t);
  b.opacity(t);
}, 16);
```

### Video + shader overlay

```js
const vid = Media.video('https://example.com/clip.mp4', { z: 10 });
vid.play();

const s = new Shader(`
  let d = distance(uv, vec2f(0.5));
  let vignette = 1.0 - smoothstep(0.3, 0.8, d);
  return vec4f(0.0, 0.0, 0.0, 1.0 - vignette);
`);
s.start(); // shader at z:30 overlays the video at z:10
```

### Beat-synced video opacity

```js
const vid = Media.video('https://example.com/clip.mp4');
vid.play();

note("c1 ~ c1 ~").play();
setcps(0.5);
on('beat:tick').do(() => {        // Strudel is locked to the Tone transport
  vid.opacity(1);
  setTimeout(() => vid.opacity(0.3), 80);
});
```

---

## Notes

- All media layers clean up automatically on Stop/Reset
- Videos must be muted for autoplay to work in browsers
- Images use `crossOrigin = "anonymous"` — the server must allow CORS
- z-index 25 puts media above the canvas (20) but below shaders (30) by default
