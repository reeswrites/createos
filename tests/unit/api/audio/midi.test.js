import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { midi, cleanupMidi } from '../../../../src/api/audio/midi.js';

// MIDI message helpers
function noteOn(note, vel, ch = 0)  { return { data: [0x90 | ch, note, vel] }; }
function noteOff(note, vel, ch = 0) { return { data: [0x80 | ch, note, vel] }; }
function cc(cc, val, ch = 0)        { return { data: [0xB0 | ch, cc, val] }; }

function mockMidiAccess(inputs = []) {
  const inputMap = new Map(inputs.map((inp, i) => [String(i), inp]));
  return {
    inputs: inputMap,
    onstatechange: null,
  };
}

beforeEach(async () => {
  // Reset midi state between tests
  midi._access = null;
  midi._noteHandlers.length = 0;
  midi._ccHandlers.length  = 0;
  midi._signals.clear();
  midi._cleanupFns.length  = 0;
});

afterEach(() => {
  cleanupMidi();
  vi.restoreAllMocks();
});

describe('midi.open()', () => {
  it('calls navigator.requestMIDIAccess and caches result', async () => {
    const access = mockMidiAccess();
    navigator.requestMIDIAccess = vi.fn().mockResolvedValue(access);
    await midi.open();
    expect(navigator.requestMIDIAccess).toHaveBeenCalledWith({ sysex: false });
    expect(midi._access).toBe(access);
  });

  it('does not call requestMIDIAccess twice', async () => {
    const access = mockMidiAccess();
    navigator.requestMIDIAccess = vi.fn().mockResolvedValue(access);
    await midi.open();
    await midi.open();
    expect(navigator.requestMIDIAccess).toHaveBeenCalledOnce();
  });

  it('throws if Web MIDI not supported', async () => {
    delete navigator.requestMIDIAccess;
    await expect(midi.open()).rejects.toThrow('Web MIDI not supported');
  });

  it('returns midi for chaining', async () => {
    const access = mockMidiAccess();
    navigator.requestMIDIAccess = vi.fn().mockResolvedValue(access);
    expect(await midi.open()).toBe(midi);
  });
});

describe('midi.inputs()', () => {
  it('returns empty array before open', () => {
    expect(midi.inputs()).toEqual([]);
  });

  it('returns mapped input list after open', async () => {
    const inp = { id: '1', name: 'Keys', manufacturer: 'Roland', state: 'connected', onmidimessage: null };
    const access = mockMidiAccess([inp]);
    navigator.requestMIDIAccess = vi.fn().mockResolvedValue(access);
    await midi.open();
    const inputs = midi.inputs();
    expect(inputs).toHaveLength(1);
    expect(inputs[0].name).toBe('Keys');
  });
});

describe('midi._dispatch note messages', () => {
  it('fires onNote handler for note-on', () => {
    const fn = vi.fn();
    midi.onNote(fn);
    midi._dispatch(noteOn(60, 100));
    expect(fn).toHaveBeenCalledWith({ type: 'noteon', note: 60, velocity: 100, channel: 0 });
  });

  it('fires onNote handler for note-off (0x80)', () => {
    const fn = vi.fn();
    midi.onNote(fn);
    midi._dispatch(noteOff(60, 0));
    expect(fn).toHaveBeenCalledWith({ type: 'noteoff', note: 60, velocity: 0, channel: 0 });
  });

  it('treats 0x90 with vel=0 as note-off', () => {
    const fn = vi.fn();
    midi.onNote(fn);
    midi._dispatch({ data: [0x90, 60, 0] });
    expect(fn).toHaveBeenCalledWith(expect.objectContaining({ type: 'noteoff' }));
  });

  it('includes channel from status byte', () => {
    const fn = vi.fn();
    midi.onNote(fn);
    midi._dispatch(noteOn(48, 80, 5));  // ch 5
    expect(fn).toHaveBeenCalledWith(expect.objectContaining({ channel: 5 }));
  });
});

describe('midi._dispatch CC messages', () => {
  it('fires onCC handler with normalized value', () => {
    const fn = vi.fn();
    midi.onCC(0, 7, fn);
    midi._dispatch(cc(7, 127, 0));
    expect(fn).toHaveBeenCalledWith(1.0);
  });

  it('onCC only fires for matching channel+cc', () => {
    const fn = vi.fn();
    midi.onCC(0, 1, fn);
    midi._dispatch(cc(2, 64, 0));  // different CC
    midi._dispatch(cc(1, 64, 1));  // different channel
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('midi.signal()', () => {
  it('returns signal with .value starting at 0', () => {
    const sig = midi.signal(0, 7);
    expect(sig.value).toBe(0);
  });

  it('signal.value updates on CC dispatch', () => {
    const sig = midi.signal(0, 7);
    midi._dispatch(cc(7, 64, 0));
    expect(sig.value).toBeCloseTo(64 / 127);
  });

  it('same channel+cc returns same signal object', () => {
    expect(midi.signal(0, 1)).toBe(midi.signal(0, 1));
  });

  it('different cc returns different signal', () => {
    expect(midi.signal(0, 1)).not.toBe(midi.signal(0, 2));
  });
});

describe('cleanupMidi()', () => {
  it('removes registered handlers', () => {
    const fn = vi.fn();
    midi.onNote(fn);
    cleanupMidi();
    midi._dispatch(noteOn(60, 80));
    expect(fn).not.toHaveBeenCalled();
  });

  it('clears cleanupFns array', () => {
    midi.onNote(() => {});
    cleanupMidi();
    expect(midi._cleanupFns).toHaveLength(0);
  });
});
