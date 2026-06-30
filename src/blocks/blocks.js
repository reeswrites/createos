import * as Blockly from 'blockly';
import { javascriptGenerator, Order } from 'blockly/javascript';
import 'blockly/blocks';

// Blockly v13 bug: moving a block SVG to the drag layer fires pointercancel,
// which triggers handleUp prematurely and aborts the drop. Filter it out.
{
  const _origHandleUp = Blockly.Gesture.prototype.handleUp;
  Blockly.Gesture.prototype.handleUp = function (e) {
    if (e.type === 'pointercancel' && this.isDragging()) return;
    _origHandleUp.call(this, e);
  };
}

// ── Block definitions ────────────────────────────────────────────────────────

Blockly.defineBlocksWithJsonArray([
  // ── Control ────────────────────────────────────────────────────────────────
  {
    type: 'ctrl_interval',
    message0: 'every %1 ms',
    args0: [{ type: 'field_number', name: 'MS', value: 100, min: 1 }],
    message1: 'do %1',
    args1: [{ type: 'input_statement', name: 'DO' }],
    previousStatement: null,
    nextStatement: null,
    colour: 120,
    tooltip: 'Repeat code every N milliseconds',
  },
  {
    type: 'ctrl_timeout',
    message0: 'after %1 ms',
    args0: [{ type: 'field_number', name: 'MS', value: 1000, min: 0 }],
    message1: 'do %1',
    args1: [{ type: 'input_statement', name: 'DO' }],
    previousStatement: null,
    nextStatement: null,
    colour: 120,
    tooltip: 'Run code once after N milliseconds',
  },
  {
    type: 'ctrl_onkey',
    message0: 'when key %1 pressed',
    args0: [
      {
        type: 'field_dropdown',
        name: 'KEY',
        options: [
          ['↑', 'ArrowUp'],
          ['↓', 'ArrowDown'],
          ['←', 'ArrowLeft'],
          ['→', 'ArrowRight'],
          ['Space', ' '],
          ['Enter', 'Enter'],
          ['Escape', 'Escape'],
          ['any', 'any'],
        ],
      },
    ],
    message1: 'do %1',
    args1: [{ type: 'input_statement', name: 'DO' }],
    previousStatement: null,
    nextStatement: null,
    colour: 120,
    tooltip: 'Run code when a key is pressed',
  },
  {
    type: 'ctrl_stop',
    message0: 'stop program',
    previousStatement: null,
    nextStatement: null,
    colour: 0,
  },
  {
    type: 'ctrl_pause',
    message0: 'pause',
    previousStatement: null,
    nextStatement: null,
    colour: 30,
  },
  {
    type: 'ctrl_resume',
    message0: 'resume',
    previousStatement: null,
    nextStatement: null,
    colour: 30,
  },
  {
    type: 'ctrl_random',
    message0: 'random %1 to %2',
    args0: [
      { type: 'field_number', name: 'LO', value: 0 },
      { type: 'field_number', name: 'HI', value: 100 },
    ],
    output: 'Number',
    colour: 230,
    tooltip: 'Random number between lo and hi',
  },
  {
    type: 'ctrl_random_color',
    message0: 'random color',
    output: 'String',
    colour: 230,
    tooltip: 'A random vivid HSL color string',
  },

  // ── Audio ──────────────────────────────────────────────────────────────────
  {
    type: 'audio_create_synth',
    message0: 'create %1 synth',
    args0: [
      {
        type: 'field_dropdown',
        name: 'TYPE',
        options: [
          ['synth', 'synth'],
          ['polyphonic', 'poly'],
          ['FM', 'fm'],
          ['AM', 'am'],
          ['pluck', 'pluck'],
          ['kick', 'kick'],
          ['metal', 'metal'],
          ['noise', 'noise'],
        ],
      },
    ],
    output: null,
    colour: 260,
    tooltip: 'Create a synthesizer — store in a variable',
  },
  {
    type: 'audio_play',
    message0: 'play %1 for %2 on %3',
    args0: [
      {
        type: 'field_dropdown',
        name: 'NOTE',
        options: [
          ['C3', 'C3'],
          ['D3', 'D3'],
          ['E3', 'E3'],
          ['G3', 'G3'],
          ['A3', 'A3'],
          ['C4', 'C4'],
          ['D4', 'D4'],
          ['E4', 'E4'],
          ['F4', 'F4'],
          ['G4', 'G4'],
          ['A4', 'A4'],
          ['B4', 'B4'],
          ['C5', 'C5'],
          ['D5', 'D5'],
          ['E5', 'E5'],
        ],
      },
      {
        type: 'field_dropdown',
        name: 'DUR',
        options: [
          ['whole', '1n'],
          ['half', '2n'],
          ['quarter', '4n'],
          ['eighth', '8n'],
          ['sixteenth', '16n'],
        ],
      },
      { type: 'input_value', name: 'SYNTH' },
    ],
    previousStatement: null,
    nextStatement: null,
    colour: 260,
    tooltip: 'Play a note on a synth',
  },
  {
    type: 'audio_bpm',
    message0: 'set BPM to %1',
    args0: [{ type: 'field_number', name: 'BPM', value: 120, min: 1, max: 300 }],
    previousStatement: null,
    nextStatement: null,
    colour: 260,
  },
  {
    type: 'mixer_show',
    message0: 'open mixer',
    previousStatement: null,
    nextStatement: null,
    colour: 260,
    tooltip: 'Open the live audio mixer console',
  },
  {
    type: 'mixer_volume',
    message0: 'mixer: set %1 volume to %2 dB',
    args0: [
      { type: 'field_input', name: 'NAME', text: 'lead' },
      { type: 'field_number', name: 'DB', value: 0, min: -48, max: 6 },
    ],
    previousStatement: null,
    nextStatement: null,
    colour: 260,
    tooltip: 'Set a mixer strip volume (use "master" for the master strip)',
  },
  {
    type: 'mixer_pan',
    message0: 'mixer: set %1 pan to %2',
    args0: [
      { type: 'field_input', name: 'NAME', text: 'lead' },
      { type: 'field_number', name: 'PAN', value: 0, min: -1, max: 1, precision: 0.05 },
    ],
    previousStatement: null,
    nextStatement: null,
    colour: 260,
    tooltip: 'Pan a mixer strip (-1 left … 1 right)',
  },
  {
    type: 'mixer_mute',
    message0: 'mixer: %1 %2',
    args0: [
      {
        type: 'field_dropdown',
        name: 'STATE',
        options: [
          ['mute', 'true'],
          ['unmute', 'false'],
        ],
      },
      { type: 'field_input', name: 'NAME', text: 'lead' },
    ],
    previousStatement: null,
    nextStatement: null,
    colour: 260,
    tooltip: 'Mute or unmute a mixer strip',
  },
  {
    type: 'audio_transport_start',
    message0: 'start transport',
    previousStatement: null,
    nextStatement: null,
    colour: 260,
    tooltip: 'Start the audio transport clock — required for sequence and loop',
  },
  {
    type: 'audio_volume',
    message0: 'set master volume %1 dB',
    args0: [{ type: 'field_number', name: 'DB', value: -6, min: -60, max: 6 }],
    previousStatement: null,
    nextStatement: null,
    colour: 260,
  },
  {
    type: 'audio_reverb',
    message0: 'reverb %1 sec',
    args0: [{ type: 'field_number', name: 'DEC', value: 2, min: 0.1, max: 30 }],
    output: null,
    colour: 260,
    tooltip: 'Create a reverb effect — connect an instrument to it',
  },
  {
    type: 'audio_delay',
    message0: 'delay %1 sec feedback %2',
    args0: [
      { type: 'field_number', name: 'TIME', value: 0.25, min: 0.01 },
      { type: 'field_number', name: 'FB', value: 0.5, min: 0, max: 0.99 },
    ],
    output: null,
    colour: 260,
    tooltip: 'Create a feedback delay effect',
  },
  {
    type: 'audio_distort',
    message0: 'distortion %1',
    args0: [{ type: 'field_number', name: 'AMT', value: 0.8, min: 0, max: 1 }],
    output: null,
    colour: 260,
    tooltip: 'Create a distortion effect',
  },
  {
    type: 'audio_connect',
    message0: 'connect %1 to %2',
    args0: [
      { type: 'input_value', name: 'FROM' },
      { type: 'input_value', name: 'TO' },
    ],
    previousStatement: null,
    nextStatement: null,
    colour: 260,
    tooltip: 'Connect instrument to an effect',
  },

  // ── Audio Visualizer ───────────────────────────────────────────────────────
  {
    type: 'audio_viz',
    message0: 'visualize %1 mode %2',
    args0: [
      { type: 'input_value', name: 'SOURCE' },
      {
        type: 'field_dropdown',
        name: 'MODE',
        options: [
          ['bars', 'bars'],
          ['wave', 'wave'],
          ['ring', 'ring'],
        ],
      },
    ],
    output: null,
    colour: 260,
    tooltip: 'Create an audio visualizer — returns AudioViz. Connect to start/stop/opacity/shader.',
  },
  {
    type: 'audio_viz_start',
    message0: 'start visualizer %1',
    args0: [{ type: 'input_value', name: 'VIZ' }],
    previousStatement: null,
    nextStatement: null,
    colour: 260,
    tooltip: 'Start an AudioViz drawing to the canvas',
  },
  {
    type: 'audio_viz_stop',
    message0: 'stop visualizer %1',
    args0: [{ type: 'input_value', name: 'VIZ' }],
    previousStatement: null,
    nextStatement: null,
    colour: 260,
    tooltip: 'Stop an AudioViz',
  },
  {
    type: 'audio_viz_shader',
    message0: 'visualizer %1 shader %2',
    args0: [
      { type: 'input_value', name: 'VIZ' },
      {
        type: 'field_dropdown',
        name: 'PRESET',
        options: [
          ['thermal', 'thermal'],
          ['cool', 'cool'],
          ['rainbow', 'rainbow'],
          ['mono', 'mono'],
          ['neon', 'neon'],
        ],
      },
    ],
    previousStatement: null,
    nextStatement: null,
    colour: 260,
    tooltip: 'Apply a named shader preset to an AudioViz — thermal, cool, rainbow, mono, neon',
  },

  // ── Audio Mic / Speech ─────────────────────────────────────────────────────
  {
    type: 'audio_level',
    message0: 'mic level',
    output: 'Number',
    colour: 260,
    tooltip: 'Live mic amplitude 0–1 (RMS). Enable mic in toolbar first.',
  },
  {
    type: 'audio_on_level',
    message0: 'when mic louder than %1',
    args0: [
      { type: 'field_number', name: 'THRESHOLD', value: 0.6, min: 0, max: 1, precision: 0.01 },
    ],
    message1: 'do %1',
    args1: [{ type: 'input_statement', name: 'DO' }],
    previousStatement: null,
    nextStatement: null,
    colour: 260,
    tooltip: 'Run code when mic amplitude exceeds threshold (0–1). Enable mic in toolbar first.',
  },
  {
    type: 'audio_on_word',
    message0: 'when word %1 spoken',
    args0: [{ type: 'field_input', name: 'WORD', text: 'hello' }],
    message1: 'do %1',
    args1: [{ type: 'input_statement', name: 'DO' }],
    previousStatement: null,
    nextStatement: null,
    colour: 260,
    tooltip: 'Run code when a specific word is spoken. Uses Web Speech API (Chrome/Edge).',
  },
  {
    type: 'audio_say',
    message0: 'say %1',
    args0: [{ type: 'field_input', name: 'TEXT', text: 'hello' }],
    previousStatement: null,
    nextStatement: null,
    colour: 260,
    tooltip: 'Speak text using browser text-to-speech.',
  },

  // ── Raw JS passthrough (ADR 037) ─────────────────────────────────────────────
  // Holds any statement that has no dedicated block — emitted verbatim by the
  // generator. js-to-blocks wraps unrecognized statements (e.g. Strudel note()/s()
  // calls) in this instead of dropping them, so text↔blocks round-trips losslessly.
  {
    type: 'js_raw',
    message0: 'JS %1',
    args0: [{ type: 'field_multilinetext', name: 'CODE', text: '' }],
    previousStatement: null,
    nextStatement: null,
    colour: 0,
    tooltip:
      'Raw JavaScript with no dedicated block (e.g. a Strudel pattern). Preserved verbatim so switching between text and blocks never loses code. Edit as text.',
  },

  // ── Shader ─────────────────────────────────────────────────────────────────
  // Creator blocks (output = Shader) — plug into start / stop / opacity / set_uniform
  {
    type: 'shader_preset',
    message0: '%1 shader',
    args0: [
      {
        type: 'field_dropdown',
        name: 'PRESET',
        options: [
          ['gradient', 'gradient'],
          ['plasma', 'plasma'],
          ['waves', 'waves'],
          ['circles', 'circles'],
          ['noise', 'noise'],
        ],
      },
    ],
    output: null,
    colour: 330,
    tooltip: 'Create a preset shader — connect to "start shader"',
  },
  {
    type: 'shader_new',
    message0: 'new shader z %1 opacity %2',
    args0: [
      { type: 'field_number', name: 'Z', value: 30 },
      { type: 'field_number', name: 'OPACITY', value: 1.0, min: 0, max: 1 },
    ],
    output: null,
    colour: 330,
    tooltip: 'Create a custom shader — connect to "start shader"',
  },
  {
    type: 'shader_wgsl',
    message0: 'wgsl shader %1',
    args0: [{ type: 'field_input', name: 'BODY', text: 'return vec4f(uv.x, uv.y, 0.5, 1.0);' }],
    output: null,
    colour: 330,
    tooltip: 'Custom WGSL fragment body — connects to start/stop/opacity blocks.',
  },
  {
    type: 'shader_js_fn',
    message0: 'js shader %1',
    args0: [
      {
        type: 'field_input',
        name: 'BODY',
        text: '({ uv, time }) => {\n  return [uv.x, uv.y, 0.5, 1.0];\n}',
      },
    ],
    output: null,
    colour: 330,
    tooltip: 'JS arrow function shader — written as plain JS, compiled to WGSL at runtime.',
  },
  // Decomposed JS shader fn — shader body as nested statement blocks
  {
    type: 'shader_fn_body',
    message0: 'shader fn %1',
    args0: [{ type: 'input_statement', name: 'BODY' }],
    output: null,
    colour: 330,
    tooltip: 'Shader function body — use math/variable/return blocks inside.',
  },
  {
    type: 'shader_return_rgba',
    message0: 'return  r %1  g %2  b %3  a %4',
    args0: [
      { type: 'input_value', name: 'R' },
      { type: 'input_value', name: 'G' },
      { type: 'input_value', name: 'B' },
      { type: 'input_value', name: 'A' },
    ],
    previousStatement: null,
    colour: 330,
    tooltip: 'Return RGBA color from the shader.',
  },
  // Shader math — custom blocks that emit radians (Blockly's built-in trig converts degrees)
  {
    type: 'shader_math_trig',
    message0: '%1 %2',
    args0: [
      {
        type: 'field_dropdown',
        name: 'OP',
        options: [
          ['sin', 'sin'],
          ['cos', 'cos'],
          ['tan', 'tan'],
          ['asin', 'asin'],
          ['acos', 'acos'],
          ['atan', 'atan'],
        ],
      },
      { type: 'input_value', name: 'ARG' },
    ],
    output: 'Number',
    colour: 230,
    tooltip: 'Trig function in radians (not degrees).',
  },
  {
    type: 'shader_math_fn',
    message0: '%1 %2 %3',
    args0: [
      {
        type: 'field_dropdown',
        name: 'OP',
        options: [
          ['abs', 'abs'],
          ['sqrt', 'sqrt'],
          ['floor', 'floor'],
          ['ceil', 'ceil'],
          ['round', 'round'],
          ['sign', 'sign'],
          ['exp', 'exp'],
          ['log', 'log'],
          ['min', 'min'],
          ['max', 'max'],
        ],
      },
      { type: 'input_value', name: 'ARG' },
      { type: 'input_value', name: 'ARG2' },
    ],
    output: 'Number',
    colour: 230,
    tooltip: 'Math function — ARG2 used by min/max.',
  },
  // Shader parameter value blocks
  ...[
    'uv_x:uv.x',
    'uv_y:uv.y',
    'time:time',
    'mouse_x:mouse.x',
    'mouse_y:mouse.y',
    'res_x:res.x',
    'res_y:res.y',
    'custom_x:custom.x',
    'custom_y:custom.y',
    'custom_z:custom.z',
    'custom_w:custom.w',
  ].map((s) => {
    const [key, label] = s.split(':');
    return {
      type: `shader_param_${key}`,
      message0: label,
      output: 'Number',
      colour: 300,
      tooltip: `Shader input: ${label}`,
    };
  }),
  {
    type: 'shader_camera_effect',
    message0: 'camera %1 shader %2',
    args0: [
      { type: 'input_value', name: 'CAM' },
      {
        type: 'field_dropdown',
        name: 'EFFECT',
        options: [
          ['greyscale', 'greyscale'],
          ['invert', 'invert'],
          ['channel swap', 'channel_swap'],
          ['posterize', 'posterize'],
          ['scanlines', 'scanlines'],
        ],
      },
    ],
    output: null,
    colour: 330,
    tooltip:
      'Camera shader — leave cam empty for toolbar camera, or plug in a Camera.open() stream. Connect to start/stop/opacity.',
  },
  {
    type: 'shader_video_effect',
    message0: 'video %1 shader %2',
    args0: [
      { type: 'input_value', name: 'VIDEO' },
      {
        type: 'field_dropdown',
        name: 'EFFECT',
        options: [
          ['greyscale', 'greyscale'],
          ['invert', 'invert'],
          ['channel swap', 'channel_swap'],
          ['posterize', 'posterize'],
          ['scanlines', 'scanlines'],
        ],
      },
    ],
    output: null,
    colour: 330,
    tooltip: 'Create a video shader — connect to start/stop/opacity.',
  },
  {
    type: 'shader_window_effect',
    message0: 'window %1 shader %2',
    args0: [
      {
        type: 'field_dropdown',
        name: 'WIN',
        options: [
          ['editor', 'editor'],
          ['console', 'console'],
          ['canvas', 'canvas'],
        ],
      },
      {
        type: 'field_dropdown',
        name: 'EFFECT',
        options: [
          ['greyscale', 'greyscale'],
          ['invert', 'invert'],
          ['channel swap', 'channel_swap'],
          ['posterize', 'posterize'],
          ['scanlines', 'scanlines'],
        ],
      },
    ],
    output: null,
    colour: 330,
    tooltip: 'Capture an IDE window and apply a shader effect — connect to "start shader".',
  },
  {
    type: 'shader_mic_viz',
    message0: 'mic viz shader %1',
    args0: [
      {
        type: 'field_dropdown',
        name: 'EFFECT',
        options: [
          ['greyscale', 'greyscale'],
          ['invert', 'invert'],
          ['channel swap', 'channel_swap'],
          ['posterize', 'posterize'],
          ['scanlines', 'scanlines'],
        ],
      },
    ],
    output: null,
    colour: 330,
    tooltip: 'Apply a shader effect to the mic visualizer canvas — connect to "start shader".',
  },
  // Action blocks (statements) — take a Shader input
  {
    type: 'shader_start',
    message0: 'start shader %1',
    args0: [{ type: 'input_value', name: 'SHADER' }],
    previousStatement: null,
    nextStatement: null,
    colour: 330,
  },
  {
    type: 'shader_stop',
    message0: 'stop shader %1',
    args0: [{ type: 'input_value', name: 'SHADER' }],
    previousStatement: null,
    nextStatement: null,
    colour: 330,
  },
  {
    type: 'shader_opacity',
    message0: 'set shader %1 opacity %2',
    args0: [
      { type: 'input_value', name: 'SHADER' },
      { type: 'field_number', name: 'OPACITY', value: 0.5, min: 0, max: 1 },
    ],
    previousStatement: null,
    nextStatement: null,
    colour: 330,
  },
  {
    type: 'shader_set_uniform',
    message0: 'set shader %1 channel %2 to %3',
    args0: [
      { type: 'input_value', name: 'SHADER' },
      {
        type: 'field_dropdown',
        name: 'CHANNEL',
        options: [
          ['0', '0'],
          ['1', '1'],
          ['2', '2'],
          ['3', '3'],
        ],
      },
      { type: 'field_number', name: 'VALUE', value: 0.5, min: 0, max: 1 },
    ],
    previousStatement: null,
    nextStatement: null,
    colour: 330,
    tooltip: "Write a value into the shader's custom uniform (readable as custom.x .y .z .w)",
  },

  // ── Vision ─────────────────────────────────────────────────────────────────
  {
    type: 'vision_on_gesture',
    message0: 'when gesture %1',
    args0: [
      {
        type: 'field_dropdown',
        name: 'GESTURE',
        options: [
          ['👍 Thumb Up', 'Thumb_Up'],
          ['👎 Thumb Down', 'Thumb_Down'],
          ['✋ Open Palm', 'Open_Palm'],
          ['✊ Closed Fist', 'Closed_Fist'],
          ['☝️ Pointing Up', 'Pointing_Up'],
          ['✌️ Victory', 'Victory'],
          ['🤟 I Love You', 'ILoveYou'],
        ],
      },
    ],
    message1: 'do %1',
    args1: [{ type: 'input_statement', name: 'DO' }],
    previousStatement: null,
    nextStatement: null,
    colour: 180,
    tooltip: 'Run code when a hand gesture is first detected',
  },
  {
    type: 'vision_on_expression',
    message0: 'when face %1',
    args0: [
      {
        type: 'field_dropdown',
        name: 'EXPR',
        options: [
          ['😊 smiles', 'smile'],
          ['😮 is surprised', 'surprise'],
          ['😦 frowns', 'frown'],
          ['😮 mouth open', 'mouth_open'],
        ],
      },
    ],
    message1: 'do %1',
    args1: [{ type: 'input_statement', name: 'DO' }],
    previousStatement: null,
    nextStatement: null,
    colour: 180,
  },
  {
    type: 'vision_gesture',
    message0: 'current gesture',
    output: 'String',
    colour: 180,
    tooltip: 'Current hand gesture string or null',
  },
  {
    type: 'vision_face_detected',
    message0: 'face detected',
    output: 'Boolean',
    colour: 180,
    tooltip: 'True if a face is currently visible',
  },
  {
    type: 'vision_nearest',
    message0: 'nearest %1',
    args0: [
      {
        type: 'field_dropdown',
        name: 'LABEL',
        options: [
          ['person', 'person'],
          ['cat', 'cat'],
          ['dog', 'dog'],
          ['chair', 'chair'],
          ['bottle', 'bottle'],
          ['cell phone', 'cell phone'],
          ['laptop', 'laptop'],
          ['book', 'book'],
        ],
      },
    ],
    output: null,
    colour: 180,
    tooltip: 'Nearest detected object — {label, cx, cy, confidence} or null',
  },
  {
    type: 'vision_gaze',
    message0: 'gaze',
    output: null,
    colour: 180,
    tooltip: 'Where the user looks — {x, y, dir, blink, leftClosed, rightClosed, vx, vy} or null',
  },
  {
    type: 'vision_on_gaze',
    message0: 'when looking %1',
    args0: [
      {
        type: 'field_dropdown',
        name: 'DIR',
        options: [
          ['⬅️ left', 'left'],
          ['➡️ right', 'right'],
          ['⬆️ up', 'up'],
          ['⬇️ down', 'down'],
          ['🎯 center', 'center'],
        ],
      },
    ],
    message1: 'do %1',
    args1: [{ type: 'input_statement', name: 'DO' }],
    previousStatement: null,
    nextStatement: null,
    colour: 180,
    tooltip: 'Run code when gaze direction enters this zone (no calibration needed)',
  },
  {
    type: 'vision_on_blink',
    message0: 'when blink',
    message1: 'do %1',
    args1: [{ type: 'input_statement', name: 'DO' }],
    previousStatement: null,
    nextStatement: null,
    colour: 180,
    tooltip: 'Run code when both eyes blink',
  },

  // ── Draw ───────────────────────────────────────────────────────────────────
  {
    type: 'draw_bg',
    message0: 'background color %1',
    args0: [{ type: 'field_input', name: 'COLOR', text: '#111111' }],
    previousStatement: null,
    nextStatement: null,
    colour: 60,
    tooltip: 'Fill entire canvas with a color',
  },
  {
    type: 'draw_line',
    message0: 'line from x %1 y %2 to x %3 y %4 color %5 thickness %6',
    args0: [
      { type: 'field_number', name: 'X1', value: 0 },
      { type: 'field_number', name: 'Y1', value: 0 },
      { type: 'field_number', name: 'X2', value: 400 },
      { type: 'field_number', name: 'Y2', value: 400 },
      { type: 'field_input', name: 'COLOR', text: 'white' },
      { type: 'field_number', name: 'THICKNESS', value: 2, min: 0.5 },
    ],
    previousStatement: null,
    nextStatement: null,
    colour: 60,
    tooltip: 'Draw a line between two points',
  },
  {
    type: 'draw_text',
    message0: 'text %1 at x %2 y %3 size %4 color %5',
    args0: [
      { type: 'field_input', name: 'STR', text: 'hello' },
      { type: 'field_number', name: 'X', value: 100 },
      { type: 'field_number', name: 'Y', value: 100 },
      { type: 'field_number', name: 'SIZE', value: 32, min: 1 },
      { type: 'field_input', name: 'COLOR', text: 'white' },
    ],
    previousStatement: null,
    nextStatement: null,
    colour: 60,
    tooltip: 'Draw text on the canvas',
  },
  {
    type: 'draw_text_rich',
    message0: 'text %1 at x %2 y %3 size %4 color %5 stroke %6 shadow %7',
    args0: [
      { type: 'field_input', name: 'STR', text: 'hello' },
      { type: 'field_number', name: 'X', value: 100 },
      { type: 'field_number', name: 'Y', value: 200 },
      { type: 'field_number', name: 'SIZE', value: 48, min: 1 },
      { type: 'field_input', name: 'COLOR', text: 'white' },
      { type: 'field_checkbox', name: 'STROKE', checked: false },
      { type: 'field_checkbox', name: 'SHADOW', checked: true },
    ],
    previousStatement: null,
    nextStatement: null,
    colour: 60,
    tooltip: 'Draw styled text — optional stroke outline and drop shadow',
  },
  {
    type: 'draw_alpha',
    message0: 'draw transparency %1',
    args0: [{ type: 'field_number', name: 'ALPHA', value: 0.5, min: 0, max: 1 }],
    previousStatement: null,
    nextStatement: null,
    colour: 60,
    tooltip:
      'Set global drawing opacity (0=invisible, 1=opaque). Affects all draw calls after this.',
  },
  {
    type: 'draw_reset',
    message0: 'reset draw state',
    previousStatement: null,
    nextStatement: null,
    colour: 60,
    tooltip: 'Reset draw transparency, blend mode, and transforms to defaults',
  },

  // ── Canvas ─────────────────────────────────────────────────────────────────
  {
    type: 'canvas_fill_rect',
    message0: 'fill rect x %1 y %2 w %3 h %4 color %5',
    args0: [
      { type: 'field_number', name: 'X', value: 0 },
      { type: 'field_number', name: 'Y', value: 0 },
      { type: 'field_number', name: 'W', value: 100 },
      { type: 'field_number', name: 'H', value: 100 },
      { type: 'field_input', name: 'COLOR', text: 'red' },
    ],
    previousStatement: null,
    nextStatement: null,
    colour: 60,
    tooltip: 'Draw a filled rectangle on canvas layer 0',
  },
  {
    type: 'canvas_fill_circle',
    message0: 'fill circle x %1 y %2 r %3 color %4',
    args0: [
      { type: 'field_number', name: 'X', value: 200 },
      { type: 'field_number', name: 'Y', value: 200 },
      { type: 'field_number', name: 'R', value: 50 },
      { type: 'field_input', name: 'COLOR', text: 'blue' },
    ],
    previousStatement: null,
    nextStatement: null,
    colour: 60,
  },
  {
    type: 'canvas_clear',
    message0: 'clear canvas',
    previousStatement: null,
    nextStatement: null,
    colour: 60,
  },

  // ── Windowed Canvas surface (ADR 038) ───────────────────────────────────────
  {
    type: 'canvas_new',
    message0: 'new Canvas width %1 height %2 title %3',
    args0: [
      { type: 'field_number', name: 'W', value: 1600 },
      { type: 'field_number', name: 'H', value: 900 },
      { type: 'field_input', name: 'TITLE', text: 'Sketch' },
    ],
    output: null,
    colour: 200,
    tooltip:
      'Create a window-scoped drawing surface at its own size. Plug into a variable, then use the canvas background / circle / on-pointer blocks.',
  },
  {
    type: 'canvas_surface_bg',
    message0: 'canvas %1 background %2',
    args0: [
      { type: 'input_value', name: 'CANVAS' },
      { type: 'field_input', name: 'COLOR', text: '#0a0a18' },
    ],
    inputsInline: true,
    previousStatement: null,
    nextStatement: null,
    colour: 200,
    tooltip: 'Fill a Canvas surface with a color.',
  },
  {
    type: 'canvas_surface_circle',
    message0: 'canvas %1 circle x %2 y %3 r %4 color %5',
    args0: [
      { type: 'input_value', name: 'CANVAS' },
      { type: 'input_value', name: 'X', check: 'Number' },
      { type: 'input_value', name: 'Y', check: 'Number' },
      { type: 'field_number', name: 'R', value: 20 },
      { type: 'field_input', name: 'COLOR', text: '#ffffff' },
    ],
    inputsInline: true,
    previousStatement: null,
    nextStatement: null,
    colour: 200,
    tooltip: 'Draw a filled circle on a Canvas surface.',
  },
  {
    type: 'canvas_on',
    message0: 'on canvas %1 pointer %2',
    args0: [
      { type: 'input_value', name: 'CANVAS' },
      {
        type: 'field_dropdown',
        name: 'EVENT',
        options: [
          ['down', 'down'],
          ['move', 'move'],
          ['up', 'up'],
        ],
      },
    ],
    message1: 'do %1',
    args1: [{ type: 'input_statement', name: 'DO' }],
    previousStatement: null,
    nextStatement: null,
    colour: 200,
    tooltip:
      'Run code on a Canvas pointer event. Read the live position with the canvas pointer block.',
  },
  {
    type: 'canvas_pointer',
    message0: 'canvas %1 pointer %2',
    args0: [
      { type: 'input_value', name: 'CANVAS' },
      {
        type: 'field_dropdown',
        name: 'AXIS',
        options: [
          ['x', 'x'],
          ['y', 'y'],
        ],
      },
    ],
    inputsInline: true,
    output: 'Number',
    colour: 200,
    tooltip: 'Read the live pointer x or y, in canvas coordinates.',
  },
  {
    type: 'canvas_blur',
    message0: 'blur layer %1 by %2 px',
    args0: [
      { type: 'field_number', name: 'Z', value: 0 },
      { type: 'field_number', name: 'AMT', value: 5, min: 0 },
    ],
    previousStatement: null,
    nextStatement: null,
    colour: 60,
  },
  {
    type: 'canvas_layer_opacity',
    message0: 'set layer %1 opacity %2',
    args0: [
      { type: 'field_number', name: 'Z', value: 0 },
      { type: 'field_number', name: 'OPACITY', value: 0.5, min: 0, max: 1 },
    ],
    previousStatement: null,
    nextStatement: null,
    colour: 60,
  },
  {
    type: 'canvas_blend_mode',
    message0: 'layer %1 blend mode %2',
    args0: [
      { type: 'field_number', name: 'Z', value: 1 },
      {
        type: 'field_dropdown',
        name: 'MODE',
        options: [
          ['screen', 'screen'],
          ['multiply', 'multiply'],
          ['overlay', 'overlay'],
          ['difference', 'difference'],
          ['lighten', 'lighten'],
          ['darken', 'darken'],
          ['hard-light', 'hard-light'],
          ['soft-light', 'soft-light'],
          ['exclusion', 'exclusion'],
          ['color-burn', 'color-burn'],
        ],
      },
    ],
    previousStatement: null,
    nextStatement: null,
    colour: 60,
    tooltip: 'Set CSS mix-blend-mode on a layer — composites it with layers below',
  },
  {
    type: 'draw_pixelate',
    message0: 'pixelate layer %1 block size %2',
    args0: [
      { type: 'field_number', name: 'Z', value: 0 },
      { type: 'field_number', name: 'BLOCK', value: 8, min: 1 },
    ],
    previousStatement: null,
    nextStatement: null,
    colour: 60,
    tooltip: 'Draw a blocky pixelated copy of a canvas layer onto the main canvas',
  },

  {
    type: 'draw_backdrop',
    message0: 'draw backdrop url/source %1 fit %2',
    args0: [
      { type: 'field_input', name: 'SRC', text: 'camera' },
      {
        type: 'field_dropdown',
        name: 'FIT',
        options: [
          ['cover', 'cover'],
          ['contain', 'contain'],
          ['stretch', 'stretch'],
        ],
      },
    ],
    previousStatement: null,
    nextStatement: null,
    colour: 60,
    tooltip:
      'Render an image, video, camera, or URL as a layer below all draw calls. Source: a URL string, "camera", or a variable. fit: cover/contain/stretch.',
  },

  // ── Media ──────────────────────────────────────────────────────────────────
  {
    type: 'media_video',
    message0: 'video from %1',
    args0: [{ type: 'field_input', name: 'URL', text: 'https://example.com/clip.mp4' }],
    output: null,
    colour: 45,
    tooltip: 'Create a video layer — call play() on it to start',
  },
  {
    type: 'media_video_play',
    message0: 'play video %1',
    args0: [{ type: 'input_value', name: 'VIDEO' }],
    previousStatement: null,
    nextStatement: null,
    colour: 45,
  },
  {
    type: 'media_video_stop',
    message0: 'stop video %1',
    args0: [{ type: 'input_value', name: 'VIDEO' }],
    previousStatement: null,
    nextStatement: null,
    colour: 45,
  },
  {
    type: 'media_image_layer',
    message0: 'image layer from %1',
    args0: [{ type: 'field_input', name: 'URL', text: 'https://example.com/photo.jpg' }],
    output: null,
    colour: 45,
    tooltip: 'Load image as canvas overlay — awaitable',
  },

  // ── Windows ────────────────────────────────────────────────────────────────
  {
    type: 'wm_layout',
    message0: 'layout %1',
    args0: [{ type: 'field_dropdown', name: 'LAYOUT', options: [['split', 'split']] }],
    previousStatement: null,
    nextStatement: null,
    colour: 200,
    tooltip: 'Switch to a named tiling layout',
  },
  {
    type: 'wm_show_hide',
    message0: '%1 window %2',
    args0: [
      {
        type: 'field_dropdown',
        name: 'ACTION',
        options: [
          ['show', 'show'],
          ['hide', 'hide'],
          ['toggle', 'toggle'],
          ['focus', 'focus'],
          ['maximize', 'maximize'],
          ['restore', 'restore'],
        ],
      },
      {
        type: 'field_dropdown',
        name: 'WIN',
        options: [
          ['editor', 'win-editor'],
          ['output', 'win-canvas'],
          ['console', 'win-console'],
          ['toolkit', 'win-toolkit'],
          ['camera', 'win-camera'],
          ['mic', 'win-mic'],
        ],
      },
    ],
    previousStatement: null,
    nextStatement: null,
    colour: 200,
  },
  {
    type: 'wm_move',
    message0: 'move window %1 x %2 y %3',
    args0: [
      {
        type: 'field_dropdown',
        name: 'WIN',
        options: [
          ['editor', 'win-editor'],
          ['output', 'win-canvas'],
          ['console', 'win-console'],
          ['toolkit', 'win-toolkit'],
          ['camera', 'win-camera'],
          ['mic', 'win-mic'],
        ],
      },
      { type: 'field_number', name: 'X', value: 0 },
      { type: 'field_number', name: 'Y', value: 0 },
    ],
    previousStatement: null,
    nextStatement: null,
    colour: 200,
  },
  {
    type: 'wm_resize_win',
    message0: 'resize window %1 w %2 h %3',
    args0: [
      {
        type: 'field_dropdown',
        name: 'WIN',
        options: [
          ['editor', 'win-editor'],
          ['output', 'win-canvas'],
          ['console', 'win-console'],
          ['toolkit', 'win-toolkit'],
          ['camera', 'win-camera'],
          ['mic', 'win-mic'],
        ],
      },
      { type: 'field_number', name: 'W', value: 640 },
      { type: 'field_number', name: 'H', value: 480 },
    ],
    previousStatement: null,
    nextStatement: null,
    colour: 200,
  },
  {
    type: 'wm_close_win',
    message0: 'close window %1',
    args0: [{ type: 'input_value', name: 'ID' }],
    inputsInline: true,
    previousStatement: null,
    nextStatement: null,
    colour: 200,
    tooltip: 'Close a spawned window by id',
  },
  {
    type: 'wm_set_z',
    message0: 'set window %1 z-index %2',
    args0: [
      { type: 'input_value', name: 'ID' },
      { type: 'field_number', name: 'Z', value: 200 },
    ],
    inputsInline: true,
    previousStatement: null,
    nextStatement: null,
    colour: 200,
    tooltip: 'Set CSS z-index stacking order on a window',
  },
  {
    type: 'wm_set_opacity',
    message0: 'set window %1 opacity %2',
    args0: [
      { type: 'input_value', name: 'ID' },
      { type: 'field_number', name: 'V', value: 0.5, min: 0, max: 1, precision: 0.01 },
    ],
    inputsInline: true,
    previousStatement: null,
    nextStatement: null,
    colour: 200,
    tooltip: 'Set CSS opacity on a window (0=transparent, 1=opaque)',
  },
  {
    type: 'wm_spawn_html',
    message0: 'spawn html window %1 html %2 w %3 h %4',
    args0: [
      { type: 'field_input', name: 'TITLE', text: 'panel' },
      { type: 'field_input', name: 'HTML', text: '<p>hello</p>' },
      { type: 'field_number', name: 'W', value: 320 },
      { type: 'field_number', name: 'H', value: 240 },
    ],
    output: 'String',
    colour: 200,
    tooltip: 'Spawn an HTML window — returns its id',
  },
  {
    type: 'wm_spawn_camera',
    message0: 'spawn camera window %1 w %2 h %3',
    args0: [
      { type: 'field_input', name: 'TITLE', text: 'camera' },
      { type: 'field_number', name: 'W', value: 320 },
      { type: 'field_number', name: 'H', value: 240 },
    ],
    output: 'String',
    colour: 200,
    tooltip: 'Spawn a window mirroring the camera feed — returns its id',
  },
  {
    type: 'wm_spawn_canvas',
    message0: 'spawn canvas z %1 window %2 w %3 h %4',
    args0: [
      { type: 'field_number', name: 'Z', value: 0 },
      { type: 'field_input', name: 'TITLE', text: 'canvas' },
      { type: 'field_number', name: 'W', value: 640 },
      { type: 'field_number', name: 'H', value: 480 },
    ],
    output: 'String',
    colour: 200,
    tooltip: 'Spawn a window mirroring canvas layer z — returns its id',
  },
  {
    type: 'wm_spawn_image',
    message0: 'spawn image %1 title %2 w %3 h %4',
    args0: [
      { type: 'input_value', name: 'SRC' },
      { type: 'field_input', name: 'TITLE', text: 'image' },
      { type: 'field_number', name: 'W', value: 480 },
      { type: 'field_number', name: 'H', value: 360 },
    ],
    inputsInline: true,
    output: 'String',
    colour: 200,
    tooltip: 'Spawn an image window from a URL or blob URL — returns its id',
  },
  {
    type: 'wm_spawn_video',
    message0: 'spawn video %1 title %2 w %3 h %4',
    args0: [
      { type: 'input_value', name: 'SRC' },
      { type: 'field_input', name: 'TITLE', text: 'video' },
      { type: 'field_number', name: 'W', value: 640 },
      { type: 'field_number', name: 'H', value: 480 },
    ],
    inputsInline: true,
    output: 'String',
    colour: 200,
    tooltip: 'Spawn a video window from a URL or blob URL — returns its id',
  },
  {
    type: 'wm_spawn_shader',
    message0: 'spawn shader %1 title %2 w %3 h %4',
    args0: [
      { type: 'input_value', name: 'SHADER' },
      { type: 'field_input', name: 'TITLE', text: 'shader' },
      { type: 'field_number', name: 'W', value: 640 },
      { type: 'field_number', name: 'H', value: 480 },
    ],
    inputsInline: true,
    output: 'String',
    colour: 200,
    tooltip: "Spawn a window mirroring a shader's output — returns its id",
  },
  {
    type: 'wm_pick_file',
    message0: 'pick file key %1',
    args0: [{ type: 'field_input', name: 'KEY', text: 'myFile' }],
    output: 'String',
    colour: 200,
    tooltip: 'Pick a file via browser — cached by key, no re-prompt. Returns blob URL.',
  },
  {
    type: 'wm_browse',
    message0: 'browse dir key %1 w %2 h %3',
    args0: [
      { type: 'field_input', name: 'KEY', text: 'myDir' },
      { type: 'field_number', name: 'W', value: 260, min: 100 },
      { type: 'field_number', name: 'H', value: 400, min: 100 },
    ],
    message1: 'on select url %1 filename %2 do %3',
    args1: [
      { type: 'field_variable', name: 'URL_VAR', variable: 'url' },
      { type: 'field_variable', name: 'NAME_VAR', variable: 'filename' },
      { type: 'input_statement', name: 'DO' },
    ],
    previousStatement: null,
    nextStatement: null,
    colour: 200,
    tooltip:
      'Open a directory file browser. Click a file to run the DO statements with url and filename set.',
  },

  // ── Drumpad ────────────────────────────────────────────────────────────────
  {
    type: 'drumpad_open',
    message0: 'drum pad title %1 bpm %2',
    args0: [
      { type: 'field_input', name: 'TITLE', text: 'Drum Pad' },
      { type: 'field_number', name: 'BPM', value: 120, min: 40, max: 300 },
    ],
    output: null,
    colour: 20,
    tooltip:
      'Open a drumpad window and return the dp object. Connect to on-pad/on-hit/on-step blocks or call dp.pattern(), dp.bpm().',
  },
  {
    type: 'drumpad_on_pad',
    message0: 'on drumpad %1 pad %2',
    args0: [
      { type: 'input_value', name: 'DP' },
      {
        type: 'field_dropdown',
        name: 'VOICE',
        options: [
          ['Kick (0)', '0'],
          ['Snare (1)', '1'],
          ['HH Cl (2)', '2'],
          ['HH Op (3)', '3'],
          ['Clap (4)', '4'],
          ['Tom L (5)', '5'],
          ['Tom H (6)', '6'],
          ['Cymbal (7)', '7'],
        ],
      },
    ],
    message1: 'do %1',
    args1: [{ type: 'input_statement', name: 'DO' }],
    previousStatement: null,
    nextStatement: null,
    colour: 20,
    tooltip:
      'Run code when a specific drum pad is hit. Fires for pad clicks, key presses, and sequencer steps.',
  },
  {
    type: 'drumpad_on_hit',
    message0: 'on drumpad %1 any hit',
    args0: [{ type: 'input_value', name: 'DP' }],
    message1: 'do %1',
    args1: [{ type: 'input_statement', name: 'DO' }],
    previousStatement: null,
    nextStatement: null,
    colour: 20,
    tooltip: 'Run code whenever any drum pad fires. Use with dp.signal() to get a value.',
  },
  {
    type: 'drumpad_on_step',
    message0: 'on drumpad %1 sequencer step',
    args0: [{ type: 'input_value', name: 'DP' }],
    message1: 'do %1',
    args1: [{ type: 'input_statement', name: 'DO' }],
    previousStatement: null,
    nextStatement: null,
    colour: 20,
    tooltip: 'Run code once per sequencer step (0-15) while the drumpad is playing.',
  },
  {
    type: 'drumpad_signal',
    message0: 'drumpad %1 pad %2 signal decay %3 ms',
    args0: [
      { type: 'input_value', name: 'DP' },
      {
        type: 'field_dropdown',
        name: 'VOICE',
        options: [
          ['any', 'null'],
          ['Kick (0)', '0'],
          ['Snare (1)', '1'],
          ['HH Cl (2)', '2'],
          ['HH Op (3)', '3'],
          ['Clap (4)', '4'],
          ['Tom L (5)', '5'],
          ['Tom H (6)', '6'],
          ['Cymbal (7)', '7'],
        ],
      },
      { type: 'field_number', name: 'DECAY', value: 250, min: 10, max: 5000 },
    ],
    output: null,
    colour: 20,
    tooltip:
      'Return a live 0–1 decaying-pulse signal for a pad (or any pad). .value jumps to 1 on each hit and decays to 0. Use with shader.set() or draw.',
  },

  // ── Piano ──────────────────────────────────────────────────────────────────
  {
    type: 'piano_open',
    message0: 'piano title %1 preset %2',
    args0: [
      { type: 'field_input', name: 'TITLE', text: 'Piano' },
      {
        type: 'field_dropdown',
        name: 'PRESET',
        options: [
          ['electric', 'electric'],
          ['grand', 'grand'],
          ['organ', 'organ'],
          ['pluck', 'pluck'],
          ['pad', 'pad'],
          ['bass', 'bass'],
        ],
      },
    ],
    output: null,
    colour: 20,
    tooltip:
      'Open a piano widget and return the piano object. Connect to on-note/on-key/on-step blocks or use p.signal().',
  },
  {
    type: 'piano_on_note',
    message0: 'on piano %1 any note',
    args0: [{ type: 'input_value', name: 'PIANO' }],
    message1: 'do %1',
    args1: [{ type: 'input_statement', name: 'DO' }],
    previousStatement: null,
    nextStatement: null,
    colour: 20,
    tooltip: 'Run code whenever any piano key is played (mouse, keyboard, or sequencer).',
  },
  {
    type: 'piano_on_step',
    message0: 'on piano %1 sequencer step',
    args0: [{ type: 'input_value', name: 'PIANO' }],
    message1: 'do %1',
    args1: [{ type: 'input_statement', name: 'DO' }],
    previousStatement: null,
    nextStatement: null,
    colour: 20,
    tooltip: 'Run code once per sequencer step (0-15) while the piano sequencer is playing.',
  },
  {
    type: 'piano_signal',
    message0: 'piano %1 signal decay %2 ms',
    args0: [
      { type: 'input_value', name: 'PIANO' },
      { type: 'field_number', name: 'DECAY', value: 300, min: 10, max: 5000 },
    ],
    output: null,
    colour: 20,
    tooltip:
      'Return a live 0–1 decaying-pulse signal for any note on the piano. .value jumps to 1 on each hit and decays to 0.',
  },

  // ── PIXI ───────────────────────────────────────────────────────────────────
  {
    type: 'pixi_graphics_circle',
    message0: 'pixi circle x %1 y %2 r %3 color %4',
    args0: [
      { type: 'field_number', name: 'X', value: 400 },
      { type: 'field_number', name: 'Y', value: 225 },
      { type: 'field_number', name: 'R', value: 60 },
      { type: 'field_input', name: 'COLOR', text: '0x4488ff' },
    ],
    output: null,
    colour: 290,
    tooltip:
      'Create a PIXI Graphics circle — returns a Graphics object. Add to stage with "add to stage".',
  },
  {
    type: 'pixi_graphics_rect',
    message0: 'pixi rect x %1 y %2 w %3 h %4 color %5',
    args0: [
      { type: 'field_number', name: 'X', value: 300 },
      { type: 'field_number', name: 'Y', value: 150 },
      { type: 'field_number', name: 'W', value: 200 },
      { type: 'field_number', name: 'H', value: 150 },
      { type: 'field_input', name: 'COLOR', text: '0xff6600' },
    ],
    output: null,
    colour: 290,
    tooltip: 'Create a PIXI Graphics filled rectangle — returns Graphics object.',
  },
  {
    type: 'pixi_text',
    message0: 'pixi text %1 x %2 y %3 size %4 color %5',
    args0: [
      { type: 'field_input', name: 'STR', text: 'hello pixi' },
      { type: 'field_number', name: 'X', value: 100 },
      { type: 'field_number', name: 'Y', value: 100 },
      { type: 'field_number', name: 'SIZE', value: 48, min: 1 },
      { type: 'field_input', name: 'COLOR', text: '#ffffff' },
    ],
    output: null,
    colour: 290,
    tooltip: 'Create a PIXI Text object — returns Text. Add to stage with "add to stage".',
  },
  {
    type: 'pixi_sprite',
    message0: 'pixi sprite from %1',
    args0: [{ type: 'field_input', name: 'URL', text: 'https://example.com/hero.png' }],
    output: null,
    colour: 290,
    tooltip: 'Create a PIXI Sprite from a URL — returns Sprite. Add to stage.',
  },
  {
    type: 'pixi_add_to_stage',
    message0: 'add %1 to stage',
    args0: [{ type: 'input_value', name: 'OBJ' }],
    previousStatement: null,
    nextStatement: null,
    colour: 290,
    tooltip: 'Add a PIXI DisplayObject to the scene (Stage)',
  },
  {
    type: 'pixi_set_pos',
    message0: 'set %1 position x %2 y %3',
    args0: [
      { type: 'input_value', name: 'OBJ' },
      { type: 'field_number', name: 'X', value: 400 },
      { type: 'field_number', name: 'Y', value: 225 },
    ],
    inputsInline: true,
    previousStatement: null,
    nextStatement: null,
    colour: 290,
  },
  {
    type: 'pixi_set_rotation',
    message0: 'set %1 rotation %2 deg',
    args0: [
      { type: 'input_value', name: 'OBJ' },
      { type: 'field_number', name: 'DEG', value: 45 },
    ],
    inputsInline: true,
    previousStatement: null,
    nextStatement: null,
    colour: 290,
  },
  {
    type: 'pixi_set_alpha',
    message0: 'set %1 alpha %2',
    args0: [
      { type: 'input_value', name: 'OBJ' },
      { type: 'field_number', name: 'ALPHA', value: 0.5, min: 0, max: 1 },
    ],
    inputsInline: true,
    previousStatement: null,
    nextStatement: null,
    colour: 290,
  },
  {
    type: 'pixi_blur_filter',
    message0: 'blur %1 by %2 px',
    args0: [
      { type: 'input_value', name: 'OBJ' },
      { type: 'field_number', name: 'BLUR', value: 10, min: 0 },
    ],
    inputsInline: true,
    previousStatement: null,
    nextStatement: null,
    colour: 290,
    tooltip: 'Apply a BlurFilter to a PIXI DisplayObject',
  },
  {
    type: 'pixi_tick',
    message0: 'on pixi tick',
    message1: 'do %1',
    args1: [{ type: 'input_statement', name: 'DO' }],
    previousStatement: null,
    nextStatement: null,
    colour: 290,
    tooltip: 'Run code every PIXI animation frame — cleaned up on Stop. Use to animate sprites.',
  },
  {
    type: 'pixi_clear_stage',
    message0: 'clear PIXI stage',
    previousStatement: null,
    nextStatement: null,
    colour: 290,
    tooltip: 'Remove all objects from the PIXI stage',
  },

  // ── GLShader ───────────────────────────────────────────────────────────────
  {
    type: 'glshader_preset',
    message0: '%1 GLSL shader',
    args0: [
      {
        type: 'field_dropdown',
        name: 'PRESET',
        options: [
          ['gradient', 'gradient'],
          ['plasma', 'plasma'],
          ['waves', 'waves'],
          ['circles', 'circles'],
          ['noise', 'noise'],
        ],
      },
    ],
    output: null,
    colour: 15,
    tooltip: 'Create a preset GLShader (WebGL/GLSL) — connect to "start GLShader"',
  },
  {
    type: 'glshader_body',
    message0: 'GLSL shader %1',
    args0: [
      {
        type: 'field_input',
        name: 'BODY',
        text: 'gl_FragColor = vec4(uv, sin(uTime)*0.5+0.5, 1.0);',
      },
    ],
    output: null,
    colour: 15,
    tooltip:
      'Custom GLSL fragment body. Pre-declared: uv (vec2 0-1), uTime, uMouse, uCustom, uResolution. Set gl_FragColor.',
  },
  {
    type: 'glshader_start',
    message0: 'start GLShader %1',
    args0: [{ type: 'input_value', name: 'SHADER' }],
    previousStatement: null,
    nextStatement: null,
    colour: 15,
  },
  {
    type: 'glshader_stop',
    message0: 'stop GLShader %1',
    args0: [{ type: 'input_value', name: 'SHADER' }],
    previousStatement: null,
    nextStatement: null,
    colour: 15,
  },
  {
    type: 'glshader_opacity',
    message0: 'set GLShader %1 opacity %2',
    args0: [
      { type: 'input_value', name: 'SHADER' },
      { type: 'field_number', name: 'OPACITY', value: 0.5, min: 0, max: 1 },
    ],
    previousStatement: null,
    nextStatement: null,
    colour: 15,
  },

  // ── Camera ─────────────────────────────────────────────────────────────────
  {
    type: 'camera_open',
    message0: 'open camera %1',
    args0: [{ type: 'field_number', name: 'INDEX', value: 0, min: 0 }],
    output: null,
    colour: 165,
    tooltip: 'Open a camera by index — returns a CameraStream. Use with shader video effect.',
  },
  {
    type: 'camera_stop',
    message0: 'stop camera %1',
    args0: [{ type: 'input_value', name: 'CAM' }],
    previousStatement: null,
    nextStatement: null,
    colour: 165,
    tooltip: 'Stop a CameraStream and release the device',
  },

  // ── Audio — filter / meter / chain / attack / release ──────────────────────
  {
    type: 'audio_filter',
    message0: '%1 filter freq %2 Hz Q %3',
    args0: [
      {
        type: 'field_dropdown',
        name: 'TYPE',
        options: [
          ['lowpass', 'lowpass'],
          ['highpass', 'highpass'],
          ['bandpass', 'bandpass'],
          ['notch', 'notch'],
          ['allpass', 'allpass'],
        ],
      },
      { type: 'field_number', name: 'FREQ', value: 2000, min: 20, max: 20000 },
      { type: 'field_number', name: 'Q', value: 1, min: 0.1, max: 20 },
    ],
    output: null,
    colour: 260,
    tooltip: 'Create a filter effect — connect with chain or connect blocks',
  },
  {
    type: 'audio_meter',
    message0: 'meter',
    output: null,
    colour: 260,
    tooltip: 'Create a level meter — put it at the end of a chain to measure amplitude',
  },
  {
    type: 'audio_meter_value',
    message0: '%1 level (dB)',
    args0: [{ type: 'input_value', name: 'METER' }],
    output: 'Number',
    inputsInline: true,
    colour: 260,
    tooltip: 'Get current meter level in dB — use isFinite() check; -Infinity when silent',
  },
  {
    type: 'audio_chain',
    message0: 'chain %1 through %2 %3 %4',
    args0: [
      { type: 'input_value', name: 'SYNTH' },
      { type: 'input_value', name: 'FX1' },
      { type: 'input_value', name: 'FX2' },
      { type: 'input_value', name: 'FX3' },
    ],
    inputsInline: true,
    previousStatement: null,
    nextStatement: null,
    colour: 260,
    tooltip:
      'Route synth through up to 3 effects (FX2, FX3 optional) — e.g. filter → reverb → meter',
  },
  {
    type: 'audio_attack',
    message0: 'attack %1 on %2',
    args0: [
      { type: 'field_input', name: 'NOTE', text: 'C4' },
      { type: 'input_value', name: 'SYNTH' },
    ],
    inputsInline: true,
    previousStatement: null,
    nextStatement: null,
    colour: 260,
    tooltip: 'Trigger note attack (key-down) without release — pair with audio release block',
  },
  {
    type: 'audio_release',
    message0: 'release %1 on %2',
    args0: [
      { type: 'field_input', name: 'NOTE', text: 'C4' },
      { type: 'input_value', name: 'SYNTH' },
    ],
    inputsInline: true,
    previousStatement: null,
    nextStatement: null,
    colour: 260,
    tooltip: 'Trigger note release (key-up) — pairs with audio attack block',
  },

  // ── Draw — ring / rectStroke ───────────────────────────────────────────────
  {
    type: 'draw_ring',
    message0: 'ring x %1 y %2 r %3 color %4 thickness %5',
    args0: [
      { type: 'field_number', name: 'X', value: 400 },
      { type: 'field_number', name: 'Y', value: 225 },
      { type: 'field_number', name: 'R', value: 80 },
      { type: 'field_input', name: 'COLOR', text: 'white' },
      { type: 'field_number', name: 'T', value: 3, min: 0.5 },
    ],
    previousStatement: null,
    nextStatement: null,
    colour: 60,
    tooltip: 'Draw a stroked circle (ring) — no fill',
  },
  {
    type: 'draw_rect_stroke',
    message0: 'rect outline x %1 y %2 w %3 h %4 color %5 thickness %6',
    args0: [
      { type: 'field_number', name: 'X', value: 100 },
      { type: 'field_number', name: 'Y', value: 100 },
      { type: 'field_number', name: 'W', value: 200 },
      { type: 'field_number', name: 'H', value: 120 },
      { type: 'field_input', name: 'COLOR', text: 'white' },
      { type: 'field_number', name: 'T', value: 2, min: 0.5 },
    ],
    previousStatement: null,
    nextStatement: null,
    colour: 60,
    tooltip: 'Draw a stroked rectangle outline — no fill',
  },

  // ── Control — key with down + up handler ───────────────────────────────────
  {
    type: 'ctrl_onkey_char',
    message0: 'when key %1 pressed',
    args0: [{ type: 'field_input', name: 'KEY', text: 'a' }],
    message1: 'down %1',
    args1: [{ type: 'input_statement', name: 'DOWN' }],
    message2: 'up %1',
    args2: [{ type: 'input_statement', name: 'UP' }],
    previousStatement: null,
    nextStatement: null,
    colour: 120,
    tooltip:
      'Run code when any typed key is pressed/released — enter the key character (a, z, 1, Enter, ArrowUp…)',
  },

  // ── Three.js 3D ────────────────────────────────────────────────────────────
  {
    type: 'three_scene',
    message0: '3D scene z=%1',
    args0: [{ type: 'field_number', name: 'Z', value: 30 }],
    output: null,
    colour: 195,
    tooltip: 'Create a ThreeScene (WebGL 3D). Connect to "start 3D scene" to begin rendering.',
  },
  {
    type: 'three_start',
    message0: 'start 3D scene %1',
    args0: [{ type: 'input_value', name: 'SCENE' }],
    previousStatement: null,
    nextStatement: null,
    colour: 195,
    tooltip: 'Begin rendering a ThreeScene',
  },
  {
    type: 'three_tick',
    message0: '3D tick scene %1 dt=%2',
    args0: [
      { type: 'input_value', name: 'SCENE' },
      { type: 'field_variable', name: 'DT', variable: 'dt' },
    ],
    message1: 'do %1',
    args1: [{ type: 'input_statement', name: 'DO' }],
    previousStatement: null,
    nextStatement: null,
    colour: 195,
    tooltip: 'Register a per-frame callback on the ThreeScene. dt = delta time in seconds.',
  },
  {
    type: 'three_box_mesh',
    message0: 'box mesh color %1',
    args0: [{ type: 'field_colour', name: 'COLOR', colour: '#4444ff' }],
    output: null,
    colour: 195,
    tooltip: 'Create a THREE.Mesh with BoxGeometry and MeshNormalMaterial',
  },
  {
    type: 'three_add',
    message0: 'add %1 to scene %2',
    args0: [
      { type: 'input_value', name: 'OBJ' },
      { type: 'input_value', name: 'SCENE' },
    ],
    previousStatement: null,
    nextStatement: null,
    colour: 195,
    tooltip: 'Add a THREE.Object3D to a ThreeScene',
  },
  {
    type: 'three_rotate',
    message0: 'rotate %1 x+=%2 y+=%3',
    args0: [
      { type: 'input_value', name: 'OBJ' },
      { type: 'field_number', name: 'DX', value: 0.01 },
      { type: 'field_number', name: 'DY', value: 0.01 },
    ],
    previousStatement: null,
    nextStatement: null,
    colour: 195,
    tooltip: 'Increment mesh rotation.x and rotation.y each frame',
  },
  {
    type: 'three_signal_graph',
    message0: 'show signal graph',
    previousStatement: null,
    nextStatement: null,
    colour: 160,
    tooltip: 'Open a window showing the live signal routing graph (sources → sinks)',
  },
]);

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

