// window-registry.js — Window Type Adapter registry (leaf, DOM-pure, no wm import).
//
// Each window type registers a { serialize, restore } pair BESIDE the module that
// owns that type's state (viz adapter in viz.js, media/html in wm.js, toolkit in
// app.js). project.js iterates this registry instead of switching on `opts.type`
// twice. See CONTEXT.md "Window Type Adapter".
//
//   serialize(win, ctx) -> record | null   (ctx: { geoOf, readAudio, titleOf, opts, wm })
//   restore(record, ctx) -> void            (ctx: { wm, appAPI, applyGeo })

const _adapters = new Map();

export function registerWindowType(type, adapter) {
  _adapters.set(type, adapter);
}

export function getWindowAdapter(type) {
  return _adapters.get(type);
}

export function windowTypes() {
  return [..._adapters.keys()];
}

// ── Shared DOM helpers, used by adapters living in different modules ──────────

export function geoOf(win) {
  return {
    x: parseInt(win.style.left) || 0,
    y: parseInt(win.style.top) || 0,
    w: parseInt(win.style.width) || 320,
    h: parseInt(win.style.height) || 240,
    visible: win.style.display !== 'none',
    nochrome: win.classList.contains('wm-no-chrome'),
    transparent: win.classList.contains('wm-transparent'),
  };
}

export function titleOf(win, fallback = '') {
  return win.querySelector('.wm-title')?.textContent?.trim() ?? fallback;
}

export function readAudio(win) {
  const muteBtn = win.querySelector('.wm-mute');
  const volSlider = win.querySelector('.wm-vol');
  return {
    muted: muteBtn?.classList.contains('muted') ?? false,
    volume: volSlider ? parseFloat(volSlider.value) / 100 : 1,
  };
}

export function applyGeo(win, w) {
  if (!win) return;
  win.style.left = `${w.x}px`;
  win.style.top = `${w.y}px`;
  win.style.width = `${w.w}px`;
  win.style.height = `${w.h}px`;
  win.style.display = w.visible ? 'flex' : 'none';
  if (w.nochrome) win.classList.add('wm-no-chrome');
  if (w.transparent) win.classList.add('wm-transparent');
}

// ── Shared FIELD-EXTRACTION primitives ───────────────────────────────────────
// Both window serializers (in-session `_serializeSpawnedType` and the portable
// Window Type Adapters) read the SAME per-type fields off the live window; only
// the CONTRACT they project into differs (in-session keeps id + hasHandle; the
// portable path drops id + uses fileKey + 'visualizer'). These helpers own the
// read once; each caller projects the result into its own contract shape. Do NOT
// fold the projection in here — the two contracts stay deliberately separate.

// Viz window fields: reads the live source/style <select> values (falling back
// to spawn opts, then the defaults) plus the current color set. Callers decide
// which keys to emit (portable drops colors).
export function readVizFields(win, opts) {
  return {
    source: win._vizSourceEl?.value ?? opts?.source ?? 'master',
    style: win._vizStyleEl?.value ?? opts?.style ?? 'wave',
    colors: win._vizColors ? { ...win._vizColors } : undefined,
  };
}

// Media (image/video) source decision: a `blob:` src means the real handle lives
// in IndexedDB (in-session projects `hasHandle:true`, portable projects a
// `fileKey`); a non-blob src travels inline. Returns the decision as data —
// `src` is the inline value to persist (undefined for blob-backed windows).
export function readMediaSrc(opts) {
  const isBlob = opts?.src?.startsWith('blob:') ?? false;
  return { isBlob, src: isBlob ? undefined : opts?.src };
}
