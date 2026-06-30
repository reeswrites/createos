import { describe, test, expect, beforeEach, vi } from 'vitest';

// ── Tone.js mock ──────────────────────────────────────────────────────────────
// Minimal mock that captures calls without Web Audio.

const _disposed = [];
const _chains   = [];

function makeMockNode(name = 'Node') {
  return {
    _name: name,
    volume: { value: 0 },
    loop: false,
    buffer: { duration: 120 },
    _connections: [],
    toDestination() { this._connections.push('destination'); return this; },
    disconnect() { this._connections = []; return this; },
    chain(...args) { this._connections = [...args, 'destination']; _chains.push(args); return this; },
    connect(node) { this._connections.push(node); return this; },
    start() { return this; },
    stop() { return this; },
    dispose() { _disposed.push(name); return this; },
    loaded: Promise.resolve(),
  };
}

vi.mock('tone', () => {
  let _nowVal = 0;
  const Player      = vi.fn(function() { return makeMockNode('Player'); });
  const Filter      = vi.fn(function() { return makeMockNode('Filter'); });
  const Reverb      = vi.fn(function() { return makeMockNode('Reverb'); });
  const EQ3         = vi.fn(function() { return makeMockNode('EQ3'); });
  const FeedbackDelay = vi.fn(function() { return makeMockNode('FeedbackDelay'); });
  const PitchShift  = vi.fn(function() { return makeMockNode('PitchShift'); });
  const Distortion  = vi.fn(function() { return makeMockNode('Distortion'); });
  const Analyser    = vi.fn(function() { return { getValue: () => new Float32Array(32).fill(-80) }; });
  const Meter       = vi.fn(function() { return makeMockNode('Meter'); });
  const Synth       = vi.fn(function() { return { ...makeMockNode('Synth'), triggerAttackRelease: vi.fn() }; });
  const PolySynth   = vi.fn(function() { return { ...makeMockNode('PolySynth'), triggerAttackRelease: vi.fn() }; });
  return {
    default: {},
    Player, Filter, Reverb, EQ3, FeedbackDelay, PitchShift, Distortion,
    Analyser, Meter, Synth, PolySynth,
    FMSynth: Synth, AMSynth: Synth, PluckSynth: Synth, MetalSynth: Synth,
    NoiseSynth: Synth, MembraneSynth: Synth, Sampler: Synth,
    UserMedia: vi.fn(function() { return { open: vi.fn().mockResolvedValue(undefined), ...makeMockNode('UserMedia') }; }),
    Chorus:     vi.fn(function() { return { ...makeMockNode('Chorus'),     start: vi.fn() }; }),
    AutoFilter: vi.fn(function() { return { ...makeMockNode('AutoFilter'), start: vi.fn() }; }),
    Tremolo:    vi.fn(function() { return { ...makeMockNode('Tremolo'),    start: vi.fn() }; }),
    Vibrato:    vi.fn(function() { return makeMockNode('Vibrato'); }),
    Compressor: vi.fn(function() { return makeMockNode('Compressor'); }),
    Loop:       vi.fn(function(_fn) { return { start: vi.fn(), stop: vi.fn(), dispose: vi.fn() }; }),
    Sequence:   vi.fn(function() { return { dispose: vi.fn() }; }),
    LFO:        vi.fn(function() { return { ...makeMockNode('LFO'), start: vi.fn() }; }),
    AutoWah:    vi.fn(function() { return makeMockNode('AutoWah'); }),
    Phaser:     vi.fn(function() { return makeMockNode('Phaser'); }),
    now: () => _nowVal,
    _setNow: (v) => { _nowVal = v; },
    start: vi.fn().mockResolvedValue(undefined),
    getDestination: () => ({ volume: { value: 0 } }),
    getTransport: () => ({
      bpm: { value: 120 },
      start: vi.fn(),
      stop: vi.fn(),
      cancel: vi.fn(),
      schedule: vi.fn(),
    }),
    Transport: { bpm: { value: 120 } },
    Time: (_t) => ({ toSeconds: () => 1 }),
    Frequency: (_n) => ({ toFrequency: () => 440, toMidi: () => 60 }),
    Draw: { schedule: vi.fn() },
  };
});

