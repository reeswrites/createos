import esprima from 'esprima';

// ── Transform pipeline ────────────────────────────────────────────────────────
// transformCode(code, visitors): one Esprima parse, N visitors each contribute
// {pos,str} patches, all patches sorted desc and spliced once. Visitors see
// original source positions so line numbers stay accurate across visitors.
//
// Visitors are functions (node, patches) => void, optionally with a `.finalize(patches)`
// method called after the full walk completes (for two-phase visitors that need to see
// all nodes before generating patches — e.g. to filter based on parent node ranges).
export function transformCode(code, visitors) {
  const patches = [];
  try {
    esprima.parseScript(code, { tolerant: true, range: true, loc: true }, (node) => {
      for (const v of visitors) v(node, patches);
    });
  } catch (_) {}
  for (const v of visitors) v.finalize?.(patches);
  patches
    .sort((a, b) => b.pos - a.pos)
    .forEach((p) => {
      code = code.slice(0, p.pos) + p.str + code.slice(p.pos);
    });
  return code;
}

// ── Visitor factories ─────────────────────────────────────────────────────────

export function makeLoopProtectionVisitor(timeout = 2000) {
  let loopId = 1;
  const varPrefix = '_wmloopvar';
  const varStr = 'var %d = Date.now();\n';
  const checkStr = `\nif (Date.now() - %d > ${timeout}) { window.stopRunning(); throw new Error("Infinite loop detected. Please make changes and press Run when you are ready to try again."); break;}\n`;
  return (node, patches) => {
    switch (node.type) {
      case 'DoWhileStatement':
      case 'ForStatement':
      case 'ForInStatement':
      case 'ForOfStatement':
      case 'WhileStatement': {
        let start = 1 + node.body.range[0];
        let end = node.body.range[1];
        let prolog = checkStr.replace('%d', varPrefix + loopId);
        let epilog = '';
        if (node.body.type !== 'BlockStatement') {
          prolog = '{' + prolog;
          epilog = '}';
          --start;
        }
        patches.push({ pos: start, str: prolog });
        patches.push({ pos: end, str: epilog });
        patches.push({ pos: node.range[0], str: varStr.replace('%d', varPrefix + loopId) });
        ++loopId;
        break;
      }
      default:
        break;
    }
  };
}

const _TRACE_TYPES = new Set([
  'ExpressionStatement',
  'VariableDeclaration',
  'FunctionDeclaration',
  'ClassDeclaration',
  'ReturnStatement',
  'ThrowStatement',
  'BreakStatement',
  'ContinueStatement',
  'IfStatement',
  'SwitchStatement',
  'TryStatement',
  'WhileStatement',
  'DoWhileStatement',
  'ForStatement',
  'ForInStatement',
  'ForOfStatement',
  'LabeledStatement',
  'DebuggerStatement',
]);

