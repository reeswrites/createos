import { describe, it, expect } from 'vitest';
import { noteToMidi, midiToNote } from '../../../../src/api/audio/music-theory.js';

describe('noteToMidi', () => {
  it('parses sharps', () => {
    expect(noteToMidi('C4')).toBe(60);
    expect(noteToMidi('C#4')).toBe(61);
  });

  it('parses flats (the divergence the leaf fixes — piano.js used to return 60)', () => {
    expect(noteToMidi('Db4')).toBe(61);
    expect(noteToMidi('Bb3')).toBe(58);
  });

  it('passes numbers through', () => {
    expect(noteToMidi(64)).toBe(64);
  });

  it('falls back for garbage', () => {
    expect(noteToMidi('not-a-note')).toBe(60);
    expect(noteToMidi('zzz', 42)).toBe(42);
  });
});

describe('midiToNote', () => {
  it('inverts to a note name', () => {
    expect(midiToNote(60)).toBe('C4');
  });

  it('passes strings through', () => {
    expect(midiToNote('E4')).toBe('E4');
  });

  it('round-trips with noteToMidi', () => {
    for (const n of ['C4', 'F#5', 'A2', 'G3']) {
      expect(midiToNote(noteToMidi(n))).toBe(n);
    }
  });
});
