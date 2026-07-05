// audio-viz.js — the reusable spectrum/analyser render core (ADR 042).
// Extracted from wm.js: binds an audio source (master / mic / a window's video /
// a mixer channel) to a canvas and runs a bars/wave/ring draw loop behind a small
// interface — { start, stop, setSource, setStyle, cleanup }. Heavy behaviour
// (FFT normalization, three render styles, source switching, mic lease) sits
// behind that surface; the wm panel builders are just DOM glue over it.
//
// The one wm-specific lookup — resolving a mixer-channel source ('ch:<winId>') —
// is injected as opts.resolveChannel so this module never reaches wm's private
// window-strip map.

import * as Tone from 'tone';
import { micAnalyser } from '../media/mic-state.js';
import { acquireMic } from '../media/media-lease.js';

// canvas: target <canvas>. getStyle: () => 'bars'|'wave'|'ring'.
// opts.getColors: () => { bg, wave, ring }. opts.autoStart: default true.
// opts.resolveChannel: (winId) => Tone channel node, for 'ch:<winId>' sources.
export function createSpectrumCore(canvas, getStyle, opts = {}) {
  const getColors = opts.getColors ?? (() => ({}));
  const resolveChannel = opts.resolveChannel ?? (() => null);
  const audioCtx = Tone.getContext().rawContext;
  const c2d = canvas.getContext('2d');
  let rafId = null;
  let toneAn = null;
  let rawAn = null;
  let _currentSrc = null;
  let _micLease = null; // window-scoped mic lease (ADR 023)

  function disconnect() {
    if (toneAn) {
      try {
        toneAn.dispose();
      } catch (_) {}
      toneAn = null;
    }
    if (rawAn && rawAn !== micAnalyser()) {
      try {
        rawAn.disconnect();
      } catch (_) {}
    }
    rawAn = null;
    // Release mic lease when switching away from 'mic' source
    if (_micLease) {
      _micLease.release();
      _micLease = null;
    }
  }

  function setSource(id) {
    _currentSrc = id;
    disconnect();
    const style = getStyle();
    if (id === 'master') {
      toneAn = new Tone.Analyser({ type: style === 'wave' ? 'waveform' : 'fft', size: 128 });
      Tone.getDestination().connect(toneAn);
    } else if (id === 'mic') {
      _micLease = acquireMic(); // window-scoped (ADR 023)
      rawAn = micAnalyser(); // may be null until mic:ready fires (self-heals in frame())
    } else if (id.startsWith('vid:')) {
      const vid = document.getElementById(id.slice(4))?.querySelector('video');
      if (vid) {
        if (!vid._ar_mediaSource) {
          vid._ar_mediaSource = audioCtx.createMediaElementSource(vid);
          // Only send straight to destination if the window strip isn't already
          // routing this element (ADR 032) — avoids doubling / silent capture.
          if (!vid._ar_routedToStrip) vid._ar_mediaSource.connect(audioCtx.destination);
        }
        const an = audioCtx.createAnalyser();
        an.fftSize = 256;
        an.smoothingTimeConstant = 0.8;
        vid._ar_mediaSource.connect(an);
        rawAn = an;
      }
    } else if (id.startsWith('ch:')) {
      const ch = resolveChannel(id.slice(3));
      if (ch) {
        toneAn = new Tone.Analyser({ type: style === 'wave' ? 'waveform' : 'fft', size: 128 });
        ch.connect(toneAn);
      }
    }
  }

  function setStyle(style) {
    if (toneAn) toneAn.type = style === 'wave' ? 'waveform' : 'fft';
  }

  function frame() {
    rafId = requestAnimationFrame(frame);
    const W = canvas.width,
      H = canvas.height;
    if (!W || !H) return;
    if (_currentSrc === 'mic' && !rawAn) rawAn = micAnalyser();

    c2d.fillStyle = getColors().bg ?? '#0d0d1a';
    c2d.fillRect(0, 0, W, H);

    let vals;
    const style = getStyle();
    if (toneAn) {
      const raw = toneAn.getValue();
      vals = Float32Array.from(raw, (v) => Math.max(0, Math.min(1, (v + 100) / 100)));
    } else if (rawAn) {
      const buf = new Uint8Array(rawAn.frequencyBinCount);
      style === 'wave' ? rawAn.getByteTimeDomainData(buf) : rawAn.getByteFrequencyData(buf);
      vals = Float32Array.from(buf, (v) => (style === 'wave' ? v / 128 - 1 : v / 255));
    } else return;

    const n = vals.length;
    const dpr = devicePixelRatio;

    if (style === 'bars') {
      const bw = W / n;
      for (let i = 0; i < n; i++) {
        const v = vals[i];
        c2d.fillStyle = `hsl(${(i / n) * 240 + 180},80%,${30 + v * 35}%)`;
        c2d.fillRect(i * bw, H - v * H, Math.max(1, bw - 1), v * H);
      }
    } else if (style === 'wave') {
      c2d.beginPath();
      c2d.strokeStyle = getColors().wave ?? '#89dceb';
      c2d.lineWidth = 2 * dpr;
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * W;
        const y = H / 2 - vals[i] * (H / 2);
        i === 0 ? c2d.moveTo(x, y) : c2d.lineTo(x, y);
      }
      c2d.stroke();
    } else {
      const cx = W / 2,
        cy = H / 2,
        r = Math.min(W, H) * 0.28;
      c2d.beginPath();
      c2d.strokeStyle = getColors().ring ?? '#cba6f7';
      c2d.lineWidth = 2 * dpr;
      for (let i = 0; i <= n; i++) {
        const a = (i / n) * Math.PI * 2 - Math.PI / 2;
        const v = vals[i % n];
        const rad = r + v * r * 0.7;
        const x = cx + Math.cos(a) * rad,
          y = cy + Math.sin(a) * rad;
        i === 0 ? c2d.moveTo(x, y) : c2d.lineTo(x, y);
      }
      c2d.closePath();
      c2d.stroke();
    }
  }

  function start() {
    if (!rafId) frame();
  }
  function stop() {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  function cleanup() {
    stop();
    disconnect(); // also releases _micLease if set
  }

  if (opts.autoStart !== false) start();
  return { canvas, start, stop, setSource, setStyle, cleanup };
}
