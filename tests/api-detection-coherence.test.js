import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { API_PATTERNS, detectAPIUsage } from '../src/editor/api-detector.js';

// ── Coherence gate (ADR 012) ─────────────────────────────────────────────────
// Run-time API detection is a CENTRAL table (API_PATTERNS) deliberately kept out
// of each API's registration. This gate is the price of that choice: it locks the
// table to (a) a canonical-usage sample per key — so a renamed/rotted regex can't
// silently stop matching — and (b) an explicit consumed / detected-but-unconsumed
// classification — so no side-effect-bearing flag goes unwired without a record.
// A gate, not a generator (cf. ADR 008 / ADR 011).

// One representative snippet per detection key. Editing API_PATTERNS without
// adding/keeping a sample here fails this gate.
const SAMPLES = {
  usesAudio:    'audio.synth();',
  usesShader:   "const s = new Shader('return vec4f(1.0);');",
  usesGLShader: "const g = new GLShader('preset');",
  usesShaderFX: 'ShaderFX.invert();',
  usesPixi:     'pixi.add(sprite);',
  usesSensors:  'sensors.accel();',
  usesCamera:   'const c = new Camera();',
  usesVideo:    'video.signal();',
  usesVision:   'vision.detect();',
  usesDesktop:  'desktop.files();',
  usesMedia:    'Media.image(url);',
  usesDraw:     'draw.circle(1, 2, 3);',
  usesGetCanvas: 'getCanvas(0);',
  usesLayer:    'getLayer(0);',
  usesThree:    'const t = new ThreeScene();',
  usesRoute:    'route(Source.mic).amplitude.to(osc.frequency);',
};

// Non-pattern keys the detector adds to its result (AST call-flow + parse meta).
// These are deep checks with no per-API regex and stay out of the table by design.
const META_RESULT_KEYS = ['shaderStartCalled', 'shaderConstructedOnly', 'parseError'];

// Every detection flag is classified as exactly one of these. CONSUMED flags must
// be read by execute() in editor-instance.js; the rest are detected-but-not-yet-
// wired (informational / reserved) and explicitly listed here on purpose.
const CONSUMED = [
  'usesAudio',
];
// ADR 040: the auto-opened output window is gone — visual APIs spawn their own
// windows (new Canvas() / .show()), so execute() no longer reads these flags.
// They remain detected for toolkit/other uses but are no longer consumed here.
const DETECTED_UNCONSUMED = [
  'usesSensors', 'usesCamera', 'usesVideo', 'usesVision', 'usesDesktop', 'usesMedia',
  'usesRoute',   // route() spawns its own wm windows; no separate canvas window needed
  'usesDraw', 'usesGetCanvas', 'usesGLShader', 'usesLayer',
  'usesPixi', 'usesShader', 'usesShaderFX', 'usesThree',
];

const patternKeys = Object.keys(API_PATTERNS).sort();

describe('API detection coherence — sample ↔ pattern', () => {
  test('every pattern has a canonical-usage sample (and vice versa)', () => {
    expect(Object.keys(SAMPLES).sort()).toEqual(patternKeys);
  });

  test.each(patternKeys)('%s: pattern fires on its canonical usage', (key) => {
    expect(detectAPIUsage(SAMPLES[key])[key]).toBe(true);
  });

  test.each(patternKeys)('%s: no false positive on inert code', (key) => {
    expect(detectAPIUsage('const _x = 1;')[key]).toBe(false);
  });
});

describe('API detection coherence — table ↔ result shape', () => {
  test('result carries exactly the pattern keys plus the known meta keys', () => {
    const resultKeys = Object.keys(detectAPIUsage('const _x = 1;')).sort();
    const expected = [...patternKeys, ...META_RESULT_KEYS].sort();
    expect(resultKeys).toEqual(expected);
  });
});

describe('API detection coherence — consumption classification', () => {
  test('every flag is classified once (consumed ⊎ detected-unconsumed == patterns)', () => {
    const union = [...CONSUMED, ...DETECTED_UNCONSUMED].sort();
    expect(union).toEqual(patternKeys);
    // disjoint
    expect(CONSUMED.filter((k) => DETECTED_UNCONSUMED.includes(k))).toEqual([]);
  });

  test('every CONSUMED flag is actually read by execute() in editor-instance.js', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/editor/editor-instance.js'), 'utf8');
    for (const key of CONSUMED) {
      expect(src.includes(`_apiHints.${key}`)).toBe(true);
    }
  });
});
