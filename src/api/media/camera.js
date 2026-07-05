import { runScoped } from '../../runtime/run-scoped.js';
import { activeEditorId } from '../../runtime/run-context.js';
import { notify, registerCommand } from '../../events/index.js';
import { recordStream } from './recorder.js';
import { initCameraLease } from './media-lease.js';
// ── Multi-camera API ─────────────────────────────────────────────────────────

// Open handles (one per Camera.open() call). Each is tagged with the editor that
// opened it so a reset of editor B does not stop editor A's camera (ADR 008 reset
// scoping). Multiple handles for the same device share ONE underlying stream.
const _openCameras = [];

// Shared underlying camera sources, keyed by resolved deviceId (or `index:N` when
// no id is known). Two consumers on Source.camera get the SAME getUserMedia stream
// + <video> element via refcount — one decode, no device contention. The stream is
// stopped only when the last handle releases.
const _sharedSources = new Map(); // key → CameraSource
const _pendingSources = new Map(); // key → Promise<CameraSource> (open in flight)

class CameraSource {
  constructor(key, stream) {
    this.key = key;
    this.stream = stream;
    this.refs = 0;
    this.deviceId = stream.getVideoTracks()[0]?.getSettings?.().deviceId ?? null;
    this.element = document.createElement('video');
    this.element.autoplay = true;
    this.element.playsInline = true;
    this.element.muted = true;
    this.element.srcObject = stream;
    // Off-DOM <video> fed by a MediaStream does NOT start on autoplay alone —
    // Chrome leaves it paused (currentTime stuck at 0), so drawImage samples a
    // blank frame. Kick playback explicitly. Muted + playsInline → no gesture needed.
    this.element.play().catch(() => {});
  }
  acquire() {
    this.refs++;
  }
  release() {
    this.refs = Math.max(0, this.refs - 1);
    if (this.refs > 0) return;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.element.srcObject = null;
    _sharedSources.delete(this.key);
    if (this.deviceId) notify('camera:close', { deviceId: this.deviceId });
  }
}

// Resolve (or create) the shared source for a key. Concurrent opens for the same
// key await the same in-flight getUserMedia rather than opening a second stream.
async function _getSharedSource(key, constraints, id) {
  const existing = _sharedSources.get(key);
  if (existing) return existing;
  if (_pendingSources.has(key)) return _pendingSources.get(key);
  const p = (async () => {
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      notify('camera:error', { deviceId: id, error: err?.message ?? String(err) });
      throw err;
    }
    const src = new CameraSource(key, stream);
    _sharedSources.set(key, src);
    return src;
  })();
  _pendingSources.set(key, p);
  try {
    return await p;
  } finally {
    _pendingSources.delete(key);
  }
}

export function cleanupCameras(editorId) {
  // Manual "release matching cameras" helper (tests call it). Per-handle,
  // owner-filtered reset teardown is also handled by run-scoped.js (ADR 041) —
  // each CameraStream registers a runScoped handle (an INPUT: no keep-alive).
  // editorId == null → full release (global / hard reset). Iterate a copy:
  // _release() splices itself out of _openCameras.
  for (const c of [..._openCameras]) {
    if (editorId == null || c._ownerEditorId == null || c._ownerEditorId === editorId) c._release();
  }
}

class CameraStream {
  constructor(source, ownerEditorId) {
    this._source = source;
    this._flipped = false;
    this._released = false;
    this._ownerEditorId = ownerEditorId;
    source.acquire();
    _openCameras.push(this);
    // Owner-scoped teardown via the shared run-scoped handler (ADR 041). owner is
    // passed in (open() awaits, so it was captured before the await). A camera is
    // an INPUT — runScoped (no keep-alive), never runScopedOutput (ADR 009/023).
    this._scoped = runScoped({ owner: ownerEditorId, onStop: () => this._release() });
  }

  get element() {
    return this._source.element;
  }
  get _stream() {
    return this._source.stream;
  }
  get _deviceId() {
    return this._source.deviceId;
  }

