import { trackedGroup } from '../../runtime/tracked-group.js';
import { liveOutput } from '../../runtime/keep-alive.js';
const _mediaLayers = trackedGroup({ teardown: (m) => m._destroy() });

// Manual "destroy-all" helper (tests / app.js); reset teardown is the group's own.
export function cleanupMedia() {
  _mediaLayers.teardownAll();
}

function makeOverlayCanvas(z, opacity) {
  const wrapper = document.getElementById('canvasWrapper');
  const ref = wrapper?.querySelector('canvas');
  const c = document.createElement('canvas');
  c.width = ref?.width ?? 1600;
  c.height = ref?.height ?? 900;
  Object.assign(c.style, {
    position: 'absolute',
    top: '0',
    left: '0',
    width: '100%',
    height: '100%',
    zIndex: String(z),
    opacity: String(opacity),
    pointerEvents: 'none',
  });
  wrapper?.appendChild(c);
  return c;
}

// ── ImageLayer ───────────────────────────────────────────────────────────────

class ImageLayer {
  constructor(img, { z = 25, opacity = 1.0, fit = 'cover' } = {}) {
    this._img = img;
    this._z = z;
    this._opacity = opacity;
    this._fit = fit;
    this._canvas = makeOverlayCanvas(z, opacity);
    this._draw();
    _mediaLayers.add(this);
  }

  _draw() {
    const ctx = this._canvas.getContext('2d');
    const cw = this._canvas.width;
    const ch = this._canvas.height;
    ctx.clearRect(0, 0, cw, ch);
    const iw = this._img.naturalWidth || this._img.width;
    const ih = this._img.naturalHeight || this._img.height;
    if (this._fit === 'cover') {
      const scale = Math.max(cw / iw, ch / ih);
      const dw = iw * scale;
      const dh = ih * scale;
      ctx.drawImage(this._img, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
    } else if (this._fit === 'contain') {
      const scale = Math.min(cw / iw, ch / ih);
      const dw = iw * scale;
      const dh = ih * scale;
      ctx.drawImage(this._img, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
    } else {
      ctx.drawImage(this._img, 0, 0, cw, ch);
    }
  }

  opacity(n) {
    this._opacity = n;
    this._canvas.style.opacity = String(n);
    return this;
  }

  z(n) {
    this._z = n;
    this._canvas.style.zIndex = String(n);
    return this;
  }

  fit(mode) {
    this._fit = mode;
    this._draw();
    return this;
  }

  get canvas() {
    return this._canvas;
  }

  _destroy() {
    this._canvas?.remove();
  }
}

// ── VideoLayer ───────────────────────────────────────────────────────────────

class VideoLayer {
  constructor(url, { z = 25, opacity = 1.0, loop = true, muted = true } = {}) {
    this._z = z;
    this._opacity = opacity;
    this._canvas = makeOverlayCanvas(z, opacity);
    this._ctx = this._canvas.getContext('2d');
    this._rafId = null;

    this._video = document.createElement('video');
    this._video.src = url;
    this._video.loop = loop;
    this._video.muted = muted;
    this._video.playsInline = true;
    this._video.style.display = 'none';
    document.body.appendChild(this._video);

    _mediaLayers.add(this);
  }

  _renderLoop() {
    if (this._video.readyState >= 2) {
      const cw = this._canvas.width;
      const ch = this._canvas.height;
      const vw = this._video.videoWidth;
      const vh = this._video.videoHeight;
      const scale = Math.max(cw / vw, ch / vh);
      const dw = vw * scale;
      const dh = vh * scale;
      this._ctx.clearRect(0, 0, cw, ch);
      this._ctx.drawImage(this._video, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
    }
    this._rafId = requestAnimationFrame(() => this._renderLoop());
  }

  play() {
    this._video.play().catch(() => {});
    if (!this._rafId) {
      this._live = liveOutput(this);
      this._renderLoop();
    }
    return this;
  }

  pause() {
    this._video.pause();
    return this;
  }

  stop() {
    this._video.pause();
    this._video.currentTime = 0;
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    return this;
  }

  loop(on) {
    this._video.loop = on;
    return this;
  }

  mute(on = true) {
    this._video.muted = on;
    return this;
  }

  opacity(n) {
    this._opacity = n;
    this._canvas.style.opacity = String(n);
    return this;
  }

  z(n) {
    this._z = n;
    this._canvas.style.zIndex = String(n);
    return this;
  }

  seek(seconds) {
    this._video.currentTime = seconds;
    return this;
  }

  get canvas() {
    return this._canvas;
  }
  get video() {
    return this._video;
  }

  _destroy() {
    this.stop();
    this._live?.release();
    this._canvas?.remove();
    this._video?.remove();
  }
}

// ── VideoClip ────────────────────────────────────────────────────────────────

class VideoClip {
  constructor(source, start, end) {
    this._start = start;
    this._end = end;
    this._looping = false;
    this._owned = false;

    if (typeof source === 'string') {
      this.el = document.createElement('video');
      this.el.src = source;
      this.el.playsInline = true;
      this.el.muted = true;
      this.el.style.display = 'none';
      document.body.appendChild(this.el);
      this._owned = true;
    } else {
      this.el = source;
    }
    this.el.currentTime = start;

    this._onTime = () => {
      if (this.el.currentTime >= this._end) {
        if (this._looping) {
          this.el.currentTime = this._start;
        } else {
          this.el.pause();
        }
      }
    };
    this.el.addEventListener('timeupdate', this._onTime);
    _mediaLayers.add(this);
  }

  play() {
    if (this.el.currentTime >= this._end || this.el.currentTime < this._start) {
      this.el.currentTime = this._start;
    }
    this.el.play().catch(() => {});
    return this;
  }

  pause() {
    this.el.pause();
    return this;
  }

  stop() {
    this.el.pause();
    this.el.currentTime = this._start;
    return this;
  }

  seek(offsetSecs) {
    this.el.currentTime = Math.max(this._start, Math.min(this._end, this._start + offsetSecs));
    return this;
  }

  loop(on = true) {
    this._looping = on;
    return this;
  }
  mute(on = true) {
    this.el.muted = on;
    return this;
  }

  get currentTime() {
    return Math.max(0, this.el.currentTime - this._start);
  }
  get duration() {
    return this._end - this._start;
  }

  _destroy() {
    this.el.removeEventListener('timeupdate', this._onTime);
    this.el.pause();
    if (this._owned && this.el.parentNode) this.el.remove();
  }
}

// ── Media namespace ──────────────────────────────────────────────────────────

export const Media = {
  // Load an image — returns Promise<HTMLImageElement>
  image(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
      img.src = url;
    });
  },

  // Load image and place it as a canvas layer
  async imageLayer(url, opts = {}) {
    const img = await Media.image(url);
    return new ImageLayer(img, opts);
  },

  // Create a video layer
  video(url, opts = {}) {
    return new VideoLayer(url, opts);
  },

  // Clip a video URL or element to a time range [start, end] seconds
  clip(source, start = 0, end = Infinity) {
    return new VideoClip(source, start, end);
  },
};
