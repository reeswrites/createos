// ── Binding ───────────────────────────────────────────────────────────────────
// The shared map from a Trigger (a piano key, a drum pad, a launchpad cell) to a
// Target (a Voice, an Action, or both) — ADR 046. One reusable store per Trigger
// Surface so Drumpad / Piano / Launchpad don't each re-roll binding state.
//
//   Voice target  — { voice: <inline descriptor>, handle: <lazy instantiated> }
//   Action target — { event: 'drop', silent: false }  (fires a named bus event)
//
// A binding is keyed by a surface-defined Trigger key (a pad index, a note name,
// a cell id). Voices are stored INLINE (the descriptor, not a name) so the binding
// is self-contained and travels in `.vljson` (ADR 046). Voice handles are built
// lazily on first play and disposed on dispose()/rebind.

import { Voice, normalizeVoice } from './voice.js';

export class BindingMap {
  // onVoice(handle) — optional hook the surface uses to route a freshly
  //                   instantiated Voice handle's output (to its strip/destination).
  constructor({ onVoice } = {}) {
    this._map = new Map(); // key → { voice?, handle?, event?, silent? }
    this._onVoice = onVoice ?? null;
  }

  // Bind a Voice (name or inline descriptor). Stored inline for portability.
  bindVoice(key, descOrName) {
    const k = String(key);
    const prev = this._map.get(k);
    this._disposeHandle(prev);
    const resolved = typeof descOrName === 'string' ? Voice.get(descOrName) : descOrName;
    const voice = normalizeVoice(resolved ?? descOrName);
    this._map.set(k, { ...prev, voice, handle: null });
    return this;
  }

  // Bind an Action — fire a named bus event on strike; `silent` opts out of sound.
  bindAction(key, event, { silent = false } = {}) {
    const k = String(key);
    const prev = this._map.get(k);
    this._map.set(k, { ...prev, event, silent });
    return this;
  }

  unbind(key) {
    const k = String(key);
    this._disposeHandle(this._map.get(k));
    this._map.delete(k);
    return this;
  }

  has(key) {
    return this._map.has(String(key));
  }

  get(key) {
    return this._map.get(String(key)) ?? null;
  }

  // Lazily instantiate (and route) the Voice handle for a key; null if no Voice
  // bound there.
  voiceFor(key) {
    const b = this._map.get(String(key));
    if (!b?.voice) return null;
    if (!b.handle) {
      b.handle = Voice.make(b.voice);
      try {
        this._onVoice?.(b.handle);
      } catch (_) {}
    }
    return b.handle;
  }

  // { event, silent } if an Action is bound at key, else null.
  actionFor(key) {
    const b = this._map.get(String(key));
    return b?.event ? { event: b.event, silent: !!b.silent } : null;
  }

  // True if a bound Action marks this key silent (suppress the default sound).
  isSilent(key) {
    const b = this._map.get(String(key));
    return !!(b?.event && b.silent);
  }

  // Plain-JSON snapshot for project persistence (handles are dropped; voices inline).
  serialize() {
    const out = {};
    for (const [k, b] of this._map) {
      out[k] = {};
      if (b.voice) out[k].voice = b.voice;
      if (b.event) {
        out[k].event = b.event;
        out[k].silent = !!b.silent;
      }
    }
    return out;
  }

  restore(data) {
    if (!data) return this;
    for (const [k, b] of Object.entries(data)) {
      if (b.voice) this.bindVoice(k, b.voice);
      if (b.event) this.bindAction(k, b.event, { silent: b.silent });
    }
    return this;
  }

  keys() {
    return [...this._map.keys()];
  }

  _disposeHandle(b) {
    if (b?.handle) {
      try {
        b.handle.dispose?.();
      } catch (_) {}
      b.handle = null;
    }
  }

  // Dispose every instantiated Voice handle (call on window close).
  dispose() {
    for (const b of this._map.values()) this._disposeHandle(b);
  }
}
