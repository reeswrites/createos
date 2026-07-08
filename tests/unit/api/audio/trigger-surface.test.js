import { describe, it, expect, beforeEach, vi } from 'vitest';

// Leaf deps of the chassis, mocked so we test the wiring in isolation.
const transport = { start: vi.fn(), pause: vi.fn(), stop: vi.fn() };
vi.mock('tone', () => {
  class Gain {
    constructor() {
      this.connect = vi.fn();
      this.dispose = vi.fn();
    }
  }
  class Sequence {
    constructor(cb, values, subdiv) {
      this.cb = cb;
      this.values = values;
      this.subdiv = subdiv;
      this.start = vi.fn();
      this.stop = vi.fn();
      this.dispose = vi.fn();
    }
  }
  return { default: {}, Gain, Sequence, getTransport: () => transport };
});

vi.mock('../../../../src/api/audio/binding.js', () => {
  class BindingMap {
    constructor(opts) {
      this._opts = opts;
      this.restore = vi.fn();
      this.dispose = vi.fn();
    }
  }
  return { BindingMap };
});

vi.mock('../../../../src/api/audio/mixer.js', () => ({
  releaseStrip: vi.fn(),
}));

vi.mock('../../../../src/api/audio/midi-bind.js', () => ({
  registerMidiInstrument: vi.fn(),
  unregisterMidiInstrument: vi.fn(),
  notifyMidiFocus: vi.fn(),
}));

vi.mock('../../../../src/api/widgets/widget-events.js', () => ({
  WidgetEvents: class {},
}));

vi.mock('../../../../src/api/signal/performance-recorder.js', () => ({
  Take: class {
    constructor(owner) {
      this.owner = owner;
    }
  },
}));

import {
  initTriggerSurface,
  enableSurfaceMidi,
  detachTriggerSurface,
  disposeTriggerSurface,
  surfaceState,
  createStepClock,
} from '../../../../src/api/audio/trigger-surface.js';
import { releaseStrip } from '../../../../src/api/audio/mixer.js';
import {
  registerMidiInstrument,
  unregisterMidiInstrument,
  notifyMidiFocus,
} from '../../../../src/api/audio/midi-bind.js';

