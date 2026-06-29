import * as Tone from "tone";
import { AudioViz, SpectrogramCanvas, PianoRollViz, _noteHooks } from "./viz.js";
import { acquireStrip, renameStrip } from "./mixer.js";
import { Drumpad } from "./drumpad.js";
import { Piano } from "./piano.js";
import { onReset } from '../runtime/reset-registry.js';
import { notify, registerCommand, registerSource } from '../events/index.js';
import { acquireMicRunScoped } from './media-lease.js';
import { readAnalyser } from './analyser-read.js';
import { liveOutput } from '../runtime/keep-alive.js';

const _nativeSetInterval = window.setInterval.bind(window);
const _nativeClearInterval = window.clearInterval.bind(window);
const _nativeSetTimeout = window.setTimeout.bind(window);

const _tracked = [];
const _cleanupFns = [];
let _masterFftSignal = null;
let _micLeased = false; // guard: acquire toolbar mic lease once per run
let _recognition = null;
const _wordHandlers = new Map();
const _speechHandlers = [];
const _wordStreamHandlers = [];
let _utteranceId = 0;

// ── Beat ticker ───────────────────────────────────────────────────────────────
// Fires beat:tick / beat:bar / beat:phrase whenever the Tone.js transport runs.
// Reset and re-scheduled on every cleanupAudio() since cancel() wipes schedules.
let _beatCounter = 0;
let _beatScheduleId = null;
function _setupBeatSchedule() {
  _beatCounter = 0;
  // scheduleRepeat may not exist in test environments (Tone mock doesn't implement it)
  if (typeof Tone.getTransport?.().scheduleRepeat !== 'function') return;
  _beatScheduleId = Tone.getTransport().scheduleRepeat(() => {
    const bpm  = Tone.getTransport().bpm.value;
    const bar  = Math.floor(_beatCounter / 4);
    const beat = _beatCounter % 4;
    const time = Tone.now();
    notify('beat:tick', { bpm, bar, beat, time });
    if (beat === 0)                notify('beat:bar',    { bpm, bar, time });
    if (_beatCounter % 16 === 0)   notify('beat:phrase', { bpm, phrase: Math.floor(_beatCounter / 16), time });
    _beatCounter++;
  }, '4n');
}
_setupBeatSchedule();

function track(d) {
  _tracked.push(d);
  return d;
}

// ── Audio signal helpers ──────────────────────────────────────────────────────

// Wrap a Tone node with an internal Analyser; pass through AnalyserNode/Tone.Analyser/string.
function _makeAnalyser(source, bins) {
  if (!source || source === 'mic') {
    if (source === 'mic') _ensureMicLeased();
    return source;
  }
  if (typeof source.getValue === 'function') return source; // Tone.Analyser
  if (source.frequencyBinCount) return source;              // Web Audio AnalyserNode
  // Tone instrument/effect — connect a new Analyser
  const a = new Tone.Analyser('fft', bins);
  track(a);
  try { (source._ ?? source).connect(a); } catch (_) {}
  return a;
}

function _ensureRecognition() {
  if (_recognition) return _recognition;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { console.warn('Web Speech API not supported in this browser'); return null; }
  const r = new SR();
  r.continuous = true;
  r.interimResults = true;
  r.onresult = (e) => {
    const res = e.results[e.resultIndex];
    const isFinal = res.isFinal;
    const text = res[0].transcript.trim().toLowerCase();
    const words = text.split(/\s+/).filter(Boolean);

    if (isFinal) {
      // existing final-utterance behaviour
      notify('audio:speech', { text });
      _speechHandlers.forEach(fn => fn(text));
      words.forEach(word => {
        const handlers = _wordHandlers.get(word);
        if (handlers) { notify('audio:word', { word }); handlers.forEach(fn => fn()); }
      });
    }

    // word stream — fires for both interim and final
    const eventName = isFinal ? 'audio:word:final' : 'audio:word:interim';
    const uid = isFinal ? ++_utteranceId : _utteranceId;
    words.forEach((word, wordIndex) => {
      const payload = { word, utteranceId: uid, wordIndex, final: isFinal };
      notify(eventName, payload);
      _wordStreamHandlers.forEach(fn => fn(payload));
    });
  };
  r.onerror = (e) => { if (e.error !== 'no-speech') console.warn('Speech recognition error:', e.error); };
  r.onend = () => { if (_recognition === r) { try { r.start(); } catch (_) {} } };
  try { r.start(); } catch (e) { console.warn('Speech recognition failed to start:', e.message); return null; }
  _recognition = r;
  return r;
}

