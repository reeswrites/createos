// Block→JS code generators — one javascriptGenerator.forBlock entry per block
// type, registered at module load (side-effect import). The matching block shapes
// live in blocks-defs.js; the toolbox + workspace adapter in blocks.js. A block
// type string must agree across all three (ADR 011 coverage gate polices it).
import * as Blockly from 'blockly';
import { javascriptGenerator, Order } from 'blockly/javascript';

// ── Code generators ──────────────────────────────────────────────────────────

// Override text_print → console.log
javascriptGenerator.forBlock['text_print'] = (b, g) => {
  const val = g.valueToCode(b, 'TEXT', Order.NONE) || "''";
  return `console.log(${val});\n`;
};

// Control
javascriptGenerator.forBlock['ctrl_interval'] = (b, g) => {
  const ms = b.getFieldValue('MS');
  const body = g.statementToCode(b, 'DO');
  return `setInterval(() => {\n${body}}, ${ms});\n`;
};
javascriptGenerator.forBlock['ctrl_timeout'] = (b, g) => {
  const ms = b.getFieldValue('MS');
  const body = g.statementToCode(b, 'DO');
  return `setTimeout(() => {\n${body}}, ${ms});\n`;
};
javascriptGenerator.forBlock['ctrl_onkey'] = (b, g) => {
  const key = b.getFieldValue('KEY');
  const body = g.statementToCode(b, 'DO');
  return `onKey(${JSON.stringify(key)}, (e) => {\n${body}});\n`;
};
javascriptGenerator.forBlock['ctrl_stop'] = () => 'stop();\n';
javascriptGenerator.forBlock['ctrl_pause'] = () => 'pause();\n';
javascriptGenerator.forBlock['ctrl_resume'] = () => 'resume();\n';
javascriptGenerator.forBlock['ctrl_random'] = (b) => {
  const lo = b.getFieldValue('LO');
  const hi = b.getFieldValue('HI');
  return [`randUni(${lo}, ${hi})`, Order.FUNCTION_CALL];
};
javascriptGenerator.forBlock['ctrl_random_color'] = () => ['Color.random()', Order.FUNCTION_CALL];

// Raw JS passthrough (ADR 037) — emit the stored source verbatim.
javascriptGenerator.forBlock['js_raw'] = (b) => {
  const code = b.getFieldValue('CODE') || '';
  return code.trim() ? code.replace(/\n+$/, '') + '\n' : '';
};

// Audio
javascriptGenerator.forBlock['audio_create_synth'] = (b) => {
  const t = b.getFieldValue('TYPE');
  return [`audio.${t}()`, Order.FUNCTION_CALL];
};
javascriptGenerator.forBlock['audio_play'] = (b, g) => {
  const note = b.getFieldValue('NOTE');
  const dur = b.getFieldValue('DUR');
  const synth = g.valueToCode(b, 'SYNTH', Order.NONE) || 'null';
  return `(${synth}).play(${JSON.stringify(note)}, ${JSON.stringify(dur)});\n`;
};
javascriptGenerator.forBlock['audio_bpm'] = (b) => `audio.bpm(${b.getFieldValue('BPM')});\n`;
javascriptGenerator.forBlock['mixer_show'] = () => `mixer.show();\n`;
javascriptGenerator.forBlock['mixer_volume'] = (b) => {
  const n = b.getFieldValue('NAME');
  const target = n === 'master' ? 'mixer.master' : `mixer.strip('${n}')`;
  return `${target}.volume(${b.getFieldValue('DB')});\n`;
};
javascriptGenerator.forBlock['mixer_pan'] = (b) =>
  `mixer.strip('${b.getFieldValue('NAME')}').pan(${b.getFieldValue('PAN')});\n`;
javascriptGenerator.forBlock['mixer_mute'] = (b) => {
  const n = b.getFieldValue('NAME');
  const target = n === 'master' ? 'mixer.master' : `mixer.strip('${n}')`;
  return `${target}.mute(${b.getFieldValue('STATE')});\n`;
};
javascriptGenerator.forBlock['audio_transport_start'] = () => 'audio.start();\n';
javascriptGenerator.forBlock['audio_volume'] = (b) => `audio.volume(${b.getFieldValue('DB')});\n`;
javascriptGenerator.forBlock['audio_reverb'] = (b) => [
  `audio.reverb(${b.getFieldValue('DEC')})`,
  Order.FUNCTION_CALL,
];
javascriptGenerator.forBlock['audio_delay'] = (b) => [
  `audio.delay(${b.getFieldValue('TIME')}, ${b.getFieldValue('FB')})`,
  Order.FUNCTION_CALL,
];
javascriptGenerator.forBlock['audio_distort'] = (b) => [
  `audio.distort(${b.getFieldValue('AMT')})`,
  Order.FUNCTION_CALL,
];
javascriptGenerator.forBlock['audio_connect'] = (b, g) => {
  const from = g.valueToCode(b, 'FROM', Order.NONE) || 'null';
  const to = g.valueToCode(b, 'TO', Order.NONE) || 'null';
  return `(${from}).connect(${to});\n`;
};

// Audio visualizer
javascriptGenerator.forBlock['audio_viz'] = (b, g) => {
  const src = g.valueToCode(b, 'SOURCE', Order.NONE) || 'null';
  const mode = b.getFieldValue('MODE');
  return [`audio.viz(${src}, { mode: ${JSON.stringify(mode)} })`, Order.FUNCTION_CALL];
};
javascriptGenerator.forBlock['audio_viz_start'] = (b, g) => {
  const v = g.valueToCode(b, 'VIZ', Order.NONE) || 'null';
  return `(${v}).start();\n`;
};
javascriptGenerator.forBlock['audio_viz_stop'] = (b, g) => {
  const v = g.valueToCode(b, 'VIZ', Order.NONE) || 'null';
  return `(${v}).stop();\n`;
};
javascriptGenerator.forBlock['audio_viz_shader'] = (b, g) => {
  const v = g.valueToCode(b, 'VIZ', Order.NONE) || 'null';
  return `(${v}).shader(${JSON.stringify(b.getFieldValue('PRESET'))});\n`;
};

// Audio mic / speech
javascriptGenerator.forBlock['audio_level'] = () => ['audio.level', Order.MEMBER];
javascriptGenerator.forBlock['audio_on_level'] = (b, g) => {
  const threshold = b.getFieldValue('THRESHOLD');
  const body = g.statementToCode(b, 'DO');
  return `audio.onLevel(${threshold}, () => {\n${body}});\n`;
};
javascriptGenerator.forBlock['audio_on_word'] = (b, g) => {
  const word = b.getFieldValue('WORD');
  const body = g.statementToCode(b, 'DO');
  return `audio.onWord(${JSON.stringify(word)}, () => {\n${body}});\n`;
};
javascriptGenerator.forBlock['audio_say'] = (b) =>
  `audio.say(${JSON.stringify(b.getFieldValue('TEXT'))});\n`;

