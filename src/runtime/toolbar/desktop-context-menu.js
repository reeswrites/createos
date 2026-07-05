// ── Desktop right-click context menu ──────────────────────────────────────────
// Extracted from app.js window.onload. Receives the shared onload ctx:
// { toolkit, newEditor, spawnOffset }.
import { openMixerPanel } from '../../api/audio/mixer.js';
import { addFolderIcon } from '../../api/platform/desktop-files.js';

export function initDesktopContextMenu(ctx) {
  const { toolkit, newEditor, spawnOffset } = ctx;
  let menu = null;

  function closeMenu() {
    menu?.remove();
    menu = null;
  }

  document.getElementById('desktop').addEventListener('contextmenu', (e) => {
    if (e.target.closest('.wm-win') || e.target.closest('#taskbar')) return;
    e.preventDefault();
    closeMenu();

    const cx = e.clientX,
      cy = e.clientY;
    menu = document.createElement('div');
    menu.className = 'desktop-ctx-menu';

    const items = [
      {
        icon: 'fa-file-code',
        label: 'New Code File',
        action() {
          const inst = newEditor();
          const desk = document.getElementById('desktop');
          const dw = desk.offsetWidth,
            dh = desk.offsetHeight;
          const w = Math.round(dw * 0.42),
            h = Math.round(dh * 0.6);
          const x = Math.min(cx, dw - w - 10);
          const y = Math.min(cy, dh - h - 44);
          const edWin = document.getElementById(inst.editorWinId);
          if (edWin)
            edWin.style.cssText += `;left:${x}px;top:${y}px;width:${w}px;height:${h}px;display:flex;`;
        },
      },
      {
        icon: 'fa-folder-open',
        label: 'Grant Folder Access…',
        async action() {
          const folderData = await window.wm.pickFolder();
          if (!folderData) return;
          const desk = document.getElementById('desktop');
          const rect = desk.getBoundingClientRect();
          const iconId = addFolderIcon(folderData, cx - rect.left, cy - rect.top);
          if (folderData.handle) window.wm.registerFolder(iconId, folderData.handle);
          else if (folderData.fallback)
            window.wm.registerFolderFallback(iconId, folderData.fallback);
          window.wm.browse(iconId, null, { x: cx, y: cy }).catch(() => {});
        },
      },
      {
        icon: 'fa-wave-square',
        label: 'New Visualizer',
        action() {
          const offset = spawnOffset(8);
          window.wm.spawn('Visualizer', {
            type: 'viz',
            w: 400,
            h: 240,
            x: cx + offset,
            y: cy + offset,
          });
        },
      },
      {
        icon: 'fa-sliders',
        label: 'Mixer',
        action() {
          openMixerPanel();
        },
      },
      {
        icon: 'fa-gauge-high',
        label: 'Motion Sensor',
        action() {
          window.wm.spawn('Motion Sensor', {
            type: 'sensor',
            source: 'motion',
            w: 280,
            h: 300,
            x: cx,
            y: cy,
          });
        },
      },
      {
        icon: 'fa-gamepad',
        label: 'Gamepad',
        action() {
          window.wm.spawn('Gamepad', {
            type: 'sensor',
            source: 'gamepad',
            w: 280,
            h: 300,
            x: cx,
            y: cy,
          });
        },
      },
      {
        icon: 'fa-location-dot',
        label: 'Geolocation',
        action() {
          window.wm.spawn('Geolocation', {
            type: 'sensor',
            source: 'geo',
            w: 280,
            h: 300,
            x: cx,
            y: cy,
          });
        },
      },
      {
        icon: 'fa-toolbox',
        label: 'New Toolkit',
        action() {
          const id = toolkit.nextToolkitId();
          const win = toolkit.createToolkit(id);
          const w = 200,
            h = 500;
          win.style.cssText += `;left:${Math.min(cx, window.innerWidth - w - 10)}px;top:${Math.min(cy, window.innerHeight - h - 44)}px;width:${w}px;height:${h}px;display:flex;`;
        },
      },
      {
        icon: 'fa-play',
        label: 'Run All Editors',
        action() {
          window.__ar_instances.forEach((inst) => inst.execute());
        },
      },
    ];

    items.forEach(({ icon, label, action }) => {
      const item = document.createElement('div');
      item.className = 'desktop-ctx-item';
      item.innerHTML = `<i class="fa-solid ${icon}"></i> ${label}`;
      item.addEventListener('click', () => {
        closeMenu();
        action();
      });
      menu.appendChild(item);
    });

    document.body.appendChild(menu);

    const mw = menu.offsetWidth,
      mh = menu.offsetHeight;
    menu.style.left = `${Math.min(cx, window.innerWidth - mw - 4)}px`;
    menu.style.top = `${Math.min(cy, window.innerHeight - mh - 4)}px`;
  });

  document.addEventListener('mousedown', (e) => {
    if (menu && !menu.contains(e.target)) closeMenu();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMenu();
  });
}
