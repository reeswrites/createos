# CONTEXT.md — Visual Live Coding IDE

## Glossary

### Editor Instance
A self-contained authoring unit. Comprises an **Editor Window** and a paired **Output Window**. Created together via the "+" toolbar button, closed together via confirmation. Identified by a stable numeric ID (1, 2, 3…).

### Editor Window
The floating window that holds the code area (text or blocks), mode toggle, play/pause/stop controls, and embedded console. Each Editor Window belongs to exactly one Editor Instance. Cannot be closed without confirmation; can be minimized to the Taskbar.

### Output Window
**Removed (ADR 040).** There is no longer a per-editor canvas display window. Visual output comes from a **Canvas** (or `pixi`/`Shader`/`ThreeScene` via `.mount`/`.show`), each of which spawns its own WM window. An Editor Instance owns no canvas stack.

### Canvas
The sole 2D drawing surface (ADR 038/040): `new Canvas()` spawns its own WM window and exposes the full fluent draw API scoped to it, with pointer pre-mapped into its own canvas space. Replaces the deleted global `draw`. It is the **z=0 plane** of its window's **Window Layer Stack**; `c.layer(z)` / `c.fx(z)` reach higher planes. Run-scoped, but its window **survives soft reset by identity** (key = `{id}` or `title+w+h`) so live-coding doesn't flash-rebuild it.

### Window Layer Stack
A window's z-ordered stack of `<canvas>` planes, owned by the WM (ADR 040): `wm.layer(winId, z)` creates/returns a plane, `wm.layers(winId)` returns them z-sorted (the snapshot/record composite order). One registry for every plane — draw@0, pixi@25, shader@30, paint overlay@50, text@51. Lazy: a window grows a stack only when something mounts into it. The single owner that replaced the old per-editor layer singleton.

### Window (handle)
The interface over a spawned WM window, obtained via `wm.window(id)` (a facade — `wm.spawn` still returns the stable string `id`, and `handle.id === id`, so the id stays the DOM id, the IndexedDB key, and the serialize key across all call sites). Replaces the **`win._*` expando bag** — the ~23 private fields modules used to write directly onto the `.wm-win` DOM element (`_wmCleanup`, `_widgetType`, `_vizSourceEl`, `_ensureTextLayer`…) move behind the handle's interface: `onDispose(fn)`, `dispose()`, `serialize()`, `type`, `paint()`, `text()`, `layers()`. Disposal is an **accumulator**: `onDispose(fn)` registers a listener; window close fires every listener LIFO (matching the old `prev?.()` chain order). This retires the wrap-and-rewrite `_wmCleanup` idiom — and its latent leak, where a clobbering write (`mixer`, `widget-shell`) silently dropped an earlier cleanup. The per-type base cleanup registers first.
_Avoid_: win expando, `win._*`, the WM window element as a property bag.

### Window Type Adapter
The serialize/restore pair for one window type, registered via `registerWindowType(type, { serialize, restore })` **beside the module that owns that type's state** (the `viz` adapter lives in `viz.js` where the source/style controls live; media in the WM/desktop path; editor/toolkit in app). Replaces the **dual type-switch** in `project.js` (one `switch(opts.type)` to serialize, a mirror one to restore) that reached across seams into `win._vizSourceEl.value`. `serialize(win)→record` and `restore(record)→window` are co-located so a type's round-trip lives in one place; `project.js` just iterates the registry. `restore` owns its own constructor choice (some types are `wm.spawn`, others `wm.restoreFileWindow` / `appAPI.createEditor` / `createToolkit`). Same "register beside your own code" discipline as `onReset`/`registerSource` (ADR 008).
_Avoid_: window serializer switch, project type-switch.

### Embedded Console
A collapsible log panel inside the Editor Window. Receives `console.log`/`console.error` output only from that Editor Instance's running code. Can be "popped off" into an independent floating window that remains connected to the same editor's output stream.

### Taskbar
A dock bar that appears at the bottom of the desktop when at least one Editor Window is minimized. Each minimized editor is represented as a chip showing its title and run-state indicator. Disappears when no editors are minimized.

