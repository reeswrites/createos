import * as THREE from 'three';
import { liveOutput } from '../runtime/keep-alive.js';
import { runScoped } from '../runtime/run-scoped.js';

export { THREE };

const _scenes = new Set();

// Manual "destroy every scene" helper (used by tests + app). Per-instance,
// owner-filtered reset teardown is handled by run-scoped.js (ADR 041): each
// scene registers a runScoped handle in its ctor, so there is no onReset here.
export function cleanupThree() {
  for (const s of [..._scenes]) s._destroy();
  _scenes.clear();
}

export class ThreeScene {
  constructor(opts = {}) {
    const { z = 30, width, height, alpha = true, antialias = true } = opts;

    this._z = z;
    this._tickFns = [];
    this._rafId = null;
    this._startTime = null;
    this._lastTime = null;
    this._destroyed = false;
    this._bindings = {};
    // Owner-scoped teardown via the shared run-scoped handler (ADR 041). Keep-alive
    // is toggled separately by start()/stop() (this output's liveness toggles), so
    // this uses runScoped (no keep-alive), not runScopedOutput.
    this._ownerEditorId = window.__ar_active_editor_id;
    this._scoped = runScoped({ owner: this._ownerEditorId, onStop: () => this._destroy() });

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, (width || 800) / (height || 600), 0.1, 1000);
    this.camera.position.z = 5;

    this.renderer = new THREE.WebGLRenderer({ antialias, alpha });
    // ADR 040: no editor output window — sized to the mount target (mount/show),
    // defaulting to 800×600 until mounted.
    const w = width || 800;
    const h = height || 600;
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    this.canvas = this.renderer.domElement;
    this.canvas.style.cssText = [
      'position:absolute',
      'top:0',
      'left:0',
      'width:100%',
      'height:100%',
      `z-index:${z}`,
      'pointer-events:none',
    ].join(';');

    _scenes.add(this);
  }

  // ── Mount / show (ADR 040) ─────────────────────────────────────────────────
  // mount(target[, z]) — render into a window's layer stack. target: a Canvas
  //   (has .winId), a window id, or a DOM element. show(opts) — spawn own window.
  mount(target, z) {
    if (z !== undefined) {
      this._z = z;
      this.canvas.style.zIndex = String(z);
    }
    let body = null,
      winId = null;
    if (target && typeof target === 'object' && target.winId) winId = target.winId;
    else if (typeof target === 'string') winId = target;
    else if (target instanceof HTMLElement) body = target;

    if (winId) {
      window.wm?.layer?.(winId, this._z, { adopt: this.canvas });
      body = document.getElementById(winId)?.querySelector('.wm-body') ?? null;
    } else if (body) {
      if (getComputedStyle(body).position === 'static') body.style.position = 'relative';
      body.appendChild(this.canvas);
    }
    if (body) {
      const rw = body.clientWidth || 800,
        rh = body.clientHeight || 600;
      this.renderer.setSize(rw, rh);
      this.camera.aspect = rw / rh;
      this.camera.updateProjectionMatrix();
    }
    return this.start();
  }

  show(opts = {}) {
    const { title = 'Three', w = 700, h = 500 } = opts;
    const winId = window.wm?.spawn(title, {
      w,
      h,
      html: '',
      transient: true,
      onClose: () => this._destroy(),
      ...(opts.noChrome !== undefined ? { noChrome: opts.noChrome } : {}),
      ...(opts.transparent !== undefined ? { transparent: opts.transparent } : {}),
    });
    this._ownWinId = winId ?? null;
    return this.mount(winId);
  }

  start() {
    if (this._rafId || this._destroyed) return this;
    this._live = liveOutput(this);
    this._startTime = performance.now();
    this._lastTime = this._startTime;

    const loop = (now) => {
      if (this._destroyed) return;
      this._rafId = requestAnimationFrame(loop);
      if (window.__ar_paused) return;
      const dt = (now - this._lastTime) / 1000;
      const elapsed = (now - this._startTime) / 1000;
      this._lastTime = now;
      for (const fn of this._tickFns) {
        try {
          fn(dt, elapsed);
        } catch (e) {
          console.error('[ThreeScene tick]', e);
        }
      }
      this.renderer.render(this.scene, this.camera);
    };
    this._rafId = requestAnimationFrame(loop);
    return this;
  }

  stop() {
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    this._live?.release();
    return this;
  }

  tick(fn) {
    this._tickFns.push(fn);
    return this;
  }

  // bind(name, fn) — registers a live signal for use in tick callbacks via scene.get(name)
  bind(name, fn) {
    this._bindings[name] = fn;
    window.__ar_signalRoutes?.push({
      source: String(name),
      sink: 'ThreeScene',
      label: String(name),
    });
    return this;
  }

  get(name) {
    const fn = this._bindings[name];
    return fn ? fn() : undefined;
  }

  add(obj) {
    this.scene.add(obj);
    return this;
  }
  remove(obj) {
    this.scene.remove(obj);
    return this;
  }

  z(n) {
    this._z = n;
    this.canvas.style.zIndex = String(n);
    return this;
  }

  opacity(v) {
    this.canvas.style.opacity = String(v);
    return this;
  }

  resize(w, h) {
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    return this;
  }

  _destroy() {
    if (this._destroyed) return; // idempotent; also stops dispose()→onStop re-entry
    this._destroyed = true;
    this.stop();
    this._tickFns = [];
    this._bindings = {};
    if (this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
    this.renderer.dispose();
    if (this._ownWinId) {
      const id = this._ownWinId;
      this._ownWinId = null;
      window.wm?.remove?.(id, { animate: false });
    }
    _scenes.delete(this);
    this._scoped?.dispose(); // removes from run-scoped set; releases keep-alive
  }
}
