// settings-ui.js — toolbar Model Manager panel for Speech-to-Text. ADR 039.
//
// A WM html window built with REAL DOM + JS listeners (this codebase renders html
// windows via innerHTML with NO iframe, so inline <script> / window.parent — the
// original handoff approach — cannot run). modelManager/MODELS are module imports,
// not window globals. Lets the user pre-download or delete models and pick the speech
// engine without writing code.

import { modelManager, MODELS } from './model-manager.js';

const WIN_ID = 'win-stt-settings';

export function openSTTSettings() {
  // Open-or-focus.
  if (document.getElementById(WIN_ID)) {
    const chip = document.querySelector(`#wm-taskbar [data-win-id="${WIN_ID}"]`);
    if (chip) chip.click();
    else window.wm?.focus(WIN_ID);
    return;
  }

  const desk = document.getElementById('desktop');
  const w = 480,
    h = 360;
  const x = Math.max(20, Math.round(((desk?.offsetWidth ?? 1000) - w) / 2));
  window.wm?.spawn('Speech-to-Text', {
    id: WIN_ID,
    type: 'html',
    html: '',
    w,
    h,
    x,
    y: 40,
    audio: false,
  });

  const body = document.getElementById(WIN_ID)?.querySelector('.wm-body');
  if (!body) return;

  body.style.font = '13px/1.5 system-ui, Arial, sans-serif';
  body.style.padding = '12px';
  body.style.color = '#eee';
  body.style.background = '#1a1a1a';
  body.innerHTML = `
    <style>
      #stt-root table { width:100%; border-collapse:collapse; margin-bottom:12px; }
      #stt-root th { text-align:left; color:#888; font-weight:normal; padding:4px 8px; font-size:12px; }
      #stt-root td { padding:6px 8px; border-top:1px solid #333; vertical-align:middle; }
      #stt-root .pill { display:inline-block; padding:2px 8px; border-radius:99px; font-size:11px; }
      #stt-root .ready { background:#1a3a1a; color:#4c4; }
      #stt-root .downloading { background:#1a2a3a; color:#48f; }
      #stt-root .uncached { background:#2a2a2a; color:#888; }
      #stt-root button { padding:3px 10px; border:1px solid #555; border-radius:4px; background:#2a2a2a; color:#eee; cursor:pointer; font-size:12px; }
      #stt-root button:hover { background:#3a3a3a; }
      #stt-root .danger { border-color:#a33; color:#f88; }
      #stt-root progress { width:90px; height:4px; vertical-align:middle; margin-left:6px; }
      #stt-storage { color:#888; font-size:11px; margin-top:8px; }
      #stt-engine-row { margin-top:14px; padding-top:10px; border-top:1px solid #333; font-size:12px; }
      #stt-engine-row select { background:#2a2a2a; color:#eee; border:1px solid #555; border-radius:4px; padding:2px 6px; margin-left:6px; }
    </style>
    <div id="stt-root"><p style="color:#888;">Loading…</p></div>
    <div id="stt-engine-row">
      Speech engine:
      <select id="stt-engine">
        <option value="auto">Auto (Web Speech, else ML)</option>
        <option value="ml">ML model (any browser)</option>
        <option value="webspeech">Web Speech only</option>
      </select>
    </div>`;

  const root = body.querySelector('#stt-root');

  // Engine selector reflects + drives audio.speechEngine.
  const engineSel = body.querySelector('#stt-engine');
  if (window.audio?.speechEngine) engineSel.value = window.audio.speechEngine;
  engineSel.addEventListener('change', () => {
    if (window.audio) window.audio.speechEngine = engineSel.value;
  });

  async function render() {
    if (!document.getElementById(WIN_ID)) return; // window closed — stop
    const est = await modelManager.storageEstimate();
    const usedMb = (est.used / 1e6).toFixed(0);
    const quotaMb = (est.quota / 1e6).toFixed(0);

    const rows = await Promise.all(
      Object.entries(MODELS).map(async ([key, m]) => {
        const s = await modelManager.status(key);
        const pct = modelManager._progress[key] ?? 0;
        const statusCell =
          s === 'downloading'
            ? `<span class="pill downloading">${pct}%</span><progress value="${pct}" max="100"></progress>`
            : `<span class="pill ${s}">${s}</span>`;
        const action =
          s === 'uncached'
            ? `<button data-act="load" data-key="${key}">Download</button>`
            : s === 'ready'
              ? `<button class="danger" data-act="del" data-key="${key}">Delete</button>`
              : '—';
        return `<tr><td>${m.label}</td><td>${m.sizeMb} MB</td><td>${statusCell}</td><td>${action}</td></tr>`;
      }),
    );

    root.innerHTML = `
      <table>
        <thead><tr><th>Model</th><th>Size</th><th>Status</th><th></th></tr></thead>
        <tbody>${rows.join('')}</tbody>
      </table>
      <div id="stt-storage">Browser storage: ${usedMb} MB used of ${quotaMb} MB</div>`;
  }

  root.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const { act, key } = btn.dataset;
    if (act === 'load')
      modelManager
        .load(key)
        .catch((err) => console.warn('[stt] download failed:', err?.message ?? err));
    else if (act === 'del') modelManager.delete(key);
  });

  // Live updates. Self-detach once the window is gone.
  const onChange = () => {
    if (!document.getElementById(WIN_ID)) {
      modelManager.removeEventListener('progress', onChange);
      modelManager.removeEventListener('deleted', onChange);
      return;
    }
    render();
  };
  modelManager.addEventListener('progress', onChange);
  modelManager.addEventListener('deleted', onChange);

  render();
}
