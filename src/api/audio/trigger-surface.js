// trigger-surface.js — shared chassis for Trigger Surfaces (Piano/Drumpad/Launchpad).
//
// Composition helpers (ADR 007 discipline — NOT a base class). ADR 046 shared the
// BindingMap + Voice model, but the three surfaces still hand-rolled the identical
// wiring AROUND it: an output bus summed into one window-scoped mixer Strip (ADR
// 032), the BindingMap voice→bus router, the MIDI register/notify lifecycle (ADR
// 033), the Performance Take (ADR 031), and the mirror-image teardown. That
// boilerplate lives here once. Each surface keeps its own strike path, key
// resolution, UI, and synth/voice ownership — the parts that actually differ.

import * as Tone from 'tone';
import { WidgetEvents } from '../widgets/widget-events.js';
import { BindingMap } from './binding.js';
import { releaseStrip } from './mixer.js';
import { registerMidiInstrument, unregisterMidiInstrument, notifyMidiFocus } from './midi-bind.js';
import { Take } from '../signal/performance-recorder.js';
import { replayActions } from '../signal/replay-clock.js';
import { notify } from '../../events/index.js';

// Install the shared chassis onto `self`. Call early in the constructor (Piano
// needs self._out before it builds its preset synth). Sets:
//   self._out       — the surface bus every voice sums into
//   self._strip     — null until _init connects it via connectSurfaceStrip
//   self._bindings  — BindingMap with the voice→bus router (restores `bindings`)
//   self._events    — WidgetEvents for onHit/signals
//   self._take      — the Performance Take
// and enrolls `self` in the module `registry` array.
export function initTriggerSurface(self, { registry, bindings } = {}) {
  self._out = new Tone.Gain();
  self._strip = null;
  self._bindings = new BindingMap({
    onVoice: (handle) => {
      try {
        handle.output.connect(self._out);
      } catch (_) {}
    },
  });
  if (bindings) self._bindings.restore(bindings);
  self._events = new WidgetEvents();
  self._take = new Take(self);
  // Every surface's replay() was byte-identical — the only variation is the
  // per-surface _applyAction it dispatches to. Install it here so each surface
  // owns only _applyAction (ADR 031/056).
  self.replay = (actions, opts) => replayActions((a) => self._applyAction(a), actions, opts);
  registry.push(self);
}

// The strike ENVELOPE — the dispatch scaffolding every Trigger Surface wraps its
// sound production in (ADR 056 refinement). Owns the ordering that must not vary:
//   1. play the sound UNLESS the trigger is bound silent  (isSilent gate)
//   2. fire the bound Action's named bus event, if any    (actionFor → notify)
//   3. run the surface's post-hook (UI flash + WidgetEvents emit + Take capture)
// Each step's CONTENT is a per-surface closure — the sound core, the event payload,
// and the after-hook genuinely differ (attack/release vs one-shot vs chopped slice;
// {note} vs {vi} vs {cell}). What was copy-pasted three ways is the gate/try/notify
// STRUCTURE, and the "silent action still emits" bug now has one home.
export function strikeCore(self, key, { sound, payload, after }) {
  if (!self._bindings.isSilent(key)) {
    try {
      sound();
    } catch (_) {}
  }
  const action = self._bindings.actionFor(key);
  if (action) {
    try {
      notify(action.event, payload());
    } catch (_) {}
  }
  after?.();
}

// Enable MIDI input for the surface once its window exists. Call at the tail of
// the constructor, after _init() has set self._winId. Registers the surface as a
// MIDI instrument and claims focus (the window just spawned frontmost); permission
// is checked silently upstream, so no prompt unless already granted.
export function enableSurfaceMidi(self) {
  if (self._winId) {
    registerMidiInstrument(self);
    notifyMidiFocus(self);
  }
}

// Detach the surface from global lifecycle registries. Call FIRST in _destroy(),
// before the surface disposes its own synth/voices.
export function detachTriggerSurface(self, registry) {
  unregisterMidiInstrument(self);
  const idx = registry.indexOf(self);
  if (idx >= 0) registry.splice(idx, 1);
}

// Dispose the shared chassis: any default Voice handle, the BindingMap, the mixer
// Strip, and the output bus. Call LAST in _destroy(), after surface-specific
// disposal. Safe on surfaces without a default handle (optional chaining).
export function disposeTriggerSurface(self) {
  try {
    self._defaultHandle?.dispose?.();
  } catch (_) {}
  try {
    self._bindings.dispose();
  } catch (_) {}
  if (self._strip) {
    try {
      releaseStrip(self._title);
    } catch (_) {}
    self._strip = null;
  }
  try {
    self._out?.dispose?.();
  } catch (_) {}
}