### Minimized Editor
An Editor Instance whose Editor Window has been collapsed to the Taskbar. Code and execution state are preserved. Restored by clicking the chip in the Taskbar.

### Run State
The execution state of a single Editor Instance: `idle`, `running`, `paused`, or `stopped`. Independent per instance — pausing Editor 2 has no effect on Editor 1.

### Shared Globals
APIs that live on `window` and are accessible from all Editor Instances simultaneously: `Shader`, `ShaderFX`, `audio`, `vision`, `Camera`, `Media`, `wm`, `Color`, `onKey`, `randUni`. A shader created in Editor 1 can be referenced in Editor 2.

### API Descriptor
The single record of everything a built-in API *is*, carried by its registration in `src/runtime/api-registry.js`: the implementation, plus a `descriptor` holding its parameter signatures (`params`), authoring-surface metadata, and a detection spec (`detect: { effect, triggers? }`). The descriptor is the **source of truth**; the editor surfaces *derive* from it rather than re-declaring it — `KNOWN_GLOBALS` (test mirror), `PARAM_HINTS` (`param-hints.js`), and `detectAPIUsage`'s patterns (`api-detector.js`) all read the registry instead of keeping parallel hand-lists. `detect.effect` (`'canvas'|'audio'|null`) drives output-window/audio-start decisions; the default detection trigger is derived from the **registered name** (so a rename can't silently break detection), with optional `triggers[]` for constructor/alias forms (`new Shader`, `pat(`, `stack(`). Two surfaces stay deliberately separate: **Blockly blocks** (a visual surface, governed by the ADR-011 coverage gate) and the curated `TOOLKIT_CATEGORIES` snippets (editorial label/code/hint). The ADR-011/012 coherence gates are kept as redundant assertions — the descriptor makes them pass by construction.

### Per-Editor Locals
APIs injected as locals into each Editor Instance's IIFE at execution time: `setInterval`, `clearInterval`, `setTimeout`, `clearTimeout`, `console`. These shadow any global with the same name inside the user's IIFE. (Pre-ADR-040 this also included `draw`/`getCanvas`/`getLayer`/`getDraw` — all removed; 2D drawing is now `new Canvas()`.) The set is enumerated **once** in the `PER_EDITOR_LOCALS` table (`src/editor/editor-instance.js`): `_setupGlobals` creates each on `window[__ar_e{id}_<name>]` and `editorPreamble` aliases each back to a `const`, both deriving from the table so the two halves can't drift. Run-control sugar (`stop`/`stopRunning`/`pause`/`resume`) is *not* a Per-Editor Local — it has no window-global side and stays inline in `editorPreamble`.

### IIFE Isolation
The execution strategy used to scope per-editor APIs. Each editor's `execute()` injects **Per-Editor Locals** as named variables in the IIFE wrapper before user code runs. Callbacks and timers capture these locals via closure. Globals (`Shared Globals`) remain on `window` and are unaffected.

### Creative Widget
One of the in-app authoring tools that spawns its own WM window: Paint, SpriteEditor, AsciiEditor, Drumpad, Piano. They share a **chassis** (`src/api/widget-shell.js`): `mountWidgetShell` owns the window, body styling, debounced autosave to a desktop icon, undo/redo wiring, and lifecycle; `buildFrameStrip`/`buildTransport` build the animation UI over a FrameController. Each widget supplies only its own canvas, tools, and export logic (composition, not a base class — see ADR 007).

### FrameDoc
The DOM-free animation frame model (`src/api/frame-doc.js`): an ordered list of opaque frames + a current index + transport (play/stop/fps) + onion-skin flag. Element-agnostic — Paint frames are canvases, AsciiEditor frames are cell arrays — via `createBlank`/`copyFrame`/`clearFrame`/`drawThumb` hooks. It is one implementation of the **FrameController** interface that the shared frame-strip/transport UI consumes; `SpriteFrameAdapter` (wrapping the public `Sprite` class) is the other.

