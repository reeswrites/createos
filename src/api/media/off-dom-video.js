// off-dom-video.js — the off-DOM <video> playback incantation, in one place.
//
// An off-DOM <video> fed by a MediaStream does NOT start on `autoplay` alone —
// Chrome leaves it paused (currentTime stuck at 0), so drawImage samples a blank
// frame. muted + playsInline means no user gesture is required, and an explicit
// .play() kick is what actually starts decoding. Camera shared streams and screen
// capture both re-learned this; this is the shared 5-liner.

/**
 * Create an off-DOM <video> playing a MediaStream, muted so no gesture is needed.
 * @param {MediaStream} stream
 * @returns {HTMLVideoElement} the (not-in-DOM) video, playback kicked.
 */
export function playOffDom(stream) {
  const video = document.createElement('video');
  video.muted = true;
  video.autoplay = true;
  video.playsInline = true;
  video.srcObject = stream;
  video.play().catch(() => {});
  return video;
}
