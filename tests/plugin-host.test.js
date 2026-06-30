import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PluginHost, cleanupPlugins } from '../src/api/plugin-host.js';

// Minimal iframe stub
class FakeIframe {
  constructor() {
    this.src = '';
    this.sandbox = '';
    this.style = { cssText: '' };
    this._listeners = {};
    this.contentWindow = {
      postMessage: vi.fn(),
    };
    this.contentDocument = {
      querySelector: vi.fn(() => null),
    };
    this.isConnected = true;
  }
  addEventListener(ev, fn) { (this._listeners[ev] ??= []).push(fn); }
  dispatchEvent(name) { (this._listeners[name] ?? []).forEach(f => f()); }
}

function mockDOM() {
  const iframe = new FakeIframe();
  const body = { innerHTML: '', style: { cssText: '' }, appendChild: vi.fn() };
  const winEl = { querySelector: vi.fn(() => body), id: 'win-1' };

  const _realCreate = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tag) => {
    if (tag === 'iframe') return iframe;
    return _realCreate(tag);
  });
  vi.spyOn(document, 'getElementById').mockReturnValue(winEl);

  window.wm = { spawn: vi.fn(() => 'win-1') };
  window.__ar_signalRoutes = [];

  return { iframe, body, winEl };
}

beforeEach(() => {
  window.__ar_signalRoutes = [];
});

afterEach(() => {
  cleanupPlugins();
  vi.restoreAllMocks();
  delete window.wm;
  delete window.__ar_signalRoutes;
});

describe('PluginHost.create', () => {
  it('returns a Plugin with spawn/on/send/bridge/canvas methods', () => {
    const p = PluginHost.create('<html></html>');
    expect(typeof p.spawn).toBe('function');
    expect(typeof p.on).toBe('function');
    expect(typeof p.send).toBe('function');
    expect(typeof p.bridge).toBe('function');
    expect('canvas' in p).toBe(true);
  });

  it('spawn() calls wm.spawn with title and size opts', () => {
    mockDOM();
    const p = PluginHost.create('<html></html>');
    p.spawn('Test Plugin', { w: 400, h: 300 });
    expect(window.wm.spawn).toHaveBeenCalledOnce();
    const [title, opts] = window.wm.spawn.mock.calls[0];
    expect(title).toBe('Test Plugin');
    expect(opts.w).toBe(400);
    expect(opts.h).toBe(300);
  });

  it('spawn() returns plugin for chaining', () => {
    mockDOM();
    const p = PluginHost.create('<html></html>');
    expect(p.spawn('T')).toBe(p);
  });
});

describe('PluginHost.load', () => {
  it('returns a Plugin from URL', () => {
    const p = PluginHost.load('https://example.com/plugin/');
    expect(typeof p.spawn).toBe('function');
  });
});

describe('Plugin.on / Plugin.send', () => {
  it('on() registers handler, send() calls iframe postMessage', () => {
    const { iframe } = mockDOM();
    const p = PluginHost.create('<html></html>');
    p.spawn('P');

    const fn = vi.fn();
    p.on('greeting', fn);

    // Simulate message from iframe
    const msgEvent = new MessageEvent('message', {
      data: { _vlType: 'greeting', _vlPayload: 'hello' },
      source: iframe.contentWindow,
    });
    window.dispatchEvent(msgEvent);
    expect(fn).toHaveBeenCalledWith('hello');
  });

  it('send() posts message to iframe contentWindow', () => {
    const { iframe } = mockDOM();
    const p = PluginHost.create('<html></html>');
    p.spawn('P');
    p.send('color', '#ff0');
    expect(iframe.contentWindow.postMessage).toHaveBeenCalledWith(
      { _vlType: 'color', _vlPayload: '#ff0' },
      '*',
    );
  });

  it('on() returns plugin for chaining', () => {
    const p = PluginHost.create('<html></html>');
    expect(p.on('x', () => {})).toBe(p);
  });

  it('off() removes handler', () => {
    const { iframe } = mockDOM();
    const p = PluginHost.create('<html></html>');
    p.spawn('P');
    const fn = vi.fn();
    p.on('evt', fn);
    p.off('evt', fn);
    window.dispatchEvent(new MessageEvent('message', {
      data: { _vlType: 'evt', _vlPayload: 1 },
      source: iframe.contentWindow,
    }));
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('Plugin.bridge', () => {
  it('registers a bridge entry and logs to signalRoutes', () => {
    const p = PluginHost.create('<html></html>');
    p.bridge('bass', () => 0.5);
    expect(p._bridges).toHaveLength(1);
    expect(p._bridges[0].name).toBe('bass');
    expect(window.__ar_signalRoutes).toHaveLength(1);
    expect(window.__ar_signalRoutes[0].source).toBe('bass');
  });

  it('bridge() returns plugin for chaining', () => {
    const p = PluginHost.create('<html></html>');
    expect(p.bridge('x', () => 1)).toBe(p);
  });
});

describe('Plugin.canvas', () => {
  it('returns null when iframe has no canvas (same-origin stub)', () => {
    mockDOM();
    const p = PluginHost.create('<html></html>');
    p.spawn('P');
    // contentDocument.querySelector returns null (mock)
    expect(p.canvas).toBeNull();
  });

  it('returns mirror canvas after _vlFrame message', () => {
    const { iframe } = mockDOM();
    const p = PluginHost.create('<html></html>');
    p.spawn('P');

    // Simulate frame capture from iframe
    const bmp = { width: 320, height: 240, close: vi.fn() };
    window.dispatchEvent(new MessageEvent('message', {
      data: { _vlFrame: true, bitmap: bmp },
      source: iframe.contentWindow,
    }));
    expect(p.canvas).toBeInstanceOf(HTMLCanvasElement);
    expect(bmp.close).toHaveBeenCalled();
  });
});

describe('cleanupPlugins', () => {
  it('destroys all plugins and clears list', () => {
    const p1 = PluginHost.create('<html></html>');
    const p2 = PluginHost.load('https://example.com/');
    const spy1 = vi.spyOn(p1, '_destroy');
    const spy2 = vi.spyOn(p2, '_destroy');
    cleanupPlugins();
    expect(spy1).toHaveBeenCalled();
    expect(spy2).toHaveBeenCalled();
  });
});
