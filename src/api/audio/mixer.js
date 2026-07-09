// mixer.js — the live audio console (ADR 032).
//
// One Strip per running Audio Source (instrument, window media, mic, drumpad,
// raw node) plus the Master strip. A Strip is a Tone.Channel inserted between a
// source and the Master bus, with vol/pan/mute/solo, a live VU meter, and a
// lazily-spliced 4-band parametric EQ.
//
// This module is a LEAF of the audio graph: it must NOT import audio.js (audio.js
// imports acquireStrip from here). It depends only on Tone, the bus, reset
// registry and keep-alive. The panel/UI is built lazily against window.wm.
//
// Signal path per strip:   source → strip._in (Gain) → [eq filters] → channel (Tone.Channel) → masterIn
// Master bus:              masterIn (Gain) → [master eq] → masterVol (Volume) → Tone.getDestination()
//
// Strips use Tone.Channel for vol/pan but ducking (solo/mute) is computed by us
// (not Tone's global Solo) so behaviour is deterministic and new sources duck —
// per ADR 032: solo is a persisted per-strip flag, non-soloed sources duck.

import * as Tone from 'tone';
import { ensureAudioUnlocked } from './audio-unlock.js';
import { registerWidgetRestorer } from '../wm/widget-restorer-registry.js';
import { MIXER } from '../../runtime/storage-keys.js';
import { activeEditorId } from '../../runtime/run-context.js';
import { onReset } from '../../runtime/reset-registry.js';
import { notify, subscribe } from '../../events/index.js';
import { liveOutput } from '../../runtime/keep-alive.js';

const _STORE_KEY = MIXER;

const _strips = new Map(); // name → Strip (live, has Tone nodes)
const _settings = new Map(); // name → { volume, pan, mute, solo, eq } (persisted, survives teardown)
const _changeListeners = new Set();
// Per-editor submaster bus: every run-scoped instrument strip owned by editor N
// sums into _editorBus(N) → masterIn, so a sketch window's titlebar mute/volume
// can scope to just that sketch's audio instead of the global master (ADR 040
// used to route sketch-window mute to master). Ephemeral — created on first run
// strip, disposed with the editor's run; never persisted (no generic-name leak).
const _editorBuses = new Map(); // editorId (number) → Tone.Gain

let _masterIn = null,
  _masterVol = null,
  _masterEQ = null,
  _masterMeter = null;
let _nameCounters = {}; // type → running counter for auto-names

// ── Persistence ────────────────────────────────────────────────────────────

function _loadSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem(_STORE_KEY) || '{}');
    for (const [name, s] of Object.entries(raw)) _settings.set(name, s);
  } catch (_) {}
}
let _settingsLoaded = false;
function _ensureSettingsLoaded() {
  if (!_settingsLoaded) {
    _settingsLoaded = true;
    _loadSettings();
  }
}

function _saveSettings() {
  try {
    const obj = {};
    for (const [name, s] of _settings) obj[name] = s;
    localStorage.setItem(_STORE_KEY, JSON.stringify(obj));
  } catch (_) {}
}

function _defaults() {
  return { volume: 0, pan: 0, mute: false, solo: false, eq: null };
}
function _settingsFor(name) {
  _ensureSettingsLoaded();
  if (!_settings.has(name)) _settings.set(name, _defaults());
  return _settings.get(name);
}

// Serialize/restore for .vljson (ADR 032 — settings travel with the project).
export function serializeMixer() {
  _ensureSettingsLoaded();
  const obj = {};
  for (const [name, s] of _settings) obj[name] = s;
  return obj;
}
export function restoreMixer(data) {
  if (!data || typeof data !== 'object') return;
  _settingsLoaded = true;
  for (const [name, s] of Object.entries(data)) {
    _settings.set(name, { ..._defaults(), ...s });
    _strips.get(name)?._applySettings();
  }
  _recomputeDucking();
  _saveSettings();
  _emitChange();
}

// ── Master bus ───────────────────────────────────────────────────────────────

