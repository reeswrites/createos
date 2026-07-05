# ADR 056 — Trigger Surface chassis (shared Piano/Drumpad/Launchpad wiring)

**Status**: Implemented
**Date**: 2026-07-04

> **Implementation note**: New composition helper `src/api/audio/trigger-surface.js` — `initTriggerSurface(self, { registry, bindings })`, `enableSurfaceMidi(self)`, `detachTriggerSurface(self, registry)`, `disposeTriggerSurface(self)`. Piano/Drumpad/Launchpad call these instead of hand-rolling the output bus, BindingMap voice router, Take, MIDI register/notify, and mirror-image teardown. Also: the `</>` Snapshot emitters now reuse `_perfCtor().code` for the constructor line (was drifting from the escaped Performance emitter — an apostrophe-title bug).

## Context

ADR 046 shared the **Binding** and **Voice** model (`BindingMap`, `Voice`) and ADR 047
added the Launchpad on top of it — but the wiring **around** the binding store was still
copy-pasted three ways across Piano, Drumpad, and Launchpad:

- output bus `this._out = new Tone.Gain()` summed into one window-scoped mixer **Strip**
  (ADR 032), with `this._strip` released in `_destroy`;
- `new BindingMap({ onVoice: (h) => h.output.connect(this._out) })` + `restore(bindings)`
  — byte-identical router;
- MIDI `registerMidiInstrument(this)` / `notifyMidiFocus(this)` on spawn,
  `unregisterMidiInstrument(this)` on destroy (ADR 033);
- the Performance `Take` (ADR 031);
- the module registry array + `indexOf/splice` teardown;
- the mirror-image `_destroy` tail (`_bindings.dispose` → `releaseStrip` → `_out.dispose`),
  identical across all three.

~150 lines of identical lifecycle boilerplate. The strike path itself is genuinely
per-surface (piano's attack/release split, drumpad's kit-voice fallback, launchpad's
chopped-sample slice) — that is *not* shared and stays in each widget.

A second, live bug rode along: each surface emitted its constructor signature **twice** —
in the `</>` Snapshot button and in `_perfCtor()` — and the copies had drifted. The
Performance emitter escaped apostrophes; the Snapshot emitter did not, so a widget titled
`Rees's Pad` produced syntactically broken Snapshot code.

## Decision

Extract the shared chassis as **composition helpers** (ADR 007 discipline — not a base
class; the three surfaces are large existing classes with distinct UIs and synth
ownership). `src/api/audio/trigger-surface.js`:

- `initTriggerSurface(self, { registry, bindings })` — install `_out`, `_strip` (null),
  `_bindings` (with the voice→bus router), `_events`, `_take`; enroll in `registry`.
  Called early in the constructor (Piano needs `_out` before it builds its preset synth;
  Drumpad before it reroutes its kit voices).
- `enableSurfaceMidi(self)` — register + claim MIDI focus once `_winId` exists.
- `detachTriggerSurface(self, registry)` — unregister MIDI + splice from `registry`;
  called first in `_destroy`.
- `disposeTriggerSurface(self)` — dispose default handle, BindingMap, Strip, `_out`;
  called last in `_destroy`, after the surface disposes its own synth/voices.

The per-surface strike path, key resolution, UI, and synth/voice ownership stay in each
widget — the parts that actually differ.

Separately, the `</>` Snapshot emitter now reuses `this._perfCtor().code` for the
constructor line, appending only the declarative body — one escaped source of truth.

## Consequences

- **Locality**: strip/BindingMap/MIDI/Take/teardown bugs fix once. A fourth Trigger
  Surface supplies only its strike path + key resolution + UI.
- **Leverage**: one chassis, three surfaces; ~150 lines of boilerplate deleted.
- Snapshot and Performance can no longer drift; the apostrophe-title bug is gone.
- **Test surface**: the surface unit tests (piano/drumpad/launchpad) exercise the chassis
  transitively through construct/strike/destroy; `tests/unit/api/audio/trigger-surface.test.js`
  covers the helpers directly against a fake `self`.

## Alternatives considered

- **A `TriggerSurface` base class.** Rejected: the three are large classes with their own
  window shells, and ADR 007 already chose composition over inheritance for the Creative
  Widget chassis. Helpers that mutate `self` keep each surface a plain class.
- **Fold the strike path into the chassis too.** Rejected: the strike path is the one part
  that genuinely differs per surface (attack/release vs one-shot vs chopped slice);
  sharing it would force a lowest-common-denominator template with per-surface branches —
  more coupling, not less.
