import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

// osc-codec is CJS (shared with electron/main.cjs) — require it from this ESM test.
const require = createRequire(import.meta.url);
const { encode, decode } = require('../../../electron/osc-codec.cjs');

describe('OSC codec round-trip', () => {
  it('encodes/decodes an address with no args', () => {
    const { address, args } = decode(encode('/panic'));
    expect(address).toBe('/panic');
    expect(args).toEqual([]);
  });

  it('round-trips int + float + string args (type inference)', () => {
    const buf = encode('/synth/cutoff', [42, 0.5, 'saw']);
    const { address, args } = decode(buf);
    expect(address).toBe('/synth/cutoff');
    expect(args[0]).toBe(42);
    expect(args[1]).toBeCloseTo(0.5, 5);
    expect(args[2]).toBe('saw');
  });

  it('forces a float tag on an integer value when asked', () => {
    const buf = encode('/x', [{ type: 'f', value: 3 }]);
    const { args } = decode(buf);
    expect(args[0]).toBeCloseTo(3, 5);
  });

  it('keeps 4-byte alignment for odd-length strings', () => {
    // 'abc' (3 bytes) + null → 4; 'abcd' (4) + null → 8. Both must decode cleanly.
    expect(decode(encode('/a', ['abc'])).args[0]).toBe('abc');
    expect(decode(encode('/a', ['abcd'])).args[0]).toBe('abcd');
  });

  it('round-trips a blob', () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const { args } = decode(encode('/b', [{ type: 'b', value: bytes }]));
    expect(Array.from(args[0])).toEqual([1, 2, 3, 4, 5]);
  });

  it('throws on an unsupported type tag', () => {
    expect(() => encode('/x', [{ type: 'z', value: 1 }])).toThrow(/unsupported/);
  });
});
