// Best-effort JS → Blockly workspace JSON translator.
// Parses user code with Esprima, pattern-matches known API calls, emits block JSON.
// Unrecognized statements are silently skipped.

import esprima from 'esprima';
import { SHADER_PRESETS, CAMERA_PRESETS } from '../api/shader.js';
// Original source text for range-based extraction during jsToBlocks calls
let _src = '';

function normalizeWGSL(s) { return s.trim().replace(/\s+/g, ' '); }

function matchExact(body, table) {
  const norm = normalizeWGSL(body);
  for (const [key, val] of Object.entries(table))
    if (normalizeWGSL(val) === norm) return key;
  return null;
}

// Fuzzy camera preset matching — tolerant of variable name differences
function matchCameraFuzzy(body) {
  if (/0\.299\s*,\s*0\.587/.test(body))         return 'greyscale';
  if (/1\.0\s*-\s*\w+\.rgb/.test(body))         return 'invert';
  if (/\.g,\s*\w+\.b,\s*\w+\.r/.test(body))     return 'channel_swap';
  if (/floor\s*\(\s*\w+\.rgb\s*\*/.test(body))  return 'posterize';
  if (/fract\s*\(\s*uv\.y/.test(body))           return 'scanlines';
  return null;
}

function matchCameraPreset(body) {
  return matchExact(body, CAMERA_PRESETS) ?? matchCameraFuzzy(body);
}

// ── AST helpers ──────────────────────────────────────────────────────────────

function strLit(node) {
  if (!node) return null;
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node.type === 'TemplateLiteral' && node.quasis.length === 1)
    return node.quasis[0].value.cooked;
  return null;
}

function numLit(node) {
  if (!node) return null;
  if (node.type === 'Literal' && typeof node.value === 'number') return node.value;
  if (node.type === 'UnaryExpression' && node.operator === '-') {
    const v = numLit(node.argument); return v != null ? -v : null;
  }
  return null;
}

function isMember(node, obj, prop) {
  if (!node || node.type !== 'MemberExpression') return false;
  return (obj === '*' || node.object?.name === obj) &&
         (prop === '*' || node.property?.name === prop);
}

function isCall(node, obj, method) {
  return node?.type === 'CallExpression' && isMember(node.callee, obj, method);
}

function isArVideo(node) {
  return node?.type === 'MemberExpression' &&
    node.object?.name === 'window' && node.property?.name === '__ar_video';
}

function callbackStatements(node) {
  const fn = node?.type === 'ArrowFunctionExpression' || node?.type === 'FunctionExpression' ? node : null;
  return fn?.body?.type === 'BlockStatement' ? fn.body.body : null;
}

// Wrap a creator block in "start shader [creator]"
function makeStartShader(creatorBlock) {
  if (!creatorBlock) return null;
  return { type: 'shader_start', inputs: { SHADER: { block: creatorBlock } } };
}

// ── Shader new-expression → block ────────────────────────────────────────────

function matchShaderNew(newExpr) {
  const arg0 = newExpr.arguments[0];
  const body = strLit(arg0);

  if (body) {
    const opts = newExpr.arguments[1];
    let videoNode = null;
    if (opts?.type === 'ObjectExpression') {
      for (const p of opts.properties)
        if (p.key?.name === 'video') { videoNode = p.value; break; }
    }
    if (videoNode && isArVideo(videoNode)) {
      const effect = matchCameraPreset(body) ?? 'greyscale';
      return { type: 'shader_camera_effect', fields: { EFFECT: effect } };
    }
    const preset = matchExact(body, SHADER_PRESETS);
    if (preset) return { type: 'shader_preset', fields: { PRESET: preset } };
    return { type: 'shader_wgsl', fields: { BODY: body } };
  }

  // Arrow/function expression arg — try full decomposition, fall back to text blob
  if (arg0 && (arg0.type === 'ArrowFunctionExpression' || arg0.type === 'FunctionExpression')) {
    const stmts = arg0.body?.type === 'BlockStatement' ? arg0.body.body : null;
    if (stmts) {
      const decomposed = shaderFnBodyBlock(stmts);
      if (decomposed) return decomposed;
    }
    // Fallback: store raw JS source text
    if (_src && arg0.range) {
      return { type: 'shader_js_fn', fields: { BODY: _src.slice(arg0.range[0], arg0.range[1]) } };
    }
  }

  return null;
}

// ── Shader fn body decomposition ─────────────────────────────────────────────
// Strategy: inline const declarations into the return block so we don't need
// Blockly's workspace-scoped variable system (which would break the fn body scope).

const SHADER_PARAMS = {
  'uv.x': 'shader_param_uv_x', 'uv.y': 'shader_param_uv_y',
  'mouse.x': 'shader_param_mouse_x', 'mouse.y': 'shader_param_mouse_y',
  'res.x': 'shader_param_res_x', 'res.y': 'shader_param_res_y',
  'custom.x': 'shader_param_custom_x', 'custom.y': 'shader_param_custom_y',
  'custom.z': 'shader_param_custom_z', 'custom.w': 'shader_param_custom_w',
};
// Custom trig/math ops use shader_math_trig / shader_math_fn (not Blockly's built-ins,
// which add degree↔radian conversion we don't want).
const TRIG_FNS = new Set(['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2']);
const MATH_FNS = new Set(['abs', 'sqrt', 'floor', 'ceil', 'round', 'log', 'log2', 'exp', 'sign']);
const ARITH_OPS = { '+': 'ADD', '-': 'MINUS', '*': 'MULTIPLY', '/': 'DIVIDE', '**': 'POWER' };

function exprToBlock(node, locals) {
  if (!node) return null;

  if (node.type === 'Literal' && typeof node.value === 'number')
    return { type: 'math_number', fields: { NUM: node.value } };

  if (node.type === 'Identifier') {
    if (node.name === 'time') return { type: 'shader_param_time' };
    // Inline local const if available
    if (locals?.has(node.name)) return exprToBlock(locals.get(node.name), locals);
    return null; // unknown identifier — can't translate
  }

  if (node.type === 'MemberExpression' && !node.computed) {
    const key = `${node.object?.name}.${node.property?.name}`;
    if (SHADER_PARAMS[key]) return { type: SHADER_PARAMS[key] };
  }

  if (node.type === 'UnaryExpression' && node.operator === '-') {
    const arg = exprToBlock(node.argument, locals);
    if (!arg) return null;
    return { type: 'math_arithmetic', fields: { OP: 'MINUS' }, inputs: {
      A: { block: { type: 'math_number', fields: { NUM: 0 } } },
      B: { block: arg },
    }};
  }

  if (node.type === 'BinaryExpression') {
    const op = ARITH_OPS[node.operator];
    if (!op) return null;
    const left = exprToBlock(node.left, locals);
    const right = exprToBlock(node.right, locals);
    if (!left || !right) return null;
    return { type: 'math_arithmetic', fields: { OP: op }, inputs: { A: { block: left }, B: { block: right } } };
  }

  if (node.type === 'CallExpression') {
    const callee = node.callee;
    if (callee.type === 'MemberExpression' && callee.object?.name === 'Math') {
      const fn = callee.property?.name;
      const arg = node.arguments[0] ? exprToBlock(node.arguments[0], locals) : null;
      if (TRIG_FNS.has(fn) && fn !== 'atan2') {
        const b = { type: 'shader_math_trig', fields: { OP: fn }, inputs: {} };
        if (arg) b.inputs.ARG = { block: arg };
        return b;
      }
      if (MATH_FNS.has(fn)) {
        const b = { type: 'shader_math_fn', fields: { OP: fn }, inputs: {} };
        if (arg) b.inputs.ARG = { block: arg };
        return b;
      }
      if (fn === 'min' || fn === 'max') {
        const arg2 = node.arguments[1] ? exprToBlock(node.arguments[1], locals) : null;
        const b = { type: 'shader_math_fn', fields: { OP: fn }, inputs: {} };
        if (arg) b.inputs.ARG = { block: arg };
        if (arg2) b.inputs.ARG2 = { block: arg2 };
        return b;
      }
      if (fn === 'pow') {
        const arg2 = node.arguments[1] ? exprToBlock(node.arguments[1], locals) : null;
        return { type: 'math_arithmetic', fields: { OP: 'POWER' }, inputs: {
          A: arg ? { block: arg } : {},
          B: arg2 ? { block: arg2 } : {},
        }};
      }
    }
  }

  return null;
}

function shaderFnBodyBlock(stmts) {
  // First pass: collect const/let declarations as inlineable locals
  const locals = new Map();
  const rest = [];
  for (const s of stmts) {
    if (s.type === 'VariableDeclaration') {
      for (const d of s.declarations)
        if (d.id?.name && d.init) locals.set(d.id.name, d.init);
    } else {
      rest.push(s);
    }
  }

  // Must end with return [r, g, b, a]
  if (rest.length !== 1 || rest[0].type !== 'ReturnStatement') return null;
  const ret = rest[0].argument;
  if (ret?.type !== 'ArrayExpression' || ret.elements.length !== 4) return null;

  const [r, g, b, a] = ret.elements.map(n => exprToBlock(n, locals));
  if (!r && !g && !b && !a) return null;

  const retBlock = { type: 'shader_return_rgba', inputs: {} };
  if (r) retBlock.inputs.R = { block: r };
  if (g) retBlock.inputs.G = { block: g };
  if (b) retBlock.inputs.B = { block: b };
  if (a) retBlock.inputs.A = { block: a };

  return { type: 'shader_fn_body', inputs: { BODY: { block: retBlock } } };
}

// ── Value block matcher ──────────────────────────────────────────────────────

const SYNTH_TYPES = ['synth', 'poly', 'fm', 'am', 'pluck', 'kick', 'metal', 'noise'];

function matchValue(node, vars) {
  if (!node) return null;

  for (const t of SYNTH_TYPES)
    if (isCall(node, 'audio', t)) return { type: 'audio_create_synth', fields: { TYPE: t } };

  if (isCall(node, 'audio', 'reverb'))
    return { type: 'audio_reverb', fields: { DEC: numLit(node.arguments[0]) ?? 2 } };
  if (isCall(node, 'audio', 'delay'))
    return { type: 'audio_delay', fields: { TIME: numLit(node.arguments[0]) ?? 0.25, FB: numLit(node.arguments[1]) ?? 0.5 } };
  if (isCall(node, 'audio', 'distort'))
    return { type: 'audio_distort', fields: { AMT: numLit(node.arguments[0]) ?? 0.8 } };
  if (isCall(node, 'Media', 'video'))
    return { type: 'media_video', fields: { URL: strLit(node.arguments[0]) ?? '' } };
  if (isCall(node, 'Media', 'imageLayer'))
    return { type: 'media_image_layer', fields: { URL: strLit(node.arguments[0]) ?? '' } };

  // Resolve identifier via variable map
  const name = node?.name;
  if (name && vars?.has(name)) return vars.get(name).valueBlock ?? null;

  return null;
}

// ── Statement translator ─────────────────────────────────────────────────────

function translateOne(node, vars) {
  // VariableDeclarations are pre-processed in translateStatements; skip here
  if (node?.type === 'VariableDeclaration') return null;

  const expr = node?.type === 'ExpressionStatement' ? node.expression : node;
  if (!expr || expr.type !== 'CallExpression') return null;

  // ── draw.* ──
  if (isCall(expr, 'draw', 'bg'))    return { type: 'draw_bg',     fields: { COLOR: strLit(expr.arguments[0]) ?? '#000' } };
  if (isCall(expr, 'draw', 'clear')) return { type: 'canvas_clear', fields: {} };
  if (isCall(expr, 'draw', 'alpha')) return { type: 'draw_alpha',  fields: { ALPHA: numLit(expr.arguments[0]) ?? 1 } };
  if (isCall(expr, 'draw', 'reset')) return { type: 'draw_reset',  fields: {} };

  if (isCall(expr, 'draw', 'rect')) {
    const [x, y, w, h] = expr.arguments.slice(0, 4).map(numLit);
    if (x != null) return { type: 'canvas_fill_rect', fields: { X: x, Y: y ?? 0, W: w ?? 100, H: h ?? 100, COLOR: strLit(expr.arguments[4]) ?? 'white' } };
  }
  if (isCall(expr, 'draw', 'circle')) {
    const [x, y, r] = expr.arguments.slice(0, 3).map(numLit);
    if (x != null) return { type: 'canvas_fill_circle', fields: { X: x, Y: y ?? 0, R: r ?? 50, COLOR: strLit(expr.arguments[3]) ?? 'white' } };
  }
  if (isCall(expr, 'draw', 'line')) {
    const [x1, y1, x2, y2] = expr.arguments.slice(0, 4).map(numLit);
    if (x1 != null) return { type: 'draw_line', fields: { X1: x1, Y1: y1 ?? 0, X2: x2 ?? 400, Y2: y2 ?? 400, COLOR: strLit(expr.arguments[4]) ?? 'white', THICKNESS: numLit(expr.arguments[5]) ?? 1 } };
  }
  if (isCall(expr, 'draw', 'text')) {
    const str = strLit(expr.arguments[0]);
    const [x, y, size] = expr.arguments.slice(1, 4).map(numLit);
    return { type: 'draw_text', fields: { STR: str ?? '', X: x ?? 0, Y: y ?? 0, SIZE: size ?? 24, COLOR: strLit(expr.arguments[4]) ?? 'white' } };
  }

  // ── getLayer(z).blur/opacity ──
  const { callee } = expr;
  if (isMember(callee, '*', 'blur') && callee.object?.type === 'CallExpression' && callee.object.callee?.name === 'getLayer')
    return { type: 'canvas_blur', fields: { Z: numLit(callee.object.arguments[0]) ?? 0, AMT: numLit(expr.arguments[0]) ?? 5 } };
  if (isMember(callee, '*', 'opacity') && callee.object?.type === 'CallExpression' && callee.object.callee?.name === 'getLayer')
    return { type: 'canvas_layer_opacity', fields: { Z: numLit(callee.object.arguments[0]) ?? 0, OPACITY: numLit(expr.arguments[0]) ?? 0.5 } };

  // ── ShaderFX.* — both shorthand (camera/preset/video) and factory (cameraShader/presetShader/videoShader) ──
  // Shorthand (create+start): appear as top-level expression statements
  if (isCall(expr, 'ShaderFX', 'camera')) {
    const effect = strLit(expr.arguments[0]) ?? 'greyscale';
    return makeStartShader({ type: 'shader_camera_effect', fields: { EFFECT: effect } });
  }
  if (isCall(expr, 'ShaderFX', 'preset')) {
    return makeStartShader({ type: 'shader_preset', fields: { PRESET: strLit(expr.arguments[0]) ?? 'gradient' } });
  }
  if (isCall(expr, 'ShaderFX', 'video')) {
    const effect = strLit(expr.arguments[1]) ?? 'greyscale';
    const vidBlock = matchValue(expr.arguments[0], vars);
    const creator = { type: 'shader_video_effect', fields: { EFFECT: effect } };
    if (vidBlock) creator.inputs = { VIDEO: { block: vidBlock } };
    return makeStartShader(creator);
  }

  // ── Shader: (new Shader(...)).start() or (ShaderFX.cameraShader(...)).start() or s.start() ──
  if (isMember(callee, '*', 'start')) {
    const obj = callee.object;
    if (obj?.type === 'NewExpression' && obj.callee?.name === 'Shader')
      return makeStartShader(matchShaderNew(obj));
    // ShaderFX factory methods called inline: (ShaderFX.cameraShader(...)).start()
    if (isCall(obj, 'ShaderFX', 'cameraShader'))
      return makeStartShader({ type: 'shader_camera_effect', fields: { EFFECT: strLit(obj.arguments[0]) ?? 'greyscale' } });
    if (isCall(obj, 'ShaderFX', 'presetShader'))
      return makeStartShader({ type: 'shader_preset', fields: { PRESET: strLit(obj.arguments[0]) ?? 'gradient' } });
    if (isCall(obj, 'ShaderFX', 'videoShader')) {
      const effect = strLit(obj.arguments[1]) ?? 'greyscale';
      const vidBlock = matchValue(obj.arguments[0], vars);
      const creator = { type: 'shader_video_effect', fields: { EFFECT: effect } };
      if (vidBlock) creator.inputs = { VIDEO: { block: vidBlock } };
      return makeStartShader(creator);
    }
    const entry = vars?.get(obj?.name);
    if (entry?.shaderNew) return makeStartShader(matchShaderNew(entry.shaderNew));
    if (entry?.shaderFXBlock) return makeStartShader(entry.shaderFXBlock);
  }

  // ── setInterval / setTimeout ──
  const fnName = callee?.name;
  if (fnName === 'setInterval' || fnName === 'setTimeout') {
    const ms = numLit(expr.arguments[1]) ?? (fnName === 'setInterval' ? 100 : 1000);
    const body = callbackStatements(expr.arguments[0]);
    const inner = body ? translateStatements(body) : null;
    const block = { type: fnName === 'setInterval' ? 'ctrl_interval' : 'ctrl_timeout', fields: { MS: ms } };
    if (inner) block.inputs = { DO: { block: inner } };
    return block;
  }

  // ── onKey ──
  if (fnName === 'onKey') {
    const key = strLit(expr.arguments[0]) ?? 'any';
    const body = callbackStatements(expr.arguments[1]);
    const inner = body ? translateStatements(body) : null;
    const block = { type: 'ctrl_onkey', fields: { KEY: key } };
    if (inner) block.inputs = { DO: { block: inner } };
    return block;
  }

  // ── audio ──
  if (isCall(expr, 'audio', 'bpm'))    return { type: 'audio_bpm',            fields: { BPM: numLit(expr.arguments[0]) ?? 120 } };
  if (isCall(expr, 'audio', 'start'))  return { type: 'audio_transport_start', fields: {} };
  if (isCall(expr, 'audio', 'volume')) return { type: 'audio_volume',          fields: { DB:  numLit(expr.arguments[0]) ?? -6 } };

  // (synth).play(note, dur) — note+dur distinguish from vid.play()
  if (isMember(callee, '*', 'play')) {
    const note = strLit(expr.arguments[0]);
    const dur  = strLit(expr.arguments[1]);
    if (note && dur) {
      const synthBlock = matchValue(callee.object, vars);
      const block = { type: 'audio_play', fields: { NOTE: note, DUR: dur } };
      if (synthBlock) block.inputs = { SYNTH: { block: synthBlock } };
      return block;
    }
  }

  // (from).connect(to)
  if (isMember(callee, '*', 'connect')) {
    const fromBlock = matchValue(callee.object, vars);
    const toBlock   = matchValue(expr.arguments[0], vars);
    if (fromBlock && toBlock) return { type: 'audio_connect', inputs: { FROM: { block: fromBlock }, TO: { block: toBlock } } };
  }

  // ── vision ──
  if (isCall(expr, 'vision', 'onGesture')) {
    const gest  = strLit(expr.arguments[0]) ?? 'Thumb_Up';
    const body  = callbackStatements(expr.arguments[1]);
    const inner = body ? translateStatements(body) : null;
    const block = { type: 'vision_on_gesture', fields: { GESTURE: gest } };
    if (inner) block.inputs = { DO: { block: inner } };
    return block;
  }
  if (isCall(expr, 'vision', 'onExpression')) {
    const name  = strLit(expr.arguments[0]) ?? 'smile';
    const body  = callbackStatements(expr.arguments[1]);
    const inner = body ? translateStatements(body) : null;
    const block = { type: 'vision_on_expression', fields: { EXPR: name } };
    if (inner) block.inputs = { DO: { block: inner } };
    return block;
  }

  // ── media ──
  if (isMember(callee, '*', 'play')) {
    const vidBlock = matchValue(callee.object, vars);
    if (vidBlock) return { type: 'media_video_play', inputs: { VIDEO: { block: vidBlock } } };
  }
  if (isMember(callee, '*', 'stop')) {
    const vidBlock = matchValue(callee.object, vars);
    if (vidBlock) return { type: 'media_video_stop', inputs: { VIDEO: { block: vidBlock } } };
  }

  return null;
}

function translateStatements(stmts) {
  // First pass: collect variable bindings for 2-step patterns (const x = expr; x.method())
  const vars = new Map();
  const consumed = new Set();   // VariableDeclarations stored in vars (inlined later, not emitted raw)
  for (const s of stmts) {
    if (s.type !== 'VariableDeclaration') continue;
    const before = vars.size;
    for (const d of s.declarations) {
      const name = d.id?.name;
      if (!name || !d.init) continue;
      const init = d.init;
      if (init.type === 'NewExpression' && init.callee?.name === 'Shader') {
        vars.set(name, { shaderNew: init });
      } else if (isCall(init, 'ShaderFX', 'cameraShader')) {
        vars.set(name, { shaderFXBlock: { type: 'shader_camera_effect', fields: { EFFECT: strLit(init.arguments[0]) ?? 'greyscale' } } });
      } else if (isCall(init, 'ShaderFX', 'presetShader')) {
        vars.set(name, { shaderFXBlock: { type: 'shader_preset', fields: { PRESET: strLit(init.arguments[0]) ?? 'gradient' } } });
      } else if (isCall(init, 'ShaderFX', 'videoShader')) {
        const effect = strLit(init.arguments[1]) ?? 'greyscale';
        const vidBlock = matchValue(init.arguments[0], vars);
        const creator = { type: 'shader_video_effect', fields: { EFFECT: effect } };
        if (vidBlock) creator.inputs = { VIDEO: { block: vidBlock } };
        vars.set(name, { shaderFXBlock: creator });
      } else {
        const vb = matchValue(init, vars);
        if (vb) vars.set(name, { valueBlock: vb });
      }
    }
    if (vars.size > before) consumed.add(s);
  }

  // Second pass: translate to blocks. Unrecognized statements are NOT dropped —
  // they are wrapped verbatim in a js_raw passthrough block so text↔blocks
  // round-trips losslessly (ADR 037). Declarations already consumed into `vars`
  // (inlined into a later block) are the one exception — skip them to avoid
  // double-emitting.
  const blocks = [];
  for (const s of stmts) {
    const b = translateOne(s, vars);
    if (b) { blocks.push(b); continue; }
    if (s.type === 'VariableDeclaration' && consumed.has(s)) continue;
    const raw = (_src && s.range) ? _src.slice(s.range[0], s.range[1]).trim() : '';
    if (raw) blocks.push({ type: 'js_raw', fields: { CODE: raw } });
  }

  if (!blocks.length) return null;

  // Link statement sequence via `next`
  for (let i = 0; i < blocks.length - 1; i++)
    blocks[i].next = { block: blocks[i + 1] };

  return blocks[0];
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Convert JavaScript source to Blockly workspace JSON.
 * Returns null if nothing could be translated.
 * Unrecognized code is silently skipped.
 */
export function jsToBlocks(code) {
  _src = code;
  let ast;
  try {
    ast = esprima.parseScript(code, { tolerant: true, range: true });
  } catch {
    _src = '';
    return null;
  }

  const root = translateStatements(ast.body);
  _src = '';
  if (!root) return null;

  root.x = 20;
  root.y = 20;

  return { blocks: { languageVersion: 0, blocks: [root] } };
}
