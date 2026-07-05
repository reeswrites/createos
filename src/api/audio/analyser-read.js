// analyser-read.js — leaf module for reading an audio analyser as normalized floats.
//
// Handles both Tone.Analyser (dB values via getValue()) and Web Audio AnalyserNode
// (byte values via getByteFrequencyData()). The 'mic' sentinel string resolves
// through the Mic accessor (mic-state.js) at call time.
//
// Near-leaf: its only import is the zero-dep Mic accessor. Every module that
// needed an FFT reader previously duplicated this body; now they all import here.
import { micAnalyser } from '../media/mic-state.js';

// Normalize any audio analyser to a Float32Array[0..1] of length `bins`.
// src: 'mic' | Web Audio AnalyserNode | Tone.Analyser
export function readAnalyser(src, bins = 32) {
  const node = src === 'mic' ? micAnalyser() : src;
  if (!node) return new Float32Array(bins);
  const out = new Float32Array(bins);
  if (typeof node.getValue === 'function') {
    // Tone.Analyser — getValue() returns Float32Array of dB values (-Infinity..0)
    const raw = node.getValue();
    const step = raw.length / bins;
    for (let i = 0; i < bins; i++) {
      const db = raw[Math.floor(i * step)];
      out[i] = isFinite(db) ? Math.max(0, (db + 80) / 80) : 0;
    }
  } else if (node.frequencyBinCount) {
    // Web Audio AnalyserNode
    const data = new Uint8Array(node.frequencyBinCount);
    node.getByteFrequencyData(data);
    const step = data.length / bins;
    for (let i = 0; i < bins; i++) out[i] = data[Math.floor(i * step)] / 255;
  }
  return out;
}

// Compute {value, bass, mid, high} band averages from a normalized FFT array.
// Compatible with readAnalyser() output at any bin count.
// Bands: bass ≤ 10%, mid 10–50%, high 50–100% of bins.
export function bands(fft) {
  const n = fft.length;
  const e = Math.floor(n * 0.1);
  const m = Math.floor(n * 0.5);
  const avg = (s, end) => {
    let sum = 0;
    for (let i = s; i < end; i++) sum += fft[i];
    return sum / (end - s) || 0;
  };
  return {
    value: avg(0, n),
    bass: avg(0, e),
    mid: avg(e, m),
    high: avg(m, n),
  };
}
