# ADR 052 — Platform scope (all three) + unsigned, package-manager distribution

**Status**: Accepted — proposed (not yet implemented)
**Date**: 2026-06-30

## Context

Two distribution questions gate real cost and account setup: which platforms v1 targets, and
whether builds are code-signed / notarized with auto-update wiring. Signing carries recurring
cost and account friction (Apple Developer $99/yr + notarization, Windows OV/EV cert); an unsigned
build hits macOS Gatekeeper and Windows SmartScreen warnings on first run.

## Decision

**Target all three platforms (macOS, Windows, Linux) from day one.** Widest reach for the
VJ/performer audience immediately. The known Linux risk — inconsistent WebGPU — is **pre-mitigated
by the existing dual shader stack**: WebGPU-only sketches (`window.Shader`, WGSL) degrade to the
WebGL `GLShader` path (ADR 030) via runtime feature-detect, so Linux demos don't hard-fail.
NDI (ADR 051) covers egress cross-platform, so no mac/Windows-specific egress lib is required for
v1.

**Ship unsigned; distribute via package managers.** No code signing or notarization. Builds go out
through **brew-cask (mac), winget (Windows), AppImage/deb (Linux)**. Consequently **no
`electron-updater`** — unsigned auto-update can't verify signatures, so **updates ride the package
managers** instead. Cheapest path to a public build; the audience (live coders / VJs) is technical
enough to accept the package-manager route and the first-run OS prompts.

`electron-builder` is still configured for signing/notarization from the start (ADR 053) so
enabling it later is a config flip, not a rewrite — if non-technical reach becomes a goal, signing
can be turned on without restructuring the build.

## Considered options

- **Sign + notarize from the first build** — smoother external testing, no OS warnings, but
  recurring cost + notarization CI complexity before the product is validated. Rejected for v1.
- **Mac+Windows first, Linux later** — sidesteps Linux WebGPU risk and a third packaging story,
  but the dual shader fallback already de-risks Linux and the reach is wanted now. Rejected.
- **electron-updater auto-update** — pointless without signing (can't verify the payload).
  Rejected; deferred to whenever signing is.

## Consequences

- Install docs must cover the first-run friction: macOS right-click→Open (Gatekeeper), Windows
  "More info → Run anyway" (SmartScreen). Linux AppImage/deb is clean.
- Updates are the package manager's job; no in-app update prompt in v1.
- Three packaging + CI-runner stories from the start (mac, win, linux).
- The signing config exists but is dormant — turning signing/notarization/auto-update on later is
  a config change, revisited if the audience widens past technical users.
