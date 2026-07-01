import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Drumpad, cleanupDrumpads } from '../../../src/api/audio/drumpad.js';

// ── Tone.js mock ──────────────────────────────────────────────────────────────

vi.mock('tone', () => {
  function makeSynth() {
    return {
      triggerAttackRelease: vi.fn(),
      triggerAttack: vi.fn(),
      triggerRelease: vi.fn(),
      connect: vi.fn(function() { return this; }),
      chain: vi.fn(function() { return this; }),
      start: vi.fn(),
      dispose: vi.fn(),
      toDestination() { return this; },
    };
  }
  const mk = () => vi.fn(function() { return makeSynth(); });
  return {
    default: {},
    MembraneSynth: mk(),
    NoiseSynth:    mk(),
    MetalSynth:    mk(),
    Synth:         mk(),
    FMSynth:       mk(),
    AMSynth:       mk(),
    MonoSynth:     mk(),
    DuoSynth:      mk(),
    PluckSynth:    mk(),
    PolySynth:     vi.fn(function() { return makeSynth(); }),
    Gain:          mk(),
    Reverb:        mk(),
    Chorus:        mk(),
    FeedbackDelay: mk(),
    Distortion:    mk(),
    Filter:        mk(),
    Compressor:    mk(),
    Sequence:      vi.fn(function() { return { start: vi.fn(), stop: vi.fn(), dispose: vi.fn() }; }),
    now:           () => 0,
    getTransport:  () => ({
      bpm:    { value: 120 },
      start:  vi.fn(),
      stop:   vi.fn(),
      pause:  vi.fn(),
    }),
  };
});

// ── Mixer stub — assert surface-strip routing (ADR 032/046) ────────────────────
vi.mock('../../../src/api/audio/mixer.js', () => ({
  connectSurfaceStrip: vi.fn((out, name, type) => ({ input: { __strip: name }, name, type })),
  releaseStrip: vi.fn(),
}));
import { connectSurfaceStrip, releaseStrip } from '../../../src/api/audio/mixer.js';

// ── DOM + WM stub ─────────────────────────────────────────────────────────────

let _winCounter = 0;

function makeWmWindow(id) {
  const body = document.createElement('div');
  body.className = 'wm-body';
  body.style.cssText = 'display:flex;';
  const win = document.createElement('div');
  win.id = id;
  win.appendChild(body);
  document.body.appendChild(win);
  return win;
}

beforeEach(() => {
  _winCounter = 0;
  window.wm = {
    spawn: vi.fn(() => {
      const id = `win-drumpad-test-${++_winCounter}`;
      makeWmWindow(id);
      return id;
    }),
    addHistoryControls: vi.fn(),
  };
  window.desktop = {
    add:       vi.fn(() => ({ id: 'dt-drumpad-test-1' })),
    updateUrl: vi.fn(),
  };
  window.__ar_active_editor_id = null;
  window.__ar_instances        = null;
});

afterEach(() => {
  cleanupDrumpads();
  document.querySelectorAll('[id^="win-drumpad-test-"]').forEach(el => el.remove());
  delete window.wm;
  delete window.desktop;
  delete window.__ar_active_editor_id;
  delete window.__ar_instances;
});

// ── _voiceIndex ───────────────────────────────────────────────────────────────

