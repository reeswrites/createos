# ADR 030 — ShaderLayerBase and Keep-Alive Accessors

**Status**: Accepted  
**Date**: 2026-06-27

## Context

### Duplicated non-GPU halves

`Shader` (WebGPU, `src/api/shader/shader.js`) and `GLShader` (WebGL, `src/api/shader/glsl-shader.js`)
share identical non-GPU state and methods:

- `_resolveVideoSrc()` — ADR 006 resolver call (byte-identical in both files)
- `video()`, `set()`, `opacity()`, `z()`, `get canvas()` — identical bodies
- `bind(source)` + `_writeUniforms` audio-packing block (identical except for a mic-lease
  side-effect in GLShader)
- Keep-alive lifecycle (`this._live = liveOutput(this)` on start, `_live.release()` on
  stop — identical in both)
- FFT normalization block (`(db+80)/80`, band-split) — also duplicated in `audio.js` and
  `viz.js`

ADR 010 already separated the canvas-mount step into `mountLayerCanvas` in `layer.js`;
the GPU context setup and uniform writes are already per-class. This ADR finishes that
split.

### Latent route→shader bug

ADR 025's flagship example:

```js
route(Source.mic).amplitude.to(myShader, 'uCustom.x')
```

required `setUniform(name, val)` and `_uniforms` on the shader instance. Neither existed
on `Shader` or `GLShader`. `route.js:resolveSink` called them unconditionally, throwing
"unsupported sink" at runtime. Tests were green only because route tests used a phantom
mock (`{ setUniform: vi.fn(), _uniforms: {} }`) — no test drove a real shader instance.

### Keep-alive bypass

Three sites bypassed `liveOutput()` (from ADR 009) and touched `window.__ar_keepAlive`
directly:

1. `wm.js` — hand-rolled `_activeInst._keepAlive.add(win)` + `win._wmKeepAliveSet`
2. `signal-graph.js` — raw `for (const obj of window.__ar_keepAlive)` iteration
3. A 5–6× duplicated FFT reader that also lived outside the analyser abstraction

Direct Set mutation bypasses the ADR 009 capture-at-registration guarantee: a release
after an editor switch deletes from the wrong (new) Set, leaking the output.

## Decision

### 1. Extract `ShaderLayerBase`

New file: `src/api/shader/shader-layer-base.js`. Holds every non-GPU method both shaders share:

- `_initBase({z, opacity, container, videoSrc})` — initializes shared state including
  `_custom: new Float32Array(4)` and `_uniforms: {}`.
- `_resolveVideoSrc()`, `video()` — ADR 006 resolution unchanged.
- `set(indexOrArray, value)` — writes `_custom` lanes; notifies `shader:uniform`.
- `setUniform(name, val)` — maps `uCustom`/`custom` into `_custom[0..3]` via `set()` and
  stores the `{x,y,z,w}` object in `_uniforms.uCustom` for route's read-modify-write
  swizzle. Other names stored in `_uniforms` for forward-compat.
- `bind(source)` — distinguishes signal objects (`.bass` present) from raw analysers.
- `_packAudioCustom()` — shared audio→_custom fill; uses `readAnalyser`/`bands` from the
  new leaf (see §2).
- `opacity()`, `z()`, `get canvas()` — style setters.
- `_registerLive()`, `_releaseLive()` — keep-alive lifecycle via `liveOutput`.

`Shader extends ShaderLayerBase` and `GLShader extends ShaderLayerBase`. Each subclass
keeps only its GPU half: WGSL device/pipeline/buffer for `Shader`, WebGL gl/program for
`GLShader`. `GLShader.bind()` overrides to add `acquireMicRunScoped()` then calls
`super.bind()`.

### 2. Extract `analyser-read.js` leaf

New file: `src/api/audio/analyser-read.js` — no imports (mirrors `drawable-source.js`).

- `readAnalyser(src, bins?)` — normalizes Tone.Analyser (`getValue()` → dB → 0..1) and
  Web Audio AnalyserNode (`getByteFrequencyData` → byte → 0..1) to `Float32Array`. Handles
  `'mic'` sentinel via `window.__ar_mic_analyser`. Returns zeros for null/undefined.
