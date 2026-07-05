import { describe, it, expect, afterEach, vi } from 'vitest';
import { SensorsAPI as sensors } from '../../../../src/api/io/sensors.js';

afterEach(() => {
  vi.restoreAllMocks();
  delete navigator.vibrate;
});

describe('sensors.vibrate()', () => {
  it('calls navigator.vibrate with pattern', () => {
    navigator.vibrate = vi.fn();
    sensors.vibrate(200);
    expect(navigator.vibrate).toHaveBeenCalledWith(200);
  });

  it('accepts array pattern', () => {
    navigator.vibrate = vi.fn();
    sensors.vibrate([100, 50, 100]);
    expect(navigator.vibrate).toHaveBeenCalledWith([100, 50, 100]);
  });

  it('is a no-op when navigator.vibrate missing', () => {
    expect(() => sensors.vibrate(100)).not.toThrow();
  });

  it('returns sensors for chaining', () => {
    navigator.vibrate = vi.fn();
    expect(sensors.vibrate(100)).toBe(sensors);
  });
});

describe('sensors.haptics', () => {
  beforeEach(() => {
    navigator.vibrate = vi.fn();
  });

  it('tap() vibrates 40ms', () => {
    sensors.haptics.tap();
    expect(navigator.vibrate).toHaveBeenCalledWith(40);
  });

  it('doubleTap() vibrates [40,60,40]', () => {
    sensors.haptics.doubleTap();
    expect(navigator.vibrate).toHaveBeenCalledWith([40, 60, 40]);
  });

  it('buzz(ms) vibrates given ms', () => {
    sensors.haptics.buzz(500);
    expect(navigator.vibrate).toHaveBeenCalledWith(500);
  });

  it('pulse(intensity) scales 0–1 to 10–200ms', () => {
    sensors.haptics.pulse(1);
    expect(navigator.vibrate).toHaveBeenCalledWith(200);
    navigator.vibrate.mockClear();
    sensors.haptics.pulse(0);
    expect(navigator.vibrate).toHaveBeenCalledWith(10);
  });

  it('stop() vibrates 0', () => {
    sensors.haptics.stop();
    expect(navigator.vibrate).toHaveBeenCalledWith(0);
  });

  it('pattern() passes through durations', () => {
    sensors.haptics.pattern(100, 50, 100, 50, 200);
    expect(navigator.vibrate).toHaveBeenCalledWith([100, 50, 100, 50, 200]);
  });
});
