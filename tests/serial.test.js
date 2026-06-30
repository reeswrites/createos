// serial.test.js — unit tests for WebSerial + GPIO (src/api/serial.js, ADR 020)
//
// Stubs navigator.serial so tests run in jsdom without real hardware.
// Covers: connect/disconnect lifecycle, text-line pipe, gpio:pin firing,
// default parse, custom parse/serialize, gpio:write, port-survives-reset invariant.
//
// Note: bus.emit() with async command handlers fires-and-forgets (ADR 013 invariant).
// Tests flush the microtask queue via flushAsync() after each emit to let handlers complete.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Flush pending microtasks (async command handler body) + one macrotask.
const flushAsync = () => new Promise(r => setTimeout(r, 0));

// ── Helpers ───────────────────────────────────────────────────────────────────

function fakeReadable(chunks) {
  let i = 0;
  return new ReadableStream({
    pull(ctrl) {
      if (i < chunks.length) ctrl.enqueue(chunks[i++]);
      else ctrl.close();
    },
  });
}

function fakeWritable() {
  const written = [];
  const stream = new WritableStream({
    write(chunk) { written.push(chunk); },
  });
  stream._written = written;
  return stream;
}

function fakePort(readableChunks = []) {
  const writable = fakeWritable();
  return {
    get readable() { return fakeReadable(readableChunks); },
    writable,
    open:    vi.fn(() => Promise.resolve()),
    close:   vi.fn(() => Promise.resolve()),
    getInfo: vi.fn(() => ({ vendorId: 0x2341, productId: 0x0043 })),
  };
}

// ── Bus / module access (reset per describe block) ────────────────────────────

let emit, subscribe, clearRunScoped;

// ── serial:connect / serial:status ────────────────────────────────────────────

describe('serial:connect / serial:status', () => {
  let port;

  beforeEach(async () => {
    vi.resetModules();
    port = fakePort([]);
    Object.defineProperty(navigator, 'serial', {
      value: { requestPort: vi.fn(() => Promise.resolve(port)) },
      configurable: true, writable: true,
    });
    ({ emit, subscribe, clearRunScoped } = await import('../src/events/bus.js'));
    await import('../src/api/serial.js');
  });

  afterEach(() => {
    vi.resetModules();
    delete navigator.serial;
  });

  it('serial:connect opens port at given baudRate and fires serial:status connected', async () => {
    const statusFn = vi.fn();
    const unsub = subscribe('serial:status', statusFn);

    emit('serial:connect', { baudRate: 9600 });
    await flushAsync(); // let async handler complete

    expect(port.open).toHaveBeenCalledWith({ baudRate: 9600 });
    expect(statusFn).toHaveBeenCalledWith(
      expect.objectContaining({ connected: true, port: expect.objectContaining({ vendorId: 0x2341 }) }),
    );
    unsub();
  });

  it('serial:connect uses 115200 baud by default', async () => {
    emit('serial:connect');
    await flushAsync();
    expect(port.open).toHaveBeenCalledWith({ baudRate: 115200 });
  });

  it('serial:disconnect fires serial:status disconnected', async () => {
    emit('serial:connect');
    await flushAsync(); // connect must complete before disconnect

    const statusFn = vi.fn();
    const unsub = subscribe('serial:status', statusFn);
    emit('serial:disconnect');
    await flushAsync();

    expect(statusFn).toHaveBeenCalledWith(expect.objectContaining({ connected: false }));
    unsub();
  });
});

// ── sensor:serial:data and gpio:pin — text mode ───────────────────────────────

describe('sensor:serial:data and gpio:pin — text mode', () => {
  let port;

  beforeEach(async () => {
    vi.resetModules();
    const encoder = new TextEncoder();
    port = fakePort([encoder.encode('13:512\n')]);
    Object.defineProperty(navigator, 'serial', {
      value: { requestPort: vi.fn(() => Promise.resolve(port)) },
      configurable: true, writable: true,
    });
    ({ emit, subscribe, clearRunScoped } = await import('../src/events/bus.js'));
    await import('../src/api/serial.js');
  });

  afterEach(() => {
    vi.resetModules();
    delete navigator.serial;
  });

  it('fires sensor:serial:data with raw line', async () => {
    const dataFn = vi.fn();
    const unsub = subscribe('sensor:serial:data', dataFn);
    emit('serial:connect', { baudRate: 115200 });
    await new Promise(r => setTimeout(r, 20)); // connect + pipe drain
    expect(dataFn).toHaveBeenCalledWith(expect.objectContaining({ line: '13:512' }));
    unsub();
  });

  it('fires gpio:pin when default parse matches', async () => {
    const gpioFn = vi.fn();
    const unsub = subscribe('gpio:pin', gpioFn);
    emit('serial:connect', { baudRate: 115200 });
    await new Promise(r => setTimeout(r, 20));
    expect(gpioFn).toHaveBeenCalledWith({ pin: 13, value: 512 });
    unsub();
  });

  it('sensor:serial:data still fires when parse returns null (non-matching line)', async () => {
    vi.resetModules();
    const encoder = new TextEncoder();
    const badPort = fakePort([encoder.encode('HELLO WORLD\n')]);
    Object.defineProperty(navigator, 'serial', {
      value: { requestPort: vi.fn(() => Promise.resolve(badPort)) },
      configurable: true, writable: true,
    });
    ({ emit, subscribe } = await import('../src/events/bus.js'));
    await import('../src/api/serial.js');

    const dataFn = vi.fn();
    const gpioFn = vi.fn();
    const u1 = subscribe('sensor:serial:data', dataFn);
    const u2 = subscribe('gpio:pin', gpioFn);

    emit('serial:connect');
    await new Promise(r => setTimeout(r, 20));

    expect(dataFn).toHaveBeenCalledWith(expect.objectContaining({ line: 'HELLO WORLD' }));
    expect(gpioFn).not.toHaveBeenCalled();
    u1(); u2();
  });
});

