// js-to-wgsl.js — compile a JS arrow/function to a WGSL fragment body.
//
// Entry point: jsToWGSL(fn, opts) → { body: string, helpers: string[], usesCol: boolean }
//
// Supported:
//   Params: destructured ({ uv, time, col, custom, res, mouse })
//   let/const — typed via inference
//   Math.*    — maps to WGSL built-ins
//   vec2/vec3/vec4 constructors
//   if/else, for, while
//   ternary   — becomes WGSL select()
//   i++ / i-- — becomes i += 1 / i -= 1
//   return [r,g,b,a] → return vec4f(r,g,b,a)
//   inner function declarations — hoisted as WGSL fn helpers
//   helper param types inferred from default values (e.g. r = 0.0 → f32, c = vec2(0,0) → vec2f)

import esprima from 'esprima';

// ── Type tables ───────────────────────────────────────────────────────────────

// Swizzle access: objType.prop → resultType
const SWIZZLE = {
  vec4f: {
    x: 'f32',
    y: 'f32',
    z: 'f32',
    w: 'f32',
    r: 'f32',
    g: 'f32',
    b: 'f32',
    a: 'f32',
    xy: 'vec2f',
    xz: 'vec2f',
    yz: 'vec2f',
    rg: 'vec2f',
    rb: 'vec2f',
    gb: 'vec2f',
    xyz: 'vec3f',
    rgb: 'vec3f',
    xyw: 'vec3f',
    xzw: 'vec3f',
  },
  vec3f: {
    x: 'f32',
    y: 'f32',
    z: 'f32',
    r: 'f32',
    g: 'f32',
    b: 'f32',
    xy: 'vec2f',
    xz: 'vec2f',
    yz: 'vec2f',
    rg: 'vec2f',
    rb: 'vec2f',
  },
  vec2f: { x: 'f32', y: 'f32', r: 'f32', g: 'f32' },
  vec4i: { x: 'i32', y: 'i32', z: 'i32', w: 'i32' },
  vec3i: { x: 'i32', y: 'i32', z: 'i32' },
  vec2i: { x: 'i32', y: 'i32' },
};

const VEC_CTORS = {
  vec2: 'vec2f',
  vec3: 'vec3f',
  vec4: 'vec4f',
  vec2f: 'vec2f',
  vec3f: 'vec3f',
  vec4f: 'vec4f',
  vec2i: 'vec2i',
  vec3i: 'vec3i',
  vec4i: 'vec4i',
};

const MATH = {
  sin: 'sin',
  cos: 'cos',
  tan: 'tan',
  asin: 'asin',
  acos: 'acos',
  atan: 'atan',
  atan2: 'atan2',
  abs: 'abs',
  floor: 'floor',
  ceil: 'ceil',
  round: 'round',
  sqrt: 'sqrt',
  pow: 'pow',
  exp: 'exp',
  exp2: 'exp2',
  log: 'log',
  log2: 'log2',
  min: 'min',
  max: 'max',
  sign: 'sign',
  hypot: 'length',
};

// Built-in return-type inference (first-arg type or special)
const BUILTIN_RET = {
  length: 'f32',
  dot: 'f32',
  distance: 'f32',
  determinant: 'f32',
  normalize: (args, env) => env.inferType(args[0]),
  mix: (args, env) => env.inferType(args[0]),
  clamp: (args, env) => env.inferType(args[0]),
  select: (args, env) => env.inferType(args[0]),
  smoothstep: (args, env) => env.inferType(args[2]) ?? 'f32',
  step: (args, env) => env.inferType(args[1]) ?? 'f32',
  fract: (args, env) => env.inferType(args[0]),
  abs: (args, env) => env.inferType(args[0]),
  floor: (args, env) => env.inferType(args[0]),
  ceil: (args, env) => env.inferType(args[0]),
  round: (args, env) => env.inferType(args[0]),
  sqrt: (args, env) => env.inferType(args[0]),
  pow: (args, env) => env.inferType(args[0]),
  sin: (args, env) => env.inferType(args[0]),
  cos: (args, env) => env.inferType(args[0]),
  min: (args, env) => env.inferType(args[0]),
  max: (args, env) => env.inferType(args[0]),
  cross: () => 'vec3f',
};