// Import after mock
const { audio, cleanupAudio } = await import('../src/api/audio.js');

describe('audio.load', () => {
  test('returns an object with play/stop/pause/seek/state', () => {
    const file = audio.load('http://example.com/test.mp3');
    expect(typeof file.play).toBe('function');
    expect(typeof file.stop).toBe('function');
    expect(typeof file.pause).toBe('function');
    expect(typeof file.seek).toBe('function');
    expect(file.state).toBe('stopped');
  });

  test('initial state is stopped', () => {
    const file = audio.load('http://example.com/a.mp3');
    expect(file.state).toBe('stopped');
    expect(file.currentTime).toBe(0);
  });

  test('.play() sets state to started', () => {
    const file = audio.load('http://example.com/a.mp3');
    file.play();
    expect(file.state).toBe('started');
  });

  test('.stop() sets state back to stopped and resets position', () => {
    const file = audio.load('http://example.com/a.mp3');
    file.play();
    file.stop();
    expect(file.state).toBe('stopped');
    expect(file.currentTime).toBe(0);
  });

  test('.pause() sets state to paused', () => {
    const file = audio.load('http://example.com/a.mp3');
    file.play();
    file.pause();
    expect(file.state).toBe('paused');
  });

  test('.seek() updates playOffset', () => {
    const file = audio.load('http://example.com/a.mp3');
    file.seek(30);
    expect(file.currentTime).toBe(30);
  });

  test('.loop() sets player.loop flag', () => {
    const file = audio.load('http://example.com/a.mp3');
    file.loop(true);
    expect(file._player.loop).toBe(true);
  });

  test('.loop(false) disables loop', () => {
    const file = audio.load('http://example.com/a.mp3');
    file.loop(true);
    file.loop(false);
    expect(file._player.loop).toBe(false);
  });

  test('.volume() sets player.volume.value', () => {
    const file = audio.load('http://example.com/a.mp3');
    file.volume(-12);
    expect(file._player.volume.value).toBe(-12);
  });

  test('.ready is a Promise', () => {
    const file = audio.load('http://example.com/a.mp3');
    expect(file.ready).toBeInstanceOf(Promise);
  });

  test('.duration returns buffer.duration', () => {
    const file = audio.load('http://example.com/a.mp3');
    expect(file.duration).toBe(120);
  });

  test('play() returns this for chaining', () => {
    const file = audio.load('http://example.com/a.mp3');
    expect(file.play()).toBe(file);
  });

  test('stop() returns this for chaining', () => {
    const file = audio.load('http://example.com/a.mp3');
    expect(file.stop()).toBe(file);
  });

  test('pause() returns this for chaining', () => {
    const file = audio.load('http://example.com/a.mp3');
    file.play();
    expect(file.pause()).toBe(file);
  });

  test('seek() returns this for chaining', () => {
    const file = audio.load('http://example.com/a.mp3');
    expect(file.seek(10)).toBe(file);
  });
});

