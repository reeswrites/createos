import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { statusBar, cleanupStatusBar } from '../../../../src/api/wm/status-bar.js';

// Status bar needs wm.spawn to create its window
function mockWm() {
  // Create a fake wm window DOM structure
  const textEl    = document.createElement('span');
  textEl.id       = 'sb-text';
  const contentEl = document.createElement('span');
  contentEl.id    = 'sb-content';
  const body      = document.createElement('div');
  body.className  = 'wm-body';
  body.style.cssText = '';
  body.appendChild(textEl);
  body.appendChild(contentEl);
  const win       = document.createElement('div');
  win.id          = 'win-statusbar';
  win.style.cssText = '';
  win.appendChild(body);
  document.body.appendChild(win);

  window.wm = {
    spawn: vi.fn(() => 'win-statusbar'),
    show:  vi.fn(),
    hide:  vi.fn(),
    close: vi.fn(),
  };
  return { win, body, textEl, contentEl };
}

beforeEach(() => {
  cleanupStatusBar();
});

afterEach(() => {
  cleanupStatusBar();
  vi.restoreAllMocks();
  delete window.wm;
  document.body.innerHTML = '';
});

describe('statusBar.set()', () => {
  it('calls wm.spawn on first use', () => {
    mockWm();
    statusBar.set('hello');
    expect(window.wm.spawn).toHaveBeenCalledOnce();
  });

  it('sets text content of sb-text element', () => {
    const { textEl } = mockWm();
    statusBar.set('Playing: My Track');
    expect(textEl.textContent).toBe('Playing: My Track');
  });

  it('returns statusBar for chaining', () => {
    mockWm();
    expect(statusBar.set('x')).toBe(statusBar);
  });

  it('does not spawn twice', () => {
    mockWm();
    statusBar.set('a');
    statusBar.set('b');
    expect(window.wm.spawn).toHaveBeenCalledOnce();
  });
});

describe('statusBar.add()', () => {
  it('appends HTML string as child of sb-content', () => {
    const { contentEl } = mockWm();
    statusBar.add('<b>LIVE</b>');
    expect(contentEl.children).toHaveLength(1);
    expect(contentEl.children[0].querySelector('b')).toBeTruthy();
  });

  it('appends DOM element directly', () => {
    const { contentEl } = mockWm();
    const el = document.createElement('span');
    el.textContent = 'test';
    statusBar.add(el);
    expect(contentEl.contains(el)).toBe(true);
  });

  it('returns statusBar for chaining', () => {
    mockWm();
    expect(statusBar.add('x')).toBe(statusBar);
  });
});

describe('statusBar.clear()', () => {
  it('clears text and content', () => {
    const { textEl, contentEl } = mockWm();
    statusBar.set('hello');
    statusBar.add('<b>widget</b>');
    statusBar.clear();
    expect(textEl.textContent).toBe('');
    expect(contentEl.innerHTML).toBe('');
  });

  it('returns statusBar for chaining', () => {
    mockWm();
    expect(statusBar.clear()).toBe(statusBar);
  });
});

describe('statusBar.hide/show', () => {
  it('show() spawns if needed and calls wm.show', () => {
    mockWm();
    statusBar.show();
    expect(window.wm.spawn).toHaveBeenCalled();
    expect(window.wm.show).toHaveBeenCalled();
  });

  it('hide() calls wm.hide', () => {
    mockWm();
    statusBar.set('x'); // ensure winId is set
    statusBar.hide();
    expect(window.wm.hide).toHaveBeenCalled();
  });
});

describe('statusBar.close()', () => {
  it('calls wm.close and resets internal state', () => {
    mockWm();
    statusBar.set('x');
    statusBar.close();
    expect(window.wm.close).toHaveBeenCalled();
    expect(statusBar.isOpen).toBe(false);
  });
});

describe('cleanupStatusBar()', () => {
  it('resets state without errors', () => {
    mockWm();
    statusBar.set('x');
    expect(() => cleanupStatusBar()).not.toThrow();
  });
});
