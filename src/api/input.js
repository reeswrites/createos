// input.js — sole keyboard + mouse DOM listener layer. (ADR 014)
//
// Bridges document-level input events onto the global bus as:
//   window:key:down/up          { key, code, repeat, winId }
//   window:mouse:down/up/click  { button, x, y, winId }
//   window:mouse:move           { x, y, winId }  — lazy RAF source via registerSource
//   wm:{winId}:key:*            { key, code, ... }  — scoped, emitted in parallel
//   wm:{winId}:mouse:*          { button, x, y } coords relative to .wm-body
//
// Key events are emitted even while typing in the editor (tagged with winId).
// Users exclude editor input with: .when(d => d.winId !== 'win-editor')
//
// winId for key events = focused window tracked in wm.js.
// winId for mouse events = e.target.closest('.wm-win')?.id.
//
// Permanent listeners (key/click): attached once at module load, survive resets.
// Move source: lazy — starts RAF loop on first subscriber, stops on last.

import { notify, registerSource } from '../events/index.js';
import { getFocusedWinId } from './wm.js';

// Capture native addEventListener before the harness patches EventTarget.prototype.
const _docAdd = document.addEventListener.bind(document);
const _winAdd = window.addEventListener.bind(window);
const _docRem = document.removeEventListener.bind(document);
const _winRem = window.removeEventListener.bind(window);

// ── Key events ────────────────────────────────────────────────────────────────

_docAdd('keydown', (e) => {
  if (window.__ar_paused) return;
  const winId = getFocusedWinId();
  notify('window:key:down', { key: e.key, code: e.code, repeat: e.repeat, winId: winId ?? null });
  if (winId) notify(`wm:${winId}:key:down`, { key: e.key, code: e.code, repeat: e.repeat });
});

_docAdd('keyup', (e) => {
  const winId = getFocusedWinId();
  notify('window:key:up', { key: e.key, code: e.code, winId: winId ?? null });
  if (winId) notify(`wm:${winId}:key:up`, { key: e.key, code: e.code });
});

// ── Mouse discrete events ─────────────────────────────────────────────────────

function _wmBodyCoords(e, winId) {
  if (!winId) return null;
  const win = document.getElementById(winId);
  if (!win) return null;
  const body = win.querySelector('.wm-body');
  if (!body) return null;
  const rect = body.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

_docAdd('mousedown', (e) => {
  if (window.__ar_paused) return;
  const winId = e.target.closest?.('.wm-win')?.id ?? null;
  notify('window:mouse:down', { button: e.button, x: e.clientX, y: e.clientY, winId });
  if (winId) {
    const rel = _wmBodyCoords(e, winId);
    if (rel) notify(`wm:${winId}:mouse:down`, { button: e.button, x: rel.x, y: rel.y });
  }
});

_docAdd('mouseup', (e) => {
  if (window.__ar_paused) return;
  const winId = e.target.closest?.('.wm-win')?.id ?? null;
  notify('window:mouse:up', { button: e.button, x: e.clientX, y: e.clientY, winId });
  if (winId) {
    const rel = _wmBodyCoords(e, winId);
    if (rel) notify(`wm:${winId}:mouse:up`, { button: e.button, x: rel.x, y: rel.y });
  }
});

_docAdd('click', (e) => {
  if (window.__ar_paused) return;
  const winId = e.target.closest?.('.wm-win')?.id ?? null;
  notify('window:mouse:click', { button: e.button, x: e.clientX, y: e.clientY, winId });
  if (winId) {
    const rel = _wmBodyCoords(e, winId);
    if (rel) notify(`wm:${winId}:mouse:click`, { button: e.button, x: rel.x, y: rel.y });
  }
});

// ── Mouse move — lazy RAF source ──────────────────────────────────────────────
// Only runs when something subscribes to window:mouse:move or any wm:{id}:mouse:move.
// registerSource with a predicate pattern so scoped subscriptions also count.

let _pendingMove = null;
let _moveRafId = null;

function _onMouseMove(e) {
  _pendingMove = e;
}

function _moveRafLoop() {
  if (_pendingMove) {
    const e = _pendingMove;
    _pendingMove = null;
    const winId = e.target.closest?.('.wm-win')?.id ?? null;
    notify('window:mouse:move', { x: e.clientX, y: e.clientY, winId });
    if (winId) {
      const rel = _wmBodyCoords(e, winId);
      if (rel) notify(`wm:${winId}:mouse:move`, { x: rel.x, y: rel.y });
    }
  }
  _moveRafId = requestAnimationFrame(_moveRafLoop);
}

registerSource(
  // Matches window:mouse:move AND any wm:{id}:mouse:move subscription
  (event) => event === 'window:mouse:move' || /^wm:.+:mouse:move$/.test(event),
  {
    start() {
      _docAdd('mousemove', _onMouseMove);
      _moveRafId = requestAnimationFrame(_moveRafLoop);
    },
    stop() {
      _docRem('mousemove', _onMouseMove);
      if (_moveRafId !== null) {
        cancelAnimationFrame(_moveRafId);
        _moveRafId = null;
      }
      _pendingMove = null;
    },
  },
);
