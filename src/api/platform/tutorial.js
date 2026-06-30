// tutorial.js — interactive tutorial as a first-class WM window.
//
// "Everything is a window": the tutorial is a plain `type:'html'` window (its
// body is real DOM in the main page, not an iframe), so run buttons call the
// imported `insertSnippet` directly — no postMessage bridge needed. Lesson
// content lives in /createos/tutorial.json (8 lessons). One lesson renders at a
// time; Prev/Next walk them; the current index persists in localStorage.
//
// Not a widget-shell widget (that chassis is for frame-based art tools with
// history/autosave) — this is a read-only content browser, closer in spirit to
// the demo gallery, but it must be a draggable/minimizable window, not a modal.

import { insertSnippet } from '../../editor/active-editor.js';
import { getFocusedWinId } from '../wm/wm.js';

const WIN_ID = 'win-tutorial';
const LS_KEY = 'vl_tutorial_lesson';
const DATA_URL = '/createos/tutorial.json';

let _data = null; // parsed tutorial.json
let _idx = 0; // current lesson index
let _keysWired = false;

// ── Tiny markdown renderer ─────────────────────────────────────────────────
// Prose uses only **bold**, `inline code`, and \n\n paragraph breaks. Escape
// HTML first, then apply markdown tokens (neither `*` nor `` ` `` is
// HTML-special, so they survive escaping intact).
function mdToHtml(src) {
  const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return (src ?? '')
    .split(/\n\n+/)
    .map((para) => {
      let h = esc(para);
      h = h.replace(/`([^`]+)`/g, '<code class="ar-tut-code">$1</code>');
      h = h.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      return `<p class="ar-tut-p">${h}</p>`;
    })
    .join('');
}

function escAttr(s) {
  return (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── One-time stylesheet ────────────────────────────────────────────────────
// Matches the OS palette (Arial, #1565c0 accent, #444 text, light window body)
// rather than a custom theme. Reflows cleanly down to narrow widths.
function ensureStyles() {
  if (document.getElementById('ar-tutorial-css')) return;
  const css = `
    .ar-tut { display:flex; flex-direction:column; height:100%; font-family:Arial, sans-serif; color:#333; background:#fff; }
    .ar-tut-scroll { flex:1; min-height:0; overflow-y:auto; padding:14px 16px 18px; }
    .ar-tut-eyebrow { font-size:10px; font-weight:bold; letter-spacing:0.8px; text-transform:uppercase; color:#1565c0; margin:0 0 2px; }
    .ar-tut-title { font-size:18px; font-weight:700; margin:0 0 10px; color:#222; line-height:1.25; }
    .ar-tut-concept { font-size:13px; font-style:italic; color:#555; background:#f0f4fb; border-left:3px solid #1565c0; border-radius:0 4px 4px 0; padding:8px 11px; margin:0 0 14px; line-height:1.45; }
    .ar-tut-p { font-size:13px; line-height:1.6; margin:0 0 11px; }
    .ar-tut-code { font-family:'Menlo','Monaco','Courier New',monospace; font-size:12px; background:#eef0f5; color:#1565c0; padding:1px 4px; border-radius:3px; }
    .ar-tut-ex { border:1px solid #e0e4ea; border-radius:6px; margin:0 0 11px; overflow:hidden; }
    .ar-tut-ex-head { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:7px 10px; background:#f5f7fa; border-bottom:1px solid #e8ebf0; }
    .ar-tut-ex-label { font-size:12px; font-weight:600; color:#444; flex:1; min-width:0; }
    .ar-tut-run { flex-shrink:0; display:inline-flex; align-items:center; gap:5px; padding:5px 11px; border:none; border-radius:6px; background:#2e7d32; color:#fff; box-shadow:0 3px 0 #1a4d1d; cursor:pointer; font-family:Arial, sans-serif; font-size:11px; font-weight:600; white-space:nowrap; transition:transform .07s, box-shadow .07s; }
    .ar-tut-run:hover { background:#388e3c; }
    .ar-tut-run:active { box-shadow:0 1px 0 #1a4d1d; transform:translateY(2px); }
    .ar-tut-run.copied { background:#1565c0; box-shadow:0 3px 0 #0a3d8a; }
    .ar-tut-pre { margin:0; padding:9px 11px; background:#1e1e2e; color:#cdd6f4; font-family:'Menlo','Monaco','Courier New',monospace; font-size:11px; line-height:1.5; overflow-x:auto; white-space:pre; }
    .ar-tut-callout { border-radius:6px; padding:9px 12px; margin:14px 0 0; font-size:12.5px; line-height:1.5; }
    .ar-tut-insight { background:#fff8e6; border-left:3px solid #f5a623; color:#5c4a1a; }
    .ar-tut-extend { background:#eef7f0; border-left:3px solid #2e7d32; color:#244c2a; margin-top:10px; }
    .ar-tut-callout-tag { display:block; font-size:9.5px; font-weight:bold; letter-spacing:0.8px; text-transform:uppercase; opacity:0.75; margin-bottom:3px; }
    .ar-tut-nav { flex-shrink:0; display:flex; align-items:center; justify-content:space-between; gap:8px; padding:8px 12px; border-top:1px solid #e0e4ea; background:#f7f8fa; }
    .ar-tut-nav button { display:inline-flex; align-items:center; gap:5px; padding:5px 12px; border:none; border-radius:7px; background:#e2e6ec; color:#444; box-shadow:0 3px 0 #b4b8c0; cursor:pointer; font-family:Arial, sans-serif; font-size:12px; transition:transform .07s, box-shadow .07s; }
    .ar-tut-nav button:hover:not(:disabled) { background:#d4d8e0; }
    .ar-tut-nav button:active:not(:disabled) { box-shadow:0 1px 0 #b4b8c0; transform:translateY(2px); }
    .ar-tut-nav button:disabled { opacity:0.4; cursor:default; box-shadow:none; }
    .ar-tut-count { font-size:12px; color:#666; font-variant-numeric:tabular-nums; }
  `;
  const style = document.createElement('style');
  style.id = 'ar-tutorial-css';
  style.textContent = css;
  document.head.appendChild(style);
}

// ── Render the current lesson into the window body ─────────────────────────
function render(body) {
  const lessons = _data?.lessons ?? [];
  if (!lessons.length) {
    body.innerHTML = `<div class="ar-tut"><div class="ar-tut-scroll"><p class="ar-tut-p">No lessons found.</p></div></div>`;
    return;
  }
  _idx = Math.max(0, Math.min(_idx, lessons.length - 1));
  const lesson = lessons[_idx];

  const exHtml = (lesson.examples ?? [])
    .map(
      (ex) => `
      <div class="ar-tut-ex">
        <div class="ar-tut-ex-head">
          <span class="ar-tut-ex-label">${escAttr(ex.label)}</span>
          <button class="ar-tut-run" data-ex="${escAttr(ex.id)}">▶ Run in Editor</button>
        </div>
        <pre class="ar-tut-pre">${escAttr(ex.code)}</pre>
      </div>`,
    )
    .join('');

  body.innerHTML = `
    <div class="ar-tut">
      <div class="ar-tut-scroll">
        <p class="ar-tut-eyebrow">Lesson ${lesson.number}</p>
        <h2 class="ar-tut-title">${escAttr(lesson.title)}</h2>
        <div class="ar-tut-concept">${escAttr(lesson.concept)}</div>
        ${mdToHtml(lesson.prose)}
        ${exHtml}
        ${
          lesson.insight
            ? `<div class="ar-tut-callout ar-tut-insight"><span class="ar-tut-callout-tag">Insight</span>${escAttr(lesson.insight)}</div>`
            : ''
        }
        ${
          lesson.extend
            ? `<div class="ar-tut-callout ar-tut-extend"><span class="ar-tut-callout-tag">Try it</span>${escAttr(lesson.extend)}</div>`
            : ''
        }
      </div>
      <div class="ar-tut-nav">
        <button class="ar-tut-prev" ${_idx === 0 ? 'disabled' : ''}>◀ Prev</button>
        <span class="ar-tut-count">${_idx + 1} / ${lessons.length}</span>
        <button class="ar-tut-next" ${_idx === lessons.length - 1 ? 'disabled' : ''}>Next ▶</button>
      </div>
    </div>`;

  // Title reflects the current lesson.
  const win = document.getElementById(WIN_ID);
  const titleEl = win?.querySelector('.wm-title');
  if (titleEl) titleEl.textContent = `Tutorial — Lesson ${lesson.number}: ${lesson.title}`;

  // Wire run buttons → insertSnippet (active editor).
  body.querySelectorAll('.ar-tut-run').forEach((btn) => {
    btn.addEventListener('click', () => {
      const ex = lesson.examples.find((e) => e.id === btn.dataset.ex);
      if (!ex) return;
      const ok = insertSnippet(ex.code);
      btn.textContent = ok ? '✓ Inserted' : '✓ Copied';
      btn.classList.add('copied');
      setTimeout(() => {
        btn.textContent = '▶ Run in Editor';
        btn.classList.remove('copied');
      }, 1400);
    });
  });

  body.querySelector('.ar-tut-prev')?.addEventListener('click', () => go(-1, body));
  body.querySelector('.ar-tut-next')?.addEventListener('click', () => go(1, body));
}

function go(delta, body) {
  const n = _data?.lessons?.length ?? 0;
  const next = Math.max(0, Math.min(_idx + delta, n - 1));
  if (next === _idx) return;
  _idx = next;
  try {
    localStorage.setItem(LS_KEY, String(_idx));
  } catch {}
  render(body);
  body.querySelector('.ar-tut-scroll')?.scrollTo(0, 0);
}

// Left/right arrows navigate lessons while the tutorial window is focused.
function wireKeys() {
  if (_keysWired) return;
  _keysWired = true;
  window.addEventListener('keydown', (e) => {
    if (getFocusedWinId() !== WIN_ID) return;
    const win = document.getElementById(WIN_ID);
    const body = win?.querySelector('.wm-body');
    if (!body) return;
    // Don't hijack arrows while typing inside the tutorial window itself (e.g.
    // renaming its title). Editors/inputs elsewhere keep DOM focus but live in a
    // different WM window, so the getFocusedWinId() gate already excludes them.
    const ae = document.activeElement;
    if (
      ae &&
      win.contains(ae) &&
      (ae.tagName === 'INPUT' ||
        ae.tagName === 'TEXTAREA' ||
        ae.getAttribute('contenteditable') === 'true')
    )
      return;
    if (e.key === 'ArrowRight') {
      go(1, body);
      e.preventDefault();
    } else if (e.key === 'ArrowLeft') {
      go(-1, body);
      e.preventDefault();
    }
  });
}

async function loadData() {
  if (_data) return _data;
  const res = await fetch(DATA_URL);
  _data = await res.json();
  const saved = parseInt(localStorage.getItem(LS_KEY) ?? '', 10);
  if (Number.isInteger(saved)) _idx = saved;
  return _data;
}

// Open the tutorial window — or focus/restore it if already open.
export async function openTutorial() {
  const existing = document.getElementById(WIN_ID);
  if (existing) {
    // Restore from the taskbar if minimized, otherwise just bring to front.
    const chip = document.querySelector(`#wm-taskbar [data-win-id="${WIN_ID}"]`);
    if (chip) chip.click();
    else window.wm?.focus(WIN_ID);
    return;
  }

  ensureStyles();
  wireKeys();

  const desk = document.getElementById('desktop');
  const w = 440;
  const h = Math.min(620, (desk?.offsetHeight ?? 700) - 60);
  // Park it toward the right so it sits beside the editor by default.
  const x = Math.max(20, (desk?.offsetWidth ?? 1000) - w - 30);
  const y = 40;

  window.wm?.spawn('Tutorial', { id: WIN_ID, type: 'html', html: '', w, h, x, y, audio: false });

  const body = document.getElementById(WIN_ID)?.querySelector('.wm-body');
  if (!body) return;
  body.innerHTML = `<div class="ar-tut"><div class="ar-tut-scroll"><p class="ar-tut-p" style="color:#888;">Loading…</p></div></div>`;

  try {
    await loadData();
    render(body);
  } catch (err) {
    body.innerHTML = `<div class="ar-tut"><div class="ar-tut-scroll"><p class="ar-tut-p" style="color:#c62828;">Failed to load tutorial: ${escAttr(err.message)}</p></div></div>`;
  }
}
