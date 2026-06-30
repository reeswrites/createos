import { onReset } from '../runtime/reset-registry.js';
import { notify } from '../events/index.js';
// midi.js — Web MIDI API wrapper (#40)
// midi.open() → Promise<midi>; midi.inputs(); midi.onNote(fn); midi.onCC(ch,cc,fn);
// midi.signal(ch,cc) → live signal; midi.spawn() → MIDI monitor window

const _midi = {
  _access: null,
  _noteHandlers: [],
  _ccHandlers: [],
  _signals: new Map(), // `ch:cc` → { _val, value getter }
  _cleanupFns: [],

  async open() {
    if (_midi._access) return _midi;
    if (!navigator.requestMIDIAccess) throw new Error('Web MIDI not supported in this browser');
    _midi._access = await navigator.requestMIDIAccess({ sysex: false });
    _midi._access.inputs.forEach((input) => _midi._setupInput(input));
    _midi._access.onstatechange = (e) => {
      if (e.port.type === 'input' && e.port.state === 'connected') {
        _midi._setupInput(e.port);
      }
    };
    notify('midi:open', { inputs: _midi.inputs() });
    return _midi;
  },

  _setupInput(input) {
    input.onmidimessage = (e) => _midi._dispatch(e);
  },

  _dispatch(e) {
    const [status, data1, data2 = 0] = e.data;
    const type = status & 0xf0;
    const channel = status & 0x0f;

    if (status === 0xf8) {
      // MIDI clock (24 PPQ)
      notify('midi:clock', {});
    } else if (type === 0x90 && data2 > 0) {
      const ev = { note: data1, velocity: data2, channel };
      notify('midi:note:on', ev);
      for (const fn of _midi._noteHandlers) fn({ type: 'noteon', ...ev });
    } else if (type === 0x80 || (type === 0x90 && data2 === 0)) {
      const ev = { note: data1, velocity: data2, channel };
      notify('midi:note:off', ev);
      for (const fn of _midi._noteHandlers) fn({ type: 'noteoff', ...ev });
    } else if (type === 0xb0) {
      const value = data2 / 127;
      const key = `${channel}:${data1}`;
      if (_midi._signals.has(key)) _midi._signals.get(key)._val = value;
      const ev = { cc: data1, value, channel, raw: data2 };
      notify('midi:cc', { channel, cc: data1, value });
      for (const fn of _midi._ccHandlers) fn(ev);
    }
  },

  // ── Query ──────────────────────────────────────────────────────────────────

  inputs() {
    if (!_midi._access) return [];
    return Array.from(_midi._access.inputs.values()).map((i) => ({
      id: i.id,
      name: i.name,
      manufacturer: i.manufacturer,
      state: i.state,
    }));
  },

  // ── Handlers ───────────────────────────────────────────────────────────────

  onNote(fn) {
    _midi._noteHandlers.push(fn);
    _midi._cleanupFns.push(() => {
      _midi._noteHandlers = _midi._noteHandlers.filter((h) => h !== fn);
    });
    return _midi;
  },

  // fn(value 0–1) fires when CC matches channel+cc
  onCC(channel, cc, fn) {
    const wrapper = (e) => {
      if (e.channel === channel && e.cc === cc) fn(e.value);
    };
    _midi._ccHandlers.push(wrapper);
    _midi._cleanupFns.push(() => {
      _midi._ccHandlers = _midi._ccHandlers.filter((h) => h !== wrapper);
    });
    return _midi;
  },

  // ── Signal ─────────────────────────────────────────────────────────────────

  // Returns a live signal object whose .value updates on each CC message
  signal(channel, cc) {
    const key = `${channel}:${cc}`;
    if (!_midi._signals.has(key)) {
      const s = {
        _val: 0,
        get value() {
          return s._val;
        },
      };
      _midi._signals.set(key, s);
    }
    return _midi._signals.get(key);
  },

  // ── Monitor window ─────────────────────────────────────────────────────────

  spawn(title = 'MIDI Monitor') {
    const html = `<div id="ml" style="font:12px monospace;color:#0f0;background:#000;height:100%;overflow-y:auto;padding:6px 8px;box-sizing:border-box;"><div style="opacity:.5">Waiting for MIDI events…</div></div>`;
    const winId = window.wm?.spawn(title, { html, w: 340, h: 260 });
    if (winId) {
      const logEl = document.getElementById(winId)?.querySelector('#ml');
      if (logEl) {
        const append = (msg) => {
          const d = document.createElement('div');
          d.textContent = `${new Date().toLocaleTimeString()} ${msg}`;
          logEl.appendChild(d);
          logEl.scrollTop = logEl.scrollHeight;
          if (logEl.children.length > 120) logEl.removeChild(logEl.firstChild);
        };
        _midi.onNote((ev) =>
          append(
            `${ev.type.toUpperCase().padEnd(8)} ch:${ev.channel} note:${ev.note} vel:${ev.velocity}`,
          ),
        );
        const ccWatcher = (e) => append(`CC       ch:${e.channel} cc:${e.cc} val:${e.raw}`);
        _midi._ccHandlers.push(ccWatcher);
        _midi._cleanupFns.push(() => {
          _midi._ccHandlers = _midi._ccHandlers.filter((h) => h !== ccWatcher);
        });
      }
    }
    return _midi;
  },
};

export const midi = _midi;

export function cleanupMidi() {
  for (const fn of _midi._cleanupFns) fn();
  _midi._cleanupFns.length = 0;
}

// Register teardown with the reset registry (ADR 008).
onReset(cleanupMidi);
