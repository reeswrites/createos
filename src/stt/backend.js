// backend.js — the STT backend interface. ADR 039.
//
// A backend turns mono 16 kHz PCM into a best-guess transcript STRING. It knows
// nothing about the bus, windows, or word events — AudioTap (audio-tap.js) drives
// it and WordDiffer (word-differ.js) turns its strings into word events.
//
// Two concrete backends:
//   ctc-backend.js     — wav2vec2, per-frame CTC, rolling window → live interim words
//   whisper-backend.js — whisper-tiny.en, encoder-decoder → final-only transcripts
//
// This base is intentionally a documented no-op: subclasses override what they need.

export class STTBackend {
  // True if this backend can emit meaningful partial/interim transcripts mid-utterance.
  // CTC → true; Whisper → false (it decodes the whole window at once).
  get interim() {
    return true;
  }

  // Called once before the first audio chunk. Load the model, warm up.
  async init() {}

  // Feed a Float32Array of mono PCM at 16 kHz. Return the current best-guess
  // transcript string for the rolling window (may be '').
  async transcribe(_float32Chunk) {
    return '';
  }

  // Called when VAD detects silence — flush held state, return the final transcript.
  async flush() {
    return '';
  }

  // Tear down: drop the model session, free workers. Idempotent.
  destroy() {}
}