function _ensureMaster() {
  if (_masterIn) return;
  _masterIn = new Tone.Gain();
  _masterVol = new Tone.Volume(0);
  _masterMeter = new Tone.Meter();
  _masterIn.connect(_masterVol);
  _masterVol.connect(Tone.getDestination());
  _masterVol.connect(_masterMeter);
  const s = _settingsFor('master');
  _masterVol.volume.value = s.mute ? -Infinity : s.volume;
  if (s.eq) _ensureMasterEQ()._apply(s.eq);
}

// Persisted per-editor sketch-audio state lives in _settings under a reserved
// name so it saves + travels with the project like strip settings, but never
// collides with a strip name. Keyed by editorId → { mute, volume(db) }.
const _EDITOR_KEY = (editorId) => `@editor:${editorId}`;
function _editorGain(s) {
  return s.mute || s.volume <= -60 ? 0 : Math.pow(10, s.volume / 20);
}

// Get-or-create the submaster Gain for an editor's run strips (→ masterIn).
function _editorBus(editorId) {
  let bus = _editorBuses.get(editorId);
  if (!bus) {
    _ensureMaster();
    bus = new Tone.Gain(1);
    bus.connect(_masterIn);
    _editorBuses.set(editorId, bus);
    // Apply any persisted mute/volume so a muted sketch comes back muted on refresh.
    try {
      bus.gain.value = _editorGain(_settingsFor(_EDITOR_KEY(editorId)));
    } catch (_) {}
    // Also let a sketch window's titlebar re-apply on re-run (keeps button ↔ audio synced).
    notify('mixer:editorbus', { editorId });
  }
  return bus;
}

// Scope a sketch window's mute/volume to its own editor's audio (its submaster
// bus) and PERSIST it, so the state survives refresh. db is the same curve
// addAudioControls uses (0 = unity, ≤-60 = off). Always returns true for a valid
// editor id (state persists even before the bus exists) so a sketch window never
// falls back to muting the global master.
export function editorAudio(editorId, { db = 0, muted = false } = {}) {
  const s = _settingsFor(_EDITOR_KEY(editorId));
  s.mute = !!muted;
  s.volume = db;
  _saveSettings();
  _emitChange();
  const bus = _editorBuses.get(editorId);
  if (bus) {
    const g = _editorGain(s);
    try {
      bus.gain.rampTo(g, 0.02);
    } catch (_) {
      bus.gain.value = g;
    }
  }
  return true;
}

// Read persisted sketch-audio state so a titlebar can show the right button/slider
// on spawn. Returns { muted, db }.
export function editorAudioState(editorId) {
  const s = _settingsFor(_EDITOR_KEY(editorId));
  return { muted: !!s.mute, db: s.volume ?? 0 };
}

// Master EQ as a small object mirroring Strip EQ (lazy).
function _ensureMasterEQ() {
  if (_masterEQ) return _masterEQ;
  _ensureMaster();
  _masterEQ = new EQChain();
  _masterIn.disconnect(_masterVol);
  _masterIn.chain(..._masterEQ.nodes, _masterVol);
  return _masterEQ;
}

// ── 4-band parametric EQ chain (low-shelf, 2 peaking, high-shelf) ─────────────

const EQ_DEFAULT = [
  { type: 'lowshelf', freq: 120, gain: 0, q: 0.7 },
  { type: 'peaking', freq: 500, gain: 0, q: 1 },
  { type: 'peaking', freq: 2500, gain: 0, q: 1 },
  { type: 'highshelf', freq: 8000, gain: 0, q: 0.7 },
];

class EQChain {
  constructor() {
    this.bands = EQ_DEFAULT.map((b) => ({ ...b }));
    this.nodes = this.bands.map(
      (b) => new Tone.Filter({ type: b.type, frequency: b.freq, Q: b.q, gain: b.gain }),
    );
  }
  _apply(bands) {
    if (!bands) return;
    bands.forEach((b, i) => {
      if (!this.nodes[i]) return;
      this.bands[i] = { ...this.bands[i], ...b };
      const n = this.nodes[i];
      try {
        if (b.freq != null) n.frequency.value = b.freq;
        if (b.gain != null) n.gain.value = b.gain;
        if (b.q != null) n.Q.value = b.q;
      } catch (_) {}
    });
  }
  serialize() {
    return this.bands.map((b) => ({ ...b }));
  }
  dispose() {
    this.nodes.forEach((n) => {
      try {
        n.dispose();
      } catch (_) {}
    });
  }
}

