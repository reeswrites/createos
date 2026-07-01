// native-bridge.js — wires Electron main-pushed events onto the signal bus, bus-first.
//
// Global hotkeys and OSC input are exposed the same way sensors are (ADR 013/014): as bus
// events, not new window globals — so `on('hotkey:panic')`, `on('osc:message')`,
// `hold('osc:/1/fader')`, and `emit('osc:send', {...})` all work with no new API surface
// to document/toolkit/blocks-cover. In the browser build there is no bridge, so the taps
// never fire and the commands no-op (nativeCap → null) — additive and dual-target (ADR 049).

import { notify, registerSource, registerCommand } from '../../events/index.js';
import { nativeCap, onNativeEvent } from '../../runtime/native.js';

const DEFAULT_OSC_PORT = 57121;

// ── Hotkeys → bus (persistent tap, like a device source) ────────────────────────────
onNativeEvent('hotkey', (d) => {
  notify('hotkey', d);
  if (d && d.id) notify(`hotkey:${d.id}`, d);
});

// ── OSC input: main decodes UDP → pushes 'osc'; fan out to bus by address ────────────
onNativeEvent('osc', (d) => {
  notify('osc:message', d);
  if (d && d.address) notify(`osc:${d.address}`, d);
});

// Lazily open the UDP port only while a sketch listens for OSC (0→1 subscribers), and
// close it when the last listener goes away — the standard registerSource lifecycle.
registerSource((e) => e === 'osc:message' || e.startsWith('osc:'), {
  start() {
    const listen = nativeCap('oscListen');
    if (!listen) return null;
    listen(DEFAULT_OSC_PORT);
    return () => nativeCap('oscClose')?.(DEFAULT_OSC_PORT);
  },
});

// Explicit port control + outbound OSC as bus commands (no new global).
registerCommand('osc:listen', ({ port = DEFAULT_OSC_PORT } = {}) => nativeCap('oscListen')?.(port));
registerCommand('osc:send', ({ host = '127.0.0.1', port, address, args = [] } = {}) =>
  nativeCap('oscSend')?.({ host, port, address, args }),
);