### Active Editor
The Editor Instance that most recently ran (tracked as `window.__ar_active_editor_id`). The **Active Editor seam** (`src/editor/active-editor.js`) is the one place that inserts generated code into it — `insertSnippet(code)` appends at the document end, places the cursor, focuses, and falls back to the clipboard when no editor is active. Creative-widget export buttons call it instead of poking CodeMirror's `dispatch` directly.

### Run-Scoped Process
A process created during a run that must be torn down when *its owning* Editor Instance resets — and only then, so resetting Editor B never kills Editor A's work. The owner is the **Active Editor** at creation time (captured eagerly by default, or passed explicitly when creation is async — see the camera open() case). The deep module `runScoped({ owner, onStop })` (`src/runtime/run-scoped.js`) owns all of it: it tags the handle with its owner, holds it in a module-level Set, and registers a **single** owner-filtered `onReset(editorId)` for every run-scoped process at once. `editorId == null` (tests / no editor context) tears everything down. Teardown runs through one idempotent `handle.dispose()` — the caller's `onStop` body plus deregistration — reachable identically from a reset and from the caller's own `.stop()`/`_destroy`. Replaces the owner-tag + scoped-`onReset` ritual that the run-created subsystems re-derived. Adopted (ADR 041) by: media-lease + camera (inputs, bare `runScoped`); replay-clock + route + render-pipeline (whole-life outputs, `runScopedOutput`); viz + three-scene + render-pipeline (outputs whose liveness *toggles* — they use `runScoped` for owner teardown plus their own `liveOutput` start/stop toggle, so they don't join keep-alive for life). Each keeps its own enumeration registry (`_routes`/`_pipelines`/`_vizs`/`_scenes`) and a manual `cleanup*` destroy-all helper for tests; only the per-module *reset handler* is gone.
_Avoid_: run-scoped output (that is the narrower **Run-Scoped Output**), live output, keep-alive process.

### Run-Scoped Output
A **Run-Scoped Process** that is *also* a visible output, so it additionally joins the **keep-alive** Set that holds a run alive while something is on screen. `runScopedOutput({ owner, onStop, token })` = `runScoped` + `liveOutput(token)` (`src/runtime/keep-alive.js`); `dispose()` releases keep-alive in the same idempotent step. Inputs (camera/mic leases) use the bare `runScoped` core instead — they are owner-scoped but must **not** join keep-alive (ADR 009). The `token` stays caller-supplied (default `{}`) and now carries an explicit `label` (ADR 041): the **Signal Graph** reads `token.label ?? token.constructor.name`, so a route/pipe token (`{label}`) shows a meaningful name instead of `'Object'` and a class rename/minify can't relabel a node. audio/mixer still tag marker tokens.

### Run Context
The single owner of the handful of **per-run lifecycle fields** that the whole codebase reads to know "what's running right now" (`src/runtime/run-context.js`): the **Active Editor** id, the active blocks editor, the `paused` flag, and the audio-state flags (`usesAudio`, `audioReady`, `friendlyError`). Replaces ~6 of the raw `window.__ar_*` globals that a dozen API files used to read and several wrote directly, with no accessor — typed getters/setters (`activeEditorId()`/`setActiveEditorId()`, `isPaused()`/`setPaused()`, …) over one owner, the way `keep-alive.js` already fronts `__ar_keepAlive`. Deliberately **narrow**: it owns lifecycle state only — the app-wiring factory handles (`__ar_instances`, `__ar_projectManager`, widget restorers…) and the device singletons (`__ar_mic_*`, `__ar_video`…) stay with their own modules, since they have a different lifetime (boot-time composition / subsystem-owned) than per-run state. During migration the fields stay backed on `window` so unmigrated readers keep working while callers convert file-by-file.
_Avoid_: global state, the `__ar_*` bus, app-context (that conflates boot wiring with run state).

### Snapshot
A **declarative** export of a widget's current state as runnable code — the end result with no timing. Drumpad emits `dp.pattern(...)`, Piano emits `p.note(...)`, Paint/Sprite/Ascii emit a `new Canvas()` + `.image(dataUrl)`. Reproduces *what the widget looks like now*, not *how it got there*. Distinct from a **Performance** (which carries time) and from a **Recording** (which is video). Triggered by each widget's `</>` button via the **Active Editor** seam.