- `bands(fft)` → `{value, bass, mid, high}` — split: bass=first 10%, mid=10–50%,
  high=50–100% of bins.

Replaces byte-identical copies in `audio.js`, `viz.js`, `shader.js`, `glsl-shader.js`.

### 3. Keep-alive accessors + close bypasses

`src/runtime/keep-alive.js` gains two read-only accessors:

- `forEachLive(cb)` — iterates the active keepAlive Set without exposing it.
- `liveCount()` — returns `window.__ar_keepAlive?.size ?? 0`.

**`wm.js`**: window spawn replaces `_activeInst._keepAlive.add(win)` +
`win._wmKeepAliveSet` with `win._live = liveOutput(win)` (captures Set at spawn time per
ADR 009). `_releaseWin(win)` uses `win._live?.release()`.

**`signal-graph.js`**: `_detectLiveNodes()` uses `forEachLive(obj => ...)` instead of
raw `window.__ar_keepAlive` iteration.

`editor-instance.js` remains the sole **Set owner** (publishes
`window.__ar_keepAlive = this._keepAlive`). A comment marks it as the single owner.

## Interface note: `setUniform` vs `bind`

These are mutually exclusive. `_packAudioCustom()` overwrites `_custom` every RAF frame
when a signal is bound. A route-driven shader (`route().to(shader, 'uCustom.x')`) must
not also call `shader.bind()`. Documented in `docs/shader.md` and `docs/glsl-shader.md`.

## Implementation

- `src/api/audio/analyser-read.js` — new leaf
- `src/api/shader/shader-layer-base.js` — new base class
- `src/api/shader/shader.js` — extends ShaderLayerBase; imports removed; GPU half only
- `src/api/shader/glsl-shader.js` — extends ShaderLayerBase; GPU half only; overrides bind()
- `src/api/audio/audio.js` — imports readAnalyser from leaf; removes local _readFft
- `src/api/visual/viz.js` — imports readAnalyser from leaf; removes _localReadFft
- `src/api/wm/wm.js` — liveOutput() for window spawn/close
- `src/api/signal/signal-graph.js` — forEachLive() for node detection
- `src/runtime/keep-alive.js` — forEachLive + liveCount accessors
- `tests/analyser-read.test.js` — new, comprehensive
- `tests/shader-layer-base.test.js` — new, stub subclass
- `tests/keep-alive.test.js` — extended for forEachLive/liveCount
- `tests/route.test.js` — de-phantomed shader stubs

## Consequences

**Positive**

- `route(Source.mic).amplitude.to(shader, 'uCustom.x')` works against real shaders (bug
  fixed).
- Non-GPU half of shaders testable without WebGPU/WebGL (StubShader extends
  ShaderLayerBase in tests).
- FFT normalization is one function; future fixes propagate everywhere.
- Keep-alive has one door; `window.__ar_keepAlive` is an implementation detail of
  `editor-instance.js`, not a global API.
- `ShaderLayerBase` named in `shader-layer-base.js` — `instanceof` checks across the
  route/shader seam are possible.

**Negative / tradeoffs**

- Subclass override for `GLShader.bind()` mic lease is a small seam leakage — mic
  acquisition is domain logic (not base-class logic). Acceptable: one override, well
  documented.
- `shader-layer-base.test.js` creates a stub subclass (anonymous class extends base) —
  not the real GPU classes. Adequate coverage of the extracted half; real GPU integration
  remains untested (no WebGPU/WebGL in test env — unchanged from before this ADR).

## Alternatives considered

- **Mixin** instead of base class — rejected; both shaders share constructor state
  (`_custom`, `_uniforms`, `_live`), which is easier to reason about in `_initBase` than
  spread across mixin hooks.
- **Add `setUniform` to each class separately** — rejected; that was the bug's root
  cause. One definition in the base is the point.
- **Delegate `forEachLive` reads back to `editor-instance.js`** — rejected; that
  concentrates knowledge of the Set's structure in the wrong module. The accessor pattern
  keeps the API surface at `keep-alive.js`.
