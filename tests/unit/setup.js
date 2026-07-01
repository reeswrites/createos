global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// jsdom does not implement requestAnimationFrame — polyfill for modules that
// capture it at load time (sensors.js, video-signal.js, etc.)
let _rafId = 0;
global.requestAnimationFrame = (fn) => { const id = ++_rafId; setTimeout(() => fn(Date.now()), 16); return id; };
global.cancelAnimationFrame  = (id) => clearTimeout(id);

// indexedDB stub — desktop-files.js references it at module level
if (!global.indexedDB) {
  global.indexedDB = { open: () => ({ onupgradeneeded: null, onsuccess: null, onerror: null }) };
}

// localStorage stub (already present in jsdom but guard for safety)
if (!global.localStorage) {
  const _store = {};
  global.localStorage = {
    getItem:    (k) => _store[k] ?? null,
    setItem:    (k, v) => { _store[k] = String(v); },
    removeItem: (k) => { delete _store[k]; },
    clear:      () => { Object.keys(_store).forEach(k => delete _store[k]); },
  };
}

// CM6 uses matchMedia for dark-mode detection — stub for jsdom
if (!global.window.matchMedia) {
  global.window.matchMedia = () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} });
}

// jsdom doesn't implement HTMLMediaElement play/pause — camera.js calls
// element.play().catch(...) on its off-DOM <video>. Stub to a resolved promise.
if (typeof HTMLMediaElement !== 'undefined') {
  HTMLMediaElement.prototype.play  = function () { return Promise.resolve(); };
  HTMLMediaElement.prototype.pause = function () {};
}

// jsdom doesn't implement canvas getContext — stub it so modules can call
// canvas APIs without crashing.
function _makeCtx2d(canvas) {
  const _W = () => canvas?.width  ?? 300;
  const _H = () => canvas?.height ?? 150;
  const _blankImgData = (w, h) => ({
    width: w, height: h,
    data: new Uint8ClampedArray(w * h * 4),
  });
  return {
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    font: '10px sans-serif',
    globalAlpha: 1,
    clearRect:     () => {},
    fillRect:      () => {},
    strokeRect:    () => {},
    beginPath:     () => {},
    closePath:     () => {},
    moveTo:        () => {},
    lineTo:        () => {},
    arc:           () => {},
    rect:          () => {},
    roundRect:     () => {},
    stroke:        () => {},
    fill:          () => {},
    fillText:      () => {},
    strokeText:    () => {},
    drawImage:     () => {},
    save:          () => {},
    restore:       () => {},
    translate:     () => {},
    rotate:        () => {},
    scale:         () => {},
    setTransform:  () => {},
    clip:          () => {},
    measureText:   (t) => ({ width: t.length * 6 }),
    createImageData: (w, h) => _blankImgData(w, h),
    getImageData:    (x, y, w, h) => _blankImgData(w, h),
    putImageData:    () => {},
    createLinearGradient: () => ({ addColorStop: () => {} }),
    createRadialGradient: () => ({ addColorStop: () => {} }),
  };
}

const _ctxCache = new WeakMap();
HTMLCanvasElement.prototype.getContext = function (type) {
  if (type === '2d') {
    if (!_ctxCache.has(this)) _ctxCache.set(this, _makeCtx2d(this));
    return _ctxCache.get(this);
  }
  return null;
};
