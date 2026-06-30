// drawable-source.js — the single resolver for a Drawable Source.
//
// A "Drawable Source" is anything the visual APIs can treat as a frame source:
// a Layer, a CameraStream, a bare <video>/<canvas>/<img>, or a GLShader/Shader
// instance. resolveDrawable() reduces it to the underlying canvas/video/image
// element. SYNC and object-forms-only by design — string forms ('camera', URLs)
// and async loading are layered on by callers (e.g. draw.backdrop). See ADR 006.
//
// This is a leaf module: no imports. render-pipeline, glsl-shader, shader, and
// draw all depend on it.

// Duck-type helpers — work in both real browsers and jsdom test mocks.
export function _isCanvas(x) {
  return !!(
    x &&
    ((typeof HTMLCanvasElement !== 'undefined' && x instanceof HTMLCanvasElement) ||
      (typeof x.getContext === 'function' && 'width' in x && 'height' in x))
  );
}
export function _isVideo(x) {
  return !!(
    x &&
    ((typeof HTMLVideoElement !== 'undefined' && x instanceof HTMLVideoElement) ||
      (typeof x.readyState === 'number' && 'videoWidth' in x))
  );
}
export function _isImage(x) {
  return !!(
    x &&
    ((typeof HTMLImageElement !== 'undefined' && x instanceof HTMLImageElement) ||
      x.nodeName === 'IMG' ||
      ('naturalWidth' in x && 'src' in x && !('readyState' in x)))
  );
}

// Resolve any object-form Drawable Source to a canvas / video / image drawable.
// Returns null for unknown input (callers that need permissiveness — e.g. shader
// video upload for ImageBitmap/VideoFrame — apply their own `?? raw` fallback).
export function resolveDrawable(input) {
  if (!input) return null;
  if (_isCanvas(input._canvas)) return input._canvas; // Layer / ShaderFX / VideoLayer / ImageLayer
  if (_isVideo(input.element)) return input.element; // CameraStream
  if (_isVideo(input)) return input; // bare <video>
  if (_isCanvas(input)) return input; // bare <canvas>
  if (_isImage(input)) return input; // bare <img>
  if (_isCanvas(input.canvas)) return input.canvas; // GLShader / Shader instance
  return null;
}
