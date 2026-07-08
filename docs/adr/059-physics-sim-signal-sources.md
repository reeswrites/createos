# ADR 059 — Physics simulations as a signal-source category

**Status**: Proposed
**Date**: 2026-07-08

## Context

createos has a mature signal layer — `route()` (ADR 025) carries a typed signal from a
source, through composable transforms, to any sink (shader uniform, audio param, bus
event, fn). Its sources today are all *sensed* (mic, camera, gaze, MIDI, sensors) or
*authored* (patterns). There is no **generated** continuous source: a deterministic
process that produces smooth, never-repeating, tunable signal on its own.

We want to add numerical **physics simulations** as such a source — a category distinct
from the shader/pattern **visualizers** (a visualizer *renders* a signal; a sim
*generates* one). The goal is explicitly **not** one sim wired to one sink, but a
flexible category many sims plug into and any workflow can route from: a double pendulum
driving a filter sweep, a bouncing ball firing drum hits, Kuramoto oscillators opening a
section over 30 seconds, N pendulums generating polyrhythm.

A sim is **dual-character**: it has **continuous channels** (angle, angular velocity,
energy, an order parameter) that want to modulate params, and **discrete events**
(bounces, zero-crossings, lobe-swaps) that want to trigger notes. Both must be first-class.

## Decision

Add a sixth **register-beside-your-code** registry (siblings: `onReset`,
`registerSource`, `registerWindowType`, `registerDesktopFileType`,
`registerWidgetRestorer`): `registerPhysicsSource(name, spec)`, with a user-facing
`physics(name, opts)` factory global. Home: `src/api/signal/physics.js` + one file per sim.

