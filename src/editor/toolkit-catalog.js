// Toolkit API catalog — the drag-out snippet drawer data (TOOLKIT_CATEGORIES) plus
// its single write seam (addToolkitEntries). Pure data + one mutator; the CodeMirror
// completion source that used to share this file now lives in completions.js.
// Consumers: api/wm/toolkit-window.js (renders the drawer + installs the live
// __ar_addToolkitEntry hook) and runtime/register-builtins.js (wires the applier).

export const TOOLKIT_CATEGORIES = [
  {
    name: 'Draw',
    commands: [
      {
        label: 'background',
        code: "canvas.bg('#111');",
        hint: 'Fill entire canvas with a color',
      },
      {
        label: 'rect',
        code: "canvas.rect(x, y, w, h, 'red');",
        hint: 'Filled rectangle — x, y, width, height, color',
      },
      {
        label: 'circle',
        code: "canvas.circle(x, y, r, 'red');",
        hint: 'Filled circle — x, y, radius, color',
      },
      {
        label: 'line',
        code: "canvas.line(x1, y1, x2, y2, 'white', 2);",
        hint: 'Line — start, end, color, thickness',
      },
      {
        label: 'ring',
        code: "canvas.ring(x, y, r, 'white', 3);",
        hint: 'Stroked circle — x, y, radius, color, thickness',
      },
      {
        label: 'stroked rect',
        code: "canvas.rectStroke(x, y, w, h, 'white', 2);",
        hint: 'Stroked rectangle — x, y, w, h, color, thickness',
      },
      {
        label: 'polygon',
        code: "canvas.poly([[0,0],[100,0],[50,100]], 'teal');",
        hint: 'Filled polygon — array of [x,y] points, color',
      },
      {
        label: 'text',
        code: "canvas.text('hello', x, y, 32, 'white');",
        hint: 'Text — string, x, y, size(px), color. Optional 6th arg: { font, align, baseline }',
      },
      {
        label: 'text centered',
        code: "canvas.text('hello', canvas.width/2, canvas.height/2, 48, 'white', { align: 'center', baseline: 'middle' });",
        hint: 'Center text on canvas using canvas.width/canvas.height',
      },
      {
        label: 'text stroke',
        code: "canvas.text('OUTLINE', 100, 200, 64, '#fff', { stroke: true, strokeColor: '#000', strokeWidth: 3 });",
        hint: 'Text with outline stroke — stroke:true, strokeColor, strokeWidth',
        tags: ['text', 'stroke', 'outline'],
      },
      {
        label: 'text shadow',
        code: "canvas.text('Shadow', 100, 200, 64, '#fff', { shadow: true, shadowColor: 'rgba(0,0,0,0.7)', shadowBlur: 8, shadowX: 3, shadowY: 3 });",
        hint: 'Text with drop shadow — shadow:true, shadowColor, shadowBlur, shadowX, shadowY',
        tags: ['text', 'shadow'],
      },
      {
        label: 'text gradient',
        code: "canvas.text('GRADIENT', 100, 200, 72, '#fff', { gradient: ['#f0f', '#0ff', '#ff0'], weight: 'bold' });",
        hint: 'Text filled with vertical color gradient — gradient: array of CSS colors top→bottom',
        tags: ['text', 'gradient', 'color'],
      },
      {
        label: 'load font',
        code: "await canvas.loadFont('Orbitron', 'https://fonts.gstatic.com/s/orbitron/v31/yMJMMIlzdpvBhQQL_SC3X9yhF25-T1nyGy6BoWgz.woff2');\ncanvas.text('SPACE', 100, 200, 64, '#0ff', { font: 'Orbitron', weight: 'bold' });",
        hint: 'Load custom font by name + URL (FontFace API), then use with canvas.text({ font })',
        tags: ['font', 'text', 'custom'],
      },
      {
        label: 'arc / pie',
        code: "canvas.arc(x, y, r, 0, Math.PI, 'orange');",
        hint: 'Filled arc/pie slice — x, y, radius, startAngle, endAngle, color',
      },
      {
        label: 'arc stroke',
        code: "canvas.arcStroke(x, y, r, 0, Math.PI * 1.5, 'white', 4);",
        hint: 'Stroked arc — x, y, radius, start, end, color, thickness',
      },
      {
        label: 'image',
        code: "const img = await Media.image('https://example.com/photo.jpg');\ncanvas.image(img, x, y, w, h);",
        hint: 'Draw an image — load with Media.image(), then canvas.image(img, x, y, w?, h?)',
      },
      {
        label: 'backdrop (image/video underlay)',
        code: "canvas.backdrop('https://example.com/photo.jpg');\n// now draw on top:\ncanvas.circle(400, 300, 50, 'red');",
        hint: "canvas.backdrop(source) — renders an image, video, camera, or canvas on the layer below so all draw calls appear on top. Accepts a URL string, 'camera', HTMLImageElement, HTMLVideoElement, CameraStream, or any canvas/shader. Returns { stop(), layer }. stop() cancels a live video loop. Cleaned up automatically on reset.",
        tags: [
          'draw',
          'backdrop',
          'image',
          'video',
          'camera',
          'underlay',
          'overlay',
          'background',
          'trace',
          'annotate',
        ],
      },
      {
        label: 'backdrop — camera underlay',
        code: "const cam = await Camera.open();\ncanvas.backdrop(cam);\n\nsetInterval(() => {\n  // draw on top of live camera each frame\n  canvas.circle(\n    canvas.width/2 + Math.cos(Date.now()/500)*100,\n    canvas.height/2, 40, 'rgba(255,0,0,0.7)'\n  );\n}, 16);",
        hint: 'canvas.backdrop(cam) — live camera feed as a background layer. Use Camera.open() to get a CameraStream, then draw shapes/text on top.',
        tags: ['draw', 'backdrop', 'camera', 'live', 'ar', 'augmented', 'overlay'],
      },
      {
        label: 'alpha',
        code: "canvas.alpha(0.5);\ncanvas.circle(x, y, r, 'red');\ncanvas.alpha(1);",
        hint: 'Set global alpha (0–1) — affects all subsequent draw calls until changed',
      },
      {
        label: 'blend mode',
        code: "canvas.blend('screen');\ncanvas.circle(x, y, r, 'blue');\ncanvas.blend('source-over');",
        hint: 'Set composite blend mode — screen, multiply, add, overlay, etc.',
      },
      {
        label: 'save / restore',
        code: "canvas.push();\ncanvas.alpha(0.3);\ncanvas.translate(100, 100);\ncanvas.circle(0, 0, 50, 'white');\ncanvas.pop();",
        hint: 'push()/pop() save and restore all ctx state (alpha, blend, transform)',
      },
      {
        label: 'transform',
        code: "canvas.push();\ncanvas.translate(canvas.width/2, canvas.height/2);\ncanvas.rotate(Math.PI / 4);\ncanvas.rect(-50, -50, 100, 100, 'cyan');\ncanvas.pop();",
        hint: 'translate/rotate/scale — use push/pop to scope transforms',
      },
      {
        label: 'animate',
        code: "canvas.bg('#111');\nlet t = 0;\nsetInterval(() => {\n  canvas.clear();\n  canvas.bg('#111');\n  canvas.circle(canvas.width/2 + Math.cos(t)*200, canvas.height/2, 40, 'red');\n  t += 0.05;\n}, 16);",
        hint: 'Animation loop — clear each frame, update state, redraw',
      },
      {
        label: 'other layer',
        code: "canvas.at(2).rect(x, y, w, h, 'blue');",
        hint: 'canvas.at(z) targets a different z-layer canvas',
      },
      {
        label: 'reset state',
        code: 'canvas.reset();',
        hint: 'Reset alpha, blend, transform to defaults without clearing pixels',
      },
    ],
  },
  {
    name: 'Media',
    commands: [
      {
        label: 'image layer',
        code: "const layer = await Media.imageLayer('https://example.com/photo.jpg');\n// fit: 'cover' (default), 'contain', or 'stretch'",
        hint: 'Load image URL as full-canvas overlay. Awaitable.',
      },
      {
        label: 'load image',
        code: "const img = await Media.image('https://example.com/photo.jpg');\ncanvas.image(img, 0, 0);",
        hint: 'Load image URL — returns HTMLImageElement. Draw with canvas.image(img, x, y) or canvas.image(img, x, y, w, h).',
      },
      {
        label: 'video layer',
        code: "const vid = Media.video('https://example.com/clip.mp4');\nvid.play();",
        hint: 'Create a video layer — loops and muted by default.',
      },
      {
        label: 'video options',
        code: "const vid = Media.video('https://example.com/clip.mp4', { z: 15, opacity: 0.8, loop: true, muted: true });\nvid.play();",
        hint: 'Video with z-order, opacity, loop, and mute options',
      },
      {
        label: 'video controls',
        code: 'vid.pause();\nvid.stop();\nvid.seek(5);\nvid.mute(false);\nvid.opacity(0.5);',
        hint: 'Control video: pause, stop, seek(seconds), mute, opacity',
      },
      {
        label: 'image fit',
        code: "layer.fit('contain'); // 'cover', 'contain', or 'stretch'",
        hint: 'Change how image fills the canvas',
      },
      {
        label: 'video clip (time range)',
        code: "// Clip a video to a specific time range\nconst clip = Media.clip('https://example.com/long.mp4', 10, 20);\nclip.loop(true).play();\n// clip.el is the underlying <video> element\nconst win = wm.spawn('Clip', { type: 'video', src: '' });\n// Or use clip.el directly",
        hint: 'Media.clip(source, start, end) — wraps a video URL or element to play only [start, end] seconds. .play()/.pause()/.stop()/.seek(offset)/.loop(bool)/.mute(bool). .currentTime and .duration are clamp-relative.',
        tags: ['video', 'clip', 'trim', 'range'],
      },
    ],
  },
  {
    name: 'Shader',
    commands: [
      {
        label: 'hello shader',
        code: 'const s = new Shader(`\n  // pos = pixel coords (top-left origin)\n  // uv = pos / res (0..1)\n  // time = seconds, mouse = normalized 0..1, custom = vec4f\n  let col = vec3f(uv.x, uv.y, sin(time) * 0.5 + 0.5);\n  return vec4f(col, 1.0);\n`);\ns.start();',
        hint: 'Full-screen WebGPU shader. Write the fragment body — pos, uv, time, res, mouse, custom are pre-declared.',
      },
      {
        label: 'plasma',
        code: 'const s = new Shader(`\n  let x = uv.x * 6.28;\n  let y = uv.y * 6.28;\n  let r = sin(x + time) * 0.5 + 0.5;\n  let g = sin(y + time * 1.3) * 0.5 + 0.5;\n  let b = sin(x + y + time * 0.7) * 0.5 + 0.5;\n  return vec4f(r, g, b, 1.0);\n`);\ns.start();',
        hint: 'Classic plasma / color wave effect',
      },
      {
        label: 'set custom uniform',
        code: 's.set([1.0, 0.5, 0.0, 1.0]);',
        hint: 'Set the custom vec4f uniform — readable in shader as `custom.x .y .z .w`',
      },
      {
        label: 'set one channel',
        code: 's.set(0, 0.5);',
        hint: 'Set one channel of custom uniform by index (0=x, 1=y, 2=z, 3=w)',
      },
      {
        label: 'shader opacity',
        code: 's.opacity(0.5);',
        hint: 'Layer opacity 0–1',
      },
      {
        label: 'shader z-order',
        code: 's.z(25);',
        hint: 'CSS z-index — 20+ = above canvas, negative = behind camera',
      },
      {
        label: 'stop shader',
        code: 's.stop();',
        hint: 'Stop the render loop',
      },
      {
        label: 'mouse reactive',
        code: 'const s = new Shader(`\n  let d = distance(uv, mouse);\n  let ring = smoothstep(0.02, 0.0, abs(d - 0.1));\n  return vec4f(ring, ring * 0.5, 0.0, ring);\n`);\ns.start();',
        hint: 'Shader that reacts to mouse position',
      },
      {
        label: 'full WGSL',
        code: 'const s = new Shader(`\nstruct U { res: vec2f, mouse: vec2f, time: f32, _p1: f32, _p2: f32, _p3: f32, custom: vec4f }\n@group(0) @binding(0) var<uniform> u: U;\n@vertex fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {\n  var v = array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));\n  return vec4f(v[vi], 0.0, 1.0);\n}\n@fragment fn fs(@builtin(position) p: vec4f) -> @location(0) vec4f {\n  let uv = p.xy / u.res;\n  return vec4f(uv, sin(u.time)*0.5+0.5, 1.0);\n}\n`);\ns.start();',
        hint: 'Full WGSL — include @vertex and @fragment entrypoints yourself',
      },
      {
        label: 'video shader',
        code: "const vid = Media.video('https://example.com/clip.mp4');\nvid.play();\nconst s = new Shader(`\n  let col = textureSample(video, videoSampler, uv);\n  return vec4f(col.rgb, 1.0);\n`, { video: vid });\ns.start();",
        hint: 'Feed a video into a shader — `video` and `videoSampler` auto-declared. Sample with textureSample(video, videoSampler, uv).',
      },
      {
        label: 'preset shader',
        code: "ShaderFX.preset('plasma');",
        hint: 'Quick fullscreen preset. Presets: gradient, plasma, waves, circles, noise',
      },
      {
        label: 'video effect',
        code: "const vid = Media.video('https://example.com/clip.mp4');\nvid.play();\nShaderFX.video(vid, 'greyscale');",
        hint: 'Apply a shader effect to a video. Effects: greyscale, invert, channel_swap, posterize, scanlines',
      },
      {
        label: 'window shader',
        code: "ShaderFX.window('editor', 'greyscale');",
        hint: "Apply a shader effect to an IDE window. Windows: 'editor', 'console', 'canvas'. Effects: greyscale, invert, channel_swap, posterize, scanlines",
      },
      {
        label: 'shader — JS function',
        code: '// Write shaders as plain JS — no WGSL needed.\n// Params: { uv, time, custom, res, mouse } — destructure what you need.\n// vec2/vec3/vec4 constructors available. Math.sin/cos/abs/etc. → WGSL built-ins.\n// return [r, g, b, a]  →  vec4f automatically\nconst s = new Shader(({ uv, time }) => {\n  const r = Math.sin(uv.x * 10 + time) * 0.5 + 0.5;\n  const g = Math.cos(uv.y * 8  - time) * 0.5 + 0.5;\n  return [r, g, 0.5, 1.0];\n});\ns.start();',
        hint: 'new Shader(fn) — pass a JS arrow function instead of WGSL. Transpiled automatically. Supports: let/const, if/else, for/while, Math.*, vec2/3/4, ternary, helper functions (type from default params). return [r,g,b,a] → vec4f.',
      },
      {
        label: 'shader JS + video',
        code: '// col = video sample at current uv (vec4f with .r .g .b .a)\nconst cam = new Camera();\nawait cam.open();\nconst s = new Shader(({ uv, time, col }) => {\n  const grey = col.r * 0.299 + col.g * 0.587 + col.b * 0.114;\n  return [grey, grey * Math.abs(Math.sin(time)), grey * 0.5, 1.0];\n}, { video: cam });\ns.start();',
        hint: 'Destructure col to get the video/camera pixel at current uv. Pass video: in opts — any HTMLVideoElement, HTMLCanvasElement, or Camera instance.',
      },
      {
        label: 'shader JS + helper fns',
        code: '// Define helper functions — type params with default values as hints:\n//   r = 0.0 → f32,   c = vec2(0,0) → vec2f\nconst s = new Shader(({ uv, time }) => {\n  function circle(center = vec2(0, 0), p = vec2(0, 0), r = 0.0) {\n    return 1.0 - smoothstep(r - 0.01, r + 0.01, length(p - center));\n  }\n  const c = circle(vec2(0.5, 0.5), uv, 0.25 + Math.sin(time) * 0.1);\n  return [c, c * 0.4, c * 0.9, 1.0];\n});\ns.start();',
        hint: 'Inner function declarations become WGSL helper fns. Type each param with a default value: f32 params use 0.0, vec2f use vec2(0,0), vec3f use vec3(0,0,0), etc.',
      },
      {
        label: 'shader JS + audio reactive',
        code: '// custom.x/y/z/w filled by .bind(signal)\nconst sig = audio.signal(audio.master);\nconst s = new Shader(({ uv, time, custom }) => {\n  const bass = custom.x;      // 0–1 RMS of bound signal\n  const r = Math.sin(uv.x * 20 * (1.0 + bass * 5.0) + time) * 0.5 + 0.5;\n  return [r * bass, r * 0.3, 1.0 - r, 1.0];\n});\ns.bind(sig);\ns.start();',
        hint: 'Call .bind(audio.signal(...)) — fills custom.x=rms, custom.y=bass, custom.z=mid, custom.w=high each frame. Use custom.x/y/z/w in the JS shader fn.',
      },
      {
        label: 'capture window shader',
        code: "const s = new Shader(`\n  let col = textureSample(video, videoSampler, uv);\n  return vec4f(col.rgb, 1.0);\n`, { video: captureWindow('.CodeMirror') });\ns.start();",
        hint: 'Capture any DOM element as a live shader texture — pass a CSS selector or element. canvas/video elements pass through directly.',
      },
      {
        label: 'mic viz shader',
        code: "ShaderFX.micViz('invert');",
        hint: 'Apply a WebGPU shader effect to the mic visualizer. Enable mic in toolbar first. Effects: greyscale, invert, channel_swap, posterize, scanlines. Or use audio.micCanvas as video: source in a custom Shader.',
      },
      {
        label: 'mic canvas custom shader',
        code: 'const s = new Shader(`\n  let col = textureSample(video, videoSampler, uv);\n  let v = col.r;\n  return vec4f(v * 0.2, v, v * 0.8, 1.0);\n`, { video: audio.micCanvas });\ns.start();',
        hint: 'Use audio.micCanvas as a live texture input — samples the mic frequency bar visualization. Enable mic in toolbar first.',
      },
    ],
  },
  {
    name: 'Audio',
    commands: [
      {
        label: 'synth',
        code: "const s = audio.synth();\ns.play('C4', '8n');",
        hint: 'Basic monophonic synth — play(note, duration)',
      },
      {
        label: 'poly synth',
        code: "const p = audio.poly();\np.play(['C4', 'E4', 'G4'], '4n');",
        hint: 'Polyphonic synth — play chords with arrays of notes',
      },
      {
        label: 'fm synth',
        code: "const s = audio.fm();\ns.play('C4', '8n');",
        hint: 'FM synthesis — rich metallic/electric tones',
      },
      {
        label: 'pluck',
        code: "const s = audio.pluck();\ns.play('C4', '8n');",
        hint: 'Karplus-Strong plucked string synth',
      },
      {
        label: 'kick drum',
        code: "const k = audio.kick();\nk.play('C1', '8n');",
        hint: 'Membrane synth — good for kick/tom drums',
      },
      {
        label: 'metal',
        code: "const m = audio.metal();\nm.play('8n');",
        hint: 'Metallic synth for hi-hats and cymbals — no note arg needed',
      },
      {
        label: 'noise',
        code: "const n = audio.noise();\nn.play('8n');",
        hint: 'White noise synth — no note arg needed',
      },
      {
        label: 'reverb',
        code: 'const rev = audio.reverb(2);\nconst s = audio.synth();\ns.connect(rev);',
        hint: 'Reverb effect — reverb(decay seconds). Connect instrument to it.',
      },
      {
        label: 'delay',
        code: 'const del = audio.delay(0.25, 0.5);\nconst s = audio.synth();\ns.connect(del);',
        hint: 'Feedback delay — delay(time, feedback 0–1)',
      },
      {
        label: 'distort',
        code: 'const dist = audio.distort(0.8);\nconst s = audio.synth();\ns.connect(dist);',
        hint: 'Distortion effect — distort(amount 0–1)',
      },
      {
        label: 'filter',
        code: "const filt = audio.filter('lowpass', 800);\nconst s = audio.synth();\ns.connect(filt);",
        hint: 'filter(type, freq, Q) — types: lowpass, highpass, bandpass, notch',
      },
      {
        label: 'auto filter',
        code: 'const af = audio.autoFilter(0.5);\nconst s = audio.fm();\ns.connect(af);',
        hint: 'autoFilter(rate Hz) — LFO-driven filter sweep',
      },
      {
        label: 'lfo',
        code: "const s = audio.synth();\nconst l = audio.lfo(2, 200, 2000);\nl.connect(s._.frequency);\nconst seq = audio.loop(time => s.play('C4', '8n', time), '4n');\nseq.start(0);\naudio.start();",
        hint: 'lfo(freq, min, max) — connects to any Tone signal param: s._.frequency, s._.volume, etc.',
      },
      {
        label: 'vibrato',
        code: 'const vib = audio.vibrato(5, 0.2);\nconst s = audio.fm();\ns.connect(vib);',
        hint: 'vibrato(freq Hz, depth 0–1) — pitch wobble',
      },
      {
        label: 'tremolo',
        code: 'const trem = audio.tremolo(8, 0.5);\nconst s = audio.synth();\ns.connect(trem);',
        hint: 'tremolo(freq Hz, depth 0–1) — volume wobble',
      },
      {
        label: 'compressor',
        code: 'const comp = audio.compressor(-24, 12);\nconst s = audio.synth();\ns.connect(comp);',
        hint: 'compressor(threshold dB, ratio) — dynamic range control',
      },
      {
        label: 'eq',
        code: 'const eq = audio.eq(3, 0, -6);\nconst s = audio.fm();\ns.connect(eq);',
        hint: 'eq(low, mid, high) — 3-band EQ in dB',
      },
      {
        label: 'phaser',
        code: 'const ph = audio.phaser(0.5, 3);\nconst s = audio.fm();\ns.connect(ph);',
        hint: 'phaser(rate Hz, octaves) — classic phase shift',
      },
      {
        label: 'wah',
        code: 'const wah = audio.wah(350);\nconst s = audio.fm();\ns.connect(wah);',
        hint: 'wah(baseFreq) — auto-wah envelope filter',
      },
      {
        label: 'pitch shift',
        code: 'const ps = audio.pitchShift(7);\nconst s = audio.pluck();\ns.connect(ps);',
        hint: 'pitchShift(semitones) — shift pitch up/down without changing speed',
      },
      {
        label: 'chain effects',
        code: 'const rev = audio.reverb(2);\nconst del = audio.delay(0.25, 0.3);\nconst s = audio.fm();\ns.chain(del, rev);',
        hint: 'chain(...effects) — route instrument through multiple effects in series to output',
      },
      {
        label: 'sequence',
        code: "const s = audio.synth();\nconst seq = audio.sequence(['C4','E4','G4','E4'], '8n', (note, time) => {\n  s.play(note, '8n', time);\n});\nseq.start(0);\naudio.bpm(120);\naudio.start();",
        hint: 'Step sequencer — sequence(notes, subdivision, callback). Call seq.start(0) then audio.start().',
      },
      {
        label: 'loop',
        code: "const s = audio.synth();\nconst l = audio.loop((time) => {\n  s.play('C4', '8n', time);\n}, '4n');\nl.start(0);\naudio.start();",
        hint: 'Repeat callback every interval — loop(fn, interval). Call l.start(0) then audio.start().',
      },
      {
        label: 'set bpm',
        code: 'audio.bpm(120);',
        hint: 'Set transport tempo in BPM',
      },
      {
        label: 'start transport',
        code: 'audio.start();',
        hint: 'Start the transport clock — needed for sequence() and loop()',
      },
      {
        label: 'master volume',
        code: 'audio.volume(-6);',
        hint: 'Set master output volume in dB (0 = unity, -6 = quieter)',
      },
      {
        label: 'load audio file',
        code: "const file = audio.load('https://example.com/sound.mp3');\nawait file.ready;\nfile.play();",
        hint: 'Load a remote audio file and play it. await file.ready before play() to ensure the buffer is loaded.',
      },
      {
        label: 'upload audio file',
        code: 'const file = await audio.upload();\nif (file) { await file.ready; file.play(); }',
        hint: 'Open a file picker and load the chosen audio file. Returns null if cancelled.',
      },
      {
        label: 'audio FX chain',
        code: "const file = audio.load('https://example.com/sound.mp3');\nawait file.ready;\nfile.filter('lowpass', 800).reverb(2).volume(-6).play();",
        hint: 'Chain effects on a loaded file: .filter(type, freq, Q), .reverb(decay), .eq(lo,mid,hi), .delay(time, feedback), .pitchShift(semitones)',
      },
      {
        label: 'audio.onTime callback',
        code: "const file = audio.load('https://example.com/sound.mp3');\nawait file.ready;\nfile.onTime(5, () => canvas.bg('red'));\nfile.onTime(10, () => canvas.bg('blue'));\nfile.play();",
        hint: 'Fire callbacks at specific timestamps during playback (seconds). Resets on file.stop().',
      },
      {
        label: 'seek + loop',
        code: "const file = audio.load('https://example.com/sound.mp3');\nawait file.ready;\nfile.loop(true).seek(30).play();\n// file.pause();  file.stop();  file.currentTime",
        hint: 'Seek to a position (seconds), enable looping, pause/stop, read currentTime and duration.',
      },
    ],
  },
  {
    name: 'Audio→Visual',
    commands: [
      {
        label: 'beat → CA step',
        code: `const W = 64;
let cells = Array.from({length: W}, () => Math.random() > 0.6 ? 1 : 0);

function stepCA(c) {
  return c.map((_, i) => {
    const l = c[(i - 1 + W) % W], r = c[(i + 1) % W];
    return (c[i] + l + r) % 2; // XOR rule — try other combos
  });
}
function drawCA(c) {
  const bw = canvas.width / W;
  canvas.clear();
  c.forEach((v, i) => canvas.rect(i * bw, 0, bw, canvas.height, v ? '#fff' : '#111'));
}

note("c1 ~ c1 ~ c1 ~ c1 c1").play();
setcps(0.5);
on('beat:tick').do(() => {        // Tone transport tick — Strudel is locked to it
  cells = stepCA(cells);
  drawCA(cells);
});`,
        hint: 'Each kick advances a 1D cellular automaton one generation. Audio is the clock — visuals evolve independently.',
      },
      {
        label: 'note → palette swap',
        code: `const palettes = [
  ['#ff0040','#ff6600','#ffcc00'],
  ['#00ffcc','#0066ff','#cc00ff'],
  ['#ffffff','#aaaaaa','#333333'],
  ['#ff00ff','#00ff00','#0000ff'],
];
let pal = palettes[0];
let particles = Array.from({length: 40}, () => ({
  x: Math.random(), y: Math.random(),
  vx: (Math.random()-0.5)*0.005, vy: (Math.random()-0.5)*0.005,
}));

setInterval(() => {
  canvas.alpha(0.15).bg('#000').alpha(1);
  particles.forEach((p, i) => {
    p.x = (p.x + p.vx + 1) % 1;
    p.y = (p.y + p.vy + 1) % 1;
    canvas.circle(p.x * canvas.width, p.y * canvas.height, 4, pal[i % pal.length]);
  });
}, 16);

note("c4 eb4 g4 bb4 d5").play();
setcps(0.5);
let pi = 0;
on('beat:tick').do(() => { pal = palettes[pi++ % palettes.length]; }); // beat selects palette`,
        hint: 'Each note value selects a color palette. Audio drives visual state transitions — not a visualizer, a shared index.',
      },
      {
        label: 'amplitude → gravity',
        code: `const sig = audio.fft; // master amplitude — captures Strudel via the shared context

let balls = Array.from({length: 20}, () => ({
  x: Math.random(), y: Math.random() * 0.5,
  vx: (Math.random()-0.5) * 0.01, vy: 0,
}));

setInterval(() => {
  const amp = sig.value; // 0..1
  const gravity = amp * 0.004; // loud = strong pull

  canvas.alpha(0.2).bg('#000').alpha(1);
  balls.forEach(b => {
    b.vy += gravity;
    b.x = (b.x + b.vx + 1) % 1;
    b.y += b.vy;
    if (b.y > 1) { b.y = 0; b.vy = 0; } // wrap top
    canvas.circle(b.x * canvas.width, b.y * canvas.height, 6, \`hsl(\${b.x * 360}, 80%, 60%)\`);
  });
}, 16);

note("c3 g3 e3 bb3 d4").fast(1.5).play();
setcps(0.5);`,
        hint: 'RMS amplitude becomes gravitational force in a particle sim. Loud → balls fall faster. Nothing draws audio — amplitude perturbs physics.',
      },
      {
        label: 'note pitch → shader',
        code: `const s = new Shader(\`
  let pulse = custom.x;      // amplitude (0..1)
  let hueShift = custom.y;   // mapped from pitch
  let d = distance(uv, vec2f(0.5));
  let ring = sin(d * 20.0 - time * 3.0 + pulse * 10.0) * 0.5 + 0.5;
  let h = hueShift + ring * 0.3;
  let col = vec3f(
    sin(h * 6.28) * 0.5 + 0.5,
    sin(h * 6.28 + 2.09) * 0.5 + 0.5,
    sin(h * 6.28 + 4.19) * 0.5 + 0.5
  );
  return vec4f(col * ring, 1.0);
\`);
s.start();

note("c3 e3 g3 bb3 d4 f4").play();
setcps(0.5);

const sig = audio.fft; // master signal — captures Strudel via the shared context
setInterval(() => {
  s.set(sig.value, sig.high ?? 0.3); // amplitude → ring distortion, spectral high → hue
}, 16);`,
        hint: 'Pitch maps to shader hue, amplitude maps to ring distortion. Shader has its own visual logic — audio is just two input parameters.',
      },
      {
        label: 'meter → blur',
        code: `const layer = canvas.fx(0);
const sig = audio.fft; // master amplitude — captures Strudel via the shared context

let angle = 0;
setInterval(() => {
  canvas.clear();
  canvas.push();
  canvas.translate(canvas.width/2, canvas.height/2).rotate(angle);
  for (let i = 0; i < 6; i++) {
    canvas.push().rotate(i * Math.PI / 3).rect(20, -4, 80, 8, \`hsl(\${i*60}, 70%, 60%)\`).pop();
  }
  canvas.pop();
  angle += 0.01;

  layer.blur(sig.value * 20); // loud = blurry
}, 16);

note("<c3 c4> e4 g4 <bb3 b3>").slow(2).play();
setcps(0.5);`,
        hint: "Amplitude drives CSS blur on the canvas layer. Loud moments go soft-focus. Audio influences visual *quality*, not what's drawn.",
      },
      {
        label: 'mic → visual',
        code: "const mic = await audio.mic();\nconst meter = audio.meter();\nmic.connect(meter);\n\nlet radius = 10;\nsetInterval(() => {\n  const db = meter.getValue();\n  const amp = isFinite(db) ? Math.pow(10, db / 20) : 0;\n  radius = radius * 0.85 + amp * 300 * 0.15; // smoothed\n  canvas.alpha(0.15).bg('#000').alpha(1);\n  canvas.circle(canvas.width/2, canvas.height/2, Math.max(4, radius), `hsl(${amp * 200}, 80%, 60%)`);\n}, 16);",
        hint: 'Mic amplitude drives a pulsing circle — loud = big and saturated. Replace the drawing with anything: particles, shader uniforms, layer blur.',
      },
      {
        label: 'synth visualizer (bars)',
        code: "const synth = audio.fm();\nconst viz = audio.viz(synth).start();\n\nsynth.play('C3', '2n');\nsetInterval(() => synth.play('C3', '2n'), 2000);",
        hint: 'audio.viz(source) creates an AudioViz — draws frequency bars full-screen. source can be any Instrument or Tone node. Modes: bars, wave, ring.',
      },
      {
        label: 'visualizer modes',
        code: "const synth = audio.synth();\nconst viz = audio.viz(synth, { mode: 'wave', bins: 256, z: 5, opacity: 0.85 }).start();\n// modes: 'bars' (FFT spectrum), 'wave' (waveform), 'ring' (circular waveform)\n// viz.mode('ring')  — switch mode live\n// viz.color(120)    — hue override (degrees)\n// viz.opacity(0.5)\n// viz.stop()\n\nsetInterval(() => synth.play('E4', '8n'), 500);",
        hint: "AudioViz modes — bars=FFT spectrum, wave=waveform line, ring=circular waveform. Switch mode live with viz.mode('ring'). viz.canvas is a live canvas for shader use.",
      },
      {
        label: 'visualizer + shader (fn)',
        code: "const synth = audio.pluck();\nconst viz = audio.viz(synth, { mode: 'bars' }).start();\n\n// Pass a JS function — auto-converts to WebGPU shader\n// v = frequency value 0-1, t = time\nviz.shader((v, t) => [v * Math.sin(t), v * 0.3, 1.0 - v, 1.0]);\n\nconst notes = ['C3','E3','G3','B3','C4','E4','G4'];\nsetInterval(() => synth.play(notes[Math.floor(Math.random()*notes.length)], '8n'), 300);",
        hint: 'viz.shader(fn) converts a JS arrow function to WGSL automatically. (v) = frequency 0-1, (v, t) also gets time. Must return [r, g, b, a]. Math.sin/cos/abs/min/max/floor/sqrt/pow work. Use float literals (1.0 not 1).',
      },
      {
        label: 'visualizer + shader (preset)',
        code: "const synth = audio.fm();\nconst viz = audio.viz(synth, { mode: 'ring', bins: 128 }).start();\n\n// Named presets: thermal, cool, rainbow, mono, neon\nviz.shader('rainbow');\n\nsetInterval(() => synth.play('C3', '2n'), 2000);",
        hint: "viz.shader('preset') — built-in palettes: thermal, cool, rainbow, mono, neon. AudioViz.presets lists all names.",
      },
      {
        label: 'audio.signal → shader bind',
        code: "const synth = audio.fm();\nconst sig = audio.signal(synth);\n// sig.value=overall rms  sig.bass/mid/high=band averages  sig.fft=Float32Array\n\nconst s = new Shader(`\n  let amp = custom.x;  // rms\n  let bass = custom.y;\n  let mid  = custom.z;\n  let high = custom.w;\n  return vec4f(bass, mid * 0.5, high * 2.0, 1.0);\n`).bind(sig).start();\n\nsetInterval(() => synth.play('C3', '4n'), 500);\naudio.start();",
        hint: "audio.signal(source) → live {value, bass, mid, high, fft} object. shader.bind(sig) auto-fills custom=[rms,bass,mid,high] every frame. source can be any Tone node, Tone.Analyser, Web Audio AnalyserNode, or 'mic'.",
      },
      {
        label: 'audio.signal → stream (RAF push)',
        code: "const synth = audio.fm();\nconst sig = audio.signal(synth);\n\n// .stream() fires fn every frame — no setInterval needed\nsig.stream(s => {\n  canvas.clear();\n  canvas.circle(800, 450, s.bass * 400, `hsl(${s.high * 360}, 80%, 50%)`);\n  canvas.rect(0, 450 - s.mid * 200, 1600, 4, 'cyan');\n});\n\nsetInterval(() => synth.play('C3', '4n'), 500);\naudio.start();",
        hint: 'sig.stream(fn) — RAF-driven push, fn(sig) called every frame. Cleaned up automatically on stop. No polling loop needed. Chainable: audio.signal(src).stream(fn).',
      },
      {
        label: 'audio.signal → mic bind',
        code: "// Make sure mic toggle is on in the toolbar\nconst sig = audio.signal('mic');\n\nconst s = new Shader(`\n  let amp = custom.x; // mic rms\n  let r = sin(uv.x * 10.0 + time) * amp;\n  return vec4f(amp, r, custom.z, 1.0);\n`).bind(sig).start();",
        hint: "Pass 'mic' as source to audio.signal() or audio.fftCanvas() — reads from the harness mic analyser. Enable mic with the toolbar toggle first.",
      },
      {
        label: 'audio.fftCanvas → shader texture',
        code: "const synth = audio.pluck();\n// fftCanvas: bins×1 canvas, R channel = FFT magnitude 0-1\n// uv.x in shader addresses frequency (0=bass, 1=treble)\nconst fftTex = audio.fftCanvas(synth, 256);\n\nconst s = new Shader(`\n  let amp = textureSample(video, videoSampler, vec2f(uv.x, 0.5)).r;\n  return vec4f(amp * 2.0, amp * uv.y, 1.0 - amp, 1.0);\n`, { video: fftTex }).start();\n\nconst notes = ['C3','E3','G3','B3','C4'];\nsetInterval(() => synth.play(notes[Math.floor(Math.random()*notes.length)], '8n'), 300);\naudio.start();",
        hint: "audio.fftCanvas(source, bins) returns a live bins×1 canvas. Feed it as video: to any Shader. Sample with uv.x (0=bass, 1=treble). Source can be Tone node, 'mic', or Tone.Analyser.",
      },
      {
        label: 'audio.fftCanvas → mic texture',
        code: "// Make sure mic toggle is on\nconst fftTex = audio.fftCanvas('mic', 256);\n\nconst s = new Shader(`\n  let amp = textureSample(video, videoSampler, vec2f(uv.x, 0.5)).r;\n  let glow = amp * amp * 3.0;\n  return vec4f(glow, glow * 0.3, glow * 0.1, 1.0);\n`, { video: fftTex }).start();",
        hint: "audio.fftCanvas('mic') reads the harness mic analyser directly into a texture — full spectrum, no Tone nodes needed.",
      },
      {
        label: 'audio.fft signal (master)',
        code: '// audio.fft taps the master output — no source needed\nconst s = new Shader(({ uv, time, custom }) => {\n  const bass = custom.x;\n  const high = custom.w;\n  return [uv.x * bass * 3.0, uv.y * 0.5, high * 2.0, 1.0];\n});\ns.bind(audio.fft);\ns.start();',
        hint: 'audio.fft is a master-output signal: { value, bass, mid, high, fft }. Taps Tone.Destination automatically. Use .bind(audio.fft) on a Shader to fill custom.x/y/z/w each frame.',
      },
      {
        label: 'audio.spectrogram',
        code: "const synth = audio.fm();\nconst spec = audio.spectrogram(synth, { bins: 256, width: 512, height: 256, palette: 'rainbow' });\ndocument.getElementById('canvasWrapper')?.appendChild(spec.canvas);\nObject.assign(spec.canvas.style, { position:'absolute', top:'0', left:'0', width:'100%', height:'100%' });\n\nsetInterval(() => synth.play('C3', '4n'), 500);\naudio.start();",
        hint: "audio.spectrogram(source, opts) → SpectrogramCanvas — scrolling frequency/time map. Palettes: rainbow, thermal, cool, mono. .canvas gives the live HTMLCanvasElement. source: Tone node, 'mic', or signal object.",
      },
      {
        label: 'audio.pianoRoll',
        code: "const synth = audio.poly();\nconst roll = audio.pianoRoll({ z: 15, speed: 80 });\n\nconst notes = ['C4','D4','E4','G4','A4','C5'];\nsetInterval(() => {\n  const note = notes[Math.floor(Math.random() * notes.length)];\n  synth.play([note, 'G3'], '8n');\n}, 400);\naudio.start();",
        hint: 'audio.pianoRoll() spawns a canvas overlay showing falling note blocks for every Instrument.play() call. opts: { z, opacity, speed (px/s), midiMin, midiMax }.',
      },
      {
        label: 'mixer.show',
        code: 'n("0 3 5 7").scale("C:minor").play();\n\nmixer.show();\n// All Strudel sound arrives on the \'Strudel\' strip (ADR 035):\nmixer.strip(\'Strudel\').volume(-6).pan(-0.3);\nmixer.master.volume(-2);',
        hint: 'mixer.show() opens the live audio console. Every running instrument/window/mic gets a Strip (volume/pan/mute/solo + VU + 4-band EQ). Script it: mixer.strip(name).volume(dB).pan(-1..1).mute().solo().eq(bands); mixer.master.volume(dB); mixer.add(node, {name}).',
      },
      {
        label: 'audio.drumpad',
        code: "const dp = audio.drumpad({ title: 'Drum Pad', w: 500, h: 360 });\n// Click pads or press q/w/e/r/a/s/d/f\n// Toggle steps in the sequencer, then hit ▶ Play\n// Programmatic control:\n// dp.bpm(128)\n// dp.pattern(0, 'x . . x x . . .') // kick\n// dp.pattern(1, '. . x . . . x .') // snare",
        hint: "audio.drumpad(opts) — 8-pad drum machine with 16-step sequencer. Pads: Kick/Snare/HH-Cl/HH-Op/Clap/Tom-L/Tom-H/Cymbal. Keys: q w e r / a s d f. Methods: .bpm(n), .step(vi,si,bool), .pattern(vi, 'x . . x'). Events: .onHit(fn), .onPad(voice,fn), .onStep(fn), .signal(voice?,{decay?})→sig.",
        tags: ['drum', 'beat', 'sequencer', 'percussion'],
      },
      {
        label: 'dp.onPad — react to a specific drum',
        code: "const dp = audio.drumpad();\ndp.onPad('kick', ({ source }) => {\n  canvas.circle(400, 225, 80, 'red');\n  setTimeout(() => canvas.clear(), 80);\n});\n// voice = index 0-7 or name: 'kick','snare','hhc','hho','clap','tomL','tomH','cym'",
        hint: "dp.onPad(voice, fn) — fire fn({vi,id,label,source,step}) only for one pad. source: 'pad'|'key'|'seq'. Returns dp.",
        tags: ['drum', 'event', 'hook', 'reactive', 'onPad'],
      },
      {
        label: 'dp.onHit — any pad hit',
        code: "const dp = audio.drumpad();\ndp.onHit(({ label, source }) => {\n  console.log(label, 'hit via', source);\n});",
        hint: 'dp.onHit(fn) — fire fn({vi,id,label,source,step}) on any pad hit. Returns dp.',
        tags: ['drum', 'event', 'hook', 'onHit'],
      },
      {
        label: 'dp.onStep — sequencer clock',
        code: 'const dp = audio.drumpad();\ndp.onStep(({ step, activeVoices }) => {\n  canvas.bg(`hsl(${step * 22},60%,10%)`);\n});\n// fires once per sequencer step (0-15) while playing',
        hint: 'dp.onStep(fn) — fire fn({step,activeVoices:[vi…]}) once per sequencer step while playing.',
        tags: ['drum', 'sequencer', 'step', 'clock', 'onStep'],
      },
      {
        label: 'dp.signal — decaying-pulse visual',
        code: "const dp = audio.drumpad();\nconst sig = dp.signal('kick', { decay: 300 }); // 0-1, decays after each hit\n\nconst s = new GLShader(`\n  void main() {\n    float v = custom.x;\n    gl_FragColor = vec4(v, v*0.2, 0.0, 1.0);\n  }\n`);\ns.start();\n\ndp.pattern(0, 'x . . x x . . .'); // kick\nsetInterval(() => s.set(sig.value, 0, 0, 0), 16);",
        hint: 'dp.signal(voice?,{decay?}) → {value,stream(fn),onHit(fn)}. value=1 on hit, decays to 0. voice = index or name, omit for any pad.',
        tags: ['drum', 'signal', 'reactive', 'shader', 'visual', 'decay'],
      },
      {
        label: 'dp.swing / accent / steps — groovebox (P3)',
        code: "const dp = audio.drumpad({ steps: 32, pads: 4 }); // 32 steps, 4 pads\ndp.swing(0.4);                 // 0-1 swing feel\ndp.pattern(0, 'x . . x');      // kick\ndp.step(0, 4, true, 0.33);     // step 4 on, soft accent (velocity 0-1)\ndp.accent(0, 8, 0.66);         // set a step's accent without toggling\n// In the UI: shift-click a step to cycle its accent.",
        hint: 'dp.swing(0-1) global swing; dp.step(vi, s, on, vel?) toggles with optional velocity; dp.accent(vi, s, vel) sets a step accent. Constructor: {steps} (default 16), {pads} (1-8), {swing}. Per-step velocity drives loudness + the onHit payload.',
        tags: ['drum', 'swing', 'accent', 'velocity', 'steps', 'groovebox'],
      },
      {
        label: 'dp.bind — play your own Voice on a pad',
        code: "const dp = audio.drumpad();\nVoice.define('Wub', { engine: 'mono', opts: { oscillator: { type: 'sawtooth' } }, effects: [{ type: 'filter', frequency: 400 }] });\ndp.bind('kick', 'Wub');        // replace the kick synth with your voice\n// dp.bind(0, { engine: 'fm' }); // or an inline descriptor\n// dp.unbind('kick');            // revert to the default drum synth",
        hint: "dp.bind(pad, voiceNameOrDesc) — replace a pad's default drum synth with a custom Voice (ADR 046). pad = index 0-7 or name. The voice is embedded inline and travels with the project. dp.unbind(pad) reverts.",
        tags: ['drum', 'voice', 'bind', 'synth', 'custom', 'design'],
      },
      {
        label: 'dp.bindAction — fire an event from a pad',
        code: "const dp = audio.drumpad();\ndp.bindAction('clap', 'drop', { silent: false }); // fire 'drop' on every clap hit\non('drop').do(({ velocity }) => {\n  canvas.bg('white');\n  setTimeout(() => canvas.clear(), 60);\n});\n// { silent: true } → pad fires the event but makes no sound",
        hint: "dp.bindAction(pad, event, {silent?}) — fire a named bus event when a pad is struck (ADR 046). React with on(event).do(fn). silent:true suppresses the pad's own sound (controller-only pad).",
        tags: ['drum', 'action', 'event', 'bind', 'controller', 'soundboard'],
      },
      {
        label: 'file.waveform',
        code: "const file = audio.load('https://example.com/sound.mp3');\nawait file.ready;\nconst wv = file.waveform({ width: 640, height: 80 });\ndocument.getElementById('canvasWrapper')?.appendChild(wv);\nObject.assign(wv.style, { position:'absolute', bottom:'10px', left:'50%', transform:'translateX(-50%)' });\nfile.loop(true).play();",
        hint: 'file.waveform(opts) → canvas with static waveform + live playhead. Click to seek. opts: { width, height, color, bg }.',
      },
    ],
  },
  {
    name: 'Piano',
    commands: [
      {
        label: 'audio.piano',
        code: "const p = audio.piano({ title: 'Piano', preset: 'electric' });\n// Click keys or press a/s/d/f/g/h/j/k (white) w/e/t/y/u (black)\n// z/x shift octave down/up\n// Select a step button then click keys to build chords\n// p.bpm(120)\n// p.note(0, 'C4', true) // toggle note in sequencer step",
        hint: 'audio.piano(opts) — polyphonic piano widget with chord sequencer and synth presets. Presets: electric, grand, organ, pluck, pad, bass. Keys: a s d f g h j k (white), w e t y u (black). z/x = octave shift. Events: onNote, onKey, onStep, signal.',
        tags: ['piano', 'keys', 'keyboard', 'melody', 'chord', 'polyphonic'],
      },
      {
        label: 'piano.onNote — react to any key',
        code: "const p = audio.piano();\np.onNote(({ note, midi, source }) => {\n  canvas.circle(midi * 12, 225, 40, `hsl(${midi * 3}, 80%, 50%)`);\n  setTimeout(() => canvas.clear(), 100);\n});\n// source: 'mouse' | 'kbd' | 'seq'",
        hint: "p.onNote(fn) — fn({note, midi, velocity, source, step}) on any note. source: 'mouse'|'kbd'|'seq'. Returns p.",
        tags: ['piano', 'event', 'hook', 'reactive', 'onNote'],
      },
      {
        label: 'piano.onKey — react to specific note',
        code: "const p = audio.piano();\np.onKey('C4', ({ source }) => {\n  canvas.circle(400, 225, 100, 'cyan');\n  setTimeout(() => canvas.clear(), 80);\n});",
        hint: "p.onKey(note, fn) — fn({note, midi, velocity, source, step}) scoped to one note string like 'C4'. Returns p.",
        tags: ['piano', 'event', 'hook', 'onKey'],
      },
      {
        label: 'piano.onStep — sequencer clock',
        code: "const p = audio.piano();\np.onStep(({ step, notes }) => {\n  canvas.bg(`hsl(${step * 22}, 60%, 10%)`);\n  console.log('step', step, notes);\n});\n// fires once per sequencer step (0-15) while playing",
        hint: "p.onStep(fn) — fn({step, notes:['C4','E4']}) once per sequencer step while playing.",
        tags: ['piano', 'sequencer', 'step', 'clock', 'onStep'],
      },
      {
        label: 'piano.signal — decaying-pulse visual',
        code: "const p = audio.piano();\nconst sig = p.signal('C4', { decay: 400 }); // 0-1 pulse on C4\n\nconst s = new GLShader(`\n  void main() {\n    float v = custom.x;\n    gl_FragColor = vec4(v * 0.2, v, v * 0.8, 1.0);\n  }\n`);\ns.start();\nsetInterval(() => s.set(sig.value, 0, 0, 0), 16);",
        hint: 'p.signal(note?, {decay?}) → {value, stream(fn)}. value=1 on hit, decays to 0. Omit note for any key.',
        tags: ['piano', 'signal', 'reactive', 'shader', 'visual', 'decay'],
      },
      {
        label: 'piano.bind / voice — custom sounds per key (ADR 046)',
        code: "const p = audio.piano();\np.voice({ engine: 'mono', opts: { oscillator: { type: 'sawtooth' } } }); // whole-keyboard voice\np.bind('C4', { kind: 'sample', mode: 'chromatic', url: 'vox.wav', baseNote: 'C4' }); // one key = a sample\np.bindAction('C2', 'drop', { silent: true }); // low key fires an event, no note\non('drop').do(() => canvas.bg('white'));",
        hint: 'p.voice(nameOrDesc) sets the whole-keyboard Voice (live play); p.bind(note, voice) overrides one key with a Voice/sample; p.bindAction(note, event, {silent}) fires a bus event on a key. p.unbind(note) reverts. The step sequencer keeps using the preset.',
        tags: ['piano', 'bind', 'voice', 'sample', 'action', 'override', 'key'],
      },
      {
        label: 'Piano.define — custom preset',
        code: "Piano.define('theremin', {\n  synth: { type: 'basic', opts: { oscillator: { type: 'sine' }, envelope: { attack: 0.1, decay: 0, sustain: 1, release: 0.3 } } },\n  effects: [{ type: 'reverb', decay: 2, wet: 0.4 }, { type: 'chorus', wet: 0.3 }],\n});\nconst p = audio.piano({ preset: 'theremin' });",
        hint: "Piano.define(name, {synth, effects}) — register a named preset. synth.type: 'FM'|'AM'|'basic'. effects: [{type:'reverb'|'chorus'|'delay'|'distortion'|'compressor', ...opts}].",
        tags: ['piano', 'preset', 'define', 'synth', 'effects'],
      },
    ],
  },
  {
    name: 'Launchpad',
    commands: [
      {
        label: 'audio.launchpad — live soundboard grid',
        code: "const lp = audio.launchpad({ title: 'Launchpad', rows: 8, cols: 8 });\n// Click cells to play. Unbound cells play a default voice at a per-cell pitch.\n// Map your own sounds/actions:\n// lp.bind(0, 'Bass');               // a saved Voice on cell 0\n// lp.bind('2,3', { engine: 'fm' }); // inline voice at row2,col3\n// lp.bindAction('7,7', 'drop');     // fire bus event 'drop' on strike",
        hint: "audio.launchpad({rows,cols,baseNote,voice}) — configurable live pad grid (ADR 047). Map each cell to a Voice (lp.bind) or a named bus Action (lp.bindAction). No sequencer (that's the Drum Pad); live play captures into a Take. Joins the MIDI Target rotation (input).",
        tags: ['launchpad', 'soundboard', 'pad', 'grid', 'sampler', 'controller'],
      },
      {
        label: 'lp.bind — map a Voice to a cell',
        code: "const lp = audio.launchpad({ rows: 4, cols: 4 });\nVoice.define('Stab', { engine: 'fm', effects: [{ type: 'reverb', wet: 0.3 }] });\nlp.bind(0, 'Stab');\nlp.bind('1,1', { kind: 'sample', mode: 'chopped', url: 'break.wav', slices: 16 }); // cell plays its slice\n// lp.voice({ engine: 'am' }); // default voice for unbound cells\n// lp.unbind(0);",
        hint: 'lp.bind(cell, voiceNameOrDesc) — bind a cell (index or "r,c") to a Voice. A chopped Sample Voice plays the slice matching the cell index. lp.voice(desc) sets the default for unbound cells. lp.unbind(cell) clears.',
        tags: ['launchpad', 'bind', 'voice', 'sample', 'chop', 'map'],
      },
      {
        label: 'lp.bindAction + onHit — controller',
        code: "const lp = audio.launchpad({ rows: 4, cols: 4 });\nlp.bindAction(0, 'boom', { silent: true }); // silent: fires event, no sound\non('boom').do(() => canvas.bg('white'));\n\nlp.onHit(({ cell, row, col, velocity }) => {\n  console.log('cell', cell, row, col);\n});",
        hint: 'lp.bindAction(cell, event, {silent?}) — fire a named bus event on strike (silent suppresses sound). lp.onHit(fn) → fn({cell,row,col,source,velocity}); lp.onCell(cell, fn) scoped; lp.signal(cell?,{decay?}) decaying-pulse.',
        tags: ['launchpad', 'action', 'event', 'onHit', 'signal', 'controller'],
      },
    ],
  },
  {
    name: 'Voices',
    commands: [
      {
        label: 'Voice.define — design a reusable synth',
        code: "Voice.define('Bass', {\n  engine: 'mono', // fm|am|basic|mono|duo|pluck|membrane|metal|noise\n  poly: false,\n  opts: { oscillator: { type: 'sawtooth' } },\n  effects: [{ type: 'filter', frequency: 600 }, { type: 'distortion', distortion: 0.2 }],\n});\n// Reuse on any Piano / Drumpad / Launchpad, or play directly:\nconst v = Voice.make('Bass');\nv.output.toDestination();\nv.trigger('C2', '8n');",
        hint: "Voice.define(name, {engine, poly?, opts?, effects?}) — register a reusable Voice (ADR 046). engine: fm|am|basic|mono|duo|pluck|membrane|metal|noise. effects: [{type:'reverb'|'chorus'|'delay'|'distortion'|'filter'|'compressor', ...}]. Embeds inline in bindings; portable.",
        tags: ['voice', 'synth', 'define', 'instrument', 'design'],
      },
      {
        label: 'Voice.design — open the Synth Designer (no-code)',
        code: "Voice.design();              // blank FM voice\n// Voice.design('Bass');     // edit an existing voice\n// Pick engine, tweak ADSR + oscillator, add effects, name it, Save.\n// Saved voices are reusable on any Piano / Drumpad / Launchpad.",
        hint: 'Voice.design(seed?) — open the visual Synth Designer panel. seed = a voice name or descriptor to start from. Save writes into the Voice registry.',
        tags: ['voice', 'synth', 'design', 'designer', 'panel', 'no-code'],
      },
      {
        label: 'Voice.faust — physical modeling (Faust DSP)',
        code: "// Physical-modeling synths compiled from Faust in the browser.\n// Built-in presets: 'Bowed String', 'Marimba', 'Clarinet', 'Flute'.\nconst p = audio.piano();\np.voice('Bowed String');       // play a bowed-string physical model across the keys\n\n// Or design your own from Faust DSP source:\nVoice.faust('Plucked', 'import(\"stdfaust.lib\"); process = pm.nylonGuitar_ui_MIDI <: _,_;');\naudio.launchpad().bind(0, 'Plucked');",
        hint: "Voice.faust(name, faustCode, {poly?, voices?}) — compile a Faust DSP into a Voice (ADR 046, P4). True physical modeling via import(\"stdfaust.lib\") + pm.* instruments. The ~5MB WASM compiler loads on first use. Built-in presets: 'Bowed String','Marimba','Clarinet','Flute'.",
        tags: ['voice', 'faust', 'physical', 'modeling', 'synth', 'dsp', 'wasm'],
      },
      {
        label: 'Voice.sample — chop or pitch a sample',
        code: "// Chromatic: pitch one sample across keys (pitch up = speeds up)\nVoice.sample({ name: 'Vox', url: 'vox.wav', mode: 'chromatic', baseNote: 'C4' });\n\n// Chopped: slice a loop, each slice playable (finger-drumming)\nconst d = Voice.sample({ name: 'Break', url: 'break.wav', mode: 'chopped', slices: 16 });\nconst v = Voice.make('Break');\nv.output.toDestination();\nv.triggerSlice(3);              // play slice 3\n// preserveLength:true → GrainPlayer (pitch without changing length)",
        hint: 'Voice.sample({url|blob|file, mode:"chromatic"|"chopped", slices?, baseNote?, preserveLength?}) — build a Sample Voice. blob/file → stored in IDB (travels in project). Chopped voices expose v.triggerSlice(i) and v.sliceCount().',
        tags: ['voice', 'sample', 'chop', 'slice', 'pitch', 'sampler', 'grain'],
      },
      {
        label: 'Voice.make — play a voice directly',
        code: "const v = Voice.make({ engine: 'fm', effects: [{ type: 'reverb', wet: 0.3 }] });\nv.output.toDestination();\nv.attack('C4');\nsetTimeout(() => v.release('C4'), 500);",
        hint: 'Voice.make(nameOrDesc) → handle { output, trigger(note,dur,time,vel), attack(note,time,vel), release(note,time), dispose() }. Connect output to a destination or mixer strip.',
        tags: ['voice', 'synth', 'make', 'play', 'trigger'],
      },
    ],
  },
  {
    name: 'Patterns',
    commands: [
      {
        label: 'mini-notation reference',
        code: '',
        hint: 'Strudel mini-notation (inside note()/s()/n()): space = sequence (play evenly) | ~ = rest | [a b] = subgroup (share one step) | <a b> = alternate per cycle | a*3 = repeat 3x | a!3 = replicate | a@3 = weight (longer) | a? = random drop | a,b = parallel (stack) | {a b c}%4 = polymeter | 0..4 = range. Docs: strudel.cc',
        tags: ['mini', 'notation', 'syntax', 'reference', 'strudel', 'cheat sheet'],
      },
      {
        label: 'melody (synth — no samples)',
        code: 'note("c e g b").play();\nsetcps(0.5);',
        hint: 'note("...") plays pitches on the default synth — works with zero setup, no samples needed. .play() starts it on the shared scheduler. setcps(n) sets cycles/sec (also drives Tone\'s BPM = n*60).',
      },
      {
        label: 'chord (parallel notes)',
        code: 'note("c,e,g").play();',
        hint: 'Comma = parallel. "c,e,g" sounds all three at once. Combine with sequence: "<c,e,g> <f,a,c>".',
      },
      {
        label: 'scale degrees',
        code: 'n("0 2 4 6").scale("C:minor").play();',
        hint: "n(numbers).scale('C:minor') maps degrees to a scale — easier than typing note names. Try 'C:major', 'A:dorian', 'E:pentatonic'.",
      },
      {
        label: 'drums (needs a sample pack)',
        code: 'samples(\'github:tidalcycles/dirt-samples\');\ns("bd hh sd hh").play();',
        hint: 's("...") plays named samples — but createos bundles NO kit (ADR 035). Call samples(\'github:...\') (or your own URL) FIRST, then s("bd sd hh cp"). Without a pack, s() is silent.',
      },
      {
        label: 'faster / slower',
        code: 'note("c e g b").fast(2).play();',
        hint: '.fast(n) / .slow(n) scale the pattern\'s speed. Chain freely: note("c e g").slow(2).rev().',
      },
      {
        label: 'reverse',
        code: 'note("c e g b").rev().play();',
        hint: '.rev() plays the pattern backwards each cycle.',
      },
      {
        label: 'transpose / add',
        code: 'note("c e g").add(note("0 7")).play();',
        hint: 'Patterns are numbers too — .add(note("7")) shifts up 7 semitones; .add(note("<0 7 12>")) moves it per cycle.',
      },
      {
        label: 'stack layers',
        code: 'stack(\n  note("c2 e2 g2").slow(2),\n  n("0 2 4 6").scale("C:minor")\n).play();',
        hint: 'stack(...patterns) layers patterns in parallel on one scheduler. (Last .play() wins, so stack() is how you run more than one line.)',
      },
      {
        label: 'alternate per cycle < >',
        code: 'note("<c e g> d").play();',
        hint: '< > picks one element per cycle: c on cycle 0, e on cycle 1, g on cycle 2, then d every cycle in the second slot.',
      },
      {
        label: 'gain / pan (pattern-rate)',
        code: 'note("c e g b").gain("0.4 0.8").pan("0 1").play();',
        hint: 'Effects take patterns too — .gain("0.4 0.8") alternates loudness; .pan("0 1") sweeps stereo. This is real Strudel pattern-rate control.',
      },
      {
        label: 'every / sometimes',
        code: 'note("c e g b").every(3, x => x.rev()).sometimes(x => x.fast(2)).play();',
        hint: '.every(n, fn) applies fn every n cycles; .sometimes(fn) applies it randomly ~50%. Probabilistic variation, built in.',
      },
      {
        label: 'euclidean rhythm',
        code: 'note("c").euclid(3, 8).play();',
        hint: '.euclid(pulses, steps) spreads pulses evenly — (3,8) is the classic tresillo. Try (5,8), (7,16).',
      },
      {
        label: 'stop all (hush)',
        code: 'hush();',
        hint: 'hush() stops the Strudel scheduler. A code reset (re-run/stop) also hushes automatically.',
      },
    ],
  },
  {
    name: 'Canvas',
    commands: [
      {
        label: 'windowed canvas',
        code: "const c = new Canvas({ w: 800, h: 600, title: 'Sketch' });\nc.bg('#0a0a14');\nc.on('move', ({ x, y }) => c.circle(x, y, 8, '#fff'));",
        hint: "new Canvas({ w, h, title }) — its own window + own size (default 1600×900). Full draw API. Pointer via c.pointer / c.on('down'|'move'|'up') in canvas coords.",
      },
      {
        label: 'get canvas',
        code: "const ctx = canvas.el.getContext('2d');\nctx.fillStyle = 'red';\nctx.fillRect(0, 0, 100, 100);",
        hint: 'Get HTMLCanvasElement for z-index 0 — draw with 2D context',
      },
      {
        label: 'get layer',
        code: 'const layer = canvas.fx(0);',
        hint: 'Get Layer object for z-index — apply blur, hue, opacity effects',
      },
      {
        label: 'blur',
        code: 'canvas.fx(0).blur(5);',
        hint: 'Gaussian blur the layer (px)',
      },
      {
        label: 'hue shift',
        code: 'canvas.fx(0).hue(90);',
        hint: 'Shift hue by degrees (0–360)',
      },
      {
        label: 'brightness',
        code: 'canvas.fx(0).brightness(1.5);',
        hint: 'Adjust brightness (1 = normal, 2 = double)',
      },
      {
        label: 'saturate',
        code: 'canvas.fx(0).saturate(2);',
        hint: 'Adjust saturation (1 = normal, 0 = grayscale)',
      },
      {
        label: 'invert',
        code: 'canvas.fx(0).invert(1);',
        hint: 'Invert colors (0–1, 1 = full invert)',
      },
      {
        label: 'opacity',
        code: 'canvas.fx(0).opacity(0.5);',
        hint: 'Layer opacity (0 = invisible, 1 = full)',
      },
      {
        label: 'rotate',
        code: 'canvas.fx(0).rotate(45);',
        hint: 'Rotate entire layer in degrees',
      },
      {
        label: 'scale',
        code: 'canvas.fx(0).scale(1.5);',
        hint: 'Scale layer (1 = normal, 2 = double)',
      },
      {
        label: 'clip',
        code: "canvas.fx(0).clip('circle(50%)');",
        hint: 'Clip layer to CSS clip-path shape',
      },
      {
        label: 'reset effects',
        code: 'canvas.fx(0).reset();',
        hint: 'Remove all CSS effects from the layer',
      },
      {
        label: 'blend mode',
        code: "canvas.fx(1).blendMode('screen');",
        hint: "CSS mix-blend-mode for layer compositing — 'multiply' 'screen' 'overlay' 'difference' 'lighten' 'darken' 'hard-light' 'soft-light' 'exclusion' 'color-burn'",
      },
      {
        label: 'pixelate',
        code: 'canvas.pixelate(canvas.el, 8);',
        hint: 'Render a blocky pixelated copy of any canvas onto the draw target — pixelate(source, blockSize, x?, y?, w?, h?)',
      },
      {
        label: 'ASCII art',
        code: "const art = canvas.toASCII(canvas.el, { cols: 80 });\nconst id = wm.spawn('ASCII', { type: 'html', html: '', w: 600, h: 400, onClose: stopRunning });\ndocument.getElementById(id)?.querySelector('.wm-body').appendChild(art.el);\nsetInterval(() => art.update(canvas.el), 50);",
        hint: 'Convert canvas to ASCII <pre> — toASCII(canvas, { cols, rows, charset, bg, color }) → { el, update(canvas) }',
      },
      {
        label: 'edit image',
        code: "const img = editImage(await Media.image('https://example.com/photo.jpg'));\nimg.crop(100, 0, 800, 600).rotate(15);\ncanvas.image(img.toCanvas(), 0, 0);",
        hint: "Non-destructive image pipeline — editImage(src).crop(x,y,w,h).rotate(deg).filter(cssStr).flipH().flipV().blend(other,'screen').toCanvas()",
      },
    ],
  },
  {
    name: 'Route',
    commands: [
      {
        label: 'MIDI → audio param',
        code: "// MIDI CC 74 → oscillator frequency (sub-ms low-latency path)\nconst osc = new Tone.Oscillator(440, 'sine').toDestination();\nawait audio.start();\nosc.start();\nroute('midi:cc').filter(e => e.cc === 74).norm(0, 127).to(osc.frequency);",
        hint: 'route(eventName) creates a cross-domain signal chain. Discrete → immediate sink runs event-synchronously (sub-ms).',
        tags: ['route', 'midi', 'signal', 'audio', 'chain', 'cross-domain'],
      },
      {
        label: 'mic → shader uniform',
        code: "// Mic amplitude → shader uniform with smoothing\nconst sh = new GLShader(`\n  float r = uCustom.x;\n  gl_FragColor = vec4(r, uv.y, 1.0-r, 1.0);\n`).start();\nroute(Source.mic).amplitude.scale(0, 1, 0, 1).smooth(0.8).to(sh, 'uCustom.x');",
        hint: 'route(Source.mic).amplitude bridges mic to a scalar 0–1. .smooth() adds exponential decay (forces RAF driver).',
        tags: ['route', 'mic', 'shader', 'uniform', 'amplitude', 'smooth'],
      },
      {
        label: 'watch a live chain',
        code: "// Live chain inspector: role-tagged nodes + per-stage values, updating in real time\nroute(Source.mic).amplitude.scale(0, 1, 0, 100).smooth(0.8).watch('Mic chain');",
        hint: 'route(...).watch() opens a live, read-only window showing each stage of the chain (source/transform/sink), its role, and its current value. Adds a no-op driver if there is no sink yet.',
        tags: ['route', 'watch', 'inspect', 'signal', 'chain', 'debug', 'tier2'],
      },
      {
        label: 'camera visual effects chain',
        code: "// Camera with composable visual effects\nroute(Source.camera)\n  .tint('#ff4400')\n  .grain(0.1)\n  .show('Treated Camera', { w: 700, h: 500 });",
        hint: 'route(Source.camera) creates a visual signal chain. Chain .tint() .negative() .solarize() .grain() .strobe() etc.',
        tags: ['route', 'camera', 'visual', 'tint', 'grain', 'effects'],
      },
      {
        label: 'time-sequenced effects (Berlin Horse)',
        code: "// Optical-printing style: effects accumulate between wait() calls\nroute(Source.camera)\n  .tint('#4a8f3f').wait(3)\n  .negative().wait(2)\n  .clearEffects().solarize(0.6).wait(2)\n  .loop()\n  .show('Berlin Horse', { w: 700, h: 500 });",
        hint: 'wait(sec) schedules the accumulated effect stack. clearEffects() resets the stack (scene boundary). loop() restarts the timeline.',
        tags: ['route', 'camera', 'timeline', 'wait', 'loop', 'solarize', 'optical', 'effects'],
      },
      {
        label: 'event-driven VJ mutation',
        code: "// VJ pattern: toggle effects on beat events\nconst r = route(Source.camera).grain(0.08).show('VJ', { w: 700, h: 500 });\nr.on('beat:bar',    (r) => r.toggle('negative'));\nr.on('beat:phrase', (r) => r.clearEffects().strobe(8));",
        hint: 'r.on(event, cb) is route-scoped: auto-cleaned when the route is destroyed. r.toggle(name) adds or removes a named effect.',
        tags: ['route', 'camera', 'vj', 'beat', 'toggle', 'strobe', 'on'],
      },
      {
        label: 'fan-in: blend two sources',
        code: "// Blend mic amplitude + camera motion into one signal\nconst osc = new Tone.Oscillator(440, 'sine').toDestination();\nawait audio.start(); osc.start();\nroute(Source.mic).amplitude\n  .mix(route(Source.camera).motion(), (amp, mot) => amp * 0.5 + mot * 0.5)\n  .scale(0, 1, 200, 800)\n  .to(osc.frequency);",
        hint: '.mix(src, combineFn?) blends two sources. Default combine = average. Forces RAF pull driver.',
        tags: ['route', 'mix', 'fan-in', 'mic', 'camera', 'motion', 'blend'],
      },
      {
        label: 'camera brightness → event',
        code: "// Camera brightness drives a bus event\nroute(Source.camera).brightness({ x: 0.5, y: 0.5, radius: 0.1 })\n  .scale(0, 1, 0, 100)\n  .smooth(0.9)\n  .to('scene:brightness');",
        hint: '.brightness(opts) samples a region of the camera frame. opts: { x, y } normalized center, radius, fps.',
        tags: ['route', 'camera', 'brightness', 'event', 'bus'],
      },
    ],
  },
  {
    name: 'Physics',
    commands: [
      {
        label: 'pendulum → shader',
        code: "// Double pendulum angle drives a shader uniform (smooth, never-repeating)\nconst p = physics('pendulum', { id: 'a', damp: 0 });\np.show('Pendulum');\nconst sh = new GLShader(`\n  float r = uCustom.x;\n  gl_FragColor = vec4(r, uv.y, 1.0 - r, 1.0);\n`).start();\nroute(p.theta2).norm(-Math.PI, Math.PI).smooth(0.85).to(sh, 'uCustom.x');",
        hint: 'physics(name, opts) instantiates a sim. Channels (p.theta2) are plain () => value readers you route(). p.show() opens a debug window.',
        tags: ['physics', 'pendulum', 'chaos', 'shader', 'route', 'signal', 'simulation'],
      },
      {
        label: 'bouncing ball → drum',
        code: "// Discrete bounce events trigger a drum hit; harder bounces = louder\nconst b = physics('ball', { e: 0.85 });\nb.show('Ball');\non('physics:ball:bounce').do((e) => console.log('bounce', e.speed.toFixed(2)));\nroute('physics:ball:bounce').to('kick');",
        hint: 'Sims dual-emit `physics:{name}:{event}` (all instances) and `physics:{id}:{event}` (one). Route or on() them like any bus event.',
        tags: ['physics', 'ball', 'bounce', 'event', 'trigger', 'drum', 'discrete'],
      },
      {
        label: 'Kuramoto → filter arc',
        code: "// Order parameter R (0..1) slowly opens a filter as oscillators sync\nconst k = physics('kuramoto', { n: 16, k: 1.4 });\nk.show('Kuramoto');\nconst filt = new Tone.Filter(200, 'lowpass').toDestination();\nroute(k.R).scale(0, 1, 200, 8000).smooth(0.95).to(filt.frequency);",
        hint: "R is already 0..1 (no norm needed). Raise coupling k live with k.set('k', 2) to push it through the sync threshold.",
        tags: ['physics', 'kuramoto', 'order', 'sync', 'filter', 'arc', 'coupling'],
      },
      {
        label: 'stereo divergence (two pendulums)',
        code: "// Two pendulums a hair apart diverge — a free correlated stereo pair\nconst L = physics('pendulum', { id: 'L' });\nconst R = physics('pendulum', { id: 'R', split: 0.01 });\nroute(L.theta2).to((v) => console.log('L', v.toFixed(2)));\nroute(R.theta2).to((v) => console.log('R', v.toFixed(2)));",
        hint: 'Give each instance an `id` so it has a stable identity (survives soft reset) and its own event namespace. `split` seeds a divergent twin.',
        tags: ['physics', 'pendulum', 'stereo', 'divergence', 'chaos', 'id'],
      },
      {
        label: 'live knob = bidirectional',
        code: "// Route a signal INTO a sim param (fn-sink) — bidirectional, no new API\nconst p = physics('pendulum', { id: 'a' });\np.show('Pendulum');\n// mic loudness bends gravity live:\nroute(Source.mic).amplitude.scale(0, 1, 5, 25).to((v) => p.set('g', v));",
        hint: 'p.set(name, val) changes a param live without resetting the trajectory. Routing to it = modulation. (Feeding a sim its OWN channel back is unstable — avoid.)',
        tags: ['physics', 'param', 'set', 'bidirectional', 'mic', 'modulation'],
      },
      {
        label: 'logistic map (iterated chaos)',
        code: "// A chaotic map iterated at 4 Hz — sparse discrete signal, sweep r to find edges\nconst m = physics('logistic', { r: 3.7, rate: 6 });\nm.show('Logistic');\nroute('physics:logistic:step').to((e) => console.log(e.x.toFixed(3)));",
        hint: 'The logistic map has no continuous time — it iterates (rate Hz), not steps. r in 3.57..4 is chaotic; r below ~3 settles.',
        tags: ['physics', 'logistic', 'map', 'chaos', 'iterated', 'bifurcation'],
      },
    ],
  },
  {
    name: 'Pipeline',
    commands: [
      {
        label: 'ASCII camera',
        code: "pipe(Source.camera)\n  .ascii({ cols: 120, color: '#00ff41', bg: '#0d0208' })\n  .show('ASCII Cam', { w: 700, h: 500 });",
        hint: 'pipe(Source.camera) opens the camera and starts a render pipeline — no await needed. .ascii(opts) renders ASCII art. .show(title, {w,h}) spawns a window.',
        tags: ['pipe', 'ascii', 'camera', 'pipeline', 'source'],
      },
      {
        label: 'ASCII + shader',
        code: "pipe(Source.camera)\n  .ascii({ cols: 150, color: '#00ff41', bg: '#0d0208' })\n  .glshader(`\n    vec4 a = texture2D(uVideo, uv);\n    float l = dot(a.rgb, vec3(.299,.587,.114));\n    vec3 rain = .5+.5*cos(6.28*(uv.y+time*.4+vec3(0,.33,.67)));\n    gl_FragColor = vec4(rain*l, 1.);\n  `)\n  .show('ASCII Cam', { w: 700, h: 500 });",
        hint: 'Chain ASCII then a GLSL color shader — one raf loop, auto-cleanup on reset. No captureWindow needed.',
        tags: ['pipe', 'ascii', 'glshader', 'shader', 'pipeline', 'camera'],
      },
      {
        label: 'camera → shader',
        code: "pipe(Source.camera)\n  .glshader(`\n    vec4 c = texture2D(uVideo, uv);\n    float g = dot(c.rgb, vec3(.299,.587,.114));\n    gl_FragColor = vec4(g, g*0.5, 1.0-g, 1.0);\n  `)\n  .show('Camera Shader', { w: 700, h: 500 });",
        hint: 'Direct camera → GLShader pipeline. uVideo samples the camera feed.',
        tags: ['pipe', 'glshader', 'shader', 'camera', 'pipeline'],
      },
      {
        label: 'pixelate camera',
        code: "pipe(Source.camera)\n  .pixelate({ blockSize: 20 })\n  .show('Pixelate', { w: 700, h: 500 });",
        hint: 'Mosaic/pixelate stage — blockSize controls pixel block size.',
        tags: ['pipe', 'pixelate', 'camera', 'pipeline'],
      },
      {
        label: 'fx filter',
        code: "pipe(Source.camera)\n  .fx('hue-rotate(120deg) saturate(2)')\n  .show('FX', { w: 700, h: 500 });",
        hint: '.fx(cssFilter) applies any CSS filter string — blur, hue-rotate, invert, saturate, sepia, etc.',
        tags: ['pipe', 'fx', 'filter', 'camera', 'pipeline'],
      },
      {
        label: 'canvas → pipeline',
        code: "pipe(canvas.el)\n  .ascii({ cols: 80, color: '#ff6600' })\n  .show('Canvas ASCII', { w: 600, h: 400 });",
        hint: 'Pass any canvas as source — pipe() accepts CameraStream, canvas, video, GLShader, Shader, or Layer.',
        tags: ['pipe', 'ascii', 'canvas', 'pipeline'],
      },
      {
        label: 'custom stage',
        code: "const cam = await Camera.open();\npipe(cam)\n  .use(src => {\n    const canvas = document.createElement('canvas');\n    canvas.width = 800; canvas.height = 600;\n    const ctx = canvas.getContext('2d');\n    return {\n      canvas,\n      read() {\n        ctx.filter = 'invert(1)';\n        ctx.drawImage(src, 0, 0, canvas.width, canvas.height);\n        ctx.filter = 'none';\n      }\n    };\n  })\n  .show('Custom Stage', { w: 700, h: 500 });",
        hint: '.use(factory) — custom pipeline stage. factory(srcDrawable) called once at start, returns { canvas, read() }. read() called every frame.',
        tags: ['pipe', 'use', 'custom', 'stage', 'pipeline', 'extensible'],
      },
      {
        label: 'subtitle overlay',
        code: "const srt = `1\n00:00:00,000 --> 00:00:02,500\nHello world\n\n2\n00:00:02,500 --> 00:00:05,000\nThis is a subtitle`;\nconst vid = await Media.video('https://example.com/video.mp4');\npipe(vid)\n  .subtitle(srt, { fontSize: 32, color: '#fff', bg: 'rgba(0,0,0,0.7)' })\n  .show('Subtitled Video', { w: 800, h: 500 });",
        hint: '.subtitle(srtText, opts) — overlays time-synced SRT subtitles. opts: fontSize, color, bg, font, weight, stroke, marginBottom',
        tags: ['pipe', 'subtitle', 'srt', 'caption', 'text', 'video'],
      },
    ],
  },
  {
    name: 'Masking',
    commands: [
      {
        label: 'clip — static region',
        code: "// Static geometry mask: restrict a layer to a fixed shape (compositor, free).\nconst s = new Shader(SHADER_PRESETS.plasma).mount(myCanvas);\ns.fx?.(30)?.clip?.('circle(30% at 50% 50%)');\n// Or on a Canvas layer: c.fx(30).clip('polygon(50% 0, 100% 100%, 0 100%)');",
        hint: '.clip(shape) restricts a mounted layer to a fixed/CSS-animatable region (circle/polygon/SVG path) via clip-path. Compositor-thread, effectively free. Use for STATIC geometry; use .mask() for dynamic pixel regions.',
        tags: ['clip', 'mask', 'static', 'clip-path', 'region'],
      },
      {
        label: 'mask a shader with a drawable',
        code: '// Dynamic mask: show the shader only where the mask canvas is bright.\nconst m = Mask.circle({ x: 0.5, y: 0.5, r: 0.3 });\nconst s = new Shader(SHADER_PRESETS.plasma).mask(m).start();\n// animate the hole:\nlet t = 0;\ntick(() => { t += 0.02; m.update({ x: 0.5 + Math.sin(t) * 0.3 }); });',
        hint: 'shader.mask(source, { channel:"luminance"|"alpha", invert }) restricts the layer to the source drawable’s region. source is ANY Drawable Source (paint canvas, camera, another shader). .mask(null) clears.',
        tags: ['mask', 'shader', 'dynamic', 'drawable', 'region'],
      },
      {
        label: 'Mask.circle / feather',
        code: '// Procedural shape masks (white-on-black, normalized 0–1 coords).\nconst hard = Mask.circle({ x: 0.5, y: 0.5, r: 0.25 });\nconst soft = Mask.feather({ x: 0.5, y: 0.5, r: 0.3, softness: 0.5 });\nnew Shader(SHADER_PRESETS.noise).mask(soft).start();',
        hint: 'Mask.circle(opts) / Mask.feather(opts) return a white-on-black canvas with .update(opts) for animation. Register your own with Mask.register(name, factory).',
        tags: ['mask', 'circle', 'feather', 'procedural', 'shape'],
      },
      {
        label: 'hand-tracked mask (vision)',
        code: "// Reveal a camera shader only under your fingertips.\nconst mask = vision.handMask({ landmark: 8, radius: 0.15, smoothing: 0.3 });\npipe(Source.camera)\n  .glshader(`\n    vec4 c = texture2D(uVideo, uv);\n    gl_FragColor = vec4(1.0 - c.rgb, 1.0);\n  `, { mask })\n  .show('Hand Mask', { w: 700, h: 500 });",
        hint: 'vision.handMask({landmark, radius, shape, smoothing, mirror}) returns a self-driving white-on-black canvas tracking hand landmarks (unions all hands). Drop straight into .mask(). Pass mask: in a pipe .glshader() opts.',
        tags: ['mask', 'vision', 'hand', 'tracking', 'handMask', 'camera'],
      },
      {
        label: 'auto-blur faces (vision)',
        code: "// Blur only faces: sharp base + blurred layer masked to the face ovals.\nvision.configure({ face: { numFaces: 5 } }); // default 1\nconst c = new Canvas({ title: 'Auto-Blur Faces', w: 960, h: 540 });\npipe(Source.camera).layer(c, 0);\npipe(Source.camera).blur(26).mask(vision.faceMask({ pad: 0.35, feather: 0.25 })).layer(c, 1);",
        hint: 'vision.faceMask({pad, feather, smoothing, mirror}) returns a self-driving feathered oval mask unioning all tracked faces (bump count with vision.configure({face:{numFaces}})). Blur/shade a camera layer through it and composite over a sharp base with pipe.layer(c, z).',
        tags: ['mask', 'vision', 'face', 'blur', 'privacy', 'faceMask', 'camera'],
      },
      {
        label: 'finger-frame ASCII cam (vision)',
        code: "// Make a rectangle with two hands — the framed area turns to ASCII (with bloom).\nconst W = 960, H = 540;\nvision.configure({ hands: { numHands: 2 } });\nconst c = new Canvas({ title: 'Finger-Frame ASCII', w: W, h: H });\npipe(Source.camera).layer(c, 0);\npipe(Source.camera).ascii({ cols: 90, color: '#00ff41', bg: '#0d0208', fit: true }).mask(vision.handRectMask({ pad: 0.04 })).layer(c, 1);\nc.fx(1).filter('drop-shadow(0 0 2px #00ff41) drop-shadow(0 0 6px #00ff41) brightness(1.15)');\nconst octx = wm.layer(c.winId, 2, { raster: true, w: W, h: H }).getContext('2d');\ntick(() => { octx.clearRect(0, 0, W, H); vision.drawHands(octx, { color: '#00ff41' }); });",
        hint: 'vision.handRectMask({landmark, pad, smoothing, mirror}) returns a self-driving white-rect mask spanning the bbox between two hand fingertips (director-frame gesture; needs numHands:2). Mask a pipe.ascii() layer with it for an in-frame ASCII viewfinder; draw the skeleton with vision.drawHands on a higher plane.',
        tags: ['mask', 'vision', 'hand', 'ascii', 'frame', 'handRectMask', 'camera'],
      },
      {
        label: 'temporal mask (route)',
        code: "// Mask on for 3s, off for 2s, on a loop.\nconst r = route(Source.camera)\n  .mask(Mask.circle({ r: 0.35 }))\n  .wait(3)\n  .clearEffects()\n  .wait(2)\n  .loop()\n  .show('Temporal Mask', { w: 700, h: 500 });\n// r.toggle('mask') from a beat/gesture handler",
        hint: "route(...).mask(source, opts) is a timeline-able stage — .wait()/.loop()/.toggle('mask'). Chain .mask(a).mask(b) to INTERSECT two separate sources (each is a multiply pass).",
        tags: ['mask', 'route', 'pipe', 'temporal', 'toggle', 'intersection'],
      },
    ],
  },
  {
    name: 'Vision',
    commands: [
      {
        label: 'nearest object',
        code: "vision.nearest('person')",
        hint: 'Highest-confidence detected object of label — {label, cx, cy, confidence} or null',
      },
      {
        label: 'all objects',
        code: 'vision.objects()',
        hint: 'All detected objects — [{label, cx, cy, confidence}]',
      },
      {
        label: 'any detected?',
        code: "vision.any('person')",
        hint: 'True if any object of this label is currently detected',
      },
      {
        label: 'gesture',
        code: 'vision.gesture()',
        hint: "Current hand gesture — 'Thumb_Up', 'Open_Palm', 'Closed_Fist', 'Pointing_Up', 'Victory', 'ILoveYou', or null",
      },
      {
        label: 'expression',
        code: 'vision.expression()',
        hint: "Current face expression — 'smile', 'surprise', 'frown', 'mouth_open', 'neutral', or null",
      },
      {
        label: 'face',
        code: 'vision.face()',
        hint: 'Detected face — {expression, cx, cy, landmarks} or null',
      },
      {
        label: 'hands',
        code: 'vision.hands()',
        hint: 'All detected hands — [{gesture, cx, cy, confidence, landmarks}]',
      },
      {
        label: 'pose',
        code: 'vision.pose()',
        hint: 'Body pose — {landmarks: [{x,y,z,visibility}×33]} or null. Lazy-loads PoseLandmarker on first call.',
      },
      {
        label: 'draw boxes',
        code: 'vision.drawBoxes()',
        hint: 'Overlay object detection bounding boxes + labels on the canvas',
      },
      {
        label: 'draw face',
        code: 'vision.drawFace()',
        hint: 'Overlay 478 face landmark dots on the canvas',
      },
      {
        label: 'draw hands',
        code: 'vision.drawHands()',
        hint: 'Overlay hand skeleton (21 points + connections) on the canvas',
      },
      {
        label: 'draw pose',
        code: 'vision.drawPose()',
        hint: 'Overlay body pose skeleton (33 points + connections) on the canvas. Lazy-loads PoseLandmarker.',
      },
      {
        label: 'configure vision',
        code: "vision.configure({ pose: { model: 'lite', numPoses: 1 } })",
        hint: "Set pose model ('lite'|'full'|'heavy') and numPoses before first vision.pose() call. First-run-wins.",
      },
      {
        label: 'gaze',
        code: 'vision.gaze()',
        hint: 'Where the user looks — {x, y (dir −1..1), dir, blink, leftClosed, rightClosed, vx, vy} or null. vx/vy are viewport px, null until vision.calibrate().',
      },
      {
        label: 'gaze in element',
        code: 'vision.gazeIn(canvas.el)',
        hint: 'Gaze point converted to coordinates local to an element/canvas — {x, y} or null. Needs calibration.',
      },
      {
        label: 'calibrate gaze',
        code: 'await vision.calibrate({ points: 9 })',
        hint: 'Run an interactive dot-following calibration so vision.gaze().vx/vy return screen pixels. Resolves true on success.',
      },
      {
        label: 'when blink',
        code: 'vision.onBlink(() => {\n  \n});',
        hint: 'Run code when both eyes blink. No calibration needed.',
      },
      {
        label: 'when wink',
        code: "vision.onWink('left', () => {\n  \n});",
        hint: "Run code when one eye winks ('left' | 'right'). No calibration needed.",
      },
      {
        label: 'when gaze in region',
        code: 'vision.onGaze(canvas.el, (inside) => {\n  \n});',
        hint: "Fire when gaze enters (inside=true) / leaves (false) an element or {x,y,w,h} viewport rect. Needs calibration. A direction string ('left'/'center'/…) instead registers a calibration-free handler.",
      },
    ],
  },
  {
    name: 'Language',
    commands: [
      {
        label: 'is profane?',
        code: "lang.isProfane('some text')",
        hint: 'True if the text contains profanity. Obfuscation-resistant (f.u.c.k, fu*k, leetspeak). Instant, offline.',
      },
      {
        label: 'profanity matches',
        code: "lang.profanity('some text')",
        hint: 'Matched profane terms — [{term, start, end}]. Empty array if clean.',
      },
      {
        label: 'censor text',
        code: "lang.censor('some text')",
        hint: "Returns the text with profanity masked. Pass a mask char as 2nd arg, e.g. lang.censor(t, '*').",
      },
      {
        label: 'add profane word',
        code: "lang.block('customword')",
        hint: 'Add custom term(s) to the profanity matcher. Chainable.',
      },
      {
        label: 'allow word (whitelist)',
        code: "lang.allow('scunthorpe')",
        hint: 'Pardon word(s) so they never count as profane (kills false positives). Chainable.',
      },
      {
        label: 'sentiment',
        code: "lang.sentiment('I love this!')",
        hint: "Instant AFINN sentiment — {score, comparative, label ('positive'|'negative'|'neutral'), positive, negative}.",
      },
      {
        label: 'classify (ML)',
        code: "const cats = await lang.classify('I love this!');",
        hint: 'MediaPipe TextClassifier — [{category, score}]. Lazy-loads a WASM ML model on first call (async).',
      },
      {
        label: 'configure classifier',
        code: "lang.configure({ model: 'https://…/my_classifier.tflite' })",
        hint: 'Swap the ML classifier model URL used by lang.classify(). Reloads on next call.',
      },
    ],
  },
  {
    name: 'Control',
    commands: [
      {
        label: 'set interval',
        code: 'setInterval(() => {\n  \n}, 100);',
        hint: 'Run code every N milliseconds',
      },
      {
        label: 'set timeout',
        code: 'setTimeout(() => {\n  \n}, 1000);',
        hint: 'Run code once after N milliseconds',
      },
      {
        label: 'on key',
        code: "on('window:key:down').when({ ArrowUp: () => {\n  \n} });",
        hint: "Dispatch to handler by key name. Use hold('window:key:down') for polling inside tick().",
      },
      {
        label: 'random number',
        code: 'randUni(0, 100)',
        hint: 'Random number between lo and hi',
      },
      {
        label: 'random color',
        code: 'Color.random()',
        hint: 'A random vivid HSL color string',
      },
      {
        label: 'pause',
        code: 'pause();',
        hint: 'Pause program execution (freezes timers)',
      },
      {
        label: 'resume',
        code: 'resume();',
        hint: 'Resume paused program execution',
      },
      {
        label: 'stop',
        code: 'stop();',
        hint: 'Stop program execution and clean up',
      },
    ],
  },
  {
    name: 'Events',
    commands: [
      {
        label: 'on(event).do',
        code: "on('beat:tick').do(({ bpm, bar, beat }) => {\n  \n});",
        hint: "Subscribe to any system or user event. Returns a stop handle. Chain .every(n) / .after(e) / .within(ms) / .when(pred) before .do(fn). Type inside on('…') for event name completions.",
      },
      {
        label: 'on(event).every(n).do',
        code: "on('beat:tick').every(4).do(() => {\n  // fires every 4th tick\n});",
        hint: 'on(event).every(n) — only fires on every nth occurrence. Combine with .when(pred), .after(e), .within(ms).',
      },
      {
        label: 'on(event).after(e).do',
        code: "on('beat:tick').after('audio:start').do(() => {\n  \n});",
        hint: 'on(e).after(trigger) — subscribes to e but only starts counting after trigger fires once.',
      },
      {
        label: 'on(event).within(ms).do',
        code: "on('gesture:detected').within(1000).do(({ type }) => {\n  \n});",
        hint: 'on(e).within(ms) — only fires if less than ms have elapsed since the last event.',
      },
      {
        label: 'any(events).do',
        code: "any('beat:bar', 'gesture:detected').do((data) => {\n  \n});",
        hint: 'any(...events) — subscribes to multiple events, fires handler on whichever arrives first. Same modifiers available.',
      },
      {
        label: 'emit(event)',
        code: "emit('my-event', { value: 42 });",
        hint: "emit(event, data) — fire a user event or trigger a commandable system action (e.g. emit('wm:spawn', { title: 'Pulse' })). Use on() to subscribe.",
      },
      {
        label: 'monitor()',
        code: 'monitor();',
        hint: 'monitor() — open the Event Stream panel: a live floating window showing all bus events firing during a run, with rate-limiting, filtering, and expandable payloads.',
        tags: ['debug', 'events', 'observe'],
      },
      {
        label: 'on beat tick',
        code: "on('beat:tick').do(({ bpm, bar, beat, time }) => {\n  \n});",
        hint: 'Fires on every quarter-note when audio transport is running. beat: 0–3, bar increments every 4 beats, phrase every 16 beats.',
      },
      {
        label: 'on beat bar',
        code: "on('beat:bar').do(({ bpm, bar, time }) => {\n  \n});",
        hint: 'Fires at the start of each bar (every 4 beats). Pairs well with .every(n) to fire every n bars.',
      },
      {
        label: 'on gesture',
        code: 'vision.onGesture("Thumb_Up", () => {\n  \n});',
        hint: 'Fire once when a gesture is first detected — gestures: Thumb_Up, Thumb_Down, Open_Palm, Closed_Fist, Pointing_Up, Victory, ILoveYou',
      },
      {
        label: 'on expression',
        code: 'vision.onExpression("smile", () => {\n  \n});',
        hint: 'Fire once when a face expression is first detected — expressions: smile, surprise, frown, mouth_open',
      },
      {
        label: 'on key',
        code: "on('window:key:down').when({ ArrowUp: () => {\n  \n} });",
        hint: "Dispatch to different handlers by key. Object keys are key names ('a', 'ArrowUp', ' '). Multiple keys in one on().",
      },
      {
        label: 'on key — WASD',
        code: "on('window:key:down').when({\n  w: () => y -= 5,\n  s: () => y += 5,\n  a: () => x -= 5,\n  d: () => x += 5,\n});",
        hint: "Terse key dispatch — object keys map to handlers. Primary field ('key') looked up automatically from event catalog.",
      },
      {
        label: 'on mouse click',
        code: "on('window:mouse:click').do(({ button, x, y, winId }) => {\n  \n});",
        hint: 'Global click event. button: 0=left, 1=middle, 2=right. winId = id of clicked WM window, or null.',
      },
      {
        label: 'on window mouse click',
        code: "on('wm:win-1:mouse:click').do(({ button, x, y }) => {\n  // x,y relative to window body\n});",
        hint: 'Scoped click for a specific WM window. Replace win-1 with actual window id. Coords are relative to the window body.',
      },
      {
        label: 'tick(ms).do',
        code: 'tick(16).do(() => {\n  \n});',
        hint: 'Interval loop. tick(fn) runs fn every frame (~16ms) and returns a stop handle — the plain animation loop. tick(ms) returns a composable selector: call .do(fn), with modifiers .every(n), .after(event), .within(ms). Uses patched setInterval so it pauses/cleans like user code.',
      },
      {
        label: 'tween',
        code: "const cancel = tween(2000, t => {\n  canvas.bg(`hsl(0,100%,${t * 50}%)`);\n}, { onDone: () => console.log('done') });",
        hint: 'tween(duration, fn(t), { easing?, onDone? }) — animate t from 0→1 over duration ms, then call onDone. Returns cancel handle. easing: fn(t)=>t, default linear.',
      },
      {
        label: 'tick + hold keys',
        code: "const keys = hold('window:key:down');\ntick(16).do(() => {\n  if (keys.has('ArrowUp')) y -= 4;\n  if (keys.has('ArrowDown')) y += 4;\n  canvas.clear();\n  canvas.circle(x, y, 10, 'white');\n});",
        hint: 'hold(event) returns a live Set (for key/mouse pairs) or object. Use inside tick for polling held state. Never stale — auto-clears on reset.',
      },
    ],
  },
  {
    name: 'Camera & Mic',
    commands: [
      {
        label: 'open camera',
        code: 'const cam = await Camera.open();\n// cam.element = <video>, cam.flip(true) mirrors, cam.stop() releases\nconsole.log(cam.element.videoWidth, cam.element.videoHeight);',
        hint: 'Camera.open({index?, deviceId?}) → CameraStream. .element is the live <video>, .flip(bool) mirrors horizontally, .stop() releases the stream.',
      },
      {
        label: 'open camera by index',
        code: 'const cam = await Camera.open({ index: 1 });\n// index 0 = first camera, 1 = second, etc.',
        hint: 'Open a specific camera by index. Use Camera.list() to enumerate all cameras with their indices and deviceIds.',
      },
      {
        label: 'list cameras',
        code: 'const cams = await Camera.list();\nconsole.log(cams);\n// [{index, deviceId, label}, ...]',
        hint: 'Camera.list() → array of {index, deviceId, label}. Use deviceId with Camera.open({deviceId}) to target a specific camera.',
      },
      {
        label: 'camera → show window',
        code: "const cam = await Camera.open();\nwm.spawn('Camera Feed', { type: 'camera' });",
        hint: 'Spawn a window showing the toolbar camera feed. Or use Camera.open() and pipe the element yourself.',
      },
      {
        label: 'camera → pipeline',
        code: "const cam = await Camera.open();\npipe(cam).show('Camera Feed');",
        hint: 'Pipe a CameraStream through the render pipeline — chain .ascii(), .pixelate(), .glshader(), .shader() stages before showing.',
      },
      {
        label: 'camera → ASCII pipeline',
        code: "const cam = await Camera.open();\npipe(cam).ascii({ cols: 120, color: '#00ff41', bg: '#000' }).show('ASCII Cam');",
        hint: 'Pipeline from camera through ASCII renderer to a window. Adjust cols, color, bg.',
      },
      {
        label: 'camera shader',
        code: "ShaderFX.camera('greyscale');",
        hint: 'Toolbar camera shader. Effects: greyscale, invert, channel_swap, posterize, scanlines',
      },
      {
        label: 'camera shader (specific camera)',
        code: "const cam = await Camera.open({ index: 0 });\nShaderFX.camera(cam, 'greyscale');",
        hint: 'Apply shader to a specific Camera.open() stream — pass the stream as first arg',
      },
      {
        label: 'camera shader (composable)',
        code: "const s = ShaderFX.cameraShader('greyscale');\ns.start();\n// later: s.stop(); s.opacity(0.5);",
        hint: 'Camera shader you can control — stop, fade opacity, swap effects. Pass a CameraStream as first arg for multi-camera.',
      },
      {
        label: 'microphone',
        code: 'const mic = await audio.mic();\n// mic is live — connect to effects or analysis\nconst rev = audio.reverb(2);\nmic.connect(rev);',
        hint: 'Open mic input — async, prompts browser permission. Connect to effects, meter, or analyser.',
      },
      {
        label: 'mic → meter',
        code: "const mic = await audio.mic();\nconst meter = audio.meter();\nmic.connect(meter);\n\nsetInterval(() => {\n  const db = meter.getValue();\n  const amp = isFinite(db) ? Math.pow(10, db / 20) : 0;\n  console.log('amplitude:', amp.toFixed(3));\n}, 100);",
        hint: 'Read mic amplitude each frame — db from meter.getValue(), convert to linear with Math.pow(10, db/20)',
      },
      {
        label: 'mic → pitch detect',
        code: "const mic = await audio.mic();\nconst fft = audio.analyser(2048);\nmic.connect(fft);\n\nsetInterval(() => {\n  const bins = fft.getValue(); // Float32Array of dB\n  const sampleRate = 44100;\n  let maxI = 0;\n  for (let i = 1; i < bins.length; i++) if (bins[i] > bins[maxI]) maxI = i;\n  const hz = (maxI / bins.length) * (sampleRate / 2);\n  if (hz > 50 && hz < 2000) console.log(hz.toFixed(0) + ' Hz');\n}, 100);",
        hint: 'Rough pitch detection from mic FFT — finds peak bin frequency. Works for clear tones, not polyphonic material.',
      },
      {
        label: 'mic level (float)',
        code: '// audio.level → 0–1 RMS amplitude. Enable mic in toolbar first.\nsetInterval(() => {\n  console.log(audio.level.toFixed(3));\n}, 100);',
        hint: 'audio.level — live mic amplitude 0–1 (RMS). Enable mic in toolbar. Poll or use audio.onLevel() for triggers.',
      },
      {
        label: 'mic level trigger',
        code: "audio.onLevel(0.6, () => {\n  canvas.bg('red'); // loud\n}, () => {\n  canvas.bg('black'); // quiet\n});",
        hint: 'audio.onLevel(threshold, onEnter, onExit?) — edge-triggered when mic amplitude crosses threshold (0–1). Enable mic in toolbar.',
      },
      {
        label: 'voice command',
        code: "audio.onWord('red', () => canvas.bg('red'));\naudio.onWord('blue', () => canvas.bg('blue'));\naudio.onWord('clear', () => canvas.clear());",
        hint: 'audio.onWord(word, fn) — fires when that word is spoken. Uses Web Speech API (Chrome/Edge). Mic must be enabled.',
      },
      {
        label: 'speech transcript',
        code: "audio.onSpeech((text) => {\n  console.log('heard:', text);\n  canvas.text(text, 50, 50, { size: 24, color: 'white' });\n});",
        hint: 'audio.onSpeech(fn) — fires with full transcript string on every recognized utterance.',
      },
      {
        label: 'word stream',
        code: "audio.onWordStream(({ word, final, index }) => {\n  console.log(word, final ? '(final)' : '(interim)');\n});",
        hint: 'audio.onWordStream(fn) — fires for every word as it streams in, interim and final. payload: { word, final, index }',
      },
      {
        label: 'text to speech',
        code: "audio.say('hello world');",
        hint: 'audio.say(text, opts?) — speak text via browser TTS. opts: { voice, rate (0.1–10), pitch (0–2), volume (0–1), lang }',
      },
      {
        label: 'TTS with options',
        code: "// List available voices:\nconsole.log(audio.voices());\n\naudio.say('hello', { voice: 'Samantha', rate: 0.8, pitch: 1.2, volume: 1 });",
        hint: 'audio.voices() → array of voice name strings. Pass a name as opts.voice to audio.say().',
      },
      {
        label: 'video signal — camera',
        code: "// Enable camera in toolbar first\nconst sig = video.signal('camera', { x: 0.5, y: 0.5, radius: 0.1 });\n// sig.brightness 0–1 luminance  sig.r / .g / .b  sig.motion 0–1  sig.hue 0–360\n\n// .stream() — RAF push, no polling needed\nsig.stream(s => {\n  canvas.clear();\n  canvas.circle(800, 450, s.brightness * 400, `hsl(${s.hue}, 80%, 50%)`);\n});\n\naudio.start();",
        hint: 'video.signal(source, opts) → live {brightness, r, g, b, motion, hue}. sig.stream(fn) fires fn every frame — no setInterval needed, cleaned up on stop.',
      },
      {
        label: 'video signal — motion trigger',
        code: "// Enable camera in toolbar first\nconst sig = video.signal('camera', { x: 0.5, y: 0.5, radius: 0.3 });\nconst kick = audio.kick();\n\nlet wasStill = true;\nsetInterval(() => {\n  if (sig.motion > 0.15 && wasStill) {\n    kick.play('C1', '8n');\n    wasStill = false;\n  } else if (sig.motion < 0.05) {\n    wasStill = true;\n  }\n}, 33);\naudio.start();",
        hint: 'sig.motion = RMS pixel diff between frames (0–1). Cheap motion detection without Vision API — wave hand to trigger.',
      },
      {
        label: 'video signal → shader',
        code: "// Enable camera in toolbar first\nconst sig = video.signal('camera');\n\nconst s = new Shader(`\n  let bright = custom.x;  // camera brightness\n  let motion = custom.y;  // motion intensity\n  let hue    = custom.z;  // dominant hue 0–1\n  return vec4f(motion * 2.0, bright, hue, 1.0);\n`);\n\nsetInterval(() => s.set([sig.brightness, sig.motion, sig.hue / 360, 0]), 16);\ns.start();",
        hint: "Read video.signal() getters and push to shader.set() — or use audio.signal() + shader.bind() for audio sources. video.signal works on any canvas: 'camera', canvas.el, viz.canvas.",
      },
      {
        label: 'video signal — color → note',
        code: "// Enable camera in toolbar first\nconst sig = video.signal('camera', { x: 0.5, y: 0.3, radius: 0.05 });\nconst scale = audio.scale('C3', 'pentatonic');\nconst synth = audio.pluck();\n\nsetInterval(() => {\n  const degree = Math.floor(sig.hue / 360 * scale.length);\n  synth.play(scale[degree], '16n');\n}, 200);\naudio.start();",
        hint: 'Map camera hue → scale degree → note. Move a colored object in front of the camera to play different pitches.',
      },
      {
        label: 'video.onMotion — trigger',
        code: "// Enable camera in toolbar first\nconst kick = audio.kick();\nconst snare = audio.noise();\n\nvideo.onMotion('camera', 0.12, () => {\n  kick.play('C1', '8n');\n}, () => {\n  // motion stopped\n});\naudio.start();",
        hint: 'video.onMotion(source, threshold, onEnter, onExit?) — edge-triggered when motion crosses threshold 0–1. onExit fires when motion drops back below. Reuse an existing video.signal() object as source to share the sampling loop.',
      },
      {
        label: 'video.onBrightness — trigger',
        code: "// Enable camera in toolbar first — cover/uncover camera to trigger\nconst synth = audio.fm();\n\nvideo.onBrightness('camera', 0.5,\n  () => synth.play('C4', '4n'),  // bright\n  () => synth.play('G3', '4n')   // dark\n);\naudio.start();",
        hint: 'video.onBrightness(source, threshold, onEnter, onExit?) — fires when average brightness of sampled region crosses threshold. Like audio.onLevel but for camera or any canvas.',
      },
      {
        label: 'video triggers — shared signal',
        code: "// Share one sampling loop, multiple triggers\nconst sig = video.signal('camera', { x: 0.5, y: 0.5, radius: 0.2 });\nconst kick  = audio.kick();\nconst synth = audio.fm();\n\nvideo.onMotion(sig, 0.1, () => kick.play('C1', '8n'));\nvideo.onBrightness(sig, 0.6,\n  () => synth.play('C5', '16n'),\n  () => synth.play('G3', '16n')\n);\naudio.start();",
        hint: 'Pass an existing video.signal() object as source to onMotion/onBrightness — reuses the same pixel sampling loop instead of creating a new one per trigger.',
      },
      {
        label: 'cam.flip — mirror camera',
        code: 'const cam = await Camera.open();\ncam.flip(true);   // mirror horizontally\n// cam.flip(false) to undo\n// Or click the ↔ button in the toolbar when camera is on',
        hint: 'cam.flip(bool) mirrors the Camera.open() video element horizontally. The toolbar ↔ button mirrors the main toolbar camera canvas.',
      },
    ],
  },
  {
    name: 'Windows',
    commands: [
      {
        label: 'get window by title',
        code: "const id = wm.getByTitle('My Window');\nconsole.log(id); // window id string or null",
        hint: 'wm.getByTitle(title) → window id string or null. Case-insensitive exact match on the titlebar text.',
      },
      {
        label: 'flash window filter',
        code: "const id = wm.getByTitle('My Window');\nwm.filter(id, 'brightness(2.5) hue-rotate(30deg)');\nsetTimeout(() => wm.filter(id, ''), 80);",
        hint: "wm.filter(id, cssFilter) — apply any CSS filter to a window body. Pass '' to clear. Great for drum flashes.",
      },
      {
        label: 'drum flash on beat',
        code: "// Flash a window every time a drum plays\n// First spawn or find your video/image window:\nconst winId = wm.getByTitle('Drum Kit');\n\npat('[bd sd] hh', (val) => {\n  if (!winId) return;\n  if (val === 'bd') {\n    wm.filter(winId, 'brightness(3) saturate(2)');\n    setTimeout(() => wm.filter(winId, ''), 80);\n  }\n}).start();\naudio.start();",
        hint: 'Wire beat:tick (or a drumpad onHit) to wm.filter() to flash a window on each hit. Swap the filter for hue-rotate, sepia, invert, etc.',
      },
      {
        label: 'layout',
        code: "wm.layout('split');",
        hint: "Switch to a named tiling layout — 'split' (toolkit + editor side by side)",
      },
      {
        label: 'show',
        code: "wm.show('win-canvas');",
        hint: 'Show a window by id — built-in ids: win-toolkit, win-editor, win-canvas, win-console, win-camera, win-mic',
      },
      {
        label: 'hide',
        code: "wm.hide('win-canvas');",
        hint: 'Hide a window (built-ins hide; spawned windows are removed from DOM)',
      },
      {
        label: 'toggle',
        code: "wm.toggle('win-console');",
        hint: "Toggle a window's visibility",
      },
      {
        label: 'focus',
        code: "wm.focus('win-editor');",
        hint: 'Bring a window to front',
      },
      {
        label: 'move',
        code: "wm.move('win-canvas', 200, 100);",
        hint: 'Move a window — x, y in pixels from top-left of desktop',
      },
      {
        label: 'resize',
        code: "wm.resize('win-canvas', 640, 480);",
        hint: 'Resize a window — width, height in pixels',
      },
      {
        label: 'maximize',
        code: "wm.maximize('win-canvas');",
        hint: 'Maximize a window to fill the desktop',
      },
      {
        label: 'restore',
        code: "wm.restore('win-canvas');",
        hint: 'Restore a maximized window to its previous size',
      },
      {
        label: 'remove (destroy window)',
        code: "const id = wm.spawn('Temp', { type: 'html', html: 'bye' });\n// fully tear down + remove from DOM (close() only hides):\nwm.remove(id);",
        hint: "wm.remove(id, opts?) — permanently destroy a spawned window and remove it from the DOM. opts.animate:false skips the close transition. Use over wm.close (which only hides). No-op if id isn't a spawned window.",
      },
      {
        label: 'spawn html',
        code: "const id = wm.spawn('Info', { type: 'html', html: '<h2>hello</h2>', onClose: stopRunning });\n// wm.close(id);",
        hint: 'Spawn a floating window with arbitrary HTML content. onClose: fn → called when window is closed (e.g. stopRunning)',
      },
      {
        label: 'spawn image',
        code: "const src = await wm.pickFile('photo');\nwm.spawn('photo', { type: 'image', src, w: 480, h: 360 });",
        hint: 'Pick an image file once (cached by key), spawn it in a window',
      },
      {
        label: 'spawn video',
        code: "const src = await wm.pickFile('clip');\nwm.spawn('video', { type: 'video', src, w: 640, h: 480, controls: true });",
        hint: 'Pick a video file once (cached by key), spawn it in a window',
      },
      {
        label: 'pickFile',
        code: "const url = await wm.pickFile('myFile');\n// url is a blob URL — reuse key to skip picker next time",
        hint: 'Pick a file via browser picker — caches the handle by key, no re-prompt while permission active',
      },
      {
        label: 'browse dir',
        code: "await wm.browse('myDir', (url, name) => {\n  wm.spawn(name, { type: 'image', src: url, w: 480, h: 360 });\n});",
        hint: 'Open a directory picker and spawn a file browser window — click any file to get its blob URL',
      },
      {
        label: 'spawn camera',
        code: "const id = wm.spawn('camera', { type: 'camera', w: 320, h: 240 });",
        hint: 'Spawn a window mirroring the camera feed',
      },
      {
        label: 'spawn canvas',
        code: "const id = wm.spawn('canvas', { type: 'canvas', z: 0, w: 640, h: 480 });",
        hint: 'Spawn a window mirroring a canvas layer at z-index z',
      },
      {
        label: 'spawn shader',
        code: "const s = new Shader(`...`).start();\nconst id = wm.spawn('FX', { type: 'shader', shader: s, w: 640, h: 480 });",
        hint: "Spawn a window mirroring a Shader's output canvas",
      },
      {
        label: 'spawn visualizer',
        code: "wm.spawn('Visualizer', { type: 'viz', w: 400, h: 240 });",
        hint: 'Spawn an audio visualizer window — pick source (master, mic, video, channel) and style (bars, wave, ring) from built-in controls',
      },
      {
        label: 'apply shader to window',
        code: "// Apply a WebGPU shader directly inside any window — renders on top of its content\n// Auto-detects canvas/video source inside the window as video: input\nconst s = wm.applyShader('win-canvas-1', `\n  let col = textureSample(video, videoSampler, uv);\n  let grey = col.r * 0.299 + col.g * 0.587 + col.b * 0.114;\n  return vec4f(grey, grey * 0.8, grey * 0.6, 1.0);\n`);\n// s is a live Shader — s.set([...]), s.opacity(0.5), s.stop()",
        hint: "wm.applyShader(winId, wgslCode, opts?) — mounts a shader canvas inside the target window's body. Auto-detects video source (canvas, camera, video element). Returns the Shader. Pass video: explicitly in opts to override.",
      },
      {
        label: 'apply shader to camera window',
        code: "// Enable camera in toolbar first\nconst s = wm.applyShader('win-camera', `\n  let col = textureSample(video, videoSampler, uv);\n  let inv = vec4f(1.0 - col.r, 1.0 - col.g, 1.0 - col.b, 1.0);\n  return mix(col, inv, abs(sin(time)));\n`);\n// Pulses between normal and inverted camera feed",
        hint: 'wm.applyShader on the camera window auto-detects the camera canvas as the video source — no extra setup needed.',
      },
      {
        label: 'list windows',
        code: 'console.log(wm.list());',
        hint: 'List all current window ids in the desktop',
      },
      {
        label: 'spawn transparent',
        code: "const id = wm.spawn('Overlay', { type: 'html', html: '<p style=\"color:#fff\">Hi</p>', transparent: true, noChrome: true, w: 200, h: 80 });",
        hint: 'Spawn a window transparent and chrome-free immediately — no need to click the ghost button afterwards',
      },
      {
        label: 'setZ / setOpacity',
        code: 'wm.setZ(id, 9999);       // raise window stacking order\nwm.setOpacity(id, 0.5); // 0 = invisible, 1 = opaque',
        hint: 'Live-update window z-index and CSS opacity without re-spawning',
      },
      {
        label: 'sync video',
        code: "// Sync button in video window titlebar syncs all other video windows to same currentTime\n// Or call from code:\nconst vid = document.querySelector('#win-spawn-1 video');\nconst t = vid?.currentTime ?? 0;\ndocument.querySelectorAll('.wm-body video').forEach(v => { if (v !== vid) v.currentTime = t; });",
        hint: 'Use the ⟳ button in video window titlebar to sync playback time with all other video windows',
      },
    ],
  },
  {
    name: 'Desktop',
    commands: [
      {
        label: 'desktop.files()',
        code: "// List all files currently on the desktop\nconsole.log(desktop.files());\n// Each: { id, name, type, url, x, y }\n// type: 'image' | 'video' | 'audio' | 'code' | 'file'",
        hint: 'desktop.files() → array of { id, name, type, url, x, y }. Drop files from OS onto the IDE desktop to create icons.',
      },
      {
        label: 'desktop.onFile — shader',
        code: "// Auto-load any dropped image or video as shader texture\ndesktop.onFile(f => {\n  if (f.type !== 'image' && f.type !== 'video') return;\n  const el = f.type === 'image'\n    ? Object.assign(new Image(), { src: f.url })\n    : Object.assign(document.createElement('video'), { src: f.url, loop: true, muted: true });\n  if (f.type === 'video') el.play();\n  new Shader(({ uv, col }) => [col.r, col.g, col.b, col.a], { video: el }).start();\n});",
        hint: 'desktop.onFile(fn) — fires whenever a file is dropped or added. fn receives { id, name, type, url, el }. Cleared on reset.',
      },
      {
        label: 'desktop.onFile — audio',
        code: "// Play any audio file dropped onto desktop\ndesktop.onFile(f => {\n  if (f.type !== 'audio') return;\n  const a = new Audio(f.url);\n  a.play();\n});",
        hint: "Use desktop.onFile to auto-handle specific file types. type is 'image' | 'video' | 'audio' | 'code' | 'file'.",
      },
      {
        label: 'desktop.onFile — video signal',
        code: "// Route any dropped video into the video signal bus\ndesktop.onFile(f => {\n  if (f.type !== 'video') return;\n  const v = Object.assign(document.createElement('video'), { src: f.url, loop: true, muted: true });\n  v.play();\n  const sig = video.signal(v);\n  sig.stream(s => console.log('brightness:', s.brightness.toFixed(3)));\n});",
        hint: 'Dropped videos become video.signal() sources — feed into shaders, draw, or audio triggers.',
      },
      {
        label: 'desktop.add',
        code: "// Add an icon programmatically (e.g. from a fetch'd image)\ndesktop.add('https://example.com/photo.jpg', { name: 'photo.jpg', x: 100, y: 100 });",
        hint: 'desktop.add(url, { name, type, x, y }) — create a file icon without drag-drop. type auto-detected from name if omitted.',
      },
      {
        label: 'desktop.add — styled',
        code: "desktop.add(url, {\n  name: 'photo.jpg',\n  x: 100, y: 100,\n  glyph: '🎸',          // custom emoji (overrides thumbnail)\n  glyphBg: '#1a0d2e',   // glyph box background color\n  glyphColor: '#cba6f7', // glyph text color\n  rotation: 15,          // tilt in degrees\n  tint: 180,             // hue-rotate in degrees (thumbnail, skipped when glyph is set)\n  scale: 1.3,            // scale factor\n  animate: 'spin',       // 'spin' | 'bounce' | 'pulse' | CSS animation string\n  labelPosition: 'above', // 'above' | 'below' (default)\n  labelColor: '#ff0',   // label text color\n  labelSize: 12,         // label font size in px\n  labelFont: 'monospace', // label font family\n  badge: '3',            // small badge overlay (top-right)\n  badgeColor: '#4caf50', // badge background color (default red)\n  tooltip: 'My file',   // hover tooltip\n});",
        hint: 'Visual opts: glyph (emoji — wins over thumbnail), glyphBg/glyphColor, rotation/scale/tint/animate, labelPosition/Color/Size/Font, badge/badgeColor, tooltip. All persist in project save.',
      },
      {
        label: 'desktop.update',
        code: "const { id } = desktop.add(null, { name: 'note.txt', type: 'code', x: 100, y: 100 });\n// Later — update appearance:\ndesktop.update(id, { glyph: '🔴', labelColor: '#ff4444', badge: '!' });\n// Or move it:\ndesktop.move(id, 200, 300);",
        hint: 'desktop.update(id, opts) — merge new iconOpts and re-render the icon. desktop.move(id, x, y) — reposition without full re-render.',
      },
      {
        label: 'desktop.onClick',
        code: "const { id } = desktop.add('https://example.com/photo.jpg', { name: 'photo.jpg', x: 150, y: 100 });\ndesktop.onClick(id, ({ name, type, url }) => {\n  console.log('opened:', name);\n  // trigger something when double-clicked\n});",
        hint: 'desktop.onClick(id, fn) — per-icon double-click callback. fn receives { id, name, type, url }. Run-scoped: cleared on code reset.',
      },
      {
        label: 'desktop.get',
        code: 'const info = desktop.get(id);\n// → { id, name, type, url, x, y, iconOpts } | null',
        hint: 'desktop.get(id) — read current state of an icon. Returns null if id not found.',
      },
      {
        label: 'desktop.clear',
        code: 'desktop.clear(); // remove all icons',
        hint: 'desktop.clear() removes all file icons from the desktop.',
      },
    ],
  },
  {
    name: 'Sensors',
    commands: [
      {
        label: 'mouse position',
        code: "const mouse = hold('window:mouse:move');\ntick(16).do(() => {\n  canvas.clear();\n  canvas.circle(mouse.x, mouse.y, 20, 'white');\n});",
        hint: "hold('window:mouse:move') → live { x, y, winId }. x/y in viewport pixels. Use inside tick() for polling.",
      },
      {
        label: 'mouse → shader',
        code: "const mouse = hold('window:mouse:move');\nconst s = new Shader(({ uv, time, custom }) => {\n  const d = length(uv - vec2(custom.x, custom.y));\n  return [1.0 - smoothstep(0.0, 0.1, d), uv.y, uv.x, 1.0];\n});\ntick(16).do(() => s.set([mouse.x / canvas.width, mouse.y / canvas.height, 0, 0]));\ns.start();",
        hint: "Pipe live mouse position into shader uniform each tick via hold('window:mouse:move').",
      },
      {
        label: 'mouse click',
        code: "on('window:mouse:click').do(({ button, x, y }) => {\n  if (button === 0) canvas.circle(x, y, 10, 'white');\n});",
        hint: "on('window:mouse:click') — button: 0=left, 2=right. x/y in viewport pixels. winId tags which WM window was clicked.",
      },
      {
        label: 'gamepad',
        code: "// Connect a gamepad first (press any button to activate)\non('sensor:gamepad').do(({ index, axes, pressed }) => {\n  if (index !== 0) return;\n  const x = axes[0]; // left stick X  -1..1\n  const y = axes[1]; // left stick Y  -1..1\n  canvas.clear();\n  canvas.circle(800 + x * 300, 450 + y * 300, 30, 'white');\n  if (pressed[0]) canvas.bg('#222'); // A button\n});",
        hint: 'sensor:gamepad — lazy source, starts polling on first subscriber. { index, axes[], buttons[], pressed[] }. Standard mapping: pressed[0]=A/Cross, pressed[1]=B/Circle.',
      },
      {
        label: 'motion (device tilt)',
        code: "// iOS: requires user gesture to grant permission — wrap in a button click\non('sensor:motion').do(({ ax, ay, az, alpha, beta, gamma, magnitude }) => {\n  canvas.clear();\n  canvas.circle(800 + gamma * 6, 450 - beta * 6, 20, 'cyan');\n});",
        hint: 'sensor:motion — lazy source, starts on first subscriber. { ax, ay, az (m/s²), alpha (compass 0–360), beta (-180..180), gamma (-90..90), magnitude }.',
      },
      {
        label: 'shake',
        code: "on('sensor:shake').when(d => d.magnitude > 20).do(() => {\n  canvas.clear();\n  canvas.bg(Color.random());\n});",
        hint: 'sensor:shake — fires alongside sensor:motion. { magnitude } in m/s². Threshold 15 = moderate, 25 = hard shake.',
      },
      {
        label: 'geolocation',
        code: "on('sensor:geo').do(({ lat, lon, accuracy }) => {\n  console.log(`${lat.toFixed(5)}, ${lon.toFixed(5)} ±${accuracy|0}m`);\n});\n// Source starts watchPosition on first subscriber; browser asks for permission.",
        hint: 'sensor:geo — lazy watchPosition source. { lat, lon, accuracy, speed, heading }. Permission prompt on first subscriber.',
      },
      {
        label: 'network',
        code: "on('sensor:network').do(({ online, type, downlink }) => {\n  console.log(online ? `online (${type}, ${downlink}Mbps)` : 'offline');\n});",
        hint: 'sensor:network — lazy source, fires on online/offline/type change. { online, type, downlink, rtt }. Chrome/Edge only for type/downlink/rtt.',
      },
      {
        label: 'battery',
        code: "on('sensor:battery').do(({ level, charging }) => {\n  console.log(`${(level * 100)|0}% ${charging ? '⚡ charging' : 'discharging'}`);\n});",
        hint: 'sensor:battery — lazy source. { level (0–1), charging }. Chrome/Edge only.',
      },
      {
        label: 'haptics',
        code: "emit('haptics:vibrate', { pattern: 200 }); // 200ms\nemit('haptics:tap', {});                    // 40ms tap\nemit('haptics:buzz', { ms: 500 });          // 500ms buzz\nemit('haptics:stop', {});                   // stop",
        hint: 'Haptics are commandable events — emit() actuates navigator.vibrate(). pattern can be ms or [on,off,on,…]. Mobile only.',
      },
      {
        label: 'sensor gauge — motion',
        code: "wm.spawn('Motion', { type: 'sensor', source: 'motion', w: 480, h: 200 });",
        hint: 'wm.spawn sensor type — live bar chart for ax/ay/az accelerometer and alpha/beta/gamma orientation.',
        tags: ['sensor', 'gauge', 'motion', 'accelerometer'],
      },
      {
        label: 'sensor gauge — gamepad',
        code: "// Connect gamepad first (press any button to activate)\nwm.spawn('Gamepad', { type: 'sensor', source: 'gamepad', w: 380, h: 200 });",
        hint: 'wm.spawn sensor type — live dial gauges for axes 0–3 and button state indicators.',
        tags: ['sensor', 'gauge', 'gamepad', 'controller'],
      },
      {
        label: 'sensor gauge — geo',
        code: "wm.spawn('Geolocation', { type: 'sensor', source: 'geo', w: 280, h: 200 });",
        hint: 'wm.spawn sensor type — live lat/lon/alt/speed/heading readout. Browser asks for location permission.',
        tags: ['sensor', 'gauge', 'geo', 'gps', 'location'],
      },
      {
        label: 'sensor gauge — battery',
        code: "wm.spawn('Battery', { type: 'sensor', source: 'battery', w: 220, h: 160 });",
        hint: 'wm.spawn sensor type — live battery level indicator with charging status.',
        tags: ['sensor', 'gauge', 'battery'],
      },
    ],
  },
  {
    name: 'PIXI',
    commands: [
      {
        label: 'why PIXI vs Shader',
        code: '// PIXI (WebGL) — use for: sprites, scene graph, particles, hit-testing, text rendering, filters on objects\n// Shader/GLShader — use for: full-screen pixel effects, procedural textures, camera FX\n// They layer: PIXI canvas (z=25) sits between draw (z=0) and Shader (z=30)\n\n// Quick example — bouncing sprite\nconst sprite = new PIXI.Graphics();\nsprite.beginFill(0xff6600);\nsprite.drawCircle(0, 0, 40);\nsprite.endFill();\nsprite.x = pixi.screen.width / 2;\nsprite.y = pixi.screen.height / 2;\nStage.addChild(sprite);\n\nlet vx = 4, vy = 3;\npixi.tick(() => {\n  sprite.x += vx;\n  sprite.y += vy;\n  if (sprite.x < 0 || sprite.x > pixi.screen.width)  vx *= -1;\n  if (sprite.y < 0 || sprite.y > pixi.screen.height) vy *= -1;\n});',
        hint: 'PIXI (WebGL): scene graph / sprites / particles / per-object effects. GLShader/Shader: full-screen GPU effects. They layer cleanly — PIXI at z=25, Shader at z=30.',
      },
      {
        label: 'sprite from URL',
        code: "const sprite = PIXI.Sprite.from('https://example.com/hero.png');\nsprite.anchor.set(0.5);\nsprite.x = pixi.screen.width / 2;\nsprite.y = pixi.screen.height / 2;\nStage.addChild(sprite);\n\npixi.tick(delta => {\n  sprite.rotation += 0.02;\n});",
        hint: 'PIXI.Sprite.from(url) — load and display an image. anchor.set(0.5) centers the origin. pixi.tick(fn) — cleaned up on Stop.',
      },
      {
        label: 'graphics shapes',
        code: 'const g = new PIXI.Graphics();\ng.beginFill(0xff6600);\ng.drawRoundedRect(-60, -40, 120, 80, 15);\ng.endFill();\ng.lineStyle(4, 0xffffff);\ng.drawCircle(0, 0, 30);\ng.x = pixi.screen.width / 2;\ng.y = pixi.screen.height / 2;\nStage.addChild(g);\n\npixi.tick(() => { g.rotation += 0.01; });',
        hint: 'PIXI.Graphics — immediate-mode vector drawing with scene graph positioning. Shapes: drawRect, drawCircle, drawRoundedRect, drawPolygon, drawEllipse, lineTo/moveTo.',
      },
      {
        label: 'PIXI text',
        code: "const style = new PIXI.TextStyle({\n  fontFamily: 'Arial', fontSize: 48,\n  fill: '#ffffff', fontWeight: 'bold',\n  dropShadow: true, dropShadowDistance: 4,\n});\nconst label = new PIXI.Text('hello pixi', style);\nlabel.anchor.set(0.5);\nlabel.x = pixi.screen.width / 2;\nlabel.y = pixi.screen.height / 2;\nStage.addChild(label);\n\npixi.tick(t => { label.text = `t = ${pixi.ticker.lastTime.toFixed(0)}ms`; });",
        hint: 'PIXI.Text + PIXI.TextStyle — rich text with shadows, stroke, font. Better than canvas.text() for animating, filtering, or hit-testing text.',
      },
      {
        label: 'container + children',
        code: 'const group = new PIXI.Container();\nfor (let i = 0; i < 8; i++) {\n  const circle = new PIXI.Graphics();\n  const angle = (i / 8) * Math.PI * 2;\n  circle.beginFill(0x4488ff);\n  circle.drawCircle(Math.cos(angle) * 120, Math.sin(angle) * 120, 20);\n  circle.endFill();\n  group.addChild(circle);\n}\ngroup.x = pixi.screen.width / 2;\ngroup.y = pixi.screen.height / 2;\nStage.addChild(group);\n\npixi.tick(() => { group.rotation += 0.01; });',
        hint: 'PIXI.Container — group sprites/graphics and transform them together. All children inherit parent transform.',
      },
      {
        label: 'blur filter',
        code: "const sprite = PIXI.Sprite.from('https://example.com/photo.jpg');\nsprite.width  = pixi.screen.width;\nsprite.height = pixi.screen.height;\nconst blur = new PIXI.filters.BlurFilter();\nblur.blur = 10;\nsprite.filters = [blur];\nStage.addChild(sprite);\n\n// Animate blur based on mouse\nconst mouse = hold('window:mouse:move');\ntick(16).do(() => { blur.blur = (mouse.x / window.innerWidth) * 40; });",
        hint: 'PIXI.filters.BlurFilter — apply to any DisplayObject. Other built-ins: ColorMatrixFilter, AlphaFilter, DisplacementFilter. Multiple filters: sprite.filters = [f1, f2].',
      },
      {
        label: 'particle burst',
        code: "const particles = new PIXI.Container();\nStage.addChild(particles);\n\nfunction burst(x, y) {\n  for (let i = 0; i < 30; i++) {\n    const p = new PIXI.Graphics();\n    p.beginFill(Math.random() * 0xffffff);\n    p.drawCircle(0, 0, 4 + Math.random() * 8);\n    p.endFill();\n    p.x = x; p.y = y;\n    p.vx = (Math.random() - 0.5) * 12;\n    p.vy = (Math.random() - 0.5) * 12;\n    p.life = 1.0;\n    particles.addChild(p);\n  }\n}\n\ndocument.addEventListener('click', e => burst(e.clientX, e.clientY));\n\npixi.tick(delta => {\n  for (let i = particles.children.length - 1; i >= 0; i--) {\n    const p = particles.children[i];\n    p.x += p.vx; p.y += p.vy; p.vy += 0.4;\n    p.life -= 0.02;\n    p.alpha = p.life;\n    if (p.life <= 0) particles.removeChildAt(i);\n  }\n});",
        hint: 'Manual particle system — click to burst. PIXI scene graph makes per-particle transform and alpha trivial. For 10k+ particles use ParticleContainer instead.',
      },
      {
        label: 'audio reactive sprite',
        code: "const g = new PIXI.Graphics();\ng.x = pixi.screen.width / 2;\ng.y = pixi.screen.height / 2;\nStage.addChild(g);\n\nconst synth = audio.synth();\nconst sig = audio.signal(audio.master);\naudio.start();\n\npixi.tick(() => {\n  const level = sig.value; // 0–1 RMS\n  g.clear();\n  g.beginFill(0x4488ff);\n  g.drawCircle(0, 0, 20 + level * 200);\n  g.endFill();\n  if (Math.random() < 0.02) synth.play('C4', '16n');\n});",
        hint: 'Combine PIXI ticker with audio.signal() — read .value, .bass, .mid, .high each frame to drive visual properties.',
      },
      {
        label: 'hit testing / click',
        code: "const btn = new PIXI.Graphics();\nbtn.beginFill(0x4488ff);\nbtn.drawRoundedRect(0, 0, 200, 60, 12);\nbtn.endFill();\nbtn.x = pixi.screen.width / 2 - 100;\nbtn.y = pixi.screen.height / 2 - 30;\nbtn.interactive = true;\nbtn.cursor = 'pointer';\nbtn.on('pointerdown', () => canvas.bg(Color.random()));\nStage.addChild(btn);\n\nconst label = new PIXI.Text('Click me', { fill: '#fff', fontSize: 28 });\nlabel.anchor.set(0.5);\nlabel.x = 100; label.y = 30;\nbtn.addChild(label);",
        hint: "interactive = true + cursor = 'pointer' enables hit-testing. Events: pointerdown, pointerup, pointerover, pointerout, click. Works for any DisplayObject.",
      },
      {
        label: 'PIXI + WGSL shader layer',
        code: '// PIXI sprites at z=25, WGSL shader at z=30 — composited cleanly\nconst g = new PIXI.Graphics();\ng.beginFill(0xffffff);\ng.drawCircle(0, 0, 80);\ng.endFill();\ng.x = pixi.screen.width / 2;\ng.y = pixi.screen.height / 2;\nStage.addChild(g);\n\n// Shader overlays on top with glow\nconst s = new Shader(`\n  let d = length(uv - vec2f(0.5));\n  let glow = pow(max(0.0, 0.3 - d), 3.0) * 8.0;\n  return vec4f(0.2, 0.5, 1.0, glow);\n`);\ns.start();\n\npixi.tick(t => { g.rotation += 0.01; });',
        hint: 'PIXI (WebGL, z=25) and Shader (WebGPU, z=30) stack on separate canvases — combine scene graph objects with fullscreen GPU effects.',
      },
    ],
  },
  {
    name: 'GLShader',
    commands: [
      {
        label: 'why GLShader vs Shader',
        code: '// GLShader  — WebGL/GLSL  — works in ALL browsers (Chrome, Firefox, Safari, mobile)\n// Shader     — WebGPU/WGSL — Chrome 113+, Safari 18+, Edge 113+ only\n//\n// Same API: new GLShader(body, opts), .start(), .stop(), .set(), .bind(), .opacity(), .z()\n// GLSL has a massive training corpus — LLMs generate GLSL more fluently than WGSL\n// ShaderToy shaders (void mainImage) paste in directly with zero changes\n\nconst s = new GLShader(`\n  vec2 uv = gl_FragCoord.xy / uResolution;\n  float t = sin(uTime + uv.x * 10.0) * 0.5 + 0.5;\n  gl_FragColor = vec4(uv.x, t, uv.y, 1.0);\n`);\ns.start();',
        hint: 'GLShader (WebGL/GLSL): universal browser support, huge training corpus. Shader (WebGPU/WGSL): Chrome/Edge/Safari 18+ only, compute shaders, better GPU pipeline. Same .start()/.stop()/.set() API.',
      },
      {
        label: 'hello GLShader',
        code: '// Uniforms pre-declared: uResolution (vec2), uMouse (vec2 0-1), uTime (float), uCustom (vec4)\n// Pre-declared in body: uv (vec2 0-1), time, mouse, custom\nconst s = new GLShader(`\n  float r = sin(uv.x * 10.0 + uTime) * 0.5 + 0.5;\n  float g = cos(uv.y * 8.0  - uTime) * 0.5 + 0.5;\n  gl_FragColor = vec4(r, g, 0.5, 1.0);\n`);\ns.start();',
        hint: 'Write the fragment body — uv, time, mouse, custom pre-declared. Set gl_FragColor to output color. Same opts as Shader: { z, opacity, video }.',
      },
      {
        label: 'GLShader preset',
        code: '// GLSL_PRESETS: gradient, plasma, waves, circles, noise\nconst s = new GLShader(GLSL_PRESETS.plasma);\ns.start();',
        hint: 'GLSL_PRESETS — same set as SHADER_PRESETS but GLSL/WebGL. Each is a fragment body string.',
      },
      {
        label: 'ShaderToy paste-in',
        code: '// Paste ShaderToy code directly — void mainImage auto-detected and wrapped\nconst s = new GLShader(`\nvoid mainImage(out vec4 fragColor, in vec2 fragCoord) {\n  vec2 uv = fragCoord / uResolution;\n  vec3 col = 0.5 + 0.5 * cos(uTime + uv.xyx + vec3(0,2,4));\n  fragColor = vec4(col, 1.0);\n}\n`);\ns.start();',
        hint: 'GLShader detects void mainImage(out vec4, in vec2) and wraps it automatically. Paste ShaderToy code with no edits needed.',
      },
      {
        label: 'full GLSL program',
        code: '// Include void main() to take full control — no auto-wrapping\nconst s = new GLShader(`\nprecision highp float;\nuniform float uTime;\nvoid main() {\n  vec2 uv = gl_FragCoord.xy / vec2(1600.0, 900.0);\n  gl_FragColor = vec4(uv, sin(uTime)*0.5+0.5, 1.0);\n}\n`);\ns.start();',
        hint: "If fragSrc contains void main() it's used as-is (full GLSL program). Declare your own uniforms — uResolution/uTime/uMouse/uCustom are not injected.",
      },
      {
        label: 'video / camera input',
        code: '// uniform sampler2D uVideo auto-declared when video: is set\n// col = texture2D(uVideo, uv)  in body mode\nconst cam = new Camera();\nawait cam.open();\nconst s = new GLShader(`\n  vec4 col = texture2D(uVideo, uv);\n  float grey = dot(col.rgb, vec3(0.299, 0.587, 0.114));\n  gl_FragColor = vec4(grey, grey * 0.8, grey * 0.6, 1.0);\n`, { video: cam });\ns.start();',
        hint: 'Pass { video: cam } in opts — uVideo sampler2D declared, col (texture2D result) pre-assigned in body. Sources: Camera instance, HTMLVideoElement, HTMLCanvasElement.',
      },
      {
        label: 'custom uniform',
        code: 'const s = new GLShader(`\n  float r = sin(uv.x * 6.28 + uTime * uCustom.x) * 0.5 + 0.5;\n  gl_FragColor = vec4(r, uCustom.y, uCustom.z, 1.0);\n`);\ns.set([2.0, 0.3, 0.8, 0.0]); // speed, g, b, unused\ns.start();\n\n// Drive with audio:\nconst sig = audio.signal(audio.master);\naudio.start();\ns.bind(sig); // fills custom = [rms, bass, mid, high] each frame',
        hint: 's.set([x,y,z,w]) or s.set(index, value) — same as Shader.set(). s.bind(audioSignal) auto-fills uCustom = [rms, bass, mid, high] each frame.',
      },
      {
        label: 'GLShader + PIXI layer',
        code: "// GLShader full-screen (WebGL), PIXI sprites on top\nconst s = new GLShader(GLSL_PRESETS.plasma);\ns.start();\n\nconst label = new PIXI.Text('GLSL + PIXI', new PIXI.TextStyle({\n  fontSize: 64, fill: '#fff', fontWeight: 'bold',\n  dropShadow: true, dropShadowDistance: 6,\n}));\nlabel.anchor.set(0.5);\nlabel.x = pixi.screen.width / 2;\nlabel.y = pixi.screen.height / 2;\nStage.addChild(label);\n\npixi.tick(t => { label.rotation = Math.sin(pixi.ticker.lastTime / 1000) * 0.2; });",
        hint: 'GLShader (z=30) + PIXI (z=25) layer cleanly. Use GLShader for full-screen procedural backgrounds, PIXI for text/sprites/interactions on top.',
      },
    ],
  },
  {
    name: 'Three.js 3D',
    commands: [
      {
        label: 'spinning cube',
        code: 'const scene3 = new ThreeScene();\nconst geo  = new THREE.BoxGeometry();\nconst mat  = new THREE.MeshNormalMaterial();\nconst cube = new THREE.Mesh(geo, mat);\nscene3.add(cube);\nscene3.tick((dt) => { cube.rotation.x += dt; cube.rotation.y += dt * 0.7; });\nscene3.start();',
        hint: 'ThreeScene — WebGL 3D. THREE namespace is the full three.js object. tick(fn(dt, elapsed)) runs each frame. start() begins the render loop.',
        tags: ['three', '3d', 'cube', 'mesh'],
      },
      {
        label: 'audio-reactive geometry',
        code: "const scene3 = new ThreeScene();\nconst geo = new THREE.IcosahedronGeometry(1.5, 1);\nconst mat = new THREE.MeshNormalMaterial({ wireframe: true });\nconst mesh = new THREE.Mesh(geo, mat);\nscene3.add(mesh);\n\nscene3.bind('bass', () => audio.fft.bass);\nscene3.tick((dt, t) => {\n  const b = scene3.get('bass');\n  mesh.scale.setScalar(1 + b * 2);\n  mesh.rotation.y += dt * 0.5;\n});\nscene3.start();",
        hint: "scene3.bind(name, fn) registers a live signal. scene3.get(name) reads it each frame. Wire audio.fft, hold('window:mouse:move').x, etc.",
        tags: ['three', '3d', 'audio', 'reactive', 'icosahedron'],
      },
      {
        label: 'point cloud',
        code: "const scene3 = new ThreeScene({ alpha: true });\nconst N = 2000;\nconst positions = new Float32Array(N * 3);\nfor (let i = 0; i < N * 3; i++) positions[i] = (Math.random() - 0.5) * 8;\nconst geo = new THREE.BufferGeometry();\ngeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));\nconst mat = new THREE.PointsMaterial({ color: 0x00ffcc, size: 0.05 });\nconst pts = new THREE.Points(geo, mat);\nscene3.add(pts);\nscene3.tick(dt => { pts.rotation.y += dt * 0.1; });\nscene3.start();",
        hint: 'THREE.Points — scatter 3D point cloud. BufferGeometry with position attribute. PointsMaterial controls size/color.',
        tags: ['three', '3d', 'particles', 'points', 'cloud'],
      },
      {
        label: 'SDF raymarch shader',
        code: '// TSL (Three.js Shading Language) — WebGPU required (Chrome 113+)\n// Falls back to THREE standard materials on WebGL\nconst scene3 = new ThreeScene();\nconst geo = new THREE.PlaneGeometry(4, 4);\nconst mat = new THREE.MeshNormalMaterial();\nconst mesh = new THREE.Mesh(geo, mat);\nscene3.add(mesh);\nscene3.tick((dt, t) => { mesh.rotation.z += dt * 0.2; });\nscene3.start();\n// For full TSL raymarching: use THREE.MeshBasicNodeMaterial (WebGPU renderer)',
        hint: 'Three.js TSL (node materials) runs on WebGPU (Chrome 113+). For cross-browser SDF effects, combine GLShader + ThreeScene as layers.',
        tags: ['three', '3d', 'tsl', 'sdf', 'raymarch', 'webgpu'],
      },
      {
        label: 'scene opacity / z-order',
        code: 'const scene3 = new ThreeScene({ z: 35 });\n// ... add geometry ...\nscene3.start();\nscene3.opacity(0.8); // 0–1\nscene3.z(40);        // css z-index',
        hint: 'ThreeScene({ z }) sets CSS z-index of the renderer canvas. .opacity(v) fades the whole scene. Layer 3D above or below draw/shaders.',
        tags: ['three', '3d', 'layer', 'z-index', 'opacity'],
      },
      {
        label: 'scene.resize(w, h)',
        code: 'const scene3 = new ThreeScene({ width: 400, height: 400 });\n// ... mesh ...\nscene3.start();\n// resize later:\nscene3.resize(800, 600); // updates renderer + camera aspect',
        hint: 'ThreeScene({ width, height }) sets initial size. .resize(w, h) updates renderer size and camera aspect ratio.',
        tags: ['three', '3d', 'resize'],
      },
    ],
  },
  {
    name: 'ASCII Animation',
    commands: [
      {
        label: 'play ASCII frames',
        code: "const frames = [\n  '  o  \\n /|\\\\  \\n / \\\\ ',\n  '  o  \\n -|-  \\n / \\\\ ',\n];\nconst anim = ascii.play(frames, 8, { color: '#0f0', bg: '#000' });\nconst win = wm.spawn('ASCII Anim', { w: 300, h: 200 });\nwin.querySelector('.wm-body')?.appendChild(anim.el);",
        hint: 'ascii.play(frames, fps, opts) — plays an array of ASCII strings at fps. Returns {el, stop, start, loop, frame, fps}. Attach el to a wm window body.',
        tags: ['ascii', 'animation', 'text', 'art'],
      },
      {
        label: 'record ASCII from canvas',
        code: "// Capture ASCII frames from the current canvas for 2 seconds\nconst frames = await ascii.record(canvas.el, { fps: 12, duration: 2, cols: 60 });\nconsole.log('captured', frames.length, 'frames');\nconst anim = ascii.play(frames, 12);\nconst win = wm.spawn('Replay', { w: 400, h: 300 });\nwin.querySelector('.wm-body')?.appendChild(anim.el);",
        hint: 'ascii.record(source, opts) — captures ASCII frames from a canvas source over `duration` seconds. source: HTMLCanvasElement, GLShader, ThreeScene, or any object with .canvas.',
        tags: ['ascii', 'record', 'capture', 'animation'],
      },
      {
        label: 'loop / stop / frame control',
        code: "const anim = ascii.play(frames, 12);\nanim.loop(false);     // don't loop — stop at last frame\nanim.stop();          // stop playback\nanim.start();         // resume\nanim.frame(0);        // jump to frame 0\nanim.fps(24);         // change speed",
        hint: 'AsciiPlayer controls: .loop(bool), .stop(), .start(), .frame(n), .fps(n)',
        tags: ['ascii', 'animation', 'control'],
      },
    ],
  },
  {
    name: 'Pixel Art',
    commands: [
      {
        label: 'pixel-art sprite',
        code: "const sp = new Sprite({ width: 8, height: 8, scale: 16, frames: 2 });\n// Frame 0 — standing\nsp.frame(0);\nsp.fill(3, 0, 2, 2, '#f90'); // head\nsp.fill(3, 2, 2, 4, '#00f'); // body\n// Frame 1 — arms up\nsp.frame(1);\nsp.fill(3, 0, 2, 2, '#f90');\nsp.fill(2, 2, 4, 4, '#00f');\n// Animate\nsp.frame(0).play(6);\nsp.show('Sprite');",
        hint: 'Sprite({ width, height, scale, frames }) — pixel-grid animation. .pixel(x,y,color) sets one pixel. .fill(x,y,w,h,color) fills a rect. .play(fps) animates. .show(title) opens in a wm window.',
        tags: ['sprite', 'pixel', 'art', 'animation', 'mosaic'],
      },
      {
        label: 'draw frame with raw ctx',
        code: "const sp = new Sprite({ width: 16, height: 16, scale: 10 });\n// Draw with raw 2d context\nconst ctx = sp.ctx(); // 16×16 2d context\nctx.fillStyle = '#ff0';\nctx.fillRect(4, 4, 8, 8);\nctx.fillStyle = '#f00';\nctx.fillRect(6, 6, 4, 4);\nsp._render(); // push to display canvas\nsp.show('Sprite');",
        hint: 'sp.ctx(frameIndex?) returns the raw 2d context at pixel resolution — draw anything with canvas 2D API. Call sp._render() after drawing to update the display canvas.',
        tags: ['sprite', 'pixel', 'art', 'canvas', '2d', 'ctx', 'raw'],
      },
      {
        label: 'onion skin',
        code: "const sp = new Sprite({ width: 12, height: 12, scale: 12, frames: 3 });\nsp.onionSkin(0.25); // show prev frame at 25% opacity\n// draw frames...\nsp.play(4);\nsp.show('Onion');",
        hint: 'sp.onionSkin(alpha) — shows the previous frame semi-transparently while editing. Classic animation aid.',
        tags: ['sprite', 'onion', 'skin', 'animation'],
      },
      {
        label: 'addFrame + loop',
        code: "const sp = new Sprite({ width: 8, height: 8, scale: 16, bg: '#111' });\nfor (let i = 0; i < 4; i++) {\n  const fi = i === 0 ? 0 : sp.addFrame();\n  sp.frame(fi);\n  sp.fill(i * 2, 0, 2, 8, `hsl(${i*90},80%,60%)`);\n}\nsp.play(8);\nsp.show('Loop');",
        hint: 'sp.addFrame() adds a blank frame and returns its index. sp.frame(n) switches drawing target.',
        tags: ['sprite', 'frames', 'loop', 'animation'],
      },
      {
        label: 'open pixel art editor (GUI)',
        code: 'spriteEditor({ width: 16, height: 16, scale: 20 });',
        hint: 'spriteEditor(opts) — opens the pixel art editor: pencil/eraser/fill/eyedropper/line/rect tools, palette, frame timeline with onion skin, play/stop, and export to code/PNG/spritesheet.',
        tags: ['sprite', 'editor', 'paint', 'pixel', 'pixel art', 'aseprite', 'gui', 'visual'],
      },
      {
        label: 'edit existing sprite',
        code: "const sp = new Sprite({ width: 16, height: 16, scale: 20 });\nsp.show('Preview');\nsp.edit(); // opens visual editor on this sprite",
        hint: 'sp.edit() opens the sprite editor linked to an existing Sprite instance. Paint in the editor and sp.canvas updates live. The live JS handle lets you read frames, call sp.play(), etc.',
        tags: ['sprite', 'editor', 'edit', 'paint', 'pixel', 'aseprite'],
      },
    ],
  },
  {
    name: 'Paint Canvas',
    commands: [
      {
        label: 'open paint canvas (GUI)',
        code: 'paint({ width: 400, height: 300 });',
        hint: 'paint(opts) — opens the freehand doodle canvas: pen/eraser/line/rect/ellipse/fill/eyedropper tools, adjustable brush size, smooth strokes, animation frames with onion skin, play/stop, undo/redo, autosave to desktop icon, export PNG/sheet/code.',
        tags: ['paint', 'draw', 'doodle', 'pen', 'sketch', 'freehand', 'gui', 'visual', 'canvas'],
      },
      {
        label: 'paint with multiple frames',
        code: "paint({ width: 400, height: 300, frames: 4, fps: 8, bg: '#1a1a2e' });",
        hint: 'paint({ width, height, frames, fps, bg }) — open with N frames pre-created. Use the frame strip to add/delete/reorder frames. Play/stop animates them.',
        tags: ['paint', 'draw', 'doodle', 'animation', 'frames', 'gui', 'visual'],
      },
      {
        label: 'paint over an image (backdrop)',
        code: "paint({ width: 400, height: 300, backdrop: 'https://example.com/photo.jpg' });",
        hint: 'paint({ backdrop }) — opens with an image as a reference layer beneath strokes. Click the 🖼 button in the toolbar to load/clear backdrops. Export PNG composites the backdrop + drawing. Supports image URLs, dataURLs, and video files (live mode keeps the video playing under your strokes).',
        tags: ['paint', 'draw', 'backdrop', 'image', 'reference', 'trace', 'annotate', 'overlay'],
      },
      {
        label: 'paint over a video (live backdrop)',
        code: "paint({ width: 640, height: 360, backdrop: 'video.mp4', backdropMode: 'live' });",
        hint: "paint({ backdrop, backdropMode:'live' }) — live video underlay: the video keeps playing beneath your drawing. Use 📷 Freeze frame in the 🖼 menu to bake the current frame into a static image for tracing. Export composites the snapshot + drawing.",
        tags: ['paint', 'draw', 'video', 'backdrop', 'live', 'trace', 'annotate'],
      },
    ],
  },
  {
    name: 'ASCII Editor',
    commands: [
      {
        label: 'open ASCII editor (GUI)',
        code: 'asciiEditor({ cols: 64, rows: 24 });',
        hint: 'asciiEditor(opts) — opens an interactive colored ASCII art editor: type/brush/eraser/fill/eyedropper/line/rect tools, per-cell fg+bg colors, char palette, animation frames with onion skin, undo/redo, autosave to desktop icon. Export: ascii.play() code snippet (colored), plain text, ANSI escape codes.',
        tags: [
          'ascii',
          'text',
          'art',
          'glyph',
          'editor',
          'gui',
          'visual',
          'ansi',
          'terminal',
          'character',
        ],
      },
      {
        label: 'ASCII editor with frames',
        code: "asciiEditor({ cols: 80, rows: 40, frames: 4, fps: 8, bg: '#0d0208' });",
        hint: 'asciiEditor({ cols, rows, frames, fps, bg }) — open with N frames pre-created for animation. Use the frame strip to add/delete/reorder frames. Play/stop animates them. Export Code inserts an ascii.play([...]) snippet that replays with full color.',
        tags: ['ascii', 'art', 'animation', 'frames', 'ansi', 'terminal', 'colored'],
      },
      // ── Art-widget event / signal entries ─────────────────────────────────
      {
        label: 'paint.onStroke — react to each stroke',
        code: "const p = paint({ width: 400, height: 300 });\np.onStroke(({ tool, color, bbox }) => {\n  console.log('stroke', tool, color, bbox);\n});",
        hint: 'p.onStroke(fn) — fn fires after each brush/eraser/fill stroke. Payload: { tool, color, frame, bbox:{x,y,w,h} }. Returns p for chaining.',
        tags: ['paint', 'event', 'stroke', 'hook', 'react', 'trigger', 'on'],
      },
      {
        label: 'paint.onColor — react to color change',
        code: "const p = paint({ width: 400, height: 300 });\np.onColor(({ color, prev }) => {\n  console.log('color →', color);\n});",
        hint: 'p.onColor(fn) — fires when the active paint color changes (palette, custom input, eyedropper). Payload: { color, prev }.',
        tags: ['paint', 'event', 'color', 'hook', 'react', 'on'],
      },
      {
        label: 'paint.signal — decaying-pulse from stroke',
        code: "const p = paint({ width: 400, height: 300 });\nconst sig = p.signal('stroke', { decay: 300 });\nsetInterval(() => {\n  canvas.bg(`hsl(200,80%,${sig.value * 50}%)`);\n}, 16);",
        hint: 'p.signal(event?, { decay, region }) → { value, velocity, stream(fn), on(fn) }. value=1 on stroke, decays to 0 over decay ms. Region { x,y,w,h } in canvas px filters to a spatial area.',
        tags: ['paint', 'signal', 'decay', 'reactive', 'shader', 'region'],
      },
      {
        label: 'paint.signal with region',
        code: "const p = paint({ width: 400, height: 300 });\n// React only to strokes in the left half\nconst sig = p.signal('stroke', { decay: 400, region: { x: 0, y: 0, w: 200, h: 300 } });\nsig.stream(s => canvas.bg(`hsl(280,80%,${s.value * 40}%)`));",
        hint: 'region:{x,y,w,h} scopes the signal to a canvas region. .stream(fn) pushes value on every animation frame via RAF.',
        tags: ['paint', 'signal', 'region', 'spatial', 'decay', 'stream'],
      },
      {
        label: 'paint.onFrame — frame changes',
        code: "const p = paint({ width: 400, height: 300, frames: 4 });\np.onFrame(({ action, index, count }) => {\n  console.log(action, 'frame', index, 'of', count);\n});",
        hint: 'p.onFrame(fn) — fires on add/duplicate/clear/delete/move/select of animation frames. Payload: { action, index, count }.',
        tags: ['paint', 'event', 'frame', 'animation', 'hook'],
      },
      {
        label: 'spriteEditor.onPixel — per-pixel hook',
        code: "const sp = spriteEditor({ width: 16, height: 16, scale: 16 });\nsp.onPixel(({ x, y, color }) => {\n  console.log('pixel at', x, y, color);\n});",
        hint: 'sp.onPixel(fn) — fires for every individual pixel painted (per pointer event, no debounce). Payload: { x, y, color, frame }. Use for precise per-cell triggers.',
        tags: ['sprite', 'editor', 'pixel', 'event', 'hook', 'react', 'on'],
      },
      {
        label: 'spriteEditor.onStroke — per-stroke hook',
        code: "const sp = spriteEditor({ width: 16, height: 16, scale: 16 });\nsp.onStroke(({ tool, bbox }) => {\n  console.log('stroke', tool, bbox);\n});",
        hint: 'sp.onStroke(fn) — fires at pointerup / fill commit. Payload: { tool, color, frame, bbox:{x,y,w,h} } in sprite px (scale-independent).',
        tags: ['sprite', 'editor', 'stroke', 'event', 'hook', 'react', 'on'],
      },
      {
        label: 'spriteEditor.signal — decaying pixel signal',
        code: "const sp = spriteEditor({ width: 16, height: 16, scale: 16 });\nconst sig = sp.signal('pixel', { decay: 200 });\nsig.stream(s => canvas.circle(200, 200, s.value * 80, '#f38ba8'));",
        hint: "sp.signal(event?, {decay, region}) → decaying 0–1 signal. event: 'pixel'|'stroke'|'color'|'frame'|'*'. region scopes to sprite-pixel bbox.",
        tags: ['sprite', 'editor', 'signal', 'decay', 'reactive', 'pixel', 'stream'],
      },
      {
        label: 'spriteEditor.signal region (corner)',
        code: "const sp = spriteEditor({ width: 16, height: 16, scale: 16 });\n// fire only when painting top-left 4×4\nconst sig = sp.signal('pixel', { decay: 300, region: { x: 0, y: 0, w: 4, h: 4 } });\nsetInterval(() => canvas.bg(`hsl(120,70%,${sig.value*40}%)`), 16);",
        hint: 'region:{x,y,w,h} filters to sprite-pixel coordinates (NOT screen px). Lets you make different canvas regions control different parameters.',
        tags: ['sprite', 'editor', 'signal', 'region', 'spatial', 'decay'],
      },
      {
        label: 'asciiEditor.onCell — per-cell hook',
        code: "const ae = asciiEditor({ cols: 40, rows: 20 });\nae.onCell(({ c, r, ch, fg }) => {\n  console.log(`cell [${c},${r}] = '${ch}' fg:${fg}`);\n});",
        hint: 'ae.onCell(fn) — fires for every cell changed (brush, fill, shape, type). Suppressed during resize. Payload: { c, r, ch, fg, bg, frame }.',
        tags: ['ascii', 'editor', 'cell', 'event', 'hook', 'react', 'on'],
      },
      {
        label: 'asciiEditor.onChar — char change hook',
        code: "const ae = asciiEditor({ cols: 40, rows: 20 });\nae.onChar(({ char, prev }) => {\n  console.log('char →', char);\n});",
        hint: 'ae.onChar(fn) — fires when the active character changes (palette or custom input or eyedropper). Payload: { char, prev }.',
        tags: ['ascii', 'editor', 'char', 'event', 'hook', 'on'],
      },
      {
        label: 'asciiEditor.signal — decaying cell signal',
        code: "const ae = asciiEditor({ cols: 40, rows: 20 });\nconst sig = ae.signal('cell', { decay: 250 });\nsig.stream(s => canvas.bg(`hsl(55,90%,${s.value * 30}%)`));",
        hint: "ae.signal(event?, {decay, region}) → 0–1 decaying signal. event: 'cell'|'stroke'|'color'|'char'|'frame'|'*'. region in cell coords {x,y,w,h}.",
        tags: ['ascii', 'editor', 'signal', 'decay', 'cell', 'reactive', 'stream'],
      },
      {
        label: 'asciiEditor.signal region (cell grid)',
        code: "const ae = asciiEditor({ cols: 40, rows: 20 });\n// top-left 10×5 cell region\nconst sig = ae.signal('cell', { decay: 300, region: { x: 0, y: 0, w: 10, h: 5 } });\nsetInterval(() => canvas.bg(`hsl(200,80%,${sig.value*40}%)`), 16);",
        hint: 'region:{x,y,w,h} filters to cell column/row coordinates (not pixels). Lets you spatially map art regions to audio parameters, shader uniforms, etc.',
        tags: ['ascii', 'editor', 'signal', 'region', 'spatial', 'decay', 'cell'],
      },
      {
        label: 'wm.onStroke — paint overlay hook',
        code: "const id = wm.spawn('My Image', { type: 'image', html: '<img src=\"photo.jpg\">' });\nwm.onStroke(id, ({ tool, color, bbox }) => {\n  console.log('overlay stroke', tool, color, bbox);\n});",
        hint: 'wm.onStroke(id, fn) — fires when a stroke is drawn on the 🖌️ paint overlay of any window. id from wm.spawn() or wm.getByTitle(). Payload: { tool, color, winId, bbox:{x,y,w,h} }.',
        tags: ['wm', 'overlay', 'paint', 'stroke', 'event', 'hook', 'window'],
      },
      {
        label: 'wm.paintSignal — overlay signal',
        code: "const id = wm.spawn('Cam', { type: 'camera' });\nconst sig = wm.paintSignal(id, 'stroke', { decay: 300 });\nsetInterval(() => canvas.bg(`hsl(280,80%,${sig.value * 40}%)`), 16);",
        hint: 'wm.paintSignal(id, event?, opts?) → { value, velocity, stream, on }. Live 0–1 signal from the paint overlay on a window. Supports region:{x,y,w,h} in overlay canvas px.',
        tags: ['wm', 'overlay', 'paint', 'signal', 'decay', 'reactive', 'window', 'stream'],
      },
      {
        label: 'wm.addText — live text overlay',
        code: "const cam = wm.spawn('Cam', { type: 'camera', w: 640, h: 480 });\nconst t = wm.addText(cam, 'Hello', 40, 40, {\n  fontSize: 36, color: '#fff', bold: true,\n});\n// live-update each tick:\nlet n = 0;\ntick(() => t.setText('frame: ' + n++));\n// t.setStyle({ color:'#f00', rotation: 15, kerning: 2 })\n// t.moveTo(100, 80)\n// t.remove()",
        hint: "wm.addText(winId, text, x, y, opts?) — place a text object on any visual window. Returns a handle: setText / setStyle / moveTo / remove / on('move'|'edit'|'select'|'deselect'). Run-scoped (cleared on reset). opts: { fontSize, fontFamily, color, bold, italic, align, rotation, kerning, curve:{type:'arc',radius} }.",
        tags: ['wm', 'text', 'overlay', 'live', 'camera', 'label', 'font', 'arc'],
      },
      {
        label: 'wm.addText — arc curve',
        code: "const id = wm.spawn('Canvas', { type: 'canvas', w: 500, h: 500 });\nwm.addText(id, 'VISUAL LIVE', 250, 200, {\n  fontSize: 28, color: '#cba6f7', bold: true,\n  curve: { type: 'arc', radius: 120 },\n  kerning: 3,\n});",
        hint: "curve:{type:'arc',radius} — positive radius arcs text upward, negative arcs downward. The (x,y) position is the visual anchor at the midpoint of the arc.",
        tags: ['wm', 'text', 'arc', 'curve', 'overlay', 'font'],
      },
      {
        label: 'wm.bounds — live window size',
        code: "route(Source.camera)\n  .tap('audio:word:final', ({ word }, winId) => {\n    const b = wm.bounds(winId);\n    if (!b) return;\n    wm.addText(winId, word, Math.random() * b.w, Math.random() * b.h, { decay: 4000 });\n  })\n  .show('Karaoke');",
        hint: "wm.bounds(winId) — current inner size of a window's body as { w, h, left, top } in canvas px, or null. Re-read each call so it tracks live resizes. Pair with wm.addText to keep spawned text on-screen after a resize.",
        tags: ['wm', 'bounds', 'size', 'resize', 'addText', 'overlay'],
      },
    ],
  },
  {
    name: 'Desktop Shell',
    commands: [
      {
        label: 'environment detection',
        code: "console.log('isDesktop:', shell.isDesktop, 'isElectron:', shell.isElectron, 'isTauri:', shell.isTauri, 'isBrowser:', shell.isBrowser);",
        hint: 'shell.isDesktop / .isElectron / .isTauri / .isBrowser — detect runtime environment. Always safe to call; returns false in browser.',
        tags: ['shell', 'electron', 'tauri', 'desktop', 'detect'],
      },
      {
        label: 'status bar text',
        code: "shell.status('Audio: ' + Math.round(audio.fft.bass * 100) + '%');\n// clear when done\n// shell.clearStatus();",
        hint: 'shell.status(text) — set native status bar text in Electron/Tauri desktop shell. No-op in browser. .clearStatus() clears it.',
        tags: ['shell', 'status', 'statusbar', 'desktop'],
      },
      {
        label: 'save file (native)',
        code: "const el = canvas.el;\nel.toBlob(async blob => {\n  const buf = await blob.arrayBuffer();\n  await shell.saveFile(buf, { defaultPath: 'export.png', filters: [{ name: 'PNG', extensions: ['png'] }] });\n});",
        hint: 'shell.saveFile(data, opts) — native save dialog in Electron/Tauri. Falls back to browser download in static-site mode.',
        tags: ['shell', 'save', 'file', 'export', 'download'],
      },
      {
        label: 'set window title',
        code: "shell.setTitle('My Visual Synth — Live');",
        hint: 'shell.setTitle(text) — set native window title in Electron/Tauri. Falls back to document.title in browser.',
        tags: ['shell', 'title', 'window', 'desktop'],
      },
    ],
  },
  {
    name: 'MIDI',
    commands: [
      {
        label: 'open MIDI + monitor',
        code: "await midi.open();\nconsole.log('MIDI inputs:', midi.inputs().map(i => i.name));\nmidi.spawn('MIDI Monitor');",
        hint: 'midi.open() → Promise. Requests Web MIDI access. midi.inputs() → array of {id, name, manufacturer, state}. midi.spawn(title) opens a live event monitor window.',
        tags: ['midi', 'music', 'input', 'monitor'],
      },
      {
        label: 'note on/off handler',
        code: "await midi.open();\nmidi.onNote(({ type, note, velocity, channel }) => {\n  console.log(type, note, velocity, 'ch', channel);\n  if (type === 'noteon') canvas.circle(note * 6, 300, velocity, `hsl(${note*3},80%,60%)`);\n});",
        hint: "midi.onNote(fn) — fn({type:'noteon'|'noteoff', note, velocity, channel}). Called for every note event on any channel.",
        tags: ['midi', 'note', 'noteon', 'noteoff'],
      },
      {
        label: 'CC signal (knob/fader)',
        code: "await midi.open();\nconst vol = midi.signal(0, 7);  // ch 0, CC 7 = volume\nsetInterval(() => {\n  canvas.clear();\n  canvas.rect(100, 100, vol.value * 400, 40, '#0f0');\n}, 30);",
        hint: 'midi.signal(channel, cc) → {value} — live 0–1 signal updated on each CC message. Use as shader .bind() source or animation driver.',
        tags: ['midi', 'cc', 'knob', 'signal', 'fader'],
      },
      {
        label: 'CC change handler',
        code: "await midi.open();\nmidi.onCC(0, 1, value => {\n  console.log('mod wheel:', value.toFixed(2));\n});",
        hint: 'midi.onCC(channel, cc, fn) — fn(value 0–1) fires when matching CC changes.',
        tags: ['midi', 'cc', 'handler'],
      },
    ],
  },
  {
    name: 'External Data',
    commands: [
      {
        label: 'weather signal',
        code: "const w = await external.weather(37.7749, -122.4194);  // San Francisco\nconsole.log('temp:', w.temperature, '°C  wind:', w.windSpeed, 'km/h');\n\n// drive a shader with temperature\nnew GLShader(GLSL_PRESETS.plasma).set(0, w.temperature / 40).start();",
        hint: 'external.weather(lat, lon) → WeatherSignal with .temperature, .windSpeed, .precipitation, .humidity. Powered by open-meteo (no API key). .stream(fn, intervalMs) polls for updates.',
        tags: ['external', 'weather', 'data', 'signal', 'open-meteo'],
      },
      {
        label: 'live weather stream',
        code: "const w = await external.weather(51.5074, -0.1278);  // London\nw.stream(sig => {\n  const t = sig.temperature ?? 0;\n  canvas.clear();\n  canvas.text(`🌡 ${t.toFixed(1)}°C  💨 ${(sig.windSpeed??0).toFixed(0)} km/h`, 40, 200, { size: 36, color: t > 20 ? '#f80' : '#0af' });\n}, 60000);",
        hint: 'WeatherSignal.stream(fn, intervalMs=60000) — calls fn(signal) immediately, then every intervalMs. Refreshes from open-meteo API.',
        tags: ['external', 'weather', 'stream', 'live'],
      },
      {
        label: 'generic JSON signal',
        code: "// Poll any JSON endpoint as a live signal\nconst price = await external.signal(\n  'https://api.coinbase.com/v2/prices/BTC-USD/spot',\n  json => parseFloat(json.data.amount)\n);\nconsole.log('BTC:', price.value);\n\nprice.stream(s => canvas.text('$' + s.value.toFixed(2), 50, 300, { size: 40, color: '#f80' }), 10000);",
        hint: 'external.signal(url, selector, intervalMs) → DataSignal with .value. selector(json) extracts the value from the response.',
        tags: ['external', 'fetch', 'json', 'signal', 'poll'],
      },
    ],
  },
  {
    name: 'Window Physics',
    commands: [
      {
        label: 'enable physics',
        code: "wm.physics(true, { gravity: 0.3 });\n// Bounce all windows with gravity\nwm.push('win-editor', 4, -8);  // toss the editor window",
        hint: 'wm.physics(on, opts) — toggle window physics. opts: { gravity (px/frame²) }. wm.push(id, vx, vy) applies velocity impulse. AABB bounce off desktop edges with elasticity.',
        tags: ['physics', 'window', 'bounce', 'gravity'],
      },
      {
        label: 'push window',
        code: "wm.physics(true);\n// Give all windows a random push\nconst ids = ['win-editor', 'win-canvas', 'win-console'];\nids.forEach(id => {\n  wm.push(id, (Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20);\n});",
        hint: 'wm.push(id, vx, vy) — applies velocity impulse to a window. Works even without physics(); physics() must be enabled for the motion to animate.',
        tags: ['physics', 'push', 'impulse', 'window'],
      },
      {
        label: 'gravity off',
        code: 'wm.gravity(0);   // kill gravity\n// or\nwm.physics(false); // stop physics entirely',
        hint: 'wm.gravity(g) — set gravity constant (px/frame²). 0 = zero gravity (float). wm.physics(false) stops the physics loop.',
        tags: ['physics', 'gravity', 'stop'],
      },
    ],
  },
  {
    name: 'Status Bar',
    commands: [
      {
        label: 'status bar text',
        code: "statusBar.set('Live — BPM: 120 | CPU: 12%');",
        hint: 'statusBar.set(text) — set status bar text. Spawns a slim borderless wm window at the bottom of the desktop on first call.',
        tags: ['statusbar', 'status', 'hud', 'widget'],
      },
      {
        label: 'status bar + widget',
        code: "statusBar.set('Ready');\nstatusBar.add('<span style=\"color:#0f0;background:#002;padding:2px 6px;border-radius:3px;\">● LIVE</span>');\n\n// Update status periodically\nsetInterval(() => statusBar.set('BPM: 120 | ' + new Date().toLocaleTimeString()), 1000);",
        hint: 'statusBar.add(htmlString) — appends HTML widget to the right side of the status bar. statusBar.clear() removes all content. statusBar.hide()/show() toggle visibility.',
        tags: ['statusbar', 'widget', 'add', 'html'],
      },
    ],
  },
  {
    name: 'Haptics',
    commands: [
      {
        label: 'vibrate pulse',
        code: "emit('haptics:vibrate', { pattern: 200 });  // 200ms vibration\n// emit('haptics:vibrate', { pattern: [200, 100, 200] }); // on/off pattern",
        hint: "emit('haptics:vibrate', { pattern }) — commandable bus event. pattern: number (ms) or array [on,off,on,…]. Mobile devices + some controllers.",
        tags: ['haptics', 'vibrate', 'sensor', 'mobile'],
      },
      {
        label: 'haptics shortcuts',
        code: "emit('haptics:tap', {});           // 40ms\nemit('haptics:buzz', { ms: 500 }); // 500ms\nemit('haptics:stop', {});          // stop",
        hint: 'haptics:tap / :buzz / :stop — commandable shortcuts. All call navigator.vibrate(). Ignored if Vibration API unavailable.',
        tags: ['haptics', 'tap', 'buzz', 'pulse', 'mobile'],
      },
    ],
  },
  {
    name: 'Serial / GPIO',
    commands: [
      {
        label: 'connect (button click)',
        code: "// serial:connect requires a user gesture — wire to a button\nconst btn = wm.spawn('Serial', { html: '<button id=\"b\" style=\"margin:16px;font-size:18px\">Connect</button>' });\ndocument.getElementById(btn)?.querySelector('#b')?.addEventListener('click', () => {\n  emit('serial:connect', { baudRate: 115200 });\n});\n\non('serial:status').do(({ connected }) => {\n  console.log(connected ? 'Serial connected' : 'Serial disconnected');\n});",
        hint: "serial:connect { baudRate?=115200, parse?, serialize?, mode?='text' } — commandable, MUST be called from a user gesture (button click). Triggers browser port-picker. Chrome/Edge only.",
        tags: ['serial', 'webserial', 'connect', 'hardware', 'arduino'],
      },
      {
        label: 'read lines',
        code: "on('sensor:serial:data').do(({ line }) => {\n  console.log('serial:', line);\n});",
        hint: 'sensor:serial:data { line } — fires per newline in text mode (default). Always fires raw line regardless of parse result. Use for debugging or custom protocols.',
        tags: ['serial', 'read', 'data', 'line', 'arduino'],
      },
      {
        label: 'GPIO pin read',
        code: "// Arduino: Serial.println(String(analogRead(A0)) + ':' + String(digitalRead(13)));\n// Default parse expects 'PIN:VALUE\\n' format\non('gpio:pin').do(({ pin, value }) => {\n  console.log(`pin ${pin} = ${value}`);\n  if (pin === 0) canvas.bg(`hsl(${value / 4}, 80%, 50%)`);\n});",
        hint: "gpio:pin { pin, value } — fires when default parse(line) matches 'PIN:VALUE\\n'. fires alongside sensor:serial:data so raw line is always accessible. Default: Serial.println(String(pin) + ':' + String(value));",
        tags: ['gpio', 'pin', 'arduino', 'serial', 'analog', 'digital'],
      },
      {
        label: 'GPIO pin write',
        code: "// Toggle Arduino LED (pin 13)\nemit('gpio:write', { pin: 13, value: 1 });  // HIGH\n// emit('gpio:write', { pin: 13, value: 0 });  // LOW",
        hint: "gpio:write { pin, value } — commandable, serializes to 'PIN:VALUE\\n' via default serialize and writes to serial port. Arduino reads: if (Serial.available()) { String s = Serial.readStringUntil('\\n'); /* parse s */ }",
        tags: ['gpio', 'write', 'output', 'arduino', 'led', 'digital'],
      },
      {
        label: 'custom parse + serialize',
        code: '// Connect with custom protocol — e.g. JSON lines: {"p":13,"v":512}\nemit(\'serial:connect\', {\n  baudRate: 115200,\n  parse: line => {\n    try {\n      const { p, v } = JSON.parse(line);\n      return (p != null && v != null) ? { pin: p, value: v } : null;\n    } catch { return null; }\n  },\n  serialize: ({ pin, value }) => JSON.stringify({ p: pin, v: value }) + \'\\n\',\n});',
        hint: 'parse(line) → { pin, value } | null overrides the default PIN:VALUE splitter. serialize({ pin, value }) → string overrides gpio:write output. null from parse suppresses gpio:pin but sensor:serial:data still fires.',
        tags: ['serial', 'custom', 'protocol', 'json', 'parse', 'serialize'],
      },
      {
        label: 'raw write',
        code: "// Send arbitrary data to the device\nemit('serial:write', { data: 'RESET\\n' });\n// Binary:\n// emit('serial:write', { data: new Uint8Array([0xFF, 0x00, 0x01]) });",
        hint: "serial:write { data } — raw write. data can be a string (auto-encoded UTF-8) or Uint8Array. Use when gpio:write protocol doesn't fit.",
        tags: ['serial', 'write', 'raw', 'binary', 'command'],
      },
      {
        label: 'binary mode',
        code: "emit('serial:connect', { baudRate: 115200, mode: 'binary' });\n\non('sensor:serial:data').do(({ bytes }) => {\n  // bytes is a Uint8Array chunk\n  console.log('bytes:', bytes);\n});",
        hint: "mode:'binary' — skips TextDecoder and line-split; emits raw Uint8Array chunks. gpio:pin never fires in binary mode — parse the bytes yourself.",
        tags: ['serial', 'binary', 'uint8array', 'raw', 'protocol'],
      },
      {
        label: 'disconnect',
        code: "emit('serial:disconnect', {});\n// or check status:\nconst status = hold('serial:status');\nconsole.log(status.connected); // true | false",
        hint: "serial:disconnect — aborts the read pipe and closes the port. hold('serial:status').connected for live state.",
        tags: ['serial', 'disconnect', 'close', 'status'],
      },
      {
        label: 'Arduino GPIO Bridge sketch',
        code: "/*\n  Arduino GPIO Bridge — paste into Arduino IDE, upload, then:\n    emit('serial:connect', { baudRate: 115200 });\n\n  Reads: on('gpio:pin', ({pin, value}) => ...) — analog pins 0–5, digital 2–7\n  Writes: emit('gpio:write', { pin: 13, value: 1 }); — toggles outputs\n\n  --------------------------------------------------\n  void setup() {\n    Serial.begin(115200);\n    for (int i = 2; i <= 7; i++) pinMode(i, OUTPUT);\n  }\n\n  void loop() {\n    // Send all analog reads\n    for (int i = 0; i <= 5; i++) {\n      Serial.println(String(i) + \":\" + String(analogRead(i)));\n    }\n    // Receive gpio:write commands\n    while (Serial.available()) {\n      String s = Serial.readStringUntil('\\n');\n      int colon = s.indexOf(':');\n      if (colon > 0) {\n        int pin = s.substring(0, colon).toInt();\n        int val = s.substring(colon + 1).toInt();\n        digitalWrite(pin, val ? HIGH : LOW);\n      }\n    }\n    delay(50);\n  }\n  --------------------------------------------------\n*/\nconsole.log('Copy the sketch from the comment above into Arduino IDE');",
        hint: "Canonical Arduino GPIO Bridge sketch. Sends 'PIN:VALUE\\n' lines for analog reads; receives 'PIN:VALUE\\n' for digital writes. Compatible with default gpio:pin parse and gpio:write serialize.",
        tags: ['arduino', 'sketch', 'gpio', 'bridge', 'example'],
      },
    ],
  },
  {
    name: 'Plugin iframes',
    commands: [
      {
        label: 'inline HTML plugin',
        code: "const html = `<!DOCTYPE html><html><body style=\"background:#111;color:#0f0;font:20px monospace;display:flex;align-items:center;justify-content:center;height:100vh;margin:0\">\n  <div id=\"out\">waiting…</div>\n</body></html>`;\n\nconst p = PluginHost.create(html);\np.on('greeting', msg => console.log('from plugin:', msg));\np.spawn('My Plugin', { w: 300, h: 200 });",
        hint: 'PluginHost.create(htmlString) — wraps HTML in a sandboxed blob iframe window. vlPlugin is injected: vlPlugin.send(type, val) to talk to host; vlPlugin.on(type, fn) to receive.',
        tags: ['plugin', 'iframe', 'sandbox', 'html'],
      },
      {
        label: 'signal bridge → plugin',
        code: "const p = PluginHost.create(`<!DOCTYPE html><html><body style=\"background:#000;margin:0\">\n  <canvas id=\"c\" width=\"300\" height=\"200\"></canvas>\n  <script>\n    const ctx = document.getElementById('c').getContext('2d');\n    vlPlugin.on('bass', v => {\n      ctx.fillStyle = 'black';\n      ctx.fillRect(0, 0, 300, 200);\n      const r = v * 80 + 20;\n      ctx.fillStyle = '#0f0';\n      ctx.beginPath();\n      ctx.arc(150, 100, r, 0, Math.PI * 2);\n      ctx.fill();\n    });\n  <\\/script>\n</body></html>`);\n\np.bridge('bass', () => audio.fft.bass);\np.spawn('Audio-reactive Plugin', { w: 320, h: 240 });",
        hint: "plugin.bridge(name, fn) — calls fn() each RAF and sends result to iframe as vlPlugin event. Use for pushing audio.fft, hold('window:mouse:move'), etc. into plugin.",
        tags: ['plugin', 'bridge', 'signal', 'audio', 'reactive'],
      },
      {
        label: 'load URL plugin',
        code: "const p = PluginHost.load('https://example.com/plugin/');\np.on('output', val => console.log('plugin output:', val));\np.spawn('External Plugin', { w: 500, h: 400 });",
        hint: 'PluginHost.load(url) — loads an external URL in a sandboxed iframe window. Same API: p.send(), p.on(), p.bridge(). Cross-origin canvas sharing via vlPlugin.shareCanvas(canvas).',
        tags: ['plugin', 'iframe', 'url', 'external'],
      },
      {
        label: 'canvas from plugin',
        code: '// Plugin shares its canvas with the host for use as a shader input\nconst html = `<!DOCTYPE html><html><body style="margin:0">\n  <canvas id="c" width="320" height="240"></canvas>\n  <script>\n    // ... draw to canvas ...\n    vlPlugin.shareCanvas(document.getElementById(\'c\'));\n  <\\/script>\n</body></html>`;\n\nconst p = PluginHost.create(html);\np.spawn(\'Canvas Plugin\', { w: 320, h: 240 });\n\n// After plugin loads, use its canvas as a GLShader input:\nsetTimeout(() => {\n  const canvas = p.canvas;\n  if (canvas) new GLShader(GLSL_PRESETS.gradient, { video: canvas }).start();\n}, 500);',
        hint: 'vlPlugin.shareCanvas(canvas) — plugin shares its canvas via ImageBitmap transfer each RAF. p.canvas on the host returns the mirror canvas, usable as GLShader/pipe video input.',
        tags: ['plugin', 'canvas', 'shader', 'input', 'cross-origin'],
      },
    ],
  },
  {
    name: 'Signal Graph',
    commands: [
      {
        label: 'show signal graph',
        code: 'signalGraph.show();',
        hint: 'Opens a read-only window showing active signal sources, sinks, and routing connections. Live nodes appear as colored boxes with edges for registered routes.',
        tags: ['signal', 'graph', 'routing', 'debug', 'visualize'],
      },
      {
        label: 'register route',
        code: "signalGraph.route('audio.fft.bass', 'ThreeScene', 'bass→scale');\nsignalGraph.show();",
        hint: 'signalGraph.route(source, sink, label) manually registers a signal connection for the graph view. ThreeScene.bind() auto-registers.',
        tags: ['signal', 'graph', 'route', 'connect'],
      },
    ],
  },
  {
    name: 'Notepad',
    commands: [
      {
        label: 'spawn notepad',
        code: "const note = new Notepad({ title: 'Poem', w: 400, h: 320 });",
        hint: 'Create a rich-text Notepad window. Optional: title, x, y, w, h, content (HTML or text).',
        tags: ['notepad', 'text', 'window'],
      },
      {
        label: 'type text',
        code: "await note.type('hello world', { cps: 15 });",
        hint: 'Animate typing into the notepad at cps characters per second. Returns a Promise.',
        tags: ['notepad', 'type', 'animate', 'poetry'],
      },
      {
        label: 'backspace',
        code: 'await note.backspace(5, { cps: 20 });',
        hint: 'Animate deleting n characters backwards from the caret. Returns a Promise.',
        tags: ['notepad', 'delete', 'animate'],
      },
      {
        label: 'cursor position',
        code: 'note.cursor(0);',
        hint: 'Move the caret to a flat textContent offset.',
        tags: ['notepad', 'cursor', 'position'],
      },
      {
        label: 'select range',
        code: 'note.select(0, 5);',
        hint: 'Select text from flat offset `from` to `to`.',
        tags: ['notepad', 'select', 'range'],
      },
      {
        label: 'insert text',
        code: "note.insert('new text', 0);",
        hint: 'Insert text at a flat offset (default: current caret). Preserves surrounding formatting.',
        tags: ['notepad', 'insert', 'text'],
      },
      {
        label: 'replace range',
        code: "note.replace(0, 5, 'new');",
        hint: 'Replace text in [from, to) with a new string.',
        tags: ['notepad', 'replace', 'edit'],
      },
      {
        label: 'bold / italic / underline',
        code: 'note.select(0, 5);\nnote.bold();\nnote.italic(6, 11);\nnote.underline(12, 18);',
        hint: 'Toggle bold, italic, or underline on a range (or current selection if no args).',
        tags: ['notepad', 'bold', 'italic', 'underline', 'format'],
      },
      {
        label: 'text color',
        code: "note.color('#e74c3c', 0, 5);",
        hint: 'Set foreground color on a range. CSS color string.',
        tags: ['notepad', 'color', 'format'],
      },
      {
        label: 'highlight',
        code: "note.highlight('#ffe082', 0, 5);",
        hint: 'Set background highlight color on a range. CSS color string.',
        tags: ['notepad', 'highlight', 'format'],
      },
      {
        label: 'on note:char',
        code: "on('note:char').do(({ char, winId }) => {\n  // fires for every character typed by type()\n});",
        hint: 'React to each character as it is typed by note.type(). payload: { winId, char, index }',
        tags: ['notepad', 'event', 'char'],
      },
      {
        label: 'on note:done',
        code: "on('note:done').do(({ text, winId }) => {\n  console.log('typing done:', text);\n});",
        hint: 'Fires when type() or backspace() finishes. payload: { winId, text }',
        tags: ['notepad', 'event', 'done'],
      },
      {
        label: 'note text + html',
        code: 'console.log(note.text);  // plain text\nconsole.log(note.html);  // sanitized innerHTML',
        hint: 'Read the current content as plain text or sanitized HTML.',
        tags: ['notepad', 'text', 'html', 'read'],
      },
      {
        label: 'poetry pattern',
        code: "const poem = new Notepad({ title: 'Poem' });\non('note:char').do(() => note(\"c5\").play());\nawait poem.type('the quiet\\nbetween words', { cps: 12 });\npoem.color('#c0392b', 0, 9);",
        hint: 'Full poetry pattern: type text with a sound per character, then color words.',
        tags: ['notepad', 'poetry', 'pattern', 'example'],
      },
    ],
  },
  {
    name: 'Actors',
    commands: [
      {
        label: 'pattern with id',
        code: 'note("c2*2 e2").fast(2).play(); // synth groove (no samples); for drums: samples(\'github:tidalcycles/dirt-samples\'); s("bd*2 sd")',
        hint: 'Start a pattern and give it a named id so you can control it via events later.',
        tags: ['pattern', 'actor', 'id', 'audio'],
      },
      {
        label: 'stop pattern',
        code: "emit('pattern:stop', { id: 'groove' });",
        hint: 'Stop a named pattern actor by id.',
        tags: ['pattern', 'actor', 'stop'],
      },
      {
        label: 'restart pattern',
        code: "emit('pattern:start', { id: 'groove' });",
        hint: 'Restart a stopped pattern actor by id.',
        tags: ['pattern', 'actor', 'start'],
      },
      {
        label: 'on pattern hit',
        code: "on('groove:bd').do(() => {\n  // fires on every bd hit in pattern 'groove'\n});",
        hint: "React to a specific instrument hit in a named pattern. Replace 'bd' with any mini-notation value.",
        tags: ['pattern', 'actor', 'on', 'reactive'],
      },
      {
        label: 'on any hit',
        code: "on('groove:hit').do(({ value, velocity, dur }) => {\n  // fires on every hit in pattern 'groove'\n});",
        hint: 'React to any hit in a named pattern. Payload: { value, velocity, dur }.',
        tags: ['pattern', 'actor', 'on', 'reactive'],
      },
      {
        label: 'pipeline with id',
        code: "pipe(cam)\n  .ascii({ cols: 80 }, 'chars')\n  .glshader('rainbow', {}, 'color')\n  .show('Output', { id: 'viz' });",
        hint: 'Build a named pipeline with named stages. Each stage and the pipeline are addressable by id.',
        tags: ['pipeline', 'actor', 'id'],
      },
      {
        label: 'stop pipeline',
        code: "emit('pipe:stop', { id: 'viz' });",
        hint: 'Stop a named pipeline actor by id.',
        tags: ['pipeline', 'actor', 'stop'],
      },
      {
        label: 'set stage uniform',
        code: "emit('pipe:stage:set-uniform', { stageId: 'color', name: 'hue', value: 0.5 });",
        hint: 'Set a GLSL/WGSL uniform on a named shader stage inside a pipeline.',
        tags: ['pipeline', 'actor', 'shader', 'uniform'],
      },
      {
        label: 'set stage props',
        code: "emit('pipe:stage:set', { stageId: 'chars', color: '#ff0066', bg: '#000' });",
        hint: 'Update properties on a named canvas stage (ascii: color/bg/charset; fx: filter; pixelate: blockSize).',
        tags: ['pipeline', 'actor', 'stage', 'set'],
      },
      {
        label: 'cross-actor wire',
        code: "on('groove:bd').do(() => emit('pipe:stage:set-uniform', { stageId: 'color', name: 'flash', value: 1 }));",
        hint: 'Wire audio beat events to visual pipeline params — the core reactive pattern.',
        tags: ['actor', 'reactive', 'pattern', 'pipeline', 'wire'],
      },
    ],
  },
  {
    name: 'Capture',
    commands: [
      {
        label: 'webcam photo',
        code: "const cam = await Camera.open();\nawait cam.photo({ name: 'selfie', download: true });",
        hint: 'Take a still photo from the webcam. Saves a .jpg to the desktop and optionally downloads it.',
        tags: ['camera', 'photo', 'capture', 'image'],
      },
      {
        label: 'webcam record',
        code: "const cam = await Camera.open();\nconst rec = cam.record({ name: 'clip' });\n// later: rec.stop();",
        hint: 'Record webcam video to a .webm desktop icon. Call rec.stop() to finish.',
        tags: ['camera', 'record', 'video', 'capture'],
      },
      {
        label: 'record output window',
        code: "const r = wm.record('win-canvas-1', { fps: 30 });\n// later:\nwm.stopRecording('win-canvas-1');",
        hint: 'Record any canvas/shader/camera output window to a .webm desktop icon.',
        tags: ['record', 'window', 'video', 'capture'],
      },
      {
        label: 'snapshot window',
        code: "wm.snapshot('win-canvas-1');",
        hint: 'Snapshot any visual window to a persistent PNG desktop icon.',
        tags: ['snapshot', 'photo', 'window', 'capture'],
      },
      {
        label: 'snapshot + download',
        code: "wm.snapshot('win-canvas-1', { download: true });",
        hint: 'Snapshot a window to desktop AND download the file immediately.',
        tags: ['snapshot', 'download', 'capture'],
      },
      {
        label: 'stop recording',
        code: 'rec.stop();',
        hint: 'Stop a Recording returned by cam.record() or wm.record().',
        tags: ['record', 'stop', 'capture'],
      },
    ],
  },
  {
    name: 'Performance',
    commands: [
      {
        label: 'replay a take',
        code: "const p = new Piano({ preset: 'epiano' });\np.replay([\n  { t: 0,   note: 'C4', dur: 200 },\n  { t: 300, note: 'E4', dur: 200 },\n  { t: 600, note: 'G4', dur: 400 },\n]);",
        hint: "Replay a recorded performance (Take) as timed code. Use a widget's Capture ● button to record one.",
        tags: ['performance', 'replay', 'take', 'record'],
      },
      {
        label: 'timeline (multi-widget)',
        code: 'timeline()\n  .track(p,  pianoTake, { at: 0 })\n  .track(dp, drumTake,  { at: 0 })\n  .play();',
        hint: 'Compose recorded Takes across multiple widgets on one clock. `at` offsets a take so you can splice different takes at different times.',
        tags: ['timeline', 'performance', 'replay', 'compose', 'splice'],
      },
      {
        label: 'loop a take',
        code: 'p.replay(take, { loop: true });',
        hint: 'Replay a Take on repeat. Same for timeline().play({ loop: true }).',
        tags: ['performance', 'replay', 'loop'],
      },
    ],
  },
];

/**
 * Add snippet entries to the toolkit API drawer, creating a new category if needed.
 * Called by api-registry.js when registerAPI is used with ext.toolkit.
 * @param {string} categoryName
 * @param {Array<{label: string, code: string, hint: string}>} entries
 */
export function addToolkitEntries(categoryName, entries) {
  const existing = TOOLKIT_CATEGORIES.find((c) => c.name === categoryName);
  if (existing) {
    existing.commands.push(...entries);
  } else {
    TOOLKIT_CATEGORIES.push({ name: categoryName, commands: entries });
  }
}
