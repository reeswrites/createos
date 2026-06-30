import { onReset } from '../runtime/reset-registry.js';
import { notify } from '../events/index.js';
// sensors.js — unified sensory signal bus
// Every sensor returns a signal object with live getters + .stream(fn) RAF push.
// Edge triggers (onMove, onShake, onButton, etc.) follow the audio.onLevel pattern.
// Cleanup: cleanupSensors() flushes all per-run RAF loops, watches, and change listeners.
// Module-level listeners (mouse pos, keyboard held) are permanent — they just update state.

const _nativeRAF = window.requestAnimationFrame.bind(window);
const _nativeCAF = window.cancelAnimationFrame.bind(window);
// Capture native addEventListener before harness patches window.addEventListener at execute() time.
const _nativeWinAdd = window.addEventListener.bind(window);
const _nativeDocAdd = document.addEventListener.bind(document);
const _nativeDocRem = document.removeEventListener.bind(document);

const _cleanupFns = [];

export function cleanupSensors() {
  for (const fn of _cleanupFns) {
    try {
      fn();
    } catch (_) {}
  }
  _cleanupFns.length = 0;
  _held.clear(); // stale held keys across reset confuse new runs
}

// ── Module-level permanent state ─────────────────────────────────────────────
// These listeners are added once at module load (before harness patching) and never removed.
// They just keep internal state fresh so signal getters always have current values.

// Mouse
let _mx = 0,
  _my = 0,
  _mraw_x = 0,
  _mraw_y = 0,
  _mButtons = 0;
_nativeWinAdd('mousemove', (e) => {
  _mraw_x = e.clientX;
  _mraw_y = e.clientY;
  _mx = e.clientX / window.innerWidth;
  _my = e.clientY / window.innerHeight;
  _mButtons = e.buttons;
});
_nativeWinAdd('mousedown', (e) => {
  _mButtons = e.buttons;
});
_nativeWinAdd('mouseup', (e) => {
  _mButtons = e.buttons;
});

// Keyboard
const _held = new Set();
let _lastKey = '';
_nativeWinAdd('keydown', (e) => {
  if (_inTextInput() || window.__ar_paused) return;
  _held.add(e.key);
  _lastKey = e.key;
});
_nativeWinAdd('keyup', (e) => {
  _held.delete(e.key);
}); // always clear to avoid stuck keys

// Motion / Orientation (module-level so motion() can be called any time)
let _ax = 0,
  _ay = 0,
  _az = 0;
let _gx = 0,
  _gy = 0,
  _gz = 0;
let _mAlpha = 0,
  _mBeta = 0,
  _mGamma = 0;
_nativeWinAdd('devicemotion', (e) => {
  const a = e.accelerationIncludingGravity ?? e.acceleration ?? {};
  _ax = a.x ?? 0;
  _ay = a.y ?? 0;
  _az = a.z ?? 0;
  const r = e.rotationRate ?? {};
  _gx = r.alpha ?? 0;
  _gy = r.beta ?? 0;
  _gz = r.gamma ?? 0;
});
_nativeWinAdd('deviceorientation', (e) => {
  _mAlpha = e.alpha ?? 0;
  _mBeta = e.beta ?? 0;
  _mGamma = e.gamma ?? 0;
});

// ── Internal helpers ──────────────────────────────────────────────────────────

function _inTextInput() {
  const el = document.activeElement;
  if (!el) return false;
  return el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.isContentEditable;
}

function _raf(fn) {
  let id = _nativeRAF(fn);
  _cleanupFns.push(() => _nativeCAF(id));
  // Return setter so caller can update id on each frame
  return {
    cancel: () => _nativeCAF(id),
    set id(v) {
      id = v;
    },
  };
}

function _edgeTrigger(valueFn, threshold, onEnter, onExit) {
  let wasAbove = false;
  const loop = { id: 0 };
  const frame = () => {
    const above = valueFn() >= threshold;
    if (above && !wasAbove) {
      wasAbove = true;
      onEnter();
    }
    if (!above && wasAbove) {
      wasAbove = false;
      onExit?.();
    }
    loop.id = _nativeRAF(frame);
  };
  loop.id = _nativeRAF(frame);
  _cleanupFns.push(() => _nativeCAF(loop.id));
}

