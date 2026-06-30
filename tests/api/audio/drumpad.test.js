import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Drumpad, cleanupDrumpads } from '../../../src/api/audio/drumpad.js';

// ── Tone.js mock ──────────────────────────────────────────────────────────────

vi.mock('tone', () => {
  function makeSynth() {
    return {
      triggerAttackRelease: vi.fn(),
      dispose: vi.fn(),
      toDestination() { return this; },
    };
  }
  return {
    default: {},
    MembraneSynth: vi.fn(function() { return makeSynth(); }),
    NoiseSynth:    vi.fn(function() { return makeSynth(); }),
    MetalSynth:    vi.fn(function() { return makeSynth(); }),
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