// Shader creators (value blocks)
javascriptGenerator.forBlock['shader_preset'] = (b) => [
  `ShaderFX.presetShader(${JSON.stringify(b.getFieldValue('PRESET'))})`,
  Order.FUNCTION_CALL,
];
javascriptGenerator.forBlock['shader_new'] = (b) => {
  const z = b.getFieldValue('Z');
  const op = b.getFieldValue('OPACITY');
  return [
    `new Shader(\`  return vec4f(uv.x, uv.y, 0.5, 1.0);\`, { z: ${z}, opacity: ${op} })`,
    Order.NEW,
  ];
};
javascriptGenerator.forBlock['shader_wgsl'] = (b) => {
  const body = b.getFieldValue('BODY');
  return [`new Shader(\`${body}\`)`, Order.NEW];
};
javascriptGenerator.forBlock['shader_js_fn'] = (b) => {
  const body = b.getFieldValue('BODY');
  return [`new Shader(${body})`, Order.NEW];
};
javascriptGenerator.forBlock['shader_math_trig'] = (b, g) => {
  const op = b.getFieldValue('OP');
  const arg = g.valueToCode(b, 'ARG', Order.NONE) || '0';
  return [`Math.${op}(${arg})`, Order.FUNCTION_CALL];
};
javascriptGenerator.forBlock['shader_math_fn'] = (b, g) => {
  const op = b.getFieldValue('OP');
  const arg = g.valueToCode(b, 'ARG', Order.NONE) || '0';
  const arg2 = g.valueToCode(b, 'ARG2', Order.NONE);
  const call = arg2 ? `Math.${op}(${arg}, ${arg2})` : `Math.${op}(${arg})`;
  return [call, Order.FUNCTION_CALL];
};
javascriptGenerator.forBlock['shader_fn_body'] = (b, g) => {
  const body = g.statementToCode(b, 'BODY');
  return [`new Shader(({ uv, time, mouse, res, custom }) => {\n${body}})`, Order.NEW];
};
javascriptGenerator.forBlock['shader_return_rgba'] = (b, g) => {
  const r = g.valueToCode(b, 'R', Order.NONE) || '0';
  const gr = g.valueToCode(b, 'G', Order.NONE) || '0';
  const bl = g.valueToCode(b, 'B', Order.NONE) || '0';
  const a = g.valueToCode(b, 'A', Order.NONE) || '1';
  return `return [${r}, ${gr}, ${bl}, ${a}];\n`;
};
for (const [type, code] of [
  ['shader_param_uv_x', 'uv.x'],
  ['shader_param_uv_y', 'uv.y'],
  ['shader_param_time', 'time'],
  ['shader_param_mouse_x', 'mouse.x'],
  ['shader_param_mouse_y', 'mouse.y'],
  ['shader_param_res_x', 'res.x'],
  ['shader_param_res_y', 'res.y'],
  ['shader_param_custom_x', 'custom.x'],
  ['shader_param_custom_y', 'custom.y'],
  ['shader_param_custom_z', 'custom.z'],
  ['shader_param_custom_w', 'custom.w'],
]) {
  javascriptGenerator.forBlock[type] = () => [code, Order.MEMBER];
}
javascriptGenerator.forBlock['shader_start'] = (b, g) => {
  const s = g.valueToCode(b, 'SHADER', Order.NONE) || 'null';
  return `(${s}).start();\n`;
};
javascriptGenerator.forBlock['shader_stop'] = (b, g) => {
  const s = g.valueToCode(b, 'SHADER', Order.NONE) || 'null';
  return `(${s}).stop();\n`;
};
javascriptGenerator.forBlock['shader_opacity'] = (b, g) => {
  const s = g.valueToCode(b, 'SHADER', Order.NONE) || 'null';
  return `(${s}).opacity(${b.getFieldValue('OPACITY')});\n`;
};

// Vision
javascriptGenerator.forBlock['vision_on_gesture'] = (b, g) => {
  const gest = b.getFieldValue('GESTURE');
  const body = g.statementToCode(b, 'DO');
  return `vision.onGesture(${JSON.stringify(gest)}, () => {\n${body}});\n`;
};
javascriptGenerator.forBlock['vision_on_expression'] = (b, g) => {
  const expr = b.getFieldValue('EXPR');
  const body = g.statementToCode(b, 'DO');
  return `vision.onExpression(${JSON.stringify(expr)}, () => {\n${body}});\n`;
};
javascriptGenerator.forBlock['vision_gesture'] = () => ['vision.gesture()', Order.FUNCTION_CALL];
javascriptGenerator.forBlock['vision_face_detected'] = () => [
  '(vision.face() !== null)',
  Order.ATOMIC,
];
javascriptGenerator.forBlock['vision_nearest'] = (b) => {
  const label = b.getFieldValue('LABEL');
  return [`vision.nearest(${JSON.stringify(label)})`, Order.FUNCTION_CALL];
};
javascriptGenerator.forBlock['vision_gaze'] = () => ['vision.gaze()', Order.FUNCTION_CALL];
javascriptGenerator.forBlock['vision_on_gaze'] = (b, g) => {
  const dir = b.getFieldValue('DIR');
  const body = g.statementToCode(b, 'DO');
  return `vision.onGaze(${JSON.stringify(dir)}, () => {\n${body}});\n`;
};
javascriptGenerator.forBlock['vision_on_blink'] = (b, g) => {
  const body = g.statementToCode(b, 'DO');
  return `vision.onBlink(() => {\n${body}});\n`;
};

// Draw
// ADR 040: global `draw` is gone. These "quick draw" blocks emit against an
// implicit default `canvas` (declared once by getWorkspaceCode when present).
javascriptGenerator.forBlock['draw_bg'] = (b) => {
  const color = b.getFieldValue('COLOR');
  return `canvas.bg(${JSON.stringify(color)});\n`;
};
javascriptGenerator.forBlock['draw_line'] = (b) => {
  const [x1, y1, x2, y2] = ['X1', 'Y1', 'X2', 'Y2'].map((f) => b.getFieldValue(f));
  const color = b.getFieldValue('COLOR');
  const t = b.getFieldValue('THICKNESS');
  return `canvas.line(${x1}, ${y1}, ${x2}, ${y2}, ${JSON.stringify(color)}, ${t});\n`;
};
javascriptGenerator.forBlock['draw_text'] = (b) => {
  const str = b.getFieldValue('STR');
  const [x, y, size] = ['X', 'Y', 'SIZE'].map((f) => b.getFieldValue(f));
  const color = b.getFieldValue('COLOR');
  return `canvas.text(${JSON.stringify(str)}, ${x}, ${y}, ${size}, ${JSON.stringify(color)});\n`;
};
javascriptGenerator.forBlock['draw_text_rich'] = (b) => {
  const str = b.getFieldValue('STR');
  const [x, y, size] = ['X', 'Y', 'SIZE'].map((f) => b.getFieldValue(f));
  const color = b.getFieldValue('COLOR');
  const stroke = b.getFieldValue('STROKE') === 'TRUE';
  const shadow = b.getFieldValue('SHADOW') === 'TRUE';
  const opts = { stroke, shadow };
  return `canvas.text(${JSON.stringify(str)}, ${x}, ${y}, ${size}, ${JSON.stringify(color)}, ${JSON.stringify(opts)});\n`;
};
javascriptGenerator.forBlock['draw_alpha'] = (b) => `canvas.alpha(${b.getFieldValue('ALPHA')});\n`;
javascriptGenerator.forBlock['draw_reset'] = () => `canvas.reset();\n`;

// Camera / video shader creators (value blocks)
javascriptGenerator.forBlock['shader_camera_effect'] = (b, g) => {
  const cam = g.valueToCode(b, 'CAM', Order.NONE);
  const eff = JSON.stringify(b.getFieldValue('EFFECT'));
  const code = cam ? `ShaderFX.cameraShader(${cam}, ${eff})` : `ShaderFX.cameraShader(${eff})`;
  return [code, Order.FUNCTION_CALL];
};
javascriptGenerator.forBlock['shader_video_effect'] = (b, g) => {
  const vid = g.valueToCode(b, 'VIDEO', Order.NONE) || 'null';
  return [
    `ShaderFX.videoShader(${vid}, ${JSON.stringify(b.getFieldValue('EFFECT'))})`,
    Order.FUNCTION_CALL,
  ];
};
javascriptGenerator.forBlock['shader_window_effect'] = (b) => [
  `ShaderFX.windowShader(${JSON.stringify(b.getFieldValue('WIN'))}, ${JSON.stringify(b.getFieldValue('EFFECT'))})`,
  Order.FUNCTION_CALL,
];
javascriptGenerator.forBlock['shader_mic_viz'] = (b) => [
  `ShaderFX.micVizShader(${JSON.stringify(b.getFieldValue('EFFECT'))})`,
  Order.FUNCTION_CALL,
];
javascriptGenerator.forBlock['shader_set_uniform'] = (b, g) => {
  const s = g.valueToCode(b, 'SHADER', Order.NONE) || 'null';
  const ch = b.getFieldValue('CHANNEL');
  const val = b.getFieldValue('VALUE');
  return `(${s}).set(${ch}, ${val});\n`;
};

// Canvas
javascriptGenerator.forBlock['canvas_fill_rect'] = (b) => {
  const [x, y, w, h] = ['X', 'Y', 'W', 'H'].map((f) => b.getFieldValue(f));
  const color = b.getFieldValue('COLOR');
  return `canvas.rect(${x}, ${y}, ${w}, ${h}, ${JSON.stringify(color)});\n`;
};
javascriptGenerator.forBlock['canvas_fill_circle'] = (b) => {
  const [x, y, r] = ['X', 'Y', 'R'].map((f) => b.getFieldValue(f));
  const color = b.getFieldValue('COLOR');
  return `canvas.circle(${x}, ${y}, ${r}, ${JSON.stringify(color)});\n`;
};

