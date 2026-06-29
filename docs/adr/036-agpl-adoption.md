# ADR 036 — createos is AGPL-3.0, app-wide and permanent

**Status:** Accepted
**Date:** 2026-06-28
**Relates to:** ADR 035 (Strudel replaces the in-house pattern engine)

## Context

Adopting Strudel (ADR 035) means bundling `@strudel/*` — **AGPL-3.0-or-later** — into the
same JavaScript that ships to every browser. Strudel is not a network service we call across a
boundary; it is linked into the app. Under the AGPL that makes createos a **derivative work**,
and the AGPL's network-use clause means anyone who loads the page can demand the full
corresponding source of createos itself.

This is the root, irreversible decision of the audio restructure: every downstream Strudel
choice depends on it, and it cannot be undone later without ripping Strudel back out — by which
point every user pattern script is Strudel-syntax, so removal would be user-facing data loss.

## Decision

createos is licensed **AGPL-3.0 (or a compatible license), application-wide, permanently.**
There is no future closed-source or commercial-relicensing path while Strudel is bundled. The
commitment is made *before* `npm install @strudel/*` — recorded in `LICENSE` and this ADR — not
discovered after the dependency is wired in.

## Considered Options

- **Stay proprietary / keep options open** — incompatible with bundling AGPL code. Would have
  forced keeping the in-house parser (ADR 035) forever as license insurance.
- **Isolate Strudel behind a network/process boundary to dodge the link** — rejected as
  contortion: Strudel runs in the same browser context as user code by design, and the AGPL's
  network clause targets exactly this.

## Consequences

- The choice aligns createos with the live-coding ecosystem (Strudel, TidalCycles), where AGPL
  is the norm — so it is free ideological alignment, not just a cost.
- Any future dependency or feature must be license-compatible with AGPL-3.0.
- If createos ever *must* go closed/commercial, the only path is removing Strudel and
  reinstating an in-house engine — accept that this is a one-way door.