// ── Strip ─────────────────────────────────────────────────────────────────────

class Strip {
  constructor(name, { type = 'node', owner = null, lifecycle = 'run' } = {}) {
    _ensureMaster();
    this.name = name;
    this.type = type;
    this.owner = owner; // editorId | winId | null
    this.lifecycle = lifecycle; // 'run' | 'window' | 'persistent'
    this.patterns = new Set(); // pattern ids riding this instrument (sub-rows)

    this._in = new Tone.Gain();
    this._channel = new Tone.Channel(); // volume + pan
    this._meter = new Tone.Meter();
    this._eq = null; // lazy EQChain

    this._in.connect(this._channel);
    // Run strips owned by an editor sum through that editor's submaster bus so a
    // sketch window can mute just its own audio; everything else → masterIn direct.
    const scoped = lifecycle === 'run' && typeof owner === 'number';
    this._channel.connect(scoped ? _editorBus(owner) : _masterIn);
    this._channel.connect(this._meter);

    this._applySettings();
  }

  get input() {
    return this._in;
  } // sources connect here (Tone node)
  // Connect a raw/native AudioNode into this strip.
  connectFrom(node) {
    try {
      Tone.connect(node, this._in);
    } catch (_) {}
    return this;
  }

  _settings() {
    return _settingsFor(this.name);
  }

  _applySettings() {
    const s = this._settings();
    try {
      this._channel.volume.value = s.volume;
    } catch (_) {}
    try {
      this._channel.pan.value = s.pan;
    } catch (_) {}
    if (s.eq) this._ensureEQ()._apply(s.eq);
    _recomputeDucking();
  }

  _ensureEQ() {
    if (this._eq) return this._eq;
    this._eq = new EQChain();
    // Splice EQ between _in and channel — only _in's single output re-patches,
    // so connected sources never click (ADR 032).
    try {
      this._in.disconnect(this._channel);
    } catch (_) {}
    this._in.chain(...this._eq.nodes, this._channel);
    return this._eq;
  }

  // ── setters (return this; blocks-friendly) ──────────────────────────────────
  setVolume(db) {
    this._settings().volume = db;
    try {
      this._channel.volume.value = db;
    } catch (_) {}
    _persistAndNotify();
    return this;
  }
  setPan(v) {
    this._settings().pan = v;
    try {
      this._channel.pan.value = v;
    } catch (_) {}
    _persistAndNotify();
    return this;
  }
  setMute(b) {
    this._settings().mute = !!b;
    _recomputeDucking();
    _persistAndNotify();
    return this;
  }
  setSolo(b) {
    this._settings().solo = !!b;
    _recomputeDucking();
    _persistAndNotify();
    return this;
  }
  setEQ(bands) {
    this._ensureEQ()._apply(bands);
    this._settings().eq = this._eq.serialize();
    _persistAndNotify();
    return this;
  }

  _level() {
    try {
      const v = this._meter.getValue();
      return typeof v === 'number' ? v : (v?.[0] ?? -Infinity);
    } catch (_) {
      return -Infinity;
    }
  }

  dispose() {
    try {
      this._in.dispose();
    } catch (_) {}
    try {
      this._channel.dispose();
    } catch (_) {}
    try {
      this._meter.dispose();
    } catch (_) {}
    this._eq?.dispose();
  }
}

// ── Ducking (mute/solo) ────────────────────────────────────────────────────────

