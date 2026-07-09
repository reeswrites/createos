import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TOOLKIT_CATEGORIES } from '../../../src/editor/toolkit-catalog.js';
import * as acorn from 'acorn';

// Snippets are real learner code — they use modern JS (optional chaining `?.`,
// top-level `await`) that the app runs unmodified (user code is injected as a raw
// <script>; live-patch.js's esprima transform simply no-ops on syntax it can't
// parse). The gate must therefore parse the SAME modern syntax, so it uses acorn
// (ESTree, current ecmaVersion) rather than the app's older esprima. `parseSnippet`
// is the single parse seam both tests share.
function parseSnippet(code) {
  return acorn.parse(code, {
    ecmaVersion: 'latest',
    allowAwaitOutsideFunction: true,
    allowReturnOutsideFunction: true,
  });
}

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

// KNOWN_GLOBALS is DERIVED from the _registerBuiltin('name') calls — the same
// registrations that put each API on window — rather than hand-copied (ADR 008 "list
// → derived"; CONTEXT.md "API Descriptor"). The regex is indentation-agnostic, so it
// catches both top-level and nested registrations. This retires the old hand-list and
// the separate drift gate that existed only to police that the hand-list matched.
// The bulk of registrations live in register-builtins.js; the runtime-dependent ones
// (wm/pixi/library/captureWindow) stay in app.js's window.onload — grep both.
const APP_SRC = [
  readFileSync(resolve(process.cwd(), 'src/runtime/app.js'), 'utf8'),
  readFileSync(resolve(process.cwd(), 'src/runtime/register-builtins.js'), 'utf8'),
].join('\n');
const KNOWN_GLOBALS = new Set(
  [...APP_SRC.matchAll(/_registerBuiltin\(\s*'([^']+)'/g)].map((m) => m[1]),
);

// Standard JS built-ins + DOM APIs + patterns OK in snippets (not createOS APIs).
const JS_BUILTINS = new Set([
  'Math',
  'Array',
  'Date',
  'JSON',
  'Object',
  'console',
  'document',
  'window',
  'setInterval',
  'setTimeout',
  'clearInterval',
  'clearTimeout',
  'Float32Array',
  'Uint8Array',
  'Uint8ClampedArray',
  'Int16Array',
  'Image',
  'Promise',
  'fetch',
  'URL',
  'Blob',
  'performance',
  'navigator',
  'AudioContext',
  'Tone',
  'Symbol',
  'Map',
  'Set',
  'WeakMap',
  'WeakSet',
  'parseInt',
  'parseFloat',
  'isNaN',
  'isFinite',
  'decodeURIComponent',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'Event',
  'EventTarget',
  'Audio', // DOM HTMLAudioElement constructor — `new Audio(url)` in the desktop.onFile demo
  // Commonly used in snippet examples as local variable names for results
  'Serial',
]);

// Identifiers that appear as top-level callers but are local results / callbacks /
// patterns that don't map to a single window global. These are false-positive prone
// — only add when the snippet structure genuinely prevents local-var detection.
const ALLOWED_SNIPPET_LOCALS = new Set([
  // Frequently used as loop vars or destructured locals
  'i',
  'j',
  'k',
  'n',
  'x',
  'y',
  'z',
  'w',
  'h',
  'r',
  's',
  't',
  'v',
  // Common result aliases in multi-line snippets
  'p',
  'c',
  'm',
  'g',
  'b',
  'f',
  'e',
  'd',
  'l',
  'a',
  'u',
  // Params in callback bodies
  'pts',
  'col',
  'val',
  'idx',
  // ADR 040: the conventional example drawing surface (snippets use `canvas.*`
  // against an implicit `const canvas = new Canvas()` the learner adds).
  'canvas',
  // Conventional handle-name aliases used by companion/reference snippets whose
  // `const <name> = …` binding lives in a sibling snippet, not the one shown:
  'vid', // `const vid = Media.video(...)` — the "video controls" method reference
  'layer', // Media.image / c.fx(z) layer handle — the "image fit" reference
  'rec', // `const rec = cam.record(...)` — the "stop recording" companion snippet
]);

// Collect every name a snippet binds locally: `const`/`let`/`var` (including
// destructuring), function declarations, AND function parameters (including
// destructured/rest/defaulted callback params like `({ lat, lon }) => …` or
// `blob => …`). Parameters are unambiguously local bindings — never window
// globals — so capturing them here (rather than allow-listing each param name)
// keeps the identifier gate from false-flagging destructured callback params.
function extractLocalNames(ast) {
  const locals = new Set();
  function addPattern(node) {
    if (!node || typeof node !== 'object') return;
    switch (node.type) {
      case 'Identifier':
        locals.add(node.name);
        break;
      case 'ObjectPattern':
        node.properties.forEach((p) => addPattern(p.value ?? p.argument));
        break;
      case 'ArrayPattern':
        node.elements.forEach((el) => el && addPattern(el));
        break;
      case 'AssignmentPattern':
        addPattern(node.left);
        break;
      case 'RestElement':
        addPattern(node.argument);
        break;
    }
  }
  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'VariableDeclarator') addPattern(node.id);
    if (node.type === 'FunctionDeclaration' && node.id?.type === 'Identifier') {
      locals.add(node.id.name);
    }
    if (
      ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node.type)
    ) {
      (node.params ?? []).forEach(addPattern);
    }
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
  (cat.commands ?? []).map((item) => ({ cat: cat.name, label: item.label, code: item.code })),
);

describe('completion snippet coherence — API identifier gate', () => {
  // Guard against a vacuous pass: if the catalog shape drifts (e.g. the `commands`
  // key gets renamed) this collection silently empties and every per-snippet
  // assertion below passes over zero rows. Assert we actually loaded the catalog.
  // This is the exact failure that once hid inside this gate — it iterated a
  // non-existent `cat.items` key and exercised 0 of the ~435 real snippets.
  it('actually collected the toolkit snippets (no vacuous pass)', () => {
    expect(snippets.length).toBeGreaterThan(400);
  });

  it('every category has at least one item with a code snippet', () => {
    const missing = TOOLKIT_CATEGORIES.filter((c) => !(c.commands ?? []).some((i) => i.code)).map(
      (c) => c.name,
    );
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
        parseSnippet(code);
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
        ast = parseSnippet(code);
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
        violations.push(
          `[${cat}] "${label}": unknown identifier '${name}' in: ${code.slice(0, 80).replace(/\n/g, '↵')}`,
        );
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

// The former "registry ↔ KNOWN_GLOBALS" drift gate is gone: KNOWN_GLOBALS is now
// derived from the registrations above, so there is no parallel list to drift against.
