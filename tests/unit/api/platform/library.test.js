import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  library,
  initLibrary,
  populateLibraryToolkit,
  populateLibraryBlocks,
  resolveGLSL,
  resolveWGSL,
  defineGLSL,
  defineWGSL,
  defineSnippet,
  _buildBlockDef,
  _buildGenerator,
  _resetForTesting,
} from '../../../../src/api/platform/library.js';

// ── localStorage stub ─────────────────────────────────────────────────────────
// jsdom's built-in localStorage is unreliable in this env (--localstorage-file warning).
// Override it unconditionally so get/set/removeItem work correctly.

const _lsStore = {};
const _mockLS = {
  getItem: (k) => (Object.prototype.hasOwnProperty.call(_lsStore, k) ? _lsStore[k] : null),
  setItem: (k, v) => {
    _lsStore[k] = String(v);
  },
  removeItem: (k) => {
    delete _lsStore[k];
  },
  clear: () => {
    Object.keys(_lsStore).forEach((k) => delete _lsStore[k]);
  },
};
Object.defineProperty(global, 'localStorage', {
  value: _mockLS,
  writable: true,
  configurable: true,
});

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  Object.keys(_lsStore).forEach((k) => delete _lsStore[k]);
  _resetForTesting();
  delete global.window.__ar_addToolkitEntry;
});

afterEach(() => {
  Object.keys(_lsStore).forEach((k) => delete _lsStore[k]);
  _resetForTesting();
  delete global.window.__ar_addToolkitEntry;
});

// ── initLibrary ───────────────────────────────────────────────────────────────

describe('initLibrary()', () => {
  it('loads glsl entries from localStorage into memory', () => {
    localStorage.setItem(
      'vl_library',
      JSON.stringify({
        version: 1,
        glsl: { rainbow: 'vec4 c = vec4(1.0);' },
        wgsl: {},
        snippets: {},
      }),
    );
    initLibrary();
    expect(resolveGLSL('rainbow')).toBe('vec4 c = vec4(1.0);');
  });

  it('loads wgsl entries', () => {
    localStorage.setItem(
      'vl_library',
      JSON.stringify({
        version: 1,
        glsl: {},
        wgsl: { plasma: 'fn plasma() {}' },
        snippets: {},
      }),
    );
    initLibrary();
    expect(resolveWGSL('plasma')).toBe('fn plasma() {}');
  });

  it('loads snippets', () => {
    localStorage.setItem(
      'vl_library',
      JSON.stringify({
        version: 1,
        glsl: {},
        wgsl: {},
        snippets: { setup: 'const cam = await Camera.open();' },
      }),
    );
    initLibrary();
    expect(library.list().find((e) => e.name === 'setup')?.type).toBe('snippet');
  });

  it('handles missing key gracefully', () => {
    expect(() => initLibrary()).not.toThrow();
  });

  it('handles malformed JSON gracefully', () => {
    localStorage.setItem('vl_library', 'not json');
    expect(() => initLibrary()).not.toThrow();
  });
});

// ── resolveGLSL / resolveWGSL ─────────────────────────────────────────────────

describe('resolveGLSL()', () => {
  it('returns body string unchanged when not in registry', () => {
    const body = 'gl_FragColor = vec4(1.0);';
    expect(resolveGLSL(body)).toBe(body);
  });

  it('resolves registered name to body', () => {
    defineGLSL('wave', 'gl_FragColor = vec4(sin(uTime),0.,0.,1.);');
    expect(resolveGLSL('wave')).toBe('gl_FragColor = vec4(sin(uTime),0.,0.,1.);');
  });

  it('passes non-string through unchanged', () => {
    const fn = () => {};
    expect(resolveGLSL(fn)).toBe(fn);
  });
});

describe('resolveWGSL()', () => {
  it('returns string unchanged when not in registry', () => {
    const body = '@fragment fn f() {}';
    expect(resolveWGSL(body)).toBe(body);
  });

  it('resolves registered name', () => {
    defineWGSL('plasma', 'let c = vec4f(1.0);');
    expect(resolveWGSL('plasma')).toBe('let c = vec4f(1.0);');
  });
});

// ── defineGLSL / defineWGSL / defineSnippet ───────────────────────────────────