// Acquire the toolbar mic lease once per run (idempotent within a run via _micLeased guard).
function _ensureMicLeased() {
  if (_micLeased) return;
  _micLeased = true;
  acquireMicRunScoped();
}

export function cleanupAudio() {
  Tone.getTransport().stop();
  Tone.getTransport().cancel();
  _beatScheduleId = null;
  _setupBeatSchedule(); // re-register after cancel() wipes scheduled events

  // _cleanupFns: RAF/interval cancels and AudioFile state teardown — immediate.
  const toCleanup = _cleanupFns.splice(0);
  toCleanup.forEach(f => { try { f(); } catch (_) {} });

  // Tone nodes: fade first to prevent click/pop on oscillator disconnect,
  // then dispose. Splice atomically so a new run doesn't get caught in this.
  const toDispose = _tracked.splice(0);
  try { Tone.getDestination().volume.rampTo(-80, 0.08); } catch (_) {}
  _nativeSetTimeout(() => {
    toDispose.forEach(d => { try { d.dispose(); } catch (_) {} });
    try { Tone.getDestination().volume.rampTo(0, 0.05); } catch (_) {}
  }, 100);

  _masterFftSignal = null;
  _micLeased = false; // allow re-acquire on next run
  _noteHooks.length = 0;
  if (_recognition) {
    _recognition.onend = null;
    try { _recognition.stop(); } catch (_) {}
    _recognition = null;
  }
  _wordHandlers.clear();
  _speechHandlers.length = 0;
  _wordStreamHandlers.length = 0;
  try { speechSynthesis.cancel(); } catch (_) {}
}

export function startAudio() {
  const handle = liveOutput({ _audioStarting: true });
  return Tone.start().then(r => { handle.release(); return r; });
}

// ── Scale helpers ─────────────────────────────────────────────────────────