**1. Registry, not bespoke wiring.** Each sim registers its integrator, channels, events,
and optional debug renderer beside its own code. `physics('pendulum', opts)` returns a
handle. One shared tick / normalization-hint / lifecycle / debug-window path serves every
sim. (Considered and rejected: thin per-sim classes with no registry — shapes the
contract around one example; `Source.X` sentinels — fight per-instance opts, since a
frozen singleton token can't carry `{g, damp, length}`.)

**2. Channels are plain callable readers — route untouched.** `p.theta2` is `() => value`,
which `route()` already accepts with **zero new branch**. Metadata (label, hint range)
rides along via `Object.assign(() => v, { label, norm })` — ignored by route today,
readable by a future route branch without a breaking change. Discrete events are named bus
events consumed via `route('event')` / `on('event')`. (Rejected: a physics-channel token +
route branch — nicer Signal-Graph labels and auto-norm, but couples route to physics now;
the `Object.assign` carry keeps that door open at no cost.)

**3. One shared fixed-step clock.** The registry owns a single native-RAF driver (like
route/sensors), gated on the run's paused state, that advances every live sim with a
**fixed internal dt (1/240 s) + substep accumulator + max-substep cap** — so integration
is frame-rate-independent and chaotic sims (double pendulum, Lorenz) stay stable at 30 or
144 fps. Two sim kinds ride the same accumulator: **continuous** sims implement
`step(state, dt)` (substepped); **iterated** maps implement `iterate(state)` at a declared
`rate` Hz (their "dt" is `1/rate`). The logistic map forced this split into v1, before CA /
Game of Life would have forced a rework. (Rejected: frame-coupled variable dt — chaotic
sims blow up on a stutter; per-sim loops — N pause-gates and teardowns, fights the
registry.)

**4. Survive soft reset by identity (like Canvas, ADR 040).** createos soft-resets ~1 s
after every clean parse (auto-exec). A sim keyed by `id` (or opts-signature) **reuses its
live instance** on the next keystroke, so a chaotic trajectory does not snap back to
initial conditions mid-edit — which would destroy the "find the interesting region by eye,
then wire it" workflow. Dropped from the code → torn down a cycle later; hard reset / stop
/ debug-window close → destroyed. Uses the `soft` flag already plumbed through
`onReset((editorId, soft) => …)`.

**5. Sim is an input; the sink or debug window is the output.** The sim core is
run-scoped via `runScoped` (owner-scoped teardown, **no keep-alive**) — exactly like
Camera/mic. What holds the run alive is a downstream output: a route to audio, a shader it
drives, or its debug window (a `runScopedOutput` keep-alive while open, like
`route.show()`). Consequence: a sim that is created but never shown and never routed is
*unobserved* → the idle watcher stops the run within ~300 ms → the sim is torn down. This
is correct (it mirrors a forgotten camera) and is never hit in the prototype-with-debug-viz
workflow, which always has `p.show()` up. (Rejected: sim-is-always-keep-alive — a forgotten
sim zombies the run, the exact orphaned-driver failure the idle watcher exists to prevent.)

**6. Params live-settable; bidirectional modulation falls out free.** Params are set at
construction (`opts`) and live via `p.set(name, val)` (matching the `dp.swing()` live-setter
convention). Because route's **fn-sink already exists**, routing *into* a param needs no new
infra: `route(Source.mic).amplitude.scale(0,1,0,0.2).to(v => p.set('damp', v))` is
bidirectional modulation today. Shipped un-advertised with a stability caveat — feeding a
chaotic sim its *own* channel back is an instability footgun. Live knobs also preserve the
trajectory (no re-create), which decision 4 depends on. (Rejected: immutable
constructor-opts — re-creating to change a knob resets the trajectory and kills live
exploration; params-as-first-class-route-sinks — new sink infra + encourages feedback loops
before the stability envelope is understood.)

**7. Text-only for v1 (BLOCKS_TODO).** Adding a `TOOLKIT_CATEGORIES` entry trips the
ADR-011 coverage gate. Classify the `physics` category **BLOCKS_TODO** in
`blocks-coverage.test.js` and ship text-only; the blocks↔text round-trip survives via the
`js_raw` passthrough (ADR 037), exactly as text-only Strudel does. Blocks come in a later
pass once the 6-sim API has settled — don't build Blockly surface for an unproven API.

## Sim catalog

Ship six in v1, chosen to span signal characters and stress the contract; the rest are
catalogued here as future work (each a `registerPhysicsSource` call when built).

**v1 (implement now):**

| Sim | Channels | Events | Knob | Kind / integrator |
|---|---|---|---|---|
| Double pendulum | θ1, θ2, ω1, ω2, energy | `flip` | damping / g | continuous / RK4 |
| Bouncing ball | height, vy | `bounce`{speed} | restitution e | continuous / semi-impl Euler + collision |
| Kuramoto | R (0..1), ψ | `sync`{crossed} | coupling K | continuous / mean-field Euler |
| Damped harmonic osc | x, v | `zero` | damping | continuous / RK4 — **closed-form, unit-test fixture** |
| Lorenz | x, y, z | `lobe` (wing swap) | ρ | continuous / RK4 |
| Logistic map | x (0..1) | per-step | r (bifurcation) | **iterated** / map at declared rate |

Rationale: pendulum = reference impl (multi-channel + unbounded ω + events +
multi-instance stereo, shapes the contract); ball = pure discrete character + event
payload; Kuramoto = slow-arc + a *pre-normalized* channel + a settable knob previewing
bidirectional; harmonic = closed-form solution so tests assert integrator correctness
without chaotic flakiness; Lorenz = 3-channel attractor; logistic map = forces the
iterated-vs-continuous tick split. Polyrhythm falls out free as N pendulum instances.

**Future catalog:** driven damped pendulum, Rössler / Chua / Duffing / Van der Pol,
billiard (circular / stadium / Sinai), magnetic pendulum, boids/flocking (polarization
order param), spring-mass / cloth, **N-body gravity** (the O(n²) perf/integrator decision,
deferred), elementary CA (rule 30/110), Game of Life, Gray-Scott reaction-diffusion (note:
overlaps shader turf — better as a visual source than a scalar one).

## Consequences

- **Normalization stays in route (v1).** No adaptive auto-scaler is built; channels carry a
  hint range (bounded channels like θ / R / logistic-x are documented, unbounded ones like ω
  / energy / Lorenz-xyz get a documented typical range) and the user normalizes at the route
  with `.norm` / `.scale`. An adaptive route transform is future work.
- **Events dual-emit**, mirroring wm's `window:` + `wm:{id}:` pattern: a sim fires both
  `physics:{name}:{event}` (all instances of a type) and `physics:{id}:{event}` (one
  instance), payload carrying `{id, name, …}`. Registry assigns `index:N` ids when none is
  given, like Camera. So `route('physics:pendulum:flip')` catches every pendulum,
  `route('physics:a:bounce')` catches instance `a`.
- **CLAUDE.md surface tax:** new `window` global → window-globals table entry, `KNOWN_GLOBALS`
  addition, an API descriptor (`params`, **no** `detect` — sims make no sound), a
  `TOOLKIT_CATEGORIES` entry, the BLOCKS_TODO classification, and docs (`docs/physics.md` new;
  `docs/signal-map.md`, `API.md`, `README.md` updated).
- **Perf budget is deferred with N-body.** All six v1 sims are cheap; the O(n²) integrator
  choice (Verlet, body-count cap) is not made until N-body is built.
- **Bidirectional feedback is possible from day one** (fn-sink) but undocumented and
  caveated; a self-feeding chaotic sim is an instability footgun, not a supported pattern yet.
