// system-events.js — catalog of all system events emitted on the global bus.
//
// Each entry: { name, detail, payload, commandable, primary?, release? }
//   name        — the event string used in on()/emit()
//   detail      — short description shown in completions / hover docs
//   payload     — example payload shape (string) shown as hover doc
//   commandable — true: emit() triggers an action via a command handler
//   primary     — the payload field used for terse .when() dispatch and .hold() Set keys
//   release     — companion event name for .hold() Set mode (down→up pairing)
//
// Per-window scoped events (wm:{winId}:key:down etc.) cannot be statically enumerated here —
// they live in DYNAMIC_EVENT_PATTERNS below and are excluded from the completion integrity test.

export const SYSTEM_EVENTS = [
  // ── Input — Keyboard ──────────────────────────────────────────────────────
  {
    name: 'window:key:down',
    commandable: false,
    primary: 'key',
    release: 'window:key:up',
    detail: 'key pressed anywhere in the app',
    payload: '{ key, code, repeat, winId }',
  },
  {
    name: 'window:key:up',
    commandable: false,
    primary: 'key',
    detail: 'key released anywhere in the app',
    payload: '{ key, code, winId }',
  },

  // ── Input — Mouse ─────────────────────────────────────────────────────────
  {
    name: 'window:mouse:down',
    commandable: false,
    primary: 'button',
    release: 'window:mouse:up',
    detail: 'mouse button pressed',
    payload: '{ button, x, y, winId }',
  },
  {
    name: 'window:mouse:up',
    commandable: false,
    primary: 'button',
    detail: 'mouse button released',
    payload: '{ button, x, y, winId }',
  },
  {
    name: 'window:mouse:click',
    commandable: false,
    primary: 'button',
    detail: 'mouse click (down + up on same target)',
    payload: '{ button, x, y, winId }',
  },
  {
    name: 'window:mouse:move',
    commandable: false,
    detail: 'pointer moved — lazy source, RAF-throttled',
    payload: '{ x, y, winId }',
  },

  // ── Window Manager ────────────────────────────────────────────────────────
  {
    name: 'wm:spawn',
    commandable: true,
    detail: 'spawn a new window',
    payload: '{ id, title, type, x, y, w, h }',
  },
  {
    name: 'wm:close',
    commandable: true,
    detail: 'close/remove a window',
    payload: '{ id, title, type }',
  },
  { name: 'wm:focus', commandable: true, detail: 'bring a window to front', payload: '{ id }' },
  { name: 'wm:blur', commandable: false, detail: 'a window lost focus', payload: '{ id }' },
  { name: 'wm:move', commandable: true, detail: 'move a window to x,y', payload: '{ id, x, y }' },
  { name: 'wm:resize', commandable: true, detail: 'resize a window', payload: '{ id, w, h }' },
  { name: 'wm:maximize', commandable: true, detail: 'maximize a window', payload: '{ id }' },
  {
    name: 'wm:restore',
    commandable: true,
    detail: 'restore a maximized window',
    payload: '{ id }',
  },
  { name: 'wm:show', commandable: true, detail: 'show a hidden window', payload: '{ id }' },
  {
    name: 'wm:hide',
    commandable: true,
    detail: 'hide a window without closing it',
    payload: '{ id }',
  },
  {
    name: 'wm:paint-toggle',
    commandable: false,
    detail: 'paint overlay toggled on a window',
    payload: '{ id, active }',
  },
  {
    name: 'wm:error',
    commandable: false,
    detail: 'a wm command failed',
    payload: '{ command, reason }',
  },

  // ── Desktop ───────────────────────────────────────────────────────────────
  {
    name: 'desktop:file-added',
    commandable: false,
    detail: 'file added to the desktop',
    payload: '{ name, type, url }',
  },
  {
    name: 'desktop:file-opened',
    commandable: false,
    detail: 'file opened from the desktop',
    payload: '{ name, type, url }',
  },
  {
    name: 'desktop:file-removed',
    commandable: false,
    detail: 'file removed from the desktop',
    payload: '{ name }',
  },
  {
    name: 'desktop:icon-clicked',
    commandable: false,
    detail: 'desktop icon single-clicked',
    payload: '{ name, type, url }',
  },
  {
    name: 'desktop:browse-open',
    commandable: false,
    detail: 'file browser opened',
    payload: '{ key }',
  },
  {
    name: 'desktop:browse-select',
    commandable: false,
    detail: 'file selected in browser',
    payload: '{ key, name, url }',
  },

  // ── Render Pipeline ───────────────────────────────────────────────────────
  {
    name: 'pipe:create',
    commandable: false,
    detail: 'pipe() called, new pipeline created',
    payload: '{ id, sourceType }',
  },
  {
    name: 'pipe:stage-added',
    commandable: false,
    detail: 'a stage was added to the pipeline',
    payload: '{ id, stage }',
  },
  {
    name: 'pipe:stage-complete',
    commandable: false,
    detail: 'a pipeline stage finished a frame',
    payload: '{ id, stage, time }',
  },
  {
    name: 'pipe:show',
    commandable: false,
    detail: '.show() called on a pipeline',
    payload: '{ id, title }',
  },
  { name: 'pipe:destroy', commandable: true, detail: 'destroy/stop a pipeline', payload: '{ id }' },

  // ── Audio ─────────────────────────────────────────────────────────────────
  {
    name: 'audio:start',
    commandable: true,
    detail: 'start the Tone.js transport',
    payload: '{ bpm }',
  },
  { name: 'audio:stop', commandable: true, detail: 'stop the Tone.js transport', payload: '{}' },
  {
    name: 'audio:bpm-change',
    commandable: true,
    detail: 'change the global BPM',
    payload: '{ bpm }',
  },
  {
    name: 'audio:level',
    commandable: false,
    detail: 'mic level crossed threshold',
    payload: '{ level }',
  },
  {
    name: 'audio:word',
    commandable: false,
    detail: 'speech recognition registered-word trigger (final only)',
    payload: '{ word }',
  },
  {
    name: 'audio:word:interim',
    commandable: false,
    detail: 'transcription word as it is being spoken',
    payload: '{ word, final, index }',
  },
  {
    name: 'audio:word:final',
    commandable: false,
    detail: 'transcription word stabilised / committed',
    payload: '{ word, final, index }',
  },
  {
    name: 'audio:transcript',
    commandable: false,
    detail: 'full running transcript (interim or final)',
    payload: '{ text, isFinal }',
  },
  {
    name: 'audio:speech',
    commandable: false,
    detail: 'full speech utterance recognized',
    payload: '{ text }',
  },
  {
    name: 'audio:say',
    commandable: false,
    detail: 'text-to-speech utterance started',
    payload: '{ text }',
  },
  {
    name: 'audio:note-play',
    commandable: false,
    detail: 'a note was triggered',
    payload: '{ note, duration }',
  },
  {
    name: 'audio:error',
    commandable: false,
    detail: 'an audio command failed',
    payload: '{ command, reason }',
  },

  // ── Beat / Sequencer ──────────────────────────────────────────────────────
  {
    name: 'beat:tick',
    commandable: false,
    detail: 'every quarter note — emit to fake beats for testing',
    payload: '{ bpm, bar, beat, time }',
  },
  {
    name: 'beat:bar',
    commandable: false,
    detail: 'every bar (4 beats)',
    payload: '{ bpm, bar, time }',
  },
  {
    name: 'beat:phrase',
    commandable: false,
    detail: 'every phrase (4 bars = 16 beats)',
    payload: '{ bpm, phrase, time }',
  },

  // ── MIDI ──────────────────────────────────────────────────────────────────
  {
    name: 'midi:open',
    commandable: false,
    detail: 'MIDI access granted, inputs enumerated',
    payload: '{ inputs }',
  },
  {
    name: 'midi:note:on',
    commandable: false,
    primary: 'note',
    detail: 'MIDI note pressed',
    payload: '{ note, velocity, channel }',
  },
  {
    name: 'midi:note:off',
    commandable: false,
    primary: 'note',
    detail: 'MIDI note released',
    payload: '{ note, velocity, channel }',
  },
  {
    name: 'midi:cc',
    commandable: false,
    primary: 'cc',
    detail: 'MIDI control change received',
    payload: '{ channel, cc, value }',
  },
  {
    name: 'midi:clock',
    commandable: false,
    detail: 'MIDI clock pulse (0xF8, 24 PPQ)',
    payload: '{}',
  },

  // ── Camera ────────────────────────────────────────────────────────────────
  {
    name: 'camera:open',
    commandable: false,
    detail: 'camera stream opened (async side-effect)',
    payload: '{ deviceId, index, width, height }',
  },
  {
    name: 'camera:close',
    commandable: true,
    detail: 'close a camera stream',
    payload: '{ deviceId }',
  },
  {
    name: 'camera:flip',
    commandable: false,
    detail: 'camera mirror state changed',
    payload: '{ deviceId, mirrored }',
  },
  {
    name: 'camera:error',
    commandable: false,
    detail: 'camera open failed',
    payload: '{ deviceId, error }',
  },

  // ── Vision / MediaPipe ────────────────────────────────────────────────────
  {
    name: 'gesture:detected',
    commandable: false,
    primary: 'type',
    detail: 'hand gesture detected',
    payload: '{ type, hand, confidence }',
  },
  {
    name: 'gesture:smile',
    commandable: false,
    detail: 'smile detected in frame',
    payload: '{ confidence, cx, cy }',
  },
  {
    name: 'gesture:expression',
    commandable: false,
    primary: 'expression',
    detail: 'face expression detected',
    payload: '{ expression, confidence, cx, cy }',
  },
  {
    name: 'gesture:face',
    commandable: false,
    detail: 'face detection result',
    payload: '{ expression, cx, cy, landmarks }',
  },
  {
    name: 'gesture:object',
    commandable: false,
    detail: 'object detected by vision',
    payload: '{ label, confidence, bbox }',
  },

  // ── Gaze (ADR 034) — continuous eye signal, own prefix (not gesture:) ──────
  {
    name: 'gaze:move',
    commandable: false,
    detail: 'gaze update each detection cycle — continuous',
    payload: '{ vx, vy, x, y, dir }',
  },
  {
    name: 'gaze:look',
    commandable: false,
    primary: 'dir',
    detail: 'gaze direction zone changed',
    payload: '{ dir }',
  },
  { name: 'gaze:blink', commandable: false, detail: 'both eyes blinked', payload: '{}' },
  {
    name: 'gaze:wink',
    commandable: false,
    primary: 'eye',
    detail: 'one eye winked',
    payload: '{ eye }',
  },
  {
    name: 'gaze:enter',
    commandable: false,
    primary: 'target',
    detail: 'gaze entered a watched region (needs calibration)',
    payload: '{ target }',
  },
  {
    name: 'gaze:leave',
    commandable: false,
    primary: 'target',
    detail: 'gaze left a watched region',
    payload: '{ target }',
  },

  // ── Sensors (device hardware) ─────────────────────────────────────────────
  // All sensor sources are lazy — start() runs on first subscriber, stop() on last.
  {
    name: 'sensor:shake',
    commandable: false,
    detail: 'device shake detected',
    payload: '{ magnitude }',
  },
  {
    name: 'sensor:motion',
    commandable: false,
    detail: 'device motion/orientation — lazy devicemotion source',
    payload: '{ ax, ay, az, alpha, beta, gamma, magnitude }',
  },
  {
    name: 'sensor:geo',
    commandable: false,
    detail: 'geolocation update — lazy watchPosition; prompts permission',
    payload: '{ lat, lon, accuracy, speed, heading }',
  },
  {
    name: 'sensor:battery',
    commandable: false,
    detail: 'battery level or charging state changed — lazy',
    payload: '{ level, charging }',
  },
  {
    name: 'sensor:gamepad',
    commandable: false,
    detail: 'gamepad axes/buttons update — lazy RAF poll',
    payload: '{ index, axes, buttons, pressed }',
  },
  {
    name: 'sensor:network',
    commandable: false,
    detail: 'network online/type change — lazy',
    payload: '{ online, type, downlink, rtt }',
  },

  // ── Haptics (commandable output, not sensor input) ────────────────────────
  {
    name: 'haptics:vibrate',
    commandable: true,
    detail: 'actuate device vibration',
    payload: '{ pattern }',
  },
  { name: 'haptics:tap', commandable: true, detail: 'short 40ms tap vibration', payload: '{}' },
  {
    name: 'haptics:buzz',
    commandable: true,
    detail: 'sustained buzz vibration',
    payload: '{ ms }',
  },
  { name: 'haptics:stop', commandable: true, detail: 'stop current vibration', payload: '{}' },

  // ── Serial / GPIO (WebSerial, ADR 020) ────────────────────────────────────
  // serial:connect requires a user gesture — wire emit() to a button click.
  // Port survives resets; run-scoped subscribers wiped automatically.
  {
    name: 'serial:connect',
    commandable: true,
    detail: 'open a WebSerial port — needs user gesture',
    payload: '{ baudRate?=115200, parse?, serialize?, mode?="text" }',
  },
  {
    name: 'serial:disconnect',
    commandable: true,
    detail: 'close the WebSerial port',
    payload: '{}',
  },
  {
    name: 'serial:write',
    commandable: true,
    detail: 'write raw data to serial port',
    payload: '{ data }',
  },
  {
    name: 'serial:status',
    commandable: false,
    detail: 'WebSerial connection status changed',
    payload: '{ connected, port: { vendorId, productId } }',
  },
  {
    name: 'sensor:serial:data',
    commandable: false,
    detail: 'data received from serial port',
    payload: '{ line } (text) | { bytes } (binary)',
  },
  {
    name: 'gpio:pin',
    commandable: false,
    primary: 'pin',
    detail: 'GPIO pin value received (parsed from serial line)',
    payload: '{ pin, value }',
  },
  {
    name: 'gpio:write',
    commandable: true,
    detail: 'write a GPIO pin value via serial',
    payload: '{ pin, value }',
  },

  // ── Shader ────────────────────────────────────────────────────────────────
  {
    name: 'shader:compile',
    commandable: false,
    detail: 'shader compiled successfully',
    payload: "{ id, type: 'wgsl'|'glsl' }",
  },
  {
    name: 'shader:error',
    commandable: false,
    detail: 'shader compilation or command error',
    payload: '{ id, error, line }',
  },
  { name: 'shader:start', commandable: true, detail: 'start a shader by id', payload: '{ id }' },
  { name: 'shader:stop', commandable: true, detail: 'stop a shader by id', payload: '{ id }' },
  {
    name: 'shader:uniform',
    commandable: true,
    detail: 'set a shader uniform by id',
    payload: '{ id, key, value }',
  },

  // ── Session / Editor ──────────────────────────────────────────────────────
  {
    name: 'session:start',
    commandable: false,
    detail: 'the sketch started running',
    payload: '{ code }',
  },
  { name: 'session:stop', commandable: false, detail: 'the running sketch stopped', payload: '{}' },
  {
    name: 'session:reset',
    commandable: false,
    detail: 'full state reset — fires before clearRunScoped',
    payload: '{}',
  },
  {
    name: 'session:error',
    commandable: false,
    detail: 'runtime error thrown by the sketch',
    payload: '{ error, line, col }',
  },
  {
    name: 'editor:change',
    commandable: false,
    detail: 'editor text changed (debounced)',
    payload: '{ code }',
  },
  { name: 'editor:save', commandable: false, detail: 'editor content saved', payload: '{ code }' },

  // ── Notepad widget ────────────────────────────────────────────────────────
  {
    name: 'note:type',
    commandable: false,
    detail: 'type() animation started on a Notepad',
    payload: '{ winId, text }',
  },
  {
    name: 'note:char',
    commandable: false,
    primary: 'char',
    detail: 'one character revealed by type()',
    payload: '{ winId, char, index }',
  },
  {
    name: 'note:done',
    commandable: false,
    detail: 'type() or backspace() animation finished',
    payload: '{ winId, text }',
  },
  {
    name: 'note:change',
    commandable: false,
    detail: 'Notepad content changed (user or code), debounced',
    payload: '{ winId, text }',
  },
  {
    name: 'note:cursor',
    commandable: false,
    detail: 'Notepad caret position changed',
    payload: '{ winId, pos }',
  },
  {
    name: 'note:select',
    commandable: false,
    detail: 'Notepad text selection changed',
    payload: '{ winId, from, to }',
  },

  // ── File ──────────────────────────────────────────────────────────────────
  {
    name: 'file:pick',
    commandable: false,
    detail: 'file picked via system file picker',
    payload: '{ key, url, name, type }',
  },
  {
    name: 'file:browse',
    commandable: false,
    detail: 'file browser panel opened',
    payload: '{ key }',
  },
  {
    name: 'file:select',
    commandable: false,
    detail: 'file selected in browser panel',
    payload: '{ key, url, name }',
  },
];