// ── TypeEnv ───────────────────────────────────────────────────────────────────

class TypeEnv {
  constructor(parent = null) {
    this._v = new Map();
    this._f = new Map();
    this._parent = parent;
  }
  child() {
    return new TypeEnv(this);
  }
  set(n, t) {
    this._v.set(n, t);
  }
  setFn(n, sig) {
    this._f.set(n, sig);
  }
  get(n) {
    return this._v.has(n) ? this._v.get(n) : (this._parent?.get(n) ?? null);
  }
  getFn(n) {
    return this._f.has(n) ? this._f.get(n) : (this._parent?.getFn(n) ?? null);
  }

  inferType(node) {
    if (!node) return 'f32';
    switch (node.type) {
      case 'Literal': {
        if (typeof node.value === 'boolean') return 'bool';
        if (typeof node.value !== 'number') return 'f32';
        const hasDecimal =
          node.raw?.includes('.') || node.raw?.includes('e') || node.raw?.includes('E');
        return hasDecimal ? 'f32' : 'i32';
      }
      case 'Identifier': {
        if (node.name === 'true' || node.name === 'false') return 'bool';
        return this.get(node.name) ?? 'f32';
      }
      case 'MemberExpression': {
        if (node.computed) return 'f32';
        const ot = this.inferType(node.object);
        return SWIZZLE[ot]?.[node.property.name] ?? 'f32';
      }
      case 'BinaryExpression': {
        const lt = this.inferType(node.left);
        const rt = this.inferType(node.right);
        if (lt?.startsWith('vec')) return lt;
        if (rt?.startsWith('vec')) return rt;
        if (lt === 'f32' || rt === 'f32') return 'f32';
        return lt ?? rt ?? 'f32';
      }
      case 'UnaryExpression':
        return this.inferType(node.argument);
      case 'LogicalExpression':
        return 'bool';
      case 'ConditionalExpression':
        return this.inferType(node.consequent);
      case 'CallExpression': {
        const callee = node.callee;
        const args = node.arguments;
        // Math.*
        if (callee.type === 'MemberExpression' && callee.object.name === 'Math') {
          return this.inferType(args[0]) ?? 'f32';
        }
        // vec2/3/4
        if (callee.type === 'Identifier' && VEC_CTORS[callee.name]) return VEC_CTORS[callee.name];
        // built-ins
        if (callee.type === 'Identifier') {
          const ret = BUILTIN_RET[callee.name];
          if (ret) return typeof ret === 'function' ? (ret(args, this) ?? 'f32') : ret;
          // user-defined
          const sig = this.getFn(callee.name);
          if (sig) return sig.ret ?? 'f32';
        }
        return 'f32';
      }
      case 'ArrayExpression': {
        const n = node.elements.length;
        return n >= 4 ? 'vec4f' : n === 3 ? 'vec3f' : n === 2 ? 'vec2f' : 'f32';
      }
      case 'AssignmentExpression':
        return this.inferType(node.right);
      default:
        return 'f32';
    }
  }
}

// ── Expression emitter ────────────────────────────────────────────────────────

