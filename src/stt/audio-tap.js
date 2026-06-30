// audio-tap.js — the layer between a MediaStream and an STTBackend. ADR 039.
//
// Owns a private 16 kHz AudioContext (off Tone's 48 kHz master graph; getUserMedia is
// resampled to 16 kHz for free, which is exactly what wav2vec2/whisper want). Pulls the
// stream's audio track, buffers fixed-size mono PCM chunks (AudioWorklet first, deprecated
// ScriptProcessor fallback), drives the backend, runs WordDiffer, and fires events:
//
//   CustomEvent('word',       { detail: { word, final, index } })   — interim backends
//   CustomEvent('transcript', { detail: { text, isFinal } })
//
// A crude energy VAD flushes the backend on a speech→silence transition so trailing
// words commit as final. The STT Engine (stt-engine.js) wires these events to the bus.

import { WordDiffer } from './word-differ.js';

const SAMPLE_RATE = 16000;
const CHUNK = 8192; // ~0.5 s at 16 kHz
const SILENCE_RMS = 0.008; // below this = silence
const SILENCE_CHUNKS = 3; // consecutive silent chunks → flush

export class AudioTap extends EventTarget {
  constructor(mediaStream, backend, opts = {}) {
    super();
    this._stream = mediaStream;
    this._backend = backend;
    this._chunk = opts.chunkSize ?? CHUNK;
    this._differ = new WordDiffer(opts.stableAfter ?? 3);

    this._ctx = null;
    this._srcNode = null;
    this._node = null; // AudioWorkletNode | ScriptProcessorNode
    this._scriptBuf = []; // fallback main-thread accumulation
    this._scriptFill = 0;
    this._started = false;
    this._stopped = false;
    this._silentRun = 0;
    this._hadSpeech = false;
  }

  async start() {
    if (this._started) return;
    if (!this._stream?.getAudioTracks?.().length) {
      console.warn('[AudioTap] stream has no audio track — nothing to transcribe.');
      return;
    }
    this._started = true;

    await this._backend.init();
    if (this._stopped) {
      this._backend.destroy();
      return;
    }

    this._ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
    this._srcNode = this._ctx.createMediaStreamSource(this._stream);

    const useWorklet = !!this._ctx.audioWorklet;
    if (useWorklet) {
      try {
        await this._ctx.audioWorklet.addModule(new URL('./pcm-worklet.js', import.meta.url));
        this._node = new AudioWorkletNode(this._ctx, 'pcm-processor', {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          channelCount: 1,
          processorOptions: { chunkSize: this._chunk },
        });
        this._node.port.onmessage = (e) => this._onChunk(e.data);
        this._srcNode.connect(this._node);
        this._node.connect(this._ctx.destination); // keep graph pulling (muted by ctx)
      } catch (e) {
        console.warn(
          '[AudioTap] AudioWorklet failed, falling back to ScriptProcessor:',
          e?.message ?? e,
        );
        this._startScriptProcessor();
      }
    } else {
      this._startScriptProcessor();
    }

    if (this._ctx.state === 'suspended') this._ctx.resume().catch(() => {});
  }

  _startScriptProcessor() {
    // bufferSize must be a power of two; 4096 is a safe, widely-supported value.
    this._node = this._ctx.createScriptProcessor(4096, 1, 1);
    this._scriptBuf = new Float32Array(this._chunk);
    this._scriptFill = 0;
    this._node.onaudioprocess = (e) => {
      const ch = e.inputBuffer.getChannelData(0);
      for (let i = 0; i < ch.length; i++) {
        this._scriptBuf[this._scriptFill++] = ch[i];
        if (this._scriptFill === this._chunk) {
          this._onChunk(this._scriptBuf.slice(0));
          this._scriptFill = 0;
        }
      }
    };
    this._srcNode.connect(this._node);
    this._node.connect(this._ctx.destination);
  }

  async _onChunk(chunk) {
    if (this._stopped) return;

    // VAD: energy on this chunk.
    const rms = this._rms(chunk);
    const speaking = rms >= SILENCE_RMS;
    if (speaking) {
      this._hadSpeech = true;
      this._silentRun = 0;
    } else {
      this._silentRun++;
    }

    // Speech→silence transition: flush trailing words as final.
    if (!speaking && this._hadSpeech && this._silentRun === SILENCE_CHUNKS) {
      await this._flush();
      this._hadSpeech = false;
      return;
    }

    if (!speaking) return; // don't run the model on silence

    const text = await this._backend.transcribe(chunk);
    if (this._stopped || !text) return;

    if (this._backend.interim) {
      const words = text.split(/\s+/).filter(Boolean);
      const events = this._differ.update(words);
      for (const ev of events) this._fireWord(ev);
      this._fireTranscript(this._differ.transcript(), false);
    } else {
      // Non-interim (Whisper): transcribe() returns '' until flush; nothing here.
    }
  }

  async _flush() {
    if (this._stopped) return;
    const finalText = await this._backend.flush();
    if (this._backend.interim) {
      for (const ev of this._differ.flush()) this._fireWord(ev);
      const t = this._differ.transcript();
      if (t) this._fireTranscript(t, true);
      this._differ.reset();
    } else if (finalText) {
      // Whisper: emit the whole utterance once, as words + a final transcript.
      const words = finalText.toLowerCase().split(/\s+/).filter(Boolean);
      words.forEach((word, i) => this._fireWord({ word, final: true, index: i }));
      this._fireTranscript(finalText, true);
    }
  }

  stop() {
    if (this._stopped) return;
    this._stopped = true;
    try {
      this._node?.disconnect();
    } catch {}
    try {
      this._srcNode?.disconnect();
    } catch {}
    if (this._node && this._node.port) this._node.port.onmessage = null;
    if (this._node && 'onaudioprocess' in this._node) this._node.onaudioprocess = null;
    try {
      this._backend?.destroy();
    } catch {}
    try {
      this._ctx?.close();
    } catch {}
    this._node = null;
    this._srcNode = null;
    this._ctx = null;
  }

  _fireWord(detail) {
    this.dispatchEvent(new CustomEvent('word', { detail }));
  }
  _fireTranscript(text, isFinal) {
    this.dispatchEvent(new CustomEvent('transcript', { detail: { text, isFinal } }));
  }

  _rms(buf) {
    let s = 0;
    for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
    return Math.sqrt(s / buf.length);
  }
}
