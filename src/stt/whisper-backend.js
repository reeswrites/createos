// whisper-backend.js — OPTIONAL accuracy-first backend. whisper-tiny.en. ADR 039.
//
// Whisper is an encoder-decoder: it must see the whole audio window before decoding,
// so it CANNOT emit meaningful interim words mid-utterance (interim === false). Use it
// to transcribe a completed utterance or a pre-recorded clip, not for live karaoke.
//
// transcribe() buffers audio and returns '' (no partials). flush() — called on VAD
// silence — decodes the accumulated buffer once and returns the final transcript.

import { STTBackend } from './backend.js';
import { modelManager } from './model-manager.js';

const SAMPLE_RATE = 16000;
const MAX_SECONDS = 30; // whisper-tiny context cap

export class WhisperBackend extends STTBackend {
  constructor() {
    super();
    this._pipeline = null;
    this._buf = [];
  }

  get interim() {
    return false;
  }

  async init() {
    this._pipeline = await modelManager.load('whisper-en');
  }

  // Accumulate only — no partials. Cap the buffer at the model's context window.
  async transcribe(chunk) {
    this._buf.push(chunk);
    const cap = MAX_SECONDS * SAMPLE_RATE;
    let total = this._buf.reduce((n, c) => n + c.length, 0);
    while (total > cap && this._buf.length > 1) {
      total -= this._buf.shift().length;
    }
    return '';
  }

  async flush() {
    if (!this._pipeline || this._buf.length === 0) {
      this._buf = [];
      return '';
    }
    try {
      const audio = this._concat();
      this._buf = [];
      const out = await this._pipeline(audio, { sampling_rate: SAMPLE_RATE });
      return (out?.text ?? '').trim();
    } catch (e) {
      console.warn('[WhisperBackend] flush failed:', e?.message ?? e);
      this._buf = [];
      return '';
    }
  }

  destroy() {
    this._buf = [];
    this._pipeline = null;
  }

  _concat() {
    const total = this._buf.reduce((n, c) => n + c.length, 0);
    const out = new Float32Array(total);
    let off = 0;
    for (const c of this._buf) {
      out.set(c, off);
      off += c.length;
    }
    return out;
  }
}
