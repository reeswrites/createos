import { describe, test, expect } from 'vitest';
import {
  _registerBuiltin,
  registerAPI,
  _beginRun,
  _endRun,
  getAPI,
  listAPIs,
  _setBlocksApplier,
  _setToolkitApplier,
} from '../../src/runtime/api-registry.js';

// ── Each test suite starts with a clean registry ─────────────────────────────
// We can't truly reset the module-level Map between tests since it's module state,
// so we register unique names per test to avoid interference.

let _counter = 0;
function uid() { return `__test_api_${_counter++}`; }

// ── _registerBuiltin ─────────────────────────────────────────────────────────

describe('_registerBuiltin', () => {
  test('sets window[name] and stores in registry', () => {
    const name = uid();
    _registerBuiltin(name, 42);
    expect(window[name]).toBe(42);
    expect(getAPI(name)).toBe(42);
    delete window[name];
  });

  test('returns undefined (void)', () => {
    const name = uid();
    expect(_registerBuiltin(name, 'x')).toBeUndefined();
    delete window[name];
  });
});

// ── registerAPI ───────────────────────────────────────────────────────────────

describe('registerAPI', () => {
  test('sets window[name] and updates registry', () => {
    const name = uid();
    registerAPI(name, 'hello');
    expect(window[name]).toBe('hello');
    expect(getAPI(name)).toBe('hello');
    delete window[name];
  });

  test('overrides an existing builtin', () => {
    const name = uid();
    _registerBuiltin(name, 'original');
    registerAPI(name, 'override');
    expect(window[name]).toBe('override');
    expect(getAPI(name)).toBe('override');
    delete window[name];
  });

  test('calls blocks applier when ext.blocks provided', () => {
    const calls = [];
    _setBlocksApplier((n, defs) => calls.push({ n, defs }));

    const name = uid();
    const blocksDef = [{ definition: { type: 'my_block' }, generator: () => '' }];
    registerAPI(name, {}, { blocks: blocksDef });

    expect(calls.length).toBeGreaterThanOrEqual(1);
    const last = calls[calls.length - 1];
    expect(last.n).toBe(name);
    expect(last.defs).toBe(blocksDef);
    delete window[name];
    _setBlocksApplier(null);
  });

  test('calls toolkit applier when ext.toolkit provided', () => {
    const calls = [];
    _setToolkitApplier((cat, entries) => calls.push({ cat, entries }));

    const name = uid();
    const snippets = [{ label: 'foo', code: 'foo()', hint: 'test' }];
    registerAPI(name, {}, { toolkit: snippets, category: 'TestCat' });

    expect(calls.length).toBeGreaterThanOrEqual(1);
    const last = calls[calls.length - 1];
    expect(last.cat).toBe('TestCat');
    expect(last.entries).toBe(snippets);
    delete window[name];
    _setToolkitApplier(null);
  });

  test('uses name as category when ext.category omitted', () => {
    const calls = [];
    _setToolkitApplier((cat) => calls.push(cat));
    const name = uid();
    registerAPI(name, {}, { toolkit: [{ label: 'x', code: 'x()', hint: '' }] });
    expect(calls[calls.length - 1]).toBe(name);
    delete window[name];
    _setToolkitApplier(null);
  });
});

// ── _beginRun / _endRun ───────────────────────────────────────────────────────

describe('run scoping', () => {
  test('registerAPI during run is rolled back on _endRun', () => {
    const name = uid();
    _beginRun();
    registerAPI(name, 'run-value');
    expect(window[name]).toBe('run-value');
    _endRun();
    expect(window[name]).toBeUndefined();
    expect(getAPI(name)).toBeUndefined();
  });

  test('builtin override during run is restored on _endRun', () => {
    const name = uid();
    _registerBuiltin(name, 'original');
    _beginRun();
    registerAPI(name, 'overridden');
    expect(window[name]).toBe('overridden');
    _endRun();
    expect(window[name]).toBe('original');
    expect(getAPI(name)).toBe('original');
    delete window[name];
  });

  test('plugin registration before run survives _endRun', () => {
    const name = uid();
    registerAPI(name, 'plugin-impl'); // registered before beginRun → persists
    _beginRun();
    _endRun();
    expect(window[name]).toBe('plugin-impl');
    expect(getAPI(name)).toBe('plugin-impl');
    delete window[name];
  });

  test('_endRun without _beginRun is a no-op', () => {
    // Ensure no baseline snapshot means endRun silently does nothing
    expect(() => _endRun()).not.toThrow();
  });

  test('nested runs: second beginRun overwrites snapshot', () => {
    const name = uid();
    _registerBuiltin(name, 'v1');
    _beginRun();
    registerAPI(name, 'v2');
    _beginRun(); // re-snapshot with v2 as baseline
    registerAPI(name, 'v3');
    _endRun();
    // v2 is the new baseline, so restored to v2
    expect(window[name]).toBe('v2');
    _endRun(); // second endRun with no baseline → no-op
    delete window[name];
  });
});

// ── listAPIs / getAPI ─────────────────────────────────────────────────────────

describe('introspection', () => {
  test('listAPIs includes registered names', () => {
    const name = uid();
    _registerBuiltin(name, true);
    expect(listAPIs()).toContain(name);
    delete window[name];
  });

  test('getAPI returns undefined for unknown name', () => {
    expect(getAPI('__nonexistent_' + uid())).toBeUndefined();
  });
});

// ── Deferred hooks ────────────────────────────────────────────────────────────

describe('deferred hooks', () => {
  test('pending blocks flushed when applier set', () => {
    // Reset applier to null first
    _setBlocksApplier(null);

    const name = uid();
    const blocksDef = [{ definition: { type: 'deferred_block' }, generator: () => '' }];
    registerAPI(name, {}, { blocks: blocksDef });

    const calls = [];
    _setBlocksApplier((n, defs) => calls.push({ n, defs }));
    // The pending entry should have been flushed
    expect(calls.some(c => c.n === name)).toBe(true);
    delete window[name];
    _setBlocksApplier(null);
  });

  test('pending toolkit flushed when applier set', () => {
    _setToolkitApplier(null);

    const name = uid();
    const snippets = [{ label: 'deferred', code: 'd()', hint: '' }];
    registerAPI(name, {}, { toolkit: snippets, category: 'DeferredCat' });

    const calls = [];
    _setToolkitApplier((cat, entries) => calls.push({ cat, entries }));
    expect(calls.some(c => c.cat === 'DeferredCat')).toBe(true);
    delete window[name];
    _setToolkitApplier(null);
  });
});
