// signal-shape.js — canonical signal-object type predicates (leaf, no imports)
//
// Four signal shapes flow through route/shader/viz with diverging duck-types.
// One predicate per shape; isSignalObj covers all three.
//
//   video.signal()  → { brightness, motion, ... }
//   audio.signal()  → { value, fft, ... }
//   analyser bands  → { value, bass, mid, high }  (readAnalyser + bands())

export function isVideoSignal(x) {
  return x !== null && typeof x === 'object' && 'brightness' in x && 'motion' in x;
}

export function isAudioSignal(x) {
  return x !== null && typeof x === 'object' && 'value' in x && 'fft' in x;
}

export function isBandsSignal(x) {
  return x !== null && typeof x === 'object' && 'bass' in x;
}

export function isSignalObj(x) {
  return isVideoSignal(x) || isAudioSignal(x) || isBandsSignal(x);
}