function _anySolo() {
  for (const [, s] of _settings) if (s.solo) return true;
  return false;
}
function _recomputeDucking() {
  const solo = _anySolo();
  for (const [name, strip] of _strips) {
    const s = _settingsFor(name);
    const muted = s.mute || (solo && !s.solo);
    try {
      strip._channel.mute = muted;
    } catch (_) {}
  }
  // master never ducks; it only obeys its own mute
  if (_masterVol) {
    const ms = _settingsFor('master');
    try {
      _masterVol.volume.value = ms.mute ? -Infinity : ms.volume;
    } catch (_) {}
  }
}

// ── Registry / discovery ───────────────────────────────────────────────────────

function _emitChange() {
  for (const fn of _changeListeners) {
    try {
      fn();
    } catch (_) {}
  }
}
function _persistAndNotify() {
  _saveSettings();
  _emitChange();
}

function _autoName(label) {
  _nameCounters[label] = (_nameCounters[label] || 0) + 1;
  return `${label} ${_nameCounters[label]}`;
}

// Get-or-create a strip. Called by audio.js (instruments), wm.js (windows),
// drumpad, mic, and mixer.add (raw nodes).
export function acquireStrip(name, opts = {}) {
  ensureAudioUnlocked(); // ADR 058: every sound-maker funnels here → unlock audio
  _ensureSettingsLoaded();
  const auto = !name;
  if (!name) name = _autoName(opts.nameHint || opts.type || 'node');
  let strip = _strips.get(name);
  if (!strip) {
    strip = new Strip(name, opts);
    strip._autoNamed = auto;
    _strips.set(name, strip);
    _recomputeDucking(); // now that the strip is registered, duck it if a solo is active
    notify('mixer:strip:add', { name, type: strip.type });
    _emitChange();
  }
  return strip;
}

export function releaseStrip(name) {
  const strip = _strips.get(name);
  if (!strip) return;
  strip.dispose();
  _strips.delete(name);
  notify('mixer:strip:remove', { name });
  _recomputeDucking();
  _emitChange();
}

// Route a Trigger Surface's output Gain into a window-scoped Strip so the whole
// surface (built-in kit + bound/default/Faust Voices) is one mixable channel
// (ADR 032/046). Falls back to Destination if the mixer/audio graph isn't
// available (headless/tests). Returns the Strip or null.
export function connectSurfaceStrip(out, name, type, winId) {
  try {
    const strip = acquireStrip(name, { type, owner: winId, lifecycle: 'window' });
    out.connect(strip.input);
    return strip;
  } catch (_) {
    try {
      out.toDestination();
    } catch (_) {}
    return null;
  }
}

export function getStrip(name) {
  return _strips.get(name) || null;
}
export function liveStripNames() {
  return [..._strips.keys()];
}

// ── Reset ──────────────────────────────────────────────────────────────────────

export function cleanupMixer(editorId) {
  // Tear down only run-scoped strips owned by the resetting editor (null id → all run-scoped).
  for (const [name, strip] of [..._strips]) {
    if (strip.lifecycle !== 'run') continue;
    if (editorId != null && strip.owner != null && strip.owner !== editorId) continue;
    strip.dispose();
    _strips.delete(name);
    notify('mixer:strip:remove', { name });
  }
  // Dispose the submaster bus for this editor (null id → all) once its strips are gone.
  for (const [eid, bus] of [..._editorBuses]) {
    if (editorId != null && eid !== editorId) continue;
    try {
      bus.dispose();
    } catch (_) {}
    _editorBuses.delete(eid);
  }
  _nameCounters = {};
  _recomputeDucking();
  _emitChange();
  // settings persist by name across resets (ADR 032) — do NOT clear _settings.
}
onReset(cleanupMixer);

// ── Discovery wiring: patterns ride their instrument's strip as sub-rows ───────

subscribe(
  'pattern:started',
  ({ id, strip: stripName }) => {
    if (!stripName) return;
    _strips.get(stripName)?.patterns.add(id);
    _emitChange();
  },
  { persistent: true },
);
subscribe(
  'pattern:stopped',
  ({ id }) => {
    for (const [, s] of _strips) s.patterns.delete(id);
    _emitChange();
  },
  { persistent: true },
);

