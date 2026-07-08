# Physics sims — signal sources (ADR 059)

Physics simulations are a **source category**: a numerical sim *generates* a signal
(distinct from a shader/pattern visualizer, which *renders* one). A sim is
**dual-character** — it publishes continuous **channels** (routable scalars: an angle,
a velocity, an energy, an order parameter) and discrete **events** (bounces,
zero-crossings, flips). Both flow into `route()` / `on()` like any other signal.

```js
const p = physics('pendulum', { id: 'a', damp: 0 });
p.show('Pendulum');                       // debug window — see the raw sim

// continuous channel → shader uniform (channels are plain () => value readers)
const sh = new GLShader(`gl_FragColor = vec4(uCustom.x, uv.y, 1.0-uCustom.x, 1.0);`).start();
route(p.theta2).norm(-Math.PI, Math.PI).smooth(0.85).to(sh, 'uCustom.x');

// discrete event → drum hit
route('physics:pendulum:flip').to('kick');
```

## `physics(name, opts)`

Returns a sim instance. `opts` are per-sim params plus a few reserved keys:

| key | meaning |
|---|---|
| `id` | stable identity — gives a per-instance event namespace and lets the sim **survive a soft reset** (see Lifecycle). Pass it when you route/perform. |
| `dt` | fixed substep seconds (continuous sims; default `1/240`) |
| `rate` | iterations/sec (iterated maps; default per-sim) |
| `substeps` | max substeps per frame (default `8`) |

### Instance API

- `p.<channel>()` — a channel reader, e.g. `p.theta2()`. Pass the reader itself to
  `route(p.theta2)` (it's a plain `() => value` fn; route needs no special-casing).
- `p.set(key, val)` — change a param **live** without resetting the trajectory
  (`p.set('g', 3)`). This is also what makes bidirectional modulation free (below).
- `p.get(key)` — read a param/state field.
- `p.show(title?, { w, h, x, y })` — spawn a debug window rendering the raw sim.
- `p.remove()` — tear down explicitly.

## Channels & events per sim

| sim | channels | events | key knobs |
|---|---|---|---|
| `pendulum` (double) | `theta1` `theta2` `omega1` `omega2` `energy` | `flip`{arm,dir} | `g` `damp` `l1` `l2` `m1` `m2` · `split` seeds a divergent twin |
| `ball` (bouncing) | `height` `vy` | `bounce`{speed} | `e` (restitution) `g` `height` |
| `kuramoto` | `R` (0..1) `psi` | `sync`{crossed,R} | `k` (coupling) `n` `spread` |
| `harmonic` (damped osc) | `x` `v` | `zero`{dir} | `omega` `zeta` |
| `lorenz` | `x` `y` `z` | `lobe`{side} | `sigma` `rho` `beta` |
| `logistic` (iterated map) | `x` (0..1) | `step`{x} | `r` `rate` |

Channels carry a **hint range** used for the debug bars and (later) auto-norm. Bounded
channels (`theta*`, `R`, logistic `x`) are exact; unbounded ones (`omega*`, `energy`,
Lorenz `x/y/z`) are approximate — normalize at the route with `.norm` / `.scale`.

## Events dual-emit

Every event fires on **two** bus names, so you can target a type or one instance:

```js
route('physics:pendulum:flip')   // every pendulum's flips
route('physics:a:flip')          // only instance id 'a'
on('physics:ball:bounce').do(e => e.speed)  // payload carries { id, name, ...}
```

## Bidirectional modulation (free)

Because `route()`'s fn-sink already exists and params are live-settable, routing a
signal *into* a sim param needs no new API:

```js
route(Source.mic).amplitude.scale(0, 1, 5, 25).to(v => p.set('g', v));  // mic bends gravity
route('midi:cc').filter(e => e.cc === 74).norm(0, 127).to(v => p.set('k', v));
```

⚠️ Feeding a **chaotic** sim its *own* channel back is an instability footgun — avoid.

## Lifecycle

- **Tick**: one shared fixed-step clock advances every live sim frame-rate-independently
  (fixed dt + substep accumulator), so chaotic sims stay stable at any frame rate.
- **A sim is an input.** Creating one does **not** hold the run alive. What keeps the run
  live is a downstream **output**: a route to audio/shader, or the debug window
  (`p.show()`). A sim that is never shown and never routed idle-stops within ~300 ms —
  give it a `.show()` while exploring.
- **Survives soft reset by identity** (like `Canvas`). During live-coding, createos
  soft-resets ~1 s after every clean parse; a sim keyed by `id` (or its opts-signature)
  is **reused** on re-run so a chaotic trajectory doesn't snap back to its start on every
  keystroke. Dropping it from the code tears it down a cycle later; a hard reset / stop /
  closing the debug window destroys it.

## Adding a sim

`registerPhysicsSource(name, spec)` — register **beside your own code** (the v1 catalog
lives in `src/api/signal/physics-sims.js`). A `spec` supplies `init(opts)→state`, either
`step(state, dt, emit)` (continuous, substepped) **or** `iterate(state, emit)` (iterated
map at `rate` Hz), a `channels` map, and an optional `render(ctx, state, w, h)`. Call
`emit(name, payload)` inside step/iterate to fire an event. See ADR 059 for the catalog of
future sims (N-body, billiards, boids, CA, …).
