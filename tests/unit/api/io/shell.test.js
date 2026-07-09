import { describe, it, expect, afterEach, vi } from 'vitest';
import { shell } from '../../../../src/api/io/shell.js';
import {
  registerNativeCapability,
  unregisterNativeCapability,
} from '../../../../src/runtime/native.js';

afterEach(() => {
  vi.restoreAllMocks();
  unregisterNativeCapability('pickFile');
  unregisterNativeCapability('saveFile');
  document.title = '';
});

describe('shell environment detection', () => {
  it('isBrowser is true in jsdom (no native bridge)', () => {
    expect(shell.isBrowser).toBe(true);
  });

  it('isDesktop is false in jsdom', () => {
    expect(shell.isDesktop).toBe(false);
  });

  it('isElectron is false in jsdom', () => {
    expect(shell.isElectron).toBe(false);
  });

  it('isTauri is always false (Tauri never built, ADR 048)', () => {
    expect(shell.isTauri).toBe(false);
  });

  it('isDesktop/isElectron flip true once a native cap is registered', () => {
    registerNativeCapability('pickFile', vi.fn());
    expect(shell.isDesktop).toBe(true);
    expect(shell.isElectron).toBe(true);
    expect(shell.isBrowser).toBe(false);
    unregisterNativeCapability('pickFile');
    expect(shell.isDesktop).toBe(false);
  });
});

describe('shell.status / clearStatus', () => {
  it('returns shell for chaining in browser', () => {
    expect(shell.status('test')).toBe(shell);
    expect(shell.clearStatus()).toBe(shell);
  });
});

describe('shell.setTitle', () => {
  it('falls back to document.title in browser', () => {
    shell.setTitle('My IDE');
    expect(document.title).toBe('My IDE');
  });

  it('returns shell for chaining', () => {
    expect(shell.setTitle('x')).toBe(shell);
  });
});

describe('shell.fullscreen', () => {
  it('calls requestFullscreen on documentElement in browser', () => {
    const spy = vi.fn().mockResolvedValue(undefined);
    document.documentElement.requestFullscreen = spy;
    shell.fullscreen(true);
    expect(spy).toHaveBeenCalled();
  });

  it('calls exitFullscreen on document in browser when off', () => {
    const spy = vi.fn().mockResolvedValue(undefined);
    document.exitFullscreen = spy;
    shell.fullscreen(false);
    expect(spy).toHaveBeenCalled();
  });
});

describe('shell.saveFile', () => {
  it('triggers browser download in static-site mode', async () => {
    const a = { href: '', download: '', click: vi.fn(), style: {} };
    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag) => {
      if (tag === 'a') return a;
      return origCreate(tag);
    });
    global.URL.createObjectURL = vi.fn(() => 'blob:test');

    const result = await shell.saveFile(new ArrayBuffer(4), { defaultPath: 'out.png' });
    expect(result).toBeNull();
    expect(a.click).toHaveBeenCalled();
    expect(a.download).toBe('out.png');
  });

  it('routes through nativeCap("saveFile") when a native bridge exists', async () => {
    const save = vi.fn().mockResolvedValue({ path: '/tmp/out.png', name: 'out.png' });
    registerNativeCapability('saveFile', save);
    const data = new ArrayBuffer(4);
    const result = await shell.saveFile(data, { defaultPath: 'out.png' });
    expect(save).toHaveBeenCalledWith({ defaultPath: 'out.png', data });
    expect(result).toEqual({ path: '/tmp/out.png', name: 'out.png' });
  });
});

describe('shell.invoke', () => {
  it('resolves null in browser mode', async () => {
    const result = await shell.invoke('my_command', { foo: 1 });
    expect(result).toBeNull();
  });
});

describe('shell.openFile', () => {
  it('returns null in browser (no native picker)', async () => {
    const result = await shell.openFile({});
    expect(result).toBeNull();
  });

  it('routes through nativeCap("pickFile") when a native bridge exists', async () => {
    const pick = vi.fn().mockResolvedValue({ path: '/tmp/in.png', name: 'in.png' });
    registerNativeCapability('pickFile', pick);
    const result = await shell.openFile({ filters: [] });
    expect(pick).toHaveBeenCalledWith({ filters: [] });
    expect(result).toEqual({ path: '/tmp/in.png', name: 'in.png' });
  });
});