// ── Toolbox ──────────────────────────────────────────────────────────────────

export const TOOLBOX = {
  kind: 'categoryToolbox',
  contents: [
    {
      kind: 'category',
      name: 'Logic',
      colour: '%{BKY_LOGIC_HUE}',
      contents: [
        { kind: 'block', type: 'controls_if' },
        { kind: 'block', type: 'logic_compare' },
        { kind: 'block', type: 'logic_operation' },
        { kind: 'block', type: 'logic_negate' },
        { kind: 'block', type: 'logic_boolean' },
        { kind: 'block', type: 'logic_null' },
      ],
    },
    {
      kind: 'category',
      name: 'Math',
      colour: '%{BKY_MATH_HUE}',
      contents: [
        { kind: 'block', type: 'math_number' },
        { kind: 'block', type: 'math_arithmetic' },
        { kind: 'block', type: 'math_single' },
        { kind: 'block', type: 'math_trig' },
        { kind: 'block', type: 'math_random_float' },
        { kind: 'block', type: 'ctrl_random' },
        { kind: 'block', type: 'ctrl_random_color' },
      ],
    },
    {
      kind: 'category',
      name: 'Text',
      colour: '%{BKY_TEXTS_HUE}',
      contents: [
        { kind: 'block', type: 'text' },
        { kind: 'block', type: 'text_join' },
        { kind: 'block', type: 'text_print' },
      ],
    },
    {
      kind: 'category',
      name: 'Variables',
      colour: '%{BKY_VARIABLES_HUE}',
      custom: 'VARIABLE',
    },
    {
      kind: 'category',
      name: 'Control',
      colour: 120,
      contents: [
        { kind: 'block', type: 'ctrl_interval' },
        { kind: 'block', type: 'ctrl_timeout' },
        { kind: 'block', type: 'ctrl_onkey' },
        { kind: 'block', type: 'ctrl_onkey_char' },
        { kind: 'block', type: 'ctrl_stop' },
        { kind: 'block', type: 'ctrl_pause' },
        { kind: 'block', type: 'ctrl_resume' },
      ],
    },
    {
      kind: 'category',
      name: 'Drumpad',
      colour: 20,
      contents: [
        {
          kind: 'block',
          type: 'drumpad_on_pad',
          inputs: { DP: { block: { type: 'drumpad_open' } } },
        },
        {
          kind: 'block',
          type: 'drumpad_on_hit',
          inputs: { DP: { block: { type: 'drumpad_open' } } },
        },
        {
          kind: 'block',
          type: 'drumpad_on_step',
          inputs: { DP: { block: { type: 'drumpad_open' } } },
        },
        {
          kind: 'block',
          type: 'drumpad_signal',
          inputs: { DP: { block: { type: 'drumpad_open' } } },
        },
        { kind: 'block', type: 'drumpad_open' },
      ],
    },
    {
      kind: 'category',
      name: 'Piano',
      colour: 20,
      contents: [
        {
          kind: 'block',
          type: 'piano_on_note',
          inputs: { PIANO: { block: { type: 'piano_open' } } },
        },
        {
          kind: 'block',
          type: 'piano_on_step',
          inputs: { PIANO: { block: { type: 'piano_open' } } },
        },
        {
          kind: 'block',
          type: 'piano_signal',
          inputs: { PIANO: { block: { type: 'piano_open' } } },
        },
        { kind: 'block', type: 'piano_open' },
      ],
    },
    {
      kind: 'category',
      name: 'Audio',
      colour: 260,
      contents: [
        { kind: 'block', type: 'audio_create_synth' },
        { kind: 'block', type: 'audio_play' },
        { kind: 'block', type: 'audio_bpm' },
        { kind: 'block', type: 'audio_transport_start' },
        { kind: 'block', type: 'mixer_show' },
        { kind: 'block', type: 'mixer_volume' },
        { kind: 'block', type: 'mixer_pan' },
        { kind: 'block', type: 'mixer_mute' },
        { kind: 'block', type: 'audio_reverb' },
        { kind: 'block', type: 'audio_delay' },
        { kind: 'block', type: 'audio_distort' },
        { kind: 'block', type: 'audio_volume' },
        { kind: 'block', type: 'audio_connect' },
        { kind: 'block', type: 'audio_filter' },
        { kind: 'block', type: 'audio_meter' },
        { kind: 'block', type: 'audio_meter_value' },
        { kind: 'block', type: 'audio_chain' },
        { kind: 'block', type: 'audio_attack' },
        { kind: 'block', type: 'audio_release' },
        // Audio visualizer
        {
          kind: 'block',
          type: 'audio_viz_start',
          inputs: { VIZ: { block: { type: 'audio_viz' } } },
        },
        { kind: 'block', type: 'audio_viz' },
        { kind: 'block', type: 'audio_viz_stop' },
        { kind: 'block', type: 'audio_viz_shader' },
        // Mic triggers
        { kind: 'block', type: 'audio_on_level' },
        { kind: 'block', type: 'audio_level' },
        // Speech
        { kind: 'block', type: 'audio_on_word' },
        { kind: 'block', type: 'audio_say' },
      ],
    },
    {
      kind: 'category',
      name: 'Shader',
      colour: 330,
      contents: [
        // Pre-nested: start shader [preset shader]
        {
          kind: 'block',
          type: 'shader_start',
          inputs: { SHADER: { block: { type: 'shader_preset' } } },
        },
        // Pre-nested: start shader [window editor greyscale]
        {
          kind: 'block',
          type: 'shader_start',
          inputs: { SHADER: { block: { type: 'shader_window_effect' } } },
        },
        // Creators (value blocks — can also feed stop/opacity/set_uniform)
        { kind: 'block', type: 'shader_preset' },
        { kind: 'block', type: 'shader_new' },
        { kind: 'block', type: 'shader_wgsl' },
        { kind: 'block', type: 'shader_js_fn' },
        { kind: 'block', type: 'shader_fn_body' },
        { kind: 'block', type: 'shader_window_effect' },
        { kind: 'block', type: 'shader_mic_viz' },
        // Action blocks
        { kind: 'block', type: 'shader_stop' },
        { kind: 'block', type: 'shader_opacity' },
        { kind: 'block', type: 'shader_set_uniform' },
        // Fn-body building blocks
        { kind: 'block', type: 'shader_return_rgba' },
        { kind: 'block', type: 'shader_math_trig' },
        { kind: 'block', type: 'shader_math_fn' },
        { kind: 'block', type: 'shader_param_uv_x' },
        { kind: 'block', type: 'shader_param_uv_y' },
        { kind: 'block', type: 'shader_param_time' },
        { kind: 'block', type: 'shader_param_mouse_x' },
        { kind: 'block', type: 'shader_param_mouse_y' },
        { kind: 'block', type: 'shader_param_res_x' },
        { kind: 'block', type: 'shader_param_res_y' },
        { kind: 'block', type: 'shader_param_custom_x' },
        { kind: 'block', type: 'shader_param_custom_y' },
        { kind: 'block', type: 'shader_param_custom_z' },
        { kind: 'block', type: 'shader_param_custom_w' },
      ],
    },
    {
      kind: 'category',
      name: 'Vision',
      colour: 180,
      contents: [
        { kind: 'block', type: 'vision_on_gesture' },
        { kind: 'block', type: 'vision_on_expression' },
        { kind: 'block', type: 'vision_gesture' },
        { kind: 'block', type: 'vision_face_detected' },
        { kind: 'block', type: 'vision_nearest' },
        { kind: 'block', type: 'vision_gaze' },
        { kind: 'block', type: 'vision_on_gaze' },
        { kind: 'block', type: 'vision_on_blink' },
      ],
    },
    {
      kind: 'category',
      name: 'Draw',
      colour: 60,
      contents: [
        { kind: 'block', type: 'draw_bg' },
        { kind: 'block', type: 'canvas_fill_rect' },
        { kind: 'block', type: 'canvas_fill_circle' },
        { kind: 'block', type: 'draw_ring' },
        { kind: 'block', type: 'draw_rect_stroke' },
        { kind: 'block', type: 'draw_line' },
        { kind: 'block', type: 'draw_text' },
        { kind: 'block', type: 'draw_text_rich' },
        { kind: 'block', type: 'canvas_clear' },
        { kind: 'block', type: 'draw_alpha' },
        { kind: 'block', type: 'draw_reset' },
        { kind: 'block', type: 'canvas_blur' },
        { kind: 'block', type: 'canvas_layer_opacity' },
        { kind: 'block', type: 'canvas_blend_mode' },
        { kind: 'block', type: 'draw_pixelate' },
        { kind: 'block', type: 'draw_backdrop' },
      ],
    },
    {
      kind: 'category',
      name: 'Canvas (window)',
      colour: 200,
      contents: [
        { kind: 'block', type: 'canvas_new' },
        { kind: 'block', type: 'canvas_surface_bg' },
        {
          kind: 'block',
          type: 'canvas_surface_circle',
          inputs: {
            X: { shadow: { type: 'math_number', fields: { NUM: 400 } } },
            Y: { shadow: { type: 'math_number', fields: { NUM: 300 } } },
          },
        },
        { kind: 'block', type: 'canvas_on' },
        { kind: 'block', type: 'canvas_pointer' },
      ],
    },
    {
      kind: 'category',
      name: 'Media',
      colour: 45,
      contents: [
        { kind: 'block', type: 'media_video' },
        { kind: 'block', type: 'media_video_play' },
        { kind: 'block', type: 'media_video_stop' },
        { kind: 'block', type: 'media_image_layer' },
      ],
    },
    {
      kind: 'category',
      name: 'PIXI',
      colour: 290,
      contents: [
        {
          kind: 'block',
          type: 'pixi_add_to_stage',
          inputs: { OBJ: { block: { type: 'pixi_graphics_circle' } } },
        },
        { kind: 'block', type: 'pixi_graphics_circle' },
        { kind: 'block', type: 'pixi_graphics_rect' },
        { kind: 'block', type: 'pixi_text' },
        { kind: 'block', type: 'pixi_sprite' },
        { kind: 'block', type: 'pixi_add_to_stage' },
        { kind: 'block', type: 'pixi_tick' },
        { kind: 'block', type: 'pixi_set_pos' },
        { kind: 'block', type: 'pixi_set_rotation' },
        { kind: 'block', type: 'pixi_set_alpha' },
        { kind: 'block', type: 'pixi_blur_filter' },
        { kind: 'block', type: 'pixi_clear_stage' },
      ],
    },
    {
      kind: 'category',
      name: 'GLShader',
      colour: 15,
      contents: [
        {
          kind: 'block',
          type: 'glshader_start',
          inputs: { SHADER: { block: { type: 'glshader_preset' } } },
        },
        { kind: 'block', type: 'glshader_preset' },
        { kind: 'block', type: 'glshader_body' },
        { kind: 'block', type: 'glshader_start' },
        { kind: 'block', type: 'glshader_stop' },
        { kind: 'block', type: 'glshader_opacity' },
      ],
    },
    {
      kind: 'category',
      name: 'Camera',
      colour: 165,
      contents: [
        // Pre-nested: start shader [camera shader greyscale]
        {
          kind: 'block',
          type: 'shader_start',
          inputs: { SHADER: { block: { type: 'shader_camera_effect' } } },
        },
        // Creator alone (for wiring to stop/opacity/set_uniform)
        { kind: 'block', type: 'shader_camera_effect' },
        { kind: 'block', type: 'shader_video_effect' },
        { kind: 'block', type: 'camera_open' },
        { kind: 'block', type: 'camera_stop' },
      ],
    },
    {
      kind: 'category',
      name: 'Pipeline',
      colour: 80,
      contents: [
        { kind: 'block', type: 'pipe_ascii_camera' },
        {
          kind: 'block',
          type: 'pipe_ascii_shader_camera',
        },
        { kind: 'block', type: 'pipe_camera_glshader' },
        { kind: 'block', type: 'pipe_pixelate_camera' },
        { kind: 'block', type: 'pipe_subtitle_video' },
      ],
    },
    {
      kind: 'category',
      name: 'Windows',
      colour: 200,
      contents: [
        { kind: 'block', type: 'wm_layout' },
        { kind: 'block', type: 'wm_show_hide' },
        { kind: 'block', type: 'wm_move' },
        { kind: 'block', type: 'wm_resize_win' },
        { kind: 'block', type: 'wm_close_win' },
        { kind: 'block', type: 'wm_set_z' },
        { kind: 'block', type: 'wm_set_opacity' },
        { kind: 'block', type: 'wm_spawn_html' },
        { kind: 'block', type: 'wm_spawn_camera' },
        { kind: 'block', type: 'wm_spawn_canvas' },
        {
          kind: 'block',
          type: 'wm_spawn_image',
          inputs: { SRC: { block: { type: 'wm_pick_file' } } },
        },
        {
          kind: 'block',
          type: 'wm_spawn_video',
          inputs: { SRC: { block: { type: 'wm_pick_file' } } },
        },
        {
          kind: 'block',
          type: 'wm_spawn_shader',
          inputs: { SHADER: { block: { type: 'shader_preset' } } },
        },
        { kind: 'block', type: 'wm_pick_file' },
        { kind: 'block', type: 'wm_browse' },
        { kind: 'block', type: 'wm_on_stroke' },
        { kind: 'block', type: 'wm_paint_signal' },
      ],
    },
    {
      kind: 'category',
      name: 'ASCII / Sprite',
      colour: 55,
      contents: [
        {
          kind: 'block',
          type: 'ascii_show',
          inputs: { ANIM: { block: { type: 'ascii_play' } } },
        },
        { kind: 'block', type: 'ascii_play' },
        { kind: 'block', type: 'sprite_create' },
        { kind: 'block', type: 'sprite_pixel' },
        { kind: 'block', type: 'sprite_play' },
        { kind: 'block', type: 'sprite_show' },
        { kind: 'block', type: 'paint_open' },
        { kind: 'block', type: 'paint_open_backdrop' },
        {
          kind: 'block',
          type: 'paint_on_stroke',
          inputs: { P: { block: { type: 'paint_open_ref' } } },
        },
        {
          kind: 'block',
          type: 'paint_on_color',
          inputs: { P: { block: { type: 'paint_open_ref' } } },
        },
        {
          kind: 'block',
          type: 'paint_signal',
          inputs: { P: { block: { type: 'paint_open_ref' } } },
        },
        { kind: 'block', type: 'ascii_editor_open' },
        {
          kind: 'block',
          type: 'ascii_editor_on_cell',
          inputs: { AE: { block: { type: 'ascii_editor_open_ref' } } },
        },
        {
          kind: 'block',
          type: 'ascii_editor_on_stroke',
          inputs: { AE: { block: { type: 'ascii_editor_open_ref' } } },
        },
        {
          kind: 'block',
          type: 'ascii_editor_signal',
          inputs: { AE: { block: { type: 'ascii_editor_open_ref' } } },
        },
        {
          kind: 'block',
          type: 'sprite_editor_on_pixel',
          inputs: { SP: { block: { type: 'sprite_editor_open' } } },
        },
        {
          kind: 'block',
          type: 'sprite_editor_on_stroke',
          inputs: { SP: { block: { type: 'sprite_editor_open' } } },
        },
        {
          kind: 'block',
          type: 'sprite_editor_signal',
          inputs: { SP: { block: { type: 'sprite_editor_open' } } },
        },
        { kind: 'block', type: 'sprite_editor_open' },
      ],
    },
    {
      kind: 'category',
      name: 'Three.js 3D',
      colour: 195,
      contents: [
        {
          kind: 'block',
          type: 'three_start',
          inputs: { SCENE: { block: { type: 'three_scene' } } },
        },
        { kind: 'block', type: 'three_scene' },
        { kind: 'block', type: 'three_tick' },
        { kind: 'block', type: 'three_box_mesh' },
        { kind: 'block', type: 'three_add' },
        { kind: 'block', type: 'three_rotate' },
        { kind: 'block', type: 'three_signal_graph' },
      ],
    },
  ],
};