describe('defineGLSL()', () => {
  it('makes name resolvable', () => {
    defineGLSL('test', 'gl_FragColor = vec4(0.,1.,0.,1.);');
    expect(resolveGLSL('test')).toBe('gl_FragColor = vec4(0.,1.,0.,1.);');
  });

  it('persists to localStorage', () => {
    defineGLSL('test', 'body');
    const stored = JSON.parse(localStorage.getItem('vl_library'));
    expect(stored.glsl.test).toBe('body');
  });

  it('calls __ar_addToolkitEntry when available', () => {
    const spy = vi.fn();
    global.window.__ar_addToolkitEntry = spy;
    defineGLSL('test', 'body');
    expect(spy).toHaveBeenCalledWith('My Library', expect.objectContaining({ label: 'test' }));
  });
});

describe('defineSnippet()', () => {
  it('stores snippet and persists', () => {
    defineSnippet('mySetup', 'const cam = await Camera.open();');
    const stored = JSON.parse(localStorage.getItem('vl_library'));
    expect(stored.snippets.mySetup).toBe('const cam = await Camera.open();');
  });
});

// ── library object ────────────────────────────────────────────────────────────

describe('library.glsl()', () => {
  it('returns library for chaining', () => {
    expect(library.glsl('a', 'body')).toBe(library);
  });

  it('saves and resolves', () => {
    library.glsl('rainbow', 'gl_FragColor = vec4(1.,0.,0.,1.);');
    expect(resolveGLSL('rainbow')).toBe('gl_FragColor = vec4(1.,0.,0.,1.);');
  });
});

describe('library.wgsl()', () => {
  it('saves and resolves', () => {
    library.wgsl('myPlasma', 'let c = vec4f(0.5);');
    expect(resolveWGSL('myPlasma')).toBe('let c = vec4f(0.5);');
  });
});

describe('library.snippet()', () => {
  it('appears in list()', () => {
    library.snippet('startup', 'audio.bpm(130); audio.start();');
    const entry = library.list().find((e) => e.name === 'startup');
    expect(entry?.type).toBe('snippet');
    expect(entry?.preview).toContain('audio');
  });
});

describe('library.list()', () => {
  it('returns all registered entries', () => {
    library.glsl('a', 'body a');
    library.wgsl('b', 'body b');
    library.snippet('c', 'code c');
    const list = library.list();
    expect(list).toHaveLength(3);
    expect(list.map((e) => e.name)).toEqual(expect.arrayContaining(['a', 'b', 'c']));
  });

  it('includes type field', () => {
    library.glsl('x', 'y');
    expect(library.list()[0].type).toBe('glsl');
  });
});

describe('library.remove()', () => {
  it('removes entry and persists', () => {
    library.glsl('del', 'body');
    library.remove('glsl', 'del');
    expect(resolveGLSL('del')).toBe('del'); // passthrough — not in registry
    const stored = JSON.parse(localStorage.getItem('vl_library'));
    expect(stored.glsl.del).toBeUndefined();
  });

  it('returns library for chaining', () => {
    expect(library.remove('glsl', 'nonexistent')).toBe(library);
  });
});

describe('library.clear()', () => {
  it('removes all entries', () => {
    library.glsl('a', 'x').wgsl('b', 'y').snippet('c', 'z');
    library.clear();
    expect(library.list()).toHaveLength(0);
  });

  it('clears localStorage', () => {
    library.glsl('a', 'x');
    library.clear();
    const stored = JSON.parse(localStorage.getItem('vl_library'));
    expect(Object.keys(stored.glsl)).toHaveLength(0);
  });
});

describe('library.export() / library.import()', () => {
  it('round-trips all entry types', () => {
    library.glsl('r', 'rainbow body').wgsl('p', 'plasma body').snippet('s', 'code');
    const json = library.export();

    _resetForTesting();
    library.import(json);

    expect(resolveGLSL('r')).toBe('rainbow body');
    expect(resolveWGSL('p')).toBe('plasma body');
    expect(library.list().find((e) => e.name === 's')?.type).toBe('snippet');
  });

  it('export() is valid JSON', () => {
    library.glsl('test', 'body');
    expect(() => JSON.parse(library.export())).not.toThrow();
  });

  it('import() accepts parsed object (not just string)', () => {
    const data = { version: 1, glsl: { obj: 'body' }, wgsl: {}, snippets: {} };
    library.import(data);
    expect(resolveGLSL('obj')).toBe('body');
  });

  it('import() merges (does not overwrite existing entries)', () => {
    library.glsl('existing', 'old body');
    library.import({ version: 1, glsl: { new: 'new body' }, wgsl: {}, snippets: {} });
    expect(resolveGLSL('existing')).toBe('old body');
    expect(resolveGLSL('new')).toBe('new body');
  });
});