### Performance
A **temporal** export: a recorded sequence of timestamped widget actions (a piano note at t=300ms, a brush stroke at t=1100ms). Reproduces *how the result was made over time*, not just the end state. Captured between **Capture ●** and Stop on a widget. Timestamps are wall-clock milliseconds from the start of the **Take**. A Performance is replayed via **Replay**, never persisted to a project file — the emitted code *is* its persistence. **Not** a video — that is a **Recording**.

### Take
One Capture→Stop span on a single widget. The unit a Performance is recorded into. Multiple takes (even of the same widget) can be spliced at different offsets inside a **Timeline**.

### Replay
Re-executing a Performance as scheduled code. Each widget exposes `.replay(actions)` — a single-track replay bound to that widget — which constructs nothing and schedules the captured actions on the harness clock (patched `setTimeout`, so it pauses and cleans with the run; same rationale as `tick()`/Route timeline). A replay self-registers as a live output while playing.

### Timeline
The composition primitive (`window.timeline`) that schedules multiple **Takes** across multiple widgets on one shared clock. Each `.track(widget, actions, { at })` places a take at an offset (wall-clock ms), so different takes — including several of the same widget — can be spliced at different times by hand. `.replay()` is the degenerate one-track case. A **Global Capture ●** (desktop-level) arms every open widget at once and emits a multi-track Timeline; per-widget Capture emits a solo `.replay()`.

### Drawable Source
Any object the visual APIs can treat as a frame source: a `Layer`, a `CameraStream`, a bare `<video>`/`<canvas>`, or a `GLShader`/`Shader` instance. **Resolving** a Drawable Source means reducing it to the underlying `canvas` or `video` element. The sync resolver (`resolveDrawable`) handles these object forms only; string forms (`'camera'`, image URLs) are a separate async concern layered on by `draw.backdrop` (see ADR 006).

### Editor Persistence
Each Editor Instance saves its code to `localStorage` under key `vl-ide-code-{id}`. A manifest key `vl-ide-editors` holds the ordered list of active editor IDs. On page load all editors in the manifest are recreated with their saved code.

### Execution Trail
A live line-highlight overlay in the code editor showing which statements are currently executing. Implemented as CM6 `Decoration` entries added on each `__ar_trace(line)` call and removed after 800 ms. Lines executing at high frequency (e.g. inside `tick()`) glow permanently while active; one-shot lines flash and fade. Auto-on by default; toggled per Editor Instance via a button in the console label row. State persisted as `vl-trace-{id}`. See ADR 019.

### AST Transform Pipeline
The code-transformation stage applied to user code before injection. One Esprima parse; multiple registered visitors applied in order. `live-patch.js` hosts the pipeline (`transformCode(code, visitors)`). Current visitors: loop-protection (always), trace injection (when Execution Trail is enabled). Visitors see original source positions so line numbers are always accurate.

### Run (module) / Code Injector
The named sequence one `execute()` performs, extracted from `EditorInstance` into `src/runtime/run.js` so the lifecycle is testable without CodeMirror or a DOM. `startRun(raw, { id, traceEnabled, soft }, deps, injector)` reduces a run to: `reset` → `_beginRun` → `detectAPIUsage` → set **Run Context** → **AST Transform Pipeline** → wrap in the IIFE preamble → `injector.run(wrappedCode)` → start the idle watcher. `EditorInstance.execute()` shrinks to *gathering* its inputs (code from blocks/CM, trace flag) and delegating. The **Code Injector** is the one un-fakeable step behind its own seam: the production adapter appends a `<script>` to `document.body`; the test adapter captures the wrapped code (asserting the preamble, the trace calls, and the `PREAMBLE_LINES` offset) and runs nothing. Two adapters — real `<script>` and test-capture — make the seam real, not hypothetical.
_Avoid_: run orchestrator (it does not own UI/instance state), eval, script loader.

