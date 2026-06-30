# ADR 017 — Actor Model: Event-Driven Runtime for Live Coding

**Status**: Proposed  
**Date**: 2026-06-26

---

## Context

createos has three interaction patterns with no clear rule for when to use which:

1. **Method calls** — `cam.photo()`, `wm.record(id)`, `draw.circle(x,y,r,color)`, `pat('bd*2').fast(2).start()`
2. **Event bus** — `on('beat:tick').do(fn)`, `emit('camera:close', {deviceId})`
3. **UI controls** — titlebar buttons, toolkit drag-and-drop

This mix causes:

- **Interaction pattern confusion** — learners don't know when to call a method vs emit vs use `on()`. No teachable rule.
- **Reactivity gap** — wiring a reactive trigger (`beat:tick`) to a visual change (`shader.setUniform`) requires imperative code inside the handler. No declarative wiring.
- **Blocks generation problem** — Blocks need to know what a capability accepts. Method-call APIs have discoverable signatures; the event bus does not. Neither generates reactive *wiring* blocks (trigger → effect) well.
- **Composability** — stateful objects (Pattern, Pipeline, Shader) can't be addressed from anywhere without holding a reference. Cross-subsystem reactive wiring is verbose.

### Why not pure event-only?

Explored in detail. Breaks on:

- **Stateful objects with identity** (CameraStream, Recording, Shader, Pipeline) — event model requires an ID management layer, shifting complexity rather than removing it.
- **Fluent transform chains** — `pat('bd*2').fast(2).every(4, p => p.rev())` and `pipe(cam).ascii().glshader().show()` contain JS callbacks and ordered compositions that cannot be serialized into event payloads.
- **Deep object graphs** — PIXI/Three.js scene objects (sprite, mesh, material) are referenced by pointer in tight loops; an event layer adds indirection without reducing complexity for the common case.

### Why window-scoping alone is not enough?

Window-scoping (treating each wm window as an actor) solves ~65% of the surface: visual output (draw, shader, camera), widgets (Notepad, Drumpad, Paint), and wm operations. The remaining ~35% is audio/Pattern (no window), PIXI internal objects, and scene graph mutations.

---

## Decision

**Two-phase hybrid model: fluent build → actor activation → event-driven runtime.**

### The Rule (one teachable sentence)

> *Before `.start()` / `.show()`: code. After: events.*

### Phase 1 — Build (code, unchanged)

Fluent chains produce a configured object. No actors, no IDs, no side effects. JS callbacks work freely here.

```js
// Pattern build — arbitrary transforms, JS callbacks OK
pat('bd*2 sd [~ hh]*2')
  .fast(2)
  .every(4, p => p.rev())

// Pipeline build — stage composition
pipe(cam)
  .ascii({ cols: 80 })
  .glshader('rainbow')
```

### Phase 2 — Activation (actor birth)

`.start({id?})` / `.show(title, {id?})` assigns an ID, registers the live object in a module-level registry, fires an activation event, and returns `this` (backward-compatible).

```js
pat('bd*2').fast(2).start({ id: 'groove' });
pipe(cam).ascii().glshader('rainbow').show('Output', { id: 'viz' });

// Auto-assigned if omitted:
pat('bd*2').start();   // id = 'pat-1'
pipe(cam).show('Out'); // id = 'pipe-1'
```

### Phase 3 — Runtime (events in, events out)

Every live actor is addressable by ID via the event bus. No reference-holding needed after activation.

**Control commands (events IN):**
```js
emit('groove:stop');
emit('groove:set-speed', { factor: 0.5 });
emit('viz:stop');
emit('viz-color:set-uniform', { name: 'hue', value: 0.3 }); // stage-level
```

**Notifications (events OUT):**
```js
on('groove:hit').do(({ value, velocity, dur }) => ...);
on('groove:bd').do(() => ...);   // per-value shorthand
on('groove:sd').do(() => ...);
on('viz:frame').do(({ canvas }) => ...);
```

**Cross-actor wiring** — the primary learner payoff:
```js
on('groove:bd').do(() => emit('viz-color:set-uniform', { name: 'flash', value: 1 }));
on('groove:sd').do(() => emit('pixi:set', { id: 'orb', tint: 0xff0066 }));
```

