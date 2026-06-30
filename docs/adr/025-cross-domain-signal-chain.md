# ADR 025 — Cross-Domain Signal Chain

**Status**: Accepted  
**Date**: 2026-06-27

## Context

createos has a rich input/output surface — camera, mic, MIDI, keyboard, mouse, gamepad, motion sensors, serial/GPIO on the input side; canvas layers, shaders, audio params, MIDI out, recording, WM windows on the output side. But connections between them are **implicit in code**.

The current paradigm is **code-as-patch**: when a user wires mic amplitude to a shader uniform, that connection exists only as a callback registered inside an `on()` call. It is invisible, not queryable, not recomposable at runtime, and must be rebuilt from scratch on every run.

Consequences of code-as-patch:

- **No topology visibility.** `signalGraph` exists as a stub requiring manual route registration.
- **Cross-domain bridging is boilerplate.** mic → shader uniform requires ~10 lines, differently structured each time.
- **No hot-swap.** Adjusting a mapping requires stop → edit code → re-run → lose state.
- **Fan-out is manual.** Three separate subscriptions with duplicated transform logic.
- **No composable transform vocabulary.** `.smooth()`, `.scale()`, `.threshold()` written inline differently each time.

`pipe()` is a partial solution: a fluent visual chain (canvas → transform → canvas). But it is domain-locked (visual only) and static (stages fixed at construction). It doesn't address cross-domain routing or live mutation.

