// analyser-read.test.js — unit tests for src/api/analyser-read.js
//
// Both the Tone.Analyser (dB) and Web Audio AnalyserNode (byte) paths are
// exercised with mocks that mirror the real objects' duck-typed interface.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readAnalyser, bands } from '../../../../src/api/audio/analyser-read.js';

// ── readAnalyser ──────────────────────────────────────────────────────────────

describe('readAnalyser', () => {
  beforeEach(() => {
    window.__ar_mic_analyser = undefined;
  });

  it('returns zero array when src is null/undefined', () => {
    const out = readAnalyser(null, 8);
    expect(out).toHaveLength(8);
    expect(Array.from(out).every((v) => v === 0)).toBe(true);
  });

  it('Tone.Analyser path: normalises dB values', () => {
    // getValue() returns Float32Array of dB values; -80 dB → 0, 0 dB → 1
    const tone = {
      getValue: vi.fn(() => new Float32Array([-80, -40, 0, -Infinity])),
    };
    const out = readAnalyser(tone, 4);
    expect(out[0]).toBeCloseTo(0); // -80 dB → 0
    expect(out[1]).toBeCloseTo(0.5); // -40 dB → 0.5
    expect(out[2]).toBeCloseTo(1); // 0 dB  → 1
    expect(out[3]).toBe(0); // -Infinity → 0
  });

  it('Tone.Analyser: downsamples to requested bin count', () => {
    const raw = new Float32Array(16).fill(-40); // 16 bins, all -40 dB → 0.5
    const tone = { getValue: vi.fn(() => raw) };
    const out = readAnalyser(tone, 4);
    expect(out).toHaveLength(4);
    for (const v of out) expect(v).toBeCloseTo(0.5);
  });

  it('Web Audio AnalyserNode path: normalises byte values', () => {
    const node = {
      frequencyBinCount: 4,
      getByteFrequencyData: vi.fn((arr) => {
        arr[0] = 0;
        arr[1] = 128;
        arr[2] = 255;
        arr[3] = 64;
      }),
    };
    const out = readAnalyser(node, 4);
    expect(out[0]).toBeCloseTo(0);
    expect(out[1]).toBeCloseTo(128 / 255);
    expect(out[2]).toBeCloseTo(1);
    expect(out[3]).toBeCloseTo(64 / 255);
  });

  it("'mic' sentinel resolves via window.__ar_mic_analyser", () => {
    const mic = { getValue: vi.fn(() => new Float32Array([-40])) };
    window.__ar_mic_analyser = mic;
    const out = readAnalyser('mic', 1);
    expect(mic.getValue).toHaveBeenCalled();
    expect(out[0]).toBeCloseTo(0.5);
    window.__ar_mic_analyser = undefined;
  });

  it("'mic' with no analyser set returns zeros", () => {
    window.__ar_mic_analyser = undefined;
    const out = readAnalyser('mic', 4);
    expect(Array.from(out).every((v) => v === 0)).toBe(true);
  });
});

// ── bands ─────────────────────────────────────────────────────────────────────

describe('bands', () => {
  it('splits 32 bins into bass/mid/high with correct proportions', () => {
    // Flat FFT of all 1.0 → all bands = 1.0
    const fft = new Float32Array(32).fill(1);
    const b = bands(fft);
    expect(b.value).toBeCloseTo(1);
    expect(b.bass).toBeCloseTo(1);
    expect(b.mid).toBeCloseTo(1);
    expect(b.high).toBeCloseTo(1);
  });

  it('bass is first 10% of bins', () => {
    // 32 bins: bass = bins[0..2] (floor(32*0.1) = 3)
    const fft = new Float32Array(32).fill(0);
    fft[0] = 1;
    fft[1] = 1;
    fft[2] = 1; // only bass bins lit
    const b = bands(fft);
    expect(b.bass).toBeGreaterThan(0.9);
    expect(b.mid).toBeCloseTo(0);
    expect(b.high).toBeCloseTo(0);
  });

  it('high is last 50% of bins', () => {
    const fft = new Float32Array(32).fill(0);
    for (let i = 16; i < 32; i++) fft[i] = 1; // only high bins lit
    const b = bands(fft);
    expect(b.high).toBeCloseTo(1);
    expect(b.bass).toBeCloseTo(0);
    expect(b.value).toBeGreaterThan(0);
  });

  it('value is overall average', () => {
    // Half the bins at 0, half at 1 → overall 0.5
    const fft = new Float32Array(32);
    for (let i = 16; i < 32; i++) fft[i] = 1;
    const b = bands(fft);
    expect(b.value).toBeCloseTo(0.5);
  });

  it('matches shader _writeUniforms band split formula', () => {
    // Mirror the formula: e = floor(32*0.1)=3, m = floor(32*0.5)=16
    const fft = new Float32Array(32);
    for (let i = 0; i < 3; i++) fft[i] = 0.8; // bass
    for (let i = 3; i < 16; i++) fft[i] = 0.4; // mid
    for (let i = 16; i < 32; i++) fft[i] = 0.2; // high
    const b = bands(fft);
    expect(b.bass).toBeCloseTo(0.8);
    expect(b.mid).toBeCloseTo(0.4);
    expect(b.high).toBeCloseTo(0.2);
  });
});
