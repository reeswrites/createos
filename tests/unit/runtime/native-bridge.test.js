import { describe, it, expect, vi, afterEach } from 'vitest';
import { emit } from '../../../src/events/index.js';
import { registerNativeCapability, unregisterNativeCapability } from '../../../src/runtime/native.js';
// Importing the bridge registers its bus commands/source against the real bus singleton.
import '../../../src/api/io/native-bridge.js';

describe('native-bridge OSC bus commands', () => {
  afterEach(() => {
    ['oscSend', 'oscListen'].forEach(unregisterNativeCapability);
  });

  it('emit("osc:send") forwards to native oscSend with defaults filled', () => {
    const spy = vi.fn();
    registerNativeCapability('oscSend', spy);
    emit('osc:send', { port: 9000, address: '/synth/cutoff', args: [0.5] });
    expect(spy).toHaveBeenCalledWith({
      host: '127.0.0.1',
      port: 9000,
      address: '/synth/cutoff',
      args: [0.5],
    });
  });

  it('emit("osc:listen") forwards the port to native oscListen', () => {
    const spy = vi.fn();
    registerNativeCapability('oscListen', spy);
    emit('osc:listen', { port: 5005 });
    expect(spy).toHaveBeenCalledWith(5005);
  });

  it('osc commands no-op safely when no native bridge (browser build)', () => {
    // no capability registered → nativeCap returns null → command guard no-ops, no throw
    expect(() => emit('osc:send', { port: 1, address: '/x', args: [] })).not.toThrow();
  });
});
