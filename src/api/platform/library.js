// ── User Library ──────────────────────────────────────────────────────────────
// Persistent cross-project store for named shader bodies, code snippets,
// and custom Blockly blocks. Stored in localStorage['vl_library'].
//
// GLShader / Shader constructors auto-resolve registered names.
// Custom blocks appear in the "My Library" blocks palette category.
//
// Usage:
//   library.glsl('rainbow', `vec4 a = texture2D(uVideo, uv); ...`);
//   library.wgsl('plasma', ({ uv, time }) => { ... });
//   library.snippet('setup', `const cam = await Camera.open(); ...`);
//   library.block('drawCircle', {
//     label: 'draw circle', colour: 200,
//     fields: [{ name:'X', type:'number', default:800 }, ...],
//     inputs: [{ name:'COLOR', label:'color' }],        // value socket
//     body:   'CODE',                                    // statement socket
//     returns: false,                                    // true = expression block
//     code: 'draw.circle({X}, {Y}, {R}, {COLOR|"#fff"});\n',
//   });
//
//   new GLShader('rainbow').start();
//   pipe(cam).glshader('rainbow').show('out');
//   library.list()  // → [{type, name, preview}]

const STORAGE_KEY = 'vl_library';
const VERSION = 1;

// In-memory maps — populated by initLibrary() at boot
const _glsl = new Map(); // name → GLSL body string
const _wgsl = new Map(); // name → WGSL body string or arrow fn
const _snippets = new Map(); // name → arbitrary code string
const _blocks = new Map(); // name → block descriptor (JSON-serializable)

// ── Block definition builder ──────────────────────────────────────────────────
//
// Descriptor shape:
//   label    — display name (default: name)
//   colour   — Blockly hue 0–360 (default: 270)
//   fields   — [{name, label?, type:'number'|'color'|'text'|'boolean', default}]
//              inline field inputs (numbers, colour pickers, text, checkboxes)
//   inputs   — [{name, label?}]  value sockets — plug in expression blocks
//              use {NAME} or {NAME|fallback} in code template
//   body     — string (input name) for a statement socket — use {NAME} in template
//   returns  — false (statement block) | true (expression block, plugs into sockets)
//   code     — template string. {FIELD_NAME} → field value, {INPUT|fallback} → wired
//              block code or fallback, {BODY_NAME} → inner statement block code

function _fieldArg(f) {
  switch (f.type) {
    case 'number':
      return { type: 'field_number', name: f.name, value: f.default ?? 0 };
    case 'color':
    case 'colour':
      return { type: 'field_colour', name: f.name, colour: f.default ?? '#ffffff' };
    case 'boolean':
      return { type: 'field_checkbox', name: f.name, checked: f.default ?? false };
    default:
      return { type: 'field_input', name: f.name, text: String(f.default ?? '') };
  }
}

export function _buildBlockDef(name, descriptor) {
  const { label = name, colour = 270, fields = [], inputs = [], body, returns } = descriptor;

  const args0 = [];
  const parts = [label];
  let idx = 1;

  for (const f of fields) {
    parts.push(`${f.label ?? f.name} %${idx++}`);
    args0.push(_fieldArg(f));
  }

  for (const inp of inputs) {
    parts.push(`${inp.label ?? inp.name} %${idx++}`);
    args0.push({ type: 'input_value', name: inp.name, check: null });
  }

  if (body) {
    parts.push(`do %${idx++}`);
    args0.push({ type: 'input_statement', name: body });
  }

  const def = {
    type: `user_${name}`,
    message0: parts.join(' '),
    args0,
    colour,
    tooltip: label,
  };

  if (returns) {
    def.output = null;
  } else {
    def.previousStatement = null;
    def.nextStatement = null;
  }

  return def;
}

export function _buildGenerator(descriptor) {
  const { fields = [], inputs = [], body, returns, code: template = '' } = descriptor;

  return (block, gen) => {
    let code = template;

    // {FIELD_NAME} → field value (numbers unquoted, others JSON-stringified)
    for (const f of fields) {
      const v = block.getFieldValue(f.name);
      const val = f.type === 'number' ? String(v) : JSON.stringify(v);
      code = code.replace(new RegExp(`\\{${f.name}\\}`, 'g'), val);
    }

    // {INPUT} or {INPUT|fallback} → connected block code or fallback
    for (const inp of inputs) {
      const connected = gen?.valueToCode?.(block, inp.name, 0) ?? '';
      code = code.replace(
        new RegExp(`\\{${inp.name}(?:\\|([^}]*))?\\}`, 'g'),
        (_, fallback) => connected || (fallback ?? 'null'),
      );
    }

    // {BODY_NAME} → indented inner statement code
    if (body) {
      const inner = gen?.statementToCode?.(block, body) ?? '';
      code = code.replace(new RegExp(`\\{${body}\\}`, 'g'), inner);
    }

    return returns ? [code, 0] : code; // 0 = Order.NONE (safest default)
  };
}