describe('_voiceIndex', () => {
  it('resolves numeric index', () => {
    const dp = new Drumpad();
    expect(dp._voiceIndex(0)).toBe(0);
    expect(dp._voiceIndex(7)).toBe(7);
  });

  it('resolves by id (lowercase)', () => {
    const dp = new Drumpad();
    expect(dp._voiceIndex('kick')).toBe(0);
    expect(dp._voiceIndex('snare')).toBe(1);
    expect(dp._voiceIndex('hhc')).toBe(2);
    expect(dp._voiceIndex('cym')).toBe(7);
  });

  it('resolves by label (case-insensitive)', () => {
    const dp = new Drumpad();
    expect(dp._voiceIndex('Kick')).toBe(0);
    expect(dp._voiceIndex('Snare')).toBe(1);
    expect(dp._voiceIndex('HH Cl')).toBe(2);
    expect(dp._voiceIndex('Cymbal')).toBe(7);
  });

  it('returns null for unknown voice', () => {
    const dp = new Drumpad();
    expect(dp._voiceIndex('bogus')).toBeNull();
    expect(dp._voiceIndex(99)).toBeNull();
  });

  it('returns null for null input', () => {
    const dp = new Drumpad();
    expect(dp._voiceIndex(null)).toBeNull();
  });
});

// ── onHit ─────────────────────────────────────────────────────────────────────

describe('onHit', () => {
  it('fires on any pad trigger', () => {
    const dp = new Drumpad();
    const hits = [];
    dp.onHit(ev => hits.push(ev));

    dp._trigger(0, 0, { source: 'pad' });
    dp._trigger(3, 0, { source: 'key' });
    expect(hits).toHaveLength(2);
  });

  it('payload has correct fields', () => {
    const dp = new Drumpad();
    let captured;
    dp.onHit(ev => { captured = ev; });
    dp._trigger(0, 0, { source: 'pad', step: null });
    expect(captured).toMatchObject({ vi: 0, id: 'kick', label: 'Kick', source: 'pad', step: null });
  });

  it('fires for all voices', () => {
    const dp = new Drumpad();
    const vis = [];
    dp.onHit(ev => vis.push(ev.vi));
    for (let i = 0; i < 8; i++) dp._trigger(i, 0, { source: 'pad' });
    expect(vis).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('returns dp for chaining', () => {
    const dp = new Drumpad();
    expect(dp.onHit(() => {})).toBe(dp);
  });
});

// ── onPad ─────────────────────────────────────────────────────────────────────

describe('onPad', () => {
  it('fires only for the specified pad index', () => {
    const dp = new Drumpad();
    const hits = [];
    dp.onPad(0, ev => hits.push(ev.vi));

    dp._trigger(0, 0, { source: 'pad' }); // kick — should fire
    dp._trigger(1, 0, { source: 'pad' }); // snare — should NOT
    dp._trigger(0, 0, { source: 'seq', step: 3 }); // kick again

    expect(hits).toEqual([0, 0]);
  });

  it('accepts string name', () => {
    const dp = new Drumpad();
    const labels = [];
    dp.onPad('snare', ev => labels.push(ev.label));
    dp._trigger(0, 0, { source: 'pad' }); // kick — ignored
    dp._trigger(1, 0, { source: 'pad' }); // snare
    expect(labels).toEqual(['Snare']);
  });

  it('accepts case-insensitive label', () => {
    const dp = new Drumpad();
    const fired = [];
    dp.onPad('Cymbal', ev => fired.push(ev.id));
    dp._trigger(7, 0, { source: 'key' });
    expect(fired).toEqual(['cym']);
  });

  it('warns on unknown voice and does not throw', () => {
    const dp = new Drumpad();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    dp.onPad('bogus', () => {});
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('unknown voice'));
    warn.mockRestore();
  });

  it('source field reflects trigger context', () => {
    const dp = new Drumpad();
    let src;
    dp.onPad(0, ev => { src = ev.source; });
    dp._trigger(0, 0, { source: 'seq', step: 4 });
    expect(src).toBe('seq');
  });

  it('step field is set from sequencer context', () => {
    const dp = new Drumpad();
    let s;
    dp.onPad(0, ev => { s = ev.step; });
    dp._trigger(0, 0, { source: 'seq', step: 7 });
    expect(s).toBe(7);
  });

  it('returns dp for chaining', () => {
    const dp = new Drumpad();
    expect(dp.onPad(0, () => {})).toBe(dp);
  });
});

// ── onStep ────────────────────────────────────────────────────────────────────

describe('onStep', () => {
  it('fires step hooks with correct payload', () => {
    const dp = new Drumpad();
    const steps = [];
    dp.onStep(ev => steps.push(ev));

    // Emit a step event directly (as the sequencer would)
    dp._events.emit('step', { step: 3, activeVoices: [0, 2] });

    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ step: 3, activeVoices: [0, 2] });
  });

  it('returns dp for chaining', () => {
    const dp = new Drumpad();
    expect(dp.onStep(() => {})).toBe(dp);
  });
});

