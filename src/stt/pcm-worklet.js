// pcm-worklet.js — AudioWorkletProcessor that buffers mono PCM and posts fixed-size
// Float32Array chunks to the main thread. ADR 039.
//
// Loaded by AudioTap via `new URL('./pcm-worklet.js', import.meta.url)` so Vite emits
// it as a standalone module asset (it must NOT be bundled into the main graph — the
// worklet global scope has no window/import). Runs off the main thread; the
// ScriptProcessor fallback in audio-tap.js mirrors its buffering on the main thread.

class PCMProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this._chunkSize = options?.processorOptions?.chunkSize ?? 8192;
    this._buf = new Float32Array(this._chunkSize);
    this._fill = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const ch = input[0]; // mono (channelCount forced to 1 on the node)
    if (!ch) return true;

    for (let i = 0; i < ch.length; i++) {
      this._buf[this._fill++] = ch[i];
      if (this._fill === this._chunkSize) {
        // Transfer a copy so the buffer can keep filling.
        this.port.postMessage(this._buf.slice(0));
        this._fill = 0;
      }
    }
    return true; // keep processor alive
  }
}

registerProcessor('pcm-processor', PCMProcessor);
