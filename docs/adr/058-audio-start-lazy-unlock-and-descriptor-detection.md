# ADR 058 — Audio-start: lazy gesture-unlock + descriptor-driven detection

**Status**: Implemented
**Date**: 2026-07-07
**Supersedes**: the audio half of ADR 012 (audio detection moves from the central
`API_PATTERNS` table onto the API Descriptor)

> **Implementation**
> - **Step 1 — lazy gesture-unlock: DONE.** New leaf `src/api/audio/audio-unlock.js`
>   → idempotent `ensureAudioUnlocked()` (resume-now + arm a one-time capture-phase
>   `pointerdown`/`keydown`/`touchstart` document listener), called at the top of
>   `acquireStrip()` (`mixer.js`). Defensive try/catch → safe no-op under headless/tests.
> - **Step 2 — descriptor-driven detection: DONE.** The 16 audio builtins carry
>   `detect: { effect: 'audio' }` (`note` also `triggers: ['\\.play\\s*\\(\\s*\\)']`);
>   `deriveAudioDetectPattern()` (`api-registry.js`) builds the regex from the registry
>   and `register-builtins.js` injects it via `setAudioDetectPattern()` (`api-detector.js`)
>   at boot. `s`/`n` stay undeclared (single-letter name → false positives; they surface
>   via `.play()`). Static `API_PATTERNS.usesAudio` remains the no-boot fallback.
> - **Step 3 — delete dead detection: DONE.** `api-detector.js` is audio-only: the 14
>   visual `API_PATTERNS`, the `shaderStartCalled`/`shaderConstructedOnly` AST checks,
>   the esprima parse, and `parseError` are gone. Several deleted flags
>   (`usesSensors`/`usesDraw`/`usesLayer`/`usesGetCanvas`) were doubly dead — they
>   detected globals already removed by ADR 014 / ADR 040.
> - **Step 4 — docs: DONE.** CONTEXT.md "API Descriptor" corrected (no `'canvas'` effect;
>   audio detection is registry-derived). `+10` tests (1512 green).
>
> **Browser-verified** (2026-07-07, Chrome via devtools). (a) A Run-*click* on
> `new Piano()` → `AudioContext.state === 'running'` in-gesture (startAudio pre-warm,
> now that `usesAudio` catches Piano) + audio chip shown. (b) Lazy net: with the
> context force-suspended, constructing a Piano synchronously arms the three
> capture-phase gesture listeners (`pointerdown`/`keydown`/`touchstart`). The
> "stays-suspended-until-gesture" *state* is not observable under CDP (automation
> grants sticky user-activation, so `resume()` always succeeds) — the arming is the
> observable proxy. Detection confirmed for Piano/Launchpad/Drumpad/openSynthDesigner/
> midi/`.play()`.
>
> **Verify found+fixed a bug**: `Voice` is a namespace *object* (`typeof 'object'`),
> used via static methods (`Voice.make`/`define`/`design`), so the capitalised-name
> heuristic's `\bnew Voice\b`-only trigger both used an invalid form and missed real
> usage. `deriveAudioDetectPattern` now emits `\bnew Name\b|\bName\s*\.` for
> capitalised names — covering constructors AND namespace objects.

## Context

Audio only sounds if the Tone `AudioContext` has been resumed inside a user gesture
(browser autoplay policy). Today that resume is driven entirely by **code detection**:
`startRun()` (`src/runtime/run.js`) runs `detectAPIUsage(code)`, and *only* when the
`usesAudio` regex fires does it call `startAudio()` (→ `Tone.start()`) and gate the user
code behind `await window.__ar_audioReady`.

Two holes fall out of that:

1. **The detector misses instruments.** The `usesAudio` regex (`api-detector.js`) matches
   `audio.`, `note(`, `sound(`, `.play()`, `new Drumpad` — but **not** `new Piano`,
   `new Voice`, `new Launchpad`, `openSynthDesigner`, or `midi.`. Those construct a
   suspended context and produce silent keys. Every new audio API must remember to add
   itself to a hand-maintained regex or it is silent by default.

2. **Detection can't unlock a non-gesture run.** Auto-execute fires on a debounce, which
   is not a user gesture — so even when `usesAudio` fires there, `Tone.start()` resolves
   but leaves the context suspended. Detection is the wrong instrument for the job:
   knowing audio *will* happen doesn't grant permission to start it.