// ── Public handle (window.mixer.strip(name) / .master) ─────────────────────────

class StripHandle {
  constructor(name) {
    this._name = name;
  }
  _live() {
    return _strips.get(this._name) || null;
  }
  _set() {
    return _settingsFor(this._name);
  }
  // The one live-or-persist fork: a live strip owns the node write (its setter also
  // persists + ducks); with no strip, write the setting that survives teardown and
  // persist here. `duck` recomputes solo/mute ducking on the settings-only path.
  _apply(setter, key, value, duck = false) {
    const l = this._live();
    if (l) l[setter](value);
    else {
      this._set()[key] = value;
      if (duck) _recomputeDucking();
      _persistAndNotify();
    }
    return this;
  }
  volume(db) {
    return this._apply('setVolume', 'volume', db);
  }
  pan(v) {
    return this._apply('setPan', 'pan', v);
  }
  mute(b = true) {
    return this._apply('setMute', 'mute', !!b, true);
  }
  solo(b = true) {
    return this._apply('setSolo', 'solo', !!b, true);
  }
  eq(bands) {
    return this._apply('setEQ', 'eq', bands);
  }
  get name() {
    return this._name;
  }
}

class MasterHandle extends StripHandle {
  constructor() {
    super('master');
  }
  volume(db) {
    _ensureMaster();
    this._set().volume = db;
    try {
      _masterVol.volume.value = this._set().mute ? -Infinity : db;
    } catch (_) {}
    _persistAndNotify();
    return this;
  }
  mute(b = true) {
    _ensureMaster();
    this._set().mute = !!b;
    _recomputeDucking();
    _persistAndNotify();
    return this;
  }
  pan() {
    return this;
  } // master is post-sum; pan is a no-op
  solo() {
    return this;
  } // master never solos
  eq(bands) {
    _ensureMaster();
    _ensureMasterEQ()._apply(bands);
    this._set().eq = _masterEQ.serialize();
    _persistAndNotify();
    return this;
  }
}

class Mixer {
  show() {
    _ensurePanel();
    _panelSet(true);
    return this;
  }
  hide() {
    _panelSet(false);
    return this;
  }
  toggle() {
    _ensurePanel();
    _panelSet(!_panelVisible());
    return this;
  }
  strip(name) {
    return new StripHandle(name);
  }
  get master() {
    return new MasterHandle();
  }
  // Add an arbitrary WebAudio/Tone node to the mix. Mixer owns the strip's
  // channel; the caller owns the node's own lifecycle (ADR 032).
  add(node, { name, persist } = {}) {
    const strip = acquireStrip(name, {
      type: 'node',
      owner: activeEditorId() ?? null,
      lifecycle: persist ? 'persistent' : 'run',
    });
    try {
      if (node?.connect && node?.toDestination)
        node.connect(strip.input); // Tone node
      else if (node) strip.connectFrom(node); // raw AudioNode
    } catch (_) {}
    return new StripHandle(strip.name);
  }
  names() {
    return liveStripNames();
  }
  // Scope mute/volume to one editor's sketch audio (its submaster bus). Used by a
  // sketch window's titlebar control so muting the window doesn't mute the master.
  editorAudio(editorId, opts) {
    return editorAudio(editorId, opts);
  }
  editorAudioState(editorId) {
    return editorAudioState(editorId);
  }
}

export const mixer = new Mixer();

// ── Panel (lazy, built against window.wm) ──────────────────────────────────────

let _panel = null; // { winId, root, rafId, live }
function _panelVisible() {
  const w = _panel && document.getElementById(_panel.winId);
  return !!w && w.style.display !== 'none';
}
function _panelSet(v) {
  if (!_panel) return;
  const w = document.getElementById(_panel.winId);
  if (w) w.style.display = v ? 'flex' : 'none';
  if (v) _startPanelLoop();
  else _stopPanelLoop();
}

