import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { emit } from '../../../../src/events/index.js';
// Side-effect import: registers the haptics:* commands (ADR 014 — replaced the
// deleted SensorsAPI.haptics with commandable bus events on device-sources.js).
import '../../../../src/api/io/device-sources.js';

afterEach(() => {
  vi.restoreAllMocks();
  delete navigator.vibrate;
});

describe('haptics:* bus commands', () => {
  beforeEach(() => {
    navigator.vibrate = vi.fn();
  });

  it('haptics:vibrate passes its pattern to navigator.vibrate', () => {
    emit('haptics:vibrate', { pattern: 200 });
    expect(navigator.vibrate).toHaveBeenCalledWith(200);
  });

  it('haptics:vibrate accepts an array pattern', () => {
    emit('haptics:vibrate', { pattern: [100, 50, 100] });
    expect(navigator.vibrate).toHaveBeenCalledWith([100, 50, 100]);
  });

  it('haptics:tap vibrates 40ms', () => {
    emit('haptics:tap');
    expect(navigator.vibrate).toHaveBeenCalledWith(40);
  });

  it('haptics:buzz vibrates the given ms', () => {
    emit('haptics:buzz', { ms: 500 });
    expect(navigator.vibrate).toHaveBeenCalledWith(500);
  });

  it('haptics:stop vibrates 0', () => {
    emit('haptics:stop');
    expect(navigator.vibrate).toHaveBeenCalledWith(0);
  });

  it('is a no-op when navigator.vibrate is missing', () => {
    delete navigator.vibrate;
    expect(() => emit('haptics:tap')).not.toThrow();
  });
});