describe('trigger-surface chassis (ADR 056)', () => {
  let self, registry;
  beforeEach(() => {
    vi.clearAllMocks();
    self = { _title: 'Pad' };
    registry = [];
  });

  describe('initTriggerSurface', () => {
    it('installs the shared fields and enrolls in the registry', () => {
      initTriggerSurface(self, { registry });
      expect(self._out).toBeTruthy();
      expect(self._strip).toBeNull();
      expect(self._bindings).toBeTruthy();
      expect(self._events).toBeTruthy();
      expect(self._take).toBeTruthy();
      expect(self._take.owner).toBe(self);
      expect(registry).toContain(self);
    });

    it('routes bound voices into the surface bus via onVoice', () => {
      initTriggerSurface(self, { registry });
      const handle = { output: { connect: vi.fn() } };
      self._bindings._opts.onVoice(handle);
      expect(handle.output.connect).toHaveBeenCalledWith(self._out);
    });

    it('restores serialized bindings when provided', () => {
      const bindings = { 0: { voice: {} } };
      initTriggerSurface(self, { registry, bindings });
      expect(self._bindings.restore).toHaveBeenCalledWith(bindings);
    });

    it('does not restore when no bindings given', () => {
      initTriggerSurface(self, { registry });
      expect(self._bindings.restore).not.toHaveBeenCalled();
    });
  });

  describe('enableSurfaceMidi', () => {
    it('registers + claims focus when a window exists', () => {
      self._winId = 'win-1';
      enableSurfaceMidi(self);
      expect(registerMidiInstrument).toHaveBeenCalledWith(self);
      expect(notifyMidiFocus).toHaveBeenCalledWith(self);
    });

    it('is a no-op with no window', () => {
      self._winId = null;
      enableSurfaceMidi(self);
      expect(registerMidiInstrument).not.toHaveBeenCalled();
    });
  });

  describe('detachTriggerSurface', () => {
    it('unregisters MIDI and removes self from the registry', () => {
      registry.push(self);
      detachTriggerSurface(self, registry);
      expect(unregisterMidiInstrument).toHaveBeenCalledWith(self);
      expect(registry).not.toContain(self);
    });
  });

  describe('disposeTriggerSurface', () => {
    it('disposes default handle, bindings, strip, and out', () => {
      initTriggerSurface(self, { registry });
      self._defaultHandle = { dispose: vi.fn() };
      self._strip = { name: 'Pad' };
      const out = self._out;
      disposeTriggerSurface(self);
      expect(self._defaultHandle.dispose).toHaveBeenCalled();
      expect(self._bindings.dispose).toHaveBeenCalled();
      expect(releaseStrip).toHaveBeenCalledWith('Pad');
      expect(self._strip).toBeNull();
      expect(out.dispose).toHaveBeenCalled();
    });

    it('is safe on a surface with no default handle or strip', () => {
      initTriggerSurface(self, { registry });
      self._strip = null;
      expect(() => disposeTriggerSurface(self)).not.toThrow();
      expect(releaseStrip).not.toHaveBeenCalled();
    });
  });

  describe('surfaceState', () => {
    it('stamps the shared identity envelope plus per-surface extras', () => {
      const s = {
        _title: 'Kit',
        _defaultDesc: { engine: 'fm' },
        _desktopIconId: 7,
        _bindings: { serialize: () => ({ 0: 'x' }) },
      };
      expect(surfaceState(s, { bpm: 120, steps: 16 })).toEqual({
        title: 'Kit',
        voice: { engine: 'fm' },
        bindings: { 0: 'x' },
        _desktopIconId: 7,
        bpm: 120,
        steps: 16,
      });
    });

    it('leaves voice undefined when the surface has no default voice (drumpad)', () => {
      const s = { _title: 'Beat', _desktopIconId: null, _bindings: { serialize: () => ({}) } };
      const out = surfaceState(s, { pads: 4 });
      expect(out.voice).toBeUndefined();
      expect(out.pads).toBe(4);
    });
  });

  describe('createStepClock', () => {
    let playBtn;
    beforeEach(() => {
      vi.clearAllMocks();
      playBtn = { textContent: '', style: {} };
    });

    it('play → pause → resume drives Transport and flips the button', () => {
      const perStep = vi.fn();
      const clock = createStepClock({ steps: 4, perStep, playBtn });
      clock.toggle(); // play
      expect(clock.playing).toBe(true);
      expect(clock.paused).toBe(false);
      expect(transport.start).toHaveBeenCalledTimes(1);
      expect(playBtn.textContent).toBe('⏸ Pause');

      clock.toggle(); // pause
      expect(clock.paused).toBe(true);
      expect(transport.pause).toHaveBeenCalledTimes(1);
      expect(playBtn.textContent).toBe('▶ Play');

      clock.toggle(); // resume
      expect(clock.paused).toBe(false);
      expect(transport.start).toHaveBeenCalledTimes(2);
      expect(playBtn.textContent).toBe('⏸ Pause');
    });

    it('runs onStart before the Sequence and calls perStep with wrapped step index', () => {
      const order = [];
      const perStep = vi.fn((s) => order.push(s));
      const clock = createStepClock({
        steps: () => 2,
        perStep,
        playBtn,
        onStart: () => order.push('start'),
      });
      clock.toggle();
      expect(order[0]).toBe('start');
      // drive the Sequence callback three times → index wraps 0,1,0
      clock._sequence.cb(0);
      clock._sequence.cb(0);
      clock._sequence.cb(0);
      expect(order.slice(1)).toEqual([0, 1, 0]);
    });

    it('stop() tears down the sequence, resets state, clears highlight, resets button', () => {
      const onStop = vi.fn();
      const clock = createStepClock({ steps: 4, perStep: vi.fn(), playBtn, onStop });
      clock.toggle();
      const seq = clock._sequence;
      clock.stop();
      expect(seq.stop).toHaveBeenCalled();
      expect(seq.dispose).toHaveBeenCalled();
      expect(clock._sequence).toBeNull();
      expect(clock.playing).toBe(false);
      expect(onStop).toHaveBeenCalled();
      expect(transport.stop).toHaveBeenCalled();
      expect(playBtn.textContent).toBe('▶ Play');
    });
  });
});