// ── Persistence ───────────────────────────────────────────────────────────────

function _persist() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: VERSION,
        glsl: Object.fromEntries(_glsl),
        wgsl: Object.fromEntries(_wgsl),
        snippets: Object.fromEntries(_snippets),
        blocks: Object.fromEntries(_blocks),
      }),
    );
  } catch (e) {
    console.warn('vl_library: localStorage write failed', e);
  }
}

// ── Boot ──────────────────────────────────────────────────────────────────────

export function initLibrary() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (data.glsl) Object.entries(data.glsl).forEach(([k, v]) => _glsl.set(k, v));
    if (data.wgsl) Object.entries(data.wgsl).forEach(([k, v]) => _wgsl.set(k, v));
    if (data.snippets) Object.entries(data.snippets).forEach(([k, v]) => _snippets.set(k, v));
    if (data.blocks) Object.entries(data.blocks).forEach(([k, v]) => _blocks.set(k, v));
  } catch (e) {
    console.warn('vl_library: localStorage read failed', e);
  }
}

// Inject GLSL/WGSL/snippet entries into all open toolkit text panels.
// Call after window.__ar_addToolkitEntry is available.
export function populateLibraryToolkit() {
  _glsl.forEach((_, name) => window.__ar_addToolkitEntry?.('My Library', _glslCmd(name)));
  _wgsl.forEach((_, name) => window.__ar_addToolkitEntry?.('My Library', _wgslCmd(name)));
  _snippets.forEach((code, name) =>
    window.__ar_addToolkitEntry?.('My Library', _snippetCmd(name, code)),
  );
  _blocks.forEach((desc, name) =>
    window.__ar_addToolkitEntry?.('My Library', _blockCmd(name, desc)),
  );
}

// Register stored custom blocks with Blockly + add to palette.
// Call after window.__ar_applyLibraryBlock is available.
export function populateLibraryBlocks() {
  _blocks.forEach((descriptor, name) => {
    const definition = _buildBlockDef(name, descriptor);
    const generator = _buildGenerator(descriptor);
    window.__ar_applyLibraryBlock?.(definition, generator);
  });
}

// ── Name resolution (used by GLShader / Shader constructors) ──────────────────

export function resolveGLSL(nameOrBody) {
  if (typeof nameOrBody === 'string' && _glsl.has(nameOrBody)) return _glsl.get(nameOrBody);
  return nameOrBody;
}

export function resolveWGSL(nameOrBody) {
  if (typeof nameOrBody === 'string' && _wgsl.has(nameOrBody)) return _wgsl.get(nameOrBody);
  return nameOrBody;
}

// ── Low-level define ──────────────────────────────────────────────────────────

export function defineGLSL(name, body) {
  _glsl.set(name, body);
  _persist();
  window.__ar_addToolkitEntry?.('My Library', _glslCmd(name));
}

export function defineWGSL(name, body) {
  _wgsl.set(name, body);
  _persist();
  window.__ar_addToolkitEntry?.('My Library', _wgslCmd(name));
}

export function defineSnippet(name, code) {
  _snippets.set(name, code);
  _persist();
  window.__ar_addToolkitEntry?.('My Library', _snippetCmd(name, code));
}

// ── Toolkit command builders ──────────────────────────────────────────────────

function _glslCmd(name) {
  return {
    label: name,
    hint: `Saved GLSL shader "${name}" — use by name in GLShader or pipeline`,
    code: `new GLShader('${name}').start();\n// or: pipe(cam).glshader('${name}').show('${name}', { w: 700, h: 500 });`,
    tags: ['library', 'glsl', 'shader', name],
  };
}

function _wgslCmd(name) {
  return {
    label: name,
    hint: `Saved WGSL shader "${name}" — use by name in Shader or pipeline`,
    code: `new Shader('${name}').start();\n// or: pipe(cam).shader('${name}').show('${name}', { w: 700, h: 500 });`,
    tags: ['library', 'wgsl', 'shader', name],
  };
}

function _snippetCmd(name, code) {
  return {
    label: name,
    hint: `Saved snippet "${name}"`,
    code,
    tags: ['library', 'snippet', name],
  };
}

