# Audio & Pattern API

Live coding with Tone.js. Press **?** in the IDE to see this as an in-app quick reference.

---

## Quick Start

Patterns use the real [Strudel](https://strudel.cc) engine (ADR 035) — **explicit calls**, no
global transpiler. `.play()` starts a pattern on the shared scheduler; `hush()` stops all.

```js
// Melody — synth, works with NO samples (the front door)
note("c4 e4 g4 b4").play();
setcps(0.5);              // cycles/sec — also sets Tone BPM = cps*60 (shared tempo)

// Layered — stack() runs more than one line (last .play() wins otherwise)
stack(
  note("c2 ~ c2 ~").slow(2),     // bassline
  n("0 2 4 6").scale("C:minor")  // scale-degree melody
).play();
```

Samples are **bring-your-own** — createos bundles no kit. `note(...)` needs nothing; `s(...)`
is silent until you load a pack:

```js
samples('github:tidalcycles/dirt-samples');  // or any sample-map URL
s("bd hh sd hh").play();
```

---

## Pattern Syntax (Mini-notation)

A string passed to `note()` / `s()` / `n()` parses as mini-notation (no `String.prototype`
patching — bare JS strings elsewhere stay normal):

| Syntax | Meaning |
|--------|---------|
| `"c4 e4 g4"` | Space-separated — equally spaced across one cycle |
| `"~ c4"` | `~` = rest / silence |
| `"c4 [e4 g4]"` | `[ ]` subgroup — e4 g4 share c4's slot (double speed) |
| `"<c4 g3> e4"` | `< >` alternate each cycle — c4 on cycle 0, g3 on cycle 1 |
| `"c4*3 g4"` | `*N` repeat N times inside the slot |
| `"c4!3 e4"` | `!N` replicate N times |
| `"c4@3 e4"` | `@N` weight — c4 takes 3× duration relative to e4 |
| `"c4? e4"` | `?` degrade — random drop; `?0.3` sets probability |
| `"c4,e4,g4"` | `,` polyphony — sound simultaneously (a chord) |
| `"{c4 e4 g4}%4"` | `{}%N` polymeter — N steps/cycle cycling inner values |
| `"0..7"` | range — expands to `0 1 2 3 4 5 6 7` |

### Pattern API

Sources return a Strudel `Pattern`; transforms are chainable and immutable.

```js
// Sources
note("c e g")           // pitches on the default synth (no samples)
n("0 2 4").scale("C:minor")  // scale degrees → notes (@strudel/tonal)
s("bd sd hh")           // named samples (load a pack first)
sound("...")            // alias of s()
stack(a, b, ...)        // layer in parallel    seq(a,b) / cat(a,b)  // sequence / alternate
silence                 // empty pattern

// Transforms (chain before .play())
.fast(2) / .slow(2)     .rev()              .add(note("7"))   // transpose by a pattern
.gain("0.4 0.8")        .pan("0 1")         .lpf("400 2000")  // effects take patterns too
.euclid(3, 8)           .euclid(5, 8, 2)    // Euclidean rhythm (+ rotation)
.every(4, p => p.rev()) .off(0.125, p => p.add(note("12")))   .jux(p => p.rev())
.sometimes(p => p.fast(2)) / .often / .rarely / .someCyclesBy(0.3, fn)
.degradeBy(0.3)         .scale("C:minor")

.play()                 // start on the shared scheduler
.stop()                 // stop this pattern (or hush() for all)
```

`setcps(n)` controls tempo (Tone is master clock: `bpm = n*60`). In the Mixer, all Strudel
sound is carried by a single **"Strudel"** strip (`mixer.strip('Strudel')`).

### Composing patterns

```js
const drums = stack(
  s("bd ~ bd ~"),                    // needs a loaded sample pack
  s("~ sd ~ sd"),
);
const bass  = note("{c2 g2 bb2 f2}%4").slow(2);
const mel   = n("0..7").scale("C:minor");

stack(drums, bass, mel).play();
setcps(0.5);
```

---

## Synths

```js
audio.synth(opts)   // basic oscillator
audio.poly(opts)    // polyphonic — play(['C4','E4','G4'], '4n')
audio.fm(opts)      // FM synthesis — rich/metallic tones
audio.am(opts)      // AM synthesis
audio.pluck(opts)   // Karplus-Strong plucked string
audio.kick(opts)    // membrane synth — kick / tom drums
audio.metal(opts)   // metallic — hi-hats, cymbals (no note arg)
audio.noise(opts)   // white noise (no note arg)

s.play(note, dur, time?) // trigger — dur: '8n' '4n' '1n' or seconds
s.attack(note)           // note on
s.release()              // note off
s.volume(-6)             // volume in dB
s.connect(fx)            // route to one effect
s.chain(fx1, fx2)        // route through effects in series → output
```

`opts` are Tone.js synth options, e.g. `{ oscillator: { type: 'sawtooth' }, volume: -6 }`.

---

## Effects

Connect with `s.connect(fx)` or `s.chain(fx1, fx2)`.

```js
audio.reverb(decay)              // reverb — decay in seconds (default 1.5)
audio.delay(time, feedback)      // echo — time sec, feedback 0–1
audio.distort(amount)            // distortion 0–1
audio.chorus(freq, delay, depth) // chorus
audio.filter(type, freq, Q)      // filter — type: 'lowpass' 'highpass' 'bandpass' 'notch'
audio.autoFilter(rate)           // LFO-swept filter — rate in Hz
audio.vibrato(freq, depth)       // pitch wobble
audio.tremolo(freq, depth)       // volume wobble
audio.phaser(rate, octaves)      // phase shifting
audio.wah(baseFreq)              // auto-wah
audio.pitchShift(semitones)      // shift pitch up/down without changing tempo
audio.compressor(threshold, ratio) // dynamic range control
audio.eq(low, mid, high)         // 3-band EQ in dB
```

---

## Scales & Harmony

```js
audio.scale('C4', 'minor')
// → ['C4','D4','Eb4','F4','G4','Ab4','Bb4']

// Available scale names:
// major  minor  dorian  phrygian  lydian  mixolydian  locrian
// pentatonic  blues  chromatic

audio.note(scaleArr, degree)  // pick note by scale degree (wraps)

// In Strudel, prefer n(...).scale() — scale degrees map to notes for you:
n("0 1 2 3 4").scale("D:pentatonic").play();

// Degree-based melody:
n("0 2 4 2 1 3 5 4").scale("C:minor").play();
setcps(0.5);
```

---

## Modulation

```js
// LFO connected to synth parameter
const s = audio.fm();
const lfo = audio.lfo(2, 200, 2000);   // freq=2Hz, range 200–2000
lfo.connect(s._.frequency);             // modulate pitch

// Available signal targets on a synth:
// s._.frequency     — pitch
// s._.volume        — amplitude
// s._.detune        — detune in cents (FMSynth, Synth)
// s._.harmonicity   — FM harmonicity ratio
```

---

## Microphone

```js
const mic = await audio.mic();  // prompts browser permission on first call

// Route mic to effects
const rev = audio.reverb(2);
mic.connect(rev);

// Route mic to analysis
const meter = audio.meter();
mic.connect(meter);
setInterval(() => {
  const db = meter.getValue();
  const amp = isFinite(db) ? Math.pow(10, db / 20) : 0;
  // amp drives visuals...
}, 16);

// Pitch estimation via FFT
const fft = audio.analyser(2048);
mic.connect(fft);
setInterval(() => {
  const bins = fft.getValue();          // Float32Array of dB values
  let maxI = 0;
  bins.forEach((v, i) => { if (v > bins[maxI]) maxI = i; });
  const hz = maxI * 24000 / bins.length; // approximate frequency
  console.log(hz + ' Hz');
}, 100);
```

`audio.mic()` is async — `await` it. The browser will prompt for microphone permission. The source is tracked and closed automatically on Stop/Reset.

### Mic signal bus

Enable the mic in the toolbar, then read the live level without routing a mic node:

```js
// audio.level — live 0–1 RMS float, always available once mic is on
setInterval(() => {
  draw.clear().bg('#111');
  draw.rect(100, 400, audio.level * 800, 20, 'cyan');
}, 16);

// audio.onLevel(threshold, onEnter, onExit?) — edge-trigger
// fires onEnter when level crosses threshold upward, onExit when it drops below
audio.onLevel(0.6, () => draw.bg('red'), () => draw.bg('black'));

// Feed into a shader via custom uniform
const shader = new Shader(`
  let pulse = custom.x;
  let d = distance(uv, vec2f(0.5));
  return vec4f(vec3f(pulse - d * 2.0), 1.0);
`);
shader.start();
setInterval(() => shader.set(audio.level), 16);
```

These follow the same signal bus pattern as `sensors.*` and `video.signal` — any live 0–1 value can drive a shader uniform, a filter frequency, a draw parameter, or anything else. See [sensors.md](sensors.md) for the full comparison.

### Speech recognition

```js
// Fire on a specific word (Chrome/Edge only)
audio.onWord('boom', () => draw.bg('red'));

// Receive every recognized phrase
audio.onSpeech(phrase => { console.log(phrase); });
```

Continuous recognition; auto-restarts on silence. Stops on reset.

### Speech synthesis

```js
audio.say('hello world');
audio.say('hello', {
  voice: 'Google UK English Female',  // voice name from audio.voices()
  rate:  1.2,    // 0.1 – 10
  pitch: 0.8,    // 0 – 2
  volume: 1.0,   // 0 – 1
  lang: 'en-GB',
});

audio.voices()   // → array of available SpeechSynthesisVoice objects
```

Cancelled on reset.

---

## Analysis (Audio → Visual)

The key insight: don't draw audio — use audio *as a control signal* for an unrelated visual system.

```js
// Meter — RMS amplitude
const meter = audio.meter();
const s = audio.fm();
s.chain(meter);            // synth → meter → speakers

setInterval(() => {
  const db = meter.getValue();                   // -Infinity to 0 dB
  const amp = isFinite(db) ? Math.pow(10, db / 20) : 0; // 0..1 linear
  // use amp to drive: gravity, blur, shader uniform, particle force...
}, 16);

// FFT analyser
const fft = audio.analyser(32);    // 32 frequency bins
s.chain(fft);
const bins = fft.getValue();       // Float32Array of dB values
```

### Audio→Visual Patterns

**Beat as state machine trigger** — the bus `beat:tick` fires at musical time, and Strudel
is locked to the same Tone transport:
```js
let caState = initCA();
note("c1 ~ c1 ~ c1 ~ c1 c1").play();   // audio is the clock
setcps(0.5);

on('beat:tick').do(() => {
  caState = stepCA(caState);            // advance CA on every beat
  draw(caState);
});
```

**Beat selects visual mode** — step a palette on each beat:
```js
const palettes = [["#f00","#f60"], ["#0ff","#06f"], ["#fff","#888"]];
note("c4 e4 g4 e4").play();
let i = 0;
on('beat:tick').do(() => { currentPalette = palettes[i++ % palettes.length]; });
```

**Amplitude as physics force** — `audio.fft` taps the master, so it sees Strudel:
```js
const sig = audio.fft;
setInterval(() => {
  balls.forEach(b => { b.vy += sig.value * 0.005; }); // loud = stronger gravity
}, 16);
```

**Spectrum mapped to shader parameter**:
```js
note("c3 e3 g3 bb3").play();
const sig = audio.fft;
setInterval(() => {
  shader.set(1, sig.high ?? 0.3);  // spectral high → hue, warp, any visual param
}, 16);
```

### Master FFT signal — `audio.fft`

Taps `Tone.Destination` (the master output). No `chain()` needed — it sees everything.

```js
audio.fft.value    // current dominant frequency bin (number)
audio.fft.bass     // low-band energy 0–1
audio.fft.mid      // mid-band energy 0–1
audio.fft.high     // high-band energy 0–1
audio.fft.fft      // Float32Array of all bins (raw)
audio.fft.stream(fn)  // RAF push: fn({ value, bass, mid, high, fft })
```

Use `audio.fft.bass` to drive a shader uniform without chaining any analyser manually:

```js
const s = new GLShader(`
  float b = custom.x;
  vec3 col = vec3(b, 0., 1. - b);
  gl_FragColor = vec4(col, 1.);
`).start();
setInterval(() => s.set(0, audio.fft.bass), 16);
```

---

## Audio Files — `audio.load()` / `audio.upload()`

Load audio from URL or user file-picker. Returns `AudioFile`.

```js
const f = await audio.load('https://example.com/beat.mp3');
const f = await audio.upload();   // opens file picker
```

### Playback

```js
f.play(offset?)   // offset in seconds (default 0)
f.pause()
f.stop()
f.seek(seconds)
f.loop(true)
f.volume(-6)      // dB

f.currentTime     // live getter (seconds)
f.duration        // total length (seconds)
f.state           // 'started' | 'stopped' | 'paused'
await f.ready     // resolves when buffer loaded
```

### FX chain (chainable, return `this`)

```js
f.filter('lowpass', 800, 1)
 .reverb(2.5)
 .eq(-3, 0, 6)
 .delay(0.25, 0.4)
 .pitchShift(7)
 .distort(0.3)
```

### Time callbacks

```js
f.onTime(4.2, () => { /* fires when playback reaches 4.2s */ });
```

### Waveform canvas

```js
const wf = f.waveform({ width: 600, height: 80, color: '#0ff', bg: '#000' });
// wf is an HTMLCanvasElement — live playhead updates on each frame
document.body.appendChild(wf);
// or pass to draw:
draw.image(wf, 0, 800);
```

### Live FFT signal from a file

```js
const sig = f.signal(32);    // 32 frequency bins
sig.bass / sig.mid / sig.high   // energy bands 0–1
sig.stream(fn)
```

---

## Audio Visualizers

### Spectrogram — `audio.spectrogram(source, opts)`

Scrolling frequency×time heatmap.

```js
const sg = audio.spectrogram(source, {
  palette: 'rainbow',   // 'rainbow' | 'thermal' | 'cool' | 'mono'
  width:   800,
  height:  256,
});
// sg.canvas → live HTMLCanvasElement
wm.spawn('Spectrogram', { type: 'canvas', canvas: sg.canvas, w: 800, h: 256 });
// or:
draw.image(sg.canvas, 0, 0);
```

### Piano roll — `audio.pianoRoll(opts)`

Falling-note overlay. Auto-hooks `Instrument.play()` — no manual wiring.

```js
const roll = audio.pianoRoll({
  z:        5,        // layer z-index
  opacity:  0.85,
  speed:    120,      // px/s fall rate
  midiMin:  36,       // C2
  midiMax:  96,       // C6
});
```

### Mixer — `mixer` (ADR 032)

The live audio console. Every running instrument, window, mic and drumpad gets a
**Strip** (volume / pan / mute / solo + VU meter + lazy 4-band parametric EQ) routed
through to the **Master**. Open the panel from the toolbar 🎚️ button or from code.

```js
n("0 3 5 7").scale("C:minor").play();      // Strudel — sounds through the 'Strudel' strip

mixer.show();                                 // open the console
mixer.strip('Strudel').volume(-6).pan(-0.3);  // all Strudel sound is one strip (ADR 035)
mixer.strip('Strudel').solo();                // additive solo — non-soloed strips duck
mixer.strip('Strudel').eq([{ freq: 2500, gain: 4 }]);
mixer.master.volume(-2);                      // master strip
mixer.add(someWebAudioNode, { name: 'fx' });  // bring an arbitrary node into the mix
```

- All Strudel output is carried by one **"Strudel"** strip (per-orbit strips deferred — ADR 035 #4).
  Other strip names = instrument-type+counter (`fm 1`), window title, `mic`, or drumpad title.
  Rename in the panel (double-click).
- Settings persist by name across re-runs (localStorage) and travel in the `.vljson`
  project. Solo is a persisted per-strip flag.
- The standalone `audio.eqWidget()` is gone — its role is now the Master strip's EQ.

---

## Transport

```js
audio.bpm(120)    // set tempo
audio.start()     // start transport clock (needed for Strudel .play(), loop, sequence)
audio.stop()      // stop transport
audio.volume(-6)  // master output volume in dB
audio.now()       // current audio time in seconds
audio.freq('C4')  // note name → frequency in Hz
```

---

## Legacy Scheduling

Low-level scheduling if you don't want mini-notation:

```js
// Sequence — steps through array
const seq = audio.sequence(['C4','E4','G4'], '8n', (note, time) => {
  s.play(note, '8n', time);
});
seq.start(0);
audio.start();

// Loop — fires callback every interval
const l = audio.loop(time => {
  s.play('C4', '8n', time);
}, '4n');
l.start(0);
audio.start();
```

---

## Cleanup

Everything created via `audio.*` is automatically tracked and disposed when you press **Stop** or **Reset**. You don't need to call `.dispose()` manually.