// ── populateLibraryToolkit ────────────────────────────────────────────────────

describe('populateLibraryToolkit()', () => {
  it('injects all entries via __ar_addToolkitEntry', () => {
    library.glsl('a', 'body a').wgsl('b', 'body b').snippet('c', 'code c');
    const spy = vi.fn();
    global.window.__ar_addToolkitEntry = spy;
    populateLibraryToolkit();
    expect(spy).toHaveBeenCalledTimes(3);
    const categories = spy.mock.calls.map(([cat]) => cat);
    expect(categories.every((c) => c === 'My Library')).toBe(true);
  });

  it('is a no-op when __ar_addToolkitEntry not available', () => {
    library.glsl('a', 'x');
    expect(() => populateLibraryToolkit()).not.toThrow();
  });
});

// ── _buildBlockDef ────────────────────────────────────────────────────────────

describe('_buildBlockDef()', () => {
  it('produces correct type name', () => {
    const def = _buildBlockDef('myBlock', { label: 'my block' });
    expect(def.type).toBe('user_myBlock');
  });

  it('statement block has previousStatement/nextStatement', () => {
    const def = _buildBlockDef('s', { returns: false });
    expect(def.previousStatement).toBeNull();
    expect(def.nextStatement).toBeNull();
    expect(def.output).toBeUndefined();
  });

  it('expression block has output instead', () => {
    const def = _buildBlockDef('e', { returns: true });
    expect(def.output).toBeNull();
    expect(def.previousStatement).toBeUndefined();
  });

  it('includes field args for each descriptor field', () => {
    const def = _buildBlockDef('f', {
      fields: [
        { name: 'X', type: 'number', default: 10 },
        { name: 'COLOR', type: 'color', default: '#f00' },
      ],
    });
    expect(def.args0[0]).toMatchObject({ type: 'field_number', name: 'X', value: 10 });
    expect(def.args0[1]).toMatchObject({ type: 'field_colour', name: 'COLOR', colour: '#f00' });
  });

  it('includes input_value for value sockets', () => {
    const def = _buildBlockDef('v', { inputs: [{ name: 'SRC', label: 'source' }] });
    const inp = def.args0.find((a) => a.name === 'SRC');
    expect(inp?.type).toBe('input_value');
  });

  it('includes input_statement for body', () => {
    const def = _buildBlockDef('b', { body: 'CODE' });
    const inp = def.args0.find((a) => a.name === 'CODE');
    expect(inp?.type).toBe('input_statement');
  });

  it('message0 contains label and %N placeholders', () => {
    const def = _buildBlockDef('msg', {
      label: 'test block',
      fields: [{ name: 'X', type: 'number', default: 0 }],
    });
    expect(def.message0).toContain('test block');
    expect(def.message0).toContain('%1');
  });
});

// ── _buildGenerator ───────────────────────────────────────────────────────────

