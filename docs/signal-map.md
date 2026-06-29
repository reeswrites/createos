# Signal Map — Inputs, Transforms, Outputs

> Reference doc — complete and precise, but dense. New to the idea? Start with
> [`../LEARN.md`](../LEARN.md) for the plain-language mental model, then come here
> for the full list.

Every streamable in CreateOS flows through one model:

```
[kind] source  →  [same kind] transform  →  [same kind] sink
```

`route()` carries **scalar** signals (discrete + continuous); `pipe()` carries
**frame** signals (visual). The kind must match end-to-end — **bridges** are the
only thing that converts one kind to another.

## Signal kinds (the spine)

| kind | shape | clock |
|---|---|---|
| **discrete** | bus event, fires on change | push (event-sync, sub-ms) |
| **continuous** | scalar `0..1`, read any time | RAF pull |
| **frame** | canvas / video pixels | RAF pull |

## Sources

| kind | source | api |
|---|---|---|
| discrete | any bus event name | `route('beat:bar')` |
| discrete | MIDI (Web MIDI) | `route('midi:cc')` · `route('midi:note:on')` |
| discrete | serial / GPIO (WebSerial) | `route('sensor:serial:data')` · `route('gpio:pin')` |
| discrete | STT taps (ADR 039) | `route(src, 'audio:transcript')` |
| continuous | mic level | `route(Source.mic)` |
| continuous | gaze | `route(Source.gaze.x \| .y \| .vx \| .vy)` |
| continuous | fn / signal-obj / `AudioParam` | `route(() => v)` |
| frame | camera | `route(Source.camera)` / `pipe(Source.camera)` |
| frame | canvas / video element | `route(canvasEl)` / `pipe(canvasEl)` |

Discrete event namespaces: `midi:*`, `beat:*`, `window:key:*`, `window:mouse:*`
(+ window-scoped `wm:{id}:*`), `sensor:*` (incl. `sensor:serial:data`),
`gesture:*`, `gaze:*`, `gpio:pin`, `serial:status`, `note:*`, `audio:*`,
`midi:cc/clock/note:on/note:off/open`, paint/widget events.

### Authored sources (you make the signal)

Sources aren't only hardware — anything you create or perform is a streamable
source too. Pixel art, ASCII animations, paint strokes, beats, instruments,
your own canvases. They flow into `route()`/`pipe()` the same way, keyed by the
same kind.

| kind | source | how |
|---|---|---|
| discrete | widget actions — Paint stroke, Sprite pixel, Ascii cell, Drumpad hit, Piano note, Notepad type | widget `.on(event, fn)` (WidgetEvents) or scoped `wm:{id}:*` |
| discrete | beat clock (authored tempo) | `route('beat:tick' \| 'beat:bar' \| 'beat:phrase')` |
| continuous | widget intensity — decaying `0..1` since last action | `route(paint.signal('stroke', { decay }))` · `wm.paintSignal(id)` · `drumpad.signal()` |
| frame | your own pixels — `Canvas`, `draw`, `ascii.play(...)`, `Sprite` render | `route(myCanvas)` / `pipe(myCanvas)` |

Widget `.signal(event, { decay })` returns a `{ value }` signal-obj (1 right
after the action, decaying to 0 over `decay` ms) — route reads it as continuous.
Same object exposes `.stream(fn)` and `.on(fn)`.

## Transforms

| kind | transforms |
|---|---|
| continuous | stateless: `scale clamp norm invert get filter threshold gate` · stateful (forces whole-route RAF): `smooth debounce` |
| frame | `tint negative solarize posterize duotone grain strobe blur hue ascii pixelate fx shader glshader` |

Frame stages live in `Pipeline.STAGE_CTORS` (single source of truth). Add a
custom stage via `pipe.register(name, factory, descriptor)`.

## Sinks

| kind | sink | api |
|---|---|---|
| discrete / continuous | fn | `.to(v => …)` |
| discrete / continuous | bus event | `.to('event')` |
| continuous | audio param / `Tone.Signal` | `.to(sig, { ramp: ms })` |
| continuous | shader uniform | `.to(shader, 'uCustom.x')` |
| frame | WM window | `.show(title)` |
| frame | canvas layer | `.layer(z)` |
| frame | DOM element | `.to(el \| selector)` |
| frame | headless (read `.canvas`) | `.start()` |

The **fn sink is the universal output** — `.to(v => …)` is an escape hatch into
the whole runtime. Inside it you can call any `window` API and do any
programmatic action: spawn windows (`wm.spawn`), write desktop files
(`desktop.addBlob`), drive audio (`audio.*`, `mixer.*`), fire bus commands
(`emit(...)`), mutate any state. The named sinks above (audio param, shader
uniform, layer, window, DOM) are conveniences for common targets; the actuators
below are one case of the fn-sink-calls-`emit()` pattern, not a separate door.

```js
route('beat:bar').to(() => wm.spawn('Beat', { w: 200, h: 120 }));
route(Source.mic).amplitude.threshold(0.9).to(v => desktop.addBlob(snap(), { name: 'loud' }));
```

## Actuator outputs

Real-world side-effect outputs (commandable events in the bus registry). These
are **not** route/pipe sinks — `route().to('event')` uses `notify`, which fires
subscribers only and does **not** invoke the command handler. Drive an actuator
with `emit()` directly, or from a route via a fn sink that calls `emit()`.

| output | event | payload |
|---|---|---|
| serial write (WebSerial) | `serial:write` | `{ data }` |
| GPIO write (via serial) | `gpio:write` | `{ pin, value }` |
| haptic vibrate | `haptics:vibrate` | `{ pattern }` |
| haptic tap | `haptics:tap` | `{}` |
| haptic buzz | `haptics:buzz` | `{ ms }` |
| haptic stop | `haptics:stop` | `{}` |

```js
// direct
emit('gpio:write', { pin: 13, value: 1 });

// from a route — fn sink calls emit()
route(Source.mic).amplitude.threshold(0.8).to(() => emit('haptics:buzz', { ms: 50 }));
```

WebSerial is bidirectional: `sensor:serial:data` / `gpio:pin` are **sources**
(in), `serial:write` / `gpio:write` are **actuator outputs** (out).

## Bridges (kind-changers)

The explicit conversion layer between kinds. Bridges are **position-constrained**
— a continuous bridge must be the first call after a frame source, before any
scalar transform.

| from → to | bridge | note |
|---|---|---|
| mic frame → continuous | `.amplitude` · `.fft()` | first after `Source.mic` |
| camera frame → continuous | `.brightness()` · `.motion()` | first after `Source.camera` |
| discrete → continuous | sample-and-hold cell | automatic, internal (`_held`) |

## Notes

- Clock election is per-sink (ADR 025): a discrete source with a stateless chain
  and all-immediate sinks runs **push** (event-synchronous); any stateful
  transform forces a single whole-route RAF driver.
- Frame routes delegate to `pipe()` internally — `route()` and `pipe()` share
  the same effect set.
- Routes are run-scoped (`onReset` + `liveOutput` keep-alive while a driver is
  active).

## See also

This doc is the **spatial** axis (what flows where, now). For the **time** axis —
recording a stream, replaying actions, sequencing on a timeline — see
[`time-and-capture.md`](time-and-capture.md).

_See: `src/api/route.js` (ADR 025), `src/api/render-pipeline.js`, ADR 039 (STT)._
