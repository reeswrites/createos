import { notify } from '../../events/index.js';
import { initMicLease } from './media-lease.js';
import { setMicAnalyser, setMicStream, setMicOn, setMicViz } from './mic-state.js';

export function initMic() {
  let currentStream = null;
  let audioCtx = null;
  let analyser = null;
  let rafId = null;

  // Hidden canvas kept for shader.micVizShader() / audio.micCanvas compatibility.
  const vizCanvas = document.getElementById('mic-viz');
  vizCanvas.width = 512;
  vizCanvas.height = 64;
  setMicViz(vizCanvas);
  const ctx = vizCanvas.getContext('2d');

  const NUM_BARS = 48;

  const drawBars = () => {
    rafId = requestAnimationFrame(drawBars);
    const W = vizCanvas.width;
    const H = vizCanvas.height;
    const bins = analyser.frequencyBinCount;
    const data = new Uint8Array(bins);
    analyser.getByteFrequencyData(data);
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, W, H);
    const half = NUM_BARS / 2;
    const barW = W / NUM_BARS;
    for (let i = 0; i < half; i++) {
      const t = i / (half - 1);
      const bin = Math.round(Math.pow(t, 2) * (bins - 1));
      const v = data[bin] / 255;
      const h = v * H;
      const hue = v * 60;
      ctx.fillStyle = `hsl(${hue}, 95%, ${35 + v * 30}%)`;
      ctx.fillRect((half + i) * barW, (H - h) / 2, barW - 1, h);
      ctx.fillRect((half - 1 - i) * barW, (H - h) / 2, barW - 1, h);
    }
  };

  // _startMic: called by media-lease on 0→1 (first consumer).
  const _startMic = () => {
    if (currentStream) return; // already live (re-entry guard)
    // Create AudioContext synchronously so it starts in 'running' state when
    // called from a user gesture (e.g. mic toolbar click). Creating it inside
    // .then() leaves it suspended on Chrome (async context, no user gesture).
    if (!audioCtx) {
      audioCtx = new AudioContext();
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 128;
      setMicAnalyser(analyser);
    }
    navigator.mediaDevices
      .getUserMedia({ audio: true, video: false })
      .then((stream) => {
        currentStream = stream;
        setMicStream(stream);
        audioCtx.createMediaStreamSource(currentStream).connect(analyser);
        if (audioCtx.state === 'suspended') audioCtx.resume();
        if (!rafId) drawBars();
        setMicOn(true);
        notify('mic:open', { toolbar: true });
        notify('mic:ready', { toolbar: true });
      })
      .catch((err) => {
        // Undo analyser/context setup if stream acquisition fails.
        setMicAnalyser(null);
        analyser = null;
        try {
          audioCtx.close();
        } catch (_) {}
        audioCtx = null;
        notify('mic:error', { error: err?.message ?? String(err) });
        console.warn('Mic unavailable:', err?.message ?? err);
      });
  };

  // _stopMic: called by media-lease on 1→0 (last consumer released).
  const _stopMic = () => {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    ctx.clearRect(0, 0, vizCanvas.width, vizCanvas.height);
    currentStream?.getAudioTracks().forEach((t) => t.stop());
    currentStream = null;
    setMicStream(null);
    setMicAnalyser(null);
    setMicOn(false);
    analyser = null;
    // Reset AudioContext so next acquire creates a fresh one.
    if (audioCtx) {
      try {
        audioCtx.close();
      } catch (_) {}
      audioCtx = null;
    }
    notify('mic:close', { toolbar: true });
  };

  // Permission change watcher.
  navigator.permissions
    ?.query({ name: 'microphone' })
    .then((status) => {
      status.addEventListener('change', () => {
        // If permission just granted and we have pending consumers (but no stream),
        // media-lease already holds the 0→1 trigger — nothing to do here.
      });
    })
    .catch(() => {});

  // Register with media-lease (ADR 023).
  initMicLease(_startMic, _stopMic);
}
