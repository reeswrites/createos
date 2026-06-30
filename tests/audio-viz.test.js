import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

// ── Tone.js mock ──────────────────────────────────────────────────────────────

vi.mock('tone', () => {
  let _nowVal = 0;
  const Analyser = vi.fn(function(type, bins) {
    return {
      _bins: bins,
      _type: type,
      getValue: () => new Float32Array(bins).fill(-80),
      connect: vi.fn(),
      disconnect: vi.fn(),
      dispose: vi.fn(),
    };
  });
  const EQ3 = vi.fn(function() {
    return {
      low:  { value: 0 },
      mid:  { value: 0 },
      high: { value: 0 },
      connect:       vi.fn(),
      disconnect:    vi.fn(),
      toDestination: vi.fn(),
      chain:         vi.fn(),
      dispose:       vi.fn(),
    };
  });
  const Player = vi.fn(function() {
    return {
      volume: { value: 0 },
      loop: false,
      buffer: { duration: 60, getChannelData: () => new Float32Array(100).fill(0.5) },
      toDestination: vi.fn(function() { return this; }),
      disconnect: vi.fn(),
      chain: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      dispose: vi.fn(),
      loaded: Promise.resolve(),
    };
  });
  const Synth = vi.fn(function() {
    return {
      volume: { value: 0 },
      triggerAttackRelease: vi.fn(),
      toDestination: vi.fn(function() { return this; }),
      connect: vi.fn(),
      disconnect: vi.fn(),
      chain: vi.fn(),
      dispose: vi.fn(),
    };
  });
  const PolySynth = vi.fn(function() {
    return {
      volume: { value: 0 },
      triggerAttackRelease: vi.fn(),
      toDestination: vi.fn(function() { return this; }),
      connect: vi.fn(),
      disconnect: vi.fn(),
      chain: vi.fn(),
      dispose: vi.fn(),
    };
  });
  const mockNode = () => ({
    toDestination: vi.fn(function() { return this; }),
    disconnect: vi.fn(),
    chain: vi.fn(),
    start: vi.fn(),
    dispose: vi.fn(),
  });
  return {
    default: {},
    Analyser, EQ3, Player,
    Synth, PolySynth,
    FMSynth: Synth, AMSynth: Synth, PluckSynth: Synth,
    MetalSynth: Synth, NoiseSynth: Synth, MembraneSynth: Synth,
    Filter: vi.fn(function() { return mockNode(); }),
    Reverb: vi.fn(function() { return mockNode(); }),
    FeedbackDelay: vi.fn(function() { return mockNode(); }),
    PitchShift: vi.fn(function() { return mockNode(); }),
    Distortion: vi.fn(function() { return mockNode(); }),
    Meter: vi.fn(function() { return { ...mockNode(), connect: vi.fn(), getValue: () => -80 }; }),
    Gain: vi.fn(function() { return { ...mockNode(), connect: vi.fn() }; }),
    Volume: vi.fn(function() { return { ...mockNode(), volume: { value: 0 }, connect: vi.fn() }; }),
    Channel: vi.fn(function() { return { ...mockNode(), volume: { value: 0 }, pan: { value: 0 }, mute: false, connect: vi.fn() }; }),
    connect: vi.fn(),
    UserMedia: vi.fn(function() { return { open: vi.fn().mockResolvedValue(undefined), ...mockNode() }; }),
    Chorus: vi.fn(function() { return { ...mockNode(), start: vi.fn() }; }),
    AutoFilter: vi.fn(function() { return { ...mockNode(), start: vi.fn() }; }),
    Tremolo: vi.fn(function() { return { ...mockNode(), start: vi.fn() }; }),
    Vibrato: vi.fn(function() { return mockNode(); }),
    Compressor: vi.fn(function() { return mockNode(); }),
    Loop: vi.fn(function() { return { start: vi.fn(), stop: vi.fn(), dispose: vi.fn() }; }),
    Sequence: vi.fn(function() { return { dispose: vi.fn() }; }),
    LFO: vi.fn(function() { return { ...mockNode(), start: vi.fn() }; }),
    AutoWah: vi.fn(function() { return mockNode(); }),
    Phaser: vi.fn(function() { return mockNode(); }),
    now: () => _nowVal,
    _setNow: (v) => { _nowVal = v; },
    start: vi.fn().mockResolvedValue(undefined),
    getDestination: () => ({ volume: { value: 0 }, connect: vi.fn(), disconnect: vi.fn() }),
    getTransport: () => ({
      bpm: { value: 120 },
      start: vi.fn(), stop: vi.fn(), cancel: vi.fn(), schedule: vi.fn(),
    }),
    Transport: { bpm: { value: 120 } },
    Time: (t) => ({ toSeconds: () => typeof t === 'number' ? t : 1 }),
    Frequency: (n) => ({ toFrequency: () => 440, toMidi: () => 60 }),
    Draw: { schedule: vi.fn() },
  };
});

