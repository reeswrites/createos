// tooltips.js — global styled hover tooltips.
//
// The main nav chrome shows nice styled tooltips via `data-tip` + a CSS
// `::after` (index.html). Widget toolbars (Paint/Sprite/Ascii/Drumpad/Piano/
// Notepad) and wm titlebars instead carry plain `title=` attrs — which render
// the OS's slow, unstyled native tooltip. This installs ONE delegated tooltip
// that upgrades every `[title]` element to the nav's look, with zero per-widget
// edits.
//
// A CSS `::after` can't be reused here: widget bodies are `overflow:hidden`, so
// a child pseudo-element would clip. The shared box is `position:fixed` on
// <body>, immune to ancestor clipping.

let _tip = null; // the shared tooltip element
let _cur = null; // element currently being described
const _text = new WeakMap(); // el → original title (stripped while hovered)

function _ensure() {
  if (_tip) return _tip;
  _tip = document.createElement('div');
  _tip.style.cssText = `position:fixed;z-index:99999;background:#1e1e2e;color:#cdd6f4;
    font:11px Arial,sans-serif;white-space:nowrap;padding:3px 7px;border-radius:5px;
    pointer-events:none;opacity:0;transition:opacity .1s;box-shadow:0 2px 6px rgba(0,0,0,.4);
    left:0;top:0;`;
  document.body.appendChild(_tip);
  return _tip;
}

function _hide() {
  if (_cur) {
    // Restore the title we stripped to suppress the native tooltip.
    const t = _text.get(_cur);
    if (t != null && !_cur.hasAttribute('title')) _cur.setAttribute('title', t);
    _text.delete(_cur);
    _cur = null;
  }
  if (_tip) _tip.style.opacity = '0';
}

function _show(el) {
  const title = el.getAttribute('title');
  if (!title) return;
  _hide();
  _cur = el;
  _text.set(el, title);
  el.removeAttribute('title'); // kill the native OS tooltip

  const tip = _ensure();
  tip.textContent = title;
  tip.style.opacity = '0'; // measure offscreen-ish before placing
  tip.style.left = '0';
  tip.style.top = '0';

  const r = el.getBoundingClientRect();
  const tw = tip.offsetWidth;
  const th = tip.offsetHeight;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let left = r.left + r.width / 2 - tw / 2;
  left = Math.max(4, Math.min(left, vw - tw - 4));

  let top = r.bottom + 8; // below the element, like nav
  if (top + th + 4 > vh) top = r.top - th - 8; // flip above if no room

  tip.style.left = `${Math.round(left)}px`;
  tip.style.top = `${Math.round(top)}px`;
  tip.style.opacity = '1';
}

export function initTooltips() {
  document.addEventListener('mouseover', (e) => {
    const el = e.target?.closest?.('[title]');
    if (el === _cur) return;
    if (el) _show(el);
    else if (_cur && !_cur.contains(e.target)) _hide();
  });
  document.addEventListener('mouseout', (e) => {
    if (!_cur) return;
    // Leaving _cur for somewhere outside it → hide.
    if (_cur === e.target || _cur.contains(e.target)) {
      if (!_cur.contains(e.relatedTarget)) _hide();
    }
  });
  // Any interaction that moves the element out from under the cursor.
  document.addEventListener('mousedown', _hide, true);
  window.addEventListener('scroll', _hide, true);
  window.addEventListener('blur', _hide);
}
