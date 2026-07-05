// mic-state.js — the single owner of the mic device singleton.
//
// The toolbar microphone is one shared device: one AudioContext, one AnalyserNode,
// one stream, one viz canvas. mic.js (the writer, driven by media-lease's 0→1/1→0
// refcount) owns the lifecycle; ~6 other modules only READ the live analyser/stream/
// viz to draw spectra, run STT, or feed shaders. Before this they each reached raw
// into window.__ar_mic_* — analyser-read.js even hardcoded the sentinel resolve.
//
// This fronts the four fields the way keep-alive.js fronts __ar_keepAlive and
// run-context.js fronts the lifecycle flags: getters for readers, setters for the
// sole writer, the globals kept as the private backing store so no reader has to
// know where the state lives. Leaf module — no imports.

export function micAnalyser() {
  return window.__ar_mic_analyser ?? null;
}
export function setMicAnalyser(node) {
  window.__ar_mic_analyser = node;
}

export function micStream() {
  return window.__ar_mic_stream ?? null;
}
export function setMicStream(stream) {
  window.__ar_mic_stream = stream;
}

export function micIsOn() {
  return !!window.__ar_mic_on;
}
export function setMicOn(on) {
  window.__ar_mic_on = on;
}

export function micViz() {
  return window.__ar_mic_viz ?? null;
}
export function setMicViz(canvas) {
  window.__ar_mic_viz = canvas;
}
