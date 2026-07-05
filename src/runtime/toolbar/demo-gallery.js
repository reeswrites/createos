// ── "Demo Gallery" button — opens as a WM window (not a modal) ─────────────────
// Same "everything is a window" treatment as the Tutorial: a draggable,
// minimizable html window; clicking the toolbar icon again focuses/restores it.
// Extracted from app.js window.onload. Receives the shared onload ctx: { appAPI }.
import { applyProject } from '../../api/platform/project.js';
import { nativeCap } from '../native.js';

export function initDemoGallery(ctx) {
  const { appAPI } = ctx;
  const galleryBtn = document.getElementById('galleryBtn');
  if (!galleryBtn) return;
  const WIN_ID = 'win-gallery';
  let _demos = null;

  async function _fetchDemos() {
    if (_demos) return _demos;
    const res = await fetch('/createos/demos/index.json');
    _demos = await res.json();
    return _demos;
  }

  function _renderInto(grid, list) {
    grid.innerHTML = '';
    for (const demo of list) {
      const card = document.createElement('div');
      card.className = 'gallery-card';
      const tags = (demo.tags ?? []).map((t) => `<span class="gallery-tag">${t}</span>`).join('');
      card.innerHTML = `
        <h3 class="gallery-card-title">${demo.title}</h3>
        <p class="gallery-card-desc">${demo.desc}</p>
        <div class="gallery-card-tags">${tags}</div>
        <button class="gallery-load-btn" data-file="${demo.file}">
          <i class="fa-solid fa-play" style="font-size:9px;margin-right:4px;"></i>Load Demo
        </button>`;
      grid.appendChild(card);
    }
  }

  async function openGallery() {
    // Open-or-focus: restore from taskbar if minimized, else bring to front.
    if (document.getElementById(WIN_ID)) {
      const chip = document.querySelector(`#wm-taskbar [data-win-id="${WIN_ID}"]`);
      if (chip) chip.click();
      else window.wm?.focus(WIN_ID);
      return;
    }

    const desk = document.getElementById('desktop');
    const w = 680;
    const h = Math.min(560, (desk?.offsetHeight ?? 700) - 60);
    const x = Math.max(20, Math.round(((desk?.offsetWidth ?? 1000) - w) / 2));
    window.wm?.spawn('Demo Gallery', {
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
    body.innerHTML = `<div id="galleryGrid" class="gallery-grid"><p style="color:#888;font-family:Arial;padding:12px;">Loading…</p></div>`;
    const grid = body.querySelector('#galleryGrid');

    grid.addEventListener('click', async (e) => {
      const btn = e.target.closest('.gallery-load-btn');
      if (!btn) return;
      const file = btn.dataset.file;
      btn.textContent = 'Loading…';
      btn.disabled = true;
      try {
        const res = await fetch(`/createos/demos/${file}`);
        if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${file}`);
        const data = await res.json();
        await applyProject(data, window.wm, window.__ar_instances, appAPI);
        nativeCap('setProjectProvenance')?.('demo'); // gallery demo = untrusted (ADR 050)
        // Close only AFTER a successful load. applyProject() already calls wm.closeAll()
        // (project.js), so this is the safety-net no-op on success — but crucially it means
        // a failure leaves the gallery (and this button) alive so the catch UI is visible.
        window.wm?.hide(WIN_ID);
      } catch (err) {
        btn.textContent = 'Error — try again';
        btn.disabled = false;
        console.error('Gallery load failed:', err);
      }
    });

    try {
      _renderInto(grid, await _fetchDemos());
    } catch (err) {
      grid.innerHTML = `<p style="color:#f38ba8;font-family:Arial;padding:12px;">Failed to load demos: ${err.message}</p>`;
    }
  }

  galleryBtn.addEventListener('click', () =>
    openGallery().catch((err) => console.error('Gallery open failed:', err)),
  );
}
