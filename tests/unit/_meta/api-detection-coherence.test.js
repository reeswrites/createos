import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { API_PATTERNS, detectAPIUsage } from '../../../src/editor/api-detector.js';

// ── Coherence gate (ADR 012, narrowed by ADR 058) ─────────────────────────────
// Run-time API detection is a CENTRAL table (API_PATTERNS) deliberately kept out
// of each API's registration. This gate is the price of that choice: it locks the
// table to a canonical-usage sample per key — so a renamed/rotted regex can't
// silently stop matching — and asserts the flag is actually consumed by run.js.
//
// ADR 058 deleted the pre-ADR-040 visual detection (unconsumed since the auto-output
// window went away), so the table is now a single audio flag. A gate, not a
// generator (cf. ADR 008 / ADR 011).

// One representative snippet per detection key.
const SAMPLES = {
  usesAudio: 'audio.synth();',
};

// Every detection flag must be read by the run sequence in run.js.
const CONSUMED = ['usesAudio'];

const patternKeys = Object.keys(API_PATTERNS).sort();

describe('API detection coherence — sample ↔ pattern', () => {
  test('every pattern has a canonical-usage sample (and vice versa)', () => {
    expect(Object.keys(SAMPLES).sort()).toEqual(patternKeys);
  });

  test.each(patternKeys)('%s: pattern fires on its canonical usage', (key) => {
    expect(detectAPIUsage(SAMPLES[key])[key]).toBe(true);
  });

  test.each(patternKeys)('%s: no false positive on inert code', (key) => {
    expect(detectAPIUsage('const _x = 1;')[key]).toBe(false);
  });
});

describe('API detection coherence — table ↔ result shape', () => {
  test('result carries exactly the pattern keys', () => {
    const resultKeys = Object.keys(detectAPIUsage('const _x = 1;')).sort();
    expect(resultKeys).toEqual(patternKeys);
  });
});

describe('API detection coherence — consumption classification', () => {
  test('every flag is consumed', () => {
    expect(CONSUMED.sort()).toEqual(patternKeys);
  });

  test('every CONSUMED flag is actually read by the run sequence in run.js', () => {
    // The detection-consuming sequence lives in run.js (extracted from execute()).
    const src = readFileSync(resolve(process.cwd(), 'src/runtime/run.js'), 'utf8');
    for (const key of CONSUMED) {
      expect(src.includes(`hints.${key}`)).toBe(true);
    }
  });
});
