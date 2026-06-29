# ADR 039 — In-browser ML speech-to-text + `route()` transcription

**Status:** Accepted
**Date:** 2026-06-29
**Relates to:** ADR 023 (refcounted media leases), ADR 025 (cross-domain signal chain / `route()`), ADR 024 (Text Layer / `wm.addText`)

## Context

`audio.onWord` / `onSpeech` wrap the browser **Web Speech API** (`webkitSpeechRecognition`).
Two hard limits: it only accepts the microphone (cannot transcribe a `<video>`, screen-share, or
synthesised audio), and it is absent in Brave and some Firefox builds. We want transcription that
works on **any audio-bearing `MediaStream`, in any browser, with no server** — driving the bus the
same way the rest of the IDE does, so the existing `route()` chain can consume it.

Most of the surface the original handoff proposed already exists: `route()` and `Source` (ADR 025,
fully lifecycle-managed), `wm.addText` (ADR 024, with `decay`), and the `audio:word:interim` /
`audio:word:final` bus events (emitted today by the Web Speech path). The genuinely new piece is an
ML transcription engine that emits those events from an arbitrary stream, plus model management.

## Decisions

### 1. Extend the existing `route()`, do not build a parallel one

The new capability is added to `src/api/route.js` and the existing `Source`. No `src/route/`
directory, no second `window.route`. This keeps one keep-alive / owner-tag / reset story (ADR 008/009)
and means the canonical karaoke snippet — `route(Source.camera).tap('audio:word:interim', fn).show()`
— already wires its listener through the existing `.tap()`/`.show()`; only the engine that *fires*
those events is new.

### 2. ML transcription is a shared, refcounted **STT Engine** per audio source

One engine + one model per distinct audio input, reference-counted (mirrors `CameraSource`, ADR 023).
Many consumers listening for words on the same microphone share a single inference loop and fan out
over the bus. Running wav2vec2 once per consumer would duplicate a 94 MB model and the CPU/GPU loop
for identical audio. The engine is **run-scoped + keep-alive** (a live process, like a route/pipeline):
reset or window-close stops the tap, releases the mic lease, and closes its AudioContext. The
**downloaded model survives reset** (cached in the Model Manager singleton, like gaze calibration).

### 3. Source-agnostic audio, with camera → mic fallback

The engine taps whatever **audio track** the fed stream carries (mic, media element, screen audio).
`Source.camera` is `video:`-only by deliberate design (the shared camera lease must not prompt for
mic or fight echo cancellation), so a **camera route with no audio of its own draws audio from
`window.__ar_mic_stream`** — you speak while your face is on screen. This is the surprising bit worth
recording: a *camera* route transcribes the *microphone*.

### 4. Auto-start via the existing `registerSource`, not route-side logic

`audio.js` already registers a lazy speech *source* (`registerSource(e => e.startsWith('audio:word') …)`)
so that **subscribing** to `audio:word:*` starts recognition. We extend that predicate to include
`audio:transcript` and route its `start` through engine selection (Web Speech vs ML, decision 6). So
the trigger is simply: tapping `audio:word:interim|final|transcript` *subscribes*, which the source
machinery turns into an engine start — and unsubscribing (route destroy / reset via `clearRunScoped`)
drives the subscriber count to zero and stops it. Route does **not** acquire the engine itself; doing
so would double-start (Web Speech *and* ML) on Chrome. This is what lets the acceptance-test snippet
work verbatim with nothing but a `.tap()`.

Consequence: `.tap()`'s frame-source assertion is relaxed for STT events so a **mic-only** route
(`route(Source.mic).tap('audio:word:interim')`, no visible window) also works — it subscribes
immediately (no `.show()` to wait for), and the engine's keep-alive holds the run alive without a window.

### 5. CTC primary, Whisper final-only

The primary backend is a **CTC** model (`Xenova/wav2vec2-base-960h`) — per-frame probabilities make
rolling-window interim transcription natural. Whisper (`onnx-community/whisper-tiny.en`) is wired but
**final-only**: as an encoder-decoder it needs the whole utterance before decoding, so it cannot emit
meaningful partials — suitable for transcribing completed/recorded audio, not karaoke. A **Word Differ**
turns each chunk's full-transcript guess into interim→final word events (committed prefix + stabilising
frontier).

### 6. Web Speech left in place; ML as fallback + Chrome opt-in

`audio.onWord` / `onSpeech` are **not** refactored into a backend — they work, are mic-only keyword
matching, and emit the same bus events. On Chrome they stay the zero-download, instant path. When Web
Speech is **absent** (Brave/Firefox) `onWord` lazily loads the ML engine so the legacy API gains
cross-browser coverage; a settings-panel **opt-in** lets a Chrome user force ML deliberately. The new
stream/route path is **always ML** — Web Speech cannot tap a stream.

### 7. Canonical word payload `{ word, final, index }` (breaking)

Both paths converge on `{ word, final, index }`, dropping the Web Speech path's `utteranceId` /
`wordIndex`. `index` is the **global running-transcript position** (monotonic), not the old
per-utterance index — the Web Speech path keeps a running counter to match. New event `audio:transcript`
carries `{ text, isFinal }`. No tests or demos depend on the old fields; the changed sites are the
`audio.js` emit, `onWordStream` docs, `system-events.js`, the `completions.js` snippet, and `API.md`.

### 8. PCM tap: AudioWorklet-first, ScriptProcessor fallback, own 16 kHz context

The tap needs raw PCM (analyser bins won't do). It uses its own `new AudioContext({ sampleRate: 16000 })`
— off Tone's shared 48 kHz master graph, and resampling for free at the rate wav2vec2 wants. An
**AudioWorklet** processor (separate module via `new URL('./pcm-worklet.js', import.meta.url)`, secure
context — localhost qualifies) is preferred, with `createScriptProcessor` as the universal fallback.

## Consequences

- New dependency `@huggingface/transformers` (pulls onnxruntime-web); installed with
  `--legacy-peer-deps` and added to vite `optimizeDeps.exclude` alongside the mediapipe exclude.
- First `route()`/Model Manager use triggers a multi-MB download; progress shows on the spawned window
  title and in the settings panel. Subsequent loads hit the browser Cache API (`transformers-cache`).
- The settings/model-manager panel is built with **real DOM + JS listeners** in a `wm` html window —
  the handoff's inline-`<script>` + `window.parent` approach is dead here (html bodies are `innerHTML`,
  no iframe). `modelManager` / `MODELS` stay module imports, not window globals.
- No new user-facing window globals → no `KNOWN_GLOBALS` / toolkit / detection-gate churn.
- v1 scope: the `registerSource` trigger always taps the **mic** (Web Speech is mic-only; the ML
  fallback uses the mic stream). The STT Engine itself is source-agnostic (`acquireStt({el})` /
  `{stream}` exist), but auto-wiring transcription to a `<video>`'s own audio track or to
  `Source.screen` is deferred — not needed for the camera/mic acceptance test.