describe('AudioFile FX chain', () => {
  test('.filter() adds to FX chain and returns this', () => {
    const file = audio.load('http://example.com/a.mp3');
    const result = file.filter('lowpass', 800);
    expect(result).toBe(file);
    expect(file._fxChain.length).toBe(1);
  });

  test('.reverb() adds to FX chain', () => {
    const file = audio.load('http://example.com/a.mp3');
    file.reverb(2);
    expect(file._fxChain.length).toBe(1);
    expect(file._fxChain[0]._name).toBe('Reverb');
  });

  test('.eq() adds EQ3 to chain', () => {
    const file = audio.load('http://example.com/a.mp3');
    file.eq(3, 0, -3);
    expect(file._fxChain[0]._name).toBe('EQ3');
  });

  test('.delay() adds delay node', () => {
    const file = audio.load('http://example.com/a.mp3');
    file.delay(0.5, 0.4);
    expect(file._fxChain[0]._name).toBe('FeedbackDelay');
  });

  test('.pitchShift() adds PitchShift node', () => {
    const file = audio.load('http://example.com/a.mp3');
    file.pitchShift(5);
    expect(file._fxChain[0]._name).toBe('PitchShift');
  });

  test('.distort() adds Distortion node', () => {
    const file = audio.load('http://example.com/a.mp3');
    file.distort(0.8);
    expect(file._fxChain[0]._name).toBe('Distortion');
  });

  test('chained fx accumulate in order', () => {
    const file = audio.load('http://example.com/a.mp3');
    file.filter('lowpass', 1000).reverb(1.5).eq(2, 0, -2);
    expect(file._fxChain.length).toBe(3);
    expect(file._fxChain[0]._name).toBe('Filter');
    expect(file._fxChain[1]._name).toBe('Reverb');
    expect(file._fxChain[2]._name).toBe('EQ3');
  });

  test('.chain() replaces entire FX chain', () => {
    const file = audio.load('http://example.com/a.mp3');
    file.reverb();
    const fxNode = { _name: 'CustomFX' };
    file.chain(fxNode);
    expect(file._fxChain).toEqual([fxNode]);
  });

  test('.connect() replaces chain with single node', () => {
    const file = audio.load('http://example.com/a.mp3');
    const node = { _name: 'Dest' };
    file.connect(node);
    expect(file._fxChain).toEqual([node]);
  });
});

describe('AudioFile onTime', () => {
  let ToneMock;
  beforeEach(async () => {
    ToneMock = await import('tone');
    ToneMock._setNow(0);
  });

  test('.onTime() fires callback when time >= t (via _tick)', () => {
    const file = audio.load('http://example.com/a.mp3');
    const fn = vi.fn();
    file.onTime(1, fn);
    file.play(); // _startedAt = 0, _playOffset = 0
    ToneMock._setNow(1.5);
    file._tick();
    expect(fn).toHaveBeenCalledOnce();
  });

  test('.onTime() does not fire before threshold', () => {
    const file = audio.load('http://example.com/a.mp3');
    const fn = vi.fn();
    file.onTime(5, fn);
    file.play();
    ToneMock._setNow(2);
    file._tick();
    expect(fn).not.toHaveBeenCalled();
  });

  test('.onTime() fires only once even across multiple ticks', () => {
    const file = audio.load('http://example.com/a.mp3');
    const fn = vi.fn();
    file.onTime(1, fn);
    file.play();
    ToneMock._setNow(2);
    file._tick(); file._tick(); file._tick();
    expect(fn).toHaveBeenCalledOnce();
  });

  test('.onTime() resets fired flag after stop()', () => {
    const file = audio.load('http://example.com/a.mp3');
    const fn = vi.fn();
    file.onTime(1, fn);
    file.play();
    ToneMock._setNow(2);
    file._tick();
    expect(fn).toHaveBeenCalledOnce();

    file.stop();
    ToneMock._setNow(0);
    file.play();
    ToneMock._setNow(2);
    file._tick();
    expect(fn).toHaveBeenCalledTimes(2);
  });

  test('returns this for chaining', () => {
    const file = audio.load('http://example.com/a.mp3');
    expect(file.onTime(1, () => {})).toBe(file);
  });
});

describe('AudioFile signal', () => {
  test('.signal() returns object with value/fft/bass/mid/high', () => {
    const file = audio.load('http://example.com/a.mp3');
    const sig = file.signal();
    expect(typeof sig.value).toBe('number');
    expect(sig.fft).toBeInstanceOf(Float32Array);
    expect(typeof sig.bass).toBe('number');
    expect(typeof sig.mid).toBe('number');
    expect(typeof sig.high).toBe('number');
  });

  test('.signal() has .stream() method', () => {
    const file = audio.load('http://example.com/a.mp3');
    const sig = file.signal();
    expect(typeof sig.stream).toBe('function');
  });
});

describe('cleanupAudio with AudioFile', () => {
  test('cleanupAudio() disposes AudioFile players', () => {
    const file = audio.load('http://example.com/cleanup.mp3');
    file.play();
    cleanupAudio();
    expect(file.state).toBe('stopped');
  });
});