// ── SensorsAPI ────────────────────────────────────────────────────────────────

export const SensorsAPI = {
  // ── Mouse ──────────────────────────────────────────────────────────────────
  // sig.x/y      normalized 0–1 within viewport
  // sig.px/py    raw pixels
  // sig.vx/vy    per-frame velocity (normalized)
  // sig.buttons  bitmask: bit0=left, bit1=right, bit2=middle
  // sig.left/right/middle  convenience booleans
  mouse() {
    let _pvx = 0,
      _pvy = 0,
      _px = _mx,
      _py = _my;

    const sig = {
      get x() {
        return _mx;
      },
      get y() {
        return _my;
      },
      get px() {
        return _mraw_x;
      },
      get py() {
        return _mraw_y;
      },
      get vx() {
        return _pvx;
      },
      get vy() {
        return _pvy;
      },
      get speed() {
        return Math.sqrt(_pvx * _pvx + _pvy * _pvy);
      },
      get buttons() {
        return _mButtons;
      },
      get left() {
        return !!(_mButtons & 1);
      },
      get right() {
        return !!(_mButtons & 2);
      },
      get middle() {
        return !!(_mButtons & 4);
      },

      stream(fn) {
        const loop = { id: 0 };
        const frame = () => {
          _pvx = _mx - _px;
          _pvy = _my - _py;
          _px = _mx;
          _py = _my;
          fn(sig);
          loop.id = _nativeRAF(frame);
        };
        loop.id = _nativeRAF(frame);
        _cleanupFns.push(() => _nativeCAF(loop.id));
        return sig;
      },

      // Fires onEnter when movement speed exceeds threshold (normalized units/frame).
      onMove(threshold, onEnter, onExit) {
        let wasAbove = false,
          px = _mx,
          py = _my;
        const loop = { id: 0 };
        const frame = () => {
          const vx = _mx - px,
            vy = _my - py;
          px = _mx;
          py = _my;
          const speed = Math.sqrt(vx * vx + vy * vy);
          const above = speed >= threshold;
          if (above && !wasAbove) {
            wasAbove = true;
            onEnter(sig);
          }
          if (!above && wasAbove) {
            wasAbove = false;
            onExit?.(sig);
          }
          loop.id = _nativeRAF(frame);
        };
        loop.id = _nativeRAF(frame);
        _cleanupFns.push(() => _nativeCAF(loop.id));
        return sig;
      },

      // Edge-trigger on mouse button. btn: 0=left, 1=right, 2=middle.
      onButton(btn, onDown, onUp) {
        const mask = 1 << btn;
        let wasDown = false;
        const loop = { id: 0 };
        const frame = () => {
          const down = !!(_mButtons & mask);
          if (down && !wasDown) {
            wasDown = true;
            onDown(sig);
          }
          if (!down && wasDown) {
            wasDown = false;
            onUp?.(sig);
          }
          loop.id = _nativeRAF(frame);
        };
        loop.id = _nativeRAF(frame);
        _cleanupFns.push(() => _nativeCAF(loop.id));
        return sig;
      },
    };
    return sig;
  },

  // ── Keyboard ───────────────────────────────────────────────────────────────
  // sig.held     Set of currently held key names
  // sig.last     last key pressed this run
  // sig.is(key)  true if key currently held
  keyboard() {
    const sig = {
      get held() {
        return _held;
      },
      get last() {
        return _lastKey;
      },
      is(key) {
        return _held.has(key);
      },
      any(...keys) {
        return keys.some((k) => _held.has(k));
      },

      stream(fn) {
        const loop = { id: 0 };
        const frame = () => {
          fn(sig);
          loop.id = _nativeRAF(frame);
        };
        loop.id = _nativeRAF(frame);
        _cleanupFns.push(() => _nativeCAF(loop.id));
        return sig;
      },

      // key: exact key name ('ArrowLeft', 'a', ' ', '*' for any key)
      onKey(key, onDown, onUp) {
        const kd = (e) => {
          if (_inTextInput() || window.__ar_paused) return;
          if (key === '*' || e.key === key) onDown(sig, e);
        };
        const ku = (e) => {
          if (_inTextInput() || window.__ar_paused) return;
          if (key === '*' || e.key === key) onUp?.(sig, e);
        };
        _nativeDocAdd('keydown', kd);
        _nativeDocAdd('keyup', ku);
        _cleanupFns.push(() => {
          _nativeDocRem('keydown', kd);
          _nativeDocRem('keyup', ku);
        });
        return sig;
      },
    };
    return sig;
  },

  // ── Gamepad ────────────────────────────────────────────────────────────────
  // Axes 0–3: left_x, left_y, right_x, right_y (-1..1). Buttons 0–15 (0..1).
  // Must poll — no events for axis changes.
  // sig.axis(i)     f32 -1..1
  // sig.button(i)   f32 0..1 (analog)
  // sig.pressed(i)  bool
  gamepad(index = 0) {
    const sig = {
      get pad() {
        return navigator.getGamepads?.()[index] ?? null;
      },
      get connected() {
        return !!sig.pad?.connected;
      },
      get axes() {
        return sig.pad?.axes ?? [];
      },
      get buttons() {
        return sig.pad?.buttons ?? [];
      },
      axis(i) {
        return sig.pad?.axes[i] ?? 0;
      },
      button(i) {
        return sig.pad?.buttons[i]?.value ?? 0;
      },
      pressed(i) {
        return sig.pad?.buttons[i]?.pressed ?? false;
      },

      stream(fn) {
        const loop = { id: 0 };
        const frame = () => {
          fn(sig);
          loop.id = _nativeRAF(frame);
        };
        loop.id = _nativeRAF(frame);
        _cleanupFns.push(() => _nativeCAF(loop.id));
        return sig;
      },

      // Edge-trigger on digital button press.
      onButton(i, onDown, onUp) {
        let wasDown = false;
        const loop = { id: 0 };
        const frame = () => {
          const down = sig.pressed(i);
          if (down && !wasDown) {
            wasDown = true;
            onDown(sig);
          }
          if (!down && wasDown) {
            wasDown = false;
            onUp?.(sig);
          }
          loop.id = _nativeRAF(frame);
        };
        loop.id = _nativeRAF(frame);
        _cleanupFns.push(() => _nativeCAF(loop.id));
        return sig;
      },

      // Fires onEnter when |axis(i)| >= threshold.
      onAxis(i, threshold, onEnter, onExit) {
        let wasAbove = false;
        const loop = { id: 0 };
        const frame = () => {
          const above = Math.abs(sig.axis(i)) >= threshold;
          if (above && !wasAbove) {
            wasAbove = true;
            onEnter(sig);
          }
          if (!above && wasAbove) {
            wasAbove = false;
            onExit?.(sig);
          }
          loop.id = _nativeRAF(frame);
        };
        loop.id = _nativeRAF(frame);
        _cleanupFns.push(() => _nativeCAF(loop.id));
        return sig;
      },
    };
    return sig;
  },

  // ── Motion / Orientation ───────────────────────────────────────────────────
  // ax/ay/az  acceleration incl. gravity, m/s²
  // gx/gy/gz  rotation rate, deg/s
  // alpha     compass heading 0–360 (deg)
  // beta      front-back tilt -180..180 (deg)
  // gamma     left-right tilt -90..90 (deg)
  // magnitude total acceleration magnitude
  //
  // iOS 13+ requires sensors.requestMotion() called from a user gesture first.
  motion() {
    const sig = {
      get ax() {
        return _ax;
      },
      get ay() {
        return _ay;
      },
      get az() {
        return _az;
      },
      get gx() {
        return _gx;
      },
      get gy() {
        return _gy;
      },
      get gz() {
        return _gz;
      },
      get alpha() {
        return _mAlpha;
      },
      get beta() {
        return _mBeta;
      },
      get gamma() {
        return _mGamma;
      },
      get magnitude() {
        return Math.sqrt(_ax * _ax + _ay * _ay + _az * _az);
      },

      stream(fn) {
        const loop = { id: 0 };
        const frame = () => {
          fn(sig);
          loop.id = _nativeRAF(frame);
        };
        loop.id = _nativeRAF(frame);
        _cleanupFns.push(() => _nativeCAF(loop.id));
        return sig;
      },

      // Fires when total acceleration magnitude >= threshold (m/s²). Default 15 ≈ hard shake.
      onShake(threshold = 15, onEnter, onExit) {
        _edgeTrigger(
          () => sig.magnitude,
          threshold,
          () => {
            notify('sensor:shake', { magnitude: sig.magnitude });
            onEnter(sig);
          },
          onExit ? () => onExit(sig) : undefined,
        );
        return sig;
      },

      // Fires when |sig[axis]| >= threshold. axis: 'alpha'|'beta'|'gamma'|'ax'|'ay'|'az'.
      onTilt(axis, threshold, onEnter, onExit) {
        _edgeTrigger(
          () => Math.abs(sig[axis] ?? 0),
          threshold,
          () => onEnter(sig),
          onExit ? () => onExit(sig) : undefined,
        );
        return sig;
      },
    };
    return sig;
  },

  // iOS 13+: must call from a user gesture (button click, etc.) before sensors.motion().
  async requestMotion() {
    if (typeof DeviceMotionEvent?.requestPermission === 'function') {
      const res = await DeviceMotionEvent.requestPermission();
      if (res !== 'granted') throw new Error('Motion permission denied');
    }
    if (typeof DeviceOrientationEvent?.requestPermission === 'function') {
      await DeviceOrientationEvent.requestPermission().catch(() => {});
    }
    return this.motion();
  },

  // ── Geolocation ────────────────────────────────────────────────────────────
  // sig.lat/lon   decimal degrees
  // sig.speed     m/s (null if unavailable)
  // sig.heading   degrees from north (null if unavailable)
  // sig.altitude  meters (null if unavailable)
  // sig.accuracy  meters
  // sig.ready     true once first fix received
  // sig.error     last error message or null
  geo({ highAccuracy = false } = {}) {
    let _lat = null,
      _lon = null,
      _speed = null;
    let _heading = null,
      _alt = null,
      _acc = null,
      _err = null;

    const wid = navigator.geolocation.watchPosition(
      (pos) => {
        _lat = pos.coords.latitude;
        _lon = pos.coords.longitude;
        _alt = pos.coords.altitude;
        _acc = pos.coords.accuracy;
        _speed = pos.coords.speed;
        _heading = pos.coords.heading;
        _err = null;
        notify('sensor:geo', { lat: _lat, lon: _lon, accuracy: _acc });
      },
      (err) => {
        _err = err.message;
      },
      { enableHighAccuracy: highAccuracy, maximumAge: 5000, timeout: 10000 },
    );
    _cleanupFns.push(() => navigator.geolocation.clearWatch(wid));

    const sig = {
      get lat() {
        return _lat;
      },
      get lon() {
        return _lon;
      },
      get altitude() {
        return _alt;
      },
      get accuracy() {
        return _acc;
      },
      get speed() {
        return _speed;
      },
      get heading() {
        return _heading;
      },
      get error() {
        return _err;
      },
      get ready() {
        return _lat !== null;
      },

      stream(fn) {
        const loop = { id: 0 };
        const frame = () => {
          if (sig.ready) fn(sig);
          loop.id = _nativeRAF(frame);
        };
        loop.id = _nativeRAF(frame);
        _cleanupFns.push(() => _nativeCAF(loop.id));
        return sig;
      },
    };
    return sig;
  },

  // ── Network ────────────────────────────────────────────────────────────────
  // sig.online    bool
  // sig.type      'slow-2g'|'2g'|'3g'|'4g'|'wifi'|'ethernet'|'unknown'|'none'
  // sig.downlink  estimated Mbps (null if unavailable)
  // sig.rtt       estimated round-trip ms (null if unavailable)
  // sig.saveData  user's data-saver preference
  network() {
    const conn = navigator.connection ?? navigator.mozConnection ?? navigator.webkitConnection;

    const sig = {
      get online() {
        return navigator.onLine;
      },
      get type() {
        return conn?.effectiveType ?? (navigator.onLine ? 'unknown' : 'none');
      },
      get downlink() {
        return conn?.downlink ?? null;
      },
      get rtt() {
        return conn?.rtt ?? null;
      },
      get saveData() {
        return conn?.saveData ?? false;
      },

      stream(fn) {
        const loop = { id: 0 };
        const frame = () => {
          fn(sig);
          loop.id = _nativeRAF(frame);
        };
        loop.id = _nativeRAF(frame);
        _cleanupFns.push(() => _nativeCAF(loop.id));
        return sig;
      },

      // Fires whenever online/offline or connection type changes.
      onChange(fn) {
        const cb = () => fn(sig);
        _nativeWinAdd('online', cb);
        _nativeWinAdd('offline', cb);
        conn?.addEventListener('change', cb);
        _cleanupFns.push(() => {
          window.removeEventListener('online', cb);
          window.removeEventListener('offline', cb);
          conn?.removeEventListener('change', cb);
        });
        return sig;
      },
    };
    return sig;
  },

  // ── Battery ────────────────────────────────────────────────────────────────
  // Returns a Promise → signal (Chrome/Edge only; graceful fallback elsewhere).
  // sig.level      0..1
  // sig.charging   bool
  // sig.timeToFull   seconds (Infinity if not charging)
  // sig.timeToEmpty  seconds
  async battery() {
    if (!navigator.getBattery) {
      console.warn('sensors.battery(): Battery Status API not supported in this browser');
      const stub = {
        level: 1,
        charging: true,
        timeToFull: 0,
        timeToEmpty: Infinity,
        stream() {
          return stub;
        },
        onChange() {
          return stub;
        },
      };
      return stub;
    }
    const b = await navigator.getBattery();
    const sig = {
      get level() {
        return b.level;
      },
      get charging() {
        return b.charging;
      },
      get timeToFull() {
        return b.chargingTime;
      },
      get timeToEmpty() {
        return b.dischargingTime;
      },

      stream(fn) {
        const loop = { id: 0 };
        const frame = () => {
          fn(sig);
          loop.id = _nativeRAF(frame);
        };
        loop.id = _nativeRAF(frame);
        _cleanupFns.push(() => _nativeCAF(loop.id));
        return sig;
      },

      onChange(fn) {
        const cb = () => {
          notify('sensor:battery', { level: b.level, charging: b.charging });
          fn(sig);
        };
        b.addEventListener('levelchange', cb);
        b.addEventListener('chargingchange', cb);
        _cleanupFns.push(() => {
          b.removeEventListener('levelchange', cb);
          b.removeEventListener('chargingchange', cb);
        });
        return sig;
      },
    };
    return sig;
  },

  // ── Haptics (#39) ──────────────────────────────────────────────────────────

  // sensors.vibrate(pattern) — Vibration API wrapper. pattern: ms or [on,off,on,…]
  vibrate(pattern = 100) {
    navigator.vibrate?.(pattern);
    return SensorsAPI;
  },

  // sensors.haptics — shorthand object for common patterns
  haptics: {
    pulse(intensity = 1) {
      navigator.vibrate?.(Math.max(10, Math.round(intensity * 200)));
    },
    tap() {
      navigator.vibrate?.(40);
    },
    doubleTap() {
      navigator.vibrate?.([40, 60, 40]);
    },
    buzz(ms = 300) {
      navigator.vibrate?.(ms);
    },
    stop() {
      navigator.vibrate?.(0);
    },
    pattern(...durations) {
      navigator.vibrate?.(durations);
    },
  },
};

// Register teardown with the reset registry (ADR 008).
onReset(cleanupSensors);
