import { Layer } from '../../../../src/api/visual/layer.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeLayer() {
  const canvas = document.createElement('canvas');
  canvas.width = 800;
  canvas.height = 600;
  return { layer: new Layer(canvas), canvas };
}

// ── canvas accessor ───────────────────────────────────────────────────────────

describe('Layer.canvas', () => {
  test('exposes the canvas passed to constructor', () => {
    const { layer, canvas } = makeLayer();
    expect(layer.canvas).toBe(canvas);
  });
});

// ── Filter methods ────────────────────────────────────────────────────────────

describe('Layer.blur', () => {
  test('sets CSS blur filter', () => {
    const { layer, canvas } = makeLayer();
    layer.blur(5);
    expect(canvas.style.filter).toContain('blur(5px)');
  });
  test('returns this', () => {
    const { layer } = makeLayer();
    expect(layer.blur(3)).toBe(layer);
  });
});

describe('Layer.hue', () => {
  test('sets CSS hue-rotate filter', () => {
    const { layer, canvas } = makeLayer();
    layer.hue(90);
    expect(canvas.style.filter).toContain('hue-rotate(90deg)');
  });
  test('returns this', () => {
    const { layer } = makeLayer();
    expect(layer.hue(45)).toBe(layer);
  });
});

describe('Layer.brightness', () => {
  test('sets CSS brightness filter', () => {
    const { layer, canvas } = makeLayer();
    layer.brightness(1.5);
    expect(canvas.style.filter).toContain('brightness(1.5)');
  });
  test('returns this', () => {
    const { layer } = makeLayer();
    expect(layer.brightness(1)).toBe(layer);
  });
});

describe('Layer.saturate', () => {
  test('sets CSS saturate filter', () => {
    const { layer, canvas } = makeLayer();
    layer.saturate(2);
    expect(canvas.style.filter).toContain('saturate(2)');
  });
  test('returns this', () => {
    const { layer } = makeLayer();
    expect(layer.saturate(1)).toBe(layer);
  });
});

describe('Layer.invert', () => {
  test('sets CSS invert filter', () => {
    const { layer, canvas } = makeLayer();
    layer.invert(1);
    expect(canvas.style.filter).toContain('invert(1)');
  });
  test('returns this', () => {
    const { layer } = makeLayer();
    expect(layer.invert(0.5)).toBe(layer);
  });
});

// ── Multiple filters compose ──────────────────────────────────────────────────

describe('Layer filter composition', () => {
  test('blur + hue both appear in filter string', () => {
    const { layer, canvas } = makeLayer();
    layer.blur(4).hue(120);
    expect(canvas.style.filter).toContain('blur(4px)');
    expect(canvas.style.filter).toContain('hue-rotate(120deg)');
  });
});

// ── rawFilter override ────────────────────────────────────────────────────────

describe('Layer.filter (raw override)', () => {
  test('sets filter string verbatim', () => {
    const { layer, canvas } = makeLayer();
    layer.filter('sepia(1) contrast(2)');
    expect(canvas.style.filter).toBe('sepia(1) contrast(2)');
  });
  test('returns this', () => {
    const { layer } = makeLayer();
    expect(layer.filter('none')).toBe(layer);
  });
});

// ── Opacity ───────────────────────────────────────────────────────────────────

describe('Layer.opacity', () => {
  test('sets canvas style.opacity', () => {
    const { layer, canvas } = makeLayer();
    layer.opacity(0.5);
    expect(canvas.style.opacity).toBe('0.5');
  });
  test('returns this', () => {
    const { layer } = makeLayer();
    expect(layer.opacity(1)).toBe(layer);
  });
});

// ── Transform methods ─────────────────────────────────────────────────────────

describe('Layer.rotate', () => {
  test('sets CSS rotate transform', () => {
    const { layer, canvas } = makeLayer();
    layer.rotate(45);
    expect(canvas.style.transform).toContain('rotate(45deg)');
  });
  test('returns this', () => {
    const { layer } = makeLayer();
    expect(layer.rotate(0)).toBe(layer);
  });
});

describe('Layer.scale', () => {
  test('sets CSS scale transform', () => {
    const { layer, canvas } = makeLayer();
    layer.scale(2);
    expect(canvas.style.transform).toContain('scale(2)');
  });
  test('returns this', () => {
    const { layer } = makeLayer();
    expect(layer.scale(1)).toBe(layer);
  });
});

describe('Layer.rotateX', () => {
  test('includes perspective and rotateX', () => {
    const { layer, canvas } = makeLayer();
    layer.rotateX(30);
    expect(canvas.style.transform).toContain('perspective(');
    expect(canvas.style.transform).toContain('rotateX(30deg)');
  });
  test('returns this', () => {
    const { layer } = makeLayer();
    expect(layer.rotateX(0)).toBe(layer);
  });
});

// ── clip ──────────────────────────────────────────────────────────────────

describe('Layer.clip', () => {
  test('sets canvas style.clipPath', () => {
    const { layer, canvas } = makeLayer();
    layer.clip('circle(50%)');
    expect(canvas.style.clipPath).toBe('circle(50%)');
  });
  test('returns this', () => {
    const { layer } = makeLayer();
    expect(layer.clip('none')).toBe(layer);
  });
});

// ── blendMode ─────────────────────────────────────────────────────────────────

describe('Layer.blendMode', () => {
  test('sets canvas style.mixBlendMode', () => {
    const { layer, canvas } = makeLayer();
    layer.blendMode('multiply');
    expect(canvas.style.mixBlendMode).toBe('multiply');
  });
  test('returns this', () => {
    const { layer } = makeLayer();
    expect(layer.blendMode('screen')).toBe(layer);
  });
  test('reset() clears mixBlendMode', () => {
    const { layer, canvas } = makeLayer();
    layer.blendMode('overlay');
    layer.reset();
    expect(canvas.style.mixBlendMode).toBe('');
  });
  test('accepts any valid CSS blend mode', () => {
    const { layer, canvas } = makeLayer();
    layer.blendMode('difference');
    expect(canvas.style.mixBlendMode).toBe('difference');
  });
});

// ── chaining ──────────────────────────────────────────────────────────────────

describe('Layer chaining', () => {
  test('methods chain fluently', () => {
    const { layer } = makeLayer();
    const result = layer
      .blur(2)
      .hue(45)
      .brightness(1.2)
      .opacity(0.8)
      .rotate(10)
      .blendMode('screen');
    expect(result).toBe(layer);
  });
});
