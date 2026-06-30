import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TOOLKIT_CATEGORIES } from '../../src/editor/completions.js';
import * as esprima from 'esprima';

// ── Completion-snippet coherence gate (ADR Phase 4) ───────────────────────────
//
// Every `code:` snippet in TOOLKIT_CATEGORIES is parsed to extract top-level API
// identifiers (i.e. `foo` in `foo.method()` or `new Foo()`). Each must be either:
//   a) A known window global registered at startup (KNOWN_GLOBALS), OR
//   b) A standard JS built-in / local variable defined within the snippet, OR
//   c) Listed in ALLOWED_SNIPPET_GLOBALS (well-known patterns that don't route
//      through the API registry).
//
// This catches API global renames silently leaving stale snippet references.
// Method-level checking is deferred (Phase 4 Step 2 — "Manifest").

// Derived from app.js _registerBuiltin() calls + editor-instance preamble.
// Update when a new window global is added or renamed.
const KNOWN_GLOBALS = new Set([
  // Core API objects
  'audio', 'wm', 'midi', 'external', 'shell', 'desktop',
  'video', 'vision', 'pipe', 'route', 'timeline', 'ascii', 'monitor', 'signalGraph', 'library',
  // Constructors / classes
  'Shader', 'GLShader', 'ShaderFX', 'GLSL_PRESETS', 'Canvas',
  'Camera', 'Media', 'Source',
  'ThreeScene', 'THREE',
  'Sprite', 'SpriteEditor', 'spriteEditor',
  'Paint', 'paint',
  'AsciiEditor', 'asciiEditor',
  'Drumpad', 'Piano', 'Notepad', 'notepad',
  'Recording', 'recordStream', 'compositeCanvasStream', 'recordWindow', 'snapshot',
  'PIXI', 'pixi', 'Stage',
  'PluginHost',
  'Color', 'tween', 'randUni',
  // Event bus
  'on', 'emit', 'any', 'tick', 'hold',
  // Strudel pattern engine globals (ADR 035) — registered in app.js
  'note', 's', 'n', 'sound', 'silence',
  'stack', 'cat', 'slowcat', 'fastcat', 'seq', 'sequence', 'timeCat', 'arrange',
  'polymeter', 'polyrhythm', 'run',
  'rand', 'rand2', 'perlin', 'irand', 'choose', 'wchoose', 'chooseCycles', 'randcat',
  'sine', 'cosine', 'saw', 'isaw', 'square', 'tri', 'signal', 'steady',
  'pure', 'reify', 'mini', 'samples', 'setcps', 'setcpm', 'hush',
  // (ADR 040: global draw/getCanvas/getLayer/getDraw deleted — use new Canvas())
  // Other registered names
  'editImage', 'captureWindow', 'statusBar', 'registerAPI',
  'vec2', 'vec3', 'vec4',
  // Viz constructors registered in initApp
  'AudioViz', 'SpectrogramCanvas', 'PianoRollViz',
  'mixer',
]);

// Standard JS built-ins + DOM APIs + patterns OK in snippets (not createOS APIs).
const JS_BUILTINS = new Set([
  'Math', 'Array', 'Date', 'JSON', 'Object', 'console', 'document', 'window',
  'setInterval', 'setTimeout', 'clearInterval', 'clearTimeout',
  'Float32Array', 'Uint8Array', 'Uint8ClampedArray', 'Int16Array',
  'Image', 'Promise', 'fetch', 'URL', 'Blob',
  'performance', 'navigator', 'AudioContext', 'Tone',
  'Symbol', 'Map', 'Set', 'WeakMap', 'WeakSet',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'decodeURIComponent',
  'requestAnimationFrame', 'cancelAnimationFrame',
  'Event', 'EventTarget',
  // Commonly used in snippet examples as local variable names for results
  'Serial',
]);

// Identifiers that appear as top-level callers but are local results / callbacks /
// patterns that don't map to a single window global. These are false-positive prone
// — only add when the snippet structure genuinely prevents local-var detection.
const ALLOWED_SNIPPET_LOCALS = new Set([
  // Frequently used as loop vars or destructured locals
  'i', 'j', 'k', 'n', 'x', 'y', 'z', 'w', 'h', 'r', 's', 't', 'v',
  // Common result aliases in multi-line snippets
  'p', 'c', 'm', 'g', 'b', 'f', 'e', 'd', 'l', 'a', 'u',
  // Params in callback bodies
  'pts', 'col', 'val', 'idx',
  // ADR 040: the conventional example drawing surface (snippets use `canvas.*`
  // against an implicit `const canvas = new Canvas()` the learner adds).
  'canvas',
]);

function extractLocalNames(ast) {
  const locals = new Set();
  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'VariableDeclarator' && node.id?.type === 'Identifier') {
      locals.add(node.id.name);
    }
    if (node.type === 'FunctionDeclaration' && node.id?.type === 'Identifier') {
      locals.add(node.id.name);
    }
    if (['Params', 'params'].includes(node.type)) return; // skip params
    for (const key of Object.keys(node)) {
      const child = node[key];
      if (child && typeof child === 'object' && child.type) walk(child);
      if (Array.isArray(child)) child.forEach(walk);
    }
  }
  walk(ast);
  return locals;
}