### Text Object
A styled, positioned text element managed by a **Text Layer**. Has content, position, font family/size/color/weight/style, alignment, rotation (degrees), kerning (letter-spacing px), and optional arc curve (`{type:'arc', radius}`). Interactive objects (placed via the text tool) are persistent; programmatic objects (placed via `wm.addText()`) are run-scoped and cleared on reset. Selected via single click, edited via double-click, moved by dragging, deleted via Delete key. See ADR 024.

### Text Layer
The subsystem (`src/api/text-layer.js`) shared by the WM paint overlay and the standalone `Paint` widget. Owns the array of **Text Objects**, their interaction DOM nodes, and a **mirror canvas** that re-renders all objects on every change. The mirror canvas is composited in snapshot and recording output alongside the raster overlay — after base canvases and the paint overlay, so text always appears on top. See ADR 024.

### Mixer
The live audio console (`window.mixer`, WM panel + toolbar button). Auto-discovers every running **Audio Source** and presents one **Strip** per source, plus the **Master** strip. The single surface for leveling, panning, EQ'ing, muting and soloing everything the IDE is making sound with — Tone and non-Tone alike. Replaces the former standalone EQ widget. See ADR 032.

### Audio Source
Anything audible that the Mixer can carry: a Tone **Instrument**, a window's media element (`<video>`/HTML audio), the mic (`UserMedia`), a Drumpad, an arbitrary raw WebAudio node, or the **Strudel Engine** (one source for all Strudel sound — see **Strudel Pattern**). A Tone-triggering **Pattern** is *not* a source — it is a scheduler that triggers an Instrument; in the Mixer it appears as a sub-row under its Instrument's Strip, not as its own Strip.

### Strudel Pattern
A pattern authored in the real Strudel language (`@strudel/*`), invoked through explicit function calls — `note("c e g")`, `s("bd hh")`, `seq(...)` — never bare strudel.cc string sugar (createos runs **no** global Strudel transpiler, so every Strudel call is plain JS; see _Avoid_). Unlike the legacy in-house pattern, a Strudel Pattern does **not** trigger a Tone **Instrument**: it sounds through Strudel's own engine (superdough — its own samples and synths), so in the Mixer all Strudel output is carried by a single **Strudel** Strip, not nested under any Instrument. Tempo is shared, not independent: Strudel's cycle clock is slaved to the Tone **Transport** by `setcps(n)` ⇄ `bpm = n × 60` over one shared AudioContext; Strudel's own scheduler is left stock. Run-scoped like every other audio source — silenced on reset alongside Tone patterns.
_Avoid_: Deep Strudel (the removed in-house parser), `pat()`, mini-notation string method sugar (`"c e g".fast(2)`)

### Strip
One channel of the Mixer: a `Tone.Channel` (volume / pan / mute / solo, with a live VU **Meter**) inserted between an Audio Source and the Master. Optionally carries a lazily-inserted 4-band parametric **EQ** (spliced in on first touch, not present on idle strips). Every Instrument gets a Strip eagerly at construction. A Strip is identified by **name** — pattern id if given, else instrument-type+counter, window title, `mic`, or drumpad title — and is renamable. Strip lifecycle follows its source: run-scoped (instrument / mic / raw node, wiped on reset), window-scoped (window media / drumpad, survive reset, die on window close), or persistent (Master). Settings persist by name in localStorage and travel in the `.vljson` project.

### Master
The final output Strip — `Tone.getDestination()`. All Strips feed it, so the existing master FFT and mute-via-destination paths keep working unchanged. Carries its own EQ and Meter; takes over the role the standalone global EQ widget used to play.