// ── signal ────────────────────────────────────────────────────────────────────

describe('signal', () => {
  it('value is 0 before any hit', () => {
    const dp = new Drumpad();
    const sig = dp.signal('kick');
    expect(sig.value).toBe(0);
  });

  it('value is 1 immediately after hit (mocked performance.now)', () => {
    const dp = new Drumpad();
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);

    const sig = dp.signal('kick', { decay: 500 });
    dp._trigger(0, 0, { source: 'pad' }); // stamp lastHit = now (0)
    // Still at t=0 → value = 1 - 0/500 = 1
    expect(sig.value).toBeCloseTo(1, 5);

    vi.restoreAllMocks();
  });

  it('value decays over time', () => {
    const dp = new Drumpad();
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);

    const sig = dp.signal('kick', { decay: 400 });
    dp._trigger(0, 0, { source: 'pad' }); // hit at t=0

    now = 200; // halfway through decay
    expect(sig.value).toBeCloseTo(0.5, 3);

    now = 400; // fully decayed
    expect(sig.value).toBe(0);

    now = 600; // past decay
    expect(sig.value).toBe(0);

    vi.restoreAllMocks();
  });

  it('velocity is an alias for value', () => {
    const dp = new Drumpad();
    const sig = dp.signal(0);
    expect(sig.velocity).toBe(sig.value);
  });

  it('only reacts to the specified pad', () => {
    const dp = new Drumpad();
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);

    const sig = dp.signal('kick', { decay: 500 }); // kick = vi 0
    dp._trigger(1, 0, { source: 'pad' }); // snare — should NOT update kick signal
    expect(sig.value).toBe(0);

    dp._trigger(0, 0, { source: 'pad' }); // kick — SHOULD update
    expect(sig.value).toBeCloseTo(1, 5);

    vi.restoreAllMocks();
  });

  it('whole-kit signal reacts to any pad', () => {
    const dp = new Drumpad();
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);

    const sig = dp.signal(null, { decay: 500 });
    dp._trigger(3, 0, { source: 'pad' }); // any pad
    expect(sig.value).toBeCloseTo(1, 5);

    vi.restoreAllMocks();
  });

  it('omitting voice gives whole-kit signal', () => {
    const dp = new Drumpad();
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);

    const sig = dp.signal(); // no voice arg
    dp._trigger(5, 0, { source: 'pad' });
    expect(sig.value).toBeCloseTo(1, 5);

    vi.restoreAllMocks();
  });
});

// ── cleanupDrumpads ───────────────────────────────────────────────────────────

