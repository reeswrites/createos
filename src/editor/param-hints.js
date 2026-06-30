// Cursor-based signature help: shows param names for known API calls at cursor.

import { StateField } from '@codemirror/state';
import { showTooltip } from '@codemirror/view';
import esprima from 'esprima';
import { deriveParamHints } from '../runtime/api-registry.js';

// Resolve a call path's params: the manual PARAM_HINTS table first, then the
// single source — param signatures carried on each API's descriptor (CONTEXT.md
// "API Descriptor"). Manual wins for un-migrated APIs; migrated APIs live only in
// their descriptor. Derivation is live (per lookup) so run-scoped registerAPI()
// signatures appear without an import-time snapshot.
export function resolveParamHint(path) {
  // PARAM_HINTS (manual) → API Descriptor (registered globals) → Canvas instance
  // method. The last covers `c.circle(...)` / `canvas.rect(...)` etc., which can't
  // be keyed by a fixed path because the object is a per-sketch variable (ADR 040).
  return (
    PARAM_HINTS[path] ??
    deriveParamHints()[path] ??
    CANVAS_METHOD_HINTS[path.includes('.') ? path.slice(path.lastIndexOf('.') + 1) : ''] ??
    null
  );
}

// 2D draw methods live on a `Canvas` instance (the var name varies), so they are
// matched by method name as a last resort. Names are draw-distinctive to limit
// false matches on unrelated objects.
const CANVAS_METHOD_HINTS = {
  rect: ['x', 'y', 'w', 'h', 'color'],
  rectStroke: ['x', 'y', 'w', 'h', 'color', 'thickness'],
  circle: ['x', 'y', 'r', 'color'],
  ring: ['x', 'y', 'r', 'color', 'thickness'],
  arc: ['x', 'y', 'r', 'start', 'end', 'color'],
  arcStroke: ['x', 'y', 'r', 'start', 'end', 'color', 'thickness'],
  line: ['x1', 'y1', 'x2', 'y2', 'color', 'thickness'],
  poly: ['points', 'color'],
  bg: ['color'],
  backdrop: ['source', 'opts?'],
  pixelate: ['source', 'blockSize', 'x?', 'y?', 'w?', 'h?'],
};

// ── Param tables ──────────────────────────────────────────────────────────────

// Residual manual hints — entries that have NO single API-Descriptor home, so they
// can't migrate to a registration's `params` (CONTEXT.md "API Descriptor"). Two kinds:
//   1. `on` is dual-shape — both a bare call `on('event')` AND chained methods
//      `on(...).when/every/after/within(...)`. A descriptor's `params` is one shape
//      (array OR method-map), not both, so the whole `on` cluster stays here.
//   2. `file.*` are methods on an AudioFile INSTANCE returned by `audio.load()`, not a
//      registered global — like the `CANVAS_METHOD_HINTS` instance methods below.
// Every other API's param signatures now live beside its `_registerBuiltin(...)` call
// in app.js and resolve via deriveParamHints().
export const PARAM_HINTS = {
  // Event bus — `on` is callable and chainable (see note above)
  on: ['event'],
  'on.when': ['patternOrFn', 'map?'],
  'on.every': ['n'],
  'on.after': ['event'],
  'on.within': ['ms'],
  // AudioFile instance (from audio.load()) — instance methods, no global descriptor
  'file.seek': ['seconds'],
  'file.play': ['offsetSeconds?'],
  'file.filter': ['type', 'freq?', 'Q?'],
  'file.reverb': ['decay?'],
  'file.eq': ['low?', 'mid?', 'high?'],
  'file.delay': ['time?', 'feedback?'],
  'file.pitchShift': ['semitones'],
  'file.volume': ['dB'],
  'file.onTime': ['seconds', 'fn'],
  'file.loop': ['enabled?'],
  'file.waveform': ['opts?'],
};

// ── AST helpers ───────────────────────────────────────────────────────────────

export function calleePath(node) {
  if (!node) return null;
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'MemberExpression' && !node.computed) {
    const obj = calleePath(node.object);
    return obj ? `${obj}.${node.property.name}` : null;
  }
  return null;
}

function findCallAtCursor(ast, cursor) {
  let best = null;

  function walk(node) {
    if (!node || typeof node !== 'object' || !node.range) return;
    if (node.type === 'CallExpression' || node.type === 'NewExpression') {
      const [start, end] = node.range;
      if (cursor >= start && cursor <= end) {
        const callee = node.callee;
        const calleeEnd = callee?.range?.[1] ?? start;
        // Cursor must be AFTER the opening paren (i.e., inside the arg list)
        if (cursor > calleeEnd) {
          // prefer innermost: larger start wins
          if (!best || start > best.start) {
            const args = node.arguments;
            // Determine which arg index cursor falls in
            let argIdx = 0;
            for (let i = 0; i < args.length; i++) {
              const aEnd = args[i + 1] ? args[i + 1].range[0] : end - 1;
              if (cursor < aEnd) {
                argIdx = i;
                break;
              }
              argIdx = i;
            }

            const path = calleePath(callee);
            best = { start, end, path, argIdx };
          }
        }
      }
    }
    for (const v of Object.values(node)) {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object' && v.type) walk(v);
    }
  }

  walk(ast);
  return best;
}

// ── Tooltip computation ───────────────────────────────────────────────────────

function computeTooltip(state) {
  const cursor = state.selection.main.head;
  const code = state.doc.toString();

  let ast;
  try {
    ast = esprima.parseScript(code, { range: true, tolerant: true });
  } catch (_) {
    return null;
  }

  const match = findCallAtCursor(ast, cursor);
  if (!match) return null;

  const params = resolveParamHint(match.path);
  if (!params) return null;

  const idx = Math.min(match.argIdx, params.length - 1);

  return {
    pos: cursor,
    above: true,
    strictSide: false,
    create() {
      const dom = document.createElement('div');
      dom.className = 'ar-param-hint';

      const name = document.createElement('span');
      name.className = 'ar-param-name';
      name.textContent = match.path;
      dom.appendChild(name);

      const open = document.createTextNode('(');
      dom.appendChild(open);

      params.forEach((p, i) => {
        if (i > 0) dom.appendChild(document.createTextNode(', '));
        const span = document.createElement('span');
        span.textContent = p;
        span.className = i === idx ? 'ar-param-active' : 'ar-param-dim';
        dom.appendChild(span);
      });

      dom.appendChild(document.createTextNode(')'));
      return { dom };
    },
  };
}

// ── StateField ────────────────────────────────────────────────────────────────

export const paramHintsField = StateField.define({
  create: (state) => computeTooltip(state),
  update(tooltip, tr) {
    if (!tr.docChanged && !tr.selection) return tooltip;
    return computeTooltip(tr.state);
  },
  provide: (f) => showTooltip.from(f),
});

export function paramHintsExtension() {
  return [paramHintsField];
}
