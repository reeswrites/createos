// signal-shape.test.js — unit tests for src/api/signal-shape.js

import { describe, it, expect } from 'vitest';
import {
  isVideoSignal,
  isAudioSignal,
  isBandsSignal,
  isSignalObj,
} from '../../../../src/api/signal/signal-shape.js';

const videoSig = { brightness: 0.5, motion: 0.2 };
const audioSig = { value: 0.4, fft: [0.1, 0.2] };
const bandsSig = { bass: 0.3, mid: 0.5, high: 0.1, value: 0.4 };
const toneSig = { value: 440 }; // Tone.Signal / AudioParam — NOT a signal object
const canvas = { getContext: () => {} };

describe('isVideoSignal', () => {
  it('true for {brightness, motion}', () => expect(isVideoSignal(videoSig)).toBe(true));
  it('false for audio signal', () => expect(isVideoSignal(audioSig)).toBe(false));
  it('false for bands signal', () => expect(isVideoSignal(bandsSig)).toBe(false));
  it('false for null', () => expect(isVideoSignal(null)).toBe(false));
  it('false for string', () => expect(isVideoSignal('camera')).toBe(false));
});

describe('isAudioSignal', () => {
  it('true for {value, fft}', () => expect(isAudioSignal(audioSig)).toBe(true));
  it('false for video signal', () => expect(isAudioSignal(videoSig)).toBe(false));
  it('false for Tone.Signal (no fft)', () => expect(isAudioSignal(toneSig)).toBe(false));
  it('false for null', () => expect(isAudioSignal(null)).toBe(false));
});

describe('isBandsSignal', () => {
  it('true for {bass, ...}', () => expect(isBandsSignal(bandsSig)).toBe(true));
  it('also true when only .bass present', () => expect(isBandsSignal({ bass: 0 })).toBe(true));
  it('false for video signal', () => expect(isBandsSignal(videoSig)).toBe(false));
  it('false for canvas', () => expect(isBandsSignal(canvas)).toBe(false));
  it('false for null', () => expect(isBandsSignal(null)).toBe(false));
  it('false for number', () => expect(isBandsSignal(42)).toBe(false));
});

describe('isSignalObj', () => {
  it('true for video signal', () => expect(isSignalObj(videoSig)).toBe(true));
  it('true for audio signal', () => expect(isSignalObj(audioSig)).toBe(true));
  it('true for bands signal', () => expect(isSignalObj(bandsSig)).toBe(true));
  it('false for Tone.Signal', () => expect(isSignalObj(toneSig)).toBe(false));
  it('false for null', () => expect(isSignalObj(null)).toBe(false));
  it('false for plain string', () => expect(isSignalObj('midi:cc')).toBe(false));
  it('false for plain canvas', () => expect(isSignalObj(canvas)).toBe(false));
});
