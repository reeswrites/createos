import { addBusTap } from '../../events/index.js';
import { activeEditorId } from '../../runtime/run-context.js';

// ── Pure helpers (exported for unit tests) ────────────────────────────────────

export function matchesFilter(event, filterStr) {
  if (!filterStr.trim()) return true;
  const parts = filterStr.trim().split(/\s+/);
  for (const part of parts) {
    if (part.startsWith('-')) {
      // Exclude: -prefix: means drop events starting with "prefix:"
      const prefix = part.slice(1);
      if (event.startsWith(prefix)) return false;
    } else {
      // Include filter: only show events matching this prefix
      // (if ANY include term present, event must match at least one)
    }
  }
  // Check if there are any positive include terms; if so, require a match
  const includes = parts.filter((p) => !p.startsWith('-'));
  if (includes.length > 0) {
    return includes.some((p) => event.startsWith(p));
  }
  return true;
}

export function repr(value, depth = 0) {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (depth >= 2) return `[…${value.length}]`;
    const items = value.slice(0, 5).map((v) => repr(v, depth + 1));
    return `[${items.join(', ')}${value.length > 5 ? ', …' : ''}]`;
  }
  if (typeof value === 'object') {
    if (depth >= 2) return `{…}`;
    const keys = Object.keys(value).slice(0, 5);
    const pairs = keys.map((k) => `${k}: ${repr(value[k], depth + 1)}`);
    const extra = Object.keys(value).length > 5 ? ', …' : '';
    return `{${pairs.join(', ')}${extra}}`;
  }
  return String(value);
}

// Rate-limit state: Map<eventName, { rowEl, badgeEl, payloadEl, count, lastTs }>
// Exported for tests.
export function makeRateState() {
  return new Map();
}

export function applyRateLimit(rateMap, event, data, containerEl, maxRows, createRowFn) {
  const now = Date.now();
  const existing = rateMap.get(event);
  if (existing && now - existing.lastTs < 200) {
    existing.count++;
    existing.lastTs = now;
    existing.badgeEl.textContent = existing.count > 1 ? `×${existing.count}` : '';
    existing.payloadEl.textContent = repr(data);
    return;
  }
  // New row
  const { rowEl, badgeEl, payloadEl } = createRowFn(event, data);
  rateMap.set(event, { rowEl, badgeEl, payloadEl, count: 1, lastTs: now });
  containerEl.insertBefore(rowEl, containerEl.firstChild);
  // Cap total rows
  while (containerEl.children.length > maxRows) {
    const last = containerEl.lastChild;
    // Clean up rate state for removed row
    for (const [k, v] of rateMap.entries()) {
      if (v.rowEl === last) {
        rateMap.delete(k);
        break;
      }
    }
    containerEl.removeChild(last);
  }
}

// ── Panel ─────────────────────────────────────────────────────────────────────

let _panelWinId = null;

export function openEventPanel() {
  // If already open, focus it
  if (_panelWinId && document.getElementById(_panelWinId)) {
    window.wm?.focus(_panelWinId);
    return;
  }

  const html = `
    <div style="display:flex;flex-direction:column;height:100%;font-family:monospace;font-size:11px;background:#111;color:#ccc;">
      <div style="display:flex;align-items:center;gap:6px;padding:5px 8px;border-bottom:1px solid #333;flex-shrink:0;">
        <input id="ep-filter" type="text" value="-editor: -session: -wm:"
          placeholder="filter (e.g. beat: -wm:)"
          style="flex:1;background:#222;color:#ccc;border:1px solid #444;border-radius:3px;padding:2px 5px;font:11px monospace;outline:none;" />
        <button id="ep-clear"
          style="background:#333;color:#aaa;border:1px solid #444;border-radius:3px;padding:2px 7px;cursor:pointer;font:11px monospace;">
          clear
        </button>
      </div>
      <div id="ep-rows" style="flex:1;overflow-y:auto;padding:4px 0;"></div>
    </div>`;

  const winId = window.wm?.spawn('Event Stream', { html, w: 400, h: 340 });
  if (!winId) return;
  _panelWinId = winId;

  const winEl = document.getElementById(winId);
  if (!winEl) return;

  const filterInput = winEl.querySelector('#ep-filter');
  const clearBtn = winEl.querySelector('#ep-clear');
  const rowsEl = winEl.querySelector('#ep-rows');
  const rateMap = makeRateState();
  const MAX_ROWS = 80;

  function createRow(event, data) {
    const rowEl = document.createElement('div');
    rowEl.style.cssText =
      'padding:3px 8px;border-bottom:1px solid #1e1e1e;cursor:pointer;display:flex;flex-direction:column;gap:2px;';

    const headerEl = document.createElement('div');
    headerEl.style.cssText =
      'display:flex;align-items:baseline;gap:6px;white-space:nowrap;overflow:hidden;';

    const nameEl = document.createElement('span');
    nameEl.textContent = event;
    nameEl.style.cssText = 'color:#7bf;flex-shrink:0;';

    const badgeEl = document.createElement('span');
    badgeEl.style.cssText = 'color:#f90;font-size:10px;flex-shrink:0;';

    const payloadEl = document.createElement('span');
    payloadEl.textContent = repr(data);
    payloadEl.style.cssText = 'color:#888;overflow:hidden;text-overflow:ellipsis;flex:1;';

    headerEl.appendChild(nameEl);
    headerEl.appendChild(badgeEl);
    headerEl.appendChild(payloadEl);
    rowEl.appendChild(headerEl);

    // Expanded detail (hidden by default)
    const detailEl = document.createElement('pre');
    detailEl.style.cssText =
      'display:none;margin:0;color:#aaa;white-space:pre-wrap;word-break:break-all;font:11px monospace;border-top:1px solid #2a2a2a;padding-top:3px;';
    rowEl.appendChild(detailEl);

    let expanded = false;
    rowEl.addEventListener('click', () => {
      expanded = !expanded;
      if (expanded) {
        detailEl.textContent = JSON.stringify(data, null, 2);
        detailEl.style.display = 'block';
      } else {
        detailEl.style.display = 'none';
      }
    });

    return { rowEl, badgeEl, payloadEl };
  }

  const removeTap = addBusTap((event, data) => {
    // Scope to active run by default, unless filter overrides
    const filterStr = filterInput?.value ?? '';
    const hasPositive = filterStr
      .trim()
      .split(/\s+/)
      .some((p) => !p.startsWith('-'));
    if (!hasPositive && activeEditorId() == null) return;
    if (!matchesFilter(event, filterStr)) return;
    applyRateLimit(rateMap, event, data, rowsEl, MAX_ROWS, createRow);
  });

  clearBtn.addEventListener('click', () => {
    rowsEl.innerHTML = '';
    rateMap.clear();
  });

  // Clean up tap when the window is closed
  const observer = new MutationObserver(() => {
    if (!document.getElementById(winId)) {
      removeTap();
      if (_panelWinId === winId) _panelWinId = null;
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}
