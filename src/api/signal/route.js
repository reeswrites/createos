// route.js — cross-domain signal chain (ADR 025)
//
// window.route(source) creates a Route: a typed signal flowing from a source,
// through composable transforms, to one or more sinks.
//
// Source kinds:
//   'discrete'   — bus event name string ('midi:cc', 'beat:bar', etc.)
//   'continuous' — Source.mic, fn, signal-obj, Tone.Signal reader
//   'frame'      — Source.camera, canvas, video — visual pipeline via pipe()
//
// Clock model (per-sink driver, decided at .to()):
//   discrete + stateless chain + all-immediate sinks → push (event-sync, sub-ms)
//   anything else → RAF pull (single driver)
//
// Visual frame routes delegate to pipe() internally. New effects
// (tint/negative/solarize/posterize/duotone/grain/strobe) are pipe stages
// accessible both via route() and directly via pipe().

import { runScopedOutput } from '../../runtime/run-scoped.js';
import { activeEditorId, isPaused } from '../../runtime/run-context.js';
import { subscribe, notify } from '../../events/bus.js';
import { pipe, sourceKind, sourceField } from '../visual/render-pipeline.js';
import { audio } from '../audio/audio.js';
import { VideoSignalAPI } from './video-signal.js';
import { _isCanvas, _isVideo } from '../visual/drawable-source.js';
import { openRouteInspector } from './route-inspector.js';
import { isVideoSignal, isAudioSignal } from './signal-shape.js';

// ── Native timing (captured before user-code patching) ────────────────────────
// RAF is native — route keeps its own loop independent of the patched scheduler.
// Timeline (wait/loop) intentionally uses patched window.setTimeout so it pauses
// with __ar_paused and is cleaned up by the harness — same exception as tick().
const _nativeRAF = window.requestAnimationFrame.bind(window);
const _nativeCancelRAF = window.cancelAnimationFrame.bind(window);

// ── Live route registry (signalGraph + cleanup) ───────────────────────────────
const _routes = new Set();
export function getLiveRoutes() {
  return _routes;
}

// ── SKIP sentinel — filter/debounce swallow values without writing ─────────────
const SKIP = Symbol('route:skip');

// ── STT tap events (ADR 039) ───────────────────────────────────────────────────
// Tapping one of these auto-starts a shared Speech-to-Text engine on the route's
// audio (camera/canvas have no audio → mic fallback). These taps are allowed on
// non-frame sources too (e.g. mic-only routes), unlike ordinary frame taps.
const STT_EVENTS = new Set(['audio:word:interim', 'audio:word:final', 'audio:transcript']);

// ── Transform registry ────────────────────────────────────────────────────────
// Each factory returns { name, args, stateful, step }.
// stateful:true → forces whole-route RAF (single evaluation cadence).

function _t(name, args, stateful, step) {
  return { name, args, stateful, step };
}

function _makeSmooth(f = 0.8) {
  let p = 0;
  return _t('smooth', [f], true, (v) => {
    p = p * f + v * (1 - f);
    return p;
  });
}

function _makeDebounce(ms) {
  let last = 0;
  return _t('debounce', [ms], true, (v) => {
    const n = performance.now();
    if (n - last < ms) return SKIP;
    last = n;
    return v;
  });
}

// ── Color parser (for duotone / tint) ────────────────────────────────────────

function _parseColor(color) {
  // Supports #rgb and #rrggbb. Other formats fall back to [0,0,0].
  if (typeof color === 'string' && color.startsWith('#')) {
    const h = color.slice(1);
    if (h.length === 3) {
      return [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16)];
    }
    if (h.length === 6) {
      return [
        parseInt(h.slice(0, 2), 16),
        parseInt(h.slice(2, 4), 16),
        parseInt(h.slice(4, 6), 16),
      ];
    }
  }
  return [0, 0, 0];
}

// ── Source resolver (Option B: string = event name) ───────────────────────────