function emitExpr(node, env) {
  switch (node.type) {
    case 'Literal': {
      if (typeof node.value === 'boolean') return String(node.value);
      if (typeof node.value === 'number') {
        const s = String(node.value);
        const hasDecimal =
          node.raw?.includes('.') || node.raw?.includes('e') || node.raw?.includes('E');
        if (!hasDecimal && Number.isInteger(node.value)) return `${s}.0`;
        return s;
      }
      return JSON.stringify(node.value);
    }
    case 'Identifier':
      return node.name;
    case 'MemberExpression': {
      if (node.computed) return `${emitExpr(node.object, env)}[${emitExpr(node.property, env)}]`;
      // Math.PI etc
      if (node.object.name === 'Math') {
        const k = node.property.name;
        if (k === 'PI') return '3.141592653589793';
        if (k === 'E') return '2.718281828459045';
        if (k === 'LN2') return '0.6931471805599453';
      }
      return `${emitExpr(node.object, env)}.${node.property.name}`;
    }
    case 'BinaryExpression': {
      const op = node.operator;
      // WGSL: % works on i32; for f32 modulo use fract trick or just emit (user must manage)
      return `(${emitExpr(node.left, env)} ${op} ${emitExpr(node.right, env)})`;
    }
    case 'UnaryExpression':
      return `${node.operator}${emitExpr(node.argument, env)}`;
    case 'LogicalExpression':
      return `(${emitExpr(node.left, env)} ${node.operator} ${emitExpr(node.right, env)})`;
    case 'ConditionalExpression': {
      // JS: cond ? t : f   →  WGSL: select(f, t, cond)
      const c = emitExpr(node.test, env);
      const t = emitExpr(node.consequent, env);
      const f = emitExpr(node.alternate, env);
      return `select(${f}, ${t}, ${c})`;
    }
    case 'AssignmentExpression':
      return `${emitExpr(node.left, env)} ${node.operator} ${emitExpr(node.right, env)}`;
    case 'UpdateExpression': {
      // i++ → i += 1 (WGSL has no ++)
      const op = node.operator === '++' ? '+= 1' : '-= 1';
      return `${emitExpr(node.argument, env)} ${op}`;
    }
    case 'CallExpression': {
      const callee = node.callee;
      const args = node.arguments.map((a) => emitExpr(a, env));
      // Math.*
      if (callee.type === 'MemberExpression' && callee.object.name === 'Math') {
        const fn = callee.property.name;
        return `${MATH[fn] ?? fn}(${args.join(', ')})`;
      }
      // vec constructors
      if (callee.type === 'Identifier' && VEC_CTORS[callee.name]) {
        return `${VEC_CTORS[callee.name]}(${args.join(', ')})`;
      }
      // everything else: WGSL builtins + user fns
      const name = callee.type === 'Identifier' ? callee.name : emitExpr(callee, env);
      return `${name}(${args.join(', ')})`;
    }
    case 'ArrayExpression': {
      const args = node.elements.map((e) => emitExpr(e, env));
      const n = args.length;
      const ctor = n >= 4 ? 'vec4f' : n === 3 ? 'vec3f' : 'vec2f';
      return `${ctor}(${args.join(', ')})`;
    }
    default:
      return `/* unsupported expr: ${node.type} */`;
  }
}

// ── Statement emitter ─────────────────────────────────────────────────────────

function emitBlock(node, env, ind) {
  if (node.type === 'BlockStatement') {
    return node.body
      .map((s) => emitStmt(s, env, ind))
      .filter((s) => s != null)
      .join('\n');
  }
  return emitStmt(node, env, ind) ?? '';
}

