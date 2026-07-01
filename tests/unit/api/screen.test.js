import { describe, it, expect } from 'vitest';
import { Source, sourceKind } from '../../../src/api/visual/render-pipeline.js';
import { openScreenSource } from '../../../src/api/media/screen.js';

describe('screen capture source (#5)', () => {
  it('exposes Source.screen as a pipe sentinel', () => {
    expect(Source.screen).toBeDefined();
    expect(sourceKind(Source.screen)).toBe('screen');
  });

  it('openScreenSource rejects clearly when getDisplayMedia is unavailable (jsdom/browser gate)', async () => {
    // jsdom has no navigator.mediaDevices.getDisplayMedia — must fail loud, not hang.
    await expect(openScreenSource()).rejects.toThrow(/screen capture unavailable/);
  });
});