function resolveSource(src) {
  // String → discrete bus event
  if (typeof src === 'string') {
    return { kind: 'discrete', sub: (fn) => subscribe(src, fn), label: src };
  }

  // Source.mic token
  if (sourceKind(src) === 'mic') {
    return { kind: 'continuous', read: () => audio.level, label: 'mic', isMic: true };
  }

  // Source.camera token (sentinel {_src:'camera'} from render-pipeline.js)
  if (sourceKind(src) === 'camera') {
    return { kind: 'frame', raw: src, label: 'camera' };
  }

  // Source.gaze.{x,y,vx,vy} token (ADR 034) — continuous scalar from vision gaze.
  // vx/vy need calibration; hold last-valid (default 0) and warn once if uncalibrated.
  if (sourceKind(src) === 'gaze') {
    const field = sourceField(src);
    const isScreen = field === 'vx' || field === 'vy';
    let last = 0,
      warned = false;
    return {
      kind: 'continuous',
      label: 'gaze.' + field,
      read: () => {
        const g = window.vision?.gaze?.();
        if (!g) return last;
        const v = g[field];
        if (isScreen && v == null) {
          if (!warned) {
            console.warn(
              `route(Source.gaze.${field}): gaze not calibrated — holding ${last}. Call vision.calibrate().`,
            );
            warned = true;
          }
          return last;
        }
        if (typeof v === 'number') last = v;
        return last;
      },
    };
  }

  // Function → continuous reader
  if (typeof src === 'function') {
    return { kind: 'continuous', read: src, label: 'fn' };
  }

  if (src !== null && typeof src === 'object') {
    // video.signal() object — has brightness + motion
    if (isVideoSignal(src)) {
      return { kind: 'continuous', read: () => src, label: 'video.signal', _signalObj: src };
    }
    // audio.signal() object — has value + fft
    if (isAudioSignal(src)) {
      return { kind: 'continuous', read: () => src, label: 'audio.signal', _signalObj: src };
    }
    // Tone.Signal / AudioParam — numeric .value
    if ('value' in src && typeof src.value === 'number') {
      return { kind: 'continuous', read: () => src.value, label: 'audioparam' };
    }
  }

  // HTML canvas / video element → frame
  if (_isCanvas(src)) return { kind: 'frame', raw: src, label: 'canvas' };
  if (_isVideo(src)) return { kind: 'frame', raw: src, label: 'video' };

  throw new Error(
    'route(): unsupported source — pass a bus event string, Source.mic, Source.camera, Source.gaze.x/.y/.vx/.vy, ' +
      'a signal object (video.signal/audio.signal), a fn, or a canvas/video element.',
  );
}

// ── Sink resolver ─────────────────────────────────────────────────────────────
// immediate:true → can run sub-ms on push driver (audio param, event emit, fn)
// immediate:false → RAF sink (shader uniform, canvas — display-bound)

function resolveSink(sink, uniformPath, opts = {}) {
  // fn escape hatch
  if (typeof sink === 'function') {
    return { write: (v) => sink(v), immediate: true, label: 'fn' };
  }

  // String = emit bus event
  if (typeof sink === 'string') {
    return {
      write: (v) => notify(sink, typeof v === 'object' && v !== null ? v : { value: v }),
      immediate: true,
      label: sink,
    };
  }

  if (sink !== null && typeof sink === 'object') {
    // Shader instance + uniform path (second arg to .to())
    if (uniformPath && typeof sink.setUniform === 'function') {
      const dot = uniformPath.indexOf('.');
      if (dot !== -1) {
        // Read-modify-write swizzle: 'uCustom.x' → set only the .x component
        const uname = uniformPath.slice(0, dot);
        const component = uniformPath.slice(dot + 1);
        return {
          write: (v) => {
            const cur = sink.getUniform(uname) ?? { x: 0, y: 0, z: 0, w: 0 };
            sink.setUniform(uname, { ...cur, [component]: v });
          },
          immediate: false, // visual — display-bound
          label: `shader:${uniformPath}`,
        };
      }
      return {
        write: (v) => sink.setUniform(uniformPath, v),
        immediate: false,
        label: `shader:${uniformPath}`,
      };
    }

    // Tone.Signal / AudioParam — has numeric .value
    if ('value' in sink && typeof sink.value === 'number') {
      const rampMs = opts.ramp;
      if (rampMs && typeof sink.rampTo === 'function') {
        return {
          write: (v) => sink.rampTo(v, rampMs / 1000),
          immediate: true,
          label: 'audioparam',
        };
      }
      return {
        write: (v) => {
          sink.value = v;
        },
        immediate: true,
        label: 'audioparam',
      };
    }
  }

  throw new Error(
    'route().to(): unsupported sink — pass an event string, fn, Tone.Signal/AudioParam, ' +
      'or (shaderInst, "uniformPath").',
  );
}