function _ensurePanel() {
  if (_panel && document.getElementById(_panel.winId)) return;
  if (!window.wm) return;
  const winId = window.wm.spawn('Mixer', { type: 'html', html: '', w: 560, h: 320, audio: false });
  const win = document.getElementById(winId);
  const body = win?.querySelector('.wm-body');
  if (!body) return;
  body.style.cssText +=
    'background:#0d0d14;overflow-x:auto;overflow-y:hidden;padding:6px;display:flex;gap:6px;align-items:stretch;';
  const root = document.createElement('div');
  root.style.cssText = 'display:flex;gap:6px;align-items:stretch;min-height:0;height:100%;';
  body.appendChild(root);
  _panel = { winId, root, rafId: null, live: null };
  if (win)
    window.wm?.window?.(win.id)?.onDispose(() => {
      _stopPanelLoop();
      _changeListeners.delete(_renderPanel);
      _panel = null;
    });
  win._widgetType = 'mixer';
  _renderPanel();
  _changeListeners.add(_renderPanel);
  _startPanelLoop();
}

const _meterEls = new Map(); // name → meter fill el

function _renderPanel() {
  if (!_panel) return;
  const root = _panel.root;
  root.innerHTML = '';
  _meterEls.clear();
  // Master first, then strips by insertion order, then orphan settings (greyed).
  const liveNames = liveStripNames();
  root.appendChild(_renderStrip('master', true));
  for (const name of liveNames) root.appendChild(_renderStrip(name, false));
  // orphans: persisted settings with no live strip and not master
  for (const [name] of _settings) {
    if (name === 'master' || _strips.has(name)) continue;
    root.appendChild(_renderStrip(name, false, true));
  }
}

function _renderStrip(name, isMaster, orphan = false) {
  const s = _settingsFor(name);
  const strip = _strips.get(name);
  const col = document.createElement('div');
  col.style.cssText = `display:flex;flex-direction:column;gap:4px;width:88px;flex:0 0 auto;background:#15151f;border:1px solid #23233a;border-radius:6px;padding:6px 5px;${orphan ? 'opacity:.45;' : ''}`;

  // name (renamable except master)
  const title = document.createElement('div');
  title.textContent = name;
  title.title = name;
  title.style.cssText =
    'font:600 11px monospace;color:#cdd6f4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
  if (!isMaster && !orphan) {
    title.style.cursor = 'text';
    title.ondblclick = () => {
      const nn = prompt('Rename strip', name);
      if (nn && nn !== name) _renameStrip(name, nn);
    };
  }
  col.appendChild(title);

  // pattern sub-rows
  if (strip && strip.patterns.size) {
    const sub = document.createElement('div');
    sub.style.cssText =
      'font:9px monospace;color:#7f849c;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
    sub.textContent = '▸ ' + [...strip.patterns].join(', ');
    col.appendChild(sub);
  }

  // meter
  const meterWrap = document.createElement('div');
  meterWrap.style.cssText = 'height:8px;background:#080810;border-radius:3px;overflow:hidden;';
  const meterFill = document.createElement('div');
  meterFill.style.cssText =
    'height:100%;width:0%;background:linear-gradient(90deg,#a6e3a1,#f9e2af,#f38ba8);';
  meterWrap.appendChild(meterFill);
  col.appendChild(meterWrap);
  _meterEls.set(name, meterFill);

  // volume
  col.appendChild(
    _slider(
      'vol',
      -48,
      6,
      0.5,
      s.volume,
      (v) => _handleFor(name, isMaster).volume(v),
      `${s.volume > 0 ? '+' : ''}${s.volume.toFixed(1)}dB`,
    ),
  );
  // pan (not master)
  if (!isMaster)
    col.appendChild(
      _slider('pan', -1, 1, 0.05, s.pan, (v) => _handleFor(name).pan(v), `pan ${s.pan.toFixed(2)}`),
    );

  // M / S buttons
  const btns = document.createElement('div');
  btns.style.cssText = 'display:flex;gap:4px;';
  const mBtn = _toggleBtn('M', s.mute, '#f38ba8', () => _handleFor(name, isMaster).mute(!s.mute));
  btns.appendChild(mBtn);
  if (!isMaster) {
    const sBtn = _toggleBtn('S', s.solo, '#f9e2af', () => _handleFor(name).solo(!s.solo));
    btns.appendChild(sBtn);
  }
  // EQ toggle
  const eqBtn = _toggleBtn('EQ', !!s.eq, '#89b4fa', () => {
    _handleFor(name, isMaster).eq(s.eq || EQ_DEFAULT.map((b) => ({ ...b })));
    _renderPanel();
  });
  btns.appendChild(eqBtn);
  col.appendChild(btns);

  // orphan clear
  if (orphan) {
    const x = document.createElement('button');
    x.textContent = '✕ clear';
    x.style.cssText =
      'font:9px monospace;background:#23233a;color:#bac2de;border:none;border-radius:3px;cursor:pointer;padding:2px;';
    x.onclick = () => {
      _settings.delete(name);
      _saveSettings();
      _renderPanel();
    };
    col.appendChild(x);
  }

  // EQ canvas
  if (s.eq) col.appendChild(_eqCanvas(name, isMaster, s.eq));

  return col;
}