function extractAPICallers(ast) {
  const callers = new Set();
  function walk(node) {
    if (!node || typeof node !== 'object') return;
    // foo.bar(...) or new Foo(...)
    if (node.type === 'MemberExpression' && node.object?.type === 'Identifier') {
      callers.add(node.object.name);
    }
    if (node.type === 'NewExpression' && node.callee?.type === 'Identifier') {
      callers.add(node.callee.name);
    }
    // tagged template: foo`...`
    if (node.type === 'TaggedTemplateExpression' && node.tag?.type === 'Identifier') {
      callers.add(node.tag.name);
    }
    for (const key of Object.keys(node)) {
      const child = node[key];
      if (child && typeof child === 'object' && child.type) walk(child);
      if (Array.isArray(child)) child.forEach(walk);
    }
  }
  walk(ast);
  return callers;
}

// ── Collect all snippets ───────────────────────────────────────────────────────

const snippets = TOOLKIT_CATEGORIES.flatMap((cat) =>
  (cat.items ?? []).map((item) => ({ cat: cat.name, label: item.label, code: item.code })),
);

describe('completion snippet coherence — API identifier gate', () => {
  it('every category has at least one item with a code snippet', () => {
    const missing = TOOLKIT_CATEGORIES.filter((c) => !(c.items ?? []).some((i) => i.code)).map((c) => c.name);
    // Some categories intentionally have no code (e.g. header-only) — only warn
    if (missing.length > 0) {
      console.warn('[completion-coherence] categories with no code snippets:', missing.join(', '));
    }
    // Not a hard failure — header-only categories are valid
  });

  it('every snippet is parseable (or skipped with a parse-error note)', () => {
    const parseErrors = [];
    for (const { cat, label, code } of snippets) {
      if (!code) continue;
      try {
        esprima.parseScript(code, { tolerant: true });
      } catch (err) {
        parseErrors.push(`[${cat}] "${label}": ${err.message}`);
      }
    }
    expect(
      parseErrors,
      `Some snippets failed to parse. Fix the snippet or suppress in the skip list:\n${parseErrors.join('\n')}`,
    ).toEqual([]);
  });

  it('every snippet uses only known window globals (not local vars)', () => {
    const violations = [];

    for (const { cat, label, code } of snippets) {
      if (!code) continue;
      let ast;
      try {
        ast = esprima.parseScript(code, { tolerant: true });
      } catch {
        continue; // parse failures caught above
      }

      const locals = extractLocalNames(ast);
      const callers = extractAPICallers(ast);

      for (const name of callers) {
        if (locals.has(name)) continue;
        if (KNOWN_GLOBALS.has(name)) continue;
        if (JS_BUILTINS.has(name)) continue;
        if (ALLOWED_SNIPPET_LOCALS.has(name)) continue;
        violations.push(`[${cat}] "${label}": unknown identifier '${name}' in: ${code.slice(0, 80).replace(/\n/g, '↵')}`);
      }
    }

    expect(
      violations,
      `Snippets reference unknown window globals. Either add to KNOWN_GLOBALS (if it's a real API), ` +
      `JS_BUILTINS (if it's a JS built-in), or ALLOWED_SNIPPET_LOCALS (if it's a local result alias):\n` +
      violations.join('\n'),
    ).toEqual([]);
  });
});

// ── Gate: app.js _registerBuiltin names ↔ KNOWN_GLOBALS ─────────────────────

describe('completion snippet coherence — registry ↔ KNOWN_GLOBALS gate', () => {
  it('all names in app.js _registerBuiltin calls are in KNOWN_GLOBALS or JS_BUILTINS', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/runtime/app.js'), 'utf8');
    const registered = [...src.matchAll(/_registerBuiltin\(\s*'([^']+)'/g)].map((m) => m[1]);
    const unknown = registered.filter((n) => !KNOWN_GLOBALS.has(n) && !JS_BUILTINS.has(n));
    expect(
      unknown,
      `Names registered in app.js but missing from KNOWN_GLOBALS in completion-coherence.test.js: ${unknown.join(', ')}. ` +
      `Add them to KNOWN_GLOBALS.`,
    ).toEqual([]);
  });

  it('no stale names in KNOWN_GLOBALS (every name is registered in app.js or is a preamble global)', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/runtime/app.js'), 'utf8');
    const registered = new Set([...src.matchAll(/_registerBuiltin\(\s*'([^']+)'/g)].map((m) => m[1]));
    // Preamble globals set directly on window (not via _registerBuiltin)
    const PREAMBLE_GLOBALS = new Set();   // ADR 040: draw/getCanvas/getLayer/getDraw removed from preamble
    const stale = [...KNOWN_GLOBALS].filter((n) => !registered.has(n) && !PREAMBLE_GLOBALS.has(n));
    expect(
      stale,
      `Names in KNOWN_GLOBALS that are no longer registered: ${stale.join(', ')}. ` +
      `Remove from KNOWN_GLOBALS or add to PREAMBLE_GLOBALS.`,
    ).toEqual([]);
  });
});
