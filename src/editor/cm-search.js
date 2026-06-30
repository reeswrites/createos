import { EditorView, Decoration } from '@codemirror/view';
import { StateField, StateEffect, RangeSetBuilder } from '@codemirror/state';

// ── State field for search marks ──────────────────────────────────────────────

const setSearchMarks = StateEffect.define();

export const searchMarksField = StateField.define({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) if (e.is(setSearchMarks)) deco = e.value;
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

// ── Search panel ──────────────────────────────────────────────────────────────

export function initSearch(view, container) {
  let matches = [];
  let matchIndex = -1;
  let query = '';
  let panel = null;
  let input = null;
  let countEl = null;

  function dispatchMarks(decos) {
    view.dispatch({ effects: setSearchMarks.of(decos) });
  }

  function buildMarks(activeIdx) {
    const builder = new RangeSetBuilder();
    for (let i = 0; i < matches.length; i++) {
      const { from, to } = matches[i];
      builder.add(
        from,
        to,
        Decoration.mark({
          class: i === activeIdx ? 'cm-search-active' : 'cm-search-match',
        }),
      );
    }
    dispatchMarks(builder.finish());
  }

  function findMatches(q) {
    matches = [];
    if (!q) {
      dispatchMarks(Decoration.none);
      updateCount();
      return;
    }
    const text = view.state.doc.toString();
    const qLow = q.toLowerCase();
    const tLow = text.toLowerCase();
    let pos = 0;
    while (pos < tLow.length) {
      const idx = tLow.indexOf(qLow, pos);
      if (idx === -1) break;
      matches.push({ from: idx, to: idx + q.length });
      pos = idx + 1;
    }
  }

  function goTo(i) {
    if (!matches.length) return;
    matchIndex = ((i % matches.length) + matches.length) % matches.length;
    buildMarks(matchIndex);
    view.dispatch({
      effects: EditorView.scrollIntoView(matches[matchIndex].from, { y: 'center' }),
      selection: { anchor: matches[matchIndex].from },
    });
    updateCount();
  }

  function runSearch(q) {
    query = q;
    findMatches(q);
    if (matches.length) goTo(matchIndex >= 0 ? Math.min(matchIndex, matches.length - 1) : 0);
    else {
      dispatchMarks(Decoration.none);
      updateCount();
    }
  }

  function updateCount() {
    if (!countEl) return;
    countEl.textContent = matches.length
      ? `${matchIndex + 1}/${matches.length}`
      : query
        ? 'no results'
        : '';
  }

  function openPanel() {
    if (panel) {
      input.focus();
      input.select();
      return;
    }

    panel = document.createElement('div');
    panel.className = 'cm-search-panel';

    input = document.createElement('input');
    input.className = 'cm-search-input';
    input.placeholder = 'Find…';
    input.spellcheck = false;

    countEl = document.createElement('span');
    countEl.className = 'cm-search-count';

    const prev = document.createElement('button');
    prev.className = 'cm-search-btn';
    prev.title = 'Previous (Shift+Enter)';
    prev.textContent = '↑';

    const next = document.createElement('button');
    next.className = 'cm-search-btn';
    next.title = 'Next (Enter)';
    next.textContent = '↓';

    const close = document.createElement('button');
    close.className = 'cm-search-btn cm-search-close';
    close.title = 'Close (Escape)';
    close.textContent = '✕';

    panel.append(input, countEl, prev, next, close);
    container.appendChild(panel);

    input.addEventListener('input', () => runSearch(input.value));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.shiftKey ? goTo(matchIndex - 1) : goTo(matchIndex + 1);
      }
      if (e.key === 'Escape') closePanel();
      e.stopPropagation();
    });
    prev.addEventListener('click', () => goTo(matchIndex - 1));
    next.addEventListener('click', () => goTo(matchIndex + 1));
    close.addEventListener('click', closePanel);

    input.focus();
    const sel = view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to);
    if (sel && !sel.includes('\n')) {
      input.value = sel;
      runSearch(sel);
    }
  }

  function closePanel() {
    if (!panel) return;
    panel.remove();
    panel = null;
    input = null;
    countEl = null;
    dispatchMarks(Decoration.none);
    matches = [];
    matchIndex = -1;
    query = '';
    view.focus();
  }

  return { open: openPanel, close: closePanel };
}
