# ADR 020 — WebSerial & GPIO on the Event Bus

**Status**: Accepted  
**Date**: 2026-06-26

## Context

createOS has no way to talk to physical hardware (Arduinos, ESP32s, Picos). WebUSB was considered but requires custom device firmware and only works with native-USB boards (Leonardo, Teensy, MKR series). WebSerial works with virtually all hobbyist microcontrollers via USB-serial bridge chips and requires zero special firmware — just `Serial.println()` in the Arduino sketch. Both APIs are Chrome/Edge-only, so browser support is identical.

## Decision

Add `src/api/io/serial.js` — a new module (separate from `device-sources.js`, following `midi.js` precedent) that exposes WebSerial via the event bus using the existing `registerSource` / `registerCommand` pattern from ADR 014.

### Event surface

```
serial:connect    { baudRate?, parse?, serialize?, mode? }  commandable — needs user gesture
serial:disconnect {}                                         commandable — closes port
serial:status     { connected, port: { vendorId, productId } }  fires on connect/disconnect

sensor:serial:data  { line }          text mode (default) — fires per newline
sensor:serial:data  { bytes }         binary mode — fires per chunk (mode:'binary')

gpio:pin    { pin, value }            fires when parse(line) returns non-null
gpio:write  { pin, value }            commandable — calls serialize({pin,value}) → serial:write
serial:write  { data }                commandable — raw write to port
```

### Defaults

- `baudRate`: 115200
- `mode`: `'text'` (line-buffered via `TextDecoderStream` + line-split `TransformStream`)
- `parse`: `line => { const [p,v] = line.split(':'); return isNaN(+p) ? null : { pin:+p, value:+v }; }`
- `serialize`: `({ pin, value }) => \`${pin}:${value}\n\``

User overrides both for custom protocols. `null` return from `parse` suppresses `gpio:pin` but `sensor:serial:data` always fires with the raw line — mismatch is always debuggable.

### Stream architecture

Uses the browser Streams API reactively — no `while(true)` blocking loop:

```js
port.readable
  .pipeThrough(new TextDecoderStream())
  .pipeThrough(lineSplitTransform())
  .pipeTo(new WritableStream({ write(line) { notify('sensor:serial:data', { line }); } }),
          { signal: _abortController.signal });
```

Teardown via `_abortController.abort()` on `serial:disconnect` and `beforeunload`. Binary mode skips `TextDecoderStream` and emits `{ bytes: Uint8Array }` chunks directly.

### Port lifetime

Port and pipe **survive resets** (same reasoning as Drumpad Tone.js voices and WM windows — physical device handle, not a run artifact). `clearRunScoped()` wipes run-scoped `sensor:serial:data` / `gpio:pin` subscribers on reset; the pipe keeps running and `notify()` fires to zero subscribers harmlessly. Port closes only on `serial:disconnect` or page unload.

`serial:connect` is a commandable event requiring a user gesture. Toolkit entry wires it to a button click. `hold('serial:status').connected` works via `getLastPayload` seeding — no extra machinery needed.

### GPIO layer

`gpio:pin` fires alongside `sensor:serial:data` (not instead of it) when `parse(line)` returns non-null. `gpio:write` calls `serialize({pin,value})` and routes through `serial:write`. Both `parse` and `serialize` are symmetric — user who customizes one can customize the other to match their Arduino sketch format.

A canonical "GPIO Bridge" Arduino sketch ships as a toolkit code snippet. `gpio:pin` / `gpio:write` are documented as "works with this sketch." Users with custom formats use `sensor:serial:data` + `serial:write` directly.

### Blocks coverage

New `'Serial / GPIO'` category in `TOOLKIT_CATEGORIES`. Marked `BLOCKS_TODO` — serial:connect requires user-gesture wiring that is awkward in blocks. Text-mode API ships first; blocks deferred.

## Consequences

**Positive**
- Works with Uno, Nano, Mega, ESP32, Pico, Teensy — all popular hobbyist hardware.
- Zero device firmware required — standard `Serial.println()` sketch.
- `sensor:serial:data` always fires raw, so protocol mismatches are never silent.
- Port survives resets — no reconnect ceremony between code runs.
- `parse`/`serialize` symmetry lets power users bring any wire format.
- `hold('serial:status').connected` works free from existing `hold()` machinery.

**Negative / tradeoffs**
- Chrome/Edge only (same as WebUSB — no regression).
- `serial:connect` requires explicit user gesture — cannot auto-connect on first subscriber like `sensor:geo` can (attempt to).
- Default `parse` (`PIN:VALUE\n`) silently skips lines that don't match — users must subscribe to `sensor:serial:data` to debug.
- Port surviving resets means a stale port from a previous sketch can confuse a new run — `serial:disconnect` must be explicit.

## Alternatives considered

- **WebUSB** — rejected: requires custom device firmware, works only with native-USB boards, library (webusb/arduino) last meaningfully updated ~2018.
- **`device-sources.js`** — rejected: port state + abort controller + parse/serialize config is enough complexity to isolate. Follows `midi.js` precedent.
- **`gpio:` layer only, no raw serial** — rejected: protocol coupling without escape hatch creates silent debugging failures.
- **`gpio:` in userland only** — rejected: `parse`/`serialize` with good defaults gives the convenience without hiding the contract.
- **Port closes on reset** — rejected: forces reconnect UX on every code run; physical device handles are not run artifacts.