// ── Route ─────────────────────────────────────────────────────────────────────

class Route {
  constructor(src) {
    this._src = resolveSource(src);
    this._chain = []; // [{name,args,stateful,step}]
    this._stateful = false; // any stateful transform in chain?
    this._sinks = []; // [{write, immediate, label}]
    this._raf = null;
    this._scoped = null; // runScopedOutput handle (owner-scoped + keep-alive)
    this._started = false;
    this._destroyed = false;
    this._subs = []; // unsubscribe fns (bus subscriptions)
    this._onSubs = []; // route-scoped .on() unsubscribe fns
    this._mixSources = []; // [{read, combineFn}] for fan-in
    this._held = undefined; // sample-and-hold cell (discrete source)
    this._heldResult = undefined; // evaluated result held for RAF sinks

    // Frame-route state
    this._pipeline = null; // the Pipeline instance (frame routes only)
    this._taps = []; // [{event, fn}] registered via .tap()
    this._stageQueue = []; // [{op:'add'|'clear', type?, args?}] pending stages
    this._timelineParts = []; // [{atMs, ops:[]}] committed by wait()
    this._cursor = 0; // accumulated ms timeline cursor
    this._inTimeline = false; // true after first wait()
    this._looping = false;
    this._timeoutId = null;

    // Owner editor — set when constructed during a run (app.js tags it before
    // user code executes). Lets the reset handler tear down only this editor's
    // routes, so running one editor doesn't kill another's live output.
    this._ownerEditorId = activeEditorId();

    _routes.add(this);
  }

  // ── Structural guards ─────────────────────────────────────────────────────

  _assertScalar(op) {
    if (this._src.kind === 'frame') {
      throw new Error(
        `route().${op}(): scalar transform on a frame source. ` +
          `Add a bridge first: .brightness() .motion() or similar.`,
      );
    }
  }

  _assertFrame(op) {
    if (this._src.kind !== 'frame') {
      throw new Error(
        `route().${op}(): visual/frame method requires a frame source ` +
          `(Source.camera, canvas element, video element).`,
      );
    }
  }

  _assertBridgeable(op) {
    if (this._src.kind === 'discrete') {
      throw new Error(
        `route().${op}: bridge on a discrete (event) source. ` +
          `Bridges only work on continuous or frame sources.`,
      );
    }
  }

  // ── Scalar transforms (stateless) ─────────────────────────────────────────

  _addTransform(t) {
    this._chain.push(t);
    if (t.stateful) this._stateful = true;
    return this;
  }

  scale(a, b, c, d) {
    this._assertScalar('scale');
    return this._addTransform(
      _t('scale', [a, b, c, d], false, (v) => (b === a ? c : c + ((v - a) * (d - c)) / (b - a))),
    );
  }
  clamp(lo, hi) {
    this._assertScalar('clamp');
    return this._addTransform(_t('clamp', [lo, hi], false, (v) => Math.min(hi, Math.max(lo, v))));
  }
  norm(lo, hi) {
    this._assertScalar('norm');
    return this._addTransform(
      _t('norm', [lo, hi], false, (v) => (hi === lo ? 0 : (v - lo) / (hi - lo))),
    );
  }
  invert() {
    this._assertScalar('invert');
    return this._addTransform(_t('invert', [], false, (v) => 1 - v));
  }
  get(k) {
    this._assertScalar('get');
    return this._addTransform(_t('get', [k], false, (v) => v?.[k]));
  }
  filter(pred) {
    this._assertScalar('filter');
    return this._addTransform(_t('filter', [pred], false, (v) => (pred(v) ? v : SKIP)));
  }
  threshold(t) {
    this._assertScalar('threshold');
    return this._addTransform(_t('threshold', [t], false, (v) => (v >= t ? 1 : 0)));
  }
  gate(lo, hi) {
    this._assertScalar('gate');
    return this._addTransform(_t('gate', [lo, hi], false, (v) => (v >= lo && v <= hi ? v : SKIP)));
  }

