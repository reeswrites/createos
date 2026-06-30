// viz-window.js — audio visualizer window + the ♪ fold-out panel for video/camera
// windows. Extracted from wm.js (ADR: extract embedded renderers). The spectrum render
// core lives in audio-viz.js (ADR 042); this module owns the window chrome (source/
// style selects, color pickers, toggle button) around it.
//
// wm injects a small ctx so this module never reaches the wm closure's private state:
//   ctx.desktop                  — DOM root to scan for source windows
//   ctx.hasStrip(winId)          — is there a mixer Strip for that window
//   ctx.resolveChannel(winStripId) — window-strip id → Tone channel (for the core)
//   ctx.onDispose(win, fn)       — register teardown on the window's dispose accumulator

import { createSpectrumCore } from '../audio/audio-viz.js';

function spectrumCore(canvas, getStyle, opts, ctx) {
  return createSpectrumCore(canvas, getStyle, {
    ...opts,
    resolveChannel: ctx.resolveChannel,
  });
}

export function buildSourceSelect(win, ctx, excludeSelf = true) {
  const srcs = [
    { id: 'master', label: 'Master Output' },
    { id: 'mic', label: 'Mic' },
  ];
  ctx.desktop.querySelectorAll('.wm-win').forEach((w) => {
    if (excludeSelf && w === win) return;
    const title = w.querySelector('.wm-title')?.textContent?.trim() || w.id;
    if (w.querySelector('video')) srcs.push({ id: 'vid:' + w.id, label: title + ' · video' });
    if (ctx.hasStrip(w.id)) srcs.push({ id: 'ch:' + w.id, label: title + ' · channel' });
  });
  return srcs;
}

// ── Viz fold-out panel for video windows ──────────────────────────────────
// Injects a ♪ toolbar button + collapsible spectrum panel into a video window.
// Source defaults to the window's own video; source selector allows repurposing.

export function addVizPanel(win, body, winId, opts = {}, ctx) {
  const tb = win.querySelector('.wm-titlebar');
  if (!tb) return;

  // Fold-out panel (initially hidden)
  const panel = document.createElement('div');
  panel.style.cssText =
    'flex-shrink:0;height:80px;background:#0d0d1a;display:none;flex-direction:column;position:relative;';
  // Insert after body in the window flex column
  body.insertAdjacentElement('afterend', panel);

  // Source selector inside panel
  const srcBar = document.createElement('div');
  srcBar.style.cssText =
    'display:flex;align-items:center;gap:4px;padding:3px 6px;background:#13131f;flex-shrink:0;';
  const srcSel = document.createElement('select');
  srcSel.style.cssText =
    'flex:1;font-size:10px;background:#1e1e2e;color:#cdd6f4;border:1px solid #313244;border-radius:3px;padding:1px 3px;';
  const styleSel = document.createElement('select');
  styleSel.style.cssText =
    'font-size:10px;background:#1e1e2e;color:#cdd6f4;border:1px solid #313244;border-radius:3px;padding:1px 3px;';
  for (const s of ['wave', 'bars', 'ring']) {
    const o = document.createElement('option');
    o.value = s;
    o.textContent = s;
    styleSel.appendChild(o);
  }
  if (!opts.locked) srcBar.appendChild(srcSel);
  srcBar.appendChild(styleSel);

  if (opts.locked) srcSel.style.display = 'none';

  const popBtn = document.createElement('button');
  popBtn.title = 'Open in standalone window';
  popBtn.style.cssText =
    'font-size:10px;background:#1e1e2e;color:#cdd6f4;border:1px solid #313244;border-radius:3px;padding:1px 4px;cursor:pointer;flex-shrink:0;';
  popBtn.innerHTML =
    '<i class="fa-solid fa-arrow-up-right-from-square" style="font-size:9px;"></i>';
  popBtn.addEventListener('click', () => {
    window.wm?.spawn('Visualizer', {
      type: 'viz',
      source: 'master',
      style: styleSel.value,
      w: 300,
      h: 160,
    });
  });
  srcBar.appendChild(popBtn);
  panel.appendChild(srcBar);

  // Canvas
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'flex:1;width:100%;min-height:0;display:block;';
  panel.appendChild(canvas);

  const ro = new ResizeObserver(() => {
    canvas.width = canvas.offsetWidth * devicePixelRatio;
    canvas.height = canvas.offsetHeight * devicePixelRatio;
  });
  ro.observe(canvas);

  let core = null;

  function refreshSources() {
    const prev = srcSel.value;
    srcSel.innerHTML = '';
    for (const { id, label } of buildSourceSelect(win, ctx)) {
      const o = document.createElement('option');
      o.value = id;
      o.textContent = label;
      o.selected = id === prev;
      srcSel.appendChild(o);
    }
    // Also add this window's own video as option if not already present
    const selfVid = 'vid:' + winId;
    if (![...srcSel.options].some((o) => o.value === selfVid)) {
      const o = document.createElement('option');
      o.value = selfVid;
      o.textContent = 'This video';
      srcSel.insertBefore(o, srcSel.firstChild);
    }
    if (!srcSel.value || srcSel.value !== prev) {
      const defaultSrc = [...srcSel.options].find((o) => o.value === selfVid) ? selfVid : 'master';
      srcSel.value = defaultSrc;
    }
  }

  function startCore() {
    if (core) {
      core.cleanup();
      core = null;
    }
    core = spectrumCore(canvas, () => styleSel.value, {}, ctx);
    core.setSource(opts.locked ? 'mic' : srcSel.value);
  }

  srcSel.addEventListener('mousedown', refreshSources);
  srcSel.addEventListener('change', () => core?.setSource(srcSel.value));
  styleSel.addEventListener('change', () => core?.setStyle(styleSel.value));

  // Toolbar toggle button
  const vizBtn = document.createElement('span');
  vizBtn.className = 'wm-btn';
  vizBtn.title = 'Toggle audio visualizer';
  vizBtn.innerHTML = '<i class="fa-solid fa-wave-square"></i>';
  let open = false;
  vizBtn.addEventListener('click', () => {
    open = !open;
    panel.style.display = open ? 'flex' : 'none';
    vizBtn.classList.toggle('active', open);
    if (open && !core) {
      if (!opts.locked) refreshSources();
      startCore();
    } else if (!open && core) {
      core.cleanup();
      core = null;
    }
  });

  const firstBtn = tb.querySelector('.wm-btn');
  tb.insertBefore(vizBtn, firstBtn);

  // Cleanup when window closes
  ctx.onDispose(win, () => {
    core?.cleanup();
    core = null;
    ro.disconnect();
  });
}

