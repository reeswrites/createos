import { trackedGroup } from '../../runtime/tracked-group.js';
// external.js — open data APIs as live signal sources (#38)
// external.weather(lat, lon) → WeatherSignal (temperature/windSpeed/precipitation)
// external.fetch(url, opts)  → raw JSON fetch helper (CORS permitting)
// Signal objects: { value, stream(fn, intervalMs) }

// ── WeatherSignal ─────────────────────────────────────────────────────────────

const OPEN_METEO = 'https://api.open-meteo.com/v1/forecast';

class WeatherSignal {
  constructor(lat, lon) {
    this._lat = lat;
    this._lon = lon;
    this._data = {};
    this._cleanupFns = [];
  }

  get temperature() {
    return this._data.temperature_2m ?? null;
  }
  get windSpeed() {
    return this._data.wind_speed_10m ?? null;
  }
  get precipitation() {
    return this._data.precipitation ?? null;
  }
  get humidity() {
    return this._data.relative_humidity_2m ?? null;
  }
  get raw() {
    return this._data;
  }

  async _fetch() {
    const url =
      `${OPEN_METEO}?latitude=${this._lat}&longitude=${this._lon}` +
      `&current=temperature_2m,wind_speed_10m,precipitation,relative_humidity_2m&forecast_days=1`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Weather fetch failed: ${res.status}`);
    const json = await res.json();
    this._data = json.current ?? {};
    return this;
  }

  // Push to fn immediately and every intervalMs after (use _nativeSetInterval internally)
  stream(fn, intervalMs = 60_000) {
    fn(this);
    const id = setInterval(async () => {
      try {
        await this._fetch();
        fn(this);
      } catch (_) {}
    }, intervalMs);
    this._cleanupFns.push(() => clearInterval(id));
    return this;
  }

  _destroy() {
    for (const fn of this._cleanupFns) fn();
    this._cleanupFns.length = 0;
  }
}

// ── DataSignal — generic polling JSON signal ──────────────────────────────────

class DataSignal {
  constructor(url, selector) {
    this._url = url;
    this._selector = selector; // fn(json) → value
    this._value = null;
    this._cleanupFns = [];
  }

  get value() {
    return this._value;
  }

  async _fetch() {
    const res = await fetch(this._url);
    if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
    const json = await res.json();
    this._value = this._selector ? this._selector(json) : json;
    return this;
  }

  stream(fn, intervalMs = 30_000) {
    fn(this);
    const id = setInterval(async () => {
      try {
        await this._fetch();
        fn(this);
      } catch (_) {}
    }, intervalMs);
    this._cleanupFns.push(() => clearInterval(id));
    return this;
  }

  _destroy() {
    for (const fn of this._cleanupFns) fn();
    this._cleanupFns.length = 0;
  }
}

// ── Tracking for cleanup ──────────────────────────────────────────────────────

const _signals = trackedGroup({ teardown: (s) => s._destroy() });

// Manual "destroy-all" helper (tests / app.js); reset teardown is the group's own.
export function cleanupExternal() {
  _signals.teardownAll();
}

// ── Public API ────────────────────────────────────────────────────────────────

export const external = {
  // Weather signal from open-meteo (no API key required)
  async weather(lat, lon) {
    const sig = new WeatherSignal(lat, lon);
    _signals.add(sig);
    await sig._fetch();
    return sig;
  },

  // Generic polling signal from any JSON endpoint
  // selector(json) → value; e.g. json => json.price
  async signal(url, selector, intervalMs = 30_000) {
    const sig = new DataSignal(url, selector);
    _signals.add(sig);
    await sig._fetch();
    if (intervalMs > 0) {
      sig.stream(() => {}, intervalMs);
    }
    return sig;
  },

  // Raw fetch helper — returns parsed JSON
  async fetch(url, opts = {}) {
    const res = await fetch(url, opts);
    if (!res.ok) throw new Error(`${url} → ${res.status}`);
    return res.json();
  },
};
