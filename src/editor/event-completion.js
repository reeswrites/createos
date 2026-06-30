// Event-name completion source for CodeMirror.
// Triggers when cursor is inside the first string argument of on('…') or any('…').
// Returns SYSTEM_EVENTS as keyword options + user-defined events (from emit/on/any in the doc).

import esprima from 'esprima';
import { SYSTEM_EVENTS, DYNAMIC_EVENT_PATTERNS } from '../events/system-events.js';
import { calleePath } from './param-hints.js';

const EVENT_CALLEE_SET = new Set(['on', 'any']);
const COLLECT_CALLEE_SET = new Set(['on', 'any', 'emit']);

// ── Find event-string arg under cursor ────────────────────────────────────────

/**
 * Returns { from, prefix } if cursor is inside the first string arg of on()/any(),
 * otherwise null. `from` is the completion start (just inside the opening quote).
 */
function findEventArgAtCursor(ast, cursor) {
  let found = null;

  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'CallExpression') {
      const path = calleePath(node.callee);
      if (EVENT_CALLEE_SET.has(path) && node.arguments.length >= 1) {
        const firstArg = node.arguments[0];
        if (firstArg.type === 'Literal' && typeof firstArg.value === 'string' && firstArg.range) {
          const [argStart, argEnd] = firstArg.range;
          // cursor inside the string (between the quotes)
          if (cursor > argStart && cursor <= argEnd - 1) {
            // from = position just after the opening quote
            found = { from: argStart + 1, prefix: firstArg.value };
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
  return found;
}

// ── Collect user-defined event strings from the document ─────────────────────

/** Walk AST and collect all string literals from emit/on/any first args. */
function collectUserEvents(ast) {
  const events = new Set();

  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'CallExpression') {
      const path = calleePath(node.callee);
      if (COLLECT_CALLEE_SET.has(path) && node.arguments.length >= 1) {
        const firstArg = node.arguments[0];
        if (firstArg.type === 'Literal' && typeof firstArg.value === 'string') {
          events.add(firstArg.value);
        }
      }
    }
    for (const v of Object.values(node)) {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object' && v.type) walk(v);
    }
  }

  walk(ast);
  return events;
}

// ── Completion source ─────────────────────────────────────────────────────────

const SYSTEM_NAMES = new Set(SYSTEM_EVENTS.map((e) => e.name));

/** CodeMirror completion source. Register via javascriptLanguage.data.of({ autocomplete: eventCompletionSource }). */
export function eventCompletionSource(context) {
  const cursor = context.pos;
  const code = context.state.doc.toString();

  let ast;
  try {
    ast = esprima.parseScript(code, { range: true, tolerant: true });
  } catch (_) {
    return null;
  }

  const match = findEventArgAtCursor(ast, cursor);
  if (!match) return null;

  const userEvents = collectUserEvents(ast);

  // System events as keyword completions (higher boost)
  const systemOptions = SYSTEM_EVENTS.map((e) => ({
    label: e.name,
    type: 'keyword',
    detail: e.detail ?? '',
    info: e.payload ? `Payload: ${e.payload}` : undefined,
    boost: 1,
  }));

  // User-defined events not already in the catalog
  const userOptions = [...userEvents]
    .filter((name) => !SYSTEM_NAMES.has(name) && name.length > 0)
    .map((name) => ({
      label: name,
      type: 'variable',
      detail: 'user-defined event',
      boost: 0,
    }));

  // Dynamic per-window scoped patterns — offered when prefix starts with 'wm:'
  const dynamicOptions = match.prefix.startsWith('wm:')
    ? DYNAMIC_EVENT_PATTERNS.map((p) => ({
        label: p.pattern,
        type: 'keyword',
        detail: p.detail ?? '',
        info: p.payload ? `Payload: ${p.payload}` : undefined,
        boost: 0,
      }))
    : [];

  return {
    from: match.from,
    options: [...systemOptions, ...userOptions, ...dynamicOptions],
    validFor: /[\w:{}.-]*/,
  };
}
