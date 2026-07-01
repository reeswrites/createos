# ADR 050 — Native capability registry + main-enforced consent

**Status**: Accepted — implemented (Phase 1 slice)
**Date**: 2026-06-30

> **Implementation note (Phase 1)**: Registry seam + main-enforced consent landed. The gate
> is a set of user-granted roots in `electron/main.cjs`: `native:pickDirectory`/`pickFile`
> (the OS dialog IS the open-time consent gesture) grant the picked path subtree;
> `native:listDir`/`native:readFile` call `assertGranted()` and refuse any path outside a
> granted root — so arbitrary user code can't read `/etc/passwd`, only what the user picked.
> `native:saveFile` grants its dialog-chosen path before writing (write-consent = the Save
> dialog). `sandbox:true` + `contextIsolation:true` enforced; preload exposes only named fns
> (fs pickers + OSC + a one-way `onEvent` push channel), no raw `fs`/`ipcRenderer` — verified by
> the e2e smoke (`tests/e2e/electron-smoke.spec.js`: bridge is narrow, `require`/`ipcRenderer`
> absent, ungranted `readFile('/etc/passwd')` rejects). Main→renderer events (global hotkeys,
> incoming OSC) ride one `native-event` channel fanned out by name. Renderer seam is
> jsdom-mockable (`tests/unit/runtime/native.test.js`, `native-bridge.test.js`, `osc-codec.test.js`).
>
> **Provenance token (now landed)**: on TOP of granted-roots, main tracks per-project trust
> (`projectTrust` × `nativeConsent`) via the pure, unit-tested `electron/trust.cjs`
> (`decideAccess → allow|deny|ask`, `tests/unit/runtime/trust.test.js`). `authored` projects are
> trusted; `imported`/`demo` prompt once (`dialog.showMessageBox`, cached for the session)
> before any **data/device** capability (`listDir`/`readFile`/`oscListen`/`oscSend`/screen).
> The renderer sets provenance around `applyProject` — `imported` on `loadProject`+embed,
> `demo` on gallery load, `authored` on save. The File>Open read is a dedicated **ungated**
> `native:openProjectFile` (dialog+read in one user gesture) so a blocked project can't trap
> you from opening another. Dialog pickers stay ungated (the click is the gesture).

## Context

CreateOS runs **arbitrary user-authored JavaScript in the renderer's main world** — that is the
whole point of the tool. Per the IIFE isolation model (CONTEXT.md), each editor's code is
injected as a `<script>` and isolates editors *from each other*, **not** from `window`. So any
function a preload script exposes via `contextBridge` is reachable by user code — including code
pasted from a demo or loaded from a shared `.vljson`/`.createos` project file.

Electron's standard security posture assumes the renderer runs *your* trusted code and untrusted
content is sandboxed remote HTML. Here that assumption is inverted: the untrusted content is the
user's own script, already inside the renderer. Once Phase 3 adds `fs`, `shell`, `serialport`,
`node-hid`, and OSC bridges, **opening a shared project becomes running a native program**.

Two problems must be solved together: (1) how renderer code discovers/calls native functions
without scattering detection logic, and (2) how risky capabilities are gated when the caller may
be untrusted project code.

## Decision

**1 — Single capability registry.** One module (`src/runtime/native.js`-style) exposes
capabilities by name; `nativeCap('pickDirectory')` returns the Electron bridge fn, the browser
fallback, or `null`. Call sites never touch `window.electron` directly. The browser build
registers browser impls; the Electron preload registers native ones. This matches the existing
"register beside your own code" discipline (`onReset`, `registerSource`, `registerWindowType`,
the API descriptor registry) and gives one jsdom-mockable seam for tests (ADR 049).

**2 — Capabilities are trusted API; risky ones gated at open-time, enforced in main.** The user
*is* the author, so native functions are treated as first-class creative API — not hidden. But
opening a project from outside a trusted set (imported path, downloaded demo, `.createos` file
association) prompts once for risky capabilities ("this project wants disk/serial access — allow?").
Provenance is tracked per project: authored-and-saved-locally is trusted; imported/downloaded is
untrusted-until-consented. This reuses the gesture-gating pattern already in the codebase (the
MIDI permission chip ADR 033, WebSerial connect-on-gesture ADR 020).

**The consent gate lives in the main process, never the renderer.** A renderer-side check is
defeated by the arbitrary user code it is trying to gate (call the bridge directly, monkeypatch
the check). Therefore each IPC handler in main validates the calling project's provenance/consent
token — which **main itself tracks** — before touching fs/shell/serial/HID. The renderer registry
is a convenience facade; the authority is main.

Consequently `sandbox: true` and `contextIsolation: true` are **required, not "where possible"** —
they force every OS-touching operation through IPC into main, which is the only place the gate
can be trusted. `nodeIntegration` stays `false`; the preload exposes only narrow, purpose-built
bridge functions (`pickDirectory()`), never raw `fs`/`ipcRenderer`.

## Considered options

- **Raw `window.native.*`, branch at call sites** — rejected: detection spreads across
  `wm.js`/`project.js`/`serial.js`, no single mock point.
- **Per-subsystem bridge modules** — rejected: locality at the cost of a central seam; the
  registry gives both (modules can register into it).
- **All capabilities freely available, no gating** — rejected: a shared malicious project = silent
  arbitrary native execution.
- **Renderer-side consent check** — rejected: not a real boundary; the gated code shares the
  renderer realm with the check.

## Consequences

- Every risky native IPC handler needs a provenance/consent check in main; a project-provenance
  token must be threaded from load through to IPC calls.
- Renderer branch logic is unit-tested via the registry mock (vitest); main/preload/IPC are
  covered by a separate Playwright-Electron smoke suite kept out of the fast test gate.
- Safe/output capabilities (native open-dialog, NDI out, OSC) can register without a gate; only
  disk-write/process-spawn/device-open capabilities carry the consent check.
- `sandbox: true` is a *feature* of this design (it is the enforcement lever), not a limitation to
  work around.
