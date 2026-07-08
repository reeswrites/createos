import { describe, test, expect, vi } from 'vitest';
import esprima from 'esprima';
import {
  getInlineControl,
  registerInlineControl,
  _inlineControlKeys,
  inferOptFields,
  formatOptValue,
} from '../../../src/editor/inline-controls.js';
import {
  buildWidgetDecorations,
  InlineControlWidget,
  ObjectControlWidget,
  ScrubWidget,
} from '../../../src/editor/inline-widgets.js';

// Extract the sole ObjectExpression arg of `pipe(x).m({...})` for inferOptFields tests.
function objArg(code) {
  const ast = esprima.parseScript(code, { range: true });
  return ast.body[0].expression.arguments[0];
}

// Collect widget instances from a built RangeSet.
function widgets(code) {
  const set = buildWidgetDecorations(code);
  const out = [];
  set.between(0, code.length, (_from, _to, deco) => {
    if (deco.widget) out.push(deco.widget);
  });
  return out;
}
const count = (code, Cls) => widgets(code).filter((w) => w instanceof Cls).length;

describe('inline-controls registry (ADR 061)', () => {
  test('v1 controls registered: scale (4) + clamp/norm/gate (2)', () => {
    expect(getInlineControl('route', 'scale')?.arity).toBe(4);
    for (const m of ['clamp', 'norm', 'gate']) {
      expect(getInlineControl('route', m)?.arity).toBe(2);
    }
  });

  test('excluded methods have no control', () => {
    // single-arg → Tier 0 scrubber suffices; mix takes a route+fn, never literals
    for (const m of ['smooth', 'threshold', 'strobe', 'mix', 'to', 'show']) {
      expect(getInlineControl('route', m)).toBeNull();
    }
  });

  test('unknown head has no control', () => {
    expect(getInlineControl('foo', 'scale')).toBeNull();
  });

  test('clamp/norm/gate share one control instance', () => {
    const c = getInlineControl('route', 'clamp');
    expect(getInlineControl('route', 'norm')).toBe(c);
    expect(getInlineControl('route', 'gate')).toBe(c);
  });

  test('registerInlineControl adds a key', () => {
    registerInlineControl('pipe', '__test', { arity: 1, glyph: 'x', buildPanel: () => null });
    expect(_inlineControlKeys()).toContain('pipe.__test');
  });
});

describe('scale control panel', () => {
  test('renders four number inputs seeded with the values', () => {
    const panel = getInlineControl('route', 'scale').buildPanel([0, 1, 0, 100], () => {});
    const nums = panel.querySelectorAll('input[type="number"]');
    expect(nums.length).toBe(4);
    expect([...nums].map((n) => n.value)).toEqual(['0', '1', '0', '100']);
  });

  test('editing the input range fires onEdit with the full arg set', () => {
    const onEdit = vi.fn();
    const panel = getInlineControl('route', 'scale').buildPanel([0, 1, 0, 100], onEdit);
    const first = panel.querySelector('input[type="number"]');
    first.value = '0.2';
    first.dispatchEvent(new Event('input'));
    expect(onEdit).toHaveBeenCalledWith([0.2, 1, 0, 100]);
  });
});

describe('range control panel (clamp/norm/gate)', () => {
  test('renders two inputs and fires onEdit', () => {
    const onEdit = vi.fn();
    const panel = getInlineControl('route', 'norm').buildPanel([0, 127], onEdit);
    const nums = panel.querySelectorAll('input[type="number"]');
    expect(nums.length).toBe(2);
    nums[1].value = '255';
    nums[1].dispatchEvent(new Event('input'));
    expect(onEdit).toHaveBeenCalledWith([0, 255]);
  });
});

