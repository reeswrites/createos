import { detectAPIUsage } from '../../../src/editor/api-detector.js';

// ── Text-level API detection ──────────────────────────────────────────────────

describe('detectAPIUsage — API presence', () => {
  test('detects audio usage', () => {
    expect(detectAPIUsage('audio.synth().play("C4")').usesAudio).toBe(true);
  });
  test('no audio when not present', () => {
    expect(detectAPIUsage('draw.circle(100,100,50)').usesAudio).toBe(false);
  });
  test('detects Shader construction', () => {
    expect(detectAPIUsage('const s = new Shader(({uv}) => [uv.x,0,0,1])').usesShader).toBe(true);
  });
  test('detects GLShader construction', () => {
    expect(detectAPIUsage('const s = new GLShader("void main(){gl_FragColor=vec4(1);}");').usesGLShader).toBe(true);
  });
  test('detects ShaderFX', () => {
    expect(detectAPIUsage('ShaderFX.presetShader("gradient")').usesShaderFX).toBe(true);
  });
  test('detects pixi usage', () => {
    expect(detectAPIUsage('const g = new PIXI.Graphics();').usesPixi).toBe(true);
  });
  test('detects sensors usage', () => {
    expect(detectAPIUsage('const m = sensors.mouse();').usesSensors).toBe(true);
  });
  test('detects video usage', () => {
    expect(detectAPIUsage('const sig = video.signal("camera");').usesVideo).toBe(true);
  });
  test('detects vision usage', () => {
    expect(detectAPIUsage('vision.onGesture("Thumb_Up", fn)').usesVision).toBe(true);
  });
  test('detects desktop usage', () => {
    expect(detectAPIUsage('desktop.add("http://x.com/a.png")').usesDesktop).toBe(true);
  });
  test('detects draw usage', () => {
    expect(detectAPIUsage('draw.rect(0,0,100,100,"red")').usesDraw).toBe(true);
  });
  test('detects Media usage', () => {
    expect(detectAPIUsage('const v = Media.video("url.mp4")').usesMedia).toBe(true);
  });
  test('detects getLayer usage', () => {
    expect(detectAPIUsage('getLayer(1).blur(5)').usesLayer).toBe(true);
  });
  test('multiple APIs detected in one snippet', () => {
    const r = detectAPIUsage('audio.bpm(120); draw.bg("black"); sensors.mouse();');
    expect(r.usesAudio).toBe(true);
    expect(r.usesDraw).toBe(true);
    expect(r.usesSensors).toBe(true);
  });
  test('detects ThreeScene construction', () => {
    expect(detectAPIUsage('const s = new ThreeScene();').usesThree).toBe(true);
  });
  test('detects THREE namespace usage', () => {
    expect(detectAPIUsage('const g = new THREE.BoxGeometry();').usesThree).toBe(true);
  });
  test('no usesThree when not present', () => {
    expect(detectAPIUsage('draw.circle(100,100,50)').usesThree).toBe(false);
  });
});

// ── Shader start detection (feeds #12 smart output detection) ─────────────────

describe('detectAPIUsage — shaderStartCalled', () => {
  test('Shader constructed + start() called → shaderStartCalled true', () => {
    const code = `const s = new Shader(({uv}) => [uv.x,0,0,1]); s.start();`;
    const r = detectAPIUsage(code);
    expect(r.shaderStartCalled).toBe(true);
    expect(r.shaderConstructedOnly).toBe(false);
  });

  test('Shader constructed only → shaderConstructedOnly true', () => {
    const code = `const s = new Shader(({uv}) => [uv.x,0,0,1]);`;
    const r = detectAPIUsage(code);
    expect(r.shaderStartCalled).toBe(false);
    expect(r.shaderConstructedOnly).toBe(true);
  });

  test('inline chain new Shader(...).start() → shaderStartCalled true', () => {
    const code = `new Shader(({uv}) => [uv.x,0,0,1]).start();`;
    const r = detectAPIUsage(code);
    expect(r.shaderStartCalled).toBe(true);
    expect(r.shaderConstructedOnly).toBe(false);
  });

  test('GLShader constructed + start() called', () => {
    const code = `const g = new GLShader("void main(){}"); g.start();`;
    const r = detectAPIUsage(code);
    expect(r.shaderStartCalled).toBe(true);
    expect(r.shaderConstructedOnly).toBe(false);
  });

  test('GLShader constructed only', () => {
    const code = `const g = new GLShader("void main(){}");`;
    const r = detectAPIUsage(code);
    expect(r.shaderConstructedOnly).toBe(true);
  });

  test('no Shader at all → both false', () => {
    const code = `draw.bg("black");`;
    const r = detectAPIUsage(code);
    expect(r.shaderStartCalled).toBe(false);
    expect(r.shaderConstructedOnly).toBe(false);
  });
});

// ── Smart output detection (#12) — needsCanvas / needsAudio logic ────────────

describe('detectAPIUsage — smart output detection', () => {
  function needsCanvas(code) {
    const r = detectAPIUsage(code);
    return r.usesDraw || r.usesLayer || r.usesPixi || r.usesShaderFX ||
      ((r.usesShader || r.usesGLShader) && r.shaderStartCalled);
  }

  test('draw.* → needsCanvas', () => {
    expect(needsCanvas('draw.circle(0,0,50,"red");')).toBe(true);
  });
  test('getLayer → needsCanvas', () => {
    expect(needsCanvas('getLayer(1).blur(5);')).toBe(true);
  });
  test('PIXI usage → needsCanvas', () => {
    expect(needsCanvas('Stage.addChild(sprite);')).toBe(true);
  });
  test('Shader with .start() → needsCanvas', () => {
    expect(needsCanvas('const s = new Shader(f); s.start();')).toBe(true);
  });
  test('Shader without .start() → no needsCanvas', () => {
    expect(needsCanvas('const s = new Shader(f);')).toBe(false);
  });
  test('GLShader with .start() → needsCanvas', () => {
    expect(needsCanvas('const g = new GLShader("void main(){}"); g.start();')).toBe(true);
  });
  test('GLShader without .start() → no needsCanvas', () => {
    expect(needsCanvas('const g = new GLShader("void main(){}");')).toBe(false);
  });
  test('audio-only code → no needsCanvas', () => {
    expect(needsCanvas('audio.synth().play("C4", "4n"); audio.start();')).toBe(false);
  });
  test('sensors-only → no needsCanvas', () => {
    expect(needsCanvas('sensors.mouse().stream(s => console.log(s.x));')).toBe(false);
  });

  function needsAudio(code) {
    return detectAPIUsage(code).usesAudio;
  }

  test('audio.* → needsAudio', () => {
    expect(needsAudio('audio.bpm(120);')).toBe(true);
  });
  test('draw-only → no needsAudio', () => {
    expect(needsAudio('draw.bg("black");')).toBe(false);
  });
});

// ── Parse errors ──────────────────────────────────────────────────────────────

describe('detectAPIUsage — error handling', () => {
  test('returns parseError on invalid JS', () => {
    const r = detectAPIUsage('const x = {{{{{ broken');
    expect(r.parseError).not.toBeNull();
  });

  test('still returns text-level detections even on parse error', () => {
    const r = detectAPIUsage('audio.synth() {{{{{ broken');
    expect(r.usesAudio).toBe(true);
    expect(r.parseError).not.toBeNull();
  });

  test('empty string produces all-false report', () => {
    const r = detectAPIUsage('');
    expect(r.usesAudio).toBe(false);
    expect(r.usesShader).toBe(false);
    expect(r.parseError).toBeNull();
  });
});