// ── Windowed Canvas surface (ADR 038) ─────────────────────────────────────────
javascriptGenerator.forBlock['canvas_new'] = (b) => {
  const w = b.getFieldValue('W'),
    h = b.getFieldValue('H');
  const title = JSON.stringify(b.getFieldValue('TITLE'));
  return [`new Canvas({ w: ${w}, h: ${h}, title: ${title} })`, Order.FUNCTION_CALL];
};
javascriptGenerator.forBlock['canvas_surface_bg'] = (b, g) => {
  const c = g.valueToCode(b, 'CANVAS', Order.MEMBER) || 'null';
  return `(${c}).bg(${JSON.stringify(b.getFieldValue('COLOR'))});\n`;
};
javascriptGenerator.forBlock['canvas_surface_circle'] = (b, g) => {
  const c = g.valueToCode(b, 'CANVAS', Order.MEMBER) || 'null';
  const x = g.valueToCode(b, 'X', Order.NONE) || '0';
  const y = g.valueToCode(b, 'Y', Order.NONE) || '0';
  const r = b.getFieldValue('R');
  return `(${c}).circle(${x}, ${y}, ${r}, ${JSON.stringify(b.getFieldValue('COLOR'))});\n`;
};
javascriptGenerator.forBlock['canvas_on'] = (b, g) => {
  const c = g.valueToCode(b, 'CANVAS', Order.MEMBER) || 'null';
  const ev = JSON.stringify(b.getFieldValue('EVENT'));
  const body = g.statementToCode(b, 'DO');
  return `(${c}).on(${ev}, () => {\n${body}});\n`;
};
javascriptGenerator.forBlock['canvas_pointer'] = (b, g) => {
  const c = g.valueToCode(b, 'CANVAS', Order.MEMBER) || 'null';
  return [`(${c}).pointer.${b.getFieldValue('AXIS')}`, Order.MEMBER];
};
javascriptGenerator.forBlock['canvas_clear'] = () => `canvas.clear();\n`;
javascriptGenerator.forBlock['canvas_blur'] = (b) =>
  `canvas.fx(${b.getFieldValue('Z')}).blur(${b.getFieldValue('AMT')});\n`;
javascriptGenerator.forBlock['canvas_layer_opacity'] = (b) =>
  `canvas.fx(${b.getFieldValue('Z')}).opacity(${b.getFieldValue('OPACITY')});\n`;
javascriptGenerator.forBlock['canvas_blend_mode'] = (b) =>
  `canvas.fx(${b.getFieldValue('Z')}).blendMode('${b.getFieldValue('MODE')}');\n`;
javascriptGenerator.forBlock['draw_pixelate'] = (b) =>
  `canvas.pixelate(canvas.el, ${b.getFieldValue('BLOCK')});\n`;

// Media
javascriptGenerator.forBlock['media_video'] = (b) => {
  const url = b.getFieldValue('URL');
  return [`Media.video(${JSON.stringify(url)})`, Order.FUNCTION_CALL];
};
javascriptGenerator.forBlock['media_video_play'] = (b, g) => {
  const v = g.valueToCode(b, 'VIDEO', Order.NONE) || 'null';
  return `(${v}).play();\n`;
};
javascriptGenerator.forBlock['media_video_stop'] = (b, g) => {
  const v = g.valueToCode(b, 'VIDEO', Order.NONE) || 'null';
  return `(${v}).stop();\n`;
};
javascriptGenerator.forBlock['media_image_layer'] = (b) => {
  const url = b.getFieldValue('URL');
  return [`Media.imageLayer(${JSON.stringify(url)})`, Order.FUNCTION_CALL];
};

// Windows
javascriptGenerator.forBlock['wm_layout'] = (b) =>
  `wm.layout(${JSON.stringify(b.getFieldValue('LAYOUT'))});\n`;
javascriptGenerator.forBlock['wm_show_hide'] = (b) =>
  `wm.${b.getFieldValue('ACTION')}(${JSON.stringify(b.getFieldValue('WIN'))});\n`;
javascriptGenerator.forBlock['wm_move'] = (b) =>
  `wm.move(${JSON.stringify(b.getFieldValue('WIN'))}, ${b.getFieldValue('X')}, ${b.getFieldValue('Y')});\n`;
javascriptGenerator.forBlock['wm_resize_win'] = (b) =>
  `wm.resize(${JSON.stringify(b.getFieldValue('WIN'))}, ${b.getFieldValue('W')}, ${b.getFieldValue('H')});\n`;
javascriptGenerator.forBlock['wm_close_win'] = (b, g) => {
  const id = g.valueToCode(b, 'ID', Order.NONE) || "''";
  return `wm.close(${id});\n`;
};
javascriptGenerator.forBlock['wm_set_z'] = (b, g) => {
  const id = g.valueToCode(b, 'ID', Order.NONE) || "''";
  return `wm.setZ(${id}, ${b.getFieldValue('Z')});\n`;
};
javascriptGenerator.forBlock['wm_set_opacity'] = (b, g) => {
  const id = g.valueToCode(b, 'ID', Order.NONE) || "''";
  return `wm.setOpacity(${id}, ${b.getFieldValue('V')});\n`;
};
javascriptGenerator.forBlock['wm_spawn_html'] = (b) => {
  const title = JSON.stringify(b.getFieldValue('TITLE'));
  const html = JSON.stringify(b.getFieldValue('HTML'));
  const [w, h] = ['W', 'H'].map((f) => b.getFieldValue(f));
  return [
    `wm.spawn(${title}, { type: 'html', html: ${html}, w: ${w}, h: ${h} })`,
    Order.FUNCTION_CALL,
  ];
};
javascriptGenerator.forBlock['wm_spawn_camera'] = (b) => {
  const title = JSON.stringify(b.getFieldValue('TITLE'));
  const [w, h] = ['W', 'H'].map((f) => b.getFieldValue(f));
  return [`wm.spawn(${title}, { type: 'camera', w: ${w}, h: ${h} })`, Order.FUNCTION_CALL];
};
javascriptGenerator.forBlock['wm_spawn_canvas'] = (b) => {
  const z = b.getFieldValue('Z');
  const title = JSON.stringify(b.getFieldValue('TITLE'));
  const [w, h] = ['W', 'H'].map((f) => b.getFieldValue(f));
  return [`wm.spawn(${title}, { type: 'canvas', z: ${z}, w: ${w}, h: ${h} })`, Order.FUNCTION_CALL];
};
javascriptGenerator.forBlock['wm_spawn_image'] = (b, g) => {
  const src = g.valueToCode(b, 'SRC', Order.NONE) || "''";
  const title = JSON.stringify(b.getFieldValue('TITLE'));
  const [w, h] = ['W', 'H'].map((f) => b.getFieldValue(f));
  return [
    `wm.spawn(${title}, { type: 'image', src: ${src}, w: ${w}, h: ${h} })`,
    Order.FUNCTION_CALL,
  ];
};
javascriptGenerator.forBlock['wm_spawn_video'] = (b, g) => {
  const src = g.valueToCode(b, 'SRC', Order.NONE) || "''";
  const title = JSON.stringify(b.getFieldValue('TITLE'));
  const [w, h] = ['W', 'H'].map((f) => b.getFieldValue(f));
  return [
    `wm.spawn(${title}, { type: 'video', src: ${src}, w: ${w}, h: ${h} })`,
    Order.FUNCTION_CALL,
  ];
};
javascriptGenerator.forBlock['wm_spawn_shader'] = (b, g) => {
  const shader = g.valueToCode(b, 'SHADER', Order.NONE) || 'null';
  const title = JSON.stringify(b.getFieldValue('TITLE'));
  const [w, h] = ['W', 'H'].map((f) => b.getFieldValue(f));
  return [
    `wm.spawn(${title}, { type: 'shader', shader: ${shader}, w: ${w}, h: ${h} })`,
    Order.FUNCTION_CALL,
  ];
};
javascriptGenerator.forBlock['wm_pick_file'] = (b) => [
  `await wm.pickFile(${JSON.stringify(b.getFieldValue('KEY'))})`,
  Order.AWAIT,
];
javascriptGenerator.forBlock['wm_browse'] = (b, g) => {
  const key = JSON.stringify(b.getFieldValue('KEY'));
  const w = b.getFieldValue('W');
  const h = b.getFieldValue('H');
  const urlVar = g.getVariableName(b.getFieldValue('URL_VAR'));
  const nameVar = g.getVariableName(b.getFieldValue('NAME_VAR'));
  const body = g.statementToCode(b, 'DO');
  return `await wm.browse(${key}, (${urlVar}, ${nameVar}) => {\n${body}}, { w: ${w}, h: ${h} });\n`;
};

