import { jsToWGSL } from '../../../src/api/shader/js-to-wgsl.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const compile = (fn) => jsToWGSL(fn);

// ── Basic compilation ─────────────────────────────────────────────────────────

describe('jsToWGSL — basic output', () => {
  test('compiles to { body, helpers, usesCol }', () => {
    const out = compile(({ uv }) => [uv.x, uv.y, 0.0, 1.0]);
    expect(out).toHaveProperty('body');
    expect(out).toHaveProperty('helpers');
    expect(out).toHaveProperty('usesCol');
    expect(typeof out.body).toBe('string');
    expect(Array.isArray(out.helpers)).toBe(true);
  });

  test('array return becomes vec4f', () => {
    const { body } = compile(() => [1.0, 0.0, 0.0, 1.0]);
    expect(body).toContain('return vec4f(');
  });

  test('3-element array return becomes vec3f', () => {
    const { body } = compile(() => [1.0, 0.0, 0.0]);
    expect(body).toContain('return vec3f(');
  });

  test('concise arrow body (no braces)', () => {
    const { body } = compile(({ uv }) => [uv.x, uv.y, 0.0, 1.0]);
    expect(body).toContain('return vec4f(');
    expect(body).toContain('uv.x');
  });

  test('accepts a string instead of a function', () => {
    const { body } = jsToWGSL('({uv}) => [uv.x, uv.y, 0.0, 1.0]');
    expect(body).toContain('uv.x');
  });

  test('throws on unparseable source', () => {
    expect(() => jsToWGSL('this is not valid JS }{{')).toThrow(/jsToWGSL/);
  });
});

// ── bind: param-alias seam (used by viz.shader) ───────────────────────────────

describe('jsToWGSL — bind (param aliases)', () => {
  test('emits a let for each bound alias, before the user body', () => {
    const { body } = jsToWGSL((v) => [v, v, v, 1.0], { bind: { v: 'col.r' } });
    expect(body).toContain('let v = col.r;');
    expect(body.indexOf('let v = col.r;')).toBeLessThan(body.indexOf('return vec4f('));
  });

  test('bound alias is typed as a scalar (f32), so int literals coerce around it', () => {
    const { body } = jsToWGSL((v) => [v * 2, 0, 0, 1], { bind: { v: 'col.r' } });
    expect(body).toContain('v * 2.0'); // f32 alias forces the int literal to float
  });

  test('multiple binds emit in order', () => {
    const { body } = jsToWGSL((v, t) => [v, t, 0.0, 1.0], { bind: { v: 'col.r', t: 'time' } });
    expect(body).toContain('let v = col.r;');
    expect(body).toContain('let t = time;');
  });

  test('a bind expr referencing col sets usesCol even when the fn never names col', () => {
    const { usesCol } = jsToWGSL((v) => [v, 0.0, 0.0, 1.0], { bind: { v: 'col.r' } });
    expect(usesCol).toBe(true);
  });

  test('no bind option leaves the body unchanged (no stray lets)', () => {
    const { body } = jsToWGSL((v) => [v, 0.0, 0.0, 1.0]);
    expect(body).not.toContain('let v =');
  });
});

// ── Math.* → WGSL builtins ────────────────────────────────────────────────────

describe('jsToWGSL — Math.* mapping', () => {
  test('Math.sin → sin', () => {
    const { body } = compile(({ time }) => [Math.sin(time), 0.5, 0.5, 1.0]);
    expect(body).toContain('sin(time)');
    expect(body).not.toContain('Math.sin');
  });

  test('Math.cos → cos', () => {
    const { body } = compile(({ time }) => [Math.cos(time), 0.5, 0.5, 1.0]);
    expect(body).toContain('cos(time)');
  });

  test('Math.abs → abs', () => {
    const { body } = compile(({ uv }) => [Math.abs(uv.x - 0.5), 0.0, 0.0, 1.0]);
    expect(body).toContain('abs(');
  });

  test('Math.sqrt → sqrt', () => {
    const { body } = compile(({ uv }) => [Math.sqrt(uv.x), 0.0, 0.0, 1.0]);
    expect(body).toContain('sqrt(');
  });

  test('Math.floor → floor', () => {
    const { body } = compile(({ uv }) => [Math.floor(uv.x * 10.0) / 10.0, 0.0, 0.0, 1.0]);
    expect(body).toContain('floor(');
  });

  test('Math.min / Math.max → min / max', () => {
    const { body } = compile(({ uv }) => [Math.min(uv.x, 0.5), Math.max(uv.y, 0.0), 0.0, 1.0]);
    expect(body).toContain('min(');
    expect(body).toContain('max(');
  });
});

// ── Type coercions ────────────────────────────────────────────────────────────

describe('jsToWGSL — type coercions', () => {
  test('ternary becomes select()', () => {
    const { body } = compile(({ uv }) => [uv.x > 0.5 ? 1.0 : 0.0, 0.0, 0.0, 1.0]);
    expect(body).toContain('select(');
  });

  test('vec2 constructor preserved', () => {
    const { body } = compile(({ uv }) => {
      const v = vec2(uv.x, uv.y);
      return [v.x, v.y, 0.0, 1.0];
    });
    expect(body).toContain('vec2f(');
  });
});

// ── Block bodies ──────────────────────────────────────────────────────────────

describe('jsToWGSL — block bodies', () => {
  test('let declaration becomes WGSL var', () => {
    const { body } = compile(({ uv }) => {
      let x = uv.x * 2.0;
      return [x, 0.0, 0.0, 1.0];
    });
    expect(body).toContain('var x');
  });

  test('const declaration becomes WGSL let', () => {
    const { body } = compile(({ time }) => {
      const t = time * 0.5;
      return [t, 0.0, 0.0, 1.0];
    });
    expect(body).toContain('let t');
  });

  test('if statement emitted', () => {
    const { body } = compile(({ uv }) => {
      let r = 0.0;
      if (uv.x > 0.5) { r = 1.0; }
      return [r, 0.0, 0.0, 1.0];
    });
    expect(body).toContain('if (');
  });
});

// ── Param detection ───────────────────────────────────────────────────────────

describe('jsToWGSL — param detection', () => {
  test('usesCol true when col param used', () => {
    const { usesCol } = compile(({ col }) => [col.r, col.g, col.b, 1.0]);
    expect(usesCol).toBe(true);
  });

  test('usesCol false when col not used', () => {
    const { usesCol } = compile(({ uv }) => [uv.x, 0.0, 0.0, 1.0]);
    expect(usesCol).toBe(false);
  });
});

// ── Helper function hoisting ──────────────────────────────────────────────────

describe('jsToWGSL — helper hoisting', () => {
  test('inner function hoisted to helpers array', () => {
    const { helpers } = compile(({ uv }) => {
      function wave(x) { return Math.sin(x * 6.28); }
      return [wave(uv.x), 0.0, 0.0, 1.0];
    });
    expect(helpers.length).toBeGreaterThan(0);
    expect(helpers[0]).toContain('fn wave');
  });

  test('helper contains WGSL sin (not Math.sin)', () => {
    const { helpers } = compile(({ uv }) => {
      function wave(x) { return Math.sin(x); }
      return [wave(uv.x), 0.0, 0.0, 1.0];
    });
    expect(helpers[0]).toContain('sin(');
    expect(helpers[0]).not.toContain('Math.sin');
  });

  test('no helpers when no inner functions', () => {
    const { helpers } = compile(({ uv }) => [uv.x, uv.y, 0.0, 1.0]);
    expect(helpers.length).toBe(0);
  });
});
