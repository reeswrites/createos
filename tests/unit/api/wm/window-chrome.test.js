import { describe, it, expect, beforeEach } from 'vitest';
import { createWindowChrome } from '../../../../src/api/wm/window-chrome.js';

// window-chrome.js is the titlebar-decorator seam extracted from the initWM closure.
// Before the extraction these builders were unreachable by a unit test without
// instantiating the whole window manager (ADR 042 lineage). These tests exercise
// them in isolation through the factory's injected deps — the whole point of the seam.

function makeWin() {
  const win = document.createElement('div');
  win.className = 'wm-win';
  win.id = 'win-test';
  const tb = document.createElement('div');
  tb.className = 'wm-titlebar';
  // A pre-existing control so insertBefore(firstBtn) has an anchor (the close btn).
  const close = document.createElement('span');
  close.className = 'wm-btn wm-close';
  tb.appendChild(close);
  win.appendChild(tb);
  const body = document.createElement('div');
  body.className = 'wm-body';
  win.appendChild(body);
  return { win, tb, body };
}

function makeChrome() {
  const disposers = [];
  const calls = { routeMediaToStrip: [] };
  const chrome = createWindowChrome({
    desktop: document.createElement('div'),
    onDispose: (_win, fn) => disposers.push(fn),
    getWindowStrip: () => ({ name: 'strip-x' }),
    routeMediaToStrip: (id, el) => calls.routeMediaToStrip.push([id, el]),
    overlayEvents: new Set(),
    textLayers: new Set(),
  });
  return { chrome, disposers, calls };
}

describe('window-chrome decorators (isolation)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('addFlipBtns inserts two flip buttons and toggles the target transform', () => {
    const { win, tb, body } = makeWin();
    const { chrome } = makeChrome();
    chrome.addFlipBtns(win, body);

    const btns = [...tb.querySelectorAll('.wm-btn')];
    const flipH = btns.find((b) => b.innerHTML.includes('fa-left-right'));
    const flipV = btns.find((b) => b.innerHTML.includes('fa-up-down'));
    expect(flipH).toBeTruthy();
    expect(flipV).toBeTruthy();

    expect(body.style.transform).toBe('');
    flipH.dispatchEvent(new Event('click'));
    expect(body.style.transform).toBe('scale(-1,1)');
    flipV.dispatchEvent(new Event('click'));
    expect(body.style.transform).toBe('scale(-1,-1)');
    flipH.dispatchEvent(new Event('click'));
    expect(body.style.transform).toBe('scale(1,-1)');
  });

  it('addCopyPathBtn adds a copy button only when a url is given', () => {
    const { chrome } = makeChrome();

    const a = makeWin();
    chrome.addCopyPathBtn(a.win, 'https://example.com/x.png');
    expect(a.tb.querySelector('.wm-copy-path')).toBeTruthy();

    const b = makeWin();
    chrome.addCopyPathBtn(b.win, null);
    expect(b.tb.querySelector('.wm-copy-path')).toBeNull();
  });

  it('addHistoryControls reflects undo/redo availability and wires the buttons', () => {
    const { win, tb } = makeWin();
    const { chrome } = makeChrome();
    let undone = 0;
    const history = {
      _onChange: () => {},
      canUndo: () => true,
      canRedo: () => false,
      undo: () => undone++,
      redo: () => {},
    };
    chrome.addHistoryControls(win, history);

    const hist = [...tb.querySelectorAll('.wm-history-btn')];
    expect(hist).toHaveLength(2);
    const undoBtn = hist.find((b) => b.innerHTML.includes('fa-rotate-left'));
    const redoBtn = hist.find((b) => b.innerHTML.includes('fa-rotate-right'));
    expect(undoBtn.style.opacity).toBe('1'); // canUndo → enabled
    expect(redoBtn.style.opacity).toBe('0.4'); // canRedo false → dimmed
    undoBtn.dispatchEvent(new Event('click'));
    expect(undone).toBe(1);
    expect(win._widgetHistory).toBe(history);
  });

  it('addCaptureButtons wires snapshot hooks and registers a dispose handler', () => {
    const { win, tb, body } = makeWin();
    const { chrome, disposers } = makeChrome();
    const visualEl = document.createElement('canvas');
    chrome.addCaptureButtons(win, body, visualEl);

    const camera = [...tb.querySelectorAll('.wm-btn')].find((b) => b.innerHTML.includes('fa-camera'));
    expect(camera).toBeTruthy();
    expect(typeof win._wmSnapshot).toBe('function');
    expect(typeof win._wmRecord).toBe('function');
    // A non-static (non-IMG) visual gets a record button; capture registers cleanup.
    expect([...tb.querySelectorAll('.wm-btn')].some((b) => b.innerHTML.includes('fa-circle'))).toBe(
      true,
    );
    expect(disposers.length).toBe(1);
  });

  it('addAudioControls inserts a mute button + volume slider and bridges media', () => {
    const { win, tb } = makeWin();
    const { chrome, calls } = makeChrome();
    const videoEl = document.createElement('video');
    chrome.addAudioControls(win, videoEl);

    const ctrl = tb.querySelector('.wm-audio-ctrl');
    expect(ctrl).toBeTruthy();
    expect(ctrl.querySelector('.wm-mute')).toBeTruthy();
    expect(ctrl.querySelector('input.wm-vol')).toBeTruthy();
    // Media windows re-bridge into the window's mixer strip.
    expect(calls.routeMediaToStrip).toEqual([['win-test', videoEl]]);
  });
});
