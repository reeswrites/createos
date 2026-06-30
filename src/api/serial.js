// serial.js — WebSerial + GPIO on the event bus (ADR 020)
// No window API. All interaction via bus:
//
//   serial:connect    { baudRate?=115200, parse?, serialize?, mode?='text' }  commandable — needs user gesture
//   serial:disconnect {}                                          commandable — abort pipe + close port
//   serial:write      { data }                                    commandable — raw write (string or Uint8Array)
//   gpio:write        { pin, value }                              commandable — serialize() → serial:write
//   serial:status     { connected, port:{ vendorId, productId } } fired on connect/disconnect
//   sensor:serial:data { line }  (text mode)                      fired per newline
//   sensor:serial:data { bytes } (binary mode, mode:'binary')     fired per chunk
//   gpio:pin          { pin, value }                              fired when parse(line) returns non-null
//
// Port lifetime: port SURVIVES resets by design (physical device handle, not a run artifact).
// Run-scoped subscribers are wiped by clearRunScoped() on reset — cleanupSerial is a deliberate no-op.
// Port closes only on serial:disconnect or page unload. See ADR 020.

import { notify, registerCommand } from '../events/index.js';
import { onReset } from '../runtime/reset-registry.js';

// Capture native addEventListener before the harness patches it (same pattern as device-sources.js).
const _nativeWinAdd = window.addEventListener.bind(window);

// ── Module state ──────────────────────────────────────────────────────────────

let _port = null;
let _abort = null; // AbortController for the read pipe
let _parse = null; // line → { pin, value } | null
let _serialize = null; // { pin, value } → string
let _mode = 'text';
let _connected = false;

// ── Defaults ──────────────────────────────────────────────────────────────────

function _defaultParse(line) {
  const [p, v] = line.split(':');
  const pin = +p,
    value = +v;
  return isNaN(pin) || p === '' || isNaN(value) || v === '' ? null : { pin, value };
}

function _defaultSerialize({ pin, value }) {
  return `${pin}:${value}\n`;
}

// ── Line-split TransformStream ────────────────────────────────────────────────

function _lineSplitTransform() {
  let buf = '';
  return new TransformStream({
    transform(chunk, controller) {
      buf += chunk;
      const lines = buf.split('\n');
      buf = lines.pop(); // last element is incomplete line (or '')
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) controller.enqueue(trimmed);
      }
    },
    flush(controller) {
      const trimmed = buf.trim();
      if (trimmed) controller.enqueue(trimmed);
      buf = '';
    },
  });
}

// ── Raw write (shared by serial:write and gpio:write) ─────────────────────────
// Command handlers must NOT call emit() — bus invariant (ADR 013).
// Both commands share this internal path directly.

async function _write(data) {
  if (!_port?.writable) {
    console.warn('[serial] no port open');
    return;
  }
  const writer = _port.writable.getWriter();
  try {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    await writer.write(bytes);
  } finally {
    writer.releaseLock();
  }
}

// ── Read pipe ─────────────────────────────────────────────────────────────────

function _startPipe() {
  _abort = new AbortController();
  const { signal } = _abort;

  if (_mode === 'binary') {
    // Raw chunks → sensor:serial:data { bytes }
    _port.readable
      .pipeTo(
        new WritableStream({
          write(chunk) {
            notify('sensor:serial:data', { bytes: chunk });
          },
        }),
        { signal },
      )
      .catch(() => {}); // AbortError on disconnect is expected
  } else {
    // Text mode: decode → split lines → notify
    const parseFn = _parse;
    _port.readable
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(_lineSplitTransform())
      .pipeTo(
        new WritableStream({
          write(line) {
            notify('sensor:serial:data', { line });
            const gpio = parseFn(line);
            if (gpio !== null) notify('gpio:pin', gpio);
          },
        }),
        { signal },
      )
      .catch(() => {}); // AbortError on disconnect is expected
  }
}

// ── Commands ──────────────────────────────────────────────────────────────────

registerCommand(
  'serial:connect',
  async ({
    baudRate = 115200,
    parse = _defaultParse,
    serialize = _defaultSerialize,
    mode = 'text',
  } = {}) => {
    if (_connected) {
      console.warn('[serial] already connected — call serial:disconnect first');
      return;
    }
    if (!navigator.serial) {
      console.warn('[serial] WebSerial not supported in this browser (Chrome/Edge only)');
      return;
    }
    _port = await navigator.serial.requestPort(); // throws SecurityError without user gesture
    await _port.open({ baudRate });
    _parse = parse;
    _serialize = serialize;
    _mode = mode;
    _connected = true;
    _startPipe();
    notify('serial:status', { connected: true, port: _port.getInfo() });
  },
);

registerCommand('serial:disconnect', async () => {
  if (!_connected) return;
  _abort?.abort();
  _abort = null;
  try {
    await _port?.close();
  } catch (_) {}
  _port = null;
  _connected = false;
  notify('serial:status', { connected: false, port: null });
});

registerCommand('serial:write', async ({ data }) => {
  await _write(data);
});

registerCommand('gpio:write', async ({ pin, value }) => {
  const serializeFn = _serialize ?? _defaultSerialize;
  await _write(serializeFn({ pin, value }));
});

// ── Reset handler ─────────────────────────────────────────────────────────────
// Port SURVIVES resets by design — this is a deliberate no-op.
// Run-scoped subscribers (sensor:serial:data, gpio:pin) are wiped automatically
// by clearRunScoped() in the bus. The pipe keeps running; notify() fires to zero
// subscribers harmlessly between runs.
// Do NOT add port.close() here. See ADR 020.

export function cleanupSerial() {
  /* intentional no-op — port survives resets */
}
onReset(cleanupSerial);

// ── Page unload — close port cleanly ─────────────────────────────────────────

_nativeWinAdd('beforeunload', () => {
  _abort?.abort();
  _port?.close().catch(() => {});
});
