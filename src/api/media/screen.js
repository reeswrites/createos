// screen.js — screen / window capture as a Drawable Source (Phase 3 #5).
//
// Dual-target (ADR 049): uses navigator.mediaDevices.getDisplayMedia, which works in the
// browser (OS picker) AND under Electron — where main's setDisplayMediaRequestHandler
// (electron/main.cjs) auto-grants the primary screen, provenance-gated. Produces an
// off-DOM <video> playing the capture stream; the visual pipeline already accepts a bare
// <video> (resolveDrawable / _isVideo), so `pipe(Source.screen)` and `canvas.backdrop(v)`
// both work with no new resolver branch beyond the Source sentinel.
//
// Streams are run artifacts — tracked in a trackedGroup so their tracks stop on reset and
// capture doesn't leak past a run. Not refcounted (screen capture is rarely shared, unlike
// Camera).

import { trackedGroup } from '../../runtime/tracked-group.js';

// Set-backed group (trackedGroup dedupes internally) — streams stop on reset.
const _active = trackedGroup({ teardown: _stopTracks });

function _stopTracks(video) {
  try {
    video.srcObject?.getTracks?.().forEach((t) => t.stop());
  } catch (_) {
    /* already gone */
  }
  video.srcObject = null;
}

// User-initiated stop ("Stop sharing") — tear down our handle AND drop from group.
function _stop(video) {
  _stopTracks(video);
  _active.remove(video);
}

/**
 * Open a screen/window capture and return a playing <video> element.
 * @param {object} [opts]  reserved for future source selection (window id, audio).
 * @returns {Promise<HTMLVideoElement>}
 */
export async function openScreenSource(opts = {}) {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error('screen capture unavailable (getDisplayMedia not supported)');
  }
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: opts.video ?? true,
    audio: opts.audio ?? false,
  });
  const video = document.createElement('video');
  video.srcObject = stream;
  video.muted = true;
  video.autoplay = true;
  video.playsInline = true;
  await video.play().catch(() => {});
  _active.add(video);
  // User-initiated stop (browser "Stop sharing") → tear down our handle too.
  stream.getVideoTracks()[0]?.addEventListener('ended', () => _stop(video));
  return video;
}
