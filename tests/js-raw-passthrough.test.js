import { describe, it, expect } from 'vitest';
import { jsToBlocks } from '../src/blocks/js-to-blocks.js';

// ADR 037 — unrecognized statements survive text→blocks instead of being dropped.
// They are wrapped verbatim in a js_raw passthrough block, so text↔blocks round-trips
// losslessly. The motivating case is Strudel (ADR 035), which is text-only by design.

function chain(root) {
  const out = [];
  let b = root;
  while (b) { out.push(b); b = b.next?.block; }
  return out;
}

describe('js_raw passthrough (ADR 037)', () => {
  it('wraps an unrecognized Strudel statement verbatim', () => {
    const ws = jsToBlocks('note("c e g").fast(2).play();');
    const root = ws?.blocks?.blocks?.[0];
    expect(root?.type).toBe('js_raw');
    expect(root.fields.CODE).toContain('note("c e g").fast(2).play()');
  });

  it('preserves an unrecognized const declaration (not consumed into vars)', () => {
    const ws = jsToBlocks('const groove = s("bd hh");\ngroove.play();');
    const blocks = chain(ws.blocks.blocks[0]);
    const raws = blocks.filter((b) => b.type === 'js_raw').map((b) => b.fields.CODE);
    expect(raws.some((c) => c.includes('const groove = s("bd hh")'))).toBe(true);
    expect(raws.some((c) => c.includes('groove.play()'))).toBe(true);
  });

  it('keeps recognized blocks AND wraps unrecognized ones in the same program', () => {
    const ws = jsToBlocks("draw.bg('#000');\nnote(\"c e g\").play();");
    const blocks = chain(ws.blocks.blocks[0]);
    expect(blocks.some((b) => b.type !== 'js_raw')).toBe(true);   // draw.bg recognized
    const raw = blocks.find((b) => b.type === 'js_raw');
    expect(raw?.fields.CODE).toContain('note("c e g").play()');
  });

  it('does not double-emit a consumed declaration (const s = new Shader(); s.start())', () => {
    const ws = jsToBlocks('const sh = new Shader("return vec4f(1.0);");\nsh.start();');
    const blocks = chain(ws.blocks.blocks[0]);
    // the Shader creation is inlined into shader_start — it must NOT also appear as raw
    const raws = blocks.filter((b) => b.type === 'js_raw').map((b) => b.fields.CODE);
    expect(raws.some((c) => c.includes('new Shader'))).toBe(false);
  });
});