  // Scalar transforms (stateful) — force whole-route RAF driver
  smooth(f = 0.8) {
    this._assertScalar('smooth');
    return this._addTransform(_makeSmooth(f));
  }
  debounce(ms) {
    this._assertScalar('debounce');
    return this._addTransform(_makeDebounce(ms));
  }

  // ── Bridges — retype source to scalar (wrap existing samplers) ────────────
  // Position-constrained: must come directly after a frame/audio/continuous source.

  get amplitude() {
    this._assertBridgeable('amplitude');
    // Wrap audio.level — reuses the harness mic analyser (no new sampling)
    import('../media/media-lease.js').then((m) => m.acquireMicRunScoped?.()).catch(() => {});
    this._src = {
      kind: 'continuous',
      read: () => audio.level,
      label: this._src.label + '.amplitude',
      isMic: true,
    };
    return this;
  }

  brightness(opts) {
    this._assertBridgeable('brightness');
    const rawSrc = this._src.raw ?? this._src._signalObj;
    const sig = isVideoSignal(this._src._signalObj)
      ? this._src._signalObj
      : VideoSignalAPI.signal(rawSrc ?? 'camera', opts);
    this._src = {
      kind: 'continuous',
      read: () => sig.brightness,
      label: this._src.label + '.brightness',
    };
    return this;
  }

  motion(opts) {
    this._assertBridgeable('motion');
    const rawSrc = this._src.raw ?? this._src._signalObj;
    const sig = isVideoSignal(this._src._signalObj)
      ? this._src._signalObj
      : VideoSignalAPI.signal(rawSrc ?? 'camera', opts);
    this._src = { kind: 'continuous', read: () => sig.motion, label: this._src.label + '.motion' };
    return this;
  }

  fft() {
    this._assertBridgeable('fft');
    const sig = this._src._signalObj ?? audio.fft;
    this._src = {
      kind: 'continuous',
      read: () => sig.fft ?? sig.getValue?.(),
      label: this._src.label + '.fft',
    };
    return this;
  }

  // ── Fan-in (.mix) — multiple sources into one value ───────────────────────

  mix(otherSrc, combineFn) {
    let read;
    if (otherSrc instanceof Route) {
      // Extract the reader from the other Route and clean it up (it's a source-only route)
      read = otherSrc._src.read ?? (() => undefined);
      _routes.delete(otherSrc); // not a full route — no sinks, no keep-alive
    } else {
      const resolved = resolveSource(otherSrc);
      read = resolved.kind === 'continuous' ? resolved.read : () => undefined;
    }
    this._mixSources.push({ read, combineFn });
    this._stateful = true; // fan-in forces RAF
    return this;
  }

  // ── Sinks ─────────────────────────────────────────────────────────────────

  /**
   * Route the signal to a sink.
   *
   * @param {string|function|object} sink
   *   - string: emit as bus event
   *   - fn: called with each value
   *   - Tone.Signal / AudioParam: writes .value (direct, sub-ms) or .rampTo with {ramp:ms}
   *   - shader instance: pass uniform path as second arg
   * @param {string|object} [uniformPathOrOpts]  'uCustom.x' for shader, or {ramp:ms} for audio
   * @param {object} [opts]  {ramp:ms} when uniformPath also provided
   */
  to(sink, uniformPathOrOpts, opts) {
    let uniformPath = null;
    let sinkOpts = opts ?? {};
    if (typeof uniformPathOrOpts === 'string') {
      uniformPath = uniformPathOrOpts;
    } else if (uniformPathOrOpts && typeof uniformPathOrOpts === 'object') {
      sinkOpts = uniformPathOrOpts;
    }
    const resolved = resolveSink(sink, uniformPath, sinkOpts);
    this._sinks.push(resolved);
    this._startScalar();
    return this;
  }