// ── Public API ───────────────────────────────────────────────────────────────

export function initBlockly(container) {
  const workspace = Blockly.inject(container, {
    scrollbars: true,
    trashcan: true,
    zoom: { controls: true, wheel: true, startScale: 1.0, maxScale: 3, minScale: 0.3 },
    grid: { spacing: 20, length: 3, colour: '#ccc', snap: true },
  });
  return workspace;
}

export function getWorkspaceCode(workspace) {
  const code = javascriptGenerator.workspaceToCode(workspace);
  // ADR 040: the "quick draw" blocks emit against an implicit default `canvas`
  // (global `draw` is gone). Declare it once when used and not already created.
  if (/(^|[^.\w])canvas\./.test(code) && !/\bnew Canvas\b/.test(code)) {
    return `const canvas = new Canvas();\n${code}`;
  }
  return code;
}

export function resizeBlockly(workspace) {
  if (workspace) Blockly.svgResize(workspace);
}

export function initPaletteWorkspace(container) {
  return Blockly.inject(container, {
    scrollbars: true,
    zoom: { controls: false, wheel: true, startScale: 0.75 },
    grid: { spacing: 20, length: 3, colour: '#e8e8e8' },
    move: { scrollbars: true, drag: false, wheel: true },
  });
}

export function workspaceIsEmpty(workspace) {
  return workspace.getAllBlocks(false).length === 0;
}