function emitStmt(node, env, ind = '') {
  switch (node.type) {
    case 'VariableDeclaration': {
      return node.declarations
        .map((d) => {
          const type = d.init ? env.inferType(d.init) : 'f32';
          env.set(d.id.name, type);
          const init = d.init ? emitExpr(d.init, env) : _zeroOf(type);
          const kw = node.kind === 'let' ? 'var' : 'let';
          return `${ind}${kw} ${d.id.name}: ${type} = ${init};`;
        })
        .join('\n');
    }
    case 'ExpressionStatement': {
      const x = node.expression;
      // skip harness trace calls injected by live-patch (not valid WGSL)
      if (
        x.type === 'CallExpression' &&
        x.callee?.type === 'MemberExpression' &&
        x.callee.object?.name === 'window' &&
        String(x.callee.property?.name).startsWith('__ar')
      )
        return null;
      if (x.type === 'UpdateExpression') {
        const op = x.operator === '++' ? '+= 1' : '-= 1';
        return `${ind}${emitExpr(x.argument, env)} ${op};`;
      }
      return `${ind}${emitExpr(x, env)};`;
    }
    case 'ReturnStatement': {
      if (!node.argument) return `${ind}return;`;
      if (node.argument.type === 'ArrayExpression') {
        const a = node.argument.elements.map((e) => emitExpr(e, env));
        const n = a.length;
        const ctor = n >= 4 ? 'vec4f' : n === 3 ? 'vec3f' : 'vec2f';
        return `${ind}return ${ctor}(${a.join(', ')});`;
      }
      return `${ind}return ${emitExpr(node.argument, env)};`;
    }
    case 'IfStatement': {
      const cond = emitExpr(node.test, env);
      const tEnv = env.child();
      let s = `${ind}if (${cond}) {\n${emitBlock(node.consequent, tEnv, ind + '  ')}\n${ind}}`;
      if (node.alternate) {
        const eEnv = env.child();
        if (node.alternate.type === 'IfStatement') {
          s += ` else ${emitStmt(node.alternate, eEnv, ind).trimStart()}`;
        } else {
          s += ` else {\n${emitBlock(node.alternate, eEnv, ind + '  ')}\n${ind}}`;
        }
      }
      return s;
    }
    case 'ForStatement': {
      const lEnv = env.child();
      let init = '';
      if (node.init?.type === 'VariableDeclaration') {
        const d = node.init.declarations[0];
        const rawType = lEnv.inferType(d.init);
        // force loop counters to i32
        const type = rawType === 'f32' ? 'i32' : (rawType ?? 'i32');
        lEnv.set(d.id.name, type);
        init = `var ${d.id.name}: ${type} = ${emitExpr(d.init, lEnv)}`;
      } else if (node.init) {
        init = emitExpr(node.init, lEnv);
      }
      const test = node.test ? emitExpr(node.test, lEnv) : 'true';
      const update = node.update ? _emitUpdate(node.update, lEnv) : '';
      const body = emitBlock(node.body, lEnv, ind + '  ');
      return `${ind}for (${init}; ${test}; ${update}) {\n${body}\n${ind}}`;
    }
    case 'WhileStatement': {
      // WGSL has no while; use loop + break if
      const wEnv = env.child();
      const cond = emitExpr(node.test, wEnv);
      const body = emitBlock(node.body, wEnv, ind + '  ');
      return `${ind}loop {\n${ind}  if (!(${cond})) { break; }\n${body}\n${ind}}`;
    }
    case 'BlockStatement': {
      const bEnv = env.child();
      return node.body
        .map((s) => emitStmt(s, bEnv, ind))
        .filter((s) => s != null)
        .join('\n');
    }
    case 'FunctionDeclaration':
      return null; // helpers are hoisted separately
    default:
      return `${ind}/* unsupported: ${node.type} */`;
  }
}

function _emitUpdate(node, env) {
  if (node.type === 'UpdateExpression') {
    const op = node.operator === '++' ? '+= 1' : '-= 1';
    return `${emitExpr(node.argument, env)} ${op}`;
  }
  if (node.type === 'AssignmentExpression') return emitExpr(node, env);
  return emitExpr(node, env);
}

function _zeroOf(type) {
  if (type === 'f32') return '0.0';
  if (type === 'i32') return '0';
  if (type === 'bool') return 'false';
  if (type === 'vec2f') return 'vec2f(0.0, 0.0)';
  if (type === 'vec3f') return 'vec3f(0.0, 0.0, 0.0)';
  if (type === 'vec4f') return 'vec4f(0.0, 0.0, 0.0, 1.0)';
  return '0.0';
}

// ── Helper function emitter ───────────────────────────────────────────────────

function _paramType(param, env) {
  if (param.type === 'AssignmentPattern') return env.inferType(param.right);
  return 'f32';
}

function emitHelperFn(node, parentEnv) {
  const name = node.id?.name ?? '__helper';
  const fnEnv = parentEnv.child();

  const params = node.params.map((p) => {
    const pname = p.type === 'AssignmentPattern' ? p.left.name : p.name;
    const type = _paramType(p, parentEnv);
    fnEnv.set(pname, type);
    return { name: pname, type };
  });

  // Collect nested helpers first (recurse)
  const nested = [];
  for (const s of node.body.body) {
    if (s.type === 'FunctionDeclaration') nested.push(emitHelperFn(s, fnEnv));
  }

  const bodyLines = node.body.body
    .filter((s) => s.type !== 'FunctionDeclaration')
    .map((s) => emitStmt(s, fnEnv, '  '))
    .filter((s) => s != null)
    .join('\n');

  // Infer return type from first return statement
  let ret = 'f32';
  for (const s of node.body.body) {
    if (s.type === 'ReturnStatement' && s.argument) {
      if (s.argument.type === 'ArrayExpression') {
        const n = s.argument.elements.length;
        ret = n >= 4 ? 'vec4f' : n === 3 ? 'vec3f' : 'vec2f';
      } else {
        ret = fnEnv.inferType(s.argument);
      }
      break;
    }
  }

  parentEnv.setFn(name, { ret });

  const paramStr = params.map((p) => `${p.name}: ${p.type}`).join(', ');
  const fnWGSL = `fn ${name}(${paramStr}) -> ${ret} {\n${bodyLines}\n}`;
  return [...nested, fnWGSL].join('\n\n');
}

