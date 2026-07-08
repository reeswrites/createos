// ── Built-in API registration ─────────────────────────────────────────────────
// Every public API goes through _registerBuiltin so the registry is the single
// source of truth. Users call registerAPI() to override or extend any built-in.
// Extracted from app.js (which keeps only the runtime-dependent registrations —
// wm/pixi/library/captureWindow — that need onload-time init).
//
// The completion-coherence gate greps THIS file + app.js for _registerBuiltin('name')
// to derive KNOWN_GLOBALS — keep the literal-name form (no loops) so each name is seen.
import { vision } from '../api/media/vision.js';
import { lang } from '../api/lang/lang.js';
import { addToolkitEntries } from '../editor/toolkit-catalog.js';
import {
  _registerBuiltin,
  registerAPI,
  reassertBuiltins,
  _setToolkitApplier,
  _setBlocksApplier,
  deriveAudioDetectPattern,
} from './api-registry.js';
import { setAudioDetectPattern } from '../editor/api-detector.js';
import { Camera } from '../api/media/camera.js';
import { audio } from '../api/audio/audio.js';
import { initStrudel, strudelGlobals } from '../api/audio/strudel.js';
import { Shader, ShaderFX } from '../api/shader/shader.js';
import { GLShader, GLSL_PRESETS } from '../api/shader/glsl-shader.js';
import { Canvas } from '../api/visual/canvas.js';
import { PIXI } from '../api/visual/pixi.js';
import { AudioViz, SpectrogramCanvas, PianoRollViz } from '../api/visual/viz.js';
import { mixer } from '../api/audio/mixer.js';
import { Drumpad } from '../api/audio/drumpad.js';
import { Piano } from '../api/audio/piano.js';
import { Voice } from '../api/audio/voice.js';
import { openSynthDesigner } from '../api/audio/synth-designer.js';
import { Launchpad } from '../api/audio/launchpad.js';
import { Notepad } from '../api/widgets/notepad.js';
import { Recording, recordStream, compositeCanvasStream } from '../api/media/recorder.js';
import { Media } from '../api/media/media.js';
import { VideoSignalAPI } from '../api/signal/video-signal.js';
import { DesktopAPI } from '../api/platform/desktop-files.js';
import { pipe, Source } from '../api/visual/render-pipeline.js';
import { Mask } from '../api/visual/mask-registry.js';
import { route } from '../api/signal/route.js';
import { physics } from '../api/signal/physics.js';
import '../api/signal/physics-sims.js'; // side effect: registers the v1 sim catalog (ADR 059)
import { timeline } from '../api/signal/timeline.js';
import { applyExternalBlocks } from '../blocks/blocks.js';
import { editImage } from '../api/media/image-edit.js';
import { ThreeScene, THREE } from '../api/visual/three-scene.js';
import { signalGraph } from '../api/signal/signal-graph.js';
import { ascii } from '../api/widgets/ascii.js';
import { Sprite } from '../api/widgets/sprite.js';
import { SpriteEditor } from '../api/widgets/sprite-editor.js';
import { Paint } from '../api/widgets/paint.js';
import { AsciiEditor } from '../api/widgets/asciiEditor.js';
import { PluginHost } from '../api/platform/plugin-host.js';
import { shell } from '../api/io/shell.js';
import { midi } from '../api/audio/midi.js';
import { external } from '../api/io/external.js';
import { statusBar } from '../api/wm/status-bar.js';
import { on, emit, any, tick, hold, tween } from '../events/index.js';
import { openEventPanel } from '../api/wm/event-panel.js';

class Color {
  static random() {
    return `hsl(${Math.floor(Math.random() * 360)},${50 + Math.floor(Math.random() * 50)}%,${40 + Math.floor(Math.random() * 30)}%)`;
  }
  static invert(color) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return `rgb(${255 - r}, ${255 - g}, ${255 - b})`;
  }
}