Separately, `detectAPIUsage`'s result is almost entirely dead. **`run.js` is its only
consumer and reads only `hints.usesAudio`.** The 14 visual flags (`usesShader` …
`usesThree`) plus the `shaderStartCalled` / `shaderConstructedOnly` AST checks are
computed and consumed by nothing — they drove the auto-opened output window, which
**ADR 040 deleted**. They survive only because the ADR-012 coherence gate asserts they
exist. CONTEXT.md's API-Descriptor entry compounds this: it claims detection *already*
derives from the registry and that `effect:'canvas'` drives an output window — both false.

## Decision

Split the concern into a **correctness guarantee** (lazy unlock) and a demoted **UX
optimization** (detection), and delete the dead detection.

**1. Lazy gesture-unlock — the guarantee.** New leaf `src/api/audio/audio-unlock.js`
exports idempotent `ensureAudioUnlocked()`: if the Tone context is suspended, call
`Tone.start()`, *and* arm a one-time capture-phase `document` listener
(`pointerdown`/`keydown`/`touchstart`) that resumes once then self-removes. Call it at the
top of `acquireStrip()` (`mixer.js`) — the ADR-032 tail that **100% of sound-makers**
(every `Instrument`, every Trigger Surface via `connectSurfaceStrip`, Strudel, mic) route
through by construction. A strip acquired inside a gesture stack (Run click) resumes
immediately; one acquired under auto-exec arms the listener so the next click/key — the
piano key itself — unlocks. Silence becomes topologically impossible, independent of
detection.

**2. Descriptor-driven detection — demoted to UX.** Detection now only decides whether to
pre-warm audio (so the first note on a gesture-driven run has no suspended-context glitch)
and show the taskbar audio chip. It moves onto the API Descriptor: the audio builtins
carry `detect: { effect: 'audio', triggers? }` at `_registerBuiltin`, and boot computes
the `usesAudio` trigger regex from the registry and injects it into `api-detector.js` via a
setter (the same seam PARAM_HINTS uses to derive from descriptors). A new audio API is
covered the moment it declares its effect — no central-table edit. The `await audioReady`
gate stays, now fed by the registry-derived flag. Because lazy-unlock owns correctness, a
detection miss degrades to "chip appears one strip late," never "keys are silent."

**3. Delete the dead detection.** Remove the 14 visual `API_PATTERNS` entries and the
`shaderStartCalled` / `shaderConstructedOnly` AST checks; `api-detector.js` becomes
audio-only. Rewrite the ADR-012 coherence gate to assert the audio-effect builtins are
detection-coherent (coherent by construction, per the descriptor). Correct CONTEXT.md:
drop the stale `effect:'canvas'`→output-window clause and state that audio detection is
genuinely registry-derived.

## Considered Options

- **Regex patch only** (add the missing instrument constructors to `usesAudio`). Cheapest,
  but leaves the autoplay-gesture hole (auto-exec still silent) and keeps the hand-list a
  future API must remember. Rejected: doesn't make silence *impossible*.
- **Descriptor detect only, no lazy unlock.** Cleaner detection, still execute-time, still
  can't unlock a non-gesture run. Rejected for the same hole.
- **Full descriptor migration of all 14 visual patterns.** Realizes CONTEXT.md's original
  vision, but migrates provably-dead detection — churn with no consumer. Rejected in favor
  of deleting it: greenfield, with ADR 040 already true, those detections would never exist.
- **Unlock at each trigger chokepoint** (`strikeCore`, `Instrument` trigger, Strudel
  `.play`, Voice) instead of at `acquireStrip`. More precise but multiple touch-points a
  future instrument can miss. Rejected: `acquireStrip` is the single topological tail, so
  one hook can't be missed.

## Consequences

- `ensureAudioUnlocked()` may resume an `AudioContext` for a run that acquires a strip but
  never sounds. Harmless (a suspended→running context with no active nodes is silent and
  near-free; Tone creates the context at import regardless).
- ADR 012's "detection is a central table, deliberately NOT registry-derived" no longer
  holds for the audio effect. The gate remains, but as a by-construction coherence check
  rather than a hand-maintained sample table.
- `api-detector.js` and its unit test shrink substantially; the only behavioral flag left
  is `usesAudio`.