describe('attach + scrubber suppression (chain-head anchored)', () => {
  test('route().scale with 4 numeric literals → one control, no scrubbers', () => {
    const code = 'route(cam).scale(0, 1, 0, 100)';
    expect(count(code, InlineControlWidget)).toBe(1);
    expect(count(code, ScrubWidget)).toBe(0); // the 4 args are owned by the control
  });

  test('clamp(lo, hi) → one control', () => {
    expect(count('route(cam).clamp(0, 1)', InlineControlWidget)).toBe(1);
  });

  test('non-literal arg → all-or-nothing: no control, scrubbers on the literals', () => {
    const code = 'route(cam).scale(0, 1, 0, x)';
    expect(count(code, InlineControlWidget)).toBe(0);
    expect(count(code, ScrubWidget)).toBe(3); // 0, 1, 0 — x is a variable
  });

  test('unrelated receiver (foo.scale) → no control, plain scrubbers', () => {
    const code = 'foo.scale(0, 1, 0, 100)';
    expect(count(code, InlineControlWidget)).toBe(0);
    expect(count(code, ScrubWidget)).toBe(4);
  });

  test('single-arg method (smooth) → no control, one scrubber', () => {
    const code = 'route(cam).smooth(0.8)';
    expect(count(code, InlineControlWidget)).toBe(0);
    expect(count(code, ScrubWidget)).toBe(1);
  });

  test('control anchors even through intervening chain links', () => {
    const code = 'route(mic).amplitude.scale(0, 1, 0.2, 2)';
    expect(count(code, InlineControlWidget)).toBe(1);
    expect(count(code, ScrubWidget)).toBe(0);
  });
});

describe('inferOptFields (ADR 062 opts-object inference)', () => {
  test('number → number field', () => {
    const f = inferOptFields(objArg('pipe(c).pixelate({ blockSize: 8 })'));
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ name: 'blockSize', kind: 'number', value: 8 });
  });

  test('mixed number + colour + text + boolean', () => {
    const f = inferOptFields(objArg("pipe(c).ascii({ cols: 60, color: '#0f0', charset: 'x', fit: true })"));
    expect(f.map((x) => [x.name, x.kind])).toEqual([
      ['cols', 'number'],
      ['color', 'color'],
      ['charset', 'text'],
      ['fit', 'boolean'],
    ]);
  });

  test('non-literal property values are skipped (per-property)', () => {
    const f = inferOptFields(objArg("pipe(c).ascii({ cols: n, color: '#0f0' })"));
    expect(f.map((x) => x.name)).toEqual(['color']); // cols is a variable → dropped
  });

  test('computed properties skipped; non-object → []', () => {
    expect(inferOptFields(objArg('pipe(c).m({ [k]: 1, a: 2 })')).map((x) => x.name)).toEqual(['a']);
    const notObj = esprima.parseScript('pipe(c).scale(0,1)', { range: true }).body[0].expression
      .arguments[0];
    expect(inferOptFields(notObj)).toEqual([]);
  });
});

describe('formatOptValue', () => {
  test('number rounds to 3 decimals, no forced decimal', () => {
    expect(formatOptValue('number', 8)).toBe('8');
    expect(formatOptValue('number', 0.5)).toBe('0.5');
  });
  test('colour / text quoted', () => {
    expect(formatOptValue('color', '#ffffff')).toBe('"#ffffff"');
    expect(formatOptValue('text', 'hi')).toBe('"hi"');
  });
  test('boolean', () => {
    expect(formatOptValue('boolean', true)).toBe('true');
  });
});

describe('opts-object control attach', () => {
  test('pipe(cam).pixelate({...}) → one ObjectControlWidget', () => {
    expect(count('pipe(cam).pixelate({ blockSize: 8 })', ObjectControlWidget)).toBe(1);
  });

  test('covers a chain method with a colour opt', () => {
    expect(count("pipe(cam).ascii({ cols: 60, color: '#0f0' })", ObjectControlWidget)).toBe(1);
  });

  test('unrelated receiver (foo.m) → none', () => {
    expect(count('foo.pixelate({ blockSize: 8 })', ObjectControlWidget)).toBe(0);
  });

  test('two args (not a sole object) → none', () => {
    expect(count("pipe(cam).show('t', { w: 700 })", ObjectControlWidget)).toBe(0);
  });

  test('all-non-literal object → none (nothing to edit)', () => {
    expect(count('pipe(cam).m({ src: x, fn: y })', ObjectControlWidget)).toBe(0);
  });

  test('positional and object controls are disjoint', () => {
    expect(count('route(cam).scale(0, 1, 0, 100)', ObjectControlWidget)).toBe(0);
    expect(count('pipe(cam).pixelate({ blockSize: 8 })', InlineControlWidget)).toBe(0);
  });
});