export function makeTraceVisitor(editorId) {
  // Esprima visits children BEFORE parents (post-order), so we can't mark forbidden
  // ranges before children are visited. Instead we collect candidates + forbidden
  // ranges during the walk, then filter in finalize() after the full walk.
  const _candidates = []; // { pos, line }
  const _forbidden = new Set(); // char positions inside for-loop header parts

  const visitor = (node, _patches) => {
    // Collect for-loop header ranges as forbidden (VariableDeclarations here are
    // NOT standalone statements — injecting trace calls there produces invalid JS).
    if (node.type === 'ForStatement') {
      if (node.init)
        for (let p = node.init.range[0]; p < node.init.range[1]; p++) _forbidden.add(p);
      if (node.update)
        for (let p = node.update.range[0]; p < node.update.range[1]; p++) _forbidden.add(p);
    } else if (node.type === 'ForInStatement' || node.type === 'ForOfStatement') {
      if (node.left)
        for (let p = node.left.range[0]; p < node.left.range[1]; p++) _forbidden.add(p);
    }
    // Forbid injecting into non-block single-statement bodies — a trace injected
    // before `return` in `if (x) return;` produces `if (x) trace(); return;` which
    // makes the return unconditional, silently breaking control flow.
    if (node.type === 'IfStatement') {
      const forbidBody = (b) => {
        if (b && b.type !== 'BlockStatement')
          for (let p = b.range[0]; p < b.range[1]; p++) _forbidden.add(p);
      };
      forbidBody(node.consequent);
      forbidBody(node.alternate);
    } else if (
      node.type === 'WhileStatement' ||
      node.type === 'DoWhileStatement' ||
      node.type === 'ForStatement' ||
      node.type === 'ForInStatement' ||
      node.type === 'ForOfStatement'
    ) {
      if (node.body && node.body.type !== 'BlockStatement')
        for (let p = node.body.range[0]; p < node.body.range[1]; p++) _forbidden.add(p);
    }
    if (!_TRACE_TYPES.has(node.type) || !node.loc) return;
    _candidates.push({ pos: node.range[0], line: node.loc.start.line });
  };

  visitor.finalize = (patches) => {
    for (const { pos, line } of _candidates) {
      if (!_forbidden.has(pos)) {
        patches.push({ pos, str: `window.__ar_e${editorId}_trace(${line});` });
      }
    }
  };

  return visitor;
}

// ── Backwards-compat wrapper ──────────────────────────────────────────────────
export function addInfiniteLoopProtection(code, timeout = 2000) {
  return transformCode(code, [makeLoopProtectionVisitor(timeout)]);
}

// ── Error helpers ─────────────────────────────────────────────────────────────
export function friendlyError(raw) {
  const m = String(raw?.message ?? raw);
  const dup = m.match(/Identifier ['"]?(\w+)['"]? has already been declared/);
  if (dup) return `'${dup[1]}' is declared twice — remove the duplicate const/let/var line.`;

  const notFn = m.match(/['"]([\w.]+)['"] is not a function|(\S+) is not a function/);
  if (notFn) {
    const name = notFn[1] ?? notFn[2];
    return `${name} is not a function — check the spelling.`;
  }

  const notDef = m.match(/(\w+) is not defined/);
  if (notDef) return `'${notDef[1]}' is not defined — did you forget to create it?`;

  const prop = m.match(
    /Cannot read propert(?:y|ies) of (undefined|null)(?: \(reading ['"](\w+)['"]\))?/,
  );
  if (prop)
    return prop[2]
      ? `Tried to use .${prop[2]} on something that doesn't exist yet.`
      : `Tried to use a property on something that doesn't exist yet.`;

  if (m.includes('Unexpected token') || m.includes('Unexpected end of'))
    return `Syntax error — check for missing or extra brackets, quotes, or commas.`;

  if (m.includes('Unexpected identifier'))
    return `Syntax error — unexpected word. Check for missing punctuation on the line above.`;

  if (m.includes('Infinite loop detected')) return m;

  return m.replace(/^(TypeError|SyntaxError|ReferenceError|RangeError|EvalError): /, '');
}

// Returns 1-based script line from an error's stack trace, or null if unparseable.
export function extractScriptLine(error) {
  const stack = error?.stack ?? '';
  // Chrome/Edge/Safari: <anonymous>:LINE:COL
  const m = stack.match(/<anonymous>:(\d+):\d+/);
  if (m) return parseInt(m[1], 10);
  // Eval-wrapped: eval at NAME (file:L:C):OUTER_LINE:OUTER_COL — want OUTER_LINE
  const mEval = stack.match(/\):(\d+):\d+/);
  if (mEval) return parseInt(mEval[1], 10);
  // Firefox: @debugger eval code:LINE:COL
  const m2 = stack.match(/@[^:]*:(\d+):\d+/);
  if (m2) return parseInt(m2[1], 10);
  return typeof error?.lineNumber === 'number' ? error.lineNumber : null;
}
