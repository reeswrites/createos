import { describe, it, expect } from 'vitest';
import { WordDiffer } from '../../src/stt/word-differ.js';
import { MODELS, modelManager } from '../../src/stt/model-manager.js';

describe('WordDiffer', () => {
  it('emits an interim event for a newly seen word', () => {
    const wd = new WordDiffer(3);
    const ev = wd.update(['hello']);
    expect(ev).toEqual([{ word: 'hello', final: false, index: 0 }]);
  });

  it('commits a word as final after STABLE_AFTER stable repeats', () => {
    const wd = new WordDiffer(3);
    wd.update(['hello']);            // interim (appears)
    wd.update(['hello']);            // count 1
    wd.update(['hello']);            // count 2
    const ev = wd.update(['hello']); // count 3 → final
    expect(ev).toEqual([{ word: 'hello', final: true, index: 0 }]);
    expect(wd.committed).toEqual(['hello']);
  });

  it('uses a global monotonic index across committed + frontier', () => {
    const wd = new WordDiffer(1);
    wd.update(['the']);              // interim the@0
    wd.update(['the']);              // final the@0 (stableAfter 1)
    const ev = wd.update(['the', 'cat']);
    // 'the' already committed at 0; 'cat' is new frontier at index 1
    expect(ev).toContainEqual({ word: 'cat', final: false, index: 1 });
  });

  it('re-emits a frontier word as interim when it changes (correction)', () => {
    const wd = new WordDiffer(3);
    wd.update(['helo']);
    const ev = wd.update(['hello']);
    expect(ev).toEqual([{ word: 'hello', final: false, index: 0 }]);
  });

  it('flush() commits all frontier words as final', () => {
    const wd = new WordDiffer(3);
    wd.update(['quick', 'brown']);
    const ev = wd.flush();
    expect(ev).toEqual([
      { word: 'quick', final: true, index: 0 },
      { word: 'brown', final: true, index: 1 },
    ]);
    expect(wd.frontier).toEqual([]);
  });

  it('transcript() joins committed + frontier', () => {
    const wd = new WordDiffer(1);
    wd.update(['a']); wd.update(['a']); // commit a
    wd.update(['a', 'b']);
    expect(wd.transcript()).toBe('a b');
  });

  it('reset() clears all state', () => {
    const wd = new WordDiffer(3);
    wd.update(['x', 'y']);
    wd.reset();
    expect(wd.committed).toEqual([]);
    expect(wd.frontier).toEqual([]);
  });
});

describe('ModelManager', () => {
  it('declares the ctc + whisper models with ASR task', () => {
    expect(Object.keys(MODELS)).toEqual(['ctc-en', 'whisper-en']);
    for (const m of Object.values(MODELS)) {
      expect(m.task).toBe('automatic-speech-recognition');
      expect(typeof m.id).toBe('string');
      expect(typeof m.sizeMb).toBe('number');
    }
  });

  it('reports uncached status when nothing is cached', async () => {
    expect(await modelManager.status('ctc-en')).toBe('uncached');
  });

  it('storageEstimate degrades gracefully without the Storage API', async () => {
    const est = await modelManager.storageEstimate();
    expect(est).toHaveProperty('used');
    expect(est).toHaveProperty('quota');
  });

  it('delete() fires a deleted event', async () => {
    const seen = await new Promise((resolve) => {
      modelManager.addEventListener('deleted', (e) => resolve(e.detail), { once: true });
      modelManager.delete('ctc-en');
    });
    expect(seen).toEqual({ modelKey: 'ctc-en' });
  });
});
