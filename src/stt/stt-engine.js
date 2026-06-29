// stt-engine.js — shared, reference-counted Speech-to-Text engine per audio source. ADR 039.
//
// One AudioTap + one model per distinct audio input. Many consumers (route taps, the
// onWord ML fallback) listening to the same microphone share a single inference loop and
// fan out over the bus — running wav2vec2 once per consumer would duplicate a 94 MB model
// for identical audio (mirrors CameraSource refcounting, ADR 023).
//
// Each consumer holds a Run-Scoped Output handle (keep-alive while listening, owner-scoped
// teardown on reset, ADR 008/009). Last release stops the tap, releases the mic lease, and
// closes the AudioContext. The downloaded model survives in ModelManager.
//
// The engine emits canonical bus events (ADR 039):
//   audio:word:interim  { word, final:false, index }
//   audio:word:final    { word, final:true,  index }
//   audio:transcript    { text, isFinal }

import { notify, subscribe } from '../events/index.js';
import { runScopedOutput } from '../runtime/run-scoped.js';
import { acquireMic } from '../api/media-lease.js';
import { AudioTap } from './audio-tap.js';
import { CTCBackend } from './ctc-backend.js';
import { WhisperBackend } from './whisper-backend.js';

const _engines = new Map(); // key → engine entry

function _makeBackend(name) {
  return name === 'whisper' ? new WhisperBackend() : new CTCBackend();
}

// Resolve an audio spec → { key, getStream:async()=>MediaStream, onRelease?:fn }.
// Spec kinds: 'mic' | { el } (media element) | { stream } (raw MediaStream).
function _resolveSpec(spec) {
  if (spec === 'mic' || spec?.kind === 'mic') {
    let lease = null;
    return {
      key: 'mic',
      async getStream() {
        lease = acquireMic();
        if (window.__ar_mic_stream) return window.__ar_mic_stream;
        await new Promise((res) => {
          const done = () => { unsubR?.(); unsubE?.(); clearTimeout(t); res(); };
          const unsubR = subscribe('mic:ready', done);
          const unsubE = subscribe('mic:error', done);
          const t = setTimeout(done, 4000); // fail-safe
        });
        return window.__ar_mic_stream;
      },
      onRelease() { lease?.release(); },
    };
  }
  if (spec?.el) {
    const el = spec.el;
    return {
      key: el,
      async getStream() {
        if (typeof el.captureStream === 'function') return el.captureStream();
        if (typeof el.mozCaptureStream === 'function') return el.mozCaptureStream();
        throw new Error('[stt] media element does not support captureStream()');
      },
    };
  }
  if (spec?.stream instanceof MediaStream) {
    return { key: spec.stream, async getStream() { return spec.stream; } };
  }
  throw new Error('[stt] unsupported audio spec');
}

/**
 * Acquire (or share) an STT engine for an audio source. Returns a Run-Scoped Output
 * handle; call .dispose() to release this consumer (or let reset do it). Engine and
 * model are shared by all consumers of the same source.
 *
 * @param {'mic'|{el?:Element,stream?:MediaStream,kind?:string}} spec
 * @param {object} [opts]
 * @param {'ctc'|'whisper'} [opts.backend='ctc']
 * @param {number} [opts.owner]  owning editor id (defaults to active editor)
 * @returns {{dispose:()=>void, disposed:boolean}}
 */
export function acquireStt(spec, opts = {}) {
  const resolved = _resolveSpec(spec);
  const key = resolved.key;

  let ent = _engines.get(key);
  if (!ent) {
    ent = { count: 0, tap: null, resolved, starting: null, stopped: false };
    ent.start = async () => {
      const stream = await resolved.getStream();
      if (ent.stopped) return;
      if (!stream) { console.warn('[stt] no stream for source — engine idle.'); return; }
      const backend = _makeBackend(opts.backend);
      const tap = new AudioTap(stream, backend);
      tap.addEventListener('word', (e) => {
        const d = e.detail;
        notify(d.final ? 'audio:word:final' : 'audio:word:interim', d);
      });
      tap.addEventListener('transcript', (e) => notify('audio:transcript', e.detail));
      ent.tap = tap;
      await tap.start();
    };
    ent.stop = () => {
      if (ent.stopped) return;
      ent.stopped = true;
      try { ent.tap?.stop(); } catch {}
      ent.tap = null;
      try { resolved.onRelease?.(); } catch {}
      _engines.delete(key);
    };
    _engines.set(key, ent);
    ent.starting = ent.start().catch((e) => console.warn('[stt] engine start failed:', e?.message ?? e));
  }

  ent.count++;

  const handle = runScopedOutput({
    owner: opts.owner,
    onStop: () => {
      ent.count = Math.max(0, ent.count - 1);
      if (ent.count === 0) ent.stop();
    },
  });
  return handle;
}

// Diagnostics / tests.
export function _sttEngineCount() { return _engines.size; }
