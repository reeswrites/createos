import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('tone', () => {
  const gain = () => ({
    input: { __gainInput: true },
    connect: vi.fn(function () { return this; }),
    toDestination: vi.fn(function () { return this; }),
    dispose: vi.fn(),
  });
  return {
    default: {},
    Gain: vi.fn(function () { return gain(); }),
    Frequency: vi.fn((n) => ({ toMidi: () => (n === 'C4' ? 60 : n === 'E4' ? 64 : 62), toFrequency: () => 440 })),
    Time: vi.fn(() => ({ toMilliseconds: () => 200 })),
    getContext: () => ({ rawContext: {} }),
  };
});

import {
  buildFaustHandle,
  _setFaustNodeFactoryForTesting,
  FAUST_PRESETS,
} from '../../../../src/api/audio/faust.js';

function makePolyNode() {
  return {
    keyOn: vi.fn(),
    keyOff: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    destroy: vi.fn(),
  };
}

let lastNode;
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  lastNode = null;
  _setFaustNodeFactoryForTesting(async (code, opts) => {
    lastNode = makePolyNode();
    lastNode.__code = code;
    lastNode.__voices = opts.voices;
    return lastNode;
  });
});

describe('buildFaustHandle', () => {
  it('compiles asynchronously and connects the node to the output', async () => {
    const h = buildFaustHandle({ kind: 'faust', code: 'process = _;', voices: 8 });
    expect(h.kind).toBe('faust');
    expect(h.ready).toBe(false); // async
    await vi.runAllTimersAsync();
    expect(h.ready).toBe(true);
    expect(lastNode.__voices).toBe(8);
    expect(lastNode.connect).toHaveBeenCalled();
  });

  it('attack → poly keyOn(channel, midi, velocity 0-127)', async () => {
    const h = buildFaustHandle({ kind: 'faust', code: 'x' });
    await vi.runAllTimersAsync();
    h.attack('E4', undefined, 1);
    expect(lastNode.keyOn).toHaveBeenCalledWith(0, 64, 127);
  });

  it('release → poly keyOff', async () => {
    const h = buildFaustHandle({ kind: 'faust', code: 'x' });
    await vi.runAllTimersAsync();
    h.release('E4');
    expect(lastNode.keyOff).toHaveBeenCalledWith(0, 64);
  });

  it('trigger keyOns then keyOffs after the duration', async () => {
    const h = buildFaustHandle({ kind: 'faust', code: 'x' });
    await vi.runAllTimersAsync();
    h.trigger('C4', '8n', undefined, 0.5);
    expect(lastNode.keyOn).toHaveBeenCalledWith(0, 60, 64); // 0.5*127≈64
    expect(lastNode.keyOff).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(lastNode.keyOff).toHaveBeenCalledWith(0, 60);
  });

  it('default voices count is 16, poly:false requests mono (voices 0)', async () => {
    buildFaustHandle({ kind: 'faust', code: 'a' });
    await vi.runAllTimersAsync();
    expect(lastNode.__voices).toBe(16);
    buildFaustHandle({ kind: 'faust', code: 'b', poly: false });
    await vi.runAllTimersAsync();
    expect(lastNode.__voices).toBe(0);
  });

  it('dispose disconnects and disposes the node + output', async () => {
    const h = buildFaustHandle({ kind: 'faust', code: 'x' });
    await vi.runAllTimersAsync();
    h.dispose();
    expect(lastNode.disconnect).toHaveBeenCalled();
    expect(lastNode.destroy).toHaveBeenCalled();
  });

  it('triggers before compile finishes are dropped (no throw)', () => {
    const h = buildFaustHandle({ kind: 'faust', code: 'x' });
    expect(() => h.attack('C4')).not.toThrow(); // node null → no-op
  });

  it('a compile failure is swallowed (warns, no throw)', async () => {
    _setFaustNodeFactoryForTesting(async () => { throw new Error('syntax'); });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const h = buildFaustHandle({ kind: 'faust', code: 'bad' });
    await vi.runAllTimersAsync();
    expect(h.ready).toBe(false);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('FAUST_PRESETS', () => {
  it('ships physical-modelling instrument presets', () => {
    expect(Object.keys(FAUST_PRESETS)).toContain('Bowed String');
    expect(FAUST_PRESETS['Marimba']).toContain('pm.');
    expect(FAUST_PRESETS['Flute']).toContain('stdfaust.lib');
  });
});