export function registerSidebarDeleteZone(workspace, sidebarEl) {
  let _overlay = null;

  function _showOverlay() {
    if (_overlay) return;
    _overlay = document.createElement('div');
    _overlay.style.cssText =
      'position:absolute;inset:0;background:rgba(183,28,28,0.18);display:flex;align-items:center;justify-content:center;pointer-events:none;z-index:9999;border-radius:inherit;font-size:28px;';
    _overlay.textContent = '🗑';
    sidebarEl.style.position = 'relative';
    sidebarEl.appendChild(_overlay);
  }

  function _hideOverlay() {
    _overlay?.remove();
    _overlay = null;
  }

  const component = {
    id: 'sidebar-delete-zone',

    wouldDelete(dragElement) {
      const deletable = dragElement?.isDeletable?.() ?? false;
      const isTop = !dragElement?.getParent?.();
      return deletable && isTop;
    },

    getClientRect() {
      const r = sidebarEl.getBoundingClientRect();
      return new Blockly.utils.Rect(r.top, r.bottom, r.left, r.right);
    },

    onDragEnter(dragElement) {
      if (this.wouldDelete(dragElement)) _showOverlay();
    },

    onDragOver() {},

    onDragExit() {
      _hideOverlay();
    },

    onDrop() {
      _hideOverlay();
    },

    shouldPreventMove() {
      return false;
    },
  };

  workspace.getComponentManager().addComponent({
    component,
    weight: 0,
    capabilities: ['drag_target', 'delete_area'],
  });
  workspace.recordDragTargets();
}

