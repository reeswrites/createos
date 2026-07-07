import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

// Controllable Tone context state + start spy (ADR 058 lazy unlock).
const h = vi.hoisted(() => ({ state: 'suspended', start: vi.fn() }));
vi.mock('tone', () => ({
  getContext: () => ({ state: h.state }),
  start: h.start,
}));

const { ensureAudioUnlocked, _resetAudioUnlockForTest } = await import(
  '../../../../src/api/audio/audio-unlock.js'
);

describe('ensureAudioUnlocked (ADR 058)', () => {
  let addSpy, removeSpy;
  beforeEach(() => {
    h.state = 'suspended';
    h.start.mockClear();
    _resetAudioUnlockForTest();
    addSpy = vi.spyOn(document, 'addEventListener');
    removeSpy = vi.spyOn(document, 'removeEventListener');
  });
  afterEach(() => {
    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  test('suspended → resumes now and arms a one-time gesture listener', () => {
    ensureAudioUnlocked();
    expect(h.start).toHaveBeenCalledTimes(1); // in-gesture resume attempt
    const gestures = addSpy.mock.calls.map((c) => c[0]);
    expect(gestures).toEqual(expect.arrayContaining(['pointerdown', 'keydown', 'touchstart']));
  });

  test('running → no-op (no resume, no listener)', () => {
    h.state = 'running';
    ensureAudioUnlocked();
    expect(h.start).not.toHaveBeenCalled();
    expect(addSpy).not.toHaveBeenCalled();
  });

  test('idempotent — arms the gesture listeners only once', () => {
    ensureAudioUnlocked();
    const firstAdds = addSpy.mock.calls.length;
    ensureAudioUnlocked();
    ensureAudioUnlocked();
    // more resume attempts, but no additional listeners piled on
    expect(addSpy.mock.calls.length).toBe(firstAdds);
  });

  test('the armed gesture unlocks and self-removes once running', () => {
    ensureAudioUnlocked();
    const handler = addSpy.mock.calls.find((c) => c[0] === 'keydown')[1];
    h.start.mockClear();
    h.state = 'running'; // gesture will resume the context
    handler();
    expect(h.start).toHaveBeenCalledTimes(1);
    const removed = removeSpy.mock.calls.map((c) => c[0]);
    expect(removed).toEqual(expect.arrayContaining(['pointerdown', 'keydown', 'touchstart']));
  });
});