describe('_buildGenerator()', () => {
  it('substitutes number field values unquoted', () => {
    const gen = _buildGenerator({
      fields: [{ name: 'X', type: 'number' }],
      code: 'draw.circle({X}, 450, 50);\n',
    });
    const block = { getFieldValue: (n) => (n === 'X' ? '800' : '') };
    expect(gen(block, null)).toBe('draw.circle(800, 450, 50);\n');
  });

  it('substitutes string/color fields JSON-stringified', () => {
    const gen = _buildGenerator({
      fields: [{ name: 'COLOR', type: 'color' }],
      code: 'draw.bg({COLOR});\n',
    });
    const block = { getFieldValue: () => '#ff0000' };
    expect(gen(block, null)).toContain('"#ff0000"');
  });

  it('substitutes connected value input', () => {
    const gen = _buildGenerator({
      inputs: [{ name: 'SRC' }],
      code: 'pipe({SRC}).show();\n',
    });
    const block = { getFieldValue: () => '' };
    const mockGen = { valueToCode: vi.fn().mockReturnValue('myCam') };
    expect(gen(block, mockGen)).toContain('myCam');
  });

  it('uses fallback when value input not connected', () => {
    const gen = _buildGenerator({
      inputs: [{ name: 'COLOR' }],
      code: 'draw.bg({COLOR|"#000"});\n',
    });
    const block = { getFieldValue: () => '' };
    const mockGen = { valueToCode: vi.fn().mockReturnValue('') };
    expect(gen(block, mockGen)).toContain('"#000"');
  });

  it('substitutes statement body input', () => {
    const gen = _buildGenerator({
      body: 'CODE',
      code: 'setInterval(() => {\n{CODE}}, 16);\n',
    });
    const block = { getFieldValue: () => '' };
    const mockGen = { statementToCode: vi.fn().mockReturnValue('  draw.clear();\n') };
    const result = gen(block, mockGen);
    expect(result).toContain('draw.clear()');
  });

  it('returns [code, 0] tuple for expression blocks', () => {
    const gen = _buildGenerator({ returns: true, code: 'audio.fft.bass' });
    const result = gen({ getFieldValue: () => '' }, null);
    expect(Array.isArray(result)).toBe(true);
    expect(result[0]).toBe('audio.fft.bass');
    expect(result[1]).toBe(0);
  });

  it('returns string for statement blocks', () => {
    const gen = _buildGenerator({ returns: false, code: 'draw.clear();\n' });
    const result = gen({ getFieldValue: () => '' }, null);
    expect(typeof result).toBe('string');
  });
});

// ── library.block() ───────────────────────────────────────────────────────────

describe('library.block()', () => {
  it('returns library for chaining', () => {
    expect(library.block('test', { code: 'x;\n' })).toBe(library);
  });

  it('appears in list() as type block', () => {
    library.block('myBlock', { label: 'my block', code: 'x;\n' });
    expect(library.list().find((e) => e.name === 'myBlock')?.type).toBe('block');
  });

  it('persists to localStorage', () => {
    library.block('persist', { label: 'p', code: 'x;\n' });
    const stored = JSON.parse(localStorage.getItem('vl_library'));
    expect(stored.blocks.persist).toBeDefined();
  });

  it('calls __ar_applyLibraryBlock with definition and generator', () => {
    const spy = vi.fn();
    global.window.__ar_applyLibraryBlock = spy;
    library.block('wired', { label: 'wired', code: 'x;\n' });
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'user_wired' }),
      expect.any(Function),
    );
    delete global.window.__ar_applyLibraryBlock;
  });

  it('round-trips through export/import', () => {
    library.block('roundtrip', { label: 'rt', colour: 42, code: 'rt();\n' });
    const json = library.export();
    _resetForTesting();
    library.import(json);
    const entry = library.list().find((e) => e.name === 'roundtrip');
    expect(entry?.type).toBe('block');
  });
});

// ── library.remove block ──────────────────────────────────────────────────────

describe('library.remove() block', () => {
  it('removes block entry', () => {
    library.block('toRemove', { code: 'x;\n' });
    library.remove('block', 'toRemove');
    expect(library.list().find((e) => e.name === 'toRemove')).toBeUndefined();
  });
});

// ── populateLibraryBlocks ─────────────────────────────────────────────────────

describe('populateLibraryBlocks()', () => {
  it('calls __ar_applyLibraryBlock for each stored block', () => {
    library.block('a', { code: 'a();\n' });
    library.block('b', { code: 'b();\n' });
    const spy = vi.fn();
    global.window.__ar_applyLibraryBlock = spy;
    populateLibraryBlocks();
    expect(spy).toHaveBeenCalledTimes(2);
    delete global.window.__ar_applyLibraryBlock;
  });

  it('is a no-op when __ar_applyLibraryBlock not available', () => {
    library.block('safe', { code: 'x;\n' });
    expect(() => populateLibraryBlocks()).not.toThrow();
  });
});

// ── initLibrary loads blocks ──────────────────────────────────────────────────

describe('initLibrary() with blocks', () => {
  it('loads block descriptors from localStorage', () => {
    localStorage.setItem(
      'vl_library',
      JSON.stringify({
        version: 1,
        glsl: {},
        wgsl: {},
        snippets: {},
        blocks: { saved: { label: 'saved', code: 'saved();\n' } },
      }),
    );
    initLibrary();
    expect(library.list().find((e) => e.name === 'saved')?.type).toBe('block');
  });
});
