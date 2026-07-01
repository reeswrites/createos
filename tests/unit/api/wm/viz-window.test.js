import { describe, it, expect } from 'vitest';
import { buildSourceSelect } from '../../../../src/api/wm/viz-window.js';

// buildSourceSelect is the pure source-enumeration half of viz-window — extracted from
// wm.js. It scans an injected desktop for video/channel sources via the ctx, so it is
// testable with a fake desktop + ctx and no wm closure.

function mkWin(id, { video = false } = {}) {
  const win = document.createElement('div');
  win.className = 'wm-win';
  win.id = id;
  const title = document.createElement('div');
  title.className = 'wm-title';
  title.textContent = id;
  win.appendChild(title);
  if (video) win.appendChild(document.createElement('video'));
  return win;
}

describe('viz-window buildSourceSelect', () => {
  it('always offers master + mic, plus video and channel sources from the desktop', () => {
    const desktop = document.createElement('div');
    const self = mkWin('win-viz');
    const vidWin = mkWin('win-vid', { video: true });
    const chWin = mkWin('win-ch');
    desktop.append(self, vidWin, chWin);

    const ctx = {
      desktop,
      hasStrip: (id) => id === 'win-ch',
    };
    const srcs = buildSourceSelect(self, ctx);
    const ids = srcs.map((s) => s.id);

    expect(ids).toContain('master');
    expect(ids).toContain('mic');
    expect(ids).toContain('vid:win-vid'); // video element → video source
    expect(ids).toContain('ch:win-ch'); // hasStrip → channel source
    expect(ids).not.toContain('vid:win-viz'); // excludeSelf by default
  });

  it('can include self when excludeSelf is false', () => {
    const desktop = document.createElement('div');
    const self = mkWin('win-viz', { video: true });
    desktop.append(self);
    const srcs = buildSourceSelect(self, { desktop, hasStrip: () => false }, false);
    expect(srcs.map((s) => s.id)).toContain('vid:win-viz');
  });
});
