import { LIBRARY } from '../../runtime/storage-keys.js';

// ── User Library ──────────────────────────────────────────────────────────────
// Persistent cross-project store for named shader bodies and code snippets.
// Stored in localStorage['vl_library'].
//
// GLShader / Shader constructors auto-resolve registered names.
//
// Usage:
//   library.glsl('rainbow', `vec4 a = texture2D(uVideo, uv); ...`);
//   library.wgsl('plasma', ({ uv, time }) => { ... });
//   library.snippet('setup', `const cam = await Camera.open(); ...`);
//
//   new GLShader('rainbow').start();
//   pipe(cam).glshader('rainbow').show('out');
//   library.list()  // → [{type, name, preview}]

const STORAGE_KEY = LIBRARY;
const VERSION = 1;

// In-memory maps — populated by initLibrary() at boot
const _glsl = new Map(); // name → GLSL body string
const _wgsl = new Map(); // name → WGSL body string or arrow fn
const _snippets = new Map(); // name → arbitrary code string

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
    return out;
  },

  remove(type, name) {
    if (type === 'glsl') _glsl.delete(name);
    else if (type === 'wgsl') _wgsl.delete(name);
    else if (type === 'snippet') _snippets.delete(name);
    _persist();
    return library;
  },

  clear() {
    _glsl.clear();
    _wgsl.clear();
    _snippets.clear();
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
    _persist();
    populateLibraryToolkit();
    return library;
  },
};

// ── Test helper ───────────────────────────────────────────────────────────────

export function _resetForTesting() {
  _glsl.clear();
  _wgsl.clear();
  _snippets.clear();
}
