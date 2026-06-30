// device-sources.js — lazy device event sources + haptics commands. (ADR 014)
// Replaces sensors.js. No public API exposed on window.
// All interaction via the event bus: on('sensor:gamepad').do(fn), hold('sensor:motion'), etc.
//
// Lazy sources (start() on first subscriber, stop() on last via registerSource):
//   sensor:gamepad  { index, axes, buttons, pressed }  — RAF poll
//   sensor:motion   { ax, ay, az, alpha, beta, gamma, magnitude }  — devicemotion
//   sensor:shake    { magnitude }                       — emitted from same motion source
//   sensor:geo      { lat, lon, accuracy, speed, heading } — watchPosition
//   sensor:battery  { level, charging }                — levelchange / chargingchange
//   sensor:network  { online, type, downlink, rtt }    — online/offline/connection
//
// Haptics (commandable — emit() actuates navigator.vibrate):
//   haptics:vibrate { pattern }
//   haptics:tap     {}
//   haptics:buzz    { ms }
//   haptics:stop    {}

import { notify, registerSource, registerCommand } from '../../events/index.js';

const _nativeRAF = window.requestAnimationFrame.bind(window);
const _nativeCAF = window.cancelAnimationFrame.bind(window);
const _nativeWinAdd = window.addEventListener.bind(window);
const _nativeWinRem = window.removeEventListener.bind(window);

// ── Gamepad — RAF poll ────────────────────────────────────────────────────────

registerSource('sensor:gamepad', {
  start() {
    let rafId = null;
    const frame = () => {
      const pads = navigator.getGamepads?.() ?? [];
      for (let i = 0; i < pads.length; i++) {
        const p = pads[i];
        if (!p?.connected) continue;
        notify('sensor:gamepad', {
          index: p.index,
          axes: Array.from(p.axes),
          buttons: Array.from(p.buttons).map((b) => b.value),
          pressed: Array.from(p.buttons).map((b) => b.pressed),
        });
      }
      rafId = _nativeRAF(frame);
    };
    rafId = _nativeRAF(frame);
    return () => {
      if (rafId !== null) {
        _nativeCAF(rafId);
        rafId = null;
      }
    };
  },
});

// ── Motion + Shake — shared devicemotion/deviceorientation source ─────────────

let _ax = 0,
  _ay = 0,
  _az = 0;
let _gx = 0,
  _gy = 0,
  _gz = 0;
let _mAlpha = 0,
  _mBeta = 0,
  _mGamma = 0;

function _onDeviceMotion(e) {
  const a = e.accelerationIncludingGravity ?? e.acceleration ?? {};
  _ax = a.x ?? 0;
  _ay = a.y ?? 0;
  _az = a.z ?? 0;
  const r = e.rotationRate ?? {};
  _gx = r.alpha ?? 0;
  _gy = r.beta ?? 0;
  _gz = r.gamma ?? 0;
  const magnitude = Math.sqrt(_ax * _ax + _ay * _ay + _az * _az);
  notify('sensor:motion', {
    ax: _ax,
    ay: _ay,
    az: _az,
    gx: _gx,
    gy: _gy,
    gz: _gz,
    alpha: _mAlpha,
    beta: _mBeta,
    gamma: _mGamma,
    magnitude,
  });
  notify('sensor:shake', { magnitude });
}
function _onDeviceOrientation(e) {
  _mAlpha = e.alpha ?? 0;
  _mBeta = e.beta ?? 0;
  _mGamma = e.gamma ?? 0;
}

// Both sensor:motion and sensor:shake share one DOM source.
registerSource((e) => e === 'sensor:motion' || e === 'sensor:shake', {
  async start() {
    // iOS 13+ requires user-gesture permission
    if (typeof DeviceMotionEvent?.requestPermission === 'function') {
      try {
        await DeviceMotionEvent.requestPermission();
      } catch (_) {
        /* user denied */
      }
    }
    if (typeof DeviceOrientationEvent?.requestPermission === 'function') {
      try {
        await DeviceOrientationEvent.requestPermission();
      } catch (_) {}
    }
    _nativeWinAdd('devicemotion', _onDeviceMotion);
    _nativeWinAdd('deviceorientation', _onDeviceOrientation);
    return () => {
      _nativeWinRem('devicemotion', _onDeviceMotion);
      _nativeWinRem('deviceorientation', _onDeviceOrientation);
    };
  },
});

// ── Geolocation — watchPosition ───────────────────────────────────────────────

registerSource('sensor:geo', {
  start() {
    if (!navigator.geolocation) return;
    const wid = navigator.geolocation.watchPosition(
      (pos) =>
        notify('sensor:geo', {
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          speed: pos.coords.speed,
          heading: pos.coords.heading,
        }),
      (err) => console.warn('[sensor:geo]', err.message),
      { enableHighAccuracy: false, maximumAge: 5000, timeout: 10000 },
    );
    return () => navigator.geolocation.clearWatch(wid);
  },
});

// ── Battery — levelchange / chargingchange ────────────────────────────────────

registerSource('sensor:battery', {
  start() {
    if (!navigator.getBattery) return;
    let cleanup = null;
    navigator
      .getBattery()
      .then((b) => {
        const emit = () => notify('sensor:battery', { level: b.level, charging: b.charging });
        b.addEventListener('levelchange', emit);
        b.addEventListener('chargingchange', emit);
        cleanup = () => {
          b.removeEventListener('levelchange', emit);
          b.removeEventListener('chargingchange', emit);
        };
      })
      .catch(() => {});
    // Return teardown — battery promise may still be pending; the closure captures cleanup.
    return () => cleanup?.();
  },
});

// ── Network — online/offline/connection ───────────────────────────────────────

registerSource('sensor:network', {
  start() {
    const conn = navigator.connection ?? navigator.mozConnection ?? navigator.webkitConnection;
    const emit = () =>
      notify('sensor:network', {
        online: navigator.onLine,
        type: conn?.effectiveType ?? (navigator.onLine ? 'unknown' : 'none'),
        downlink: conn?.downlink ?? null,
        rtt: conn?.rtt ?? null,
      });
    _nativeWinAdd('online', emit);
    _nativeWinAdd('offline', emit);
    conn?.addEventListener('change', emit);
    return () => {
      _nativeWinRem('online', emit);
      _nativeWinRem('offline', emit);
      conn?.removeEventListener('change', emit);
    };
  },
});

// ── Haptics — commandable output events ───────────────────────────────────────

registerCommand('haptics:vibrate', ({ pattern = 100 }) => {
  navigator.vibrate?.(pattern);
});
registerCommand('haptics:tap', () => {
  navigator.vibrate?.(40);
});
registerCommand('haptics:buzz', ({ ms = 300 }) => {
  navigator.vibrate?.(ms);
});
registerCommand('haptics:stop', () => {
  navigator.vibrate?.(0);
});