// ── custom parse ──────────────────────────────────────────────────────────────

describe('custom parse', () => {
  let port;

  beforeEach(async () => {
    vi.resetModules();
    const encoder = new TextEncoder();
    port = fakePort([encoder.encode('{"p":3,"v":255}\n')]);
    Object.defineProperty(navigator, 'serial', {
      value: { requestPort: vi.fn(() => Promise.resolve(port)) },
      configurable: true, writable: true,
    });
    ({ emit, subscribe } = await import('../src/events/bus.js'));
    await import('../src/api/serial.js');
  });

  afterEach(() => {
    vi.resetModules();
    delete navigator.serial;
  });

  it('custom parse maps JSON lines to gpio:pin', async () => {
    const gpioFn = vi.fn();
    const unsub = subscribe('gpio:pin', gpioFn);

    emit('serial:connect', {
      baudRate: 115200,
      parse: line => {
        try { const { p, v } = JSON.parse(line); return { pin: p, value: v }; }
        catch { return null; }
      },
    });
    await new Promise(r => setTimeout(r, 20));

    expect(gpioFn).toHaveBeenCalledWith({ pin: 3, value: 255 });
    unsub();
  });
});

// ── gpio:write and serial:write ───────────────────────────────────────────────

describe('gpio:write and serial:write', () => {
  let port, written;

  beforeEach(async () => {
    vi.resetModules();
    written = [];
    port = fakePort([]);
    // Patch writable to record bytes
    port.writable = {
      getWriter: () => ({
        write: async (bytes) => { written.push(new TextDecoder().decode(bytes)); },
        releaseLock: vi.fn(),
      }),
    };
    Object.defineProperty(navigator, 'serial', {
      value: { requestPort: vi.fn(() => Promise.resolve(port)) },
      configurable: true, writable: true,
    });
    ({ emit, subscribe } = await import('../src/events/bus.js'));
    await import('../src/api/serial.js');
  });

  afterEach(() => {
    vi.resetModules();
    delete navigator.serial;
  });

  it('gpio:write sends default serialized "PIN:VALUE\\n" string', async () => {
    emit('serial:connect', { baudRate: 115200 });
    await flushAsync();

    emit('gpio:write', { pin: 13, value: 1 });
    await flushAsync();

    expect(written[0]).toBe('13:1\n');
  });

  it('gpio:write uses custom serialize when provided', async () => {
    emit('serial:connect', {
      baudRate: 115200,
      serialize: ({ pin, value }) => `SET ${pin} ${value}\r\n`,
    });
    await flushAsync();

    emit('gpio:write', { pin: 7, value: 0 });
    await flushAsync();

    expect(written[0]).toBe('SET 7 0\r\n');
  });
});

// ── port survives reset ───────────────────────────────────────────────────────

describe('port survives reset', () => {
  let port;

  beforeEach(async () => {
    vi.resetModules();
    port = fakePort([]);
    Object.defineProperty(navigator, 'serial', {
      value: { requestPort: vi.fn(() => Promise.resolve(port)) },
      configurable: true, writable: true,
    });
    ({ emit, subscribe, clearRunScoped } = await import('../src/events/bus.js'));
    await import('../src/api/serial.js');
  });

  afterEach(() => {
    vi.resetModules();
    delete navigator.serial;
  });

  it('port.close is NOT called on clearRunScoped (simulated reset)', async () => {
    emit('serial:connect', { baudRate: 115200 });
    await flushAsync();
    clearRunScoped(); // simulates editor reset
    expect(port.close).not.toHaveBeenCalled();
  });

  it('port.close IS called on serial:disconnect', async () => {
    emit('serial:connect', { baudRate: 115200 });
    await flushAsync();
    emit('serial:disconnect');
    await flushAsync();
    expect(port.close).toHaveBeenCalled();
  });
});