// Registers every startup built-in. Called once at app.js module load (before onload),
// so timing matches the old inline block: registrations exist before the first run and
// the Strudel reassert is armed early.
export function registerBuiltins() {
  _registerBuiltin('vision', vision, {
    params: { onGesture: ['name', 'fn'], onExpression: ['name', 'fn'] },
  });
  _registerBuiltin('lang', lang, {
    params: {
      isProfane: ['text'],
      profanity: ['text'],
      censor: ['text', 'mask?'],
      block: ['...words'],
      allow: ['...words'],
      sentiment: ['text'],
      classify: ['text'],
      configure: ['opts?'],
    },
  });
  _registerBuiltin('video', VideoSignalAPI, {
    params: {
      signal: ['source', 'opts?'],
      onMotion: ['source', 'threshold', 'onEnter', 'onExit?'],
      onBrightness: ['source', 'threshold', 'onEnter', 'onExit?'],
    },
  });
  // sensors global removed — use on('sensor:*') / hold('sensor:*') / emit('haptics:*') instead
  _registerBuiltin('desktop', DesktopAPI, {
    params: { add: ['url', 'opts?'], remove: ['id'] },
  });
  _registerBuiltin('audio', audio, {
    params: {
      onLevel: ['threshold', 'onEnter', 'onExit?'],
      onWord: ['word', 'fn'],
      onSpeech: ['fn'],
      say: ['text', 'opts?'],
      load: ['url'],
      spectrogram: ['source', 'opts?'],
      pianoRoll: ['opts?'],
    },
    detect: { effect: 'audio' },
  });
  _registerBuiltin('Shader', Shader, { params: ['fragmentBody', 'opts?'] });
  _registerBuiltin('ShaderFX', ShaderFX, { params: ['fragmentBody', 'opts?'] });
  _registerBuiltin('GLShader', GLShader, { params: ['fragmentBody', 'opts?'] });
  _registerBuiltin('GLSL_PRESETS', GLSL_PRESETS);
  _registerBuiltin('Canvas', Canvas, { params: ['opts?'] });
  _registerBuiltin('pipe', pipe);
  _registerBuiltin('Mask', Mask, {
    params: { register: ['name', 'factory'], circle: ['opts?'], feather: ['opts?'] },
  });
  _registerBuiltin('Source', Source);
  _registerBuiltin('route', route);
  _registerBuiltin('physics', physics, { params: ['name', 'opts?'] });
  _registerBuiltin('timeline', timeline);
  _registerBuiltin('PIXI', PIXI);
  // Vector constructor stubs — used as type hints in Shader JS function params.
  // In the JS function body these are real values; the transpiler maps them to WGSL vec types.
  _registerBuiltin('vec2', (x = 0, y = 0) => ({ x, y, _wgsl: 'vec2f' }));
  _registerBuiltin('vec3', (x = 0, y = 0, z = 0) => ({ x, y, z, _wgsl: 'vec3f' }));
  _registerBuiltin('vec4', (x = 0, y = 0, z = 0, w = 1) => ({ x, y, z, w, _wgsl: 'vec4f' }));
  _registerBuiltin('Camera', Camera, { params: ['opts?'] });
  _registerBuiltin('AudioViz', AudioViz);
  _registerBuiltin('SpectrogramCanvas', SpectrogramCanvas);
  _registerBuiltin('PianoRollViz', PianoRollViz);
  _registerBuiltin('mixer', mixer, {
    params: { strip: ['name'], add: ['node', 'opts?'] },
  });
  _registerBuiltin('Drumpad', Drumpad, { detect: { effect: 'audio' } });
  _registerBuiltin('Launchpad', Launchpad, { detect: { effect: 'audio' } });
  _registerBuiltin('Piano', Piano, { detect: { effect: 'audio' } });
  _registerBuiltin('Voice', Voice, {
    params: {
      define: ['name', 'desc'],
      make: ['nameOrDesc'],
      get: ['name'],
      remove: ['name'],
      design: ['seed?'],
      sample: ['opts'],
      faust: ['name', 'code', 'opts?'],
    },
    detect: { effect: 'audio' },
  });
  _registerBuiltin('openSynthDesigner', openSynthDesigner, {
    params: ['seed?'],
    detect: { effect: 'audio' },
  });
  _registerBuiltin('Notepad', Notepad);
  _registerBuiltin('notepad', (opts) => new Notepad(opts));
  _registerBuiltin('Recording', Recording);
  _registerBuiltin('recordStream', recordStream);
  _registerBuiltin('compositeCanvasStream', compositeCanvasStream);
  _registerBuiltin('recordWindow', (winId, opts) => window.wm?.record(winId, opts));
  _registerBuiltin('snapshot', (winId, opts) => window.wm?.snapshot(winId, opts));
  _registerBuiltin('Media', Media);

  // Strudel pattern engine (ADR 035). Replaces the removed in-house pat()/pattern()/
  // stack()/Pattern. Bootstrap is async; globals are registered eagerly from the
  // imported namespace so they exist before the first run, and .play() awaits init.
  // Registered with literal names (not a loop) so the completion-coherence gate and
  // the toolkit/detection surfaces can see each one.
  // Strudel's evalScope (async) blind-writes all its exports onto globalThis after
  // this returns, clobbering same-named builtins (notably @strudel/core's `on as pipe`
  // vs the render-pipeline `pipe`). Re-assert the app's builtins once it settles so the
  // registry wins. `.finally` covers the case where evalScope ran (clobbered) then a
  // later init step threw. See api-registry.reassertBuiltins() + ADR 035.
  Promise.resolve(initStrudel()).finally(reassertBuiltins);
  const _S = strudelGlobals();
  // sources — `note` also carries Strudel's universal `.play()` trigger (ADR 058).
  // `s`/`n` stay undeclared: a single-letter name trigger would false-positive on
  // any code; they surface as audio through `.play()`.
  _registerBuiltin('note', _S.note, {
    params: ['pattern'],
    detect: { effect: 'audio', triggers: ['\\.play\\s*\\(\\s*\\)'] },
  });
  _registerBuiltin('s', _S.s, { params: ['pattern'] });
  _registerBuiltin('n', _S.n, { params: ['pattern'] });
  _registerBuiltin('sound', _S.sound, { params: ['pattern'], detect: { effect: 'audio' } });
  _registerBuiltin('silence', _S.silence);
  // combinators
  _registerBuiltin('stack', _S.stack, { params: ['...patterns'], detect: { effect: 'audio' } });
  _registerBuiltin('cat', _S.cat, { params: ['...patterns'], detect: { effect: 'audio' } });
  _registerBuiltin('slowcat', _S.slowcat);
  _registerBuiltin('fastcat', _S.fastcat);
  _registerBuiltin('seq', _S.seq, { params: ['...patterns'], detect: { effect: 'audio' } });
  _registerBuiltin('sequence', _S.sequence, { detect: { effect: 'audio' } });
  _registerBuiltin('timeCat', _S.timeCat);
  _registerBuiltin('arrange', _S.arrange);
  _registerBuiltin('polymeter', _S.polymeter);
  _registerBuiltin('polyrhythm', _S.polyrhythm);
  _registerBuiltin('run', _S.run);
  // random / signals
  _registerBuiltin('rand', _S.rand);
  _registerBuiltin('rand2', _S.rand2);
  _registerBuiltin('perlin', _S.perlin);
  _registerBuiltin('irand', _S.irand);
  _registerBuiltin('choose', _S.choose);
  _registerBuiltin('wchoose', _S.wchoose);
  _registerBuiltin('chooseCycles', _S.chooseCycles);
  _registerBuiltin('randcat', _S.randcat);
  _registerBuiltin('sine', _S.sine);
  _registerBuiltin('cosine', _S.cosine);
  _registerBuiltin('saw', _S.saw);
  _registerBuiltin('isaw', _S.isaw);
  _registerBuiltin('square', _S.square);
  _registerBuiltin('tri', _S.tri);
  _registerBuiltin('signal', _S.signal);
  _registerBuiltin('steady', _S.steady);
  // helpers + transport
  _registerBuiltin('pure', _S.pure);
  _registerBuiltin('reify', _S.reify);
  _registerBuiltin('mini', _S.mini);
  _registerBuiltin('samples', _S.samples, { params: ['urlOrMap'], detect: { effect: 'audio' } });
  _registerBuiltin('setcps', _S.setcps, { params: ['cps'], detect: { effect: 'audio' } });
  _registerBuiltin('setcpm', _S.setcpm, { detect: { effect: 'audio' } });
  _registerBuiltin('hush', _S.hush, { detect: { effect: 'audio' } });

  _registerBuiltin('Color', Color);
  _registerBuiltin('on', on);
  _registerBuiltin('emit', emit);
  _registerBuiltin('any', any);
  _registerBuiltin('tick', tick, { params: ['ms'] });
  _registerBuiltin('hold', hold, { params: ['event'] });
  _registerBuiltin('tween', tween);
  _registerBuiltin('monitor', openEventPanel);
  _registerBuiltin('randUni', (lo, hi) => Math.random() * (hi - lo) + lo);
  // Expose registerAPI to user code so plugins and snippets can extend the platform.
  _registerBuiltin('registerAPI', registerAPI);
  _registerBuiltin('editImage', editImage);
  _registerBuiltin('ThreeScene', ThreeScene);
  _registerBuiltin('THREE', THREE);
  _registerBuiltin('signalGraph', signalGraph);
  _registerBuiltin('ascii', ascii);
  _registerBuiltin('Sprite', Sprite);
  _registerBuiltin('SpriteEditor', SpriteEditor);
  _registerBuiltin('spriteEditor', (opts) => new SpriteEditor(opts));
  _registerBuiltin('Paint', Paint);
  _registerBuiltin('paint', (opts) => new Paint(opts));
  _registerBuiltin('AsciiEditor', AsciiEditor);
  _registerBuiltin('asciiEditor', (opts) => new AsciiEditor(opts));
  _registerBuiltin('PluginHost', PluginHost);
  _registerBuiltin('shell', shell);
  _registerBuiltin('midi', midi, { detect: { effect: 'audio' } });
  _registerBuiltin('external', external);
  _registerBuiltin('statusBar', statusBar);

  // Wire up extensibility appliers so registerAPI(name, impl, { blocks, toolkit }) works.
  _setBlocksApplier(applyExternalBlocks);
  _setToolkitApplier(addToolkitEntries);

  // ADR 058: derive the audio-usage detection regex from the descriptors declared
  // above (detect.effect === 'audio') and inject it into the detector, so run.js's
  // usesAudio flag covers every registered instrument without a hand-maintained list.
  setAudioDetectPattern(deriveAudioDetectPattern());
}