// ── Param extraction ──────────────────────────────────────────────────────────

// Known types for the fragment shader param object properties
const KNOWN_PARAMS = {
  uv: 'vec2f',
  time: 'f32',
  col: 'vec4f',
  custom: 'vec4f',
  res: 'vec2f',
  mouse: 'vec2f',
};

function extractParams(fnNode) {
  // Arrow: ({ uv, time }) => ...  OR  (uv, time) => ...
  const p0 = fnNode.params[0];
  if (!p0) return { names: new Set(), usesCol: false };

  if (p0.type === 'ObjectPattern') {
    const names = new Set(
      p0.properties.map((prop) => prop.key?.name ?? prop.value?.name).filter(Boolean),
    );
    return { names, usesCol: names.has('col') };
  }
  // Multiple positional params (uv, time, col, custom)
  const ordered = ['uv', 'time', 'col', 'custom', 'res', 'mouse'];
  const names = new Set(fnNode.params.slice(0, ordered.length).map((p, i) => ordered[i]));
  return { names, usesCol: names.has('col') };
}

// ── Main entry ────────────────────────────────────────────────────────────────

export function jsToWGSL(fn, { extraParams = {}, bind = {} } = {}) {
  const src = typeof fn === 'function' ? fn.toString() : String(fn);

  let ast;
  try {
    ast = esprima.parseScript(`const __fn = ${src}`, { tolerant: true, range: true });
  } catch (e) {
    throw new Error(`jsToWGSL parse error: ${e.message}\n  source: ${src.slice(0, 120)}`);
  }

  const fnNode = ast.body[0]?.declarations[0]?.init;
  if (!fnNode) throw new Error('jsToWGSL: could not locate function node');

  const { names: paramNames, usesCol } = extractParams(fnNode);

  // Build root type environment
  const env = new TypeEnv();
  for (const [k, t] of Object.entries(KNOWN_PARAMS)) {
    if (paramNames.size === 0 || paramNames.has(k)) env.set(k, t);
  }
  // Always seed all known params so callers don't have to destructure everything
  for (const [k, t] of Object.entries(KNOWN_PARAMS)) env.set(k, t);
  for (const [k, t] of Object.entries(extraParams)) env.set(k, t);
  // Bound aliases (e.g. viz: v = col.r) — scalars declared at the body top.
  for (const k of Object.keys(bind)) env.set(k, 'f32');

  // Normalise body to a statement list
  let stmts;
  if (fnNode.body?.type === 'BlockStatement') {
    stmts = fnNode.body.body;
  } else {
    // concise arrow body: () => expr
    stmts = [{ type: 'ReturnStatement', argument: fnNode.body }];
  }

  // Hoist helper function declarations
  const helpers = [];
  for (const s of stmts) {
    if (s.type === 'FunctionDeclaration') helpers.push(emitHelperFn(s, env));
  }

  // Emit main body (skip FunctionDeclarations — already hoisted)
  const userLines = stmts
    .filter((s) => s.type !== 'FunctionDeclaration')
    .map((s) => emitStmt(s, env, '  '))
    .filter((s) => s != null)
    .join('\n');

  // Prepend bound-alias declarations (caller maps a param name → a WGSL expr).
  const bindLines = Object.entries(bind)
    .map(([k, expr]) => `  let ${k} = ${expr};`)
    .join('\n');
  const bodyLines = bindLines ? `${bindLines}\n${userLines}` : userLines;

  // A bind expr may reference `col` (the video sample) even when the fn never
  // names a `col` param — surface that so the caller wires the video binding.
  const bindUsesCol = Object.values(bind).some((e) => /\bcol\b/.test(String(e)));

  return { body: bodyLines, helpers, usesCol: usesCol || bindUsesCol };
}
