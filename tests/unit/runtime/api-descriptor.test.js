import { describe, test, expect } from 'vitest';
import {
  _registerBuiltin, registerAPI, getDescriptor, deriveParamHints,
  _beginRun, _endRun,
} from '../../../src/runtime/api-registry.js';
import { resolveParamHint } from '../../../src/editor/param-hints.js';

// ── API Descriptor: the registry is the single source for param signatures ──────
// (CONTEXT.md "API Descriptor"). The editor's param-hints defer to deriveParamHints();
// detection/known-globals derivations are deliberately NOT wired here — they collide
// with ADR-012's central-table gate and need that ADR reopened first.

let _n = 0;
const uid = () => `__desc_api_${_n++}`;

describe('descriptor storage', () => {
  test('_registerBuiltin stores an optional descriptor', () => {
    const name = uid();
    _registerBuiltin(name, {}, { params: { go: ['speed'] } });
    expect(getDescriptor(name)).toEqual({ params: { go: ['speed'] } });
    delete window[name];
  });

  test('registerAPI stores its ext as the descriptor', () => {
    const name = uid();
    registerAPI(name, {}, { params: ['a', 'b'] });
    expect(getDescriptor(name)).toEqual({ params: ['a', 'b'] });
    delete window[name];
  });
});

describe('deriveParamHints — shapes', () => {
  test('object params → name.method entries', () => {
    const name = uid();
    _registerBuiltin(name, {}, { params: { tick: ['fn'], at: ['t', 'fn'] } });
    const hints = deriveParamHints();
    expect(hints[`${name}.tick`]).toEqual(['fn']);
    expect(hints[`${name}.at`]).toEqual(['t', 'fn']);
    delete window[name];
  });

  test('array params → bare name (callable/constructor signature)', () => {
    const name = uid();
    _registerBuiltin(name, function () {}, { params: ['frag', 'opts?'] });
    expect(deriveParamHints()[name]).toEqual(['frag', 'opts?']);
    delete window[name];
  });
});

describe('param-hints defers to the descriptor', () => {
  test('resolveParamHint resolves an entry that lives only in a descriptor', () => {
    const name = uid();
    _registerBuiltin(name, {}, { params: { draw: ['x', 'y', 'r'] } });
    expect(resolveParamHint(`${name}.draw`)).toEqual(['x', 'y', 'r']);
    delete window[name];
  });

  test('manual PARAM_HINTS still wins for un-migrated APIs', () => {
    expect(resolveParamHint('draw.rect')).toEqual(['x', 'y', 'w', 'h', 'color']);
  });
});

describe('descriptors roll back with the run', () => {
  test('a run-scoped registerAPI descriptor vanishes on _endRun', () => {
    _beginRun();
    const name = uid();
    registerAPI(name, {}, { params: ['x'] });
    expect(getDescriptor(name)).toBeDefined();
    _endRun();
    expect(getDescriptor(name)).toBeUndefined();
    delete window[name];
  });
});
