// window.lang — language tools for user code.
//
// Three tiers, deliberately mixed sync/async:
//   • Profanity  — `obscenity` RegExpMatcher (instant, offline, obfuscation-resistant).
//   • Sentiment  — `sentiment` AFINN lexicon (instant, offline, numeric score).
//   • classify() — MediaPipe TextClassifier (lazy WASM ML, async) for advanced tasks.
//
// The sync tiers cover the "say a word → react now" case (STT, notepad, chat) with no
// download; classify() upgrades to a real model when the user opts in. Pure module — no
// bus coupling, no run artifacts, so nothing to reset (config persists like vision calib).

import {
  RegExpMatcher,
  englishDataset,
  englishRecommendedTransformers,
  TextCensor,
  DataSet,
  parseRawPattern,
} from 'obscenity';
import Sentiment from 'sentiment';

// ── Profanity (obscenity) ─────────────────────────────────────────────────────
// block() adds custom phrases into a rebuilt dataset; allow() is a post-filter over
// the recommended english dataset (the built-in Scunthorpe guard) so a user can pardon
// a word without wrestling obscenity's per-phrase whitelist API.
let _customTerms = [];
let _whitelist = [];
let _dataset = null;
let _matcher = null;
const _censor = new TextCensor();

function _rebuild() {
  const ds = new DataSet().addAll(englishDataset);
  for (const w of _customTerms) {
    ds.addPhrase((p) => p.setMetadata({ originalWord: w }).addPattern(parseRawPattern(w)));
  }
  _dataset = ds;
  _matcher = new RegExpMatcher({ ...ds.build(), ...englishRecommendedTransformers });
}
function _ensure() {
  if (!_matcher) _rebuild();
}

// [start, end) spans of every whitelisted word occurrence in text.
function _allowedSpans(text) {
  if (!_whitelist.length) return [];
  const lower = text.toLowerCase();
  const spans = [];
  for (const w of _whitelist) {
    const ww = w.toLowerCase();
    if (!ww) continue;
    let i = 0;
    while ((i = lower.indexOf(ww, i)) !== -1) {
      spans.push([i, i + ww.length]);
      i += ww.length;
    }
  }
  return spans;
}

// obscenity match.endIndex is the last matched char (inclusive) — drop matches that
// sit fully inside a whitelisted word span.
function _matches(text) {
  _ensure();
  const spans = _allowedSpans(text);
  const all = _matcher.getAllMatches(text, true);
  if (!spans.length) return all;
  return all.filter((m) => !spans.some(([s, e]) => m.startIndex >= s && m.endIndex < e));
}

// ── Sentiment (AFINN) ───────────────────────────────────────────────────────────
const _sentiment = new Sentiment();
function _label(comparative) {
  if (comparative > 0.05) return 'positive';
  if (comparative < -0.05) return 'negative';
  return 'neutral';
}

// ── Advanced ML (MediaPipe TextClassifier) ───────────────────────────────────────
// Lazy dynamic import keeps tasks-text + its WASM out of the main bundle until classify()
// is called, mirroring vision.js's MediaPipe loading (same CDN + storage.googleapis model).
const WASM_CDN = 'https://unpkg.com/@mediapipe/tasks-text@0.10.35/wasm';
const DEFAULT_MODEL =
  'https://storage.googleapis.com/mediapipe-models/text_classifier/bert_classifier/float32/1/bert_classifier.tflite';
let _model = DEFAULT_MODEL;
let _classifier = null;
let _classifierPromise = null;

// Injectable for tests (WASM can't run under jsdom).
let _createClassifier = async (modelPath) => {
  const { TextClassifier, FilesetResolver } = await import('@mediapipe/tasks-text');
  const fileset = await FilesetResolver.forTextTasks(WASM_CDN);
  return TextClassifier.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: modelPath },
  });
};

function _ensureClassifier() {
  if (_classifier) return Promise.resolve(_classifier);
  if (!_classifierPromise) {
    _classifierPromise = _createClassifier(_model)
      .then((c) => {
        _classifier = c;
        return c;
      })
      .catch((e) => {
        _classifierPromise = null;
        throw e;
      });
  }
  return _classifierPromise;
}

export const lang = {
  // ── Profanity ──
  isProfane(text) {
    if (!text) return false;
    return _matches(String(text)).length > 0;
  },
  profanity(text) {
    if (!text) return [];
    return _matches(String(text)).map((m) => ({
      term: _dataset.getPayloadWithPhraseMetadata(m).phraseMetadata?.originalWord ?? null,
      start: m.startIndex,
      end: m.endIndex + 1,
    }));
  },
  censor(text, mask) {
    if (text == null) return '';
    const t = String(text);
    const matches = _matches(t);
    if (!matches.length) return t;
    if (mask) {
      const out = t.split('');
      for (const m of matches) for (let i = m.startIndex; i <= m.endIndex; i++) out[i] = mask;
      return out.join('');
    }
    return _censor.applyTo(t, matches);
  },
  block(...words) {
    _customTerms.push(...words.flat().map((w) => String(w).toLowerCase()));
    _rebuild();
    return this;
  },
  allow(...words) {
    _whitelist.push(...words.flat().map((w) => String(w)));
    return this;
  },

  // ── Sentiment ──
  sentiment(text) {
    const r = _sentiment.analyze(String(text ?? ''));
    return {
      score: r.score,
      comparative: r.comparative,
      label: _label(r.comparative),
      positive: r.positive,
      negative: r.negative,
    };
  },

  // ── Advanced ML classification (lazy) ──
  async classify(text) {
    const clf = await _ensureClassifier();
    const res = clf.classify(String(text ?? ''));
    const cats = res?.classifications?.[0]?.categories ?? [];
    return cats.map((c) => ({ category: c.categoryName || c.displayName || '', score: c.score }));
  },
  configure(opts = {}) {
    if (opts.model && opts.model !== _model) {
      _model = opts.model;
      _classifier = null;
      _classifierPromise = null;
    }
    return this;
  },
};

// Test seam — reset internal state + swap the ML classifier factory (WASM-free).
export function _setLangTestHooks({ createClassifier } = {}) {
  _customTerms = [];
  _whitelist = [];
  _dataset = null;
  _matcher = null;
  _model = DEFAULT_MODEL;
  _classifier = null;
  _classifierPromise = null;
  if (createClassifier) _createClassifier = createClassifier;
}
