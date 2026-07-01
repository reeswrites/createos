import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { signalGraph, cleanupSignalGraph } from '../../../../src/api/signal/signal-graph.js';

describe('signalGraph', () => {
  beforeEach(() => {
    window.__ar_signalRoutes = [];
    window.__ar_keepAlive = new Set();
    // Stub wm.spawn
    window.wm = { spawn: vi.fn(() => ({ id: 'win-graph-1' })) };
  });

  afterEach(() => {
    cleanupSignalGraph();
    delete window.wm;
    delete window.__ar_keepAlive;
  });

  it('route() registers a signal connection', () => {
    signalGraph.route('audio.fft.bass', 'ThreeScene', 'bass→scale');
    expect(window.__ar_signalRoutes).toHaveLength(1);
    const r = window.__ar_signalRoutes[0];
    expect(r.source).toBe('audio.fft.bass');
    expect(r.sink).toBe('ThreeScene');
    expect(r.label).toBe('bass→scale');
  });

  it('route() coerces non-string args to string', () => {
    signalGraph.route(42, 99);
    expect(window.__ar_signalRoutes[0].source).toBe('42');
    expect(window.__ar_signalRoutes[0].sink).toBe('99');
  });

  it('route() returns signalGraph for chaining', () => {
    expect(signalGraph.route('a', 'b')).toBe(signalGraph);
  });

  it('show() calls wm.spawn when no window exists', () => {
    signalGraph._winId = null;
    signalGraph.show();
    expect(window.wm.spawn).toHaveBeenCalledOnce();
    const [title, opts] = window.wm.spawn.mock.calls[0];
    expect(title).toBe('Signal Graph');
    expect(typeof opts.html).toBe('string');
    expect(opts.html).toContain('<svg');
  });

  it('show() returns signalGraph for chaining', () => {
    expect(signalGraph.show()).toBe(signalGraph);
    signalGraph._winId = null;
  });

  it('show() SVG includes source/sink nodes when routes exist', () => {
    signalGraph._winId = null;
    window.__ar_signalRoutes = [
      { source: 'audio.fft', sink: 'ThreeScene', label: 'bass' },
    ];
    signalGraph.show();
    const html = window.wm.spawn.mock.calls[0][1].html;
    expect(html).toContain('audio.fft');
    expect(html).toContain('ThreeScene');
    signalGraph._winId = null;
  });

  it('show() updates existing window body when _winId set', () => {
    const fakeWin = document.createElement('div');
    fakeWin.id = 'win-graph-existing';
    const body = document.createElement('div');
    body.className = 'wm-body';
    fakeWin.appendChild(body);
    document.body.appendChild(fakeWin);

    signalGraph._winId = 'win-graph-existing';
    signalGraph.show();
    expect(window.wm.spawn).not.toHaveBeenCalled();
    expect(body.innerHTML).toContain('<svg');

    fakeWin.remove();
    signalGraph._winId = null;
  });

  it('clear() empties signal routes', () => {
    window.__ar_signalRoutes = [{ source: 'a', sink: 'b' }];
    signalGraph.clear();
    expect(window.__ar_signalRoutes).toHaveLength(0);
  });

  it('cleanupSignalGraph() resets route table', () => {
    window.__ar_signalRoutes = [{ source: 'x', sink: 'y' }];
    cleanupSignalGraph();
    expect(window.__ar_signalRoutes).toHaveLength(0);
  });
});
