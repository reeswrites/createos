# How CreateOS thinks about signals

If you learn one idea, learn this one. Almost everything in CreateOS is a
**signal** moving through three steps:

```
   from a SOURCE   →   through TRANSFORMS   →   to a SINK
   (where it            (change it               (where it
    comes from)          along the way)           ends up)
```

A microphone's loudness (source) gets scaled up (transform) and sets a
synth's pitch (sink). A beat (source) spawns a window (sink). That's the
whole pattern — once you see it, the rest is vocabulary.

## Three flavors of signal

Signals come in three flavors. A chain has to stay **one flavor from end to
end** — unless you add a **bridge** to convert (more on those below).

| flavor | what it is | examples |
|---|---|---|
| **events** | something that fires at a moment | a key press, a MIDI note, a drum hit, a beat |
| **numbers** | a value from 0 to 1 you can read anytime | mic loudness, screen brightness, how recently you painted |
| **frames** | moving pictures | the camera, your own canvas |

You wire events and numbers with `route(...)`. You wire frames with `route(...)`
too, or with `pipe(...)` when you want to chain visual effects.

```js
// number → number: mic loudness controls synth pitch
route(Source.mic).amplitude.scale(0, 1, 200, 800).to(osc.frequency)

// event → action: every bar, spawn a little window
route('beat:bar').to(() => wm.spawn('Beat!', { w: 200, h: 120 }))

// frame → screen: camera, tinted, shown in a window
pipe(Source.camera).tint('#4a0').show()
```

## You can be the source

Sources aren't only hardware. **Anything you make or perform is a source too** —
a paint stroke, an ASCII animation, a drum pattern, a melody, your own canvas.
You're not just reacting to the world; you can *be* the input.

```js
// a paint stroke becomes a number that fades after each stroke
route(paint.signal('stroke')).to(myShader, 'uCustom.x')
```

## A sink can be anything

A sink isn't a short list of "outputs." If you give `.to()` a function, you can
do **anything** inside it — make a sound, drive a shader, spawn a window, save a
file to the desktop, send data out a serial port:

```js
route(Source.mic).amplitude.threshold(0.9).to(() => {
  desktop.addBlob(snapshot('win-canvas'), { name: 'loud-moment' })  // save a frame when it gets loud
})
```

Some outputs reach into the real world — a serial device, a GPIO pin, the
phone's vibration motor. Those you fire with `emit('serial:write', { data })`,
`emit('gpio:write', { pin, value })`, `emit('haptics:buzz', { ms })`.

## Bridges — changing flavor

A camera is **frames**, but maybe you want a **number** — how much motion is on
screen — to drive a sound. A bridge converts:

```js
route(Source.camera).motion().scale(0, 1, 0, 5).to(reverb.wet)
```

The common bridges:

| you have | you want | bridge |
|---|---|---|
| the mic | loudness as a number | `.amplitude` |
| the camera | brightness as a number | `.brightness()` |
| the camera | motion as a number | `.motion()` |

## Recording time, not just space

Everything above is happening *right now*. You can also capture it over time and
play it back. Two different things you can record:

- **The pixels** — a video or photo of what's on screen. `recordWindow(id)`,
  `snapshot(id)`. Lands as a file on your desktop.
- **The performance** — *what you did*, as replayable actions. Hit the **● Capture**
  button on a widget, perform, stop — now `.replay()` re-does it live (and you
  can loop it, or line several up on a `timeline()`).

The difference matters: a recording is a frozen video; a captured performance is
*alive* — replay it and it really drives the instrument again, so you can edit
it, loop it, or layer it with others.

## That's the model

> A signal comes **from** somewhere, gets **changed** along the way, goes **to**
> somewhere. Three flavors — events, numbers, frames — and bridges to convert
> between them. You can be the source or the sink. And you can record either the
> pixels or the performance and play it back.

Everything else is details.

---

**Go deeper:**
- [`docs/signal-map.md`](docs/signal-map.md) — the complete list of every source, transform, sink, and bridge
- [`docs/time-and-capture.md`](docs/time-and-capture.md) — recording, replay, and timelines in full
- [`API.md`](API.md) — the full API reference
