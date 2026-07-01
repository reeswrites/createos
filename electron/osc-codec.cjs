// osc-codec.cjs — minimal OSC 1.0 encode/decode (no dependency).
//
// Pure functions, CommonJS so main.cjs (dgram) can require it, and also unit-testable
// under vitest (tests/runtime/osc-codec.test.js). Supports the common type tags:
//   i = int32, f = float32, s = string, b = blob (Uint8Array). Big-endian, 4-byte aligned.
// Bundles (#bundle) are not handled — flat messages only, which is what the signal bus
// needs. Unknown type tags throw rather than silently corrupt.

function _pad4(n) {
  return (4 - (n % 4)) % 4;
}

// ── decode ──────────────────────────────────────────────────────────────────────────
function _readString(buf, offset) {
  let end = offset;
  while (end < buf.length && buf[end] !== 0) end++;
  const str = buf.toString('utf8', offset, end);
  // advance past the null + padding to the next 4-byte boundary
  const len = end - offset;
  const next = offset + len + 1 + _pad4(len + 1);
  return [str, next];
}

/**
 * Decode one OSC message buffer → { address, args }.
 * `args` is an array of plain JS values (numbers/strings/Uint8Array).
 * @param {Buffer} buf
 */
function decode(buf) {
  let offset = 0;
  let address;
  [address, offset] = _readString(buf, 0);
  const args = [];
  if (offset >= buf.length || buf[offset] !== 0x2c /* ',' */) {
    return { address, args };
  }
  let typeTags;
  [typeTags, offset] = _readString(buf, offset);
  for (const tag of typeTags.slice(1)) {
    if (tag === 'i') {
      args.push(buf.readInt32BE(offset));
      offset += 4;
    } else if (tag === 'f') {
      args.push(buf.readFloatBE(offset));
      offset += 4;
    } else if (tag === 's') {
      let s;
      [s, offset] = _readString(buf, offset);
      args.push(s);
    } else if (tag === 'b') {
      const len = buf.readInt32BE(offset);
      offset += 4;
      args.push(new Uint8Array(buf.subarray(offset, offset + len)));
      offset += len + _pad4(len);
    } else {
      throw new Error(`OSC: unsupported type tag '${tag}'`);
    }
  }
  return { address, args };
}

// ── encode ──────────────────────────────────────────────────────────────────────────
function _strBuf(str) {
  const b = Buffer.from(str, 'utf8');
  const pad = 4 - (b.length % 4); // always ≥1 (the null terminator + padding)
  return Buffer.concat([b, Buffer.alloc(pad)]);
}

function _inferTag(v) {
  if (typeof v === 'string') return 's';
  if (v instanceof Uint8Array) return 'b';
  if (typeof v === 'number') return Number.isInteger(v) ? 'i' : 'f';
  throw new Error(`OSC: cannot infer type for ${typeof v}`);
}

/**
 * Encode an OSC message → Buffer. Args may be raw values (type inferred: integer→i,
 * float→f, string→s, Uint8Array→b) or { type, value } pairs to force a tag.
 * @param {string} address
 * @param {Array} args
 */
function encode(address, args = []) {
  const norm = args.map((a) =>
    a && typeof a === 'object' && 'type' in a ? a : { type: _inferTag(a), value: a }
  );
  const tags = ',' + norm.map((a) => a.type).join('');
  const parts = [_strBuf(address), _strBuf(tags)];
  for (const { type, value } of norm) {
    if (type === 'i') {
      const b = Buffer.alloc(4);
      b.writeInt32BE(value | 0, 0);
      parts.push(b);
    } else if (type === 'f') {
      const b = Buffer.alloc(4);
      b.writeFloatBE(value, 0);
      parts.push(b);
    } else if (type === 's') {
      parts.push(_strBuf(String(value)));
    } else if (type === 'b') {
      const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
      const len = Buffer.alloc(4);
      len.writeInt32BE(bytes.length, 0);
      const pad = _pad4(bytes.length);
      parts.push(len, Buffer.from(bytes), Buffer.alloc(pad));
    } else {
      throw new Error(`OSC: unsupported type tag '${type}'`);
    }
  }
  return Buffer.concat(parts);
}

module.exports = { encode, decode };
