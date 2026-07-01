# ADR 053 — Electron build & test topology

**Status**: Accepted — implemented
**Date**: 2026-06-30

> **Implementation note**: Both tiers live. Renderer native branches are unit-tested in vitest
> via the registry mock (`tests/unit/runtime/native*.test.js`, `osc-codec.test.js`) — 1485 tests, in
> the fast gate. The Electron e2e tier is `tests/e2e/electron-smoke.spec.js` (`@playwright/test`
> `_electron`), config `playwright.config.js` (`testDir: tests/e2e`, so vitest's `tests/unit/**` glob
> never collides), script `test:e2e` (builds with `ELECTRON=1` then launches real Electron) —
> kept OUT of the vitest gate. Same-repo topology, `electron-builder`, `.cjs` main/preload.

## Context

The dual-target decision (ADR 049) and the "no failing tests" repo rule shape where Electron code
lives, how it's packaged, and how it's tested. The existing suite is **vitest/jsdom —
renderer-only**; Electron main-process and preload code can't run in jsdom, and native addons
(NDI, later serial/HID) can't run at all under it.

## Decision

**Repo topology.** Electron code lives in the **same repo** as the web app (`electron/main.js`,
`electron/preload.js`) — not a separate repo — because dual-target requires one shared source of
truth for the renderer app. The web build stays the default `vite` build; Electron loads the built
Vite output in production and the dev-server URL in dev.

**Packaging.** `electron-builder` (over electron-forge) for its more mature multi-platform +
signing/notarization story — configured for signing from the start even though signing is dormant
in v1 (ADR 052). Dev script (`electron:dev`) runs the Vite dev server and Electron together via
`concurrently`; `electron:build` produces the installers.

**`BrowserWindow` config is load-bearing security, not preference** (ADR 050): `nodeIntegration:
false`, `contextIsolation: true`, `sandbox: true` **required**. The preload exposes only narrow,
purpose-built bridge functions via `contextBridge` — never raw `fs`/`ipcRenderer`.

**Test posture — two tiers.**

1. **Renderer branches in vitest, now.** Native capabilities are reached through the capability
   registry (ADR 050), which is a single jsdom-mockable seam. Renderer-side native branches are
   unit-tested with native impls stubbed; the browser fallback is exercised by omitting the impl.
   This tier stays in the fast "must pass" gate.
2. **Main/preload/IPC/native in a separate Playwright-Electron smoke suite.** Launches a real
   Electron app; run in CI as its **own job, kept OUT of the vitest gate** so the fast unit loop
   stays green and doesn't depend on a heavyweight runner. e2e is additive.

## Considered options

- **electron-forge** — simpler defaults, but weaker multi-platform signing/notarization path.
  Rejected given ADR 052's "config-flip later" requirement.
- **Fold Electron e2e into the main test gate** — strongest guarantee, but slows every commit and
  couples the "no failing tests" rule to a launched-Electron runner. Rejected.
- **Manual verification only for native code** — cheapest, but native regressions escape CI, weak
  for an all-three-platforms target (ADR 052). Rejected.

## Consequences

- Two CI test jobs: fast vitest (gates commits) + Electron smoke (per-platform, additive).
- The capability registry must be mockable with zero Electron deps loaded so vitest stays
  jsdom-clean.
- Same-repo means the web and desktop builds share the renderer source; a renderer change is
  tested once and shipped to both targets.
- `sandbox: true` is fixed by the security model (ADR 050), so preload can't use Node directly —
  all main-side work goes through IPC by construction.