  // ── Frame-route display ───────────────────────────────────────────────────

  tap(event, fn) {
    const isStt = STT_EVENTS.has(event);
    // Ordinary (non-STT) taps remain frame-only. STT taps are allowed on any source
    // (e.g. a mic-only route with no window). Subscribing to an audio:word:* / transcript
    // event auto-starts the shared STT engine via audio.js's registerSource — Web Speech
    // or the in-browser ML model per audio.speechEngine. Camera/canvas carry no audio, so
    // that engine taps the mic (ADR 039). Nothing to acquire here — just subscribe.
    if (!isStt) this._assertFrame('tap');
    this._taps.push({ event, fn });

    // Non-frame STT routes have no .show() — subscribe now (winId null) to trigger start.
    if (isStt && this._src.kind !== 'frame') {
      const unsub = subscribe(event, (payload) => fn(payload, null));
      this._subs.push(unsub);
    }
    return this;
  }

  show(title, opts) {
    this._assertFrame('show');
    this._buildAndShow(title ?? 'Route', opts);
    this.winId = this._pipeline?.winId ?? null;
    const winId = this.winId;
    for (const { event, fn } of this._taps) {
      const unsub = subscribe(event, (payload) => fn(payload, winId));
      this._subs.push(unsub);
    }
    return this;
  }

  layer(z) {
    this._assertFrame('layer');
    this._commitRemainingStages();
    this._buildPipeline();
    this._pipeline.layer(z);
    this._startFrameKeepAlive();
    return this;
  }

  // ── Frame-route visual effect stages ────────────────────────────────────

  tint(color) {
    return this._addStageOp('tint', [color]);
  }
  negative() {
    return this._addStageOp('negative', []);
  }
  solarize(t = 0.5) {
    return this._addStageOp('solarize', [t]);
  }
  posterize(n = 4) {
    return this._addStageOp('posterize', [n]);
  }
  duotone(c1, c2) {
    return this._addStageOp('duotone', [c1, c2]);
  }
  grain(amt = 0.15) {
    return this._addStageOp('grain', [amt]);
  }
  strobe(fps = 4) {
    return this._addStageOp('strobe', [fps]);
  }
  blur(r = 4) {
    return this._addStageOp('blur', [r]);
  }
  hue(deg = 0) {
    return this._addStageOp('hue', [deg]);
  }
  ascii(opts) {
    return this._addStageOp('ascii', [opts ?? {}]);
  }
  pixelate(opts) {
    return this._addStageOp('pixelate', [opts ?? {}]);
  }
  fx(filter) {
    return this._addStageOp('fx', [filter]);
  }
  glshader(body, o) {
    return this._addStageOp('glshader', [body, o ?? {}]);
  }
  // Mask the frame to a drawable's region (ADR 054). Chain .mask().mask() to
  // intersect separate sources; time it with .wait()/.toggle('mask').
  mask(source, opts) {
    return this._addStageOp('mask', [source, opts ?? {}]);
  }

  _addStageOp(type, args) {
    if (this._pipeline && this._pipeline._rafId) {
      // Pipeline already running — live add
      this._pipeline._addNamedStage(type, args);
    } else {
      this._stageQueue.push({ op: 'add', type, args });
    }
    return this;
  }

  // ── Runtime mutation (named stages on live pipeline) ──────────────────────

  toggle(stageName) {
    this._assertFrame('toggle');
    this._pipeline?._toggleNamedStage(stageName);
    return this;
  }

  remove(stageName) {
    this._assertFrame('remove');
    this._pipeline?._removeNamedStage(stageName);
    return this;
  }

