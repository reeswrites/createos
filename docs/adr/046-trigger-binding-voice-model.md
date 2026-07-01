# ADR 046 — Trigger / Binding / Voice / Target model

**Status**: Accepted — P1 implemented
**Date**: 2026-06-30

> **Implementation note (P1)**: Landed as `src/api/audio/voice.js` (registry +
> `instantiateVoice` + Synth & Sample voices), `src/api/audio/synth-designer.js`
> (no-code panel), and `src/api/audio/binding.js` (`BindingMap`). First consumer:
> the **Drumpad** (`dp.bind`/`bindAction`/`unbind`), bindings serialized inline into
> its `.beat` state. Sample Voices implemented (chromatic `Tone.Sampler`, chopped
> `Tone.Player` slices, `GrainPlayer` for `preserveLength`), loading from a `url` or
> an IDB `blobKey` via `desktop.getBlob`. **P2** added the Launchpad (ADR 047). **P3**
> retrofitted the **Piano** (`p.bind`/`p.bindAction`/`p.unbind` per note + `p.voice`
> default; live play only — the step sequencer keeps the preset) and reworked the
> **Drumpad groovebox** (per-step velocity/accent, global swing, configurable
> `steps`/`pads`). **P4** added the **Faust Voice** engine (`kind:'faust'`,
> `src/api/audio/faust.js`): Faust DSP → WASM AudioWorklet via `@grame/faustwasm`
> for true physical modelling, lazy-loaded (assets served by the `faust-assets`
> Vite plugin, no git binaries), with `Voice.faust(name, code)` + built-in
> physmodels presets. Faust unit tests mock the compiler (WASM can't run in jsdom);
> **browser audio verification of the presets is owed.** Deferred: Drumpad
> pattern-chains + pad count >8, and a dedicated Faust editor panel (P4c). 1462
> tests green.

## Context

The instrument widgets (Piano, Drumpad) hardcode their sound: Piano picks one of three
PolySynth presets across all keys; Drumpad fixes 8 Tone voices (kick/snare/…). There is no
way for a user to **design their own sound**, to **reuse** a sound across widgets, or to
**map a key/pad to anything other than its built-in note**. Three feature requests collapse
into one gap: "design your own synths", "chop/pitch a sample into playable pads", and "map
things to keys / a launchpad soundboard you can map things to". All three are the same
missing primitive — a reusable, user-authored **sound or action** that any trigger surface
can be pointed at.

A new **Launchpad** widget (ADR 047) lands on top of this, so the data model must be shared,
not Piano- or Drumpad-specific.

## Decision

Introduce a shared vocabulary, owned by no single widget:

- **Trigger** — one input slot (a piano key, a drum pad, a launchpad cell).
- **Binding** — maps one Trigger → one **Target**.
- **Target** — polymorphic: a **Voice** (make sound), an **Action** (fire a named bus
  event), or both.
- **Voice** — a named, reusable, **declarative** sound generator. A **Synth Voice** is a
  `{synth:{type,opts}, effects:[…]}` descriptor over Tone's engines (the exact shape
  `_buildSynth` in `piano.js` already consumes); a **Sample Voice** is a chopped/pitched
  buffer. Authored no-code via the **Synth Designer** param panel; `Voice.define(name, …)`
  is the power-user door to the same registry.

Specific choices and their trade-offs:

- **Voices are declarative data, instantiated per-trigger — not live nodes.** A Voice is a
  serializable descriptor; the surface builds the Tone node lazily on first strike. Chosen so
  a Voice can be embedded, copied, and serialized freely.
- **Bindings inline-embed their Voice; they do not reference the library by name.** A binding
  carries the full Voice descriptor (Sample Voices carry a `blobKey` into the IDB capture
  store, ADR 016, never the raw buffer). **Rejected: reference-by-name into `library.js`** —
  that library is localStorage-only and does *not* travel in `.vljson` by design, so a shared
  project would silently lose its custom voices on the receiver. **Rejected: bundling the
  library into `.vljson`** — couples the project format to the library and reverses the
  localStorage-only rule. Inline-embed makes a project self-contained; the library becomes a
  convenience drawer to copy *from*, not a dependency.
- **One mixer Strip per surface, lazy pooled voices.** The whole widget (Piano/Drumpad/
  Launchpad) is **one** window-scoped Strip (ADR 032), and Voice nodes are built on first
  strike and pooled, disposed with the window. **Rejected: one Strip per Voice** — a 64-cell
  Launchpad would flood the console and eager-build 64 PolySynths. (A future "strip per
  *distinct bound* Voice" is possible but not the default.)
- **An Action is a named bus event and nothing more.** Every Trigger already emits a built-in
  strike event (Piano `onKey`, Drumpad `onHit`, ADR 013). An Action binding only lets the
  user *name* that event per-cell and optionally mark the cell **silent**. **Rejected: an
  inline-`eval` code cell** — a new execution surface with unclear IIFE scope, lifecycle, and
  blocks story; the bus already does this with no new machinery.
- **Synth authoring = a param panel over Tone, not a modular patch graph.** The Synth Designer
  edits the `desc` object. **Rejected (for now): a modular node-graph patcher** — a whole new
  UI paradigm + audio-graph compiler + serialization, fighting the blocks round-trip (ADR 037);
  it is its own product. **Deferred: a Faust Voice** (true physical modeling via
  `physmodels.lib` compiled to WASM) as a *second* engine behind the same Voice registry, the
  way superdough sits beside Tone (ADR 035).
- **Per-surface default Voice + per-Trigger overrides.** A surface may have one default Voice
  covering every Trigger (the Piano's chromatic timbre) with overrides layered on top — so one
  key can be rebound to a sample one-shot or an Action while the rest stay chromatic.

## Consequences

- The widget **Snapshot** code-export (CONTEXT) changes: Piano/Drumpad must now emit their
  bindings + inline voices, not just `p.note(...)` / `dp.pattern(...)`.
- New API surface (`Voice`, binding setters, the Synth Designer) needs blocks coverage
  (ADR 011), `TOOLKIT_CATEGORIES` entries, and param-hint descriptors.
- Inline-embed means the same Voice can exist in many copies across a project — edits to a
  library Voice do not propagate to already-placed bindings. Accepted: portability over DRY.
- Sample Voice buffers ride in IDB, not `.vljson`, so a project file shared without its IDB
  blobs loses sample audio (same limitation as captured media, ADR 016).

## Out of scope

- The Launchpad widget and MIDI rotation — **ADR 047**.
- The Faust physical-modeling engine — roadmapped, no ADR yet.
- A drag-to-edit waveform with manual slice points — roadmapped.
