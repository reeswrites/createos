// model-manager.js — single owner of in-browser ML model lifecycle. ADR 039.
//
// Backends (ctc/whisper) ask the manager to load a model rather than calling
// pipeline() directly, so a model downloads once and is reused. Transformers.js
// stores weights in the browser Cache API under 'transformers-cache' — we inspect
// and delete entries there directly, so status/storage need not load anything.
//
// This is a module SINGLETON (survives reset — a downloaded model is not a run
// artifact, like gaze calibration). The STT Engine tears down on reset; the model
// stays. Not a window global: the settings panel imports it directly (no iframe).

export const MODELS = {
  'ctc-en': {
    id: 'Xenova/wav2vec2-base-960h',
    task: 'automatic-speech-recognition',
    label: 'Speech-to-text (fast, interim)',
    sizeMb: 94,
  },
  'whisper-en': {
    id: 'onnx-community/whisper-tiny.en',
    task: 'automatic-speech-recognition',
    label: 'Speech-to-text (accurate, final-only)',
    sizeMb: 41,
  },
};

const CACHE_NAME = 'transformers-cache';

class ModelManager extends EventTarget {
  constructor() {
    super();
    this._pipelines = {}; // modelKey → loaded pipeline instance
    this._progress = {}; // modelKey → 0-100 (present only while downloading)
  }

  // 'uncached' | 'downloading' | 'ready'
  async status(modelKey) {
    if (this._pipelines[modelKey]) return 'ready';
    if (this._progress[modelKey] != null) return 'downloading';
    return (await this._isCached(modelKey)) ? 'ready' : 'uncached';
  }

  // Approximate bytes used / available across the origin (not model-specific).
  async storageEstimate() {
    try {
      const est = await navigator.storage.estimate();
      return { used: est.usage ?? 0, quota: est.quota ?? 0 };
    } catch {
      return { used: 0, quota: 0 };
    }
  }

  // Load from cache or download. Returns the pipeline. Fires 'progress' events.
  async load(modelKey) {
    if (this._pipelines[modelKey]) return this._pipelines[modelKey];
    const model = MODELS[modelKey];
    if (!model) throw new Error(`[ModelManager] unknown model: ${modelKey}`);

    const { pipeline } = await import('@huggingface/transformers');

    this._progress[modelKey] = 0;
    this._emit('progress', { modelKey, percent: 0, status: 'downloading' });

    let instance;
    try {
      instance = await pipeline(model.task, model.id, {
        device: await this._bestDevice(),
        progress_callback: (p) => {
          if (p?.status !== 'progress' && p?.status !== 'downloading') return;
          const percent = Math.round(p.progress ?? 0);
          this._progress[modelKey] = percent;
          this._emit('progress', { modelKey, percent, status: 'downloading', file: p.file });
        },
      });
    } catch (e) {
      delete this._progress[modelKey];
      this._emit('progress', {
        modelKey,
        percent: 0,
        status: 'error',
        error: e?.message ?? String(e),
      });
      throw e;
    }

    delete this._progress[modelKey];
    this._pipelines[modelKey] = instance;
    this._emit('progress', { modelKey, percent: 100, status: 'ready' });
    return instance;
  }

  // Delete all cached files for a model. Forces re-download on next use.
  async delete(modelKey) {
    const model = MODELS[modelKey];
    if (!model) return;
    delete this._pipelines[modelKey];
    delete this._progress[modelKey];
    try {
      const cache = await caches.open(CACHE_NAME);
      const keys = await cache.keys();
      const slug = model.id.replace('/', '--');
      const mine = keys.filter((req) => req.url.includes(slug) || req.url.includes(model.id));
      await Promise.all(mine.map((req) => cache.delete(req)));
    } catch (e) {
      console.warn('[ModelManager] delete failed:', e?.message ?? e);
    }
    this._emit('deleted', { modelKey });
  }

  async _isCached(modelKey) {
    try {
      const model = MODELS[modelKey];
      const cache = await caches.open(CACHE_NAME);
      const keys = await cache.keys();
      const slug = model.id.replace('/', '--');
      return keys.some((req) => req.url.includes(slug) || req.url.includes(model.id));
    } catch {
      return false;
    }
  }

  async _bestDevice() {
    try {
      const adapter = await navigator.gpu?.requestAdapter();
      return adapter ? 'webgpu' : 'wasm';
    } catch {
      return 'wasm';
    }
  }

  _emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}

export const modelManager = new ModelManager();
