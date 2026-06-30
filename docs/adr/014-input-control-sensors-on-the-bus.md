# ADR 014 — Input, Control & Sensors on the Event Bus

**Status**: Accepted  
**Date**: 2026-06-26

## Context

ADR 013 gave createos a global reactive event bus (`on`/`emit`/`any`, `EventSelector` chain, `SYSTEM_EVENTS` catalog). But three categories of input remained outside it:

1. **Keyboard / mouse** — raw DOM listeners or `sensors.keyboard()` / `sensors.mouse()`. `sensors.js` attached its own module-load DOM listeners, duplicating the bus entirely.
2. **Device sensors** — `sensors.gamepad()`, `sensors.motion()`, `sensors.geo()`, `sensors.battery()`, `sensors.network()`, `sensors.vibrate()`. A parallel API surface for reactive input with no bus integration.
3. **Timing** — `setInterval` only. No composable timer with bus modifiers (`.every()`, `.after()`, `.when()`).

This created two reactive APIs that were nearly identical in purpose, forcing learners to choose (and often pick the wrong one).

## Decision

**Fold all reactive input, timing, and device sensors onto the event bus.** Delete `window.sensors`. Add the missing primitives to make bus-side code equally expressive.

### New primitives

**`registerSource(matchOrEvent, { start, stop })`** — lazy bus source. Bus calls `start()` on the first subscriber to a matching event, `stop()` on the last. Sensor modules use this so polling loops/OS watches only run when something is actually subscribed. Predicate form (`e => bool`) lets one source manage a family of events (e.g. all `wm:{id}:mouse:move`).

**`tick(ms)`** — interval source returning a full `EventSelector`. Uses the *patched* `window.setInterval` (exception to the `_nativeSetInterval` rule — intentional: tick is user-visible and must pause/clean with the harness). All modifiers available: `.every(n)`, `.after(event)`, `.within(ms)`, `.when(pred)`.

**`.hold()` terminal** — converts an `EventSelector` into a live state container seeded by last-payload memory:
- If the event's catalog entry has a `release` field (key:down/key:up, mouse:down/mouse:up): returns a live **Set** of `primary` values (add on down, delete on up).
- Otherwise: returns a live **object** updated in-place from each payload (e.g. `on('window:mouse:move').hold()` → `{x, y, winId}`).

**Global `hold(event)`** — memoized, persistent (non-run-scoped) shorthand. `hold('window:mouse:move').x`, `hold('window:key:down').has('ArrowUp')`, `hold('sensor:motion').magnitude`. Backed by one persistent subscription per event, cleared of Set state on each reset (so key-bleed across runs is prevented).

**`.when()` dispatch mode** — when an object is passed with all-function values, `.when({w: fn, s: fn})` dispatches to the matching function via the catalog `primary` field (e.g. `key` for `window:key:down`). Returns a stop handle, same as `.do()`. Also: `.when(prop, map)` for explicit dispatch on `data[prop]`.

### Event surface added

```
window:key:down    { key, code, repeat, winId }   winId = id of focused WM window (or null)
window:key:up      { key, code, winId }
window:mouse:down  { button, x, y, winId }
window:mouse:up    { button, x, y, winId }
window:mouse:click { button, x, y, winId }
window:mouse:move  { x, y, winId }                 lazy source — starts on first subscriber

wm:{winId}:key:down/up         { key, code, repeat }
wm:{winId}:mouse:down/up/click { button, x, y }    x,y relative to window .wm-body
wm:{winId}:mouse:move          { x, y }

sensor:gamepad  { index, axes, buttons, pressed }  lazy RAF poll
sensor:motion   { ax, ay, az, alpha, beta, gamma, magnitude }  lazy devicemotion
sensor:shake    { magnitude }
sensor:geo      { lat, lon, accuracy, speed, heading }  lazy watchPosition
sensor:battery  { level, charging }
sensor:network  { online, type, downlink, rtt }

haptics:vibrate { pattern }   commandable — actuates navigator.vibrate
haptics:tap     {}            commandable — 40ms
haptics:buzz    { ms }        commandable — custom duration
haptics:stop    {}            commandable
```

`midi:note` split into `midi:note:on` / `midi:note:off` for symmetry.

### What changed

- `src/api/io/sensors.js` → deleted. Replaced by `src/api/io/device-sources.js` (lazy `registerSource` emitters + haptic commands).
- `window.sensors` → removed entirely.
- `src/api/io/input.js` → new. Sole keyboard+mouse DOM listener layer. Attaches via native `addEventListener` (captured before harness patch). All key/mouse events flow through the bus.
- `src/api/wm/wm.js` → added `_focusedWinId` tracking in `bringToFront`. `wm:blur` now actually emits (was declared but never fired).
- `src/events/bus.js` → added `registerSource`, `getLastPayload`, `_lastPayloads` Map, `_srcInc`/`_srcDec` subscription counting.
- `src/events/event-selector.js` → `.when()` three modes, `.hold()` terminal, `tick()` factory, global `hold()`.

## Consequences

**Positive**
- One reactive API surface for everything (events, timing, input, sensors).
- Lazy sources: gamepad/geo/battery cost nothing unless subscribed.
- `wm:blur` is now real. Per-window input scoping works.
- `hold()` + `tick()` together express polling loops more clearly than `setInterval + global var`.

**Negative / tradeoffs**
- `sensors.*` API deleted — breaking change for any existing demos/code using it.
- Keyboard events fire even while editor is focused, tagged `winId`. Users must filter with `.when(d => d.winId !== 'win-editor')` if needed.
- `tick()` uses patched `setInterval` (exception to `_nativeSetInterval` rule for harness internals).
- iOS `DeviceMotionEvent.requestPermission()` requires a user gesture — `sensor:motion` source may fail silently on first attempt without UI affordance.

## Alternatives considered

- **Keep `sensors.*` as a compatibility shim over bus events** — rejected; doubles the surface, confuses learners about the canonical pattern.
- **Make `window:mouse:move` always-on (RAF-polled)** — rejected; lazy source has identical behavior with zero cost unless subscribed.
- **`tick()` use `_nativeSetInterval`** — rejected; would not pause/clean with the harness like all other user-visible timers.