  clearEffects() {
    if (this._src.kind === 'frame') {
      if (this._pipeline && this._pipeline._rafId) {
        this._pipeline._clearNamedStages();
      } else {
        this._stageQueue.push({ op: 'clear' });
      }
    }
    return this;
  }

  clear() {
    return this.clearEffects();
  }

  // ── Temporal control (frame routes, optical-printing model) ───────────────
  // Effects accumulate between wait() calls. clearEffects() = scene boundary.
  // Driven by patched window.setTimeout so it pauses/cleans with harness.

  wait(sec) {
    this._assertFrame('wait');
    // Commit current stageQueue as a timeline segment at the current cursor
    this._timelineParts.push({ atMs: this._cursor, ops: [...this._stageQueue] });
    this._stageQueue = [];
    this._cursor += sec * 1000;
    this._inTimeline = true;
    return this;
  }

  loop() {
    this._assertFrame('loop');
    this._looping = true;
    return this;
  }

  // ── Route-scoped .on() ────────────────────────────────────────────────────
  // Chainable; cb(route, payload). Auto-cleaned when route is destroyed.

  on(event, cb) {
    const unsub = subscribe(event, (payload) => cb(this, payload));
    this._onSubs.push(unsub);
    return this;
  }

  // ── Chain evaluation ──────────────────────────────────────────────────────

  _eval(v) {
    const inspect = this._inspecting; // ADR 063: record per-stage values while inspected
    if (inspect) {
      this._srcV = v;
      this._srcAt = performance.now();
    }
    for (const t of this._chain) {
      v = t.step(v);
      if (inspect) {
        t._v = v;
        t._at = performance.now();
      }
      if (v === SKIP) return SKIP;
    }
    if (inspect) {
      this._outV = v;
      this._outAt = performance.now();
    }
    return v;
  }

  // ── Live chain inspector (ADR 063) ────────────────────────────────────────
  // .watch() opens a WM window rendering this route's chain with live per-stage values
  // and active-stage lighting (read-only). If the route has no sink yet, watch adds a
  // no-op driver so values flow — and then owns the route (closing the window tears it
  // down); otherwise closing only stops inspecting and leaves the route running.
  // NOT named `inspect`: that collides with the Node/pretty-format custom-inspect
  // protocol — a serializer probes `obj.inspect()`, which (returning `this`) recurses.
  watch(title) {
    if (this._destroyed) return this;
    this._inspecting = true;
    const ownsRoute = this._sinks.length === 0 && !this._started;
    if (ownsRoute) this._sinks.push({ write: () => {}, immediate: false, label: 'inspect' });
    this._startScalar(); // idempotent — drives _eval so values flow
    openRouteInspector(this, { title: title ?? this._src?.label ?? 'Route', ownsRoute });
    return this;
  }

  // ── Scalar driver election and start ──────────────────────────────────────

  _startScalar() {
    if (this._started || this._destroyed) return;
    if (this._src.kind === 'frame') return; // frame routes have no scalar driver
    this._started = true;

    const discrete = this._src.kind === 'discrete';
    const hasMix = this._mixSources.length > 0;
    const stateless = !this._stateful && !hasMix;
    const allImmediate = this._sinks.every((s) => s.immediate);

    // Register as a run-scoped output: owner-scoped teardown + keep-alive.
    this._register();

    // ── PUSH driver ──────────────────────────────────────────────────────────
    // Conditions: discrete + stateless chain + no fan-in + all sinks immediate
    // → fire transform chain synchronously on event arrival (sub-ms)
    if (discrete && stateless && allImmediate && !hasMix) {
      const unsub = this._src.sub((payload) => {
        const v = this._eval(payload);
        this._held = payload;
        this._heldResult = v;
        if (v === SKIP) return;
        for (const s of this._sinks) s.write(v);
      });
      if (unsub) this._subs.push(unsub);
    }

    // ── PULL driver (RAF) ─────────────────────────────────────────────────
    // Needed when: continuous source, stateful chain, non-immediate sinks, fan-in,
    // or discrete with non-immediate sinks.
    const needsPull = !discrete || !stateless || !allImmediate || hasMix;

    if (needsPull) {
      // Discrete primary source: also set up hold-cell subscription
      if (discrete && this._subs.length === 0) {
        const unsub = this._src.sub((payload) => {
          this._held = payload;
        });
        if (unsub) this._subs.push(unsub);
      }

      const loop = () => {
        if (!isPaused()) {
          // Read primary source value
          let raw = discrete ? this._held : this._src.read?.();

          // Fan-in: fold mix sources
          if (hasMix && raw !== undefined) {
            for (const { read, combineFn } of this._mixSources) {
              const other = read?.();
              raw = combineFn ? combineFn(raw, other) : ((raw ?? 0) + (other ?? 0)) / 2;
            }
          }

          if (raw !== undefined) {
            const v = this._eval(raw);
            if (v !== SKIP) {
              for (const s of this._sinks) {
                // For discrete + stateless + no fan-in: push driver already wrote
                // immediate sinks on event arrival. Skip them here to avoid double-write.
                // All other cases: RAF is the sole driver → always write.
                const pushedAlready = discrete && stateless && !hasMix && s.immediate;
                if (!pushedAlready) s.write(v);
              }
            }
          }
        }
        this._raf = _nativeRAF(loop);
      };
      this._raf = _nativeRAF(loop);
    }

    this._registerGraph();
  }