// Import after mock
const { audio, cleanupAudio } = await import('../src/api/audio.js');
const { _noteHooks, SpectrogramCanvas, PianoRollViz } = await import('../src/api/viz.js');

// ── Helpers ───────────────────────────────────────────────────────────────────

const mockSource = () => ({
  connect: vi.fn(),
  disconnect: vi.fn(),
});

// ── audio.fft ─────────────────────────────────────────────────────────────────

describe('audio.fft', () => {
  afterEach(() => cleanupAudio());

  test('returns signal object with value/fft/bass/mid/high', () => {
    const sig = audio.fft;
    expect(typeof sig.value).toBe('number');
    expect(sig.fft).toBeInstanceOf(Float32Array);
    expect(typeof sig.bass).toBe('number');
    expect(typeof sig.mid).toBe('number');
    expect(typeof sig.high).toBe('number');
  });

  test('returns same object on repeated access', () => {
    const a = audio.fft;
    const b = audio.fft;
    expect(a).toBe(b);
  });

  test('has stream() method', () => {
    expect(typeof audio.fft.stream).toBe('function');
  });

  test('cleanupAudio() resets it so next access creates fresh signal', () => {
    const before = audio.fft;
    cleanupAudio();
    const after = audio.fft;
    expect(after).not.toBe(before);
    cleanupAudio(); // final cleanup
  });
});

// ── SpectrogramCanvas ─────────────────────────────────────────────────────────

describe('SpectrogramCanvas', () => {
  afterEach(() => cleanupAudio());

  test('creates a canvas element', () => {
    const spec = new SpectrogramCanvas(null, { bins: 32, width: 64, height: 32 });
    expect(spec.canvas).toBeInstanceOf(HTMLCanvasElement);
    spec._destroy();
  });

  test('.canvas has correct dimensions', () => {
    const spec = new SpectrogramCanvas(null, { bins: 32, width: 128, height: 64 });
    expect(spec.canvas.width).toBe(128);
    expect(spec.canvas.height).toBe(64);
    spec._destroy();
  });

  test('accepts a signal object (has .fft getter)', () => {
    // A real audio.signal() carries both value + fft (isAudioSignal is two-field).
    const fakeSig = { value: 0.5, fft: new Float32Array(32).fill(0.5) };
    const spec = new SpectrogramCanvas(fakeSig, { bins: 32, width: 64, height: 32 });
    expect(spec._signal).toBe(fakeSig);
    spec._destroy();
  });

  test('accepts a Tone node source', () => {
    const src = mockSource();
    const spec = new SpectrogramCanvas(src, { bins: 32, width: 64, height: 32 });
    expect(spec._analyser).not.toBeNull();
    spec._destroy();
  });

  test("'mic' mode sets _micMode flag", () => {
    const spec = new SpectrogramCanvas('mic', { bins: 32, width: 64, height: 32 });
    expect(spec._micMode).toBe(true);
    spec._destroy();
  });

  test('.stop() stops animation', () => {
    const spec = new SpectrogramCanvas(null, { bins: 32, width: 64, height: 32 });
    spec.stop();
    expect(spec._rafId).toBeNull();
    spec._destroy();
  });

  test('.palette() changes palette and returns this', () => {
    const spec = new SpectrogramCanvas(null, { bins: 32, width: 64, height: 32 });
    expect(spec.palette('thermal')).toBe(spec);
    expect(spec._palette).toBe('thermal');
    spec._destroy();
  });

  test('audio.spectrogram() factory creates SpectrogramCanvas', () => {
    const spec = audio.spectrogram(null, { bins: 32, width: 64, height: 32 });
    expect(spec).toBeInstanceOf(SpectrogramCanvas);
    spec._destroy();
  });
});