// Piano
javascriptGenerator.forBlock['piano_open'] = (b) => {
  const title = JSON.stringify(b.getFieldValue('TITLE'));
  const preset = JSON.stringify(b.getFieldValue('PRESET'));
  return [`audio.piano({ title: ${title}, preset: ${preset} })`, Order.FUNCTION_CALL];
};
javascriptGenerator.forBlock['piano_on_note'] = (b, g) => {
  const p = g.valueToCode(b, 'PIANO', Order.NONE) || 'null';
  const body = g.statementToCode(b, 'DO');
  return `(${p}).onNote(() => {\n${body}});\n`;
};
javascriptGenerator.forBlock['piano_on_step'] = (b, g) => {
  const p = g.valueToCode(b, 'PIANO', Order.NONE) || 'null';
  const body = g.statementToCode(b, 'DO');
  return `(${p}).onStep(() => {\n${body}});\n`;
};
javascriptGenerator.forBlock['piano_signal'] = (b, g) => {
  const p = g.valueToCode(b, 'PIANO', Order.NONE) || 'null';
  const decay = b.getFieldValue('DECAY');
  return [`(${p}).signal(null, { decay: ${decay} })`, Order.FUNCTION_CALL];
};

// Drumpad
javascriptGenerator.forBlock['drumpad_open'] = (b) => {
  const title = JSON.stringify(b.getFieldValue('TITLE'));
  const bpm = b.getFieldValue('BPM');
  return [`audio.drumpad({ title: ${title}, bpm: ${bpm} })`, Order.FUNCTION_CALL];
};
javascriptGenerator.forBlock['drumpad_on_pad'] = (b, g) => {
  const dp = g.valueToCode(b, 'DP', Order.NONE) || 'null';
  const voice = b.getFieldValue('VOICE');
  const body = g.statementToCode(b, 'DO');
  return `(${dp}).onPad(${voice}, () => {\n${body}});\n`;
};
javascriptGenerator.forBlock['drumpad_on_hit'] = (b, g) => {
  const dp = g.valueToCode(b, 'DP', Order.NONE) || 'null';
  const body = g.statementToCode(b, 'DO');
  return `(${dp}).onHit(() => {\n${body}});\n`;
};
javascriptGenerator.forBlock['drumpad_on_step'] = (b, g) => {
  const dp = g.valueToCode(b, 'DP', Order.NONE) || 'null';
  const body = g.statementToCode(b, 'DO');
  return `(${dp}).onStep(() => {\n${body}});\n`;
};
javascriptGenerator.forBlock['drumpad_signal'] = (b, g) => {
  const dp = g.valueToCode(b, 'DP', Order.NONE) || 'null';
  const voice = b.getFieldValue('VOICE');
  const decay = b.getFieldValue('DECAY');
  return [`(${dp}).signal(${voice}, { decay: ${decay} })`, Order.FUNCTION_CALL];
};

// PIXI
javascriptGenerator.forBlock['pixi_graphics_circle'] = (b) => {
  const [x, y, r] = ['X', 'Y', 'R'].map((f) => b.getFieldValue(f));
  const color = b.getFieldValue('COLOR');
  return [
    `(() => { const _g = new PIXI.Graphics(); _g.beginFill(${color}); _g.drawCircle(0,0,${r}); _g.endFill(); _g.x=${x}; _g.y=${y}; return _g; })()`,
    Order.FUNCTION_CALL,
  ];
};
javascriptGenerator.forBlock['pixi_graphics_rect'] = (b) => {
  const [x, y, w, h] = ['X', 'Y', 'W', 'H'].map((f) => b.getFieldValue(f));
  const color = b.getFieldValue('COLOR');
  return [
    `(() => { const _g = new PIXI.Graphics(); _g.beginFill(${color}); _g.drawRect(0,0,${w},${h}); _g.endFill(); _g.x=${x}; _g.y=${y}; return _g; })()`,
    Order.FUNCTION_CALL,
  ];
};
javascriptGenerator.forBlock['pixi_text'] = (b) => {
  const str = JSON.stringify(b.getFieldValue('STR'));
  const [x, y, size] = ['X', 'Y', 'SIZE'].map((f) => b.getFieldValue(f));
  const color = JSON.stringify(b.getFieldValue('COLOR'));
  return [
    `(() => { const _t = new PIXI.Text(${str}, new PIXI.TextStyle({ fontSize: ${size}, fill: ${color} })); _t.x=${x}; _t.y=${y}; return _t; })()`,
    Order.FUNCTION_CALL,
  ];
};
javascriptGenerator.forBlock['pixi_sprite'] = (b) => {
  const url = JSON.stringify(b.getFieldValue('URL'));
  return [`PIXI.Sprite.from(${url})`, Order.FUNCTION_CALL];
};
javascriptGenerator.forBlock['pixi_add_to_stage'] = (b, g) => {
  const obj = g.valueToCode(b, 'OBJ', Order.NONE) || 'null';
  return `Stage.addChild(${obj});\n`;
};
javascriptGenerator.forBlock['pixi_set_pos'] = (b, g) => {
  const obj = g.valueToCode(b, 'OBJ', Order.NONE) || 'null';
  return `(${obj}).x = ${b.getFieldValue('X')}; (${obj}).y = ${b.getFieldValue('Y')};\n`;
};
javascriptGenerator.forBlock['pixi_set_rotation'] = (b, g) => {
  const obj = g.valueToCode(b, 'OBJ', Order.NONE) || 'null';
  return `(${obj}).rotation = ${b.getFieldValue('DEG')} * Math.PI / 180;\n`;
};
javascriptGenerator.forBlock['pixi_set_alpha'] = (b, g) => {
  const obj = g.valueToCode(b, 'OBJ', Order.NONE) || 'null';
  return `(${obj}).alpha = ${b.getFieldValue('ALPHA')};\n`;
};
javascriptGenerator.forBlock['pixi_blur_filter'] = (b, g) => {
  const obj = g.valueToCode(b, 'OBJ', Order.NONE) || 'null';
  return `(${obj}).filters = [Object.assign(new PIXI.filters.BlurFilter(), { blur: ${b.getFieldValue('BLUR')} })];\n`;
};
javascriptGenerator.forBlock['pixi_tick'] = (b, g) => {
  const body = g.statementToCode(b, 'DO');
  return `pixi.tick(() => {\n${body}});\n`;
};
javascriptGenerator.forBlock['pixi_clear_stage'] = () => `Stage.removeChildren();\n`;

// GLShader
javascriptGenerator.forBlock['glshader_preset'] = (b) => [
  `new GLShader(GLSL_PRESETS[${JSON.stringify(b.getFieldValue('PRESET'))}])`,
  Order.NEW,
];
javascriptGenerator.forBlock['glshader_body'] = (b) => [
  `new GLShader(\`${b.getFieldValue('BODY')}\`)`,
  Order.NEW,
];
javascriptGenerator.forBlock['glshader_start'] = (b, g) => {
  const s = g.valueToCode(b, 'SHADER', Order.NONE) || 'null';
  return `(${s}).start();\n`;
};
javascriptGenerator.forBlock['glshader_stop'] = (b, g) => {
  const s = g.valueToCode(b, 'SHADER', Order.NONE) || 'null';
  return `(${s}).stop();\n`;
};
javascriptGenerator.forBlock['glshader_opacity'] = (b, g) => {
  const s = g.valueToCode(b, 'SHADER', Order.NONE) || 'null';
  return `(${s}).opacity(${b.getFieldValue('OPACITY')});\n`;
};

// Camera
javascriptGenerator.forBlock['camera_open'] = (b) => [
  `await Camera.open({ index: ${b.getFieldValue('INDEX')} })`,
  Order.AWAIT,
];
javascriptGenerator.forBlock['camera_stop'] = (b, g) => {
  const cam = g.valueToCode(b, 'CAM', Order.NONE) || 'null';
  return `(${cam}).stop();\n`;
};

