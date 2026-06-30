// api-detector.js — static analysis of user code snippets.
// Returns which window.* APIs are referenced and whether key methods like
// Shader.start() are actually called. Used by Phase 8 (#12) smart output detection.

import esprima from 'esprima';

// ── AST walker ────────────────────────────────────────────────────────────────

function walk(node, visitor) {
  if (!node || typeof node !== 'object') return;
  visitor(node);
  for (const key of Object.keys(node)) {
    const child = node[key];
    if (Array.isArray(child)) child.forEach((c) => walk(c, visitor));
    else if (child && typeof child === 'object' && child.type) walk(child, visitor);
  }
}

// ── Text-level fast scan ──────────────────────────────────────────────────────

export const API_PATTERNS = {
  // Strudel pattern engine (ADR 035): note()/sound()/stack()/seq()/cat() sources,
  // setcps()/hush()/samples() transport, and the universal `.play()` trigger.
  usesAudio:
    /\baudio\s*\.|\bnote\s*\(|\bsound\s*\(|\bstack\s*\(|\bseq\s*\(|\bsequence\s*\(|\bcat\s*\(|\bsetcps\s*\(|\bsetcpm\s*\(|\bhush\s*\(|\bsamples\s*\(|\.play\s*\(\s*\)|\bnew\s+Drumpad\b/,
  usesShader: /\bnew\s+Shader\b/,
  usesGLShader: /\bnew\s+GLShader\b/,
  usesShaderFX: /\bShaderFX\b/,
  usesPixi: /\b(?:pixi|PIXI|Stage)\b/,
  usesSensors: /\bsensors\s*\./,
  usesCamera: /\bnew\s+Camera\b|\bcamera\s*\./,
  usesVideo: /\bvideo\s*\./,
  usesVision: /\bvision\s*\./,
  usesDesktop: /\bdesktop\s*\./,
  usesMedia: /\bMedia\s*\./,
  usesDraw: /\bdraw\s*\.(?!toASCII\b)/,
  usesLayer: /\bgetLayer\s*\(/,
  usesGetCanvas: /\bgetCanvas\s*\(/,
  usesThree: /\bnew\s+ThreeScene\b|\bTHREE\s*\./,
  usesRoute: /\broute\s*\(/,
};

// ── AST-level precise detection ───────────────────────────────────────────────

// Returns true when the AST contains a call `<varName>.start()` where varName
// is the identifier that `new Shader(...)` / `new GLShader(...)` was assigned to.
function _shaderStartCalled(ast) {
  const shaderVars = new Set();

  // Collect: const s = new Shader(...) / let s = new GLShader(...)
  walk(ast, (node) => {
    if (
      node.type === 'VariableDeclarator' &&
      node.init?.type === 'NewExpression' &&
      (node.init.callee?.name === 'Shader' || node.init.callee?.name === 'GLShader') &&
      node.id?.type === 'Identifier'
    ) {
      shaderVars.add(node.id.name);
    }
  });

  if (shaderVars.size === 0) return false;

  // Check: shaderVar.start()
  let found = false;
  walk(ast, (node) => {
    if (
      node.type === 'CallExpression' &&
      node.callee?.type === 'MemberExpression' &&
      node.callee.property?.name === 'start' &&
      node.callee.object?.type === 'Identifier' &&
      shaderVars.has(node.callee.object.name)
    ) {
      found = true;
    }
  });
  return found;
}

// Returns true when `new Shader(...).start()` inline chain is present.
function _inlineShaderStartCalled(ast) {
  let found = false;
  walk(ast, (node) => {
    if (
      node.type === 'CallExpression' &&
      node.callee?.type === 'MemberExpression' &&
      node.callee.property?.name === 'start' &&
      node.callee.object?.type === 'NewExpression' &&
      (node.callee.object.callee?.name === 'Shader' ||
        node.callee.object.callee?.name === 'GLShader')
    ) {
      found = true;
    }
  });
  return found;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Analyse user code and return a detection report.
 *
 * @param {string} code  User code string
 * @returns {{
 *   usesAudio: boolean, usesShader: boolean, usesGLShader: boolean,
 *   usesShaderFX: boolean, usesPixi: boolean, usesSensors: boolean,
 *   usesCamera: boolean, usesVideo: boolean, usesVision: boolean,
 *   usesDesktop: boolean, usesMedia: boolean, usesDraw: boolean,
 *   usesGetCanvas: boolean, usesLayer: boolean,
 *   shaderStartCalled: boolean,   // Shader/GLShader constructed AND .start() called
 *   shaderConstructedOnly: boolean, // Shader constructed but .start() never called
 *   parseError: string|null,
 * }}
 */
export function detectAPIUsage(code) {
  const result = {
    usesAudio: false,
    usesShader: false,
    usesGLShader: false,
    usesShaderFX: false,
    usesPixi: false,
    usesSensors: false,
    usesCamera: false,
    usesVideo: false,
    usesVision: false,
    usesDesktop: false,
    usesMedia: false,
    usesDraw: false,
    usesGetCanvas: false,
    usesLayer: false,
    usesThree: false,
    usesRoute: false,
    shaderStartCalled: false,
    shaderConstructedOnly: false,
    parseError: null,
  };

  // Fast text scan (catches everything even if AST parse fails)
  for (const [key, re] of Object.entries(API_PATTERNS)) {
    if (re.test(code)) result[key] = true;
  }

  // AST scan for precise call-flow checks
  let ast = null;
  try {
    ast = esprima.parseScript(code, { tolerant: true });
  } catch (e) {
    result.parseError = e.message;
    return result;
  }

  if (result.usesShader || result.usesGLShader) {
    result.shaderStartCalled = _shaderStartCalled(ast) || _inlineShaderStartCalled(ast);
    result.shaderConstructedOnly =
      (result.usesShader || result.usesGLShader) && !result.shaderStartCalled;
  }

  return result;
}