// ── Audio visualizer window builder ───────────────────────────────────────

export function buildVizWindow(win, body, opts = {}, ctx) {
  body.style.cssText += 'flex-direction:column;padding:0;overflow:hidden;background:#0d0d1a;';

  const ctrl = document.createElement('div');
  ctrl.style.cssText =
    'display:flex;align-items:center;gap:5px;padding:4px 8px;background:#13131f;border-bottom:1px solid #2a2a3e;flex-shrink:0;';

  const sourceSelect = document.createElement('select');
  sourceSelect.style.cssText =
    'flex:1;min-width:0;font-size:11px;background:#1e1e2e;color:#cdd6f4;border:1px solid #313244;border-radius:3px;padding:2px 4px;';

  const styleSelect = document.createElement('select');
  styleSelect.style.cssText =
    'font-size:11px;background:#1e1e2e;color:#cdd6f4;border:1px solid #313244;border-radius:3px;padding:2px 4px;';
  for (const s of ['wave', 'bars', 'ring']) {
    const o = document.createElement('option');
    o.value = s;
    o.textContent = s;
    styleSelect.appendChild(o);
  }

  ctrl.appendChild(sourceSelect);
  ctrl.appendChild(styleSelect);

  const bgPicker = document.createElement('input');
  bgPicker.type = 'color';
  bgPicker.value = opts.colors?.bg ?? '#0d0d1a';
  bgPicker.title = 'Background color';
  bgPicker.style.cssText =
    'width:22px;height:22px;padding:0;border:none;border-radius:3px;cursor:pointer;background:transparent;';

  const fgPicker = document.createElement('input');
  fgPicker.type = 'color';
  fgPicker.value = opts.colors?.wave ?? '#89dceb';
  fgPicker.title = 'Wave / ring color';
  fgPicker.style.cssText =
    'width:22px;height:22px;padding:0;border:none;border-radius:3px;cursor:pointer;background:transparent;';

  ctrl.appendChild(bgPicker);
  ctrl.appendChild(fgPicker);
  body.appendChild(ctrl);

  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'flex:1;width:100%;min-height:0;display:block;';
  body.appendChild(canvas);

  new ResizeObserver(() => {
    canvas.width = canvas.offsetWidth * devicePixelRatio;
    canvas.height = canvas.offsetHeight * devicePixelRatio;
  }).observe(canvas);

  function refreshSources() {
    const prev = sourceSelect.value;
    sourceSelect.innerHTML = '';
    for (const { id, label } of buildSourceSelect(win, ctx)) {
      const o = document.createElement('option');
      o.value = id;
      o.textContent = label;
      o.selected = id === prev;
      sourceSelect.appendChild(o);
    }
    if (!sourceSelect.value) sourceSelect.selectedIndex = 0;
  }

  const _colors = { bg: bgPicker.value, wave: fgPicker.value, ring: fgPicker.value };
  bgPicker.addEventListener('input', () => {
    _colors.bg = bgPicker.value;
  });
  fgPicker.addEventListener('input', () => {
    _colors.wave = _colors.ring = fgPicker.value;
  });
  win._vizColors = _colors;

  const core = spectrumCore(
    canvas,
    () => styleSelect.value,
    {
      autoStart: false,
      getColors: () => win._vizColors,
    },
    ctx,
  );

  win._vizSourceEl = sourceSelect;
  win._vizStyleEl = styleSelect;

  sourceSelect.addEventListener('mousedown', refreshSources);
  sourceSelect.addEventListener('change', () => core.setSource(sourceSelect.value));
  styleSelect.addEventListener('change', () => core.setStyle(styleSelect.value));

  refreshSources();
  const initSrc = opts.source ?? 'master';
  styleSelect.value = opts.style ?? 'wave';
  if ([...sourceSelect.options].some((o) => o.value === initSrc)) sourceSelect.value = initSrc;
  if (opts.colors) {
    _colors.bg = opts.colors.bg ?? _colors.bg;
    _colors.wave = _colors.ring = opts.colors.wave ?? _colors.wave;
    bgPicker.value = _colors.bg;
    fgPicker.value = _colors.wave;
  }
  core.setSource(sourceSelect.value);
  core.start();

  ctx.onDispose(win, () => core.cleanup());
}
