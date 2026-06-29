import * as PIXI from 'pixi.js';
import { onReset } from '../runtime/reset-registry.js';

let _app = null;
let _userTickerFns = new Set();
let _resizeObserver = null;
let _ownWinId = null;

export function initPixi() {
  if (_app) return;

  // ADR 040: the pixi view is created detached (no editor output window to mount
  // into anymore). It renders into a window only after pixi.mount(target) /
  // pixi.show(). Backing store defaults to 1600×900; resized to the container on mount.
  _app = new PIXI.Application({
    width: 1600,
    height: 900,
    backgroundAlpha: 0,
    antialias: true,
    resolution: 1,
  });

  Object.assign(_app.view.style, {
    position: 'absolute',
    top: '0', left: '0',
    width: '100%', height: '100%',
    zIndex: '25',
    pointerEvents: 'none',
  });

  // Pause integration — skip render when IDE is paused
  const _origRender = _app.renderer.render.bind(_app.renderer);
  _app.renderer.render = (stage) => {
    if (!window.__ar_paused) _origRender(stage);
  };

  // Convenience: tracked tick — cleaned up on reset
  _app.tick = (fn) => {
    _userTickerFns.add(fn);
    _app.ticker.add(fn);
    return fn;
  };

  // ── Mount / show (ADR 040) ─────────────────────────────────────────────────
  // pixi.mount(target) — mount the view as the z=25 plane of a window. target is
  //   a Canvas (has .winId), a window id, or a DOM element.
  // pixi.show(opts) — spawn a bare window and mount into it (standalone).
  _app.mount = (target) => { _mountPixi(target); return _app; };
  _app.show = (opts = {}) => {
    const { title = 'Pixi', w = 700, h = 500 } = opts;
    const winId = window.wm?.spawn(title, {
      w, h, html: '', transient: true,
      onClose: () => cleanupPixi(),
      ...(opts.noChrome    !== undefined ? { noChrome:    opts.noChrome    } : {}),
      ...(opts.transparent !== undefined ? { transparent: opts.transparent } : {}),
    });
    _ownWinId = winId ?? null;
    _mountPixi(winId);
    return _app;
  };

  window.pixi  = _app;
  window.Stage = _app.stage;
}

function _mountPixi(target) {
  if (!_app) return;
  let body = null, winId = null;
  if (target && typeof target === 'object' && target.winId) winId = target.winId;
  else if (typeof target === 'string') winId = target;
  else if (target instanceof HTMLElement) body = target;

  if (winId) {
    window.wm?.layer?.(winId, 25, { adopt: _app.view });   // register as the window's z=25 plane
    body = document.getElementById(winId)?.querySelector('.wm-body') ?? null;
  } else if (body) {
    if (getComputedStyle(body).position === 'static') body.style.position = 'relative';
    body.appendChild(_app.view);
  }

  if (body) {
    _resizeObserver?.disconnect();
    _resizeObserver = new ResizeObserver(() => {
      const rw = Math.round((body.clientWidth  ?? 0) * devicePixelRatio) || 1600;
      const rh = Math.round((body.clientHeight ?? 0) * devicePixelRatio) || 900;
      _app.renderer.resize(rw, rh);
    });
    _resizeObserver.observe(body);
  }
}

export function cleanupPixi() {
  if (!_app) return;
  for (const fn of _userTickerFns) _app.ticker.remove(fn);
  _userTickerFns.clear();
  _app.stage.removeChildren();
  _resizeObserver?.disconnect();
  _resizeObserver = null;
  if (_ownWinId) { const id = _ownWinId; _ownWinId = null; window.wm?.remove?.(id, { animate: false }); }
  try { _app.view.remove(); } catch (_) { /* window already gone */ }
}

export { PIXI };

// Register teardown with the reset registry (ADR 008).
onReset(cleanupPixi);