  // ── Frame pipeline building ───────────────────────────────────────────────

  _commitRemainingStages() {
    if (this._stageQueue.length > 0) {
      this._timelineParts.push({ atMs: this._cursor, ops: [...this._stageQueue] });
      this._stageQueue = [];
    }
  }

  _buildPipeline() {
    if (this._pipeline) return;
    this._pipeline = pipe(this._src.raw);
  }

  _buildAndShow(title, opts) {
    this._commitRemainingStages();
    this._buildPipeline();

    // Simple case: single segment at t=0, no loop — add stages directly before start
    const isSingleSegment =
      this._timelineParts.length <= 1 &&
      (!this._timelineParts[0] || this._timelineParts[0].atMs === 0) &&
      !this._looping;

    if (isSingleSegment) {
      const ops = this._timelineParts[0]?.ops ?? [];
      for (const op of ops) {
        if (op.op === 'add' && typeof this._pipeline[op.type] === 'function') {
          this._pipeline[op.type](...op.args);
        }
      }
      this._timelineParts = [];
    }

    // Closing the output window must tear down the whole route (release its keep-alive
    // + unsubscribe taps), else the editor idle watcher stays "running" after close.
    this._pipeline.show(title, { ...opts, onClose: () => this._destroy() });

    if (this._timelineParts.length > 0) {
      this._runTimeline();
    }

    this._startFrameKeepAlive();
  }

  _startFrameKeepAlive() {
    if (this._scoped) return;
    this._register();
    this._registerGraph();
  }

  // Register once as a run-scoped output. owner captured at construction (passed
  // explicitly so an async start can't drift it). token carries a label so the
  // Signal Graph reads token.label, not the fragile token.constructor.name.
  _register() {
    if (this._scoped) return;
    this._scoped = runScopedOutput({
      owner: this._ownerEditorId,
      token: { label: this._src?.label },
      onStop: () => this._destroy(),
    });
  }

  _runTimeline() {
    const parts = this._timelineParts;
    if (!parts.length) return;

    const applyOps = (ops) => {
      if (this._destroyed || !this._pipeline) return;
      for (const op of ops) {
        if (op.op === 'clear') {
          this._pipeline._clearNamedStages();
        } else if (op.op === 'add') {
          this._pipeline._addNamedStage(op.type, op.args);
        }
      }
    };

    const applyPart = (idx) => {
      if (this._destroyed || !this._pipeline) return;
      const part = parts[idx];
      if (!part) {
        // All parts done
        if (this._looping) {
          this._pipeline._clearNamedStages();
          this._timeoutId = window.setTimeout(() => applyPart(0), 0);
        }
        return;
      }

      applyOps(part.ops);

      const next = parts[idx + 1];
      if (next) {
        const delay = next.atMs - part.atMs;
        this._timeoutId = window.setTimeout(() => applyPart(idx + 1), delay);
      } else if (this._looping) {
        this._timeoutId = window.setTimeout(() => {
          if (!this._destroyed && this._pipeline) {
            this._pipeline._clearNamedStages();
            applyPart(0);
          }
        }, 0);
      }
    };

    // Start the timeline: first part fires at its atMs from now
    const firstDelay = parts[0].atMs;
    if (firstDelay === 0) {
      applyPart(0);
    } else {
      this._timeoutId = window.setTimeout(() => applyPart(0), firstDelay);
    }
  }