const _SCALES = {
  major:      [0, 2, 4, 5, 7, 9, 11],
  minor:      [0, 2, 3, 5, 7, 8, 10],
  dorian:     [0, 2, 3, 5, 7, 9, 10],
  phrygian:   [0, 1, 3, 5, 7, 8, 10],
  lydian:     [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  locrian:    [0, 1, 3, 5, 6, 8, 10],
  pentatonic: [0, 2, 4, 7, 9],
  blues:      [0, 3, 5, 6, 7, 10],
  chromatic:  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};

const _NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

function _midiToNote(midi) {
  const oct = Math.floor(midi / 12) - 1;
  return _NOTE_NAMES[((midi % 12) + 12) % 12] + oct;
}

// ── Instrument wrapper ────────────────────────────────────────────────────

class Instrument {
  // Every instrument is eagerly routed through its own mixer Strip (the strip is
  // the instrument's permanent output tail; ADR 032). FX added via chain() sit
  // BEFORE the strip, so the mixer is post-FX.
  constructor(inner, kind = 'synth') {
    this._ = track(inner);
    this._strip = acquireStrip(null, {
      type: 'instrument',
      nameHint: kind,                          // → 'synth 1', 'fm 2', … (counter resets each run)
      owner: window.__ar_active_editor_id ?? null,
      lifecycle: 'run',
    });
    try { this._.connect(this._strip.input); } catch (_) {}
    notify('instrument:created', { name: this._strip.name, kind });
  }
  play(...args) {
    this._.triggerAttackRelease(...args);
    if (_noteHooks.length > 0) {
      const [note, dur] = args;
      for (const h of _noteHooks) { try { h({ note, dur, type: 'play' }); } catch (_) {} }
    }
    return this;
  }
  attack(...args) {
    this._.triggerAttack(...args);
    return this;
  }
  release(...args) {
    this._.triggerRelease(...args);
    return this;
  }
  volume(db) {
    this._.volume.value = db;
    return this;
  }
  // Manual routing override — disconnects from the strip and connects straight
  // to the given node (user takes control; bypasses the mixer; ADR 032).
  connect(node) {
    try { this._.disconnect(); } catch (_) {}
    this._.connect(node);
    return this;
  }
  // FX chain ends at the strip (not destination), so mixer vol/pan/EQ is post-FX.
  chain(...nodes) {
    this._.disconnect();
    this._.chain(...nodes, this._strip.input);
    return this;
  }
}

function _makeSignal(analyser, bins) {
  let _cached = null, _cacheTime = -1;
  const getFft = () => {
    const now = performance.now();
    if (now - _cacheTime > 8) {
      _cached = readAnalyser(analyser, bins);
      _cacheTime = now;
    }
    return _cached ?? new Float32Array(bins);
  };
  const avg = (f, s, e) => { let sum = 0; for (let i = s; i < e; i++) sum += f[i]; return sum / (e - s) || 0; };
  const sig = {
    get fft()   { return getFft(); },
    get value() { return avg(getFft(), 0, bins); },
    get bass()  { return avg(getFft(), 0, Math.floor(bins * 0.1)); },
    get mid()   { return avg(getFft(), Math.floor(bins * 0.1), Math.floor(bins * 0.5)); },
    get high()  { return avg(getFft(), Math.floor(bins * 0.5), bins); },
    stream(fn) {
      let rafId;
      const frame = () => { fn(sig); rafId = requestAnimationFrame(frame); };
      rafId = requestAnimationFrame(frame);
      _cleanupFns.push(() => cancelAnimationFrame(rafId));
      return sig;
    },
  };
  return sig;
}

// ── AudioFile ─────────────────────────────────────────────────────────────
// Returned by audio.load() and audio.upload(). Full playback + FX chain API.

class AudioFile {
  constructor(url) {
    this._url = url;
    this._player = new Tone.Player({ url });
    this._fxChain = [];
    this._playOffset = 0;
    this._startedAt = 0;
    this._playing = false;
    this._paused = false;
    this._onTimeCallbacks = [];
    this._pollId = null;
    this.ready = this._player.loaded;
    this._reconnect();
    _cleanupFns.push(() => this._dispose());
  }

  _reconnect() {
    try { this._player.disconnect(); } catch (_) {}
    if (this._fxChain.length) {
      this._player.chain(...this._fxChain, Tone.getDestination());
    } else {
      this._player.toDestination();
    }
  }

  play(offset) {
    if (this._playing) {
      try { this._player.stop(); } catch (_) {}
    }
    this._playOffset = offset !== undefined ? offset : (this._paused ? this._playOffset : 0);
    this._startedAt = Tone.now();
    this._playing = true;
    this._paused = false;
    this._reconnect();
    try { this._player.start(Tone.now(), this._playOffset); } catch (_) {}
    this._startPoll();
    return this;
  }

  pause() {
    if (!this._playing) return this;
    this._playOffset = this.currentTime;
    try { this._player.stop(); } catch (_) {}
    this._playing = false;
    this._paused = true;
    this._stopPoll();
    return this;
  }

  stop() {
    try { this._player.stop(); } catch (_) {}
    this._playing = false;
    this._paused = false;
    this._playOffset = 0;
    this._stopPoll();
    // reset onTime fired flags so they fire again on next play
    for (const cb of this._onTimeCallbacks) cb.fired = false;
    return this;
  }

  seek(t) {
    const wasPlaying = this._playing;
    if (wasPlaying) try { this._player.stop(); } catch (_) {}
    this._playOffset = t;
    if (wasPlaying) {
      this._startedAt = Tone.now();
      try { this._player.start(Tone.now(), this._playOffset); } catch (_) {}
    }
    return this;
  }

  get currentTime() {
    if (!this._playing) return this._playOffset;
    const elapsed = Tone.now() - this._startedAt;
    const dur = this.duration;
    return dur > 0 ? Math.min(this._playOffset + elapsed, dur) : this._playOffset + elapsed;
  }

  get duration() {
    return this._player.buffer?.duration ?? 0;
  }

  get state() {
    if (this._playing) return 'started';
    if (this._paused) return 'paused';
    return 'stopped';
  }

  loop(enabled = true) {
    this._player.loop = enabled;
    return this;
  }

  volume(db) {
    this._player.volume.value = db;
    return this;
  }

  connect(node) {
    this._fxChain = [node];
    this._reconnect();
    return this;
  }

  chain(...nodes) {
    this._fxChain = nodes;
    this._reconnect();
    return this;
  }

  filter(type = 'lowpass', freq = 1000, Q = 1) {
    this._fxChain.push(track(new Tone.Filter({ type, frequency: freq, Q })));
    this._reconnect();
    return this;
  }

  reverb(decay = 1.5) {
    this._fxChain.push(track(new Tone.Reverb({ decay })));
    this._reconnect();
    return this;
  }

  eq(low = 0, mid = 0, high = 0) {
    this._fxChain.push(track(new Tone.EQ3(low, mid, high)));
    this._reconnect();
    return this;
  }

  delay(time = 0.25, feedback = 0.5) {
    this._fxChain.push(track(new Tone.FeedbackDelay(time, feedback)));
    this._reconnect();
    return this;
  }

  pitchShift(semitones = 0) {
    this._fxChain.push(track(new Tone.PitchShift(semitones)));
    this._reconnect();
    return this;
  }

  distort(amount = 0.4) {
    this._fxChain.push(track(new Tone.Distortion(amount)));
    this._reconnect();
    return this;
  }

  // Returns a live signal object ({ value, bass, mid, high, fft }) from this file's output.
  signal(bins = 256) {
    const analyser = _makeAnalyser(this._player, bins);
    return _makeSignal(analyser, bins);
  }

  // Canvas showing waveform + live playhead. Click to seek.
  // Returns an HTMLCanvasElement; append to DOM or pass to wm.spawn as html content.
  waveform({ width = 512, height = 64, color = '#4ade80', bg = '#111' } = {}) {
    const canvas = document.createElement('canvas');
    canvas.width  = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    let offscreen = null;

    this.ready.then(() => {
      const buffer = this._player.buffer;
      if (!buffer || typeof buffer.getChannelData !== 'function') return;
      const data = buffer.getChannelData(0);
      offscreen = document.createElement('canvas');
      offscreen.width = width; offscreen.height = height;
      const oc = offscreen.getContext('2d');
      oc.fillStyle = bg;
      oc.fillRect(0, 0, width, height);
      oc.strokeStyle = color;
      oc.lineWidth = 1;
      oc.beginPath();
      const step = Math.ceil(data.length / width);
      for (let x = 0; x < width; x++) {
        let max = 0;
        for (let i = 0; i < step; i++) {
          const v = Math.abs(data[x * step + i] ?? 0);
          if (v > max) max = v;
        }
        const h = max * height * 0.9;
        const mid = height / 2;
        oc.moveTo(x + 0.5, mid - h / 2);
        oc.lineTo(x + 0.5, mid + h / 2);
      }
      oc.stroke();
    }).catch(() => {});

    let rafId;
    const draw = () => {
      if (offscreen) ctx.drawImage(offscreen, 0, 0);
      else { ctx.fillStyle = bg; ctx.fillRect(0, 0, width, height); }
      if (this.duration > 0) {
        const x = Math.floor((this.currentTime / this.duration) * width);
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.fillRect(x, 0, 2, height);
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.font = '10px monospace';
        ctx.fillText(this.currentTime.toFixed(1) + 's', Math.min(x + 4, width - 30), height - 4);
      }
      rafId = requestAnimationFrame(draw);
    };
    draw();
    _cleanupFns.push(() => cancelAnimationFrame(rafId));

    canvas.style.cursor = 'pointer';
    canvas.addEventListener('click', (e) => {
      const r = canvas.getBoundingClientRect();
      if (r.width > 0) this.seek(((e.clientX - r.left) / r.width) * this.duration);
    });

    return canvas;
  }

  // Fires fn once when playback position reaches t (seconds). Resets on stop().
  onTime(t, fn) {
    this._onTimeCallbacks.push({ t, fn, fired: false });
    if (this._playing) this._startPoll();
    return this;
  }

  _startPoll() {
    if (this._pollId) return;
    this._pollId = _nativeSetInterval(() => this._tick(), 50);
  }

  _stopPoll() {
    if (this._pollId) { _nativeClearInterval(this._pollId); this._pollId = null; }
  }

  // Called per-poll-tick; also callable directly in tests.
  _tick() {
    if (!this._playing) return;
    const ct = this.currentTime;
    for (const cb of this._onTimeCallbacks) {
      if (!cb.fired && ct >= cb.t) { cb.fired = true; cb.fn(ct); }
    }
  }

  _dispose() {
    this._stopPoll();
    this._playing = false;
    this._paused  = false;
    this._onTimeCallbacks = [];
    try { this._player.dispose(); } catch (_) {}
  }
}

// ── AudioAPI ──────────────────────────────────────────────────────────────

class AudioAPI {
  // ── Transport ────────────────────────────────────────────────────────────
  bpm(value) {
    Tone.getTransport().bpm.value = value;
    notify('audio:bpm-change', { bpm: value });
    return this;
  }
  start(time) {
    Tone.getTransport().start(time);
    notify('audio:start', { bpm: Tone.getTransport().bpm.value });
    return this;
  }
  stop() {
    Tone.getTransport().stop();
    notify('audio:stop', {});
    return this;
  }

  // ── Synths ───────────────────────────────────────────────────────────────
  synth(opts = {}) { return new Instrument(new Tone.Synth(opts), 'synth'); }
  poly(opts = {})  { return new Instrument(new Tone.PolySynth(Tone.Synth, opts), 'poly'); }
  fm(opts = {})    { return new Instrument(new Tone.FMSynth(opts), 'fm'); }
  am(opts = {})    { return new Instrument(new Tone.AMSynth(opts), 'am'); }
  pluck(opts = {}) { return new Instrument(new Tone.PluckSynth(opts), 'pluck'); }
  metal(opts = {}) { return new Instrument(new Tone.MetalSynth(opts), 'metal'); }
  noise(opts = {}) { return new Instrument(new Tone.NoiseSynth(opts), 'noise'); }
  kick(opts = {})  { return new Instrument(new Tone.MembraneSynth(opts), 'kick'); }

  // ── Effects ──────────────────────────────────────────────────────────────
  reverb(decay = 1.5) {
    return track(new Tone.Reverb({ decay }).toDestination());
  }
  delay(time = 0.25, feedback = 0.5) {
    return track(new Tone.FeedbackDelay(time, feedback).toDestination());
  }
  distort(amount = 0.4) {
    return track(new Tone.Distortion(amount).toDestination());
  }
  chorus(freq = 1.5, delay = 3.5, depth = 0.7) {
    const c = track(new Tone.Chorus(freq, delay, depth).toDestination());
    c.start();
    return c;
  }
  filter(type = "lowpass", freq = 1000, Q = 1) {
    return track(new Tone.Filter({ type, frequency: freq, Q }).toDestination());
  }
  autoFilter(rate = 1) {
    const f = track(new Tone.AutoFilter(rate).toDestination());
    f.start();
    return f;
  }
  vibrato(freq = 5, depth = 0.1) {
    return track(new Tone.Vibrato(freq, depth).toDestination());
  }
  tremolo(freq = 10, depth = 0.5) {
    const t = track(new Tone.Tremolo(freq, depth).toDestination());
    t.start();
    return t;
  }
  compressor(threshold = -24, ratio = 12) {
    return track(new Tone.Compressor(threshold, ratio).toDestination());
  }
  eq(low = 0, mid = 0, high = 0) {
    return track(new Tone.EQ3(low, mid, high).toDestination());
  }
  pitchShift(pitch = 0) {
    return track(new Tone.PitchShift(pitch).toDestination());
  }
  phaser(rate = 0.5, octaves = 3) {
    return track(new Tone.Phaser({ frequency: rate, octaves }).toDestination());
  }
  wah(baseFreq = 350) {
    return track(new Tone.AutoWah(baseFreq, 6, -30).toDestination());
  }

  // ── Modulation ───────────────────────────────────────────────────────────
  lfo(freq = 1, min = 0, max = 1) {
    const l = track(new Tone.LFO(freq, min, max));
    l.start();
    return l;
  }

  // ── Microphone ───────────────────────────────────────────────────────────
  // Returns a started Tone.UserMedia. Connect to effects/analysis with .connect().
  // Requires browser mic permission — user will be prompted on first call.
  async mic() {
    const m = track(new Tone.UserMedia());
    await m.open();
    // Route through a 'mic' strip so live input is mixable (ADR 032).
    try {
      const strip = acquireStrip('mic', { type: 'mic', owner: window.__ar_active_editor_id ?? null, lifecycle: 'run' });
      m.connect(strip.input);
    } catch (_) {}
    return m;
  }

  // Live RMS amplitude 0–1 from the harness mic AnalyserNode. Auto-acquires mic on first call.
  get level() {
    _ensureMicLeased();
    const analyser = window.__ar_mic_analyser;
    if (!analyser) return 0;
    const data = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const v = (data[i] - 128) / 128;
      sum += v * v;
    }
    return Math.sqrt(sum / data.length);
  }

  // Edge-triggered amplitude callback. onExit optional (fires when level drops below threshold).
  onLevel(threshold, onEnter, onExit) {
    let wasAbove = false;
    const id = _nativeSetInterval(() => {
      const _lvl = this.level;
      const above = _lvl >= threshold;
      if (above && !wasAbove) {
        wasAbove = true;
        notify('audio:level', { level: _lvl });
        onEnter();
      } else if (!above && wasAbove) {
        wasAbove = false;
        if (onExit) onExit();
      }
    }, 50);
    _cleanupFns.push(() => _nativeClearInterval(id));
    return this;
  }

  // ── Speech ───────────────────────────────────────────────────────────────
  // Fires fn when the spoken word matches. Uses Web Speech API (Chrome/Edge only).
  onWord(word, fn) {
    const key = word.toLowerCase();
    if (!_wordHandlers.has(key)) _wordHandlers.set(key, []);
    _wordHandlers.get(key).push(fn);
    _ensureRecognition();
    return this;
  }

  // Fires fn with full transcript string on every recognized utterance.
  onSpeech(fn) {
    _speechHandlers.push(fn);
    _ensureRecognition();
    return this;
  }

  // Fires fn({ word, utteranceId, wordIndex, final }) for every interim and final word.
  onWordStream(fn) {
    _wordStreamHandlers.push(fn);
    _ensureRecognition();
    return this;
  }

  // Speak text via browser TTS. opts: { voice, rate (0.1–10), pitch (0–2), volume (0–1), lang }
  say(text, opts = {}) {
    const utt = new SpeechSynthesisUtterance(text);
    if (opts.rate   !== undefined) utt.rate   = opts.rate;
    if (opts.pitch  !== undefined) utt.pitch  = opts.pitch;
    if (opts.volume !== undefined) utt.volume = opts.volume;
    if (opts.lang   !== undefined) utt.lang   = opts.lang;
    if (opts.voice  !== undefined) {
      const v = speechSynthesis.getVoices().find(v => v.name === opts.voice);
      if (v) utt.voice = v;
    }
    speechSynthesis.speak(utt);
    notify('audio:say', { text });
    return this;
  }

  // Returns list of available TTS voice names for use with audio.say({ voice: '...' }).
  voices() {
    return speechSynthesis.getVoices().map(v => v.name);
  }

  // ── Analysis ─────────────────────────────────────────────────────────────
  // Usage: const m = audio.meter(); synth.chain(m); — meter sits in the signal chain
  get micCanvas() { return window.__ar_mic_viz ?? null; }

  viz(source, opts = {}) { return new AudioViz(source, opts); }

  // Master-output FFT signal (lazy, auto-connected to Tone.Destination).
  // Signal contract: { value, fft, bass, mid, high, stream(fn) }
  get fft() {
    if (!_masterFftSignal) {
      const analyser = new Tone.Analyser('fft', 256);
      track(analyser);
      try { Tone.getDestination().connect(analyser); } catch (_) {}
      _masterFftSignal = _makeSignal(analyser, 256);
      _cleanupFns.push(() => {
        try { Tone.getDestination().disconnect(analyser); } catch (_) {}
        _masterFftSignal = null;
      });
    }
    return _masterFftSignal;
  }

  // Scrolling spectrogram canvas. source: Tone node | 'mic' | signal object.
  spectrogram(source, opts = {}) { return new SpectrogramCanvas(source, opts); }

  // Piano roll overlay — shows falling note blocks for all Instrument.play() calls.
  pianoRoll(opts = {}) {
    const roll = new PianoRollViz(opts);
    roll.start();
    return roll;
  }

  // 8-pad drum machine with step sequencer.
  drumpad(opts = {}) { return new Drumpad(opts); }
  // Polyphonic piano widget with chord sequencer and synth presets.
  piano(opts = {})   { return new Piano(opts); }

  meter() {
    return track(new Tone.Meter());
  }
  analyser(bins = 32) {
    return track(new Tone.Analyser("fft", bins));
  }

  // Live signal object from any audio source (Tone node, Tone.Analyser, 'mic', or Web Audio AnalyserNode).
  // Returns { value, fft, bass, mid, high } — all lazy getters, safe to call every frame.
  signal(source, bins = 256) {
    return _makeSignal(_makeAnalyser(source, bins), bins);
  }

  // Live bins×1 canvas where R channel = FFT magnitude 0–1. Feed into Shader as video:.
  // Use uv.x in the shader to address frequency bins (0=bass, 1=treble).
  fftCanvas(source, bins = 256) {
    const analyser = _makeAnalyser(source, bins);
    const canvas = document.createElement('canvas');
    canvas.width = bins;
    canvas.height = 1;
    const ctx2d = canvas.getContext('2d');
    const img = ctx2d.createImageData(bins, 1);
    let rafId;
    const frame = () => {
      const fft = readAnalyser(analyser ?? source, bins);
      for (let i = 0; i < bins; i++) {
        const v = Math.round(Math.min(1, fft[i]) * 255);
        img.data[i * 4]     = v;
        img.data[i * 4 + 1] = v;
        img.data[i * 4 + 2] = v;
        img.data[i * 4 + 3] = 255;
      }
      ctx2d.putImageData(img, 0, 0);
      rafId = requestAnimationFrame(frame);
    };
    rafId = requestAnimationFrame(frame);
    _cleanupFns.push(() => cancelAnimationFrame(rafId));
    return canvas;
  }

  // ── Players ──────────────────────────────────────────────────────────────
  player(url) { return track(new Tone.Player(url).toDestination()); }
  sampler(urls, onload) { return track(new Tone.Sampler({ urls, onload }).toDestination()); }

  // Returns an AudioFile: full playback API with FX chaining.
  // await file.ready before calling play() to ensure the buffer is loaded.
  load(url) {
    return new AudioFile(url);
  }

  // Opens a file picker. Resolves to an AudioFile, or null if cancelled.
  async upload() {
    const url = await new Promise(resolve => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'audio/*';
      input.style.display = 'none';
      document.body.appendChild(input);
      const cleanup = () => { try { document.body.removeChild(input); } catch (_) {} };
      input.addEventListener('change', () => {
        cleanup();
        const file = input.files[0];
        resolve(file ? URL.createObjectURL(file) : null);
      });
      input.addEventListener('cancel', () => { cleanup(); resolve(null); });
      input.click();
    });
    return url ? this.load(url) : null;
  }

  // ── Legacy scheduling ────────────────────────────────────────────────────
  sequence(notes, subdivision, callback) {
    return track(new Tone.Sequence((time, note) => callback(note, time), notes, subdivision));
  }
  loop(fn, interval) {
    return track(new Tone.Loop((time) => fn(time), interval));
  }

  // ── Scale helpers ────────────────────────────────────────────────────────
  scale(root, name) {
    const intervals = _SCALES[name] ?? _SCALES.major;
    const rootMidi = Tone.Frequency(root).toMidi();
    return intervals.map((i) => _midiToNote(rootMidi + i));
  }
  note(scaleNotes, degree) {
    return scaleNotes[((degree % scaleNotes.length) + scaleNotes.length) % scaleNotes.length];
  }

  // ── Utilities ────────────────────────────────────────────────────────────
  volume(db) {
    Tone.getDestination().volume.value = db;
    return this;
  }
  now() { return Tone.now(); }
  freq(note) { return Tone.Frequency(note).toFrequency(); }
  get Tone() { return Tone; }
}

export const audio = new AudioAPI();

// Register teardown with the reset registry (ADR 008).
onReset(cleanupAudio);

// Lazy speech recognition source — starts when anything subscribes to audio:word:* or audio:speech.
registerSource(e => e.startsWith('audio:word') || e === 'audio:speech', {
  start: () => { _ensureRecognition(); },
  stop:  () => {
    if (_recognition) {
      _recognition.onend = null;
      try { _recognition.stop(); } catch (_) {}
      _recognition = null;
    }
  },
});

// ── Event bus command handlers ─────────────────────────────────────────────
registerCommand('audio:start',      ({ bpm } = {}) => { if (bpm !== undefined) audio.bpm(bpm); audio.start(); });
registerCommand('audio:stop',       ()              => { audio.stop(); });
registerCommand('audio:bpm-change', ({ bpm })       => { if (bpm !== undefined) audio.bpm(bpm); });
