import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { decideAccess } = require('../../../electron/trust.cjs');

describe('provenance trust decision (ADR 050)', () => {
  it('authored projects always allow — no prompt', () => {
    expect(decideAccess('authored', null)).toBe('allow');
    expect(decideAccess('authored', false)).toBe('allow');
  });

  it('imported/demo ask on first native access', () => {
    expect(decideAccess('imported', null)).toBe('ask');
    expect(decideAccess('demo', null)).toBe('ask');
  });

  it('caches the answer once given', () => {
    expect(decideAccess('imported', true)).toBe('allow');
    expect(decideAccess('imported', false)).toBe('deny');
    expect(decideAccess('demo', true)).toBe('allow');
    expect(decideAccess('demo', false)).toBe('deny');
  });
});
