// file-browser.js — the file-tree DOM rendering for the "Local Files" window.
// Extracted from wm.js (ADR: extract embedded renderers). A pure leaf: builds rows
// from FileSystemHandle entries (or a flat file list) and calls onSelect(url, name,
// entry) on click. No wm-closure state — the stateful glue (folder handle maps, the
// directory pickers, spawn, the refresh-callback set) stays in wm's browse() api.

import { mediaKind } from '../media/media-kind.js';

function fileIcon(ext) {
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico'].includes(ext)) return '🖼';
  const kind = mediaKind(ext);
  if (kind === 'video') return '🎬';
  if (kind === 'audio') return '🎵';
  if (['js', 'ts', 'jsx', 'tsx', 'mjs'].includes(ext)) return '📜';
  if (['wgsl', 'glsl'].includes(ext)) return '✨';
  if (['json'].includes(ext)) return '{ }';
  return '📄';
}

function lcExt(name) {
  return name.replace(/(\.[^.]+)$/, (m) => m.toLowerCase());
}

export function makeFileEntry(entry, depth, onSelect) {
  const li = document.createElement('div');
  li.style.cssText = 'font-family:monospace;font-size:11px;white-space:nowrap;user-select:none;';

  const row = document.createElement('div');
  row.style.cssText = `display:flex;align-items:center;gap:5px;padding:3px 8px 3px ${8 + depth * 14}px;cursor:pointer;`;

  if (entry.kind === 'directory') {
    const arrow = document.createElement('span');
    arrow.textContent = '▶';
    arrow.style.cssText =
      'font-size:7px;color:#888;display:inline-block;width:8px;transition:transform 0.15s;flex-shrink:0;';
    const icon = document.createElement('span');
    icon.textContent = '📁';
    const name = document.createElement('span');
    name.textContent = entry.name;
    name.style.color = '#333';
    row.appendChild(arrow);
    row.appendChild(icon);
    row.appendChild(name);
    li.appendChild(row);

    let expanded = false;
    let childContainer = null;
    row.addEventListener('click', async () => {
      expanded = !expanded;
      arrow.style.transform = expanded ? 'rotate(90deg)' : '';
      if (expanded && !childContainer) {
        childContainer = document.createElement('div');
        li.appendChild(childContainer);
        await renderDirContents(childContainer, entry, depth + 1, onSelect);
      }
      if (childContainer) childContainer.style.display = expanded ? '' : 'none';
    });
  } else {
    const spacer = document.createElement('span');
    spacer.style.cssText = 'width:8px;display:inline-block;flex-shrink:0;';
    const icon = document.createElement('span');
    icon.textContent = fileIcon(entry.name.split('.').pop().toLowerCase());
    const name = document.createElement('span');
    name.textContent = lcExt(entry.name);
    name.style.color = '#222';
    row.appendChild(spacer);
    row.appendChild(icon);
    row.appendChild(name);
    li.appendChild(row);

    row.addEventListener('click', async () => {
      const file = await entry.getFile();
      const url = URL.createObjectURL(file);
      onSelect?.(url, lcExt(entry.name), entry);
    });
  }

  row.addEventListener('mouseenter', () => {
    row.style.background = '#e8f0fe';
  });
  row.addEventListener('mouseleave', () => {
    row.style.background = '';
  });
  return li;
}

export function renderFlatFiles(container, files, onSelect) {
  const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name));
  for (const file of sorted) {
    if (file.name.startsWith('.')) continue;
    const row = document.createElement('div');
    row.style.cssText =
      'display:flex;align-items:center;gap:5px;padding:3px 8px;cursor:pointer;font-family:monospace;font-size:11px;white-space:nowrap;';
    const icon = document.createElement('span');
    icon.textContent = fileIcon(file.name.split('.').pop().toLowerCase());
    const name = document.createElement('span');
    name.textContent = lcExt(file.name);
    name.style.color = '#222';
    row.appendChild(icon);
    row.appendChild(name);
    row.addEventListener('click', () => {
      const url = URL.createObjectURL(file);
      onSelect?.(url, lcExt(file.name), null);
    });
    row.addEventListener('mouseenter', () => {
      row.style.background = '#e8f0fe';
    });
    row.addEventListener('mouseleave', () => {
      row.style.background = '';
    });
    container.appendChild(row);
  }
}

export async function renderDirContents(container, dirHandle, depth, onSelect) {
  const entries = [];
  for await (const entry of dirHandle.values()) entries.push(entry);
  entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    container.appendChild(makeFileEntry(entry, depth, onSelect));
  }
}