  /** Mirror the video feed horizontally */
  flip(state = true) {
    this._flipped = state;
    this.element.style.transform = state ? 'scaleX(-1)' : '';
    notify('camera:flip', { deviceId: this._deviceId, mirrored: state });
    return this;
  }

  stop() {
    this._release();
  }

  async photo({ name = 'photo', download = false } = {}) {
    const v = this.element;
    const w = v.videoWidth || 640,
      h = v.videoHeight || 480;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    if (this._flipped) {
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(v, 0, 0, w, h);
    return new Promise((resolve) => {
      c.toBlob(
        (blob) => {
          if (blob) window.desktop?.addBlob(blob, { name: name + '.jpg', type: 'image', download });
          resolve(blob);
        },
        'image/jpeg',
        0.92,
      );
    });
  }

  record({ name = 'clip' } = {}) {
    if (!this._stream) throw new Error('Camera stopped');
    return recordStream(this._stream, {
      onStop: (blob) => window.desktop?.addBlob(blob, { name: name + '.webm', type: 'video' }),
    });
  }

  _release() {
    if (this._released) return;
    this._released = true;
    const i = _openCameras.indexOf(this);
    if (i >= 0) _openCameras.splice(i, 1);
    this._source.release(); // stops tracks only when last handle releases
    this._scoped?.dispose(); // removes from run-scoped set (onStop re-enters, guarded)
  }
}

export const Camera = {
  async open({ index = 0, deviceId = null } = {}) {
    // Capture owner now: open() awaits, and __ar_active_editor_id may change before
    // the handle is constructed. The handle must be tagged with the editor that asked.
    const ownerEditorId = activeEditorId();
    let id = deviceId;
    if (!id) {
      const all = await navigator.mediaDevices.enumerateDevices();
      const cams = all.filter((d) => d.kind === 'videoinput');
      id = cams[index]?.deviceId ?? null;
    }
    const constraints = {
      video: id
        ? { deviceId: { exact: id }, width: { ideal: 1920 }, height: { ideal: 1080 } }
        : { width: { ideal: 1920 }, height: { ideal: 1080 } },
    };
    const key = id ?? `index:${index}`;
    const source = await _getSharedSource(key, constraints, id);
    const cam = new CameraStream(source, ownerEditorId);
    // Wait for video metadata so width/height are available
    await new Promise((resolve) => {
      if (cam.element.readyState >= 1) {
        resolve();
        return;
      }
      cam.element.addEventListener('loadedmetadata', resolve, { once: true });
    });
    notify('camera:open', {
      deviceId: cam._deviceId,
      index,
      width: cam.element.videoWidth,
      height: cam.element.videoHeight,
    });
    return cam;
  },

  async list() {
    const all = await navigator.mediaDevices.enumerateDevices();
    return all
      .filter((d) => d.kind === 'videoinput')
      .map((d, i) => ({ index: i, deviceId: d.deviceId, label: d.label || `Camera ${i + 1}` }));
  },
};

// ── Main toolbar camera ──────────────────────────────────────────────────────
//
// Lazy: stream acquired only when ≥1 consumer holds a lease (ADR 023).
// No getUserMedia at page load. acquireCamera() in media-lease.js calls _startToolbarCamera.

export function initCamera() {
  const video = document.createElement('video');
  video.autoplay = true;
  video.playsInline = true;
  window.__ar_video = video;
  window.camera = video; // ergonomic alias for user code

  const cameraCanvas = document.getElementById('camera');
  const cameraCtx = cameraCanvas.getContext('2d');
  let rafId = null;
  let currentStream = null;

  const drawFrame = () => {
    rafId = requestAnimationFrame(drawFrame);
    if (video.readyState >= video.HAVE_CURRENT_DATA) {
      const w = cameraCanvas.width,
        h = cameraCanvas.height;
      cameraCtx.drawImage(video, 0, 0, w, h);
    }
  };

  const populateCameras = (devices) => {
    const videoDevices = devices.filter((d) => d.kind === 'videoinput');
    const select = document.getElementById('cameraSelect');
    const current = select.value;
    select.innerHTML = '';
    videoDevices.forEach((device, i) => {
      const opt = document.createElement('option');
      opt.value = device.deviceId;
      opt.text = device.label || `Camera ${i + 1}`;
      if (opt.value === current) opt.selected = true;
      select.appendChild(opt);
    });
    document.getElementById('cameraWrapper').style.display = videoDevices.length > 1 ? '' : 'none';
  };

  // _startToolbarCamera: called by media-lease on 0→1 (first consumer).
  // Acquires getUserMedia, starts draw loop, sets flags, emits events.
  const _startToolbarCamera = (deviceId) => {
    if (currentStream) {
      // switch device
      currentStream.getTracks().forEach((t) => t.stop());
      currentStream = null;
    }
    const constraints = {
      video: deviceId
        ? { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } }
        : { width: { ideal: 1920 }, height: { ideal: 1080 } },
    };
    navigator.mediaDevices
      .getUserMedia(constraints)
      .then((stream) => {
        currentStream = stream;
        video.srcObject = stream;
        window.__ar_camera_on = true;
        if (!rafId) drawFrame();
        notify('camera:open', { deviceId: 'toolbar', toolbar: true });
        return new Promise((resolve) => {
          if (video.readyState >= 1) {
            resolve();
            return;
          }
          video.addEventListener('loadedmetadata', resolve, { once: true });
        });
      })
      .then(() => {
        notify('camera:ready', {
          deviceId: 'toolbar',
          toolbar: true,
          width: video.videoWidth,
          height: video.videoHeight,
        });
        return navigator.mediaDevices.enumerateDevices();
      })
      .then(populateCameras)
      .catch((err) => {
        notify('camera:error', { deviceId: 'toolbar', error: err?.message ?? String(err) });
        console.warn('Camera unavailable:', err.message);
      });
  };

