# Time & Capture — Recording, Replay, Timeline

> Reference doc — complete and precise, but dense. For the plain-language version,
> see the "Recording time" section of [`../LEARN.md`](../LEARN.md).

The [signal map](signal-map.md) is the **spatial** axis: what flows from source
to sink right now. This doc is the **time** axis: capture a stream over time,
then replay or sequence it back into the same sinks.

There are **two distinct kinds of recording** (ADR 031). They are not the same
thing and do not interchange:

| | Recording | Take (performance capture) |
|---|---|---|
| captures | **pixels** — the rendered output | **actions** — what the user did |
| produces | a video/image blob | a list of `{ t, ... }` events |
| replays as | a `<video>` / file | **re-run code** that drives the widget |
| module | `src/api/recorder.js` | `performance-recorder.js` + `replay-clock.js` + `timeline.js` |
| where it lands | desktop file (IDB blob) | code snippet / live `.replay()` |

## 1. Recording — capture the pixels

Records the rendered output of a window/canvas as a media blob. Output, not
input — it sits at the **sink** end of the graph.

| api | does |
|---|---|
| `recordWindow(winId, opts)` | record a window's visual (composites paint overlay + text) |
| `snapshot(winId, opts)` | single-frame PNG of a window |
| `recordStream(stream, opts)` | record an arbitrary `MediaStream` |
| `compositeCanvasStream(canvases, fps)` | merge canvases into one stream to record |

Returns a `Recording` handle (`.stop()` finalizes). Blobs converge on
`desktop.addBlob(blob, …)` → stored in IDB (`vl-captures`), **not** localStorage.
Recordings finalize on reset via `cleanupRecorders()` — a partial blob is still
saved. Snapshot composites base → overlay → text; recording excludes the live
overlay.

```js
const rec = recordWindow('win-canvas');
// … perform …
rec.stop();                       // → desktop file
snapshot('win-canvas');           // → PNG desktop file
```

## 2. Take — capture the actions

Records a widget's user actions as a timestamped **Take** (`{ t, ... }`,
wall-clock ms), replayable **as code**. This is the performance, not the video —
replaying re-drives the widget, so the output is live and editable, not a frame
dump.

**Capture is fed from each widget's INPUT handlers, never its public action
methods** — so replay (which calls those methods) does not re-record. That split
is the whole point; do not move `this._take.push()` into a public verb.

| api | does |
|---|---|
| widget Capture ● button | arm this widget's Take; stop → `.replay(...)` |
| `widget.replay(actions, { loop })` | replay a Take into the widget |
| `#globalCaptureBtn` | arm **every** widget on one shared clock; stop → emits one `timeline()` |

Multi-action widgets tag actions with `op` (`pixel`/`cell`/`stroke`/`frame`);
single-action widgets omit it. Each widget implements `_perfCtor()` →
`{ varName, code }` and `_applyAction(action)`. Widgets that re-enter their own
input path on apply (Ascii `_setCell`, Notepad `input`) gate capture with a
`_replaying` flag. Two widgets gained capture-only events: **Piano** (note-off →
`dur`), **Paint** (pointermove buffer → stroke `pts`).

## 3. Timeline — sequence Takes

`timeline()` composes multiple Takes across multiple widgets on **one shared
clock**.

| api | does |
|---|---|
| `timeline()` | new timeline |
| `.track(widget, actions, { at })` | add a widget's Take, offset `at` ms |
| `.play({ loop })` | run all tracks on one clock |
| `.stop()` | stop the clock |

```js
timeline()
  .track(piano,  pianoTake)
  .track(drums,  drumTake, { at: 500 })
  .play({ loop: true });
```

Both `.replay()` and `timeline().play()` reduce to `replay-clock` ops scheduled
on **patched `window.setTimeout`** (intentional harness exception — pauses with
the harness, cleans on reset; same rationale as Route timeline and `tick()`).
Run-scoped via `onReset` + `liveOutput` keep-alive while playing.

## How this sits over the signal map

- A **Take** records a *source's* events over time; replaying it re-emits those
  events into the same widget — so a Take is a recorded, time-shiftable source.
- A **Recording** captures a *sink's* rendered pixels — so it lives at the
  output end.
- The clock (`replay-clock.js`) is the shared scheduler for replay, timeline,
  and Route's own timeline — one time substrate under all of them.

_See: ADR 031, `src/api/recorder.js`, `src/api/performance-recorder.js`,
`src/api/replay-clock.js`, `src/api/timeline.js`. Spatial axis: [signal-map.md](signal-map.md)._
