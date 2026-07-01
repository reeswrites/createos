// Tests for the new Blockly code generators in js/blocks.js.
// Strategy: mock Blockly so the module loads in jsdom, then call each
// registered generator directly via the forBlock registry.

import { vi, describe, test, expect } from 'vitest';

// ── Blockly mocks ─────────────────────────────────────────────────────────────

const forBlock = {};

vi.mock('blockly/javascript', () => ({
  javascriptGenerator: { forBlock },
  Order: { ATOMIC: 0, NEW: 1.1, FUNCTION_CALL: 2, NONE: 99 },
}));

const _GestureMock = { prototype: { handleUp: vi.fn() } };

vi.mock('blockly', () => ({
  default: {
    defineBlocksWithJsonArray: vi.fn(),
    inject: vi.fn(),
    svgResize: vi.fn(),
    Themes: { Classic: {} },
    Gesture: _GestureMock,
  },
  defineBlocksWithJsonArray: vi.fn(),
  inject: vi.fn(),
  svgResize: vi.fn(),
  Themes: { Classic: {} },
  Gesture: _GestureMock,
}));

vi.mock('blockly/blocks', () => ({}));

// Import after mocks — side-effect registers all generators
await import('../../../src/blocks/blocks.js');

// ── Helpers ───────────────────────────────────────────────────────────────────

const makeBlock = (fields = {}) => ({
  getFieldValue: (name) => fields[name] ?? '',
});

const makeGen = (values = {}, statements = {}) => ({
  valueToCode: (_b, name, _order) => values[name] ?? '',
  statementToCode: (_b, name) => statements[name] ?? '',
});

const gen = (name, block, g = makeGen()) => forBlock[name](block, g);

// ── Control ───────────────────────────────────────────────────────────────────

describe('ctrl_interval', () => {
  test('wraps body in setInterval', () => {
    const b = makeBlock({ MS: '100' });
    const g = makeGen({}, { DO: '  doThing();\n' });
    expect(gen('ctrl_interval', b, g)).toBe('setInterval(() => {\n  doThing();\n}, 100);\n');
  });
  test('empty body still valid JS', () => {
    const b = makeBlock({ MS: '500' });
    expect(gen('ctrl_interval', b)).toBe('setInterval(() => {\n}, 500);\n');
  });
});

describe('ctrl_timeout', () => {
  test('wraps body in setTimeout', () => {
    const b = makeBlock({ MS: '1000' });
    const g = makeGen({}, { DO: '  doOnce();\n' });
    expect(gen('ctrl_timeout', b, g)).toBe('setTimeout(() => {\n  doOnce();\n}, 1000);\n');
  });
});

describe('ctrl_onkey', () => {
  test('wraps body in onKey for specific key', () => {
    const b = makeBlock({ KEY: 'ArrowUp' });
    const g = makeGen({}, { DO: '  jump();\n' });
    expect(gen('ctrl_onkey', b, g)).toBe('onKey("ArrowUp", (e) => {\n  jump();\n});\n');
  });
  test('any key uses "any"', () => {
    const b = makeBlock({ KEY: 'any' });
    expect(gen('ctrl_onkey', b)).toBe('onKey("any", (e) => {\n});\n');
  });
});

describe('ctrl_stop', () => {
  test('generates stop()', () => expect(gen('ctrl_stop', makeBlock())).toBe('stop();\n'));
});
describe('ctrl_pause', () => {
  test('generates pause()', () => expect(gen('ctrl_pause', makeBlock())).toBe('pause();\n'));
});
describe('ctrl_resume', () => {
  test('generates resume()', () => expect(gen('ctrl_resume', makeBlock())).toBe('resume();\n'));
});

describe('ctrl_random', () => {
  test('returns randUni expression', () => {
    const [code, order] = gen('ctrl_random', makeBlock({ LO: '0', HI: '100' }));
    expect(code).toBe('randUni(0, 100)');
    expect(order).toBe(2); // FUNCTION_CALL
  });
});

describe('ctrl_random_color', () => {
  test('returns Color.random() expression', () => {
    const [code] = gen('ctrl_random_color', makeBlock());
    expect(code).toBe('Color.random()');
  });
});

// ── Audio ─────────────────────────────────────────────────────────────────────