In Blocks: a wire from `groove:bd` to `viz-color:set-uniform`. Visual dataflow with no method calls.

---

## Scope of Changes

### Pipeline (`src/api/visual/render-pipeline.js`)

**Already exists:**
- `p._id = 'pipe-N'` auto-assigned at `pipe()`
- `notify('pipe:create', { id })` on creation
- `registerCommand('pipe:destroy', ...)` — emit-addressable today

**Needed:**
- Stage-level IDs: `ascii(opts, id?)` stores `stage._id = id ?? \`${this._id}-ascii-N\``
- `_stageRegistry` map: `stageId → stage instance`
- Control commands: `pipe:stop`, `pipe:start`, `pipe:stage:set`, `pipe:stage:set-uniform`
- Notifications: `pipe-id:frame` per RAF tick (optional, high-frequency gate needed)

### Pattern (`src/api/audio/audio.js`)

**Needed:**
- `_patternRegistry` map: `patId → Pattern instance`
- `start({ id?, inst? })` — backward-compatible; string arg still treated as `inst`
- Per-hit events in `_firePat`: `notify(\`${patId}:hit\`, {value, note, velocity, dur})` and `notify(\`${patId}:${value}\`, ...)`
- Upgrade global `audio:note-play` to include `patId`
- Control commands: `pattern:stop`, `pattern:start`, `pattern:set-speed`, `pattern:mute`
- Cleanup: `cleanupAudio()` already clears Tone.Loop; add `_patternRegistry.clear()`

### PIXI (`src/api/visual/pixi.js`) — deferred, see below

### Window actors — already done

`wm.spawn()` returns an ID. All wm control (`wm.show`, `wm.hide`, `wm.record`) is ID-based. Scoped events (`wm:{winId}:note:*`, `wm:{winId}:stroke`) already exist (ADR 014). Window-as-actor is complete.

---

## Deferred Decisions

These were analyzed but explicitly NOT decided. Record here so future revisits start from this analysis, not from scratch.

### D1 — PIXI named objects

**Proposal analyzed:** `emit('pixi:sprite', {id:'hero', texture:'player'})` creates a named actor; `emit('pixi:set', {id:'hero', x:400})` mutates it. Scene graph = actor hierarchy.

**Why deferred:** Viable for simple cases (static set of named sprites). Breaks on dynamic collections (100 enemies in a loop need per-instance IDs or a group primitive with limited transform support). PIXI filters are complex objects with no clean event serialization. Implementation scope is larger than Pipeline + Pattern combined.

**Revisit when:** learner friction with `Stage.addChild(sprite)` + reference-holding is validated as a real pain point. Or when blocks need to generate PIXI scene construction.

### D2 — Declarative Pattern DSL for blocks

**Proposal analyzed:** `emit('audio:pattern', {id:'drums', src:'bd*2', transforms:[{type:'fast',factor:2},{type:'every',n:4,op:'rev'}]})` — named transforms only, no JS callbacks.

**Why deferred:** Covers ~80% of learner usage (simple patterns without callbacks). Drops `.every(4, p => customFn(p))` and any other callback-based transform. Creates a two-tier system (declarative path / code path) that complicates docs. Blocks can already generate `pat('bd*2').start({id:'drums'})` — good enough for the learner creation story.

**Revisit when:** blocks mode users hit the pattern creation wall and need something other than "type the mini-notation string into a field."

### D3 — Cross-actor binding syntax

**Proposal analyzed:** `on('groove:bd').bind('viz-color:set-uniform', {name:'flash', value:1})` as sugar for `.do(() => emit(...))`.

**Why deferred:** Low priority — `.do(() => emit(...))` is readable and generates cleanly in blocks. Binding syntax adds a new concept for minimal DX gain.

**Revisit when:** the pattern `on(X).do(() => emit(Y, params))` appears frequently enough that sugar is warranted.

### D4 — Pure event-only for simple singletons

**Proposal analyzed:** `draw.circle(400,300,50,'cyan')` → `emit('draw:circle', {x:400,y:300,r:50,color:'cyan'})`. Make all singleton methods commandable (dual-mode).

