import { describe, it, expect, beforeEach, vi } from 'vitest';

// Leaf deps of the chassis, mocked so we test the wiring in isolation.
vi.mock('tone', () => {
  class Gain {
    constructor() {
      this.connect = vi.fn();
      this.dispose = vi.fn();
    }
  }
  return { default: {}, Gain };
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
});