describe('audio_create_synth', () => {
  test('synth type', () => {
    const [code] = gen('audio_create_synth', makeBlock({ TYPE: 'synth' }));
    expect(code).toBe('audio.synth()');
  });
  test('poly type', () => {
    const [code] = gen('audio_create_synth', makeBlock({ TYPE: 'poly' }));
    expect(code).toBe('audio.poly()');
  });
  test('fm type', () => {
    const [code] = gen('audio_create_synth', makeBlock({ TYPE: 'fm' }));
    expect(code).toBe('audio.fm()');
  });
});

describe('audio_play', () => {
  test('plays note on synth from value input', () => {
    const b = makeBlock({ NOTE: 'C4', DUR: '8n' });
    const g = makeGen({ SYNTH: 's' });
    expect(gen('audio_play', b, g)).toBe('(s).play("C4", "8n");\n');
  });
  test('null synth when no value connected', () => {
    const b = makeBlock({ NOTE: 'G4', DUR: '4n' });
    expect(gen('audio_play', b)).toBe('(null).play("G4", "4n");\n');
  });
});

describe('audio_bpm', () => {
  test('sets bpm', () => {
    expect(gen('audio_bpm', makeBlock({ BPM: '120' }))).toBe('audio.bpm(120);\n');
  });
});

describe('audio_transport_start', () => {
  test('starts transport', () => {
    expect(gen('audio_transport_start', makeBlock())).toBe('audio.start();\n');
  });
});

describe('audio_volume', () => {
  test('sets volume', () => {
    expect(gen('audio_volume', makeBlock({ DB: '-6' }))).toBe('audio.volume(-6);\n');
  });
});

describe('audio_reverb', () => {
  test('returns reverb expression', () => {
    const [code] = gen('audio_reverb', makeBlock({ DEC: '2' }));
    expect(code).toBe('audio.reverb(2)');
  });
});

describe('audio_delay', () => {
  test('returns delay expression', () => {
    const [code] = gen('audio_delay', makeBlock({ TIME: '0.25', FB: '0.5' }));
    expect(code).toBe('audio.delay(0.25, 0.5)');
  });
});

describe('audio_distort', () => {
  test('returns distortion expression', () => {
    const [code] = gen('audio_distort', makeBlock({ AMT: '0.8' }));
    expect(code).toBe('audio.distort(0.8)');
  });
});

describe('audio_connect', () => {
  test('connects from to to', () => {
    const g = makeGen({ FROM: 's', TO: 'rev' });
    expect(gen('audio_connect', makeBlock(), g)).toBe('(s).connect(rev);\n');
  });
});

// ── Shader ────────────────────────────────────────────────────────────────────

describe('shader_preset', () => {
  test('gradient preset returns value expression', () => {
    const [code, order] = gen('shader_preset', makeBlock({ PRESET: 'gradient' }));
    expect(code).toContain('ShaderFX.presetShader(');
    expect(code).toContain('"gradient"');
    expect(typeof order).toBe('number');
  });
  test('plasma preset uses correct name', () => {
    const [code] = gen('shader_preset', makeBlock({ PRESET: 'plasma' }));
    expect(code).toContain('"plasma"');
  });
});

describe('shader_start', () => {
  test('calls start on shader value', () => {
    const g = makeGen({ SHADER: 'myShader' });
    expect(gen('shader_start', makeBlock(), g)).toBe('(myShader).start();\n');
  });
});

describe('shader_stop', () => {
  test('calls stop on shader value', () => {
    const g = makeGen({ SHADER: 'myShader' });
    expect(gen('shader_stop', makeBlock(), g)).toBe('(myShader).stop();\n');
  });
});

describe('shader_opacity', () => {
  test('calls opacity on shader', () => {
    const b = makeBlock({ OPACITY: '0.5' });
    const g = makeGen({ SHADER: 's' });
    expect(gen('shader_opacity', b, g)).toBe('(s).opacity(0.5);\n');
  });
});

// ── Vision ────────────────────────────────────────────────────────────────────

describe('vision_on_gesture', () => {
  test('wraps body in vision.onGesture', () => {
    const b = makeBlock({ GESTURE: 'Thumb_Up' });
    const g = makeGen({}, { DO: '  doStuff();\n' });
    expect(gen('vision_on_gesture', b, g)).toBe(
      'vision.onGesture("Thumb_Up", () => {\n  doStuff();\n});\n',
    );
  });
  test('empty body', () => {
    const b = makeBlock({ GESTURE: 'Open_Palm' });
    expect(gen('vision_on_gesture', b)).toBe(
      'vision.onGesture("Open_Palm", () => {\n});\n',
    );
  });
});

