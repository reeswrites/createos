import { afterEach } from 'vitest';
import { detectAPIUsage, setAudioDetectPattern } from '../../../src/editor/api-detector.js';

// api-detector is audio-only (ADR 058): the pre-ADR-040 visual detection + the
// esprima shaderStart AST walk were deleted when their consumer (the auto-opened
// output window) went away.

describe('detectAPIUsage — audio presence', () => {
  test('detects audio.* usage', () => {
    expect(detectAPIUsage('audio.synth().play("C4")').usesAudio).toBe(true);
  });
  test('detects Strudel note() source', () => {
    expect(detectAPIUsage('note("c e g").play()').usesAudio).toBe(true);
  });
  test('detects new Drumpad', () => {
    expect(detectAPIUsage('const d = new Drumpad();').usesAudio).toBe(true);
  });
  test('no audio when not present', () => {
    expect(detectAPIUsage('const s = new Shader(({uv}) => [uv.x,0,0,1]);').usesAudio).toBe(false);
  });
  test('empty string → false', () => {
    expect(detectAPIUsage('').usesAudio).toBe(false);
  });
});

describe('detectAPIUsage — result shape', () => {
  test('result carries exactly the audio flag', () => {
    expect(Object.keys(detectAPIUsage('const _x = 1;'))).toEqual(['usesAudio']);
  });
});

describe('setAudioDetectPattern injection (ADR 058)', () => {
  afterEach(() => setAudioDetectPattern(null)); // revert to static fallback

  test('injected registry pattern supersedes the static fallback', () => {
    // the static fallback intentionally misses instrument constructors like Piano…
    expect(detectAPIUsage('const p = new Piano();').usesAudio).toBe(false);
    // …until boot injects the descriptor-derived pattern
    setAudioDetectPattern(/\bnew\s+Piano\b/);
    expect(detectAPIUsage('const p = new Piano();').usesAudio).toBe(true);
  });

  test('null reverts to the static fallback', () => {
    setAudioDetectPattern(/\bnevermatchme\b/);
    setAudioDetectPattern(null);
    expect(detectAPIUsage('audio.synth()').usesAudio).toBe(true);
  });
});
