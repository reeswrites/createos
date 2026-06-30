// word-differ.js — turn a CTC backend's per-chunk full-transcript guesses into a
// stream of discrete word events. ADR 039.
//
// A CTC model re-transcribes the whole rolling window every chunk, so consecutive
// calls give overlapping full strings, not per-word deltas. WordDiffer tracks a
// COMMITTED prefix (words already emitted final) and a FRONTIER (still-changing
// trailing words); a frontier word becomes final once it survives STABLE_AFTER
// consecutive chunks unchanged. This produces the interim→final cadence callers see.
//
// `index` on every event is the GLOBAL running-transcript position (monotonic across
// the whole utterance), NOT a per-utterance index — the canonical payload of ADR 039.

export class WordDiffer {
  constructor(stableAfter = 3) {
    this.committed = [];
    this.frontier = [];
    this.stability = new Map();
    this.STABLE_AFTER = stableAfter;
  }

  update(newWords) {
    const events = [];
    let divergeAt = 0;
    while (
      divergeAt < this.committed.length &&
      divergeAt < newWords.length &&
      this.committed[divergeAt] === newWords[divergeAt]
    )
      divergeAt++;

    const newFrontier = newWords.slice(divergeAt);

    for (let i = 0; i < newFrontier.length; i++) {
      const word = newFrontier[i];
      const prevWord = this.frontier[i];
      if (word !== prevWord) {
        this.stability.set(divergeAt + i, 0);
        events.push({ word, final: false, index: divergeAt + i });
      } else {
        const count = (this.stability.get(divergeAt + i) ?? 0) + 1;
        this.stability.set(divergeAt + i, count);
        if (count === this.STABLE_AFTER) {
          this.committed.push(word);
          events.push({ word, final: true, index: divergeAt + i });
        }
      }
    }
    this.frontier = newFrontier;
    return events;
  }

  flush() {
    const events = this.frontier.map((word, i) => ({
      word,
      final: true,
      index: this.committed.length + i,
    }));
    this.committed.push(...this.frontier);
    this.frontier = [];
    this.stability.clear();
    return events;
  }

  reset() {
    this.committed = [];
    this.frontier = [];
    this.stability.clear();
  }

  // Full running transcript so far (committed + current frontier).
  transcript() {
    return [...this.committed, ...this.frontier].join(' ');
  }
}