The request that prompted this ADR: fluent API for time-sequenced visual effects on a video stream (inspired by optical printing; Malcolm Le Grice's *Berlin Horse*). That `film()` API turns out to be a special case of a more general missing primitive.

## Decision

Introduce `route(source)` — a **cross-domain signal chain** — as a first-class API primitive.

### Core concept

A `route()` call creates a route object: a typed signal flowing from a source through named transforms to one or more sinks. Routes are explicit data, not implicit code.

```js
// Mic amplitude → oscillator frequency (sub-ms push, stateless)
const osc = audio.synth();
route(Source.mic).amplitude.scale(0, 1, 200, 800).to(osc.frequency)

// MIDI CC → GLShader uniform (sub-ms push)
route('midi:cc').filter(e => e.cc === 74).norm(0, 127).to(myShader, 'uCustom.x')

// Camera brightness → shader uniform (RAF pull, bridge retyping)
route(Source.camera).brightness().scale(0, 1, 0, 10).to(myShader, 'uCustom')

// Beat event → visual treatment toggle
const r = route(Source.camera).show()
r.on('beat:bar', r => r.toggle('negative'))

// Berlin Horse optical printing timeline
route(Source.camera)
  .tint('#4a0').wait(3)
  .negative().wait(2)
  .clearEffects().solarize(0.6).wait(2)
  .loop().show()
```

### Resolved decisions (from grilling session, 2026-06-27)

**D1 — Name**: `route()`. `film()` alias dropped entirely.

**D2 — Temporal model**: Accumulation (optical-printing model). Effects stack until `clearEffects()`. `wait(sec)` commits the current stack and advances the timeline. `clearEffects()` is the scene boundary. Implemented via patched `window.setTimeout` (pauses with harness, cleans on reset — same rationale as `tick()`).

**D3 — Soft-reset persistence**: Rejected. Routes are run-scoped (cleared on reset + soft-reset via `onReset`). Re-running code re-creates routes — consistent with every other run-scoped construct.

**D4 — Serialization**: Descriptor `{source, chain:[{op,args}], sinks}` built for `signalGraph` and debugging. `.vljson` persistence deferred — closures (`.filter(pred)`, `.to(fn)`) are not serializable.

**D5 — Fan-in**: Fluent `.mix(src, combineFn?)`. Default combine = average. Forces RAF pull driver. Nested `route(...)` used as mixed source carries its own bridge.

**D6 — Typing**: Duck-typed with structural checks at construction time. Source `kind` known at `route()` call — bridge-on-wrong-source, scalar-on-frame-source, sink-mismatch all throw early.

**D7 — `film()` scope**: Dropped entirely (see D1).

### Signal types

Three types flow through the same primitive:

1. **Continuous** — sampled each RAF tick (mic amplitude via `Source.mic`, video.signal, fn source)
2. **Discrete** — triggered on event arrival (MIDI, beat, keypress, any bus event string)
3. **Frame** — blitted each frame (`Source.camera`, video element, canvas element)

### Clock model (per-sink driver election)

The keystone design choice. **Stateless/stateful split** governs driver election:

- **Stateless transforms** (`scale/clamp/norm/invert/get/filter/threshold/gate`): allow per-sink driver election.
- **Stateful transforms** (`smooth/debounce`, frame `strobe/speed`): force whole-route single RAF driver.

Driver election in `_startScalar()`:
- **Push (event-synchronous, sub-ms)**: when `discrete && stateless && allImmediate && !hasMix`.
- **RAF pull**: when `!discrete || stateful || !allImmediate || hasMix`.

This gives discrete→audio/MIDI paths sub-ms latency (below 2.7ms audio block floor). Visual sinks are vsync-bound (~16ms@60Hz) regardless — render-on-demand is out of scope.

**Sample-and-hold cell** (`_held`): discrete source subscribes and writes cell on each event; RAF sinks read cell each frame. Same mechanism powers fan-in.

### Source resolver

Option B: bare **string = event name** always. No string overloading.

- `'midi:cc'`, `'beat:bar'` → discrete subscription
- `Source.mic` → continuous (wraps `audio.level`/`audio.signal`)
- `Source.camera` → frame (delegates to `pipe()`)
- `fn` → continuous (called each RAF tick)
- Duck-typed objects with `brightness`/`motion` → continuous (video.signal-like)
- Canvas/video elements → frame

### Sink resolver

- `fn(value)` → called directly
- String `'event:name'` → `notify(event, value)`
- Tone.Signal / AudioParam duck-typed → `.value = v` (direct set, low-latency) or `.rampTo(v, ms/1000)` with `{ramp:ms}` option
- Shader instance + dotted path `'uCustom.x'` → read-modify-write swizzle via `sink._uniforms` + `sink.setUniform`
- Shader instance + simple name `'uCustom'` → `sink.setUniform(name, v)`

`setUniform` and `_uniforms` live on `ShaderLayerBase` (both `Shader` and `GLShader` extend it — ADR 030). Route targets the interface; never calls internal `_custom` directly.

### Bridges

Mandatory retyping first-hop from frame/audio to scalar. Position-constrained: must follow the source directly.

- `.amplitude` — mic/audio → scalar (wraps `audio.level`)
- `.brightness()` — camera/video → scalar (wraps `VideoSignalAPI.signal().brightness`)
- `.motion()` — camera/video → scalar (wraps `VideoSignalAPI.signal().motion`)
- `.fft()` — audio → array (wraps `audio.fft`)

No new sampling stack — thin wrappers over existing samplers.

### Canvas-frame routes

Delegate to `pipe()` internally. New effect stages added to Pipeline:

- **CSS-filterable** (via FxStage): `negative`, `blur`, `hue`
- **Per-pixel** (custom ImageData): `solarize`, `posterize`, `duotone`, `grain`
- **Temporal/stateful**: `strobe`, `speed`
- **Composite**: `tint`

All stages usable directly in `pipe()` too. Named stages support live mutation after start: `_addNamedStage(type, args)`, `_removeNamedStage(name)`, `_toggleNamedStage(name)`, `_clearNamedStages()`.

### Lifecycle

- Run-scoped via `onReset` — routes destroyed on reset and soft-reset.
- Self-register `liveOutput` keep-alive while a driver is active (released in `_destroy()`).
- `getLiveRoutes()` exported for `signalGraph.show()` auto-population.
- Route-scoped `.on(event, cb)`: chainable, auto-cleaned on route destroy; `cb` receives `(route, payload)`.

## Implementation

- `src/api/signal/route.js` — core Route class, `route()` factory, `getLiveRoutes()` export
- `src/api/visual/render-pipeline.js` — `Source.mic`, new effect stages, live-stage-mutation methods
- `src/api/signal/signal-graph.js` — auto-populates from `getLiveRoutes()` in `show()`
- `src/editor/api-detector.js` — `usesRoute` pattern
- `src/runtime/app.js` — `_registerBuiltin('route', route)`
- `src/editor/completions.js` — `Route` toolkit category
- `tests/route.test.js` — 55 tests covering all of the above
- `tests/api-detection-coherence.test.js` — `usesRoute` classified as DETECTED_UNCONSUMED
- `tests/blocks-coverage.test.js` — `Route` classified as BLOCKS_TODO

## Consequences

**Positive**
- Cross-domain connections are first-class, inspectable, hot-swappable.
- `signalGraph.show()` becomes genuinely useful automatically (no manual `.route()` calls).
- Berlin Horse / optical printing / VJ patterns: 1-3 lines vs 10-20.
- Composable transform vocabulary replaces repeated inline scaling/smoothing.
- Fan-out and fan-in natural.
- New pipe stages (`solarize/posterize/duotone/grain/strobe/tint/negative`) reusable directly in `pipe()`.

**Negative / tradeoffs**
- Two routing paradigms (`pipe()` static-visual + `route()` live-cross-domain) until/unless merged.
- Closure-carrying transforms (`filter`, `to(fn)`) not serializable — `.vljson` deferred.
- Blocks path pending (BLOCKS_TODO) — blocks-coverage gate prevents silent regression.
- Latency reality: <10ms only on discrete→audio/MIDI paths. Visual sinks vsync-bound.

## Alternatives considered

- **Extend `pipe()` cross-domain** — rejected; pipe's stage-DAG model assumes canvas I/O throughout.
- **Keep code-as-patch, improve ergonomics** — rejected; doesn't address topology invisibility or hot-swap.
- **Node-based visual editor (Max/MSP-style UI)** — out of scope; code API first. Visual editor could layer on top later.
- **`film()` global alias** — dropped; `route()` is clearer and one name is better than two.
