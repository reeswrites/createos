// ── Project toolbar: save / share / load + projects dropdown ───────────────────
// Extracted from app.js window.onload. Receives the shared onload ctx: { appAPI }.
import { saveProject, loadProject, serializeProject } from '../../api/platform/project.js';
import { initProjectManager } from '../../api/platform/project-manager.js';

// Captured at module load (before any user-code timer patching) — mirrors app.js's
// native-timer discipline for the share-button feedback flash.
const _nativeSetTimeout = window.setTimeout.bind(window);

export function initProjectToolbar(ctx) {
  const { appAPI } = ctx;

  initProjectManager({
    appAPI,
    getWm: () => window.wm,
    getInstances: () => window.__ar_instances,
  });

  document
    .getElementById('saveProjectBtn')
    ?.addEventListener('click', () => saveProject(window.wm, window.__ar_instances));

  document.getElementById('shareProjectBtn')?.addEventListener('click', () => {
    const data = serializeProject(window.wm, window.__ar_instances);
    const b64 = btoa(encodeURIComponent(JSON.stringify(data)));
    const url = `${location.origin}${location.pathname}?embed=1&project=${b64}`;
    navigator.clipboard
      ?.writeText(url)
      .then(() => {
        const btn = document.getElementById('shareProjectBtn');
        if (btn) {
          btn.style.color = '#4f4';
          _nativeSetTimeout(() => {
            btn.style.color = '';
          }, 1500);
        }
      })
      .catch(() => {
        prompt('Copy embed URL:', url);
      });
  });

  document
    .getElementById('loadProjectBtn')
    ?.addEventListener('click', () => loadProject(window.wm, window.__ar_instances, appAPI));

  // ── Projects toolbar dropdown ───────────────────────────────────────────────
  const btn = document.getElementById('projectsBtn');
  const drop = document.getElementById('projectsDropdown');
  if (!btn || !drop) return;

  const render = () => {
    drop.innerHTML = '';
    const pm = window.__ar_projectManager;
    if (!pm) return;
    const activeId = pm.getActiveProjectId();
    const activeName = pm.getActiveProjectName();
    const projects = window.__ar_projectCache ?? [];

    const addItem = (label, fn, extra = '') => {
      const li = document.createElement('li');
      li.textContent = label;
      if (extra) li.style.cssText = extra;
      li.addEventListener('click', (e) => {
        e.stopPropagation();
        drop.classList.remove('open');
        fn();
      });
      drop.appendChild(li);
    };
    const addSep = () => {
      const li = document.createElement('li');
      li.style.cssText =
        'pointer-events:none;padding:2px 0;border-top:1px solid #dde;margin:2px 0;';
      drop.appendChild(li);
    };

    // Current project header
    const hdr = document.createElement('li');
    hdr.style.cssText =
      'font-size:10px;color:#888;letter-spacing:0.5px;text-transform:uppercase;padding:6px 14px 2px;pointer-events:none;';
    hdr.textContent = 'Projects';
    drop.appendChild(hdr);

    for (const p of projects) {
      const isActive = p.id === activeId;
      addItem(
        (isActive ? '▶ ' : '  ') + p.name,
        () => {
          if (!isActive) pm.switchProject(p.id);
        },
        isActive ? 'font-weight:600;color:#3a5fe0;' : '',
      );
    }

    addSep();
    addItem('+ New project…', async () => {
      const name = prompt('Project name:');
      if (!name?.trim()) return;
      const id = await pm.createProject(name.trim());
      pm.switchProject(id);
    });
    addItem('Rename "' + activeName + '"…', async () => {
      const name = prompt('Rename project:', activeName);
      if (!name?.trim() || name.trim() === activeName) return;
      pm.renameProject(activeId, name.trim());
    });
    if (projects.length > 1) {
      addItem(
        'Delete "' + activeName + '"…',
        async () => {
          if (!confirm(`Delete project "${activeName}"? Cannot be undone.`)) return;
          pm.deleteProject(activeId);
        },
        'color:#c0392b;',
      );
    }
  };

  window.__ar_projectDropdownRefresh = render;

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!drop.classList.contains('open')) render();
    drop.classList.toggle('open');
  });

  document.addEventListener('click', (e) => {
    if (!btn.contains(e.target)) drop.classList.remove('open');
  });
}