function _handleFor(name, isMaster) {
  return isMaster ? mixer.master : mixer.strip(name);
}

function _slider(kind, min, max, step, value, onInput, label) {
  const wrap = document.createElement('div');
  const lab = document.createElement('div');
  lab.textContent = label;
  lab.style.cssText = 'font:9px monospace;color:#9399b2;';
  const r = document.createElement('input');
  r.type = 'range';
  r.min = min;
  r.max = max;
  r.step = step;
  r.value = value;
  r.style.cssText = 'width:100%;';
  r.addEventListener('mousedown', (e) => e.stopPropagation());
  r.addEventListener('input', (e) => {
    e.stopPropagation();
    onInput(parseFloat(r.value));
    lab.textContent = _relabel(kind, parseFloat(r.value));
  });
  wrap.appendChild(lab);
  wrap.appendChild(r);
  return wrap;
}
function _relabel(kind, v) {
  if (kind === 'vol') return `${v > 0 ? '+' : ''}${v.toFixed(1)}dB`;
  if (kind === 'pan') return `pan ${v.toFixed(2)}`;
  return String(v);
}

function _toggleBtn(text, active, color, onClick) {
  const b = document.createElement('button');
  b.textContent = text;
  b.style.cssText = `flex:1;font:600 10px monospace;border:1px solid #2a2a40;border-radius:3px;cursor:pointer;padding:3px 0;background:${active ? color : '#1c1c2c'};color:${active ? '#11111b' : '#bac2de'};`;
  b.addEventListener('mousedown', (e) => e.stopPropagation());
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  return b;
}

