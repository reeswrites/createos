import { onReset } from '../../runtime/reset-registry.js';
// status-bar.js — spawnable user-writable status bar widget (#43)
// statusBar.set(text)  — set main text in status bar
// statusBar.add(html)  — append HTML content
// statusBar.clear()    — clear all content
// statusBar.show()/hide() — toggle visibility
// Not hardcoded nav chrome — lives in a wm window pinned to bottom of desktop.

let _winId = null;
let _textEl = null;
let _contentEl = null;

function _getOrSpawn() {
  if (_winId) {
    const win = document.getElementById(_winId);
    if (win) return win;
    // Window was closed — reset
    _winId = null;
    _textEl = null;
    _contentEl = null;
  }

  const desktop = document.getElementById('desktop') ?? document.body;
  const dW = desktop.offsetWidth || 800;
  const dH = desktop.offsetHeight || 600;
  const barH = 28;

  const html = `<div id="sb-inner" style="display:flex;align-items:center;gap:8px;height:${barH}px;padding:0 10px;font:12px monospace;color:#ccc;background:#1a1a2e;border-top:1px solid #333;overflow:hidden;white-space:nowrap;">
  <span id="sb-text" style="flex:1;"></span>
  <span id="sb-content" style="display:flex;gap:6px;align-items:center;"></span>
</div>`;

  _winId =
    window.wm?.spawn('Status Bar', {
      html,
      x: 0,
      y: dH - barH - 29, // 29 = titlebar height, so we'd want noChrome
      w: dW,
      h: barH,
      noChrome: true,
      id: 'win-statusbar',
    }) ?? null;

  if (_winId) {
    const win = document.getElementById(_winId);
    if (win) {
      win.style.borderRadius = '0';
      win.style.resize = 'none';
      const body = win.querySelector('.wm-body');
      if (body) {
        body.style.cssText += ';padding:0;overflow:hidden;';
        _textEl = body.querySelector('#sb-text');
        _contentEl = body.querySelector('#sb-content');
      }
    }
  }

  return _winId ? document.getElementById(_winId) : null;
}

export function cleanupStatusBar() {
  _winId = null;
  _textEl = null;
  _contentEl = null;
}

export const statusBar = {
  // Set main label text
  set(text) {
    _getOrSpawn();
    if (_textEl) _textEl.textContent = String(text);
    return statusBar;
  },

  // Append an HTML string or DOM element as a widget
  add(widget) {
    _getOrSpawn();
    if (_contentEl) {
      if (typeof widget === 'string') {
        const span = document.createElement('span');
        span.innerHTML = widget;
        _contentEl.appendChild(span);
      } else if (widget instanceof Element) {
        _contentEl.appendChild(widget);
      }
    }
    return statusBar;
  },

  // Clear all content
  clear() {
    if (_textEl) _textEl.textContent = '';
    if (_contentEl) _contentEl.innerHTML = '';
    return statusBar;
  },

  // Show/hide
  show() {
    _getOrSpawn();
    window.wm?.show?.(_winId);
    return statusBar;
  },

  hide() {
    if (_winId) window.wm?.hide?.(_winId);
    return statusBar;
  },

  // Destroy and remove
  close() {
    if (_winId) window.wm?.close?.(_winId);
    _winId = null;
    _textEl = null;
    _contentEl = null;
    return statusBar;
  },

  get isOpen() {
    return !!(_winId && document.getElementById(_winId));
  },
};

// Register teardown with the reset registry (ADR 008).
onReset(cleanupStatusBar);
