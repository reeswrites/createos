// ── Toolbar spawn buttons ─────────────────────────────────────────────────────
// Every "New X" widget/window spawner + Mixer + Synth Designer + Run All + Global
// Capture. Extracted from app.js window.onload (ADR 007 "register beside your code"
// discipline). Receives the shared onload ctx: { toolkit, newEditor, spawnOffset }.
import { openMixerPanel } from '../../api/audio/mixer.js';
import { openSynthDesigner } from '../../api/audio/synth-designer.js';
import { Drumpad } from '../../api/audio/drumpad.js';
import { Piano } from '../../api/audio/piano.js';
import { Launchpad } from '../../api/audio/launchpad.js';
import { Paint } from '../../api/widgets/paint.js';
import { AsciiEditor } from '../../api/widgets/asciiEditor.js';
import { SpriteEditor } from '../../api/widgets/sprite-editor.js';
import {
  armGlobal,
  disarmGlobal,
  isGlobalArmed,
  buildTimelineCode,
} from '../../api/signal/performance-recorder.js';
import { insertSnippet } from '../../editor/active-editor.js';

const $ = (id) => document.getElementById(id);
const desk = () => $('desktop');

// Centers a widget's already-spawned window (ADR: wm placed it; we recenter + cascade).
function centerWindow(winId, offset, fallbackW, fallbackH) {
  if (!winId) return;
  const win = $(winId);
  if (!win) return;
  const d = desk();
  const ww = parseInt(win.style.width) || fallbackW;
  const wh = parseInt(win.style.height) || fallbackH;
  win.style.left = Math.round((d.offsetWidth - ww) / 2) + offset + 'px';
  win.style.top = Math.round((d.offsetHeight - wh) / 2) + offset + 'px';
}