export function loadWorkspaceJSON(workspace, json) {
  Blockly.serialization.workspaces.load(json, workspace);
}

export function saveWorkspaceJSON(workspace) {
  return Blockly.serialization.workspaces.save(workspace);
}

const _BKY_HUES = { LOGIC: 210, MATH: 230, TEXTS: 160, VARIABLES: 330 };

export const TOOLBOX_CATEGORY_META = TOOLBOX.contents.map((c) => {
  let hue = c.colour;
  if (typeof hue === 'string') {
    const m = hue.match(/BKY_(\w+?)_HUE/);
    hue = m ? (_BKY_HUES[m[1]] ?? 230) : 230;
  }
  const blocks = (c.contents || [])
    .filter((item) => item.kind === 'block')
    .map((item) => ({
      type: item.type,
      label: item.type.replace(/^[a-z]+_/, '').replace(/_/g, ' '),
    }));
  return { name: c.name, hue, blocks };
});

// Dynamic user-library category — populated at boot by populateLibraryBlocks()
TOOLBOX_CATEGORY_META.push({ name: 'My Library', hue: 270, blocks: [] });

// Add a registered block type to a palette category (used by window.__ar_applyLibraryBlock)
export function addBlockToCategoryMeta(categoryName, blockType) {
  const cat = TOOLBOX_CATEGORY_META.find((c) => c.name === categoryName);
  if (cat)
    cat.blocks.push({ type: blockType, label: blockType.replace(/^user_/, '').replace(/_/g, ' ') });
}

export function onPaletteClick(paletteWorkspace, callback) {
  paletteWorkspace.getInjectionDiv().addEventListener(
    'pointerdown',
    (e) => {
      const g = e.target.closest('g.blocklyBlock');
      if (!g) return;
      e.stopPropagation();
      e.preventDefault();
      callback(g.classList[0]); // first class is block type name
    },
    true,
  );
}

export function finishBlockRenders() {
  return Blockly.renderManagement.finishQueuedRenders();
}

export function hideInternalToolbox(workspace) {
  const tb = workspace.getToolbox();
  if (!tb?.HtmlDiv) return;
  const el = tb.HtmlDiv;
  el.style.display = 'none';
  tb.position = () => {
    el.style.display = 'none';
  };
  Blockly.svgResize(workspace);
}

/**
 * Dynamically register Blockly blocks for a plugin / registerAPI extension.
 * @param {string} _name — API name (unused, satisfies applier contract)
 * @param {Array<{definition: object, generator: function}>} blocksDefs
 */
export function applyExternalBlocks(_name, blocksDefs) {
  for (const { definition, generator } of blocksDefs) {
    Blockly.defineBlocksWithJsonArray([definition]);
    javascriptGenerator.forBlock[definition.type] = generator;
  }
}
