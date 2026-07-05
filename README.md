# createos

A live coding environment for creating audiovisual experiences in the browser — shaders, synthesizers, video, and computer vision, all from a single JavaScript editor.

> **New here?** Read [`LEARN.md`](LEARN.md) first — the one mental model (source → transform → sink) the whole environment is built on. Plain language, no jargon.

## Project Principles

This application is not the best of anything. We provide creative tools for people to play, create, and experiment, but at the end of the day, there are much more professional and powerful versions of each of the tools in here, and that's okay. We would highly encourage people to have their tools evolve with their processes.

* Reactivity
* Automation
* Flexibility and Connectedness
* Customizability

## What we offer

### Graphics
- **GPU shaders** — full-screen WebGPU/WGSL fragment shaders (`Shader`) or WebGL/GLSL (`GLShader`, all browsers, ShaderToy paste-in) with `time`, `uv`, `mouse`, and custom uniforms
- **3D scenes** — Three.js via `ThreeScene` + full `THREE` namespace; tick loop, z-layering, signal binding, opacity — composable with shaders and draw
- **PIXI.js** — WebGL scene graph for sprites, particles, rich text, per-object filters, and hit-testing; layers cleanly with shaders and draw
- **2D canvas** — draw on z-indexed layers with CSS filter effects; rich text with stroke, shadow, gradient, and web fonts (`canvas.loadFont`); `canvas.backdrop(source)` renders an image/video/camera/canvas on the layer below so all draw calls appear on top — accepts a URL, `'camera'`, any drawable element, or shader; returns `{ stop(), layer }`
- **Cross-domain signal chain** — `route(source)` wires any input to any output as explicit data: `route(Source.mic).amplitude.scale(0,1,200,800).to(osc.frequency)` (sub-ms push path), `route('midi:cc').norm(0,127).to(shader,'uCustom.x')`, `route(Source.camera).tint('#4a0').wait(3).negative().loop().show()` (Berlin Horse optical printing). Bridges: `.amplitude`, `.brightness()`, `.motion()`, `.fft()`. Live mutation: `toggle/remove/clear`. Fan-in: `.mix()`. `signalGraph.show()` auto-populates.
- **Render pipeline** — chain visual stages with `pipe(source).ascii().glshader().fx('hue-rotate(90deg)').subtitle(srt).show()`; sources: camera, canvas, video, shader; stages compose freely. New effects: `tint`, `negative`, `solarize`, `posterize`, `duotone`, `grain`, `strobe`.
- **Masking** — restrict any layer to a region. `.clip(shape)` for static geometry (compositor, free); `.mask(source)` for dynamic/arbitrary regions — the mask is any drawable (paint canvas, camera, another shader, `vision.handMask()` for hand-tracked reveals), so it can move and animate for free. Works on `Shader`/`GLShader`/`pipe`/`route` (`route(Source.camera).mask(m).wait(3).loop().show()`). `Mask.circle`/`Mask.feather`/`Mask.register` for procedural masks.