  // ── signalGraph descriptor ────────────────────────────────────────────────

  _descriptor() {
    return {
      source: this._src.label,
      chain: this._chain.map((t) => ({
        op: t.name,
        args: t.args.filter((a) => typeof a !== 'function'),
      })),
      sinks: this._sinks.map((s) => s.label),
    };
  }

  _registerGraph() {
    if (!window.__ar_signalRoutes) window.__ar_signalRoutes = [];
    const d = this._descriptor();
    const chainLabel = d.chain.map((t) => t.op).join('→') || undefined;
    for (const sink of d.sinks) {
      window.__ar_signalRoutes.push({ source: d.source, sink, label: chainLabel });
    }
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────

  _destroy() {
    if (this._destroyed) return;
    this._destroyed = true;

    if (this._raf) {
      _nativeCancelRAF(this._raf);
      this._raf = null;
    }
    if (this._timeoutId) {
      window.clearTimeout(this._timeoutId);
      this._timeoutId = null;
    }

    for (const unsub of this._subs) {
      try {
        unsub?.();
      } catch (_) {}
    }
    for (const unsub of this._onSubs) {
      try {
        unsub?.();
      } catch (_) {}
    }
    this._subs = [];
    this._onSubs = [];

    this._scoped?.dispose(); // releases keep-alive; onStop re-enters _destroy (guarded)
    this._scoped = null;

    // Frame-route pipeline: cleanupPipelines() handles it on reset,
    // but stop it here in case route is destroyed before reset.
    this._pipeline?.stop?.();
    this._pipeline = null;

    _routes.delete(this);
  }
}

// ── Public factory ────────────────────────────────────────────────────────────

/**
 * Create a cross-domain signal route.
 *
 * Source shapes (Option B — strings are event names, not file paths):
 *   'midi:cc'     → discrete bus event
 *   Source.mic    → continuous mic amplitude (0–1)
 *   Source.camera → visual frame stream
 *   video.signal() / audio.signal() object → continuous signal
 *   () => value   → continuous reader fn
 *   canvas/video element → visual frame stream
 *
 * @example
 * // MIDI CC 74 → oscillator frequency (sub-ms push path)
 * route('midi:cc').filter(e => e.cc === 74).norm(0, 127).to(osc.frequency)
 *
 * // Mic amplitude → shader uniform with smoothing (RAF path)
 * route(Source.mic).amplitude.scale(0, 1, 0.2, 2).smooth(0.8).to(myShader, 'uCustom.x')
 *
 * // Camera with time-sequenced visual effects (Berlin Horse pattern)
 * route(Source.camera).tint('#4a0').wait(3).negative().wait(2).clearEffects().solarize(0.6).loop().show()
 *
 * // Fan-in: blend mic amplitude + camera motion
 * route(Source.mic).amplitude.mix(route(Source.camera).motion(), (a, m) => a * 0.5 + m * 0.5)
 *   .scale(0, 1, 200, 800).to(osc.frequency)
 *
 * // VJ pattern: route-scoped event-driven mutation
 * const r = route(Source.camera).show()
 * r.on('beat:bar', r => r.toggle('negative'))
 */
export function route(source) {
  return new Route(source);
}

// Reset cleanup is handled by run-scoped.js's single owner-filtered onReset
// (ADR 008/041): each route registers via runScopedOutput in _register(), and
// dispose() → onStop → _destroy() (which removes it from _routes). No per-module
// reset handler here.
