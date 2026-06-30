// ctc-backend.js — PRIMARY backend. wav2vec2 (CTC) via @huggingface/transformers. ADR 039.
//
// CTC emits per-frame character probabilities, so re-transcribing a rolling window
// each chunk is natural and cheap-ish — that is what gives us live interim words.
// transcribe(chunk) keeps the last N chunks (~2 s at 16 kHz), concatenates them, and
// runs the model over the whole window, returning the raw transcript string. The
// WordDiffer (upstream, in AudioTap) turns consecutive strings into word events.

import { STTBackend } from './backend.js';
import { modelManager } from './model-manager.js';

const SAMPLE_RATE = 16000;

export class CTCBackend extends STTBackend {
  /**
   * @param {object} [opts]
   * @param {number} [opts.windowChunks=4]  rolling window length in chunks
   */
  constructor(opts = {}) {
    super();
    this._pipeline = null;
    this._windowChunks = opts.windowChunks ?? 4;
    this._buf = []; // Float32Array chunks, most recent last
    this._busy = false; // single-flight: drop chunks while the model runs
  }

  get interim() {
    return true;
  }

  async init() {
    this._pipeline = await modelManager.load('ctc-en');
  }

  async transcribe(chunk) {
    if (!this._pipeline) return '';
    this._buf.push(chunk);
    if (this._buf.length > this._windowChunks) this._buf.shift();

    // Single-flight: ONNX inference is not reentrant; skip if a run is in flight.
    if (this._busy) return '';
    this._busy = true;
    try {
      const audio = this._concat();
      const out = await this._pipeline(audio, { sampling_rate: SAMPLE_RATE });
      return (out?.text ?? '').trim().toLowerCase();
    } catch (e) {
      console.warn('[CTCBackend] transcribe failed:', e?.message ?? e);
      return '';
    } finally {
      this._busy = false;
    }
  }

  async flush() {
    if (!this._pipeline || this._buf.length === 0) {
      this._buf = [];
      return '';
    }
    try {
      const audio = this._concat();
      const out = await this._pipeline(audio, { sampling_rate: SAMPLE_RATE });
      this._buf = [];
      return (out?.text ?? '').trim().toLowerCase();
    } catch {
      this._buf = [];
      return '';
    }
  }

  destroy() {
    this._buf = [];
    this._pipeline = null; // pipeline instance is owned/cached by ModelManager
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
