import { describe, it, expect, afterEach } from 'vitest';
import {
  registerNativeCapability,
  unregisterNativeCapability,
  nativeCap,
  hasNative,
} from '../../../src/runtime/native.js';
import {
  makeNativeDirHandle,
  makeNativeFileHandle,
} from '../../../src/api/wm/native-fs-adapter.js';

// The registry is the single jsdom-mockable seam (ADR 049/050): under vitest there is no
// preload bridge, so nativeCap returns null and call sites fall back to browser paths.

describe('native capability registry', () => {
  afterEach(() => {
    ['pickDirectory', 'pickFile', 'listDir', 'readFile'].forEach(unregisterNativeCapability);
    delete window.__createos_native;
  });

  it('returns null for an unregistered capability (browser build)', () => {
    expect(nativeCap('pickDirectory')).toBe(null);
    expect(hasNative()).toBe(false);
  });

  it('resolves a programmatically registered capability', () => {
    const fn = () => 'ok';
    registerNativeCapability('pickDirectory', fn);
    expect(nativeCap('pickDirectory')).toBe(fn);
    expect(hasNative()).toBe(true);
  });

  it('falls back to the preload bridge when no registry entry exists', () => {
    window.__createos_native = { listDir: () => ['x'] };
    expect(typeof nativeCap('listDir')).toBe('function');
    expect(hasNative()).toBe(true);
    // registry entry wins over the bridge
    const override = () => 'override';
    registerNativeCapability('listDir', override);
    expect(nativeCap('listDir')).toBe(override);
  });
});

describe('handle-shaped native fs adapter', () => {
  afterEach(() => {
    ['listDir', 'readFile'].forEach(unregisterNativeCapability);
  });

  it('directory adapter iterates entries via listDir, wrapping each by kind', async () => {
    registerNativeCapability('listDir', async (path) => {
      expect(path).toBe('/root');
      return [
        { name: 'sub', path: '/root/sub', kind: 'directory' },
        { name: 'a.png', path: '/root/a.png', kind: 'file' },
      ];
    });
    const dir = makeNativeDirHandle('/root', 'root');
    expect(dir.kind).toBe('directory');
    expect(await dir.queryPermission()).toBe('granted');

    const entries = [];
    for await (const e of dir.values()) entries.push(e);
    expect(entries.map((e) => [e.name, e.kind])).toEqual([
      ['sub', 'directory'],
      ['a.png', 'file'],
    ]);
  });

  it('file adapter reads bytes via readFile and builds a File with inferred mime', async () => {
    registerNativeCapability('readFile', async (path) => {
      expect(path).toBe('/root/a.png');
      return { bytes: new Uint8Array([1, 2, 3]), type: null };
    });
    const fh = makeNativeFileHandle('/root/a.png', 'a.png');
    const file = await fh.getFile();
    expect(file.name).toBe('a.png');
    expect(file.type).toBe('image/png');
    expect(file.size).toBe(3);
  });
});