// Audio — filter / meter / chain / attack / release
javascriptGenerator.forBlock['audio_filter'] = (b) => [
  `audio.filter(${JSON.stringify(b.getFieldValue('TYPE'))}, ${b.getFieldValue('FREQ')}, ${b.getFieldValue('Q')})`,
  Order.FUNCTION_CALL,
];
javascriptGenerator.forBlock['audio_meter'] = () => [`audio.meter()`, Order.FUNCTION_CALL];
javascriptGenerator.forBlock['audio_meter_value'] = (b, g) => {
  const m = g.valueToCode(b, 'METER', Order.NONE) || 'null';
  return [`(${m}).getValue()`, Order.FUNCTION_CALL];
};
javascriptGenerator.forBlock['audio_chain'] = (b, g) => {
  const synth = g.valueToCode(b, 'SYNTH', Order.NONE) || 'null';
  const fx1 = g.valueToCode(b, 'FX1', Order.NONE);
  const fx2 = g.valueToCode(b, 'FX2', Order.NONE);
  const fx3 = g.valueToCode(b, 'FX3', Order.NONE);
  const args = [fx1, fx2, fx3].filter(Boolean).join(', ');
  return `(${synth}).chain(${args});\n`;
};
javascriptGenerator.forBlock['audio_attack'] = (b, g) => {
  const note = JSON.stringify(b.getFieldValue('NOTE'));
  const synth = g.valueToCode(b, 'SYNTH', Order.NONE) || 'null';
  return `(${synth}).attack(${note});\n`;
};
javascriptGenerator.forBlock['audio_release'] = (b, g) => {
  const note = JSON.stringify(b.getFieldValue('NOTE'));
  const synth = g.valueToCode(b, 'SYNTH', Order.NONE) || 'null';
  return `(${synth}).release(${note});\n`;
};

// Draw — ring / rectStroke
javascriptGenerator.forBlock['draw_ring'] = (b) => {
  const [x, y, r] = ['X', 'Y', 'R'].map((f) => b.getFieldValue(f));
  return `canvas.ring(${x}, ${y}, ${r}, ${JSON.stringify(b.getFieldValue('COLOR'))}, ${b.getFieldValue('T')});\n`;
};
javascriptGenerator.forBlock['draw_rect_stroke'] = (b) => {
  const [x, y, w, h] = ['X', 'Y', 'W', 'H'].map((f) => b.getFieldValue(f));
  return `canvas.rectStroke(${x}, ${y}, ${w}, ${h}, ${JSON.stringify(b.getFieldValue('COLOR'))}, ${b.getFieldValue('T')});\n`;
};

// Control — key with down + up
javascriptGenerator.forBlock['ctrl_onkey_char'] = (b, g) => {
  const key = JSON.stringify(b.getFieldValue('KEY'));
  const down = g.statementToCode(b, 'DOWN');
  const up = g.statementToCode(b, 'UP');
  const k = JSON.parse(key); // unquoted key string for use as property name
  let code = `on('window:key:down').when({ ${k}: () => {\n${down}} });\n`;
  if (up) code += `on('window:key:up').when({ ${k}: () => {\n${up}} });\n`;
  return code;
};

// Three.js 3D
javascriptGenerator.forBlock['three_scene'] = (b) => [
  `new ThreeScene({ z: ${b.getFieldValue('Z')} })`,
  Order.NEW,
];
javascriptGenerator.forBlock['three_start'] = (b, g) => {
  const s = g.valueToCode(b, 'SCENE', Order.NONE) || 'null';
  return `(${s}).start();\n`;
};
javascriptGenerator.forBlock['three_tick'] = (b, g) => {
  const s = g.valueToCode(b, 'SCENE', Order.NONE) || 'null';
  const dt = b.getFieldValue('DT') || 'dt';
  const body = g.statementToCode(b, 'DO');
  return `(${s}).tick((${dt}) => {\n${body}});\n`;
};
javascriptGenerator.forBlock['three_box_mesh'] = (b) => {
  const color = b.getFieldValue('COLOR').replace('#', '0x');
  return [
    `new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshNormalMaterial({ color: ${color} }))`,
    Order.NEW,
  ];
};
javascriptGenerator.forBlock['three_add'] = (b, g) => {
  const obj = g.valueToCode(b, 'OBJ', Order.NONE) || 'null';
  const s = g.valueToCode(b, 'SCENE', Order.NONE) || 'null';
  return `(${s}).add(${obj});\n`;
};
javascriptGenerator.forBlock['three_rotate'] = (b, g) => {
  const obj = g.valueToCode(b, 'OBJ', Order.NONE) || 'null';
  return `(${obj}).rotation.x += ${b.getFieldValue('DX')};\n(${obj}).rotation.y += ${b.getFieldValue('DY')};\n`;
};
javascriptGenerator.forBlock['three_signal_graph'] = () => `signalGraph.show();\n`;

// ── Pipeline blocks ──────────────────────────────────────────────────────────

