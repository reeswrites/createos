import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initToolkitWindow } from '../../../../src/api/wm/toolkit-window.js';

// toolkit-window.js is the API Toolbox window type extracted from app.js's
// window.onload. Before the extraction, createToolkit / _buildToolkitContent /
// __ar_addToolkitEntry were unreachable without booting the whole app. These tests
// exercise the text-snippet half through a stub wm.spawn (the Blockly palette is
// lazy — only built on a blocks-mode click — so it stays untouched here).

function stubWm() {
  window.wm = {
    spawn(_title, opts) {
      const win = document.createElement('div');
      win.id = opts.id;
      win.className = 'wm-win';
      const tb = document.createElement('div');
      tb.className = 'wm-titlebar';
      win.appendChild(tb);
      const body = document.createElement('div');
      body.className = 'wm-body';
      win.appendChild(body);
      document.body.appendChild(win);
      return opts.id;
    },
  };
}

describe('toolkit-window (isolation)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    stubWm();
  });
  afterEach(() => {
    delete window.wm;
    delete window.__ar_addToolkitEntry;
  });

  it('createToolkit(1) spawns "win-toolkit" and populates the snippet panel', () => {
    const tk = initToolkitWindow();
    const win = tk.createToolkit(1);

    expect(win.id).toBe('win-toolkit');
    const textPanel = win.querySelector('.ar-toolkit-text');
    expect(textPanel).toBeTruthy();
    // TOOLKIT_CATEGORIES seeds real categories + drag-out buttons.
    expect(textPanel.querySelectorAll('.toolkit-category').length).toBeGreaterThan(0);
    expect(textPanel.querySelectorAll('.toolkit-btn').length).toBeGreaterThan(0);
  });

  it('nextToolkitId advances past the highest created id', () => {
    const tk = initToolkitWindow();
    tk.createToolkit(1); // counter = 1
    expect(tk.nextToolkitId()).toBe(2);
    expect(tk.nextToolkitId()).toBe(3);
  });

  it('__ar_addToolkitEntry appends a snippet button to an open panel', () => {
    const tk = initToolkitWindow();
    const win = tk.createToolkit(1);
    const before = win.querySelectorAll('.ar-toolkit-text .toolkit-btn').length;

    window.__ar_addToolkitEntry('My Custom', { label: 'zzzUnique', code: 'zzzUnique()' });

    const btns = [...win.querySelectorAll('.ar-toolkit-text .toolkit-btn')];
    expect(btns.length).toBe(before + 1);
    expect(btns.some((b) => b.textContent.includes('zzzUnique'))).toBe(true);
    expect(
      win.querySelector('.ar-toolkit-text .toolkit-category[data-cat-name="my custom"]'),
    ).toBeTruthy();
  });

  it('search filter hides non-matching snippet buttons', () => {
    const tk = initToolkitWindow();
    const win = tk.createToolkit(1);
    const search = win.querySelector('.ar-toolkit-search');
    const btns = [...win.querySelectorAll('.toolkit-btn')];
    const sample = btns[0].dataset.search.split(' ')[0];

    search.value = '___no_such_snippet___';
    search.dispatchEvent(new Event('input'));
    expect(btns.every((b) => b.style.display === 'none')).toBe(true);

    search.value = sample;
    search.dispatchEvent(new Event('input'));
    expect(btns.some((b) => b.style.display !== 'none')).toBe(true);
  });
});