describe('cleanupDrumpads', () => {
  it('empties hit hooks so re-registration does not duplicate', () => {
    const dp = new Drumpad();
    const calls = [];
    dp.onHit(() => calls.push('a'));
    // hook registered — verify it fires
    dp._trigger(0, 0, { source: 'pad' });
    expect(calls).toEqual(['a']);

    cleanupDrumpads();
    // after clear, old hook must NOT fire
    dp._trigger(0, 0, { source: 'pad' });
    expect(calls).toEqual(['a']); // still just ['a']

    // Re-register after cleanup — should fire exactly once
    dp.onHit(() => calls.push('b'));
    dp._trigger(0, 0, { source: 'pad' });
    expect(calls).toEqual(['a', 'b']);
  });

  it('empties step hooks', () => {
    const dp = new Drumpad();
    const steps = [];
    dp.onStep(ev => steps.push(ev));
    dp._events.emit('step', { step: 0, activeVoices: [] });
    expect(steps).toHaveLength(1);

    cleanupDrumpads();
    dp._events.emit('step', { step: 1, activeVoices: [] });
    expect(steps).toHaveLength(1); // cleared — no new step pushed
  });

  it('works on multiple instances', () => {
    const dp1 = new Drumpad();
    const dp2 = new Drumpad();
    const calls1 = [], calls2 = [];
    dp1.onHit(() => calls1.push(1));
    dp2.onHit(() => calls2.push(2));
    dp2.onHit(() => calls2.push(2));
    cleanupDrumpads();
    dp1._trigger(0, 0, { source: 'pad' });
    dp2._trigger(0, 0, { source: 'pad' });
    expect(calls1).toHaveLength(0);
    expect(calls2).toHaveLength(0);
  });
});

// ── _destroy removes from registry ────────────────────────────────────────────

describe('_destroy', () => {
  it('removes drumpad from global registry', async () => {
    // Import module-level _drumpads indirectly via cleanupDrumpads side effects
    const dp = new Drumpad();
    const calls = [];
    dp.onHit(() => calls.push(1));

    // Destroy via _wmCleanup (closes the window)
    const win = document.getElementById(dp._winId);
    win?._wmCleanup?.();

    // After destroy, cleanupDrumpads should not call hooks (dp removed from registry)
    cleanupDrumpads();
    dp._trigger(0, 0, { source: 'pad' }); // hooks cleared by destroy
    expect(calls).toHaveLength(0);
  });
});

// ── Bindings (ADR 046) ─────────────────────────────────────────────────────────

import { on } from '../../../src/events/index.js';
import { Voice, _resetVoicesForTesting } from '../../../src/api/audio/voice.js';

describe('drumpad bindings', () => {
  it('a bound Voice supersedes the default pad synth on trigger', () => {
    const dp = new Drumpad();
    const defaultSynth = dp._voices[0].synth;
    dp.bind(0, { engine: 'fm' });
    dp._trigger(0, 0, { source: 'pad' });
    const handle = dp._bindings.voiceFor(0);
    expect(handle.node.triggerAttackRelease).toHaveBeenCalled();
    expect(defaultSynth.triggerAttackRelease).not.toHaveBeenCalled();
  });

  it('bindAction fires a named bus event on strike', () => {
    const dp = new Drumpad();
    let got = null;
    on('drop').do((p) => { got = p; });
    dp.bindAction(1, 'drop');
    dp._trigger(1, 0, { source: 'pad' });
    expect(got).toMatchObject({ vi: 1, source: 'pad' });
  });

  it('a silent action suppresses the pad sound but still fires the event', () => {
    const dp = new Drumpad();
    const synth = dp._voices[2].synth;
    let fired = false;
    on('mute-evt').do(() => { fired = true; });
    dp.bindAction(2, 'mute-evt', { silent: true });
    dp._trigger(2, 0, { source: 'pad' });
    expect(synth.triggerAttackRelease).not.toHaveBeenCalled();
    expect(fired).toBe(true);
  });

  it('bind accepts a registered Voice name, stored inline', () => {
    _resetVoicesForTesting();
    Voice.define('Wub', { engine: 'mono' });
    const dp = new Drumpad();
    dp.bind('kick', 'Wub');
    expect(dp._bindings.get(0).voice.engine).toBe('mono');
  });

  it('serialized state includes bindings and round-trips through the constructor', () => {
    const dp = new Drumpad();
    dp.bind(0, { engine: 'am' });
    dp.bindAction(3, 'x', { silent: true });
    const state = { bindings: dp._bindings.serialize() };
    const dp2 = new Drumpad({ bindings: state.bindings });
    expect(dp2._bindings.get(0).voice.engine).toBe('am');
    expect(dp2._bindings.actionFor(3)).toEqual({ event: 'x', silent: true });
  });

  it('unbind reverts a pad to its default synth', () => {
    const dp = new Drumpad();
    dp.bind(0, { engine: 'fm' });
    dp.unbind(0);
    const synth = dp._voices[0].synth;
    dp._trigger(0, 0, { source: 'pad' });
    expect(synth.triggerAttackRelease).toHaveBeenCalled();
  });
});

