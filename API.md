# Visual Live Coding IDE — API Reference

> Compact reference for agents generating code for this IDE. Canvas is 1600×900. All APIs on `window`. User code runs as a plain script (not a module). All timers/listeners/resources auto-cleanup on Stop.

---

## Draw — the `Canvas` 2D API

> **ADR 040**: the global `draw` / `getCanvas` / `getLayer` / `getDraw` are **deleted**. 2D drawing is done on a `new Canvas()` instance (see [Canvas](#canvas--new-canvasopts) below). Every method below is on a Canvas `c`. Methods are chainable.

```js
const c = new Canvas();                     // the 2D surface (owns its window)
c.bg(color)                                 // fill canvas
c.clear()                                   // clear to transparent
c.rect(x, y, w, h, color)
c.circle(x, y, r, color)
c.arc(x, y, r, startRad, endRad, color)
c.poly([[x,y],...], color)                  // filled polygon
c.rectStroke(x, y, w, h, color, thickness)
c.ring(x, y, r, color, thickness)
c.line(x1, y1, x2, y2, color, thickness)
c.text(str, x, y, size, color, {font, align, baseline, weight, style,
          stroke, strokeColor, strokeWidth,
          shadow, shadowColor, shadowBlur, shadowX, shadowY,
          gradient}?)                         // gradient: array of CSS colors top→bottom
c.loadFont(name, url)                       // async — FontFace API, await before c.text
c.image(img, x, y, w?, h?)
c.push() / c.pop()                          // save/restore transform+alpha+blend
c.translate(x, y) / c.rotate(rad) / c.scale(x, y?)
c.resetTransform()
c.alpha(0–1) / c.blend(mode)                // modes: 'screen' 'multiply' 'lighter' etc.
c.pixelate(source, blockSize, x?, y?, w?, h?)   // blocky pixelation of any canvas/video
c.toASCII(canvas, {cols, rows, charset, bg, color}) → { el: <pre>, update(canvas) }
c.backdrop(source, {z?, fit?, loop?})       // render image/video/camera below draw calls
  // source: URL string | 'camera' | HTMLImageElement | HTMLVideoElement | CameraStream |
  //         HTMLCanvasElement | GLShader | Shader | Layer
  // fit: 'cover' (default) | 'contain' | 'stretch'
  // Returns { stop(), layer } — stop() cancels live video loop; auto-cleaned on reset.
c.width  // logical width   c.height // logical height   c.el // <canvas> element
```

### Layers & CSS effects (per-Canvas)

```js
c.layer(z)                            // a DrawTarget over a higher z-plane of c's window
c.fx(z?)                              // CSS-effect wrapper over plane z of c's window:
  .blur(px) .hue(deg) .brightness(n) .saturate(n) .invert(n) .opacity(n)
  .blendMode(mode)                    // CSS mix-blend-mode: 'screen' 'multiply' 'overlay' etc.
  .rotate(deg) .rotateX(deg) .rotateY(deg) .scale(x, y?) .perspective(px)
  .clip('circle(50%)') .reset()
```

Planes are owned by the window (WM compositor, ADR 040): `wm.layer(winId, z)`. Z-order: logical z → CSS z-index `20+z`. Media defaults to CSS 25, Shader to CSS 30, paint overlay 50, text 51.

### Image editing

```js
editImage(source)            // source: canvas | HTMLImageElement | HTMLVideoElement
  .crop(x, y, w, h)
  .rotate(deg)               // canvas expands to fit
  .filter(cssStr)            // 'blur(4px) hue-rotate(90deg)' etc.
  .flipH() / .flipV()
  .blend(other, mode)        // composite with another canvas/EditableImage
  .reset()                   // discard all ops
  .toCanvas()                // → HTMLCanvasElement (cached)
  .draw(drawTarget, x, y, w?, h?)
  .width / .height           // current output dimensions
```

---

## Canvas — `new Canvas(opts?)`

The **sole 2D drawing surface** (ADR 038/040 — there is no global `draw`). Spawns its own wm window with a 2D canvas at a chosen size and exposes the full fluent draw API (above) scoped to it. A `Canvas` owns its window — so its pointer coordinates arrive **already mapped into its own canvas space**, no `getBoundingClientRect()` math. A sketch that draws starts with `new Canvas()`; a sketch that doesn't (audio/events/MIDI) needs none.

```js
const c = new Canvas({ w: 800, h: 600, title: 'Sketch' });  // default w/h → 1600×900 (16:9)
// opts: w, h, title, x, y, noChrome, transparent

c.bg('#0a0a14').circle(400, 300, 40, '#fff');   // full draw API, chainable, scoped to this canvas
c.rect(x, y, w, h, 'red');                       // …every draw method works on c

c.layer(z)           // DrawTarget over a higher plane of this window
c.fx(z?)             // CSS-effect wrapper (blur/opacity/blendMode/…) for plane z

c.pointer            // live { x, y, down } in THIS canvas's coords (0..w / 0..h)
c.on('down', ({ x, y, button }) => { … })        // pointer down  — coords pre-mapped
c.on('move', ({ x, y }) => { … })                // pointer move
c.on('up',   ({ x, y }) => { … })                // pointer up

c.width / c.height   // logical size (the constructed w / h)
c.winId              // the spawned window id
c.el                 // underlying <canvas> element (for snapshot / compositing)
c.remove()           // tear down (also happens on reset / window close)
```

**Coordinate model**: fixed logical backing store at `w×h`, CSS-stretched to fill the window. Coordinates are stable on resize — `c.circle(400, 300, …)` stays put at any window size. Open multiple `Canvas` surfaces, each its own size/aspect; windows cascade and **survive auto-exec by identity** (key = `{id}` or `title+w+h`), so live-coding doesn't flash-rebuild them.

**Interaction**: while a `Canvas` is listening to its pointer, body-drag on its window is suppressed (the body drives the sketch); move the window from the **titlebar**. Run-scoped — cleared on reset; closing the window stops it.

---

## Shader — `new Shader(body, opts?)`

WebGPU fragment shaders. Chrome 113+ / Safari 18+.

Write only the fragment body — pre-declared: `pos` (vec2f px), `uv` (vec2f 0–1), `time` (f32 s), `res` (vec2f), `mouse` (vec2f 0–1), `custom` (vec4f user uniform).

```js
const s = new Shader(`
  let col = vec3f(uv.x, uv.y, sin(time) * 0.5 + 0.5);
  return vec4f(col, 1.0);
`, { z: 30, opacity: 1.0, video: null });

s.start()              // begin render loop
s.stop()               // pause
s.set([r, g, b, a])   // set all custom channels
s.set(index, value)    // set one channel (0=x 1=y 2=z 3=w)
s.video(source)        // set video/canvas source
s.mask(source, opts?)  // restrict to a mask drawable's region (see Masking below)
s.opacity(0–1)
s.z(n)
```

Video input: pass `{ video: source }` in opts. Two WGSL bindings auto-declared: `video` (texture_2d<f32>), `videoSampler` (sampler). Sources: `window.__ar_video` (live camera), any `HTMLVideoElement`, any `HTMLCanvasElement`.

If fragment body starts with `@fragment` or `@vertex` → treated as full WGSL.

**JS arrow function** — compiled to WGSL at runtime via `jsToWGSL`. Destructure from `{ uv, time, mouse, res, custom }`, return `[r, g, b, a]` array:
```js
const s = new Shader(({ uv, time }) => {
  const r = Math.sin(uv.x * 10 + time) * 0.5 + 0.5;
  const g = Math.cos(uv.y * 8  - time) * 0.5 + 0.5;
  return [r, g, 0.5, 1.0];
});
```
The JS form round-trips cleanly to/from Blocks — each expression decomposes into connectable Scratch-style blocks.

---

## GLShader — `new GLShader(body, opts?)`

WebGL/GLSL fragment shaders. Works in **all browsers** (Chrome, Firefox, Safari, mobile).
Use when: porting ShaderToy code, targeting Firefox, or when an LLM generates GLSL.

Same API shape as `Shader`:
```js
const s = new GLShader(`
  // Pre-declared: uv (vec2 0-1), time, mouse, custom
  // Set gl_FragColor to output
  gl_FragColor = vec4(uv.x, uv.y, sin(uTime)*0.5+0.5, 1.0);
`, { z: 30, opacity: 1.0, video: null });

s.start()              // begin render loop
s.stop()               // pause
s.set([r, g, b, a])   // set all custom channels (uCustom)
s.set(index, value)    // set one channel (0=x 1=y 2=z 3=w)
s.video(source)        // set video/canvas source (uVideo sampler2D)
s.bind(audioSignal)    // auto-fill uCustom = [rms, bass, mid, high]
s.opacity(0–1)
s.z(n)
```

**Source detection:**
- Contains `void main()` or `#version` → used as-is (full GLSL program)
- Contains `void mainImage(out vec4, in vec2)` → **ShaderToy mode** — auto-wrapped
- Otherwise → fragment body, auto-wrapped with uniforms

**ShaderToy paste-in** — works with zero changes:
```js
new GLShader(`
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / uResolution;
  vec3 col = 0.5 + 0.5 * cos(uTime + uv.xyx + vec3(0,2,4));
  fragColor = vec4(col, 1.0);
}
`).start();
```

**Presets:** `GLSL_PRESETS` — `{ gradient, plasma, waves, circles, noise }` fragment body strings.

---

## Masking — `.clip()` (static) · `.mask()` (dynamic)

Restrict a layer to a region. Two tools, split by **static geometry vs dynamic content** (not by backend):

**`.clip(shape)`** — fixed or CSS-animatable geometry (circle/polygon/SVG path), via `clip-path` on the layer element. Compositor-thread, effectively free. On any mounted layer (`Canvas.fx(z)`, Layer).

```js
c.fx(30).clip('circle(30% at 50% 50%)');
c.fx(30).clip('polygon(50% 0, 100% 100%, 0 100%)');
```

**`.mask(source, opts?)`** — restrict to the region defined by any **Drawable Source**'s live pixels (a paint canvas, camera feed, another shader, a hand-tracking canvas). On `Shader`, `GLShader`, and the pipeline (`pipe`/`route`). Dynamic for free — a live source re-uploads every frame.

```js
const m = Mask.circle({ x: 0.5, y: 0.5, r: 0.3 });
new Shader(SHADER_PRESETS.plasma).mask(m).start();
tick(() => m.update({ x: 0.5 + Math.sin(performance.now() / 500) * 0.3 }));

s.mask(null);           // clear the mask
```

`opts = { channel: 'luminance' | 'alpha', invert: false }`. `channel` selects how a source pixel reduces to coverage (default luminance — draw white shapes on black); `invert` flips it. The mask stretches to the layer (same mapping as `.video()`). Single mask per shader (last-wins).

**`Mask`** — procedural shape factories (white-on-black, normalized 0–1 coords, `.update(opts)` for animation):
```js
Mask.circle({ x, y, r })                    // hard-edged disc
Mask.feather({ x, y, r, softness })         // soft radial edge
Mask.register('name', (opts) => canvas)     // add your own; also Mask.name(opts)
```

**Pipeline / temporal masking** — `route(...).mask()` and `pipe(...).mask()` are timeline-able (`.wait()`/`.loop()`/`.toggle('mask')`). Chaining **intersects** separate sources:
```js
route(Source.camera).mask(handMask).wait(3).clearEffects().wait(2).loop().show();
pipe(Source.camera).mask(a).mask(b).show();  // a ∩ b (two multiply passes)
pipe(Source.camera).glshader(body, { mask }).show();  // forward a mask into a string-body shader
```

**`vision.handMask(opts?)`** — a ready-to-use mask tracking hand landmarks (mirror + smoothing handled, self-driving). `opts`: `{ landmark = 8, radius = 0.12, shape = 'circle', smoothing = 0.3, mirror = 'auto' }`.
```js
new Shader(body).mask(vision.handMask({ landmark: 8, radius: 0.15 })).start();
```

**Live control:** `emit('shader:mask', { id, source, opts })` swaps a running shader's mask from outside its own code.

See ADR 054 for the second-pass mechanism (masking is a compositing op on rendered output, so it works on every shader form — body, ShaderToy, full-source).

---

## PIXI — `pixi`, `Stage`, `PIXI`

PIXI.js v7 — WebGL scene graph. Use for: sprites, particles, text, per-object filters, hit-testing.
Use `Shader`/`GLShader` for full-screen pixel effects. They layer: PIXI z=25, Shader z=30.

```js
// window.pixi  = PIXI.Application
// window.Stage = pixi.stage (root container)
// window.PIXI  = PIXI namespace

// Sprite from URL
const sprite = PIXI.Sprite.from('https://example.com/hero.png');
sprite.anchor.set(0.5);
sprite.x = pixi.screen.width / 2;
sprite.y = pixi.screen.height / 2;
Stage.addChild(sprite);

// Animation loop — tracked, cleaned up on Stop
pixi.tick(delta => {
  sprite.rotation += 0.01;
});

// Graphics
const g = new PIXI.Graphics();
g.beginFill(0xff6600);
g.drawCircle(0, 0, 60);
g.endFill();
g.x = 400; g.y = 225;
Stage.addChild(g);

// Text
const t = new PIXI.Text('hello', new PIXI.TextStyle({ fontSize: 48, fill: '#fff' }));
t.anchor.set(0.5);
Stage.addChild(t);

// Blur filter on any display object
sprite.filters = [new PIXI.filters.BlurFilter()];

// Container (group)
const group = new PIXI.Container();
group.addChild(sprite);
Stage.addChild(group);
```

**Key notes:**
- `pixi.tick(fn)` — preferred over `pixi.ticker.add(fn)`. Tracked for cleanup on Stop.
- `pixi.screen.width/height` — current canvas dimensions (responsive).
- `interactive = true` + `.on('pointerdown', fn)` — per-object click/hover.
- PIXI canvas is transparent, sits at z=25. Draw API (z=0) visible behind it.
- `Stage.removeChildren()` — clear scene. Auto-cleared on Stop.

---

## Audio — `audio`

Tone.js wrapper. `audio.start()` required to begin transport.

### Synths

```js
audio.synth(opts?)    // basic oscillator
audio.poly(opts?)     // polyphonic
audio.fm(opts?)       // FM — rich/metallic
audio.am(opts?)
audio.pluck(opts?)    // Karplus-Strong
audio.kick(opts?)     // membrane — kick/tom
audio.metal(opts?)    // metallic — hi-hats (no note arg)
audio.noise(opts?)    // white noise (no note arg)

s.play(note, dur, time?)   // dur: '8n' '4n' '1n' or seconds
s.attack(note) / s.release()
s.volume(db) / s.connect(fx) / s.chain(fx1, fx2)
```

### Voices — `Voice` (design your own synth, ADR 046)

A **Voice** is a named, reusable, declarative sound descriptor any trigger surface
(Piano / Drumpad / Launchpad) can play. Authored no-code in the **Synth Designer** panel
or in code; embedded inline in bindings, so it travels with a project.

```js
Voice.define('Bass', {
  engine: 'mono',        // fm|am|basic|mono|duo|pluck|membrane|metal|noise
  poly: false,
  opts: { oscillator: { type: 'sawtooth' }, envelope: { attack: 0.01, release: 0.3 } },
  effects: [{ type: 'filter', frequency: 600 }, { type: 'distortion', distortion: 0.2 }],
});
Voice.define('Fn', () => ({ engine: 'pluck', poly: false })); // factory form (power-user door)

const v = Voice.make('Bass');     // or Voice.make({engine:'fm', effects:[...]})
v.output.toDestination();         // connect output to a destination / mixer strip
v.trigger('C2', '8n');            // one-shot
v.attack('C2'); v.release('C2');  // note on/off

Voice.list() / Voice.get(name) / Voice.remove(name) / Voice.engines()
Voice.design(seed?)               // open the visual Synth Designer panel (no-code)
```

Effect descriptor types: `reverb` (decay, wet), `chorus`, `delay` (delayTime, feedback, wet),
`distortion` (distortion, wet), `filter` (filterType, frequency, Q), `compressor`
(threshold, ratio).

**Sample Voices** — play a recorded buffer instead of a synth:

```js
// Chromatic: one sample pitched across keys (Tone.Sampler) — pitch up speeds up
Voice.sample({ name: 'Vox', url: 'vox.wav', mode: 'chromatic', baseNote: 'C4' });
// Chopped: cut a loop into slices, each playable (finger-drumming)
const d = Voice.sample({ name: 'Break', blob: myBlob, mode: 'chopped', slices: 16 });
const v = Voice.make('Break');
v.output.toDestination();
v.triggerSlice(3);            // play slice index 3
v.trigger(3, '8n', t);        // numeric note = slice index for chopped voices
// preserveLength:true → Tone.GrainPlayer (pitch independent of tempo)
```

`blob`/`file` are stored in the IDB capture store and carried as a `blobKey` (travels like
captured media, ADR 016); a direct `url` loads synchronously. Chopped voices expose
`v.triggerSlice(i, time?, vel?)` and `v.sliceCount()`.

**Faust Voices (physical modeling)** — compile Faust DSP to WASM in-browser (ADR 046 P4):

```js
// Built-in physical-modeling presets: 'Bowed String', 'Marimba', 'Clarinet', 'Flute'
audio.piano().voice('Bowed String');   // play a bowed string across the keys
audio.launchpad().bind(0, 'Marimba');

// Design your own from Faust source (physmodels.lib = pm.*):
Voice.faust('Guitar', 'import("stdfaust.lib"); process = pm.nylonGuitar_ui_MIDI <: _,_;');
Voice.faust('Bell', bellDsp, { poly: true, voices: 8 });
```

The ~5 MB libfaust compiler downloads on first Faust Voice use (lazy). A Faust Voice plays
on any surface + binding like any other. Note: Faust `keyOn` is immediate, so sequenced
Faust voices aren't sample-accurate (P4a).

### Effects

```js
audio.reverb(decay)                      // decay in seconds
audio.delay(time, feedback)
audio.distort(amount)                    // 0–1
audio.chorus(freq, delay, depth)
audio.filter(type, freq, Q)              // 'lowpass' 'highpass' 'bandpass' 'notch'
audio.autoFilter(rate) / audio.vibrato(freq, depth) / audio.tremolo(freq, depth)
audio.pitchShift(semitones) / audio.compressor(threshold, ratio) / audio.eq(low, mid, high)
```

### Patterns — Strudel (ADR 035)

Real [Strudel](https://strudel.cc) engine (`@strudel/*`). Invoked by **explicit calls** — no
global transpiler, so bare strudel.cc string-method sugar (`"c e g".fast(2)`) is not available;
write the function form. `.play()` starts a pattern on the shared scheduler; `hush()` stops all.

```js
note("c e g b")            // pitches on the default synth — NO samples needed (front door)
n("0 2 4").scale("C:minor")// scale degrees → notes (@strudel/tonal)
s("bd hh sd hh")           // named samples — silent until you load a pack (see below)
sound("...")               // alias of s()
stack(patA, patB, ...)     // layer patterns in parallel (how you run >1 line; last .play() wins)
seq(a, b) / cat(a, b)      // sequence / alternate-per-cycle
silence                    // the empty pattern

// Mini-notation (inside note()/s()/n()): the string parses as a sequence —
//   space=sequence  [a b]=subgroup  <a b>=alternate  a*N=repeat  a!N=replicate
//   a@N=weight  a?=degrade  a,b=parallel  {a b}%N=polymeter  0..7=range  ~=rest

// Chainable transforms (return a new Pattern):
.fast(n) / .slow(n)            .rev()              .add(note("7"))  // transpose
.gain("0.4 0.8")  .pan("0 1")  .lpf(...) .room(...) // effects take patterns too
.every(n, fn)     .sometimes(fn) / .often / .rarely / .someCyclesBy
.jux(fn)          .off(t, fn)    .euclid(pulses, steps)   .degradeBy(p)
.scale("C:minor")  // @strudel/tonal
.play() / .stop()

setcps(n)   // cycles/sec — also sets Tone.Transport.bpm = n*60 (shared tempo, Tone is master)
hush()      // stop the Strudel scheduler (a code reset also hushes)

// Samples are BRING-YOUR-OWN — createos bundles no kit:
samples('github:tidalcycles/dirt-samples');  // (or any sample-map URL) THEN s("bd sd hh")

// In the Mixer, all Strudel sound is carried by a single "Strudel" strip:
//   mixer.strip('Strudel').volume(-6).pan(-0.3)
```

### Scales & analysis

```js
audio.scale('C4', 'minor')              // → note array. scales: major minor dorian phrygian lydian mixolydian locrian pentatonic blues chromatic
audio.note(scaleArr, degree)            // pick by degree (wraps)
audio.freq('C4')                        // → Hz
audio.bpm(120) / audio.volume(db) / audio.start() / audio.stop() / audio.now()

const meter = audio.meter()             // s.chain(meter) → meter.getValue() returns dB
const fft = audio.analyser(32)          // s.chain(fft) → fft.getValue() returns Float32Array
const lfo = audio.lfo(freq, min, max)   // lfo.connect(s._.frequency)
```

### Audio files

```js
const f = await audio.load(url)         // → AudioFile; await f.ready
const f = await audio.upload()          // file picker → AudioFile
f.play(offset?) / f.pause() / f.stop() / f.seek(t) / f.loop(bool) / f.volume(db)
f.currentTime / f.duration / f.state   // live getters
f.filter(type,freq,Q).reverb(decay).eq(lo,mid,hi).delay(t,fb).pitchShift(semi).distort(amt)
f.onTime(t, fn)                         // callback at playback position t (seconds)
f.waveform({ width, height, color, bg }) // → HTMLCanvasElement with live playhead
f.signal(bins)                          // → live FFT signal { bass, mid, high, stream(fn) }
```

### Master FFT — `audio.fft`

```js
audio.fft.bass / audio.fft.mid / audio.fft.high  // energy bands 0–1
audio.fft.value                                   // dominant bin
audio.fft.fft                                     // Float32Array raw bins
audio.fft.stream(fn)                              // RAF push
```

### Visualizers

```js
const sg   = audio.spectrogram(source, { palette, width, height })  // → { canvas }
const roll = audio.pianoRoll({ z, opacity, speed, midiMin, midiMax })
mixer.show()                           // live mixer console (ADR 032)
  // mixer.strip('lead').volume(-6).pan(-0.3).mute().solo().eq([{freq,gain,q}])
  // mixer.master.volume(-2); mixer.add(node, { name })
const dp   = audio.drumpad({ title, x, y, w, h })  // 8-pad drum machine + 16-step sequencer
  // dp.bpm(128)                         // set tempo
  // dp.pattern(voiceIdx, 'x . x .')     // fill a voice row from mini-notation
  // dp.step(voiceIdx, stepIdx, bool)    // toggle individual step
  // Keyboard shortcuts: q w e r (top row) / a s d f (bottom row)
  // Toolbar: 🥁 New Drum Pad button; also audio.drumpad() or new Drumpad(opts)

  // ── Bindings (ADR 046): give a pad your own Voice or an Action ──
  dp.bind('kick', 'Wub')                 // replace a pad's default synth with a Voice (name or inline desc)
  dp.bind(0, { engine: 'fm' })           // pad = index 0-7 or name; voice embedded inline (travels in project)
  dp.unbind('kick')                      // revert the pad to its default drum synth
  dp.bindAction('clap', 'drop')          // fire bus event 'drop' on strike → react with on('drop').do(fn)
  dp.bindAction(2, 'cue', { silent: true }) // controller-only pad: fires the event, makes no sound

  // ── Groovebox (P3): swing, per-step velocity, configurable size ──
  audio.drumpad({ steps: 32, pads: 4, swing: 0.4 }) // {steps} default 16 · {pads} 1-8 · {swing} 0-1
  dp.swing(0.4)                          // global swing (0-1)
  dp.step(0, 4, true, 0.33)              // toggle step with velocity (0-1)
  dp.accent(0, 8, 0.66)                  // set a step's accent without toggling
  // UI: shift-click a step to cycle its accent. Per-step velocity drives loudness + onHit payload.

  // ── Event / signal API (per-instance; hooks cleared on reset, windows survive) ──
  dp.onHit(fn)            // fn({vi,id,label,source,step}) — any pad
  dp.onPad('kick', fn)    // fn({vi,id,label,source,step}) — scoped to one pad (index 0-7 or name)
  dp.onStep(fn)           // fn({step,activeVoices:[vi…]}) — once per sequencer step while playing
  // source: 'pad' | 'key' | 'seq' | 'midi'    // event payload also carries velocity (0–1)
  // MIDI (ADR 033): no code needed. Focus a Drum Pad → it becomes the MIDI Target
  //   (sticky; survives editing). General MIDI drum map (36→kick, 38→snare, 42→hh…).
  //   Click the 🎹 chip once to grant access (non-MIDI users are never prompted).

  const sig = dp.signal('kick', { decay: 250 })  // decaying-pulse signal scoped to a pad
  const sig = dp.signal()                          // whole-kit signal (any pad)
  sig.value                // 0–1; 1.0 on hit, decays to 0 over decay ms (lazy, no timer)
  sig.velocity             // alias for sig.value
  sig.stream(fn)           // push value to fn on every animation frame
  sig.onHit(fn)            // register a hit callback on this signal's pad scope
```

### Launchpad — `audio.launchpad` (ADR 047)

A configurable live soundboard grid. Each cell is a Trigger you map to a **Voice** and/or
an **Action** via the shared binding layer (ADR 046). No step sequencer (that's the Drum
Pad) — live play is captured into a **Take**. Toolbar: ▦ New Launchpad button.

```js
const lp = audio.launchpad({ title, rows: 8, cols: 8, baseNote: 36, voice })
  // Unbound cells play a default Voice at a per-cell pitch (baseNote + cellIndex)
  lp.voice({ engine: 'am' })             // set the default voice for unbound cells

  // ── Bindings — cell = index or 'r,c' ──
  lp.bind(0, 'Bass')                     // a saved Voice on cell 0
  lp.bind('2,3', { engine: 'fm' })       // inline voice at row 2, col 3
  lp.bind(5, { kind: 'sample', mode: 'chopped', url: 'break.wav', slices: 16 })
                                         //   chopped sample → cell plays its matching slice
  lp.unbind(0)
  lp.bindAction('7,7', 'drop')           // fire bus event 'drop' on strike → on('drop').do(fn)
  lp.bindAction(1, 'cue', { silent: true }) // controller-only cell: event, no sound

  // ── Events / signals ──
  lp.onHit(fn)            // fn({cell,row,col,source,velocity}) — any cell
  lp.onCell('2,3', fn)    // scoped to one cell (index or 'r,c')
  lp.signal(cell?, { decay }) // decaying-pulse 0–1 (omit cell for whole grid)
  // source: 'pad' | 'midi' | 'replay'
  // MIDI (ADR 033): focus a Launchpad → MIDI Target; note maps noteNum − baseNote → cell.
```

### Piano per-key overrides (ADR 046)

```js
const p = audio.piano()
p.voice({ engine: 'mono' })            // whole-keyboard custom Voice (live play only)
p.bind('C4', { kind: 'sample', mode: 'chromatic', url: 'vox.wav', baseNote: 'C4' })
p.bindAction('C2', 'drop', { silent: true }) // a key fires a bus event, no note
p.unbind('C4')
// The step sequencer keeps using the selected preset; overrides affect live play.
```

### Microphone

```js
const mic = await audio.mic()           // prompts permission; connect to fx or meter
audio.level                             // live 0–1 RMS (mic toolbar toggle must be on)
audio.onLevel(threshold, onEnter, onExit?)   // edge-trigger
audio.onWord(word, fn)        // fires when that specific word spoken (final only)
audio.onSpeech(fn)            // fires with full transcript on every utterance (final only)
audio.onWordStream(fn)        // fn({ word, final, index }) — every word as it streams
                              // interim: final=false  committed: final=true  index=running position
audio.speechEngine = 'auto'   // 'auto' (Web Speech, else ML) | 'ml' (in-browser model, any browser) | 'webspeech'
audio.say(text, opts?)                       // speechSynthesis; opts: voice,rate,pitch,volume,lang
audio.voices()                               // → SpeechSynthesisVoice[]
```

---

## Route — `route`

Cross-domain signal chain. Typed signal from a source, through composable transforms, to one or more sinks — as explicit data, not implicit code. Run-scoped (cleared on reset). Self-registers `liveOutput` keep-alive while a driver is active.

> **Full inputs/transforms/outputs map:** [`docs/signal-map.md`](docs/signal-map.md) — every source, transform, sink, and bridge for `route()` + `pipe()`, keyed by signal kind.

```js
// Mic amplitude → oscillator frequency (sub-ms push path)
const osc = audio.synth();
route(Source.mic).amplitude.scale(0, 1, 200, 800).to(osc.frequency)

// MIDI CC → shader uniform (push, stateless chain)
route('midi:cc').filter(e => e.cc === 74).norm(0, 127).to(myShader, 'uCustom.x')

// Camera brightness → shader uniform (RAF pull, bridge retyping)
route(Source.camera).brightness().scale(0, 1, 0, 10).to(myShader, 'uCustom')

// Berlin Horse optical printing timeline
route(Source.camera)
  .tint('#4a0').wait(3)
  .negative().wait(2)
  .clearEffects().solarize(0.6).wait(2)
  .loop().show()

// VJ mutation on beat
const r = route(Source.camera).show()
r.on('beat:bar', r => r.toggle('negative'))

// Karaoke word rain — camera stream + speech event side-effect in one expression
route(Source.camera)
  .tap('audio:word:final', ({ word }, winId) =>
    wm.addText(winId, word, Math.random() * 700, Math.random() * 450, { decay: 4000 })
  )
  .show('Karaoke', { w: 800, h: 450 })

// Fan-in: average mic + camera motion
route(Source.mic).amplitude
  .mix(route(Source.camera).motion())
  .smooth(0.8).to(osc.frequency)
```

### Sources

| Source | Type | Description |
|---|---|---|
| `'event:name'` | discrete | Any bus event; value passed as-is |
| `Source.mic` | continuous | Mic amplitude sampler (requires bridge) |
| `Source.camera` | frame | Camera feed (delegates to `pipe()` internally) |
| `() => value` | continuous | Fn called each RAF tick |
| `video.signal(...)` | continuous | VideoSignal object (duck-typed) |
| Canvas / video element | frame | DOM element |

### Bridges (mandatory retyping for audio/frame → scalar)

Must be the first method after `route(Source.mic)` or `route(Source.camera)`. Throws if applied to a discrete source.

| Bridge | Input | Output |
|---|---|---|
| `.amplitude` | mic/audio | 0–1 scalar |
| `.brightness()` | camera/video | 0–1 scalar |
| `.motion()` | camera/video | 0–1 scalar |
| `.fft()` | audio | Float32Array |

### Scalar transforms

Stateless (allow sub-ms push path on discrete sources): `scale(inMin, inMax, outMin, outMax)`, `norm(min, max)`, `clamp(min, max)`, `invert()`, `threshold(t)`, `gate(min, max)`, `get(prop)`, `filter(pred)`.

Stateful (force RAF driver): `smooth(factor)`, `debounce(ms)`.

### Frame transforms (canvas-route only)

All usable directly in `pipe()` too.

`tint(color)`, `negative()`, `blur(r)`, `hue(deg)`, `solarize(threshold)`, `posterize(levels)`, `duotone(darkColor, lightColor)`, `grain(amount)`, `strobe(fps)`.

### Sinks — `.to(sink, ...)`

| Sink | Behavior |
|---|---|
| `fn` | Called with value |
| `'event:name'` | `notify(event, value)` |
| `toneSignal` / `AudioParam` | `.value = v` (direct); `{ramp:ms}` opt-in |
| `shader, 'uCustom.x'` | Read-modify-write swizzle |
| `shader, 'uCustom'` | `shader.setUniform('uCustom', v)` |

### Temporal control (frame routes)

```js
r.wait(sec)        // commit current effects; advance timeline by sec
r.clearEffects()   // remove all named stages (scene boundary)
r.loop()           // restart timeline on completion
```

### Live mutation

```js
r.toggle('negative')    // add if absent, remove if present
r.remove('negative')    // remove named stage
r.clear()               // remove all named stages
```

### Fan-in

```js
route(src1).amplitude
  .mix(route(src2).motion(), (a, b) => a * 0.7 + b * 0.3)
  .to(osc.frequency)
```

### Route-scoped events

```js
r.on('beat:bar', (route, payload) => route.toggle('negative'))
// auto-cleaned when route is destroyed on reset
```

### Tap — event side-effects on frame routes

`.tap(event, fn)` — frame routes only (throws on discrete/continuous). Binds a bus event listener whose `fn` receives `(payload, winId)` where `winId` is the window spawned by `.show()`. Lifecycle-bound: subscriptions die when the route is destroyed (window close, reset, `.stop()`). Chainable; multiple `.tap()` calls accumulate.

```js
route(Source.camera)
  .tap('audio:word:interim', ({ word }, winId) =>
    wm.addText(winId, word, x, y, { decay: 2000 })
  )
  .tap('beat:bar', (_, winId) => wm.flash(winId))
  .show('Live', { w: 800, h: 450 })
```

`wm.addText(winId, ...)` auto-grafts a TextLayer onto any route/pipe-spawned window — no special window type needed.

---

## Render Pipeline — `pipe`

Fluent visual pipeline. Each stage exposes a canvas the next stage samples — one shared raf loop, auto-cleanup on reset. No manual `captureWindow`, `wm.spawn`, or `setInterval` needed.

```js
// Source types pipe() accepts:
//   CameraStream  (from Camera.open())
//   HTMLCanvasElement  (a Canvas .el, etc.)
//   HTMLVideoElement
//   GLShader / Shader instance  (.canvas property)
//   Layer  (._canvas property)

const cam = await Camera.open();

pipe(cam)
  .ascii({ cols: 150, color: '#00ff41', bg: '#0d0208' })  // ASCII art stage
  .glshader(`                                               // GLSL post-process
    vec4 a = texture2D(uVideo, uv);
    float l = dot(a.rgb, vec3(.299,.587,.114));
    vec3 rain = .5+.5*cos(6.28*(uv.y+time*.4+vec3(0,.33,.67)));
    gl_FragColor = vec4(rain*l, 1.);
  `)
  .show('ASCII Cam', { w: 700, h: 500 });  // spawns wm window
```

### Stage methods (chainable, return `this`)

```js
.ascii({ cols, rows, charset, bg, color, cellW, cellH })
  // Render glyphs to canvas. Default charset: ' .:-=+*#%@'.
  // Luma weights match canvas.toASCII (0.299/0.587/0.114).

.pixelate({ blockSize })
  // Mosaic effect — downscale then upscale without smoothing.

.fx(cssFilterString)
  // CSS filter on upstream: 'blur(4px)', 'hue-rotate(90deg) saturate(2)', 'invert(1)', etc.

.glshader(fragBody, { z, opacity })
  // WebGL/GLSL stage. uVideo samples upstream canvas. Same syntax as new GLShader(body).

.shader(fragBody, { z, opacity })
  // WebGPU/WGSL stage. Same syntax as new Shader(body).

.subtitle(srtText, {
    fontSize, color, bg, font, weight,
    stroke, strokeColor, strokeWidth, marginBottom
  })
  // SRT subtitle overlay. Parses the SRT string and draws the active cue on each frame,
  // synced to source.currentTime. Use with a video source.
  // srtText format: "1\n00:00:00,000 --> 00:00:02,500\nHello world\n\n2\n..."

.use(factory)
  // Custom stage escape hatch. factory(srcDrawable) called once at start; returns
  // { canvas: HTMLCanvasElement, read() }. read() called every raf tick.
  // srcDrawable is the upstream HTMLCanvasElement or HTMLVideoElement.
  // Use to write any arbitrary canvas transform without subclassing.
  // Example:
  //   .use(src => {
  //     const canvas = document.createElement('canvas');
  //     canvas.width = 800; canvas.height = 600;
  //     const ctx = canvas.getContext('2d');
  //     return { canvas, read() { ctx.drawImage(src, 0, 0); /* custom processing */ } };
  //   })
```

### Registering named stages — `pipe.register(name, factory, descriptor)`

Package a custom stage factory as a reusable named method. After registration:
- `pipe(src).yourStageName(opts)` works in any pipeline
- Appears in the text-toolkit sidebar (draggable snippet)
- Generates a Blockly block from `descriptor.fields` (usable in blocks mode)

```js
pipe.register('glowAscii', (src, opts = {}) => {
  const canvas = document.createElement('canvas');
  canvas.width = 800; canvas.height = 600;
  const ctx = canvas.getContext('2d');
  // setup using opts.cols, opts.color, etc.
  return {
    canvas,
    read() {
      // called every frame — draw to canvas using src (canvas or video) as input
      ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
    },
  };
}, {
  label:  'Glow ASCII',            // toolkit + block display name
  hint:   'ASCII art with glow',   // tooltip in sidebar
  colour: 80,                      // Blockly block hue (0–360)
  fields: [
    { name: 'cols',  label: 'cols',  type: 'number', default: 120 },
    { name: 'color', label: 'color', type: 'color',  default: '#00ff41' },
  ],
  // code: '...'  // optional custom snippet; auto-generated from fields if omitted
});

// Use anywhere:
pipe(cam).glowAscii({ cols: 120, color: '#00ff41' }).show('Glow', { w: 700, h: 500 });
// Chains with built-ins:
pipe(cam).ascii({ cols: 60 }).glowAscii({ cols: 60 }).fx('blur(2px)').show('out');
```

**field `type` values:** `'number'` (numeric, Blockly number field), `'color'` (colour picker), `'text'` (text input), `'boolean'` (checkbox).

### Sink methods (start the loop)

```js
.show(title, { w, h, noChrome, transparent })
  // Spawn a wm window and render the pipeline inside it.
  // Closing the window auto-stops the pipeline.

.layer(z)
  // Render pipeline output onto canvas layer at z-index z.

.to(el)
  // Mount into any DOM element (selector string or HTMLElement).

.start()
  // Start headless — access output via .canvas.

.stop()   // halt raf loop; cleanup happens automatically on reset
.canvas   // the final output canvas (available after start())
```

---

## User Library — `library`

Persistent cross-project store for named shader bodies and code snippets. Survives project switches and page reloads. Stored in `localStorage['vl_library']` — separate from `.vljson` project files by design.

```js
// Save to library — available in every project from now on
library.glsl('rainbow', `
  vec4 a = texture2D(uVideo, uv);
  float l = dot(a.rgb, vec3(.299,.587,.114));
  vec3 c = .5+.5*cos(6.28*(uv.y+time*.4+vec3(0,.33,.67)));
  gl_FragColor = vec4(c*l, 1.);
`);

library.wgsl('plasma', ({ uv, time }) => {
  let c = vec2f(uv.x * 3.0, uv.y * 3.0 + time);
  return vec4f(sin(c.x), sin(c.y), sin(c.x + c.y), 1.0);
});

library.snippet('camSetup', `
const cam = await Camera.open();
pipe(cam)
  .ascii({ cols: 120, color: '#00ff41', bg: '#0d0208' })
  .show('ASCII Cam', { w: 700, h: 500 });
`);

// Use by name — GLShader and Shader constructors auto-resolve
new GLShader('rainbow').start();
pipe(cam).glshader('rainbow').show('out');
new Shader('plasma').start();

// Static convenience aliases (equivalent to library.glsl / library.wgsl)
GLShader.define('rainbow', glslBody);
Shader.define('plasma', wgslBody);
```

### Methods

```js
library.glsl(name, body)       // save GLSL body; returns library (chainable)
library.wgsl(name, body)       // save WGSL body or JS arrow fn
library.snippet(name, code)    // save arbitrary code snippet
library.list()                 // → [{type:'glsl'|'wgsl'|'snippet', name, preview}]
library.remove(type, name)     // delete one entry
library.clear()                // delete all user entries
library.export()               // → JSON string (portable between devices)
library.import(jsonOrObj)      // merge from JSON string or parsed object
```

After saving, entries appear as draggable buttons in the **My Library** toolkit category. Snippets produce the full code when dragged; shader entries produce a usage snippet by name.

---

## Camera — `Camera`

Multi-camera streaming. Toolbar camera: enable via camera toggle button.

```js
const cam = await Camera.open({ index: 0 })  // or { deviceId }
// cam.element → <video> with live stream
cam.flip(true)   // mirror horizontally; cam.flip(false) to undo
cam.stop()       // release stream

const list = await Camera.list()  // → [{index, deviceId, label}, ...]
```

Toolbar mirror button (↔): shown when camera is on. Mirrors the main canvas drawImage. Tracks `window.__ar_camera_mirrored`.

---

## Capture & Record

Take photos/videos from the webcam or record any output window. Captures land as persistent desktop icons (IndexedDB-backed) and can also download directly.

```js
// Webcam photo
const cam = await Camera.open();
await cam.photo({ name: 'selfie', download: true });  // → .jpg on desktop + download

// Webcam video
const rec = cam.record({ name: 'clip', fps: 30 });
rec.stop();  // → .webm on desktop

// Record any output window
const r = wm.record('win-canvas-1', { fps: 30 });
wm.stopRecording('win-canvas-1');  // → .webm on desktop

// Snapshot any output window
wm.snapshot('win-canvas-1');
wm.snapshot('win-canvas-1', { name: 'hero.png', download: true });
```

Titlebar 📷 (snapshot) and 🔴/⏹ (record) buttons appear automatically on canvas/shader/camera/video/image windows.

| Method | Returns | Description |
|--------|---------|-------------|
| `cam.photo({ name?, download? })` | `Promise<Blob>` | Still from webcam → desktop .jpg |
| `cam.record({ name?, fps? })` | `Recording` | Webcam video → desktop .webm on `.stop()` |
| `wm.snapshot(winId, { name?, download? })` | — | Composite all layers → desktop .png |
| `wm.record(winId, { fps?, name? })` | `Recording` | Record any visual window → desktop .webm |
| `wm.stopRecording(winId)` | — | Stop in-progress recording |
| `rec.stop()` | — | Stop a `Recording` |
| `desktop.addBlob(blob, { name, type, download? })` | `{id,name,type,url}` | Add any blob as persistent desktop icon |

Multi-layer output windows (draw + pixi + shader) are automatically composited into a single WebM. Captures survive page reload. Capture icons are excluded from `.vljson` project exports (IDB blobs don't travel).

---

## Performance capture & replay — `timeline`, `.replay()`

Record what you *do* on a widget over time, then replay it as code. This is **not** video (`Recording`) and **not** a state snapshot (the `</>` / Code button) — it captures timestamped **actions** (a piano note at t=300ms, a brush stroke at t=1100ms) and emits code that replays them on the harness clock. See ADR 031.

Every interactive widget (Drumpad, Piano, SpriteEditor, AsciiEditor, Notepad, Paint) has a **Capture ●** button:

1. Click **● Rec** → start a **Take**. Use the widget normally.
2. Click **■ Stop** → the captured performance is inserted into the active editor as runnable code.

A solo capture emits `<ctor>; <var>.replay([...])`. The desktop **Global Capture ●** (top toolbar) arms every open widget on one shared clock and emits a single `timeline()` composing one track per widget.

**MIDI input (ADR 033):** Piano and Drum Pad receive Web MIDI with no code. Focusing one makes it the **MIDI Target** (sticky — keeps MIDI while you edit code; switches only when you focus another instrument). Piano maps note numbers → notes with true note-on/off sustain (and, when a sequencer step is selected, MIDI programs that step); Drum Pad uses the General MIDI drum map (one-shot). Velocity drives loudness and appears in `onNote`/`onHit` payloads, and MIDI playing is captured into a Take like mouse/keyboard. Access is permission-aware: the 🎹 chip lights on the current target; users with no controller are never prompted — click the dormant chip once to opt in.

```js
// Solo — replay a recorded take
const p = new Piano({ preset: 'epiano' });
p.replay([
  { t: 0,   note: 'C4', dur: 200 },
  { t: 300, note: 'E4', dur: 200 },
  { t: 600, note: 'G4', dur: 400 },
], { loop: false });

// Multi-widget — compose & splice takes at offsets (wall-clock ms)
timeline()
  .track(p,  pianoTake, { at: 0 })
  .track(p,  fillTake,  { at: 4000 })   // same widget, spliced later
  .track(dp, drumTake,  { at: 0 })
  .play({ loop: true });
```

| Method | Returns | Notes |
| --- | --- | --- |
| `widget.replay(actions, { loop? })` | replay handle (`.stop()`) | Single-track replay bound to the widget |
| `timeline()` | `Timeline` | Multi-track scheduler |
| `tl.track(widget, actions, { at? })` | `tl` | Place a take at offset `at` ms (default 0) |
| `tl.play({ loop? })` | `tl` | Start all tracks on one clock |
| `tl.stop()` | `tl` | Stop the timeline |

Per-widget action verbs used by replay (also callable directly): `dp.hit(voice)`, `p.strike(note, durMs, vel?)`, `sp.pixel(x,y,color)`, `ed.cell(c,r,ch,fg,bg)`, `pt.stroke(pts, {tool,color,size})`, `np.insert(text)`. Action schemas: Drumpad `{t,vi,vel}` · Piano `{t,note,dur,vel}` · Sprite `{t,op:'pixel'|'frame',…}` · Ascii `{t,op:'cell'|'frame',…}` · Notepad `{t,ch}` (`'\b'`=backspace) · Paint `{t,op:'stroke',tool,color,size,pts:[{x,y,dt}]}`. All times are wall-clock ms from take start. Replays are run-scoped (stop on reset) and keep the run alive while playing; performances are never saved to `.vljson` — the emitted code is their persistence.

---

## Vision — `vision`

MediaPipe. Camera must be enabled in toolbar. Results at ~10fps.

```js
// Data
vision.objects()              // → [{label, confidence, cx, cy, bbox:{x,y,width,height}}, ...]  (COCO classes)
vision.nearest(label?)        // → {label, confidence, cx, cy, bbox} | null
vision.any(label) / vision.count(label)

vision.hands()                // → [{gesture, confidence, handedness, cx, cy, landmarks}, ...]  (handedness: 'Left'|'Right'|null)
vision.gesture()              // → 'Thumb_Up'|'Open_Palm'|'Closed_Fist'|'Pointing_Up'|'Victory'|'ILoveYou'|null

vision.face()                 // → {expression, cx, cy, landmarks} | null
vision.expression()           // → 'smile'|'surprise'|'frown'|'mouth_open'|'neutral'|null

vision.pose()                 // → {landmarks: [{x,y,z,visibility}×33]} | null  (lazy-loads PoseLandmarker)

// Gaze — where the user is looking (ADR 034)
vision.gaze()                 // → {x, y, dir, blink, leftClosed, rightClosed, vx, vy} | null
vision.gazeIn(el)             // → {x, y} local to el (viewport gaze point − el rect) | null  (needs calibration)
vision.calibrated             // → boolean — are vx/vy live?
await vision.calibrate({ points: 9 })   // interactive dot-follow pass; resolves true on success
vision.onGaze('left'|'right'|'up'|'down'|'center', fn)   // direction zone — no calibration
vision.onGaze(el | {x,y,w,h}, (inside) => {})            // region enter/leave — needs calibration
vision.onBlink(fn)            // both eyes — no calibration
vision.onWink('left'|'right', fn)   // one eye — no calibration

vision.onGesture(name, fn)    // edge-triggered (fires once per appearance)
vision.onExpression(name, fn)

// Draw overlays (pass ctx or omit to use turtle canvas; auto-mirrors if camera is flipped)
vision.drawBoxes(ctx?, { color, font, lineWidth, mirror } = {})
vision.drawFace(ctx?,  { color, pointSize, mirror } = {})
vision.drawHands(ctx?, { color, lineWidth, pointSize, mirror } = {})
vision.drawPose(ctx?,  { color, lineWidth, pointSize, minVisibility, mirror } = {})

// Config. pose is first-run-wins (call before first pose use; page refresh to change).
// hands.numHands applies live (any time) — pushed to the recognizer via setOptions.
vision.configure({ pose:  { model: 'lite'|'full'|'heavy', numPoses: 1 } })
vision.configure({ hands: { numHands: 2 } })   // default 1 — track both hands

// Custom source — use any HTMLVideoElement or HTMLCanvasElement instead of the webcam
vision.source(videoEl)   // e.g. from video.open() or a <video> element
vision.source(canvasEl)  // e.g. from a Canvas .el or a pipe output canvas
vision.source(null)      // revert to webcam
```

`cx`/`cy`: canvas-centered turtle coords. cx ∈ [-800,800], cy ∈ [-450,450] (positive=up).  
`bbox`: normalized [0,1] relative to video frame — same space as landmark `x`/`y`.  
`mirror`: `'auto'` (default) mirrors when camera is flipped; `false` always uses raw coords.

**Gaze** has two tiers on one object. `x`/`y` (head-relative direction, −1..1), `dir`, `blink`, and wink work with **no calibration**. `vx`/`vy` (browser **viewport pixels**) are `null` until calibration — a browser can't know the camera↔screen geometry, so `vision.calibrate()` (or the 🎯 gaze chip) fits the mapping. Calibration is bound to one person + camera + screen resolution, persisted in `localStorage['vl_gaze_calib']`, and **not** saved into projects. Gaze is a continuous signal: route it with `route(Source.gaze.x)` / `.y` (direction) or `.vx` / `.vy` (screen px) — the `gaze:*` bus events are `gaze:move` (continuous), `gaze:look`, `gaze:blink`, `gaze:wink`, `gaze:enter`/`gaze:leave`.

Pose landmark indices follow [MediaPipe Pose topology](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker) (0=nose … 32=right_foot_index).

---

## Language — `lang`

Text language tools. Profanity + sentiment are **synchronous, offline, instant** (no download); `classify()` is an optional lazy-loaded ML model for advanced tasks.

```js
// Profanity — obscenity matcher (obfuscation-resistant: fu*k, sh1t, fuuuck, case)
lang.isProfane(text)          // → boolean
lang.profanity(text)          // → [{ term, start, end }]  (empty if clean)
lang.censor(text, mask?)      // → masked string. mask omitted → grawlix (#$%@); pass a char to fill
lang.block(...words)          // add custom profane term(s); chainable
lang.allow(...words)          // whitelist word(s) so they never flag (false-positive guard); chainable

// Sentiment — AFINN lexicon, instant
lang.sentiment(text)          // → { score, comparative, label, positive, negative }
                              //   label: 'positive' | 'negative' | 'neutral' (by comparative ±0.05)

// Advanced ML classification — MediaPipe TextClassifier (lazy WASM, async)
await lang.classify(text)     // → [{ category, score }]  (default model = BERT sentiment)
lang.configure({ model })     // swap the .tflite classifier URL; reloads on next classify()
```

`isProfane`/`profanity`/`censor`/`sentiment` run instantly with no network. `classify()` downloads a MediaPipe model on first call (like `vision.*`) and stays warm after — `await` it and expect a first-call delay. Custom terms, whitelist, and the loaded model persist across resets (config, not run artifacts).

```js
// Say a bad word → react (STT + lang, no bad-word list)
route(Source.mic).tap('audio:word:final', ({ word }) => {
  if (lang.isProfane(word)) emit('boom');
});

// Live mood readout from a notepad
on('note:change', ({ text }) => {
  const { label, score } = lang.sentiment(text);
  console.log(label, score);
});
```

---

## Video Signals — `video`

Sample pixel regions from canvas or camera as live numeric signals.

```js
const sig = video.signal(source, {x:0.5, y:0.5, radius:0.05, fps:30})
// source: 'camera' | HTMLCanvasElement | HTMLVideoElement
// sig.brightness/r/g/b (0–1), sig.hue (0–360), sig.motion (0–1)
sig.stream(fn)     // RAF push

video.onMotion(sourceOrSig, threshold, onEnter, onExit?)
video.onBrightness(sourceOrSig, threshold, onEnter, onExit?)
```

---

## Sensors & Device Input

Device sensors are bus events (ADR 014). Subscribe with `on()` or poll with `hold()`. All sources are **lazy** — start on first subscriber, stop on last.

```js
// Keyboard & mouse — see also on('window:key:*') / on('window:mouse:*') in Events section
on('window:key:down').when({ w: () => y -= 5, s: () => y += 5 });   // dispatch by key
const keys = hold('window:key:down');   // live Set of held key names
const mouse = hold('window:mouse:move'); // live { x, y, winId }

// Device sensors
on('sensor:gamepad').do(({ index, axes, pressed }) => { … });
// { index, axes[], buttons[], pressed[] }

on('sensor:motion').do(({ ax, ay, az, alpha, beta, gamma, magnitude }) => { … });
on('sensor:shake').when(d => d.magnitude > 20).do(() => { … });

on('sensor:geo').do(({ lat, lon, accuracy, speed, heading }) => { … });
on('sensor:battery').do(({ level, charging }) => { … });
on('sensor:network').do(({ online, type, downlink, rtt }) => { … });

// Haptics — commandable events
emit('haptics:vibrate', { pattern: 200 });   // 200ms; or array [on,off,on,…]
emit('haptics:tap', {});                     // 40ms
emit('haptics:buzz', { ms: 500 });
emit('haptics:stop', {});
```

---

## WebSerial & GPIO

Talk to Arduino/ESP32/Pico/Teensy via USB. Chrome/Edge only. All events appear in the Event Stream Panel. See [docs/serial.md](docs/serial.md).

`serial:connect` **requires a user gesture** — wire to a button click:

```js
const win = wm.spawn('Serial', {
  html: '<button id="b" style="margin:16px;font-size:18px">Connect USB</button>',
});
document.getElementById(win)?.querySelector('#b')?.addEventListener('click', () => {
  emit('serial:connect', { baudRate: 115200 });
});

on('serial:status').do(({ connected }) => console.log(connected ? 'connected' : 'disconnected'));

// Read — always fires raw line
on('sensor:serial:data').do(({ line }) => console.log(line));

// GPIO read — fires when default parse matches "PIN:VALUE\n"
on('gpio:pin').do(({ pin, value }) => {
  if (pin === 0) canvas.bg(`hsl(${value / 4}, 80%, 50%)`);
});

// GPIO write
emit('gpio:write', { pin: 13, value: 1 });   // HIGH
emit('gpio:write', { pin: 13, value: 0 });   // LOW

// Raw write
emit('serial:write', { data: 'RESET\n' });

// Custom protocol (parse + serialize must be symmetric)
emit('serial:connect', {
  baudRate: 115200,
  parse: line => { try { const {p,v} = JSON.parse(line); return {pin:p,value:v}; } catch { return null; } },
  serialize: ({pin,value}) => JSON.stringify({p:pin,v:value}) + '\n',
});

// Binary mode
emit('serial:connect', { baudRate: 115200, mode: 'binary' });
on('sensor:serial:data').do(({ bytes }) => { /* Uint8Array */ });

// Disconnect / status
emit('serial:disconnect', {});
hold('serial:status').connected  // true | false
```

Port **survives resets** — connect once, keep across code runs. `serial:disconnect` or page close to clean up.

---

## Windows — `wm`

```js
wm.show(id) / wm.hide(id) / wm.toggle(id) / wm.focus(id)
wm.maximize(id) / wm.restore(id) / wm.close(id)
wm.remove(id, opts?)   // permanently destroy a spawned window + remove from DOM (close(id) only hides)
                       // opts.animate:false → synchronous (no close transition). No-op if not a spawned window.
wm.move(id, x, y) / wm.resize(id, w, h)
wm.setZ(id, z)          // live CSS z-index update
wm.setOpacity(id, v)    // live CSS opacity (0–1)
wm.filter(id, cssStr)   // CSS filter on .wm-body: 'brightness(2) hue-rotate(30deg)'; '' to clear
wm.getByTitle(title)    // → window id or null (case-insensitive title match)
wm.layout('split')
wm.list()               // → all window ids

wm.spawn(title, opts)   // → id
// opts.type: 'html'|'image'|'video'|'camera'|'canvas'|'shader'|'viz'|'sensor'
// opts: x,y,w,h,id + type-specific: html,src,loop,controls,z,shader
// opts.noChrome: true → hide titlebar
// opts.transparent: true → semi-transparent background
// opts.z: number → initial CSS z-index
// opts.onClose: fn → called when window is closed (e.g. stopRunning)
// Video/camera windows: ♪ button folds out spectrum/waveform panel (source+style selectors)
//   Camera windows: source selector locked while panel is docked; pop-out button opens standalone viz
// Viz windows (type:'viz'): opts.source='master'|'mic'|'vid:<id>'|'ch:<id>', opts.style='wave'|'bars'|'ring'
//   Control bar has two color pickers: background color + waveform/ring color — persisted across reloads
// Image/video/html/sensor windows: ↔/↕ flip buttons flip only the visualization (not chrome)
// Sensor windows: opts.source = 'motion'|'gamepad'|'geo'|'battery' — live gauge/bar displays
//   Toolbar: gauge icon opens dropdown to spawn any sensor type
wm.spawn('Motion', { type: 'sensor', source: 'motion', w: 480, h: 200 })
wm.spawn('Gamepad', { type: 'sensor', source: 'gamepad', w: 380, h: 200 })

wm.addText(id, text, x, y, opts?)  // → handle | null
// opts: fontSize(24), fontFamily, color('#fff'), bold, italic, align, rotation(0),
//       kerning(0), curve(null|{type:'arc',radius}), opacity(1)
//       decay: ms — fade opacity 1→0 then auto-remove
//       animate: { duration(ms), easing?, onDone?, fontSize:[from,to], rotation:[from,to],
//                  kerning:[from,to], opacity:[from,to] }
// handle: { id, setText(s), setStyle(opts), moveTo(x,y), remove(), cancelAnimate(), on(ev,fn) }
// Auto-grafts TextLayer onto any window type (pipe/route-spawned windows included).
// Run-scoped — cleared on reset.

wm.bounds(id)   // → { w, h, left, top } | null
// Live inner size of a window's body, in canvas px. Re-read each call so it tracks resizes.
// Pair with wm.addText to keep spawned text on-screen after the window is resized, e.g.:
//   const b = wm.bounds(winId); wm.addText(winId, word, Math.random()*b.w, Math.random()*b.h)

wm.pickFile(key, pickerOpts?)   // async → blob URL (cached by key, re-prompts once)

wm.undo()         // undo last window layout change (position/size/visibility only — NOT widget content)
wm.redo()         // redo last undone window layout change
wm.pushHistory()  // manually snapshot current layout onto the undo stack

wm.addHistoryControls(winId, history)  // inject ↶/↷ titlebar buttons wired to a WidgetHistory instance
                                       // also sets win._widgetHistory for Cmd/Ctrl+Z keyboard routing
```

Built-in ids: `win-editor` `win-canvas` `win-console` `win-toolkit` `win-camera` `win-mic`

### Embed / share

App toolbar ⇒ **⇒ share** button serializes the full desktop (all editors + layout) and copies:
```
https://your-host/?embed=1&project=<base64>
```
Loading this URL runs the art fullscreen — editor chrome hidden, canvas fills viewport, user-spawned windows at saved positions. Single-editor variant: `?embed=1&code=<base64>`.

### Demo Gallery

Toolbar ⇒ **🎬 gallery** button opens a modal listing curated built-in demos. Each "Load Demo" button fetches the project from `public/demos/` and runs `applyProject()` — restores editor code, window layout, and starts execution. Add new demos by placing `.vljson` files in `public/demos/` and listing them in `public/demos/index.json`.

---

## Desktop — `desktop`

```js
desktop.add(url, opts?)   // → {id, name, type, url}
// opts: name, type, x, y
//   rotation: deg           — rotate icon
//   tint: deg               — hue-rotate thumbnail
//   scale: number           — scale icon
//   animate: 'spin'|'bounce'|'pulse'|CSS — animate icon
//   labelPosition: 'above'|'below'
//   labelColor: color string
desktop.remove(id) / desktop.clear()
desktop.files()                          // → [{id, name, type, url, x, y}, ...]
desktop.onFile(({id, name, type, url}) => {})   // fires on double-click
desktop.open(id)
// Drag icon over trash zone (shows at bottom center during drag) → releases/deletes icon
// Green badge appears on icon when its spawned window is open
```

---

## Art-widget events — `WidgetEvents` (shared helper)

All interactive art widgets (Drumpad, Paint, SpriteEditor, AsciiEditor) share a common **WidgetEvents** plumbing class (`src/api/widgets/widget-events.js`). It is used internally — you never construct it directly — but the contract it provides appears on every widget's public API:

```js
// Hook registration (returns widget instance for chaining)
widget.on('stroke', fn)   // low-level (prefer the typed aliases below)
widget.emit('stroke', {}) // internal; widgets call this at each choke-point

// Typed aliases (all return widget for chaining)
widget.onStroke(fn)    // fired at pointerup / fill commit
widget.onColor(fn)     // fired when active color / char changes
widget.onTool(fn)      // fired when tool selection changes
widget.onFrame(fn)     // fired on frame add/dup/clear/delete/move/select
// widget-specific: onPixel (SpriteEditor), onCell / onChar (AsciiEditor), onHit/onPad/onStep (Drumpad)

// Decaying-pulse signal
const sig = widget.signal(event?, { decay: 250, region: null, match: null })
//   event: 'stroke' | 'color' | 'tool' | 'frame' | '*' | widget-specific events
//   decay (ms): how long until value reaches 0 after the last triggering event
//   region {x,y,w,h}: spatial filter in widget-native coords (px for paint/sprite, cells for ascii)
//   match fn: arbitrary predicate filter on payload
sig.value      // 0–1 (lazy, no timer)
sig.velocity   // alias for value
sig.stream(fn) // push to fn each animation frame (RAF)
sig.on(fn)     // register a filtered callback on this signal's scope

// Lifecycle
//   All hooks auto-clear when the widget is destroyed (e.g. reset / window close)
//   cleanupPaints / cleanupSpriteEditors / cleanupAsciiEditors / cleanupDrumpads clear them too
```

---

## Events — `on`, `emit`, `any`, `tick`, `hold`

A global reactive event bus. Subscribe to system lifecycle events or user-defined events from
any subsystem. `on()`/`any()`/`tick()` subscriptions created during a code run are automatically
cleared on reset; system command handlers persist.

```js
// ── Subscribe ─────────────────────────────────────────────────────────────────
const stop = on('beat:tick').do(({ bpm, bar, beat }) => { ... });
stop(); // unsubscribe

// ── Modifiers (chain before .do()) ───────────────────────────────────────────
on('beat:tick').every(4).do(fn)              // every 4th occurrence
on('gesture:detected').within(500).do(fn)    // only if < 500ms since last
on('beat:tick').after('audio:start').do(fn)  // only after audio starts
on('beat:bar').when(d => d.bar % 2 === 0).do(fn) // predicate guard
on('window:key:down').when({ key: 'w' }).do(fn)   // object property filter
on('window:key:down').when({ w: fnW, s: fnS });    // dispatch by key name (primary field)
on('window:key:down').when('key', { w: fnW, s: fnS }); // explicit dispatch prop

// ── Interval timer ────────────────────────────────────────────────────────────
tick(16).do(() => { … });                    // ~60fps; all modifiers available
tick(500).every(4).do(fn);                   // every 2s (4 × 500ms)
tick(100).after('audio:start').do(fn);       // only after trigger

// ── Tween ─────────────────────────────────────────────────────────────────────
const cancel = tween(duration, fn(t), { easing?, onDone? })
// Calls fn(t) with t in [0,1] over duration ms, then calls onDone. Returns cancel fn.
// easing: optional function (t)=>t — default linear. Supply any curve:
//   t => 1-(1-t)**3        // ease-out cubic
//   t => t*t               // ease-in quadratic
tween(2000, t => canvas.bg(`hsl(0,100%,${t*50}%)`), { onDone: () => canvas.clear() });
tween(6000, t => handle.setStyle({ color: `hsla(40,100%,70%,${1-t})` }), { onDone: () => handle.remove() });

// ── Multiple events ───────────────────────────────────────────────────────────
any('beat:bar', 'gesture:detected').do(fn)  // fires on either event

// ── Held state ────────────────────────────────────────────────────────────────
on('window:key:down').hold()               // live Set of held primary values (keys)
on('window:mouse:move').hold()             // live object { x, y, winId }
hold('window:key:down')                    // memoized global — same Set, persistent
hold('sensor:motion').magnitude            // latest payload field, or undefined until first fire

// ── Emit ──────────────────────────────────────────────────────────────────────
emit('my-event', { value: 42 })           // user-defined event
emit('wm:spawn', { title: 'Pulse' })      // commandable: causes a spawn
emit('audio:start')                        // commandable: starts transport
emit('beat:tick', { bpm: 120, beat: 0 }) // fake event (no transport needed)
emit('haptics:vibrate', { pattern: 200 }) // commandable: actuates navigator.vibrate
```

### System event namespaces

| Namespace | Sample events |
|---|---|
| `beat:*` | `tick` `bar` `phrase` |
| `audio:*` | `start` `stop` `bpm-change` `level` `note-play` `speech` `say` |
| `audio:word:interim` | `{word, final:false, index}` — fires per-word while speaking |
| `audio:word:final` | `{word, final:true, index}` — fires per-word on commit |
| `audio:transcript` | `{text, isFinal}` — full running transcript |
| `wm:*` | `spawn` `close` `focus` `move` `resize` `maximize` `restore` `show` `hide` |
| `session:*` | `start` `stop` `reset` `error` |
| `editor:*` | `change` `save` |
| `gesture:*` | `detected` `smile` `expression` `face` `object` |
| `midi:*` | `open` `note:on` `note:off` `cc` `clock` |
| `camera:*` | `open` `close` `flip` `error` |
| `sensor:*` | `gamepad` `motion` `shake` `geo` `battery` `network` |
| `window:key:*` | `down` `up` |
| `window:mouse:*` | `down` `up` `click` `move` |
| `note:*` | `type` `char` `done` `change` `cursor` `select` |
| `haptics:*` | `vibrate` `tap` `buzz` `stop` (commandable) |
| `shader:*` | `compile` `start` `stop` `uniform` `error` |
| `pipe:*` | `create` `stage-added` `show` `destroy` |
| `desktop:*` | `file-added` `file-removed` `file-opened` `icon-clicked` |

Type inside `on('...')` in the editor for autocomplete — shows system catalog + any `emit()`
strings already in your document.

---

## Pixel Art — `Sprite`, `spriteEditor`

```js
// Programmatic sprite
const sp = new Sprite({ width: 16, height: 16, scale: 20, frames: 1 });
sp.pixel(x, y, '#ff0000')       // set one pixel
sp.fill(x, y, w, h, color)      // fill rect
sp.clear()                       // transparent
sp.frame(i)                      // switch active frame (0-indexed)
sp.addFrame()                    // append blank frame
sp.onionSkin(0.3)                // ghost prev frame at opacity; 0 = off
sp.play(fps)                     // start animation loop
sp.stop()
sp.show('My Sprite')             // open wm window + return handle

// Paint GUI — Aseprite-style editor window
spriteEditor({ width: 16, height: 16, scale: 20 })   // new blank sprite + editor
// or via Sprite instance:
sp.edit()                        // open editor on existing sprite
Sprite.edit({ width: 32, height: 32 })               // static: new sprite + editor

// Editor has: pencil · eraser · fill bucket · eyedropper · line · rect · rect-fill
// Palette: 12 swatches + custom color picker + transparent
// Frame strip: add (＋) · duplicate (⧉) · delete (🗑) · reorder (◀▶) · onion skin (🧅)
// Transport: ▶ play · ■ stop · fps input
// Export: ⤓ Code → inserts new Sprite(…) + draw calls into active editor
//         ⤓ PNG  → downloads current frame
//         ⤓ Sheet → downloads all frames as horizontal spritesheet

// Toolbar: paintbrush＋ icon opens a blank 16×16 editor
// Cleanup: spriteEditor windows cleaned on reset; underlying Sprite cleaned by cleanupSprites()

// ── Event / signal API ──────────────────────────────────────────────────────
// All on* methods return the editor instance for chaining.
sp.onPixel(fn)       // fn({ x, y, color, frame }) per pixel painted (pencil/eraser per pointer)
sp.onStroke(fn)      // fn({ tool, color, frame, bbox:{x,y,w,h} }) at end of stroke or fill
sp.onColor(fn)       // fn({ color, prev }) when active color changes
sp.onTool(fn)        // fn({ tool, prev }) when active tool changes
sp.onFrame(fn)       // fn({ action, index, count }) on frame add/dup/delete/move/select

// Decaying-pulse signal
sp.signal('pixel', { decay: 200 })                              // any pixel
sp.signal('pixel', { decay: 200, region: { x:0,y:0,w:8,h:8 } }) // top-left quadrant
//   → { value, velocity, stream(fn), on(fn) }
//   event: 'pixel' | 'stroke' | 'color' | 'tool' | 'frame' | '*'
//   region:{x,y,w,h} filters by sprite-pixel coordinates (scale-independent)
```

---

## Paint Canvas — `paint`, `Paint`

Freehand doodle canvas with animation frames, brush tools, autosave, and undo/redo. Supports a **backdrop** reference layer (image or live video) beneath all strokes.

```js
// Open a Paint window
paint({ width: 400, height: 300 })                // blank 400×300 canvas
paint({ width: 800, height: 600, frames: 4, fps: 8, bg: '#1a1a2e' })

// Open with a backdrop (image/video as a reference layer beneath strokes)
paint({ width: 640, height: 360, backdrop: 'https://example.com/photo.jpg' })
paint({ width: 640, height: 360, backdrop: 'clip.mp4', backdropMode: 'live' })
//   backdrop:     URL string | dataURL | HTMLImageElement | HTMLVideoElement | null
//   backdropMode: 'image' (static/frozen, default) | 'live' (video keeps playing)

// Paint class (also works directly):
new Paint({ width, height, frames, fps, bg, title, x, y, backdrop, backdropMode })

// Backdrop API (also accessible via 🖼 toolbar button):
p.setBackdrop(source, { mode })   // set backdrop: URL/element + 'image'|'live'
p.clearBackdrop()                 // remove backdrop, restore bg/checker

// Frame API (mirrors Sprite):
p.frame(n)          // switch active frame
p.addFrame()        // append blank frame, returns new index
p.frameCount        // number of frames
p.play(fps)         // start animation loop
p.stop()

// Tools: pen · eraser · line · rect · ellipse · fill bucket · eyedropper
// Brush size slider (1–64px), smooth freehand strokes (quadratic midpoint)
// Palette: 12 swatches + custom color picker; bg color picker
// Backdrop toolbar (🖼): load image · load video (live) · 📷 Freeze frame · clear
// Frame strip: add (＋) · duplicate (⧉) · clear · delete (🗑) · reorder (◀▶) · onion skin
// Transport: ▶ play · ■ stop · fps input
// Export: ⤓ Code → inserts canvas.backdrop()+canvas.image() into active editor (if backdrop active)
//         ⤓ PNG  → downloads current frame composited over backdrop
//         ⤓ Sheet → all frames composited over backdrop as horizontal spritesheet
// Undo/redo: Cmd/Ctrl+Z / Cmd/Ctrl+Shift+Z (also titlebar buttons)
// Autosave: creates a .paint desktop icon; double-click to reopen (backdrop persisted)

// Toolbar: 🖌️ icon opens a blank 400×300 canvas
// Cleanup: paint windows cleaned on reset via cleanupPaints()

// ── Event / signal API ──────────────────────────────────────────────────────
// All on* methods return the paint instance for chaining.
p.onStroke(fn)       // fn({ tool, color, frame, bbox:{x,y,w,h} }) after each stroke or fill
p.onColor(fn)        // fn({ color, prev }) when active color changes
p.onTool(fn)         // fn({ tool, prev }) when active tool changes
p.onFrame(fn)        // fn({ action, index, count }) on frame add/dup/clear/delete/move/select

// Decaying-pulse signal — value=1 on event, decays to 0 over `decay` ms
p.signal('stroke', { decay: 250 })                             // any stroke
p.signal('stroke', { decay: 250, region: { x:0,y:0,w:200,h:300 } }) // left-half only
//   → { value, velocity, stream(fn), on(fn) }
//   event: 'stroke' | 'color' | 'tool' | 'frame' | '*'
//   region:{x,y,w,h} filters by bbox overlap in canvas pixels
```

### In-window paint overlay (video/camera/image windows)

All image, video, camera, canvas, and shader windows have a **🖌️ paint overlay** toggle in the titlebar. No code required.

- Click 🖌️ → drawing canvas activates over the visual; mini-toolbar appears (pen/eraser, color, brush size, clear, snapshot)
- **📷 Snapshot** → composites the current visual frame + overlay into a PNG desktop icon
- Click 🖌️ again → overlay and toolbar removed, original window interactions restored
- Strokes persist within the window session but are not saved to the project

```js
// Overlay event / signal API — hooks register eagerly even before the overlay is activated
const id = wm.spawn('My Video', { type: 'video', src: 'clip.mp4' });
wm.paintEvents(id)                          // → WidgetEvents (or null if no overlay)
wm.onStroke(id, ({ tool, color, bbox }) => { /* ... */ })   // fn({tool,color,winId,bbox})
wm.paintSignal(id, 'stroke', { decay: 300 })               // → decaying signal
wm.paintSignal(id, 'stroke', { decay:300, region:{x,y,w,h} }) // region in overlay px
// Hooks cleared on reset; wm.getByTitle(title) → id for title-based lookup
```

---

## ASCII Art Editor — `asciiEditor`, `AsciiEditor`

Interactive colored ASCII art editor (asciistudio.app-style): per-cell fg + bg color, keyboard typing, brush tools, animation frames, autosave, and undo/redo.

```js
// Open an ASCII editor window
asciiEditor({ cols: 64, rows: 24 })
asciiEditor({ cols: 80, rows: 40, frames: 4, fps: 8, bg: '#0d0208' })

// AsciiEditor class (also works directly):
new AsciiEditor({ cols, rows, cellW, cellH, frames, fps, bg, title, x, y })

// Frame API:
ed.frame(n)          // switch active frame
ed.addFrame()        // append blank frame, returns new index
ed.frameCount        // number of frames
ed.play(fps)         // start animation loop
ed.stop()

// Cell data model: each cell = { ch, fg, bg }
//   ch = character (string), fg = '#rrggbb', bg = '#rrggbb' | null (transparent)

// Tools: type · brush · eraser · fill (flood by cell identity) · eyedropper · line · rect
// Char palette: ░ ▒ ▓ █ ▀ ▄ ■ · and more, plus free custom-char input
// Colors: per-cell fg <input type=color> + bg <input type=color> + transparent-bg toggle
// Grid size presets: 64×24, 80×40, 32×16, 40×20, 120×48
// Keyboard typing (type tool): click to set caret, type printable chars, arrows/Enter/Backspace
// Frame strip: add (＋) · duplicate (⧉) · clear · delete (🗑) · reorder (◀▶) · onion skin
// Transport: ▶ play · ■ stop · fps input
// Export:
//   Code  → inserts ascii.play([{w,h,cells:[{c,f,b}...]},...], fps) into active editor (colored)
//   Text  → downloads plain character grid as .txt + clipboard
//   ANSI  → downloads ANSI-escape-coded text (.txt) for terminals
// Undo/redo: Cmd/Ctrl+Z / Cmd/Ctrl+Shift+Z (also titlebar buttons)
// Autosave: creates a .ascii desktop icon; double-click to reopen

// Toolbar: terminal＋ icon opens a blank 64×24 editor
// Cleanup: ascii editor windows cleaned on reset via cleanupAsciiEditors()

// ── Event / signal API ──────────────────────────────────────────────────────
// All on* methods return the editor instance for chaining.
ed.onCell(fn)        // fn({ c, r, ch, fg, bg, frame }) on every cell change (suppressed during resize)
ed.onStroke(fn)      // fn({ tool, fg, bg, char, frame, bbox:{x,y,w,h} }) at end of stroke/fill (bbox in cell coords)
ed.onColor(fn)       // fn({ fg, bg, prev? }) when fg or bg color changes
ed.onChar(fn)        // fn({ char, prev }) when active character changes
ed.onTool(fn)        // fn({ tool, prev }) when active tool changes
ed.onFrame(fn)       // fn({ action, index, count }) on frame add/dup/clear/delete/move/select

// Decaying-pulse signal
ed.signal('cell', { decay: 250 })                              // any cell change
ed.signal('cell', { decay: 250, region: { x:0,y:0,w:10,h:5 } }) // top-left 10×5 cell region
//   → { value, velocity, stream(fn), on(fn) }
//   event: 'cell' | 'stroke' | 'color' | 'char' | 'tool' | 'frame' | '*'
//   region:{x,y,w,h} filters by cell column/row (not screen pixels)

// Playing colored frames (exported by AsciiEditor):
ascii.play([
  { w: 64, h: 24, cells: [{ c: '@', f: '#00ff41', b: null }, ...] }
], 8);
// String frames still work unchanged (backward-compatible):
ascii.play(['frame 1\nline 2', 'frame 2'], 12);
```

---

## Notepad — `Notepad`, `notepad`

Rich-text window for prose, poetry, and kinetic text. Programmatic cursor, selection, insert/delete, color/bold, and animated fake-typing.

```js
const note = new Notepad({ title: 'Poem', w: 420, h: 340 });
notepad({ title: 'Quick note' });  // factory shorthand
```

**Constructor options**: `title`, `x`, `y`, `w` (380), `h` (300), `content` (plain text or HTML).

### Content

| Method/Property | Description |
|---|---|
| `note.text` | Getter: plain textContent |
| `note.html` | Getter: sanitized innerHTML |
| `note.set(content)` | Replace all content (plain text or HTML) |
| `note.clear()` | Empty the editor |

### Cursor & Selection (flat char offsets over `textContent`)

| Method | Description |
|---|---|
| `note.cursor(pos)` | Move caret to flat offset |
| `note.select(from, to)` | Select range |
| `note.insert(text, at?)` | Insert at offset (default: caret) |
| `note.delete(from, to)` | Delete range |
| `note.replace(from, to, text)` | Replace range |

### Animated Typing (return Promises)

| Method | Description |
|---|---|
| `note.type(text, { cps=20, at? })` | Animate typing, fires `note:char` per char |
| `note.backspace(n=1, { cps=20 })` | Animate deleting backwards |

### Formatting

| Method | Description |
|---|---|
| `note.bold(from?, to?)` | Toggle bold on range (or current selection) |
| `note.italic(from?, to?)` | Toggle italic |
| `note.underline(from?, to?)` | Toggle underline |
| `note.color(col, from?, to?)` | Foreground color |
| `note.highlight(col, from?, to?)` | Background highlight color |

### Events

`note:type/char/done/change/cursor/select` — see event namespace table. Per-instance: `note.on('char', fn)`.

### Window control

`note.show()` / `note.focus()` / `note.close()`

---

## Utilities

```js
// Timers (auto-tracked)
setInterval(fn, ms) / clearInterval(id)
setTimeout(fn, ms) / clearTimeout(id)

// Color
Color.random()          // random vivid HSL string
Color.invert(str)       // invert any CSS color
randUni(lo, hi)         // random float in [lo, hi)

// Execution
pause() / resume() / stop()

// Console
console.log(...) / console.error(...) / console.clear()
```

---

## Examples

### Animated draw loop

```js
const canvas = new Canvas();
canvas.bg('#111');
let t = 0;
setInterval(() => {
  canvas.clear().bg('#111');
  canvas.circle(800 + Math.cos(t) * 300, 450 + Math.sin(t) * 200, 30, `hsl(${t*20%360},80%,60%)`);
  t += 0.04;
}, 16);
```

### Shader driven by mouse + audio

```js
note("c4 e4 g4 b4").play();
setcps(0.5);
const sig = audio.fft; // master signal — captures Strudel via the shared context

const shader = new Shader(`
  let amp = custom.x;
  let d = distance(uv, mouse);
  let glow = exp(-d * (4.0 + amp * 16.0));
  return vec4f(glow, glow * 0.4, glow * 0.1, glow);
`);
shader.start();
setInterval(() => {
  shader.set(0, sig.value); // master amplitude 0..1 (incl. Strudel)
}, 16);
```

### Input-reactive particle system

```js
const canvas = new Canvas();
const keys = hold('window:key:down');
let particles = [];

tick(16).do(() => {
  canvas.alpha(0.1).bg('#000').alpha(1);
  if (keys.has(' ')) {
    particles.push({ x: canvas.pointer.x, y: canvas.pointer.y, vx: randUni(-4,4), vy: randUni(-6,-1), life: 1, hue: randUni(0,360) });
  }
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx; p.y += p.vy += 0.2; p.life -= 0.02;
    if (p.life <= 0) { particles.splice(i,1); continue; }
    canvas.alpha(p.life).circle(p.x, p.y, 5, `hsl(${p.hue},90%,65%)`).alpha(1);
  }
});
```

### Vision + audio

```js
note("c2 ~ c2 ~").play();
setcps(0.42); // ~100 bpm

vision.onGesture('Open_Palm', () => setcps(0.66));   // ~160 bpm
vision.onGesture('Closed_Fist', () => setcps(0.33)); // ~80 bpm

const canvas = new Canvas();
setInterval(() => {
  const h = vision.hands()[0];
  canvas.clear().bg('#111');
  if (h) canvas.circle(h.cx + 800, 450 - h.cy, 20, 'lime');
}, 16);
```
