// toolkit-window.js — the API Toolbox window type.
//
// A self-contained WM window: a drag-out snippet panel built from TOOLKIT_CATEGORIES,
// a search filter over it, and a shared hover tooltip. This was ~250 lines inlined into
// app.js's window.onload; extracted here as a sibling to viz-window.js / sensor-window.js
// so app.js is a thinner composition root and the toolkit is reachable on its own.
//
// initToolkitWindow() builds everything once and returns { createToolkit, nextToolkitId }.
// It also installs window.__ar_addToolkitEntry — the live entry-insertion hook that
// pipe.register() and runtime registerAPI() calls use to add a snippet to already-open
// panels. Needs window.wm to spawn.

import { TOOLKIT_CATEGORIES, addToolkitEntries } from '../../editor/toolkit-catalog.js';

export function initToolkitWindow() {
  // ── Shared hover tooltip for toolkit snippets (toolkit-owned) ────────────────
  const toolTipEl = document.createElement('div');
  toolTipEl.id = 'toolkit-tooltip';
  document.body.appendChild(toolTipEl);
  const showTooltip = (text, anchorEl) => {
    toolTipEl.textContent = text;
    toolTipEl.style.display = 'block';
    const rect = anchorEl.getBoundingClientRect();
    toolTipEl.style.left = `${rect.right + 8}px`;
    toolTipEl.style.top = `${rect.top + rect.height / 2}px`;
    toolTipEl.style.transform = 'translateY(-50%)';
  };
  const hideTooltip = () => {
    toolTipEl.style.display = 'none';
  };

  function _makeToolkitBtn(cmd, catName) {
    const btn = document.createElement('div');
    btn.className = 'toolkit-btn';
    btn.draggable = true;
    btn.dataset.search =
      `${cmd.label} ${cmd.hint ?? ''} ${(cmd.tags ?? []).join(' ')}`.toLowerCase();
    btn.dataset.cat = catName.toLowerCase();
    btn.innerHTML = `<span>${cmd.label}</span><span class="toolkit-info" title="">ℹ</span>`;
    btn.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('application/x-ar-toolkit', cmd.code);
      e.dataTransfer.effectAllowed = 'copy';
      btn.classList.add('dragging');
      hideTooltip();
    });
    btn.addEventListener('dragend', () => btn.classList.remove('dragging'));
    if (cmd.hint) {
      const infoSpan = btn.querySelector('.toolkit-info');
      infoSpan.addEventListener('mouseenter', () => showTooltip(cmd.hint, infoSpan));
      infoSpan.addEventListener('mouseleave', hideTooltip);
      infoSpan.addEventListener('mousedown', (e) => e.stopPropagation());
    }
    return btn;
  }

  function _populateTextPanel(panel) {
    for (const cat of TOOLKIT_CATEGORIES) {
      const catEl = document.createElement('div');
      catEl.className = 'toolkit-category';
      catEl.dataset.catName = cat.name.toLowerCase();
      catEl.textContent = cat.name;
      panel.appendChild(catEl);
      for (const cmd of cat.commands) {
        panel.appendChild(_makeToolkitBtn(cmd, cat.name));
      }
    }
  }

  // Live toolkit entry insertion — called by pipe.register() and any runtime
  // registerAPI() use. Updates all currently-open toolkit text panels in place.
  window.__ar_addToolkitEntry = (catName, cmd) => {
    addToolkitEntries(catName, [cmd]);
    document.querySelectorAll('.ar-toolkit-text').forEach((panel) => {
      let header = panel.querySelector(
        `.toolkit-category[data-cat-name="${catName.toLowerCase()}"]`,
      );
      if (!header) {
        header = document.createElement('div');
        header.className = 'toolkit-category';
        header.dataset.catName = catName.toLowerCase();
        header.textContent = catName;
        panel.appendChild(header);
      }
      panel.appendChild(_makeToolkitBtn(cmd, catName));
    });
  };

  function _filterTextPanel(panel, q) {
    const query = q.trim().toLowerCase();
    const cats = panel.querySelectorAll('.toolkit-category');
    const btns = panel.querySelectorAll('.toolkit-btn');
    if (!query) {
      cats.forEach((c) => {
        c.style.display = '';
      });
      btns.forEach((b) => {
        b.style.display = '';
      });
      return;
    }
    cats.forEach((c) => {
      c.style.display = 'none';
    });
    btns.forEach((b) => {
      const match = b.dataset.search?.includes(query);
      b.style.display = match ? '' : 'none';
      if (match) {
        const catEl = panel.querySelector(`.toolkit-category[data-cat-name="${b.dataset.cat}"]`);
        if (catEl) catEl.style.display = '';
      }
    });
  }

  function _buildToolkitContent(win) {
    const body = win.querySelector('.wm-body');
    body.style.overflow = 'hidden';
    body.style.flexDirection = 'column';
    body.style.padding = '0';
    body.style.background = '#f0f2f5';

    const searchInput = document.createElement('input');
    searchInput.type = 'search';
    searchInput.placeholder = 'Filter…';
    searchInput.className = 'ar-toolkit-search';
    searchInput.addEventListener('mousedown', (e) => e.stopPropagation());

    const searchRow = document.createElement('div');
    searchRow.className = 'ar-toolkit-searchrow';
    searchRow.appendChild(searchInput);
    body.appendChild(searchRow);

    const textPanel = document.createElement('div');
    textPanel.className = 'ar-toolkit-text';
    _populateTextPanel(textPanel);
    body.appendChild(textPanel);

    searchInput.addEventListener('input', () => {
      _filterTextPanel(textPanel, searchInput.value);
    });
  }

  let toolkitIdCounter = 0;

  function createToolkit(id) {
    toolkitIdCounter = Math.max(toolkitIdCounter, id);
    const winId = id === 1 ? 'win-toolkit' : `win-toolkit-${id}`;
    const title = id === 1 ? 'API Toolbox' : `API Toolbox ${id}`;
    window.wm.spawn(title, { id: winId, type: 'html', html: '', audio: false });
    const win = document.getElementById(winId);
    _buildToolkitContent(win);
    win.querySelector('.wm-dup')?.remove();
    return win;
  }

  const nextToolkitId = () => ++toolkitIdCounter;

  return { createToolkit, nextToolkitId };
}

// Window Type Adapter for toolkit windows (registered by app.js onload — restore needs
// the live appAPI, so it reads createToolkit/nextToolkitId off the registry ctx rather
// than the initToolkitWindow closure). Kept beside the toolkit code (ADR 055 discipline).
export const toolkitWindowAdapter = {
  serialize(win, ctx) {
    return { type: 'toolkit', title: ctx.titleOf(win, 'API Toolbox'), ...ctx.geoOf(win) };
  },
  restore(w, ctx) {
    const id = ctx.appAPI.nextToolkitId();
    const win = ctx.appAPI.createToolkit(id);
    ctx.applyGeo(win, w);
  },
};
