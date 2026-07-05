// toolkit-window.js — the API Toolbox window type.
//
// A self-contained WM window: a drag-out snippet panel built from TOOLKIT_CATEGORIES,
// a search filter over it, a lazily-built Blockly block palette, and a shared hover
// tooltip. This was ~250 lines inlined into app.js's window.onload; extracted here as
// a sibling to viz-window.js / sensor-window.js so app.js is a thinner composition
// root and the toolkit is reachable on its own.
//
// initToolkitWindow() builds everything once and returns { createToolkit, nextToolkitId }.
// It also installs window.__ar_addToolkitEntry — the live entry-insertion hook that
// pipe.register() and runtime registerAPI() calls use to add a snippet to already-open
// panels. Needs window.wm to spawn.

import { TOOLKIT_CATEGORIES, addToolkitEntries } from '../../editor/completions.js';
import {
  initPaletteWorkspace,
  onPaletteClick,
  TOOLBOX_CATEGORY_META,
  finishBlockRenders,
  resizeBlockly,
} from '../../blocks/blocks.js';
import { activeBlocksEditor } from '../../runtime/run-context.js';

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
      if (cmd.blockType) e.dataTransfer.setData('application/x-ar-block-type', cmd.blockType);
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

    const modeBar = document.createElement('div');
    modeBar.className = 'ar-toolkit-modebar';

    const textModeBtn = document.createElement('button');
    textModeBtn.className = 'ar-toolkit-mode ar-toolkit-mode-active';
    textModeBtn.title = 'Text snippets';
    textModeBtn.innerHTML = '<i class="fa-solid fa-code"></i>';

    const blocksModeBtn = document.createElement('button');
    blocksModeBtn.className = 'ar-toolkit-mode';
    blocksModeBtn.title = 'Block palette';
    blocksModeBtn.innerHTML = '<i class="fa-solid fa-puzzle-piece"></i>';

    const searchInput = document.createElement('input');
    searchInput.type = 'search';
    searchInput.placeholder = 'Filter…';
    searchInput.className = 'ar-toolkit-search';
    searchInput.addEventListener('mousedown', (e) => e.stopPropagation());

    modeBar.appendChild(textModeBtn);
    modeBar.appendChild(blocksModeBtn);
    body.appendChild(modeBar);

    const searchRow = document.createElement('div');
    searchRow.className = 'ar-toolkit-searchrow';
    searchRow.appendChild(searchInput);
    body.appendChild(searchRow);

    const textPanel = document.createElement('div');
    textPanel.className = 'ar-toolkit-text';
    _populateTextPanel(textPanel);
    body.appendChild(textPanel);

    const blocksPanel = document.createElement('div');
    blocksPanel.className = 'ar-toolkit-blocks';
    blocksPanel.style.display = 'none';

    const catPanel = document.createElement('div');
    catPanel.className = 'ar-toolkit-cats';

    const listPanel = document.createElement('div');
    listPanel.className = 'ar-toolkit-list';

    const backBtn = document.createElement('button');
    backBtn.className = 'blockly-back-btn';
    backBtn.textContent = '← Back';

    const paletteDiv = document.createElement('div');
    paletteDiv.className = 'ar-toolkit-palette';

    listPanel.appendChild(backBtn);
    listPanel.appendChild(paletteDiv);
    blocksPanel.appendChild(catPanel);
    blocksPanel.appendChild(listPanel);
    body.appendChild(blocksPanel);

    let paletteWorkspace = null;
    let inBlocksMode = false;

    function ensurePalette() {
      if (paletteWorkspace) return;
      paletteWorkspace = initPaletteWorkspace(paletteDiv);
      onPaletteClick(paletteWorkspace, (type) => {
        activeBlocksEditor()?._addBlockToWorkspace(type);
      });
      backBtn.addEventListener('click', () => {
        listPanel.style.display = 'none';
        catPanel.style.display = '';
      });
      for (const { name, hue, blocks } of TOOLBOX_CATEGORY_META) {
        const btn = document.createElement('button');
        btn.className = 'blockly-cat-btn';
        btn.textContent = name;
        btn.style.background = `hsl(${hue}, 50%, 42%)`;
        btn.addEventListener('click', async () => {
          catPanel.style.display = 'none';
          listPanel.style.display = 'flex';
          backBtn.textContent = '← ' + name;
          paletteWorkspace.clear();
          const addedBlocks = [];
          for (const { type } of blocks) {
            const block = paletteWorkspace.newBlock(type);
            block.initSvg();
            block.render();
            addedBlocks.push(block);
          }
          await finishBlockRenders();
          let y = 10;
          for (const block of addedBlocks) {
            block.moveTo({ x: 10, y });
            y += block.getHeightWidth().height + 14;
          }
          resizeBlockly(paletteWorkspace);
          requestAnimationFrame(() => paletteWorkspace.scroll(0, 0));
        });
        catPanel.appendChild(btn);
      }
    }

    function openText() {
      textPanel.style.display = '';
      blocksPanel.style.display = 'none';
      textModeBtn.classList.add('ar-toolkit-mode-active');
      blocksModeBtn.classList.remove('ar-toolkit-mode-active');
      inBlocksMode = false;
    }

    function openBlocks() {
      ensurePalette();
      textPanel.style.display = 'none';
      blocksPanel.style.display = 'flex';
      textModeBtn.classList.remove('ar-toolkit-mode-active');
      blocksModeBtn.classList.add('ar-toolkit-mode-active');
      inBlocksMode = true;
      resizeBlockly(paletteWorkspace);
    }

    searchInput.addEventListener('input', () => {
      if (!inBlocksMode) _filterTextPanel(textPanel, searchInput.value);
    });
    textModeBtn.addEventListener('click', () => {
      if (inBlocksMode) {
        openText();
        searchRow.style.display = '';
      }
    });
    blocksModeBtn.addEventListener('click', () => {
      if (!inBlocksMode) {
        openBlocks();
        searchRow.style.display = 'none';
      }
    });

    new ResizeObserver(() => {
      if (inBlocksMode && paletteWorkspace) resizeBlockly(paletteWorkspace);
    }).observe(body);
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