// ── PianoRollViz ──────────────────────────────────────────────────────────────

describe('PianoRollViz', () => {
  afterEach(() => {
    _noteHooks.length = 0;
    cleanupAudio();
  });

  test('registers a hook in _noteHooks', () => {
    const roll = new PianoRollViz({ midiMin: 36, midiMax: 96 });
    expect(_noteHooks.length).toBeGreaterThan(0);
    roll._destroy();
  });

  test('stores incoming notes', () => {
    const roll = new PianoRollViz({ midiMin: 36, midiMax: 96 });
    const hook = _noteHooks[_noteHooks.length - 1];
    hook({ note: 'C4', dur: '4n', type: 'play' });
    expect(roll._notes.length).toBe(1);
    roll._destroy();
  });

  test('ignores notes outside MIDI range', () => {
    const roll = new PianoRollViz({ midiMin: 60, midiMax: 72 });
    const hook = _noteHooks[_noteHooks.length - 1];
    hook({ note: 'C2', dur: '4n', type: 'play' }); // midi 36 < 60
    expect(roll._notes.length).toBe(0);
    roll._destroy();
  });

  test('sets note color based on MIDI value', () => {
    const roll = new PianoRollViz({ midiMin: 36, midiMax: 96 });
    const hook = _noteHooks[_noteHooks.length - 1];
    hook({ note: 'C4', dur: 0.5, type: 'play' });
    expect(roll._notes[0].color).toMatch(/^hsl\(/);
    roll._destroy();
  });

  test('removes hook on _destroy()', () => {
    const roll = new PianoRollViz({ midiMin: 36, midiMax: 96 });
    const countBefore = _noteHooks.length;
    roll._destroy();
    expect(_noteHooks.length).toBe(countBefore - 1);
  });

  test('audio.pianoRoll() factory creates PianoRollViz', () => {
    const roll = audio.pianoRoll({ midiMin: 36, midiMax: 96 });
    expect(roll).toBeInstanceOf(PianoRollViz);
    roll._destroy();
  });

  test('Instrument.play() fires note hooks', () => {
    const roll = new PianoRollViz({ midiMin: 36, midiMax: 96 });
    const synth = audio.synth();
    synth.play('C4', '4n');
    expect(roll._notes.length).toBe(1);
    roll._destroy();
  });

  test('caps notes at 500 entries', () => {
    const roll = new PianoRollViz({ midiMin: 36, midiMax: 96 });
    const hook = _noteHooks[_noteHooks.length - 1];
    for (let i = 0; i < 600; i++) hook({ note: 'C4', dur: 0.1 });
    expect(roll._notes.length).toBeLessThanOrEqual(500);
    roll._destroy();
  });
});

// ── AudioFile.waveform ────────────────────────────────────────────────────────

describe('AudioFile.waveform', () => {
  afterEach(() => cleanupAudio());

  test('returns an HTMLCanvasElement', () => {
    const file = audio.load('http://example.com/test.mp3');
    const cv = file.waveform({ width: 128, height: 32 });
    expect(cv).toBeInstanceOf(HTMLCanvasElement);
  });

  test('canvas has correct dimensions', () => {
    const file = audio.load('http://example.com/test.mp3');
    const cv = file.waveform({ width: 200, height: 50 });
    expect(cv.width).toBe(200);
    expect(cv.height).toBe(50);
  });

  test('returns different canvas each call', () => {
    const file = audio.load('http://example.com/test.mp3');
    const a = file.waveform({ width: 128, height: 32 });
    const b = file.waveform({ width: 128, height: 32 });
    expect(a).not.toBe(b);
  });
});