### Audio
- **Synthesis** — synths, sequencers, effects chains via [Tone.js](https://tonejs.github.io/); pattern sequencing with the real [Strudel](https://strudel.cc/) / [TidalCycles](https://tidalcycles.org/) engine — explicit calls, full strudel.cc compatibility (`note("c e g").fast(2).every(4, p => p.rev()).play()`). Tempo is shared (Tone is master clock); all Strudel sound routes through one mixer **Strudel** strip. Samples are bring-your-own: `note(...)` works with no setup, `s("bd hh")` needs `samples('github:…')` first
- **Drum machine** — `audio.drumpad()` or toolbar 🥁 button opens an 8-pad drum machine with 16-step sequencer; keyboard shortcuts q/w/e/r/a/s/d/f; programmatic `.pattern(vi, 'x . x .')` and `.bpm(128)`; event/signal API: `.onPad('kick', fn)`, `.onHit(fn)`, `.onStep(fn)`, `.signal('kick', {decay})→{value,stream}` — hooks are per-instance and cleared on reset
- **Visualization** — live spectrogram, piano roll, and EQ widget (draggable frequency curve over live FFT); `audio.fft.bass/mid/high` as control signals; visualizer windows have customizable background and waveform colors persisted across reloads
- **MIDI** — Web MIDI input: `midi.onNote(fn)`, `midi.onCC(ch, cc, fn)`, `midi.signal(ch, cc)` → live 0–1 signal wired to anything
- **Voice & TTS** — recognize spoken words with `audio.onWord()` / `audio.onSpeech()`, speak with `audio.say()`

### Camera & Vision
- **Camera streams** — open one or many cameras with `Camera.open()`; `CameraStream.element` is a live `<video>` usable as shader input or pipeline source
- **Computer vision** — react to hand gestures, facial expressions, and detected objects via [MediaPipe](https://github.com/google-ai-edge/mediapipe); `vision.onGesture()`, `vision.onExpression()`, `vision.face()`

### Signals & Input
- **Reactive event bus** — `on('beat:tick').every(4).do(fn)`, `any('gesture:detected', 'midi:note:on').do(fn)`, `emit('wm:spawn', opts)` — composable subscriptions with `.every()/.after()/.within()/.when()` modifiers; every subsystem emits lifecycle events; editor autocompletes event names
- **`tick(ms)` + `hold(event)`** — `tick(16).do(() => …)` composable interval; `hold('window:key:down')` live Set of held keys; `hold('window:mouse:move')` live `{x,y}` — one reactive model for everything
- **Sensors on the bus** — `on('sensor:gamepad')`, `on('sensor:motion')`, `on('sensor:geo')`, `on('sensor:battery')`, `on('sensor:network')`; all lazy (start on first subscriber); haptics via `emit('haptics:vibrate', …)`
- **WebSerial & GPIO** — `on('gpio:pin')` reads Arduino/ESP32/Pico analog+digital pins; `emit('gpio:write', {pin, value})` drives outputs; custom `parse`/`serialize` for any protocol; port survives resets (Chrome/Edge)
- **External data** — pull live signals from web APIs and weather with `external.weather(lat, lon)` and `external.signal(url, selector)`

### Media
- **Video** — play, seek, loop, and layer video with `Media.video()`; sample regions as live brightness/motion/color signals via `video.signal()`
- **Images** — overlay, crop, rotate, filter, and blend images with `editImage()`; z-ordered on any canvas layer
- **Subtitles** — SRT overlay synced to video playback via `pipe(vid).subtitle(srt).show()`

### Desktop & Windows
- **Window management** — spawn floating windows (image, video, camera, canvas, shader, HTML) from code; move/resize/maximize/filter with `wm.spawn`, `wm.layout`, `wm.filter`, etc.
- **Sensor monitors** — toolbar gauge icon spawns Motion/Gamepad/Geolocation/Battery monitor windows; also via `wm.spawn('Motion', { type: 'sensor', source: 'motion' })`
- **File management** — pick files with `wm.pickFile()`, browse directories with `wm.browse()`; manage desktop icons with `desktop.add/onFile/files`
- **Demo gallery** — toolbar 🎬 button opens a gallery of curated runnable demos; each loads a full project layout via `applyProject()`
- **Pixel art** — `Sprite` API for programmatic pixel-grid sprites; `spriteEditor()` or toolbar paintbrush＋ button opens an Aseprite-style paint GUI with pencil/eraser/fill/eyedropper/line/rect tools, multi-frame timeline, onion skinning, and ⤓ Code / ⤓ PNG / ⤓ Sheet export; `sp.edit()` on any existing sprite opens the GUI on it. **Event/signal API**: `sp.onPixel(fn)`, `sp.onStroke(fn)`, `sp.signal('pixel', {decay,region})` — drive audio/shader params from brush activity
- **Paint canvas** — `paint()` or toolbar 🖌️ button opens a freehand doodle canvas; tools: pen (smooth quadratic strokes), eraser, line, rect, ellipse, fill, eyedropper; adjustable brush size (1–64px), background color, multi-frame animation with onion skinning, undo/redo (Cmd+Z), autosave to desktop icon, ⤓ Code / ⤓ PNG / ⤓ Sheet export. **Backdrop support**: pass `backdrop:'url'` or click 🖼 in the toolbar to load an image or video as a reference layer beneath strokes; 📷 Freeze frame bakes a live video frame to static for tracing; export composites backdrop + drawing. **Event/signal API**: `p.onStroke(fn)`, `p.signal('stroke', {decay,region})` — spatially-scoped decaying signals react to where on the canvas you draw
- **In-window paint overlay** — every image, video, camera, canvas, and shader window has a 🖌️ titlebar toggle that activates a drawing canvas over the live content with a compact pen/eraser/color/size/clear/snapshot toolbar; 📷 Snapshot composites the visual frame + drawing into a PNG desktop icon. **Event/signal API**: `wm.onStroke(winId, fn)`, `wm.paintSignal(winId, 'stroke', {decay})` — draw over a live camera feed and drive shader parameters from your strokes
- **Capture & Record** — take a still photo or record video from the webcam (`cam.photo()`, `cam.record()`); record any canvas/shader/camera output window to a WebM (`wm.record(winId)`); snapshot any window to a PNG (`wm.snapshot(winId)`); captures land as persistent desktop icons (IndexedDB-backed, survive reload) with optional immediate download; 📷/🔴 titlebar buttons on all visual windows
- **Performance capture & replay** — every widget (Drumpad, Piano, SpriteEditor, AsciiEditor, Notepad, Paint) has a **Capture ●** button that records what you *do* over time (not video, not a snapshot) and inserts it back as runnable code: `p.replay([{t:0,note:'C4',dur:200}, …])`. A desktop **Global Capture ●** records every open widget on one clock and emits a `timeline().track(p, take, {at}).play()` you can splice by hand. Wall-clock ms; replays pause/clean with the run (ADR 031)
- **Notepad** — `notepad()` / `new Notepad({ title, w, h })` opens a rich-text window widget (serif font, light background, formatting toolbar). Fully programmable: `note.cursor(pos)`, `note.select(from, to)`, `note.insert/delete/replace`, `note.color/highlight/bold/italic`. Animated fake-typing via `await note.type('text', { cps:15 })` and `note.backspace(n)`; fires `note:char` per character for reactive audio/visuals. Content autosaves to a `.note` desktop icon.
- **ASCII art editor** — `asciiEditor()` or toolbar terminal＋ button opens an interactive colored ASCII art editor (asciistudio.app-style); per-cell foreground + background color; tools: type (keyboard entry with caret), brush, eraser, flood fill, eyedropper, line, rect; character palette (`░▒▓█▀▄■`…) + custom glyph input; animation frames with onion skinning, undo/redo (Cmd+Z), autosave to desktop icon; export as runnable `ascii.play([...])` code snippet (with full color), plain text, or ANSI escape-coded text. **Event/signal API**: `ae.onCell(fn)`, `ae.signal('cell', {decay, region:{x,y,w,h}})` — cell coordinates for region-scoped triggers

## Editor features

- [CodeMirror 6](https://codemirror.net/) with syntax highlighting, bracket matching, code folding, and inline widgets
  - **Color swatches** — click any color string to open an HSL picker; edits write back to the source
  - **Number scrubbers** — drag any numeric literal to change its value live
  - **Syntax linting** — squiggles + hover tooltips on parse errors; runtime error highlights
- **Blocks panel** (toggle on/off) — visual [Blockly](https://developers.google.com/blockly) workspace for Audio, Shader, GLShader, PIXI, Vision, Canvas, and Media blocks; coexists with the text editor
- **API drawer** (toggle on/off) — drag-to-text code snippets for every API
- Infinite loop protection ([Esprima](https://esprima.org/))
- Friendly runtime error messages
- Pause / Resume program execution
- **Auto-execute** (⚡ toolbar toggle) — re-runs code 1s after each edit; syntax-gated so broken code doesn't tear down a running sketch
- **Share / Embed** — toolbar button encodes the full desktop to a URL (`?embed=1&project=<b64>`); opening it runs the art fullscreen with no editor chrome

## Known Weird Behavior

* Is there a way to not exit fullscreen when using the browser’s file picker?
    * Not feasible. Browser forces fullscreen exit for native file pickers — security feature, can't override. You can try re-requesting fullscreen after the picker resolves, but:
        * Causes visible flash (exit → dialog → re-enter)
        * requestFullscreen() needs a user gesture; whether the picker's .then() counts varies by browser/version
        * Unreliable on Safari
    * Proactive exit is the right call — makes behavior predictable instead of broken. Current fix stands.
* Can you remove that annoying upload prompt?
    * That's Chrome/browser security — required before showDirectoryPicker grants folder access. Can't remove it, it's outside our control.

## APIs available in user code

### Graphics

```js
// Shader — WebGPU/WGSL (Chrome/Edge/Safari 18+)
const shader = new Shader(`
  let col = vec3f(uv.x, uv.y, sin(time) * 0.5 + 0.5);
  return vec4f(col, 1.0);
`);
shader.start();

// GLShader — WebGL/GLSL (all browsers)
new GLShader(`
  gl_FragColor = vec4(uv.x, uv.y, sin(uTime)*0.5+0.5, 1.0);
`).start();

// ShaderToy paste-in — void mainImage auto-detected, zero edits needed
new GLShader(`
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / uResolution;
  vec3 col = 0.5 + 0.5 * cos(uTime + uv.xyx + vec3(0,2,4));
  fragColor = vec4(col, 1.0);
}
`).start();

// Post-process shader FX
new ShaderFX('blur').start();

// Three.js 3D scene
const scene = new ThreeScene({ w: 800, h: 600 }).start();
const mesh = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshNormalMaterial()
);
scene.add(mesh);
scene.tick(({ time }) => { mesh.rotation.y = time; });

// 2D drawing surface — owns a window; PIXI/draw composite into it (ADR 040)
const canvas = new Canvas();
pixi.mount(canvas);   // mount the PIXI view as the z=25 plane of canvas's window

// PIXI — scene graph, sprites, particles, filters (WebGL, z=25)
const g = new PIXI.Graphics();
g.beginFill(0x4488ff);
g.drawCircle(0, 0, 60);
g.endFill();
g.x = pixi.screen.width / 2;
g.y = pixi.screen.height / 2;
Stage.addChild(g);
pixi.tick(() => { g.rotation += 0.01; }); // cleaned up on Stop

const sprite = PIXI.Sprite.from('https://example.com/hero.png');
sprite.anchor.set(0.5);
sprite.interactive = true;
sprite.on('pointerdown', () => canvas.bg(Color.random()));
Stage.addChild(sprite);

// 2D draw (layer 0)
canvas.bg('#000').circle(400, 300, 50, 'red');
canvas.text('HELLO', 400, 300, 72, '#fff', {
  stroke: true, strokeColor: '#f0f', strokeWidth: 3,
  shadow: true, shadowBlur: 20, shadowColor: '#f0f',
  gradient: ['#f0f', '#0ff'],
});
await canvas.loadFont('Orbitron', 'https://fonts.gstatic.com/...');
canvas.text('SPACE', 400, 400, 48, '#0ff', { font: 'Orbitron' });

// Raw canvas layers
const ctx = canvas.el.getContext('2d');
ctx.fillStyle = 'red';
ctx.fillRect(0, 0, 100, 100);
canvas.fx(0).blur(5);

// Render pipeline — chain visual stages
const cam = await Camera.open();
pipe(cam).ascii({ cols: 120, color: '#0f0', bg: '#000' }).show('ASCII Cam');
pipe(cam).glshader(`
  vec4 c = texture2D(uVideo, uv);
  gl_FragColor = vec4(c.b, c.r, c.g, 1.0);
`).show('Channel Swap');

// Capture a DOM element to canvas (usable as shader video input)
const cap = captureWindow(document.getElementById('win-editor'), 12);
```

### Audio

```js
// Synthesis
const s = audio.synth();
s.play('C4', '8n');
audio.bpm(120);
audio.start();

// Pattern sequencing — real Strudel (strudel.cc), explicit calls
note("c e g b").fast(2).every(4, p => p.rev()).play();

// Mic level trigger (enable mic in toolbar first)
audio.onLevel(0.7, () => canvas.bg('red'), () => canvas.bg('black'));
setInterval(() => console.log(audio.level.toFixed(3)), 100); // live 0–1 RMS

// Audio visualization — fft signals usable as control values
console.log(audio.fft.bass, audio.fft.mid, audio.fft.high);

// MIDI
await midi.open();
midi.onNote((note, vel, ch) => audio.synth().play(note, '8n'));
midi.onCC(1, 74, v => shader.set(v)); // CC 74 → shader uniform
const cutoff = midi.signal(1, 74);    // live 0–1 signal

// Voice recognition (Chrome/Edge — Web Speech API)
audio.onWord('red', () => canvas.bg('red'));
audio.onSpeech((text) => canvas.text(text, 50, 50));

// Text to speech
audio.say('hello world');
audio.say('slow and low', { voice: 'Samantha', rate: 0.6, pitch: 0.8 });
console.log(audio.voices()); // list available voice names
```

### Camera & Vision

```js
// Camera streams
const cam = await Camera.open();  // CameraStream — cam.element is a <video>
console.log(await Camera.list()); // list available devices

// Multiple cameras
const cam0 = await Camera.open({ index: 0 });
const cam1 = await Camera.open({ index: 1 });
cam0.flip(true); // mirror horizontally

// Computer vision — MediaPipe gestures, expressions, object detection
vision.onGesture('Thumb_Up', () => { /* ... */ });
vision.onExpression('smile', () => canvas.bg('yellow'));
const face = vision.face(); // { expression, cx, cy, landmarks }
```

### Signals & Input

```js
// Keyboard & mouse — all on the event bus
on('window:key:down').when({ w: () => y -= 5, s: () => y += 5, a: () => x -= 5, d: () => x += 5 });

const keys  = hold('window:key:down');   // live Set of held keys
const mouse = hold('window:mouse:move'); // live { x, y }

tick(16).do(() => {
  canvas.circle(mouse.x, mouse.y, 10, 'white');
  if (keys.has('ArrowLeft')) x -= 5;
});

// Device sensors — lazy bus events (start on first subscriber, stop on last)
on('sensor:gamepad').do(({ axes, pressed }) => {
  // axes[0] = left stick x, axes[1] = left stick y
  // pressed[0] = A/Cross button
});

on('sensor:motion').do(({ magnitude, gamma, beta }) => console.log(magnitude));
on('sensor:shake').when(d => d.magnitude > 20).do(() => canvas.clear());

on('sensor:geo').do(g => canvas.text(`${g.lat?.toFixed(4)}, ${g.lon?.toFixed(4)}`, 50, 50));

on('sensor:battery').do(({ level, charging }) => console.log(level, charging));

// Video signals — sample canvas/camera region as live numeric signals
const sig = video.signal('camera', { x: 0.5, y: 0.5, radius: 0.1 });
sig.stream(s => console.log(s.brightness, s.motion, s.hue));
video.onMotion('camera', 0.3, () => canvas.bg('red'), () => canvas.bg('black'));

const sig2 = video.signal(canvas.el, { x: 0.2, y: 0.8 });
sig2.stream(s => { /* s.brightness live every frame */ });

// External data signals
const wx = external.weather(37.77, -122.41);
wx.stream(w => canvas.text(`${w.temp}°C`, 50, 50));

const price = external.signal('https://api.example.com/btc', '.price');
price.stream(v => canvas.text(`$${v}`, 50, 100));
```

### Media

```js
// Video
const vid = Media.video('https://example.com/clip.mp4');
vid.play();

// Video with SRT subtitles via render pipeline
pipe(vid).subtitle(srtString, { fontSize: 28 }).show('Subtitled');

// Images — load, edit, draw
const img = editImage('https://example.com/photo.jpg');
img.crop(0, 0, 400, 300).rotate(15).filter('grayscale(1)').draw(draw, 100, 100);
```

### Desktop & Windows

```js
// Spawn floating windows
wm.spawn('Info',  { type: 'html',   html: '<h2>hello</h2>', w: 320, h: 240 });
wm.spawn('Photo', { type: 'image',  src: url, w: 480, h: 360 });
wm.spawn('Clip',  { type: 'video',  src: url, w: 640, h: 480, controls: true });
wm.spawn('Cam',   { type: 'camera', w: 320, h: 240 });
wm.spawn('Layer', { type: 'canvas', z: 0,   w: 640, h: 480 });
wm.spawn('FX',    { type: 'shader', shader: s, w: 640, h: 480 });

// Window control
wm.show('win-canvas');   wm.hide('win-canvas');   wm.toggle('win-console');
wm.focus('win-editor');  wm.close(id);
wm.move(id, 200, 100);   wm.resize(id, 640, 480);
wm.maximize(id);          wm.restore(id);
wm.layout('split');
console.log(wm.list());

// Per-window audio routing
synth.connect(wm.channel(id));

// File picker — returns blob URL; caches handle by key (no re-prompt)
const url = await wm.pickFile('myPhoto');

// Directory browser — spawns a file-tree window; click file → callback
await wm.browse('assets', (url, name) => {
  wm.spawn(name, { type: 'image', src: url });
});

// Desktop file icons
desktop.onFile(({ name, type, url }) => {
  wm.spawn(name, { type, src: url });
});
desktop.add(url, { name: 'snapshot.png', type: 'image' });
console.log(desktop.files());
```

## Dev

```sh
npm install --legacy-peer-deps
npm run dev                               # dev server
node node_modules/vite/bin/vite.js build  # production build
npm test                                  # run all tests
```

## License

[AGPL-3.0-or-later](./LICENSE). createos bundles the [Strudel](https://strudel.cc/) pattern engine (AGPL-3.0), which makes the whole application AGPL — see [ADR 036](./docs/adr/036-agpl-adoption.md). If you run a modified version as a network service, you must offer your users its source.