// ── Groovebox rework (P3) ───────────────────────────────────────────────────────

describe('drumpad groovebox', () => {
  it('configurable step count', () => {
    const dp = new Drumpad({ steps: 32 });
    expect(dp._steps).toBe(32);
    expect(dp._voices[0].steps.length).toBe(32);
    expect(dp._voices[0].vels.length).toBe(32);
  });

  it('configurable pad count (1-8 subset)', () => {
    const dp = new Drumpad({ pads: 4 });
    expect(dp._voices.length).toBe(4);
    const dp8 = new Drumpad({ pads: 99 });
    expect(dp8._voices.length).toBe(8); // clamped to kit size
  });

  it('step accepts a velocity; accent sets it without toggling', () => {
    const dp = new Drumpad();
    dp.step(0, 0, true, 0.5);
    expect(dp._voices[0].steps[0]).toBe(true);
    expect(dp._voices[0].vels[0]).toBe(0.5);
    dp.accent(0, 0, 0.33);
    expect(dp._voices[0].vels[0]).toBe(0.33);
    expect(dp._voices[0].steps[0]).toBe(true); // still on
  });

  it('sequencer passes per-step velocity to the trigger', () => {
    const dp = new Drumpad();
    dp.step(0, 0, true, 0.66);
    const hits = [];
    dp.onHit((e) => hits.push(e.velocity));
    // simulate the sequence firing step 0 for voice 0
    dp._trigger(0, 0, { source: 'seq', step: 0, vel: dp._voices[0].vels[0] });
    expect(hits[0]).toBe(0.66);
  });

  it('swing clamps to 0-1 and applies to the transport', () => {
    const dp = new Drumpad();
    dp.swing(0.5);
    expect(dp._swing).toBe(0.5);
    dp.swing(9);
    expect(dp._swing).toBe(1);
  });

  it('serialized state carries steps/pads/swing/velocities and round-trips', () => {
    const dp = new Drumpad({ steps: 8, pads: 3, swing: 0.4 });
    dp.step(0, 2, true, 0.33);
    const state = {
      steps: dp._steps,
      pads: dp._voices.length,
      swing: dp._swing,
      patterns: dp._voices.map((v) => [...v.steps]),
      velocities: dp._voices.map((v) => [...v.vels]),
    };
    const dp2 = new Drumpad(state);
    expect(dp2._steps).toBe(8);
    expect(dp2._voices.length).toBe(3);
    expect(dp2._swing).toBe(0.4);
    expect(dp2._voices[0].steps[2]).toBe(true);
    expect(dp2._voices[0].vels[2]).toBe(0.33);
  });
});

// ── Mixer strip routing (ADR 032/046, #1) ──────────────────────────────────────

describe('drumpad mixer strip', () => {
  it('acquires one window-scoped strip for the whole pad', () => {
    const dp = new Drumpad({ title: 'Beat' });
    expect(connectSurfaceStrip).toHaveBeenCalledWith(dp._out, 'Beat', 'drumpad', dp._winId);
  });

  it('a bound voice routes into the surface bus (_out), not Destination', () => {
    const dp = new Drumpad();
    dp.bind(0, { engine: 'fm' });
    const h = dp._bindings.voiceFor(0);
    expect(h.output.connect).toHaveBeenCalledWith(dp._out);
  });

  it('releases the strip on destroy', () => {
    const dp = new Drumpad({ title: 'Beat2' });
    dp._destroy(dp._playBtn);
    expect(releaseStrip).toHaveBeenCalledWith('Beat2');
  });
});
