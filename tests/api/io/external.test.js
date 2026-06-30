import { describe, it, expect, afterEach, vi } from 'vitest';
import { external, cleanupExternal } from '../../../src/api/io/external.js';

function mockFetch(data, ok = true) {
  global.fetch = vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 404,
    json: () => Promise.resolve(data),
  });
}

afterEach(() => {
  cleanupExternal();
  vi.restoreAllMocks();
});

describe('external.weather()', () => {
  it('fetches open-meteo and returns temperature', async () => {
    mockFetch({ current: { temperature_2m: 18.5, wind_speed_10m: 12, precipitation: 0, relative_humidity_2m: 60 } });
    const w = await external.weather(37.77, -122.41);
    expect(global.fetch).toHaveBeenCalledOnce();
    expect(w.temperature).toBe(18.5);
    expect(w.windSpeed).toBe(12);
    expect(w.precipitation).toBe(0);
    expect(w.humidity).toBe(60);
  });

  it('fetches correct URL with lat/lon', async () => {
    mockFetch({ current: {} });
    await external.weather(51.5, -0.12);
    const url = global.fetch.mock.calls[0][0];
    expect(url).toContain('latitude=51.5');
    expect(url).toContain('longitude=-0.12');
  });

  it('returns null for missing fields', async () => {
    mockFetch({ current: {} });
    const w = await external.weather(0, 0);
    expect(w.temperature).toBeNull();
    expect(w.windSpeed).toBeNull();
  });

  it('throws on non-OK response', async () => {
    mockFetch({}, false);
    await expect(external.weather(0, 0)).rejects.toThrow('Weather fetch failed: 404');
  });
});

describe('external.signal()', () => {
  it('fetches URL and applies selector', async () => {
    mockFetch({ data: { amount: '50000.00' } });
    const sig = await external.signal('https://example.com/price', json => parseFloat(json.data.amount), 0);
    expect(sig.value).toBe(50000);
  });

  it('returns raw JSON when no selector given', async () => {
    mockFetch({ hello: 'world' });
    const sig = await external.signal('https://example.com/', null, 0);
    expect(sig.value).toEqual({ hello: 'world' });
  });
});

describe('external.fetch()', () => {
  it('returns parsed JSON', async () => {
    mockFetch({ ok: true, val: 42 });
    const result = await external.fetch('https://example.com/');
    expect(result.val).toBe(42);
  });

  it('throws on non-OK status', async () => {
    mockFetch({}, false);
    await expect(external.fetch('https://example.com/')).rejects.toThrow('404');
  });
});

describe('WeatherSignal.stream()', () => {
  it('calls fn immediately with current data', async () => {
    mockFetch({ current: { temperature_2m: 22 } });
    const w = await external.weather(0, 0);
    const fn = vi.fn();
    w.stream(fn, 999999);  // very long interval — won't fire again in test
    expect(fn).toHaveBeenCalledOnce();
    expect(fn).toHaveBeenCalledWith(w);
  });
});

describe('cleanupExternal()', () => {
  it('clears all signals', () => {
    cleanupExternal();
    // No errors thrown = pass
  });
});