Blockly.defineBlocksWithJsonArray([
  {
    type: 'pipe_ascii_camera',
    message0: 'pipe camera %1 → ASCII cols %2 color %3 bg %4 → window %5 %6 × %7',
    args0: [
      { type: 'field_number', name: 'INDEX', value: 0, min: 0, precision: 1 },
      { type: 'field_number', name: 'COLS', value: 120, min: 10 },
      { type: 'field_colour', name: 'COLOR', colour: '#00ff41' },
      { type: 'field_colour', name: 'BG', colour: '#0d0208' },
      { type: 'field_input', name: 'TITLE', text: 'ASCII Cam' },
      { type: 'field_number', name: 'W', value: 700, min: 100 },
      { type: 'field_number', name: 'H', value: 500, min: 100 },
    ],
    previousStatement: null,
    nextStatement: null,
    colour: 80,
    tooltip: 'Camera → ASCII → spawned window pipeline. One raf loop, auto-cleanup on reset.',
  },
  {
    type: 'pipe_ascii_shader_camera',
    message0: 'pipe camera %1 → ASCII cols %2 color %3 bg %4 → GLShader %5 → window %6 %7 × %8',
    args0: [
      { type: 'field_number', name: 'INDEX', value: 0, min: 0, precision: 1 },
      { type: 'field_number', name: 'COLS', value: 120, min: 10 },
      { type: 'field_colour', name: 'COLOR', colour: '#00ff41' },
      { type: 'field_colour', name: 'BG', colour: '#0d0208' },
      {
        type: 'field_multilinetext',
        name: 'GLSL',
        text: 'vec4 a=texture2D(uVideo,uv);\nfloat l=dot(a.rgb,vec3(.299,.587,.114));\nvec3 rain=.5+.5*cos(6.28*(uv.y+time*.4+vec3(0,.33,.67)));\ngl_FragColor=vec4(rain*l,1.);',
      },
      { type: 'field_input', name: 'TITLE', text: 'ASCII Cam' },
      { type: 'field_number', name: 'W', value: 700, min: 100 },
      { type: 'field_number', name: 'H', value: 500, min: 100 },
    ],
    previousStatement: null,
    nextStatement: null,
    colour: 80,
    tooltip: 'Camera → ASCII → GLShader → window pipeline.',
  },
  {
    type: 'pipe_camera_glshader',
    message0: 'pipe camera %1 → GLShader %2 → window %3 %4 × %5',
    args0: [
      { type: 'field_number', name: 'INDEX', value: 0, min: 0, precision: 1 },
      {
        type: 'field_multilinetext',
        name: 'GLSL',
        text: 'vec4 c=texture2D(uVideo,uv);\nfloat g=dot(c.rgb,vec3(.299,.587,.114));\ngl_FragColor=vec4(g,g*.5,1.-g,1.);',
      },
      { type: 'field_input', name: 'TITLE', text: 'Camera Shader' },
      { type: 'field_number', name: 'W', value: 700, min: 100 },
      { type: 'field_number', name: 'H', value: 500, min: 100 },
    ],
    previousStatement: null,
    nextStatement: null,
    colour: 80,
    tooltip: 'Camera → GLShader → window pipeline. uVideo samples the camera feed.',
  },
  {
    type: 'pipe_pixelate_camera',
    message0: 'pipe camera %1 → pixelate block size %2 → window %3 %4 × %5',
    args0: [
      { type: 'field_number', name: 'INDEX', value: 0, min: 0, precision: 1 },
      { type: 'field_number', name: 'BLOCK', value: 20, min: 2 },
      { type: 'field_input', name: 'TITLE', text: 'Pixelate' },
      { type: 'field_number', name: 'W', value: 700, min: 100 },
      { type: 'field_number', name: 'H', value: 500, min: 100 },
    ],
    previousStatement: null,
    nextStatement: null,
    colour: 80,
    tooltip: 'Camera → pixelate mosaic → window pipeline.',
  },

  // ── ASCII Animation ─────────────────────────────────────────────────────────
  {
    type: 'ascii_play',
    message0: 'ASCII play frame1 %1 frame2 %2 fps %3',
    args0: [
      { type: 'field_input', name: 'F1', text: ' .oO0 ' },
      { type: 'field_input', name: 'F2', text: ' 0Oo. ' },
      { type: 'field_number', name: 'FPS', value: 8, min: 1 },
    ],
    output: null,
    colour: 55,
    tooltip: 'Create ASCII animation player from two frames',
  },
  {
    type: 'ascii_show',
    message0: 'show ASCII anim %1 title %2',
    args0: [
      { type: 'input_value', name: 'ANIM' },
      { type: 'field_input', name: 'TITLE', text: 'ASCII' },
    ],
    previousStatement: null,
    nextStatement: null,
    colour: 55,
    tooltip: 'Open an ASCII animation in a wm window',
  },

  // ── Sprite ──────────────────────────────────────────────────────────────────
  {
    type: 'sprite_create',
    message0: 'sprite %1×%2 scale %3 frames %4',
    args0: [
      { type: 'field_number', name: 'W', value: 8, min: 1 },
      { type: 'field_number', name: 'H', value: 8, min: 1 },
      { type: 'field_number', name: 'SCALE', value: 16, min: 1 },
      { type: 'field_number', name: 'FRAMES', value: 1, min: 1 },
    ],
    output: null,
    colour: 55,
    tooltip: 'Create a Sprite (pixel-grid animation)',
  },
  {
    type: 'sprite_pixel',
    message0: 'sprite %1 pixel x=%2 y=%3 color %4',
    args0: [
      { type: 'input_value', name: 'SP' },
      { type: 'field_number', name: 'X', value: 0 },
      { type: 'field_number', name: 'Y', value: 0 },
      { type: 'field_colour', name: 'COLOR', colour: '#ff0000' },
    ],
    previousStatement: null,
    nextStatement: null,
    colour: 55,
    tooltip: 'Set a pixel on the current frame',
  },
  {
    type: 'sprite_play',
    message0: 'sprite %1 play fps %2',
    args0: [
      { type: 'input_value', name: 'SP' },
      { type: 'field_number', name: 'FPS', value: 8, min: 1 },
    ],
    previousStatement: null,
    nextStatement: null,
    colour: 55,
    tooltip: 'Start animating the sprite at fps',
  },
  {
    type: 'sprite_show',
    message0: 'sprite %1 show title %2',
    args0: [
      { type: 'input_value', name: 'SP' },
      { type: 'field_input', name: 'TITLE', text: 'Sprite' },
    ],
    previousStatement: null,
    nextStatement: null,
    colour: 55,
    tooltip: 'Open sprite in a wm window',
  },
  // ── Paint Canvas ──────────────────────────────────────────────────────────────
  {
    type: 'paint_open',
    message0: 'paint canvas %1×%2 bg %3',
    args0: [
      { type: 'field_number', name: 'W', value: 400, min: 1 },
      { type: 'field_number', name: 'H', value: 300, min: 1 },
      { type: 'field_colour', name: 'BG', colour: '#ffffff' },
    ],
    previousStatement: null,
    nextStatement: null,
    colour: 160,
    tooltip: 'Open the freehand Paint canvas editor',
  },
  {
    type: 'paint_open_backdrop',
    message0: 'paint canvas %1×%2 bg %3 backdrop %4',
    args0: [
      { type: 'field_number', name: 'W', value: 400, min: 1 },
      { type: 'field_number', name: 'H', value: 300, min: 1 },
      { type: 'field_colour', name: 'BG', colour: '#ffffff' },
      { type: 'field_input', name: 'BACKDROP', text: 'https://example.com/photo.jpg' },
    ],
    previousStatement: null,
    nextStatement: null,
    colour: 160,
    tooltip: 'Open Paint canvas with an image/video backdrop as a reference layer beneath strokes.',
  },
  // ── ASCII Editor ──────────────────────────────────────────────────────────────
  {
    type: 'ascii_editor_open',
    message0: 'ASCII editor %1 cols × %2 rows',
    args0: [
      { type: 'field_number', name: 'COLS', value: 64, min: 1 },
      { type: 'field_number', name: 'ROWS', value: 24, min: 1 },
    ],
    previousStatement: null,
    nextStatement: null,
    colour: 55,
    tooltip: 'Open the interactive colored ASCII art editor',
  },

  // ── Art-widget event/signal blocks ───────────────────────────────────────────

  // Paint — value open
  {
    type: 'paint_open_ref',
    message0: 'paint canvas %1×%2 bg %3',
    args0: [
      { type: 'field_number', name: 'W', value: 400, min: 1 },
      { type: 'field_number', name: 'H', value: 300, min: 1 },
      { type: 'field_colour', name: 'BG', colour: '#ffffff' },
    ],
    output: null,
    colour: 160,
    tooltip: 'Open Paint canvas and return the handle. Connect to on-stroke / signal blocks.',
  },
  {
    type: 'paint_on_stroke',
    message0: 'on paint %1 stroke',
    args0: [{ type: 'input_value', name: 'P' }],
    message1: 'do %1',
    args1: [{ type: 'input_statement', name: 'DO' }],
    previousStatement: null,
    nextStatement: null,
    colour: 160,
    tooltip:
      'Run code after each brush/eraser/fill stroke. Event has tool, color, frame, bbox {x,y,w,h}.',
  },
  {
    type: 'paint_on_color',
    message0: 'on paint %1 color change',
    args0: [{ type: 'input_value', name: 'P' }],
    message1: 'do %1',
    args1: [{ type: 'input_statement', name: 'DO' }],
    previousStatement: null,
    nextStatement: null,
    colour: 160,
    tooltip: 'Run code whenever the active paint color changes. Event has color, prev.',
  },
  {
    type: 'paint_signal',
    message0: 'paint %1 stroke signal decay %2 ms',
    args0: [
      { type: 'input_value', name: 'P' },
      { type: 'field_number', name: 'DECAY', value: 250, min: 10, max: 5000 },
    ],
    output: null,
    colour: 160,
    tooltip:
      'Live 0–1 decaying-pulse signal that spikes on each stroke and decays to 0. Use with shader.set() or draw.',
  },

  // SpriteEditor — value open
  {
    type: 'sprite_editor_open',
    message0: 'pixel art %1×%2 scale %3',
    args0: [
      { type: 'field_number', name: 'W', value: 16, min: 1 },
      { type: 'field_number', name: 'H', value: 16, min: 1 },
      { type: 'field_number', name: 'SCALE', value: 16, min: 1 },
    ],
    output: null,
    colour: 65,
    tooltip:
      'Open Pixel Art editor and return the handle. Connect to on-pixel / on-stroke / signal blocks.',
  },
  {
    type: 'sprite_editor_on_pixel',
    message0: 'on pixel art %1 pixel painted',
    args0: [{ type: 'input_value', name: 'SP' }],
    message1: 'do %1',
    args1: [{ type: 'input_statement', name: 'DO' }],
    previousStatement: null,
    nextStatement: null,
    colour: 65,
    tooltip: 'Run code on every pixel painted. Event has x, y, color, frame.',
  },
  {
    type: 'sprite_editor_on_stroke',
    message0: 'on pixel art %1 stroke',
    args0: [{ type: 'input_value', name: 'SP' }],
    message1: 'do %1',
    args1: [{ type: 'input_statement', name: 'DO' }],
    previousStatement: null,
    nextStatement: null,
    colour: 65,
    tooltip:
      'Run code at the end of each brush stroke or fill. Event has tool, color, frame, bbox.',
  },
  {
    type: 'sprite_editor_signal',
    message0: 'pixel art %1 event %2 signal decay %3 ms',
    args0: [
      { type: 'input_value', name: 'SP' },
      {
        type: 'field_dropdown',
        name: 'EVENT',
        options: [
          ['pixel', 'pixel'],
          ['stroke', 'stroke'],
          ['color', 'color'],
          ['frame', 'frame'],
          ['any', '*'],
        ],
      },
      { type: 'field_number', name: 'DECAY', value: 250, min: 10, max: 5000 },
    ],
    output: null,
    colour: 65,
    tooltip:
      'Live 0–1 decaying-pulse signal from the pixel art editor. value=1 on event, decays to 0.',
  },

  // AsciiEditor — value open
  {
    type: 'ascii_editor_open_ref',
    message0: 'ASCII editor %1 cols × %2 rows',
    args0: [
      { type: 'field_number', name: 'COLS', value: 64, min: 1 },
      { type: 'field_number', name: 'ROWS', value: 24, min: 1 },
    ],
    output: null,
    colour: 55,
    tooltip:
      'Open the ASCII editor and return the handle. Connect to on-cell / on-stroke / signal blocks.',
  },
  {
    type: 'ascii_editor_on_cell',
    message0: 'on ASCII editor %1 cell changed',
    args0: [{ type: 'input_value', name: 'AE' }],
    message1: 'do %1',
    args1: [{ type: 'input_statement', name: 'DO' }],
    previousStatement: null,
    nextStatement: null,
    colour: 55,
    tooltip:
      'Run code on every cell change (brush, fill, type, shape). Event has c, r, ch, fg, bg, frame.',
  },
  {
    type: 'ascii_editor_on_stroke',
    message0: 'on ASCII editor %1 stroke',
    args0: [{ type: 'input_value', name: 'AE' }],
    message1: 'do %1',
    args1: [{ type: 'input_statement', name: 'DO' }],
    previousStatement: null,
    nextStatement: null,
    colour: 55,
    tooltip:
      'Run code at end of each stroke or fill. Event has tool, fg, bg, char, frame, bbox (cell coords).',
  },
  {
    type: 'ascii_editor_signal',
    message0: 'ASCII editor %1 event %2 signal decay %3 ms',
    args0: [
      { type: 'input_value', name: 'AE' },
      {
        type: 'field_dropdown',
        name: 'EVENT',
        options: [
          ['cell', 'cell'],
          ['stroke', 'stroke'],
          ['color', 'color'],
          ['char', 'char'],
          ['frame', 'frame'],
          ['any', '*'],
        ],
      },
      { type: 'field_number', name: 'DECAY', value: 250, min: 10, max: 5000 },
    ],
    output: null,
    colour: 55,
    tooltip: 'Live 0–1 decaying-pulse signal from the ASCII editor. value=1 on event, decays to 0.',
  },

  // WM paint overlay events
  {
    type: 'wm_on_stroke',
    message0: 'on window paint overlay title %1',
    args0: [{ type: 'field_input', name: 'TITLE', text: 'My Window' }],
    message1: 'do %1',
    args1: [{ type: 'input_statement', name: 'DO' }],
    previousStatement: null,
    nextStatement: null,
    colour: 270,
    tooltip:
      'Run code when a stroke is drawn on the 🖌️ paint overlay of a window (identified by title). Event has tool, color, winId, bbox.',
  },
  {
    type: 'wm_paint_signal',
    message0: 'window %1 overlay stroke signal decay %2 ms',
    args0: [
      { type: 'field_input', name: 'TITLE', text: 'My Window' },
      { type: 'field_number', name: 'DECAY', value: 250, min: 10, max: 5000 },
    ],
    output: null,
    colour: 270,
    tooltip:
      'Live 0–1 signal from the paint overlay on a window. Spikes on each stroke and decays to 0.',
  },
]);