export function initSpawnButtons(ctx) {
  const { toolkit, newEditor, spawnOffset } = ctx;

  // ── "New Editor" button ─────────────────────────────────────────────────────
  $('newEditorBtn')?.addEventListener('click', () => {
    const inst = newEditor();
    const d = desk();
    const dw = d.offsetWidth,
      dh = d.offsetHeight;
    const offset = ((inst.id - 1) % 6) * 28;
    const w = Math.round(dw * 0.42),
      h = Math.round(dh * 0.6);
    const x = Math.min(offset + 60, dw - w - 10);
    const y = Math.min(offset + 40, dh - h - 44);
    const edWin = $(inst.editorWinId);
    if (edWin) {
      edWin.style.cssText += `;left:${x}px;top:${y}px;width:${w}px;height:${h}px;display:flex;`;
    }
    // ADR 040: no editor output window — visual output is `new Canvas()` (own window).
  });

  // ── "New Toolkit" button ────────────────────────────────────────────────────
  $('newToolkitBtn')?.addEventListener('click', () => {
    const id = toolkit.nextToolkitId();
    const win = toolkit.createToolkit(id);
    const d = desk();
    const dw = d.offsetWidth,
      dh = d.offsetHeight;
    const offset = ((id - 1) % 6) * 28;
    const w = Math.round(dw * 0.13),
      h = Math.round(dh * 0.7);
    const x = Math.min(offset + 30, dw - w - 10);
    const y = Math.min(offset + 30, dh - h - 44);
    win.style.cssText += `;left:${x}px;top:${y}px;width:${w}px;height:${h}px;display:flex;`;
  });

  // ── "Run All" button ────────────────────────────────────────────────────────
  $('runAllBtn')?.addEventListener('click', () => {
    window.__ar_instances.forEach((inst) => inst.execute());
  });

  // ── Global Capture (Performance recording across all widgets, ADR 031) ───────
  // First click arms every open widget on one shared clock; second click stops
  // and inserts a single timeline() composing one track per widget.
  const gcBtn = $('globalCaptureBtn');
  gcBtn?.addEventListener('click', () => {
    if (!isGlobalArmed()) {
      armGlobal();
      gcBtn.classList.add('recording');
      gcBtn.style.color = '#f38ba8';
      gcBtn.dataset.tip = 'Stop global capture → timeline code';
    } else {
      const tracks = disarmGlobal();
      gcBtn.classList.remove('recording');
      gcBtn.style.color = '';
      gcBtn.dataset.tip = 'Capture all widgets → timeline code';
      if (tracks.length) insertSnippet(buildTimelineCode(tracks));
    }
  });

  // ── "New Visualizer" button ─────────────────────────────────────────────────
  $('newVizBtn')?.addEventListener('click', () => {
    const offset = spawnOffset(8);
    const d = desk();
    window.wm.spawn('Visualizer', {
      type: 'viz',
      w: 400,
      h: 240,
      x: Math.round((d.offsetWidth - 400) / 2) + offset,
      y: Math.round((d.offsetHeight - 240) / 2) + offset,
    });
  });

  // ── "Mixer" button ──────────────────────────────────────────────────────────
  $('mixerBtn')?.addEventListener('click', () => {
    openMixerPanel();
  });

  // ── "New Drum Pad" button ───────────────────────────────────────────────────
  $('newDrumpadBtn')?.addEventListener('click', () => {
    const d = desk();
    const offset = spawnOffset(6);
    new Drumpad({
      title: 'Drum Pad',
      w: 500,
      h: 360,
      x: Math.round((d.offsetWidth - 500) / 2) + offset,
      y: Math.round((d.offsetHeight - 360) / 2) + offset,
    });
  });

  // ── "New Piano" button ──────────────────────────────────────────────────────
  $('newPianoBtn')?.addEventListener('click', () => {
    const d = desk();
    const offset = spawnOffset(6);
    new Piano({
      title: 'Piano',
      w: 560,
      h: 420,
      x: Math.round((d.offsetWidth - 560) / 2) + offset,
      y: Math.round((d.offsetHeight - 420) / 2) + offset,
    });
  });

  // ── "New Launchpad" button ──────────────────────────────────────────────────
  $('newLaunchpadBtn')?.addEventListener('click', () => {
    const offset = spawnOffset(6);
    const lp = new Launchpad({ title: 'Launchpad' });
    centerWindow(lp._winId, offset, 380, 430);
  });

  // ── "Synth Designer" button ─────────────────────────────────────────────────
  $('synthDesignerBtn')?.addEventListener('click', () => {
    openSynthDesigner();
  });

  // ── "New Paint" button ──────────────────────────────────────────────────────
  $('newPaintBtn')?.addEventListener('click', () => {
    const offset = spawnOffset(6);
    const ed = new Paint({ width: 400, height: 300, title: 'Paint' });
    centerWindow(ed._winId, offset, 404, 520);
  });

  // ── "New ASCII Editor" button ───────────────────────────────────────────────
  $('newAsciiEditorBtn')?.addEventListener('click', () => {
    const offset = spawnOffset(6);
    const ed = new AsciiEditor({ cols: 64, rows: 24, title: 'ASCII Editor' });
    centerWindow(ed._winId, offset, 648, 580);
  });

  // ── "New Sprite Editor" button ──────────────────────────────────────────────
  $('newSpriteEditorBtn')?.addEventListener('click', () => {
    const offset = spawnOffset(6);
    const ed = new SpriteEditor({ width: 16, height: 16, scale: 20, title: 'Pixel Art' });
    centerWindow(ed._winId, offset, 344, 520);
  });

  // ── Camera / mic toolbar icons — spawn a viz window on click (ADR 023) ───────
  // No toggle semantics; streams are demand-driven via media-lease.js.
  $('micToggle')?.addEventListener('click', () => {
    const d = desk();
    const offset = spawnOffset(8);
    window.wm.spawn('Mic Visualizer', {
      type: 'viz',
      source: 'mic',
      style: 'bars',
      w: 400,
      h: 180,
      x: Math.round((d.offsetWidth - 400) / 2) + offset,
      y: Math.round((d.offsetHeight - 180) / 2) + offset,
    });
  });
  $('cameraToggle')?.addEventListener('click', () => {
    const d = desk();
    const offset = spawnOffset(8);
    window.wm.spawn('Camera', {
      type: 'camera',
      w: 320,
      h: 240,
      x: Math.round((d.offsetWidth - 320) / 2) + offset,
      y: Math.round((d.offsetHeight - 240) / 2) + offset,
    });
  });
}