describe('vision_on_expression', () => {
  test('wraps body in vision.onExpression', () => {
    const b = makeBlock({ EXPR: 'smile' });
    const g = makeGen({}, { DO: '  playNote();\n' });
    expect(gen('vision_on_expression', b, g)).toBe(
      'vision.onExpression("smile", () => {\n  playNote();\n});\n',
    );
  });
});

describe('vision_gesture', () => {
  test('returns vision.gesture() expression', () => {
    const [code] = gen('vision_gesture', makeBlock());
    expect(code).toBe('vision.gesture()');
  });
});

describe('vision_face_detected', () => {
  test('returns null check expression', () => {
    const [code] = gen('vision_face_detected', makeBlock());
    expect(code).toBe('(vision.face() !== null)');
  });
});

describe('vision_nearest', () => {
  test('returns nearest expression with label', () => {
    const [code] = gen('vision_nearest', makeBlock({ LABEL: 'person' }));
    expect(code).toBe('vision.nearest("person")');
  });
});

// ── Canvas ────────────────────────────────────────────────────────────────────

// ADR 040: quick-draw blocks emit against an implicit default `canvas` (no global draw).
describe('canvas_fill_rect', () => {
  test('generates canvas.rect call with color and coords', () => {
    const b = makeBlock({ X: '10', Y: '20', W: '100', H: '50', COLOR: 'red' });
    const code = gen('canvas_fill_rect', b);
    expect(code).toContain('canvas.rect(10, 20, 100, 50');
    expect(code).toContain('"red"');
  });
});

describe('canvas_fill_circle', () => {
  test('generates canvas.circle call', () => {
    const b = makeBlock({ X: '200', Y: '300', R: '50', COLOR: 'blue' });
    const code = gen('canvas_fill_circle', b);
    expect(code).toContain('canvas.circle(200, 300, 50');
    expect(code).toContain('"blue"');
  });
});

describe('canvas_clear', () => {
  test('generates canvas.clear()', () => {
    const code = gen('canvas_clear', makeBlock());
    expect(code).toContain('canvas.clear()');
  });
});

describe('canvas_blur', () => {
  test('calls canvas.fx().blur()', () => {
    expect(gen('canvas_blur', makeBlock({ Z: '0', AMT: '5' }))).toBe('canvas.fx(0).blur(5);\n');
  });
});

describe('canvas_layer_opacity', () => {
  test('calls canvas.fx().opacity()', () => {
    expect(gen('canvas_layer_opacity', makeBlock({ Z: '1', OPACITY: '0.5' }))).toBe(
      'canvas.fx(1).opacity(0.5);\n',
    );
  });
});

// ── Media ─────────────────────────────────────────────────────────────────────

describe('media_video', () => {
  test('returns Media.video(url) expression', () => {
    const [code] = gen('media_video', makeBlock({ URL: 'https://example.com/clip.mp4' }));
    expect(code).toBe('Media.video("https://example.com/clip.mp4")');
  });
});

describe('media_video_play', () => {
  test('calls play() on video value', () => {
    const g = makeGen({ VIDEO: 'vid' });
    expect(gen('media_video_play', makeBlock(), g)).toBe('(vid).play();\n');
  });
});

describe('media_video_stop', () => {
  test('calls stop() on video value', () => {
    const g = makeGen({ VIDEO: 'vid' });
    expect(gen('media_video_stop', makeBlock(), g)).toBe('(vid).stop();\n');
  });
});

describe('media_image_layer', () => {
  test('returns Media.imageLayer(url) expression', () => {
    const [code] = gen('media_image_layer', makeBlock({ URL: 'https://example.com/photo.jpg' }));
    expect(code).toBe('Media.imageLayer("https://example.com/photo.jpg")');
  });
});

// ── text_print override ───────────────────────────────────────────────────────

describe('text_print override', () => {
  test('uses console.log not alert', () => {
    const g = makeGen({ TEXT: '"hello"' });
    const b = { getFieldValue: () => '' };
    expect(gen('text_print', b, g)).toBe('console.log("hello");\n');
  });
  test('empty text defaults to empty string', () => {
    expect(gen('text_print', makeBlock())).toBe("console.log('');\n");
  });
});