// Compact draggable 4-band EQ curve.
function _eqCanvas(name, isMaster, bands) {
  const c = document.createElement('canvas');
  c.style.cssText =
    'width:100%;height:60px;display:block;background:#080810;border-radius:4px;cursor:ns-resize;margin-top:2px;';
  const W = () => c.width,
    H = () => c.height;
  const ro = new ResizeObserver(() => {
    c.width = c.offsetWidth * devicePixelRatio;
    c.height = c.offsetHeight * devicePixelRatio;
    _drawEQ();
  });
  ro.observe(c);
  const f2x = (f) => (Math.log10(f / 20) / Math.log10(1000)) * W();
  const db2y = (db) => H() / 2 - (db / 12) * (H() / 2);
  function _drawEQ() {
    const ctx = c.getContext('2d');
    if (!ctx || !W()) return;
    ctx.clearRect(0, 0, W(), H());
    ctx.strokeStyle = '#1e1e2e';
    const y0 = db2y(0);
    ctx.beginPath();
    ctx.moveTo(0, y0);
    ctx.lineTo(W(), y0);
    ctx.stroke();
    ctx.strokeStyle = '#89b4fa';
    ctx.lineWidth = 1.5 * devicePixelRatio;
    ctx.beginPath();
    for (let px = 0; px <= W(); px += 3) {
      const f = 20 * Math.pow(1000, px / W());
      let g = 0;
      for (const b of bands) {
        const r = Math.log2(f / b.freq);
        g += b.gain * Math.exp(-0.5 * Math.pow(r / (b.type === 'peaking' ? 0.8 : 1.6), 2));
      }
      const y = db2y(Math.max(-12, Math.min(12, g)));
      px === 0 ? ctx.moveTo(px, y) : ctx.lineTo(px, y);
    }
    ctx.stroke();
    for (const b of bands) {
      ctx.beginPath();
      ctx.arc(f2x(b.freq), db2y(b.gain), 4 * devicePixelRatio, 0, 7);
      ctx.fillStyle = '#f9e2af';
      ctx.fill();
    }
  }
  let drag = null;
  c.addEventListener('mousedown', (e) => {
    const rect = c.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * devicePixelRatio;
    bands.forEach((b, i) => {
      if (Math.abs(f2x(b.freq) - mx) < 16 * devicePixelRatio)
        drag = { i, startY: e.clientY, startG: b.gain };
    });
    if (drag) e.preventDefault();
  });
  const mv = (e) => {
    if (!drag) return;
    const dDb = (drag.startY - e.clientY) / (c.getBoundingClientRect().height / 24);
    bands[drag.i].gain = Math.max(-12, Math.min(12, Math.round((drag.startG + dDb) * 2) / 2));
    _handleFor(name, isMaster).eq(bands.map((b) => ({ ...b })));
    _drawEQ();
  };
  const up = () => {
    drag = null;
  };
  document.addEventListener('mousemove', mv);
  document.addEventListener('mouseup', up);
  c._eqCleanup = () => {
    document.removeEventListener('mousemove', mv);
    document.removeEventListener('mouseup', up);
  };
  _drawEQ();
  return c;
}

// VU meter RAF loop (only while panel visible).
function _startPanelLoop() {
  if (!_panel || _panel.rafId) return;
  _panel.live = liveOutput({ _mixerPanel: true });
  const tick = () => {
    _panel.rafId = requestAnimationFrame(tick);
    for (const [name, el] of _meterEls) {
      let db = -Infinity;
      if (name === 'master') {
        try {
          db = _masterMeter?.getValue() ?? -Infinity;
          if (typeof db !== 'number') db = db?.[0] ?? -Infinity;
        } catch (_) {}
      } else db = _strips.get(name)?._level() ?? -Infinity;
      const pct = Math.max(0, Math.min(100, ((db + 48) / 48) * 100));
      el.style.width = pct + '%';
    }
  };
  tick();
}
function _stopPanelLoop() {
  if (!_panel) return;
  if (_panel.rafId) cancelAnimationFrame(_panel.rafId);
  _panel.rafId = null;
  _panel.live?.release();
  _panel.live = null;
}

// Public rename — used when a pattern binds an instrument with an explicit id
// (ADR 032: strip name = pattern id if given). Only overrides auto-names unless forced.
export function renameStrip(oldName, newName, { force = false } = {}) {
  if (!oldName || !newName || oldName === newName) return;
  if (_strips.has(newName) || _settings.has(newName)) return;
  const strip = _strips.get(oldName);
  if (!force && strip && !strip._autoNamed) return;
  _renameStrip(oldName, newName);
  if (strip) strip._autoNamed = false;
}

function _renameStrip(oldName, newName) {
  if (_settings.has(oldName)) {
    _settings.set(newName, _settings.get(oldName));
    _settings.delete(oldName);
  }
  const strip = _strips.get(oldName);
  if (strip) {
    strip.name = newName;
    _strips.delete(oldName);
    _strips.set(newName, strip);
  }
  _saveSettings();
  _renderPanel();
}

// Panel open helper for the toolbar button / restorer.
export function openMixerPanel() {
  mixer.show();
}

// Code-generated window restore. Mixer + legacy no-op EQ (ADR 032 removed EQWidget).
registerWidgetRestorer('mixer', () => openMixerPanel());
registerWidgetRestorer('eq', () => {});