  // _stopToolbarCamera: called by media-lease on 1→0 (last consumer released).
  const _stopToolbarCamera = () => {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    cameraCtx.clearRect(0, 0, cameraCanvas.width, cameraCanvas.height);
    currentStream?.getTracks().forEach((t) => t.stop());
    currentStream = null;
    video.srcObject = null;
    window.__ar_camera_on = false;
    document.getElementById('cameraWrapper').style.display = 'none';
    notify('camera:close', { deviceId: 'toolbar', toolbar: true });
  };

  // Device select change handler — switch camera while live.
  document.getElementById('cameraSelect').addEventListener('change', function () {
    if (window.__ar_camera_on) _startToolbarCamera(this.value);
  });

  // Permission change watcher — re-acquire if permission is granted externally.
  navigator.permissions
    ?.query({ name: 'camera' })
    .then((status) => {
      status.addEventListener('change', () => {
        // Only re-acquire if a consumer is waiting (refcount > 0 but no stream yet).
        if (status.state === 'granted' && window.__ar_camera_on === false) {
          // If there are active leases but stream failed, try again.
          // media-lease will call _startToolbarCamera when count goes 0→1.
        }
      });
    })
    .catch(() => {});

  // Register with media-lease (ADR 023).
  initCameraLease(_startToolbarCamera, _stopToolbarCamera);
}

// Per-handle, owner-filtered reset teardown is handled by run-scoped.js (ADR
// 041) — each CameraStream registers a runScoped handle. cleanupCameras() stays
// as a manual release-all helper for tests.

// ── Event bus command handler ─────────────────────────────────────────────────
registerCommand('camera:close', ({ deviceId }) => {
  if (deviceId === 'toolbar') return; // toolbar handled by media-lease
  const cam = _openCameras.find((c) => c._deviceId === deviceId);
  if (cam) cam.stop(); // stop() → _release() → notify('camera:close', ...)
});
