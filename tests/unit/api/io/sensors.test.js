// sensors.test.js — tests for device-sources.js (ADR 014).
// The old sensors.* API is deleted; device sources are lazy registerSource entries.
// Tests verify: source lifecycle (start/stop on subscriber count), haptics commands.

import { describe, it, expect, vi, beforeEach } from 'vitest';

let subscribe, emit;
let registerSource;

beforeEach(async () => {
  ({ subscribe, emit } = await import('../../../../src/events/bus.js'));
  ({ registerSource } = await import('../../../../src/events/bus.js'));
});

// ── device-sources.js loads without error ─────────────────────────────────────

describe('device-sources module', () => {
  it('imports without throwing', async () => {
    await expect(import('../../../../src/api/io/device-sources.js')).resolves.not.toThrow();
  });
});

// ── Haptics commands ──────────────────────────────────────────────────────────

describe('haptics:vibrate command', () => {
  it('calls navigator.vibrate with pattern', () => {
    const vibrate = vi.fn();
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });
    emit('haptics:vibrate', { pattern: 200 });
    expect(vibrate).toHaveBeenCalledWith(200);
  });

  it('haptics:tap calls vibrate(40)', () => {
    const vibrate = vi.fn();
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });
    emit('haptics:tap', {});
    expect(vibrate).toHaveBeenCalledWith(40);
  });

  it('haptics:stop calls vibrate(0)', () => {
    const vibrate = vi.fn();
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });
    emit('haptics:stop', {});
    expect(vibrate).toHaveBeenCalledWith(0);
  });
});

// ── registerSource lifecycle (via bus) ────────────────────────────────────────

describe('registerSource lifecycle', () => {
  it('start fires on first subscriber, not before', () => {
    const start = vi.fn(() => null);
    registerSource('test:ds-src', { start });
    expect(start).not.toHaveBeenCalled();
    const u = subscribe('test:ds-src', () => {});
    expect(start).toHaveBeenCalledTimes(1);
    u();
  });

  it('stop fires when last subscriber leaves', () => {
    const stop  = vi.fn();
    registerSource('test:ds-stop', { start: () => null, stop });
    const u1 = subscribe('test:ds-stop', () => {});
    const u2 = subscribe('test:ds-stop', () => {});
    u1(); expect(stop).not.toHaveBeenCalled();
    u2(); expect(stop).toHaveBeenCalledTimes(1);
  });
});