function _blockCmd(name, descriptor) {
  return {
    label: `[block] ${descriptor.label ?? name}`,
    hint: `Custom block "${descriptor.label ?? name}" — available in My Library blocks palette`,
    code: descriptor.code ?? `// block: ${name}`,
    tags: ['library', 'block', name],
  };
}

// ── Public library object (window.library) ────────────────────────────────────

export const library = {
  // GLSL body — persists across projects, resolves by name in new GLShader('name')
  glsl(name, body) {
    defineGLSL(name, body);
    return library;
  },

  // WGSL body or JS arrow fn — resolves by name in new Shader('name')
  wgsl(name, body) {
    defineWGSL(name, body);
    return library;
  },

  // Arbitrary code snippet — draggable text-mode entry
  snippet(name, code) {
    defineSnippet(name, code);
    return library;
  },

  // Custom Blockly block — appears in My Library blocks palette.
  //
  // descriptor.fields  — [{name, label?, type, default}] inline field inputs
  // descriptor.inputs  — [{name, label?}] value sockets; use {NAME|fallback} in code
  // descriptor.body    — string: statement socket name; use {NAME} in code
  // descriptor.returns — true for expression block (output socket), false for statement
  // descriptor.code    — template string, {FIELD} / {INPUT|fallback} / {BODY} interpolated
  //
  // Example:
  //   library.block('colorCircle', {
  //     label:  'color circle',
  //     colour: 200,
  //     fields: [{ name:'X', type:'number', default:800 }, { name:'Y', type:'number', default:450 }, { name:'R', type:'number', default:50 }],
  //     inputs: [{ name:'COLOR', label:'color' }],
  //     code:   'draw.circle({X}, {Y}, {R}, {COLOR|"#ffffff"});\n',
  //   });
  block(name, descriptor) {
    _blocks.set(name, descriptor);
    _persist();
    const definition = _buildBlockDef(name, descriptor);
    const generator = _buildGenerator(descriptor);
    window.__ar_applyLibraryBlock?.(definition, generator);
    window.__ar_addToolkitEntry?.('My Library', _blockCmd(name, descriptor));
    return library;
  },

  list() {
    const out = [];
    _glsl.forEach((body, name) =>
      out.push({ type: 'glsl', name, preview: body.slice(0, 80).trim() }),
    );
    _wgsl.forEach((body, name) =>
      out.push({
        type: 'wgsl',
        name,
        preview: (typeof body === 'string' ? body : body.toString()).slice(0, 80).trim(),
      }),
    );
    _snippets.forEach((code, name) =>
      out.push({ type: 'snippet', name, preview: code.slice(0, 80).trim() }),
    );
    _blocks.forEach((desc, name) =>
      out.push({ type: 'block', name, preview: (desc.code ?? '').slice(0, 80).trim() }),
    );
    return out;
  },

  remove(type, name) {
    if (type === 'glsl') _glsl.delete(name);
    else if (type === 'wgsl') _wgsl.delete(name);
    else if (type === 'snippet') _snippets.delete(name);
    else if (type === 'block') _blocks.delete(name);
    _persist();
    return library;
  },

  clear() {
    _glsl.clear();
    _wgsl.clear();
    _snippets.clear();
    _blocks.clear();
    _persist();
    return library;
  },

  export() {
    return JSON.stringify(
      {
        version: VERSION,
        glsl: Object.fromEntries(_glsl),
        wgsl: Object.fromEntries(_wgsl),
        snippets: Object.fromEntries(_snippets),
        blocks: Object.fromEntries(_blocks),
      },
      null,
      2,
    );
  },

  import(jsonOrObj) {
    const data = typeof jsonOrObj === 'string' ? JSON.parse(jsonOrObj) : jsonOrObj;
    if (data.glsl) Object.entries(data.glsl).forEach(([k, v]) => _glsl.set(k, v));
    if (data.wgsl) Object.entries(data.wgsl).forEach(([k, v]) => _wgsl.set(k, v));
    if (data.snippets) Object.entries(data.snippets).forEach(([k, v]) => _snippets.set(k, v));
    if (data.blocks) Object.entries(data.blocks).forEach(([k, v]) => _blocks.set(k, v));
    _persist();
    populateLibraryToolkit();
    populateLibraryBlocks();
    return library;
  },
};

// ── Test helper ───────────────────────────────────────────────────────────────

export function _resetForTesting() {
  _glsl.clear();
  _wgsl.clear();
  _snippets.clear();
  _blocks.clear();
}
