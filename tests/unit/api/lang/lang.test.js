import { describe, it, expect, beforeEach, vi } from 'vitest';
import { lang, _setLangTestHooks } from '../../../../src/api/lang/lang.js';

beforeEach(() => {
  _setLangTestHooks(); // reset custom terms / whitelist / classifier between tests
});

describe('lang — profanity (obscenity)', () => {
  it('detects a plain swear', () => {
    expect(lang.isProfane('what the fuck')).toBe(true);
    expect(lang.isProfane('have a nice day')).toBe(false);
  });

  it('detects obfuscated swears (leetspeak, symbols, repeats, case)', () => {
    expect(lang.isProfane('sh1t')).toBe(true); // leetspeak 1→i
    expect(lang.isProfane('fu*k')).toBe(true); // symbol substitution
    expect(lang.isProfane('fuuuck')).toBe(true); // duplicated chars
    expect(lang.isProfane('FUCK')).toBe(true); // case-insensitive
  });

  it('empty / nullish input is not profane', () => {
    expect(lang.isProfane('')).toBe(false);
    expect(lang.isProfane(null)).toBe(false);
    expect(lang.isProfane(undefined)).toBe(false);
  });

  it('profanity() returns matched spans', () => {
    const m = lang.profanity('fuck you');
    expect(m.length).toBeGreaterThan(0);
    expect(m[0]).toHaveProperty('start');
    expect(m[0]).toHaveProperty('end');
    expect(m[0].end).toBeGreaterThan(m[0].start);
    expect(lang.profanity('clean sentence')).toEqual([]);
  });

  it('censor() masks profanity, default and custom mask char', () => {
    const def = lang.censor('fuck you');
    expect(def).not.toContain('fuck');
    expect(def).toContain('you');

    const masked = lang.censor('fuck you', '#');
    expect(masked).toBe('#### you');

    expect(lang.censor('a clean line')).toBe('a clean line');
    expect(lang.censor(null)).toBe('');
  });

  it('block() adds custom profane terms and is chainable', () => {
    expect(lang.isProfane('you are a foobar')).toBe(false);
    expect(lang.block('foobar')).toBe(lang);
    expect(lang.isProfane('you are a foobar')).toBe(true);
    const m = lang.profanity('foobar');
    expect(m[0].term).toBe('foobar');
  });

  it('allow() whitelists a word so it is no longer flagged', () => {
    // "assassin" contains "ass"; obscenity's dataset already guards it, but confirm
    // an explicit allow() also pardons a word we force-block.
    lang.block('scunthorpe');
    expect(lang.isProfane('welcome to scunthorpe')).toBe(true);
    expect(lang.allow('scunthorpe')).toBe(lang);
    expect(lang.isProfane('welcome to scunthorpe')).toBe(false);
  });
});

describe('lang — sentiment (AFINN)', () => {
  it('scores positive text', () => {
    const r = lang.sentiment('I love this, it is amazing');
    expect(r.score).toBeGreaterThan(0);
    expect(r.label).toBe('positive');
    expect(r.positive).toContain('love');
  });

  it('scores negative text', () => {
    const r = lang.sentiment('this is terrible and I hate it');
    expect(r.score).toBeLessThan(0);
    expect(r.label).toBe('negative');
  });

  it('neutral text has no polarity', () => {
    const r = lang.sentiment('the cat sat on the mat');
    expect(r.label).toBe('neutral');
    expect(r.score).toBe(0);
  });
});

describe('lang — classify (MediaPipe, mocked)', () => {
  it('lazy-loads the classifier and maps categories', async () => {
    const classify = vi.fn(() => ({
      classifications: [{ categories: [{ categoryName: 'positive', score: 0.98 }] }],
    }));
    const createClassifier = vi.fn(async () => ({ classify }));
    _setLangTestHooks({ createClassifier });

    const out = await lang.classify('I love this');
    expect(createClassifier).toHaveBeenCalledOnce();
    expect(out).toEqual([{ category: 'positive', score: 0.98 }]);

    // second call reuses the warm classifier (no re-create)
    await lang.classify('again');
    expect(createClassifier).toHaveBeenCalledOnce();
  });

  it('configure({ model }) forces a reload with the new model', async () => {
    const createClassifier = vi.fn(async () => ({
      classify: () => ({ classifications: [{ categories: [] }] }),
    }));
    _setLangTestHooks({ createClassifier });

    await lang.classify('x');
    lang.configure({ model: 'https://example.com/other.tflite' });
    await lang.classify('y');
    expect(createClassifier).toHaveBeenCalledTimes(2);
    expect(createClassifier).toHaveBeenLastCalledWith('https://example.com/other.tflite');
  });
});