javascriptGenerator.forBlock['pipe_ascii_camera'] = (b) => {
  const idx = b.getFieldValue('INDEX');
  const cols = b.getFieldValue('COLS');
  const color = JSON.stringify(b.getFieldValue('COLOR'));
  const bg = JSON.stringify(b.getFieldValue('BG'));
  const title = JSON.stringify(b.getFieldValue('TITLE'));
  const w = b.getFieldValue('W');
  const h = b.getFieldValue('H');
  return `const _cam${idx} = await Camera.open({ index: ${idx} });\npipe(_cam${idx}).ascii({ cols: ${cols}, color: ${color}, bg: ${bg} }).show(${title}, { w: ${w}, h: ${h} });\n`;
};

javascriptGenerator.forBlock['pipe_ascii_shader_camera'] = (b) => {
  const idx = b.getFieldValue('INDEX');
  const cols = b.getFieldValue('COLS');
  const color = JSON.stringify(b.getFieldValue('COLOR'));
  const bg = JSON.stringify(b.getFieldValue('BG'));
  const glsl = b.getFieldValue('GLSL');
  const title = JSON.stringify(b.getFieldValue('TITLE'));
  const w = b.getFieldValue('W');
  const h = b.getFieldValue('H');
  return `const _cam${idx} = await Camera.open({ index: ${idx} });\npipe(_cam${idx}).ascii({ cols: ${cols}, color: ${color}, bg: ${bg} }).glshader(\`${glsl}\`).show(${title}, { w: ${w}, h: ${h} });\n`;
};

javascriptGenerator.forBlock['pipe_camera_glshader'] = (b) => {
  const idx = b.getFieldValue('INDEX');
  const glsl = b.getFieldValue('GLSL');
  const title = JSON.stringify(b.getFieldValue('TITLE'));
  const w = b.getFieldValue('W');
  const h = b.getFieldValue('H');
  return `const _cam${idx} = await Camera.open({ index: ${idx} });\npipe(_cam${idx}).glshader(\`${glsl}\`).show(${title}, { w: ${w}, h: ${h} });\n`;
};

javascriptGenerator.forBlock['pipe_pixelate_camera'] = (b) => {
  const idx = b.getFieldValue('INDEX');
  const block = b.getFieldValue('BLOCK');
  const title = JSON.stringify(b.getFieldValue('TITLE'));
  const w = b.getFieldValue('W');
  const h = b.getFieldValue('H');
  return `const _cam${idx} = await Camera.open({ index: ${idx} });\npipe(_cam${idx}).pixelate({ blockSize: ${block} }).show(${title}, { w: ${w}, h: ${h} });\n`;
};

Blockly.defineBlocksWithJsonArray([
  {
    type: 'pipe_subtitle_video',
    message0: 'pipe video URL %1 subtitles (SRT) %2 font size %3 → window %4',
    args0: [
      { type: 'field_input', name: 'URL', text: 'https://example.com/video.mp4' },
      {
        type: 'field_multilinetext',
        name: 'SRT',
        text: '1\n00:00:00,000 --> 00:00:02,500\nHello world',
      },
      { type: 'field_number', name: 'SIZE', value: 28, min: 8 },
      { type: 'field_input', name: 'TITLE', text: 'Subtitled Video' },
    ],
    previousStatement: null,
    nextStatement: null,
    colour: 80,
    tooltip: 'Play a video with SRT subtitle overlay via the render pipeline',
  },
]);
javascriptGenerator.forBlock['pipe_subtitle_video'] = (b) => {
  const url = JSON.stringify(b.getFieldValue('URL'));
  const srt = JSON.stringify(b.getFieldValue('SRT'));
  const size = b.getFieldValue('SIZE');
  const title = JSON.stringify(b.getFieldValue('TITLE'));
  return `const _vid = await Media.video(${url});\npipe(_vid).subtitle(${srt}, { fontSize: ${size} }).show(${title}, { w: 800, h: 520 });\n`;
};

// ASCII Animation
javascriptGenerator.forBlock['ascii_play'] = (b) => {
  const f1 = JSON.stringify(b.getFieldValue('F1'));
  const f2 = JSON.stringify(b.getFieldValue('F2'));
  const fps = b.getFieldValue('FPS');
  return [`ascii.play([${f1}, ${f2}], ${fps})`, Order.FUNCTION_CALL];
};
javascriptGenerator.forBlock['ascii_show'] = (b, g) => {
  const anim = g.valueToCode(b, 'ANIM', Order.NONE) || 'null';
  const title = JSON.stringify(b.getFieldValue('TITLE'));
  return `const _aw = wm.spawn(${title}, { w: 400, h: 280 });\n_aw?.querySelector('.wm-body')?.appendChild((${anim}).el);\n`;
};