// Per-window scoped event patterns (wm:{winId}:...). Excluded from SYSTEM_EVENTS so the
// completion integrity test (which iterates SYSTEM_EVENTS) stays literal-only. Used by
// event-completion.js to offer scoped completions when the user types 'wm:'.
export const DYNAMIC_EVENT_PATTERNS = [
  {
    pattern: 'wm:{winId}:key:down',
    primary: 'key',
    detail: 'key pressed while this window is focused',
    payload: '{ key, code, repeat }',
  },
  {
    pattern: 'wm:{winId}:key:up',
    primary: 'key',
    detail: 'key released while this window is focused',
    payload: '{ key, code }',
  },
  {
    pattern: 'wm:{winId}:mouse:down',
    primary: 'button',
    detail: 'mouse pressed inside this window (body-relative coords)',
    payload: '{ button, x, y }',
  },
  {
    pattern: 'wm:{winId}:mouse:up',
    primary: 'button',
    detail: 'mouse released inside this window (body-relative coords)',
    payload: '{ button, x, y }',
  },
  {
    pattern: 'wm:{winId}:mouse:click',
    primary: 'button',
    detail: 'click inside this window (body-relative coords)',
    payload: '{ button, x, y }',
  },
  {
    pattern: 'wm:{winId}:mouse:move',
    detail: 'pointer moved inside this window (body-relative coords, lazy)',
    payload: '{ x, y }',
  },
  {
    pattern: 'wm:{winId}:note:char',
    primary: 'char',
    detail: 'character revealed by type() in this Notepad window',
    payload: '{ char, index }',
  },
  {
    pattern: 'wm:{winId}:note:done',
    detail: 'type()/backspace() finished in this Notepad window',
    payload: '{ text }',
  },
  {
    pattern: 'wm:{winId}:note:change',
    detail: 'content changed in this Notepad window',
    payload: '{ text }',
  },
  {
    pattern: 'wm:{winId}:note:cursor',
    detail: 'caret moved in this Notepad window',
    payload: '{ pos }',
  },
  {
    pattern: 'wm:{winId}:note:select',
    detail: 'selection changed in this Notepad window',
    payload: '{ from, to }',
  },
];
