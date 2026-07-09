import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  library,
  initLibrary,
  populateLibraryToolkit,
  resolveGLSL,
  resolveWGSL,
  defineGLSL,
  defineWGSL,
  defineSnippet,
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