**Why deferred:** Draw transform stack (`push/pop/translate/rotate`) is order-sensitive and stateful — commandable events would process in order (synchronous emit) but the ergonomics are worse than method calls. `draw.circle` is already learnable; the pain is reactive wiring, not the method call itself.

**Revisit when:** blocks need to generate draw calls that react to events, and `on('beat:tick').do(() => draw.circle(...))` proves insufficient.

### D5 — Audio windows

**Proposal analyzed:** Each Pattern gets a "window" UI actor — visual sequencer showing what's playing. Window ID = pattern ID.

**Why deferred:** Significant UI work. Patterns are already reactive (they emit events). The visual story is better served by connecting pattern events to existing visual windows (PIXI, shader) than by adding a pattern-specific window.

**Revisit when:** learners want to SEE the pattern playing, not just hear it.

### D6 — Event schemas / payload registry

**Proposal analyzed:** Declare event payload shapes in `system-events.js` so blocks auto-generate from schema rather than hand-coded entries in `completions.js`.

**Why deferred:** The ADR 011 blocks-coverage gate + `TOOLKIT_CATEGORIES` in `completions.js` works today. Schema registry is a bigger refactor.

**Revisit when:** the manual `completions.js` maintenance burden becomes the bottleneck for adding new APIs.

### D7 — Stage-level notifications (high-frequency events)

**Proposal analyzed:** `pipe-1-ascii-0:cell` fires per ASCII cell per frame — potentially 80×32 = 2560 events/frame.

**Why deferred:** High-frequency events need a sampling/gate mechanism. Naive implementation would destroy performance.

**Revisit when:** there's a concrete use case (e.g., "react to a specific cell changing") that justifies the complexity.

---

## Consequences

**No breaking changes.** Fluent build chains unchanged. `start()` with no args still works. `audio:note-play` gets `patId` added (additive). `pipe:destroy` already works.

**New capabilities:**
- Named actors addressable from anywhere after activation
- Reactive wiring between subsystems: `on('groove:bd').do(() => emit('shader:set-uniform', ...))`
- Blocks can generate control + reaction blocks even for complex subsystems whose creation stays code-only
- `audio:note-play` payload richer (includes `patId`)

**New namespaces:**
- `pat-id:hit` / `pat-id:value` — per-pattern per-value events
- `pipe-id:frame` — per-pipeline frame tick (gated)
- `stage-id:*` — stage-level control commands

**Implementation size**: ~100 lines across `audio.js` + `render-pipeline.js`. No new files needed. Tests: extend existing `event-bus.test.js` + new `actor-registry.test.js`.

---

## Implementation Plan

### Phase A — Pipeline actors (~50 lines, `render-pipeline.js`)

1. Add `_stageRegistry` module-level Map
2. Add optional `id` param to all stage chain methods; store `stage._id`
3. Add `registerCommand` calls: `pipe:stop`, `pipe:start`, `pipe:stage:set`, `pipe:stage:set-uniform`
4. Cleanup: `cleanupPipelines()` also clears `_stageRegistry`
5. Update `show({id?})` to use caller-supplied id or auto-assign

### Phase B — Pattern actors (~50 lines, `audio.js`)

1. Add `_patternRegistry` module-level Map + `_patIdCounter`
2. Modify `Pattern.start({ id?, inst? } = {})` — assign `this._id`, register in map
3. Add `notify(\`${id}:hit\`, ...)` and `notify(\`${id}:${value}\`, ...)` in `_firePat`
4. Upgrade `audio:note-play` to include `patId`
5. Add `registerCommand` calls: `pattern:stop`, `pattern:start`, `pattern:set-speed`, `pattern:mute`
6. Cleanup: `cleanupAudio()` clears `_patternRegistry`

### Phase C — Documentation + tests

1. Update `API.md` — actor activation section, new event namespaces
2. Update `docs/audio.md` + `docs/control.md` — `start({id})` pattern
3. New `tests/actor-registry.test.js` — pattern registry, pipeline registry, scoped events
4. Update `src/editor/completions.js` — actor control entries in toolkit

### Phase D — PIXI actors (deferred, not in this ADR)

Tracked in D1 above. Revisit separately.