// Pixel Art (Sprite)
javascriptGenerator.forBlock['sprite_create'] = (b) => {
  const w = b.getFieldValue('W');
  const h = b.getFieldValue('H');
  const sc = b.getFieldValue('SCALE');
  const fr = b.getFieldValue('FRAMES');
  return [`new Sprite({ width: ${w}, height: ${h}, scale: ${sc}, frames: ${fr} })`, Order.NEW];
};
javascriptGenerator.forBlock['sprite_pixel'] = (b, g) => {
  const sp = g.valueToCode(b, 'SP', Order.NONE) || 'null';
  const x = b.getFieldValue('X');
  const y = b.getFieldValue('Y');
  const color = JSON.stringify(b.getFieldValue('COLOR'));
  return `(${sp}).pixel(${x}, ${y}, ${color});\n`;
};
javascriptGenerator.forBlock['sprite_play'] = (b, g) => {
  const sp = g.valueToCode(b, 'SP', Order.NONE) || 'null';
  const fps = b.getFieldValue('FPS');
  return `(${sp}).play(${fps});\n`;
};
javascriptGenerator.forBlock['sprite_show'] = (b, g) => {
  const sp = g.valueToCode(b, 'SP', Order.NONE) || 'null';
  const title = JSON.stringify(b.getFieldValue('TITLE'));
  return `(${sp}).show(${title});\n`;
};

javascriptGenerator.forBlock['draw_backdrop'] = (b) => {
  const src = b.getFieldValue('SRC');
  const fit = b.getFieldValue('FIT');
  // If src looks like a URL or 'camera', emit as a string literal; otherwise treat as variable
  const isLiteral = /^https?:\/\/|^data:|^blob:|^camera$/.test(src.trim());
  const srcExpr = isLiteral ? JSON.stringify(src) : src;
  return `canvas.backdrop(${srcExpr}, { fit: '${fit}' });\n`;
};

// Paint Canvas
javascriptGenerator.forBlock['paint_open'] = (b) => {
  const w = b.getFieldValue('W');
  const h = b.getFieldValue('H');
  const bg = JSON.stringify(b.getFieldValue('BG'));
  return `paint({ width: ${w}, height: ${h}, bg: ${bg} });\n`;
};

javascriptGenerator.forBlock['paint_open_backdrop'] = (b) => {
  const w = b.getFieldValue('W');
  const h = b.getFieldValue('H');
  const bg = JSON.stringify(b.getFieldValue('BG'));
  const backdrop = JSON.stringify(b.getFieldValue('BACKDROP'));
  return `paint({ width: ${w}, height: ${h}, bg: ${bg}, backdrop: ${backdrop} });\n`;
};

// ASCII Editor (statement)
javascriptGenerator.forBlock['ascii_editor_open'] = (b) => {
  const cols = b.getFieldValue('COLS');
  const rows = b.getFieldValue('ROWS');
  return `asciiEditor({ cols: ${cols}, rows: ${rows} });\n`;
};

// ── Art-widget event / signal code generators ─────────────────────────────────

// Paint
javascriptGenerator.forBlock['paint_open_ref'] = (b) => {
  const w = b.getFieldValue('W');
  const h = b.getFieldValue('H');
  const bg = JSON.stringify(b.getFieldValue('BG'));
  return [
    `paint({ width: ${w}, height: ${h}, bg: ${bg} })`,
    Blockly.JavaScript.ORDER_FUNCTION_CALL,
  ];
};

javascriptGenerator.forBlock['paint_on_stroke'] = (b, g) => {
  const p = g.valueToCode(b, 'P', Blockly.JavaScript.ORDER_NONE) || 'paint()';
  const do_ = g.statementToCode(b, 'DO');
  return `${p}.onStroke((_e) => {\n${do_}});\n`;
};

javascriptGenerator.forBlock['paint_on_color'] = (b, g) => {
  const p = g.valueToCode(b, 'P', Blockly.JavaScript.ORDER_NONE) || 'paint()';
  const do_ = g.statementToCode(b, 'DO');
  return `${p}.onColor((_e) => {\n${do_}});\n`;
};

javascriptGenerator.forBlock['paint_signal'] = (b, g) => {
  const p = g.valueToCode(b, 'P', Blockly.JavaScript.ORDER_NONE) || 'paint()';
  const decay = b.getFieldValue('DECAY');
  return [`${p}.signal('stroke', { decay: ${decay} })`, Blockly.JavaScript.ORDER_FUNCTION_CALL];
};

// SpriteEditor
javascriptGenerator.forBlock['sprite_editor_open'] = (b) => {
  const w = b.getFieldValue('W');
  const h = b.getFieldValue('H');
  const scale = b.getFieldValue('SCALE');
  return [
    `spriteEditor({ width: ${w}, height: ${h}, scale: ${scale} })`,
    Blockly.JavaScript.ORDER_FUNCTION_CALL,
  ];
};

javascriptGenerator.forBlock['sprite_editor_on_pixel'] = (b, g) => {
  const sp = g.valueToCode(b, 'SP', Blockly.JavaScript.ORDER_NONE) || 'spriteEditor()';
  const do_ = g.statementToCode(b, 'DO');
  return `${sp}.onPixel((_e) => {\n${do_}});\n`;
};

javascriptGenerator.forBlock['sprite_editor_on_stroke'] = (b, g) => {
  const sp = g.valueToCode(b, 'SP', Blockly.JavaScript.ORDER_NONE) || 'spriteEditor()';
  const do_ = g.statementToCode(b, 'DO');
  return `${sp}.onStroke((_e) => {\n${do_}});\n`;
};

javascriptGenerator.forBlock['sprite_editor_signal'] = (b, g) => {
  const sp = g.valueToCode(b, 'SP', Blockly.JavaScript.ORDER_NONE) || 'spriteEditor()';
  const ev = JSON.stringify(b.getFieldValue('EVENT'));
  const decay = b.getFieldValue('DECAY');
  return [`${sp}.signal(${ev}, { decay: ${decay} })`, Blockly.JavaScript.ORDER_FUNCTION_CALL];
};

// AsciiEditor
javascriptGenerator.forBlock['ascii_editor_open_ref'] = (b) => {
  const cols = b.getFieldValue('COLS');
  const rows = b.getFieldValue('ROWS');
  return [`asciiEditor({ cols: ${cols}, rows: ${rows} })`, Blockly.JavaScript.ORDER_FUNCTION_CALL];
};

javascriptGenerator.forBlock['ascii_editor_on_cell'] = (b, g) => {
  const ae = g.valueToCode(b, 'AE', Blockly.JavaScript.ORDER_NONE) || 'asciiEditor()';
  const do_ = g.statementToCode(b, 'DO');
  return `${ae}.onCell((_e) => {\n${do_}});\n`;
};

javascriptGenerator.forBlock['ascii_editor_on_stroke'] = (b, g) => {
  const ae = g.valueToCode(b, 'AE', Blockly.JavaScript.ORDER_NONE) || 'asciiEditor()';
  const do_ = g.statementToCode(b, 'DO');
  return `${ae}.onStroke((_e) => {\n${do_}});\n`;
};

javascriptGenerator.forBlock['ascii_editor_signal'] = (b, g) => {
  const ae = g.valueToCode(b, 'AE', Blockly.JavaScript.ORDER_NONE) || 'asciiEditor()';
  const ev = JSON.stringify(b.getFieldValue('EVENT'));
  const decay = b.getFieldValue('DECAY');
  return [`${ae}.signal(${ev}, { decay: ${decay} })`, Blockly.JavaScript.ORDER_FUNCTION_CALL];
};

// WM overlay
javascriptGenerator.forBlock['wm_on_stroke'] = (b, g) => {
  const title = JSON.stringify(b.getFieldValue('TITLE'));
  const do_ = g.statementToCode(b, 'DO');
  return `wm.onStroke(wm.getByTitle(${title}), (_e) => {\n${do_}});\n`;
};

javascriptGenerator.forBlock['wm_paint_signal'] = (b) => {
  const title = JSON.stringify(b.getFieldValue('TITLE'));
  const decay = b.getFieldValue('DECAY');
  return [
    `wm.paintSignal(wm.getByTitle(${title}), 'stroke', { decay: ${decay} })`,
    Blockly.JavaScript.ORDER_FUNCTION_CALL,
  ];
};