### MIDI Target
The single **instrument widget** (Piano or Drumpad) that currently receives Web MIDI input. It is the **last-focused** instrument: focusing a Piano or Drumpad makes it the target, and it *stays* the target even when focus moves to the editor or any non-instrument window — switching only when a different instrument is focused (**sticky**). Enabling MIDI is **permission-aware**: Web MIDI cannot enumerate devices without first requesting access (which prompts), so a user with no controller is never prompted. On focus, the instrument checks the standing MIDI permission silently; if already granted it opens access and binds automatically, otherwise it shows a dormant MIDI chip that the user clicks once (the permission gesture) to opt in. After the first grant, future sessions bind automatically. The chip also serves as the target indicator — it lights on whichever instrument is the current target. No editor code is required. Incoming notes drive the target exactly as its own mouse/computer-keyboard input would — including respecting the Piano's selected-step programming mode — and are captured into a **Take** like any other live input. Velocity is carried through to loudness and to event payloads.

### Gaze
Where the user is looking, derived from the webcam by the **vision** subsystem. Two tiers on one object: a **direction** (`x`/`y` in −1..1, head-relative, from face blendshapes — always available, no calibration) and a **screen point** (`vx`/`vy` in viewport pixels — available only after **Gaze Calibration**). Carries blink and per-eye wink, also calibration-free. Unlike the discrete `gesture:*` detections (face, pose, object — present or absent), Gaze is a **continuous signal** meant to drive `route()`, shaders, and audio; it therefore gets its own `gaze:*` event prefix.
_Avoid_: eye-tracking, look-point, gesture:gaze

### Gaze Calibration
The interactive session that maps a user's eye behaviour to **viewport** pixels, making `gaze().vx/vy` live. Mandatory for screen-point gaze because a browser cannot know the camera-to-screen geometry; calibration is the only thing that pins it down. Run once via the gaze chip or `vision.calibrate()`. Bound to one person + camera + screen resolution — persisted device-locally, never carried in a project file, and invalidated when the device or resolution changes.
_Avoid_: training, gaze setup

### Event Stream Panel
A floating WM window that shows a live rate-limited feed of bus events during a run. One row per unique event name; repeat fires within 200 ms increment a counter badge (`×N`) rather than spawning new rows. Rows are expandable to show full payload (depth-2 JSON tree). Default filter excludes harness-internal prefixes (`editor:`, `session:`, `wm:`). Implemented via a bus tap (`addBusTap`) — not a run-scoped subscription. See ADR 019.

### Transcription
Turning speech into text inside the browser, with no server. Available on **any audio-bearing stream** — a microphone, a media element, screen-share audio — not only the microphone. Emits a stream of word events (**interim** then **final**) and a running **Transcript** on the bus (`audio:word:interim`, `audio:word:final`, `audio:transcript`). Distinct from the legacy keyword matcher (`audio.onWord`): that listens for named words on the mic via the browser's built-in speech recognition; Transcription is the general, cross-browser capability. When a visual route with no audio of its own (a camera route) asks for Transcription, the audio is drawn from the **microphone** — you speak while your face is on screen.
_Avoid_: speech recognition (ambiguous with the browser API), dictation

### STT Engine
The process that performs **Transcription** for one audio input. Shared and reference-counted per audio source: many consumers listening for words on the same microphone are served by a single engine and a single model, fanning results out over the bus. Lives only while a run needs it; the model itself stays cached across runs. Backed by an in-browser ML model (a **CTC** model for live interim words; an optional accuracy-first model for final-only transcripts of completed audio).
_Avoid_: recognizer, transcriber instance

### Word Differ
The part of the **STT Engine** that converts the model's per-chunk full-transcript guesses into discrete word events. It tracks a **committed** prefix (words it has emitted as final) and a **frontier** (still-changing trailing words); a frontier word becomes final once it survives unchanged for a few consecutive chunks. This is what produces the interim-then-final cadence callers see.

### Transcript
The full running text of a **Transcription** so far, carried by `audio:transcript` with whether it is final. The word stream is the per-word view of the same thing; the Transcript is the whole-utterance view.

### Model Manager
The single owner of in-browser ML model lifecycle: which models exist, whether each is downloaded, download progress, deletion, and total storage used. Backends ask it to load a model rather than fetching directly, so a model downloads once and is reused. Surfaced to the user as a settings panel (toolbar entry) where models can be pre-downloaded or removed without writing code; the first programmatic use also triggers a download with progress shown on the spawned window.
_Avoid_: model cache, downloader
