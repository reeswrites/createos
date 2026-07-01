# ADR 047 — Launchpad widget + MIDI rotation

**Status**: Accepted — implemented (P2)
**Date**: 2026-06-30

> **Implementation note (P2)**: Landed as `src/api/audio/launchpad.js` (`Launchpad`
> class + `audio.launchpad()`), on the ADR-007 widget shell and the ADR-046
> `BindingMap`. Configurable `rows×cols` (default 8×8); unbound cells play a default
> Voice at `baseNote + cellIndex`; a bound chopped Sample Voice plays its per-cell
> slice. Joins the MIDI Target rotation (input only); state serializes into a `.pad`
> desktop icon (`type:'launchpad'`) + `.vljson`. Toolbar ▦ button. 12 tests; 1438
> total green. RGB MIDI-out still deferred.

## Context

The headline of the "map things to" request is a **launchpad soundboard** — a grid of cells
each mapped to a sound or an action. The Piano and Drumpad already exist; the Launchpad is the
new surface that makes the soundboard idea concrete. It sits on the shared **Trigger / Binding
/ Voice** model (ADR 046) — this ADR is only about the *widget* and its *MIDI* story.

A real launchpad is a MIDI controller: pads in, pads light up out. The IDE already has a
focus-routed MIDI binding (ADR 033) that auto-sends incoming MIDI to the last-focused
instrument widget.

## Decision

Add a **Launchpad** Creative Widget (ADR 007 chassis) on the shared Binding/Voice grid.

- **Live soundboard, no step sequencer.** The Launchpad is an expressive live pad surface
  (finger-drum, soundboard, controller). **Rejected: giving it a step sequencer** — that is the
  Drumpad's identity; two widgets with a step grid is duplicated UI/test surface. Live play is
  still capturable as a **Performance/Take** (ADR 031) like any other widget input.
- **Configurable grid (rows × cols), default 8×8.** Matches Novation hardware as the default
  while allowing 4×4, 16×2, etc. Layout + binding state serialize per-widget in `.vljson`.
- **One window-scoped mixer Strip for the whole grid** (ADR 046) — not per-cell.
- **Joins the sticky MIDI Target rotation for *input*** (ADR 033). The Launchpad registers as a
  third instrument widget; a **note→cell map** turns a physical pad/key press into a cell
  strike, reusing the existing `midi-bind` bus tap. No new MIDI-in machinery.
- **RGB MIDI-*out* to the hardware is deferred.** Lighting a physical launchpad's pads to
  mirror bindings/active cells needs a new MIDI-output path + device-specific SysEx protocols
  + SysEx permission. **Rejected for v1** as a niche lift; input-only delivers the soundboard.

The Drumpad, once reworked (ADR 046 voices + configurable pad count + per-step velocity/swing
+ pattern chains), becomes effectively "Launchpad + a sequencer" — both ride the same
Binding/Voice grid chassis, the Drumpad adding the step-sequencer layer. This is intentional:
the shared chassis is what keeps two widgets from duplicating the grid/binding/voice code.

## Consequences

- A third member joins the **MIDI Target** rotation; the sticky last-focused logic (ADR 033)
  already generalizes, but its CONTEXT definition and tests widen from "Piano or Drumpad" to
  include the Launchpad.
- New widget = new blocks coverage (ADR 011), toolkit entries, param hints, a WM window-type
  adapter (serialize/restore), and a desktop-icon restorer.
- A configurable grid means MIDI note→cell mapping must adapt to dimensions (an 8×8 map differs
  from a 4×4); the default 8×8 follows hardware so a real Launchpad maps 1:1.

## Out of scope

- The Binding/Voice/Target/Action data model and the Synth Designer — **ADR 046**.
- RGB feedback / MIDI output to hardware — roadmapped.
- Any step-sequencer behavior on the Launchpad — deliberately the Drumpad's role.
