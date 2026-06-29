# ADR 035 — Strudel replaces the in-house pattern engine

**Status:** Accepted (implementation pending)
**Date:** 2026-06-28
**Relates to:** ADR 032 (live mixer console), ADR 008 (reset handler registry), ADR 011 (blocks coverage gate), ADR 036 (AGPL adoption), ADR 037 (blocks round-trip / raw-JS passthrough)

## Context

`src/api/audio.js` carried a ~250-line in-house mini-notation parser and `Pattern` class
("Deep Strudel") — *inspired by* Strudel/TidalCycles but **not** compatible with real
strudel.cc scripts. Every gap (pattern-rate effects, proper polymeter, `perlin`/`rand` as
pattern signals, the full transform library) was a permanent support burden or a denied
feature. The guiding principle of this change: **own as little as possible** — offload the
pattern engine to the upstream Strudel community, whose roadmap and docs then cost us nothing.

We adopt `@strudel/core`, `@strudel/mini`, `@strudel/tonal`, `@strudel/webaudio` (the latter
pulling in `superdough`, Strudel's WebAudio synth/sample engine) and delete the in-house
`Pattern` class, mini-notation parser, and the `pat()`/`pattern()`/`stack()`/`Pattern`
globals. Tone.js **stays** as the imperative/linear audio layer and the master clock.

The integration was designed against superdough 1.3.0's actual exported surface (verified by
reading `dist/index.mjs`), so **every seam touches public exports — no library internals are
patched anywhere**. This is what keeps the upstream-maintenance benefit real.

## Decisions

### 1. Strudel patterns sound through superdough, not Tone — so a pattern becomes a source

The in-house pattern *triggered a Tone `Instrument`*; the Instrument was the **Audio Source**
and the pattern showed as a sub-row under its strip (ADR 032). Real Strudel has no Tone
Instrument behind it — it sounds through superdough's own samples/synths. So that model is
dead: a Strudel pattern is now a self-contained source. CONTEXT.md's **Audio Source** and new
**Strudel Pattern** glossary entries record the shift.

### 2. No global transpiler — explicit calls only

Strudel.cc's transpiler rewrites *every double-quoted string* into `mini(...)`. That is a
wrecking ball in a polyglot JS IDE (`draw.text("hi")` → `draw.text(mini("hi"))`) and would
be a second AST transform fighting `live-patch.js`, shifting the line numbers the Execution
Trail depends on (ADR 019). We **drop the transpiler entirely**. Strudel is invoked as plain
JS function calls — `note("c e g")`, `s("bd hh")`, `seq(...)` — preserving the single
injected-`<script>` execution model (ADR 003). The only thing lost is bare strudel.cc
copy-paste of string-method sugar (`"c e g".fast(2)`); full paste-compat, if ever wanted,
goes in a *separate isolated pattern editor*, never over general editors.

### 3. Shared tempo, stock scheduler — Tone is master

Strudel's `Cyclist` scheduler is left **stock** (replacing it would mean owning a fragile
patch against library internals on every upgrade — the exact thing this change avoids). The
two engines are tied only by **tempo** over **one shared AudioContext**: at first audio-start
we put both on `Tone.getContext().rawContext` via the public `Tone.setContext` +
`superdough.setAudioContext`, and bridge `setcps(n) ⇄ Tone.Transport.bpm = n*60`, starting and
stopping both transports together. Phase-drift of a few ms is acceptable for a creative IDE;
sample-accurate cross-engine phase-lock is explicitly **not** a goal.

### 4. One "Strudel" mixer strip now; per-orbit deferred upstream

superdough exposes a single stable master node — `getSuperdoughAudioController().output
.destinationGain` — which we reroute off `ctx.destination` into one dedicated **Strudel**
strip via the mixer's existing `Strip.connectFrom(node)`. Per-orbit strips would require
poking `controller.nodes[orbit]` (undocumented, lazily-created duck-target internals) — the
fragile-patch trap again — so per-orbit is **deferred to an upstream superdough feature
request** to expose orbit outputs, then lands as an additive fast-follow with no data loss.

### 5. Run-scoped like all audio

`cleanupAudio()` (registered via `onReset`, ADR 008) gains a Strudel `hush()` so patterns
are silenced on every reset, exactly as Tone patterns + Transport are today. `cleanupAudio`
already tears down globally (ignores `editorId`), so "any editor reset hushes all Strudel" is
consistent with existing audio behaviour, not a regression.

### 6. Samples are bring-your-own; `note()` is the front door

We bundle **no** default sample kit. `s("bd hh")` is silent until the user calls `samples(...)`.
The documented entry point and every shipped toolkit/demo snippet therefore leads with the
**`note(...)` synth path** (zero samples, works first-run offline); `s(...)` examples must
carry their own `samples(...)` line. This keeps the deploy lean against an already-heavy
bundle (pixi + three + tone + mediapipe), at the cost of `s(...)` not working out of the box.

## Consequences

- **AGPL.** `@strudel/*` is AGPL-3.0; bundling it makes createos AGPL — see ADR 036.
- **Blocks.** Strudel is `TEXT_ONLY_INTENTIONAL` under the ADR 011 gate; the text↔blocks
  data-loss hole is closed by a raw-JS passthrough block — see ADR 037.
- **Vite.** superdough runs an AudioWorklet (`dspWorklet`/`loadWorklets` exports); Vite needs
  worklet serving sorted (also unblocks a future Elementary Audio effort).
- **Out of scope.** Elementary Audio (the handoff's Phase 2) is **cut** from this change and
  deferred to its own future ADR; this effort is Strudel-only.

## Considered Options

- **Keep extending the in-house parser** — rejected: permanent feature-lag and support burden,
  the problem this change exists to end.
- **Strudel as master clock** — rejected: translating Tone's bars/beats into cycle fractions
  is lossy and continuous; `cps→bpm` is trivial and lossless, and half the user base is
  imperative/DAW-minded.
- **Replace Strudel's scheduler / intercept per-orbit internals / run the transpiler globally**
  — all rejected for the same reason: each owns a fragile patch against library internals or a
  second execution model, defeating the maintenance-offload rationale.
