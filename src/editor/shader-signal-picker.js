// Shader signal picker: detects cursor on shader.set(...) and shows a live-signal
// dropdown so users can bind audio.level / sensors.mouse().x / etc. without
// hand-wiring setInterval code.

import { StateField, StateEffect } from '@codemirror/state';
import { showTooltip } from '@codemirror/view';

// ── Available signal sources ──────────────────────────────────────────────────

export const SIGNAL_SOURCES = [
  // Audio
  { label: 'audio.level',      code: 'audio.level',          category: 'Audio' },
  { label: 'audio.fft bass',   code: 'audio.fft.bass',       category: 'Audio' },
  { label: 'audio.fft mid',    code: 'audio.fft.mid',        category: 'Audio' },
  { label: 'audio.fft high',   code: 'audio.fft.high',       category: 'Audio' },
  { label: 'audio.fft value',  code: 'audio.fft.value',      category: 'Audio' },
  // Mouse — hold('window:mouse:move') for live position
  { label: 'mouse.x',               code: 'hold(\'window:mouse:move\').x / window.innerWidth',  category: 'Mouse' },
  { label: 'mouse.y',               code: 'hold(\'window:mouse:move\').y / window.innerHeight', category: 'Mouse' },
  // Motion — hold('sensor:motion') for live device orientation
  { label: 'motion.magnitude',      code: 'hold(\'sensor:motion\').magnitude',           category: 'Motion' },
  { label: 'motion.az',             code: 'hold(\'sensor:motion\').az',                  category: 'Motion' },
  // Video brightness
  { label: 'cam brightness',        code: 'video.signal("camera").brightness',    category: 'Camera' },
  { label: 'cam motion',            code: 'video.signal("camera").motion',        category: 'Camera' },
  // Clocks
  { label: 'time (0–1 cycle/4s)',   code: '(Date.now() % 4000) / 4000',           category: 'Time' },
  { label: 'sin(time)',             code: 'Math.sin(Date.now() / 1000) * 0.5 + 0.5', category: 'Time' },
];

// ── Cursor pattern detection ──────────────────────────────────────────────────

// Returns { varName, argFrom, argTo } when cursor is inside a .set(ARG) call.
function detectSetCall(state) {
  const cursor = state.selection.main.head;
  const doc    = state.doc.toString();

  // Scan backwards from cursor for the opening (.set(
  let depth = 0;
  let i     = cursor - 1;
  while (i >= 0 && depth <= 0) {
    const ch = doc[i];
    if (ch === ')') depth++;
    else if (ch === '(') {
      if (depth === 0) break;
      depth--;
    }
    i--;
  }
  if (i < 0) return null;

  // i is now pointing at the '(' — check .set( precedes it
  const before = doc.slice(Math.max(0, i - 20), i);
  const m = before.match(/(\w+)\.set\s*$/);
  if (!m) return null;

  const argFrom = i + 1;
  // find closing )
  let end = cursor;
  let d   = 1;
  while (end < doc.length && d > 0) {
    if (doc[end] === '(') d++;
    else if (doc[end] === ')') d--;
    end++;
  }
  const argTo = end - 1;

  return { varName: m[1], argFrom, argTo };
}

// ── Tooltip DOM ───────────────────────────────────────────────────────────────

function buildPickerDOM(view, varName, argFrom, argTo) {
  const dom = document.createElement('div');
  dom.className = 'ar-signal-picker';

  const header = document.createElement('div');
  header.className = 'ar-signal-picker-header';
  header.textContent = `${varName}.set( signal source )`;
  dom.appendChild(header);

  const categories = [...new Set(SIGNAL_SOURCES.map(s => s.category))];

  for (const cat of categories) {
    const group = document.createElement('div');
    group.className = 'ar-signal-group';

    const label = document.createElement('div');
    label.className = 'ar-signal-group-label';
    label.textContent = cat;
    group.appendChild(label);

    for (const sig of SIGNAL_SOURCES.filter(s => s.category === cat)) {
      const btn = document.createElement('button');
      btn.className = 'ar-signal-btn';
      btn.textContent = sig.label;
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        // Replace the argument with the chosen signal source expression,
        // wrapped in a setInterval so it stays live.
        const wiring = `setInterval(() => ${varName}.set(${sig.code}), 16)`;
        // Find the full .set(ARG) call to replace (including the set call itself)
        const doc   = view.state.doc.toString();
        const match = doc.slice(Math.max(0, argFrom - 30), argTo + 1).match(/\.set\s*\(.*\)$/s);
        if (match) {
          const replaceFrom = argFrom - 30 + doc.slice(Math.max(0, argFrom - 30), argTo + 1).lastIndexOf('.set');
          const replaceTo   = argTo + 1;
          view.dispatch({ changes: { from: replaceFrom, to: replaceTo, insert: '' } });
        }
        view.dispatch({ changes: { from: argFrom, to: argTo, insert: sig.code } });
        // Insert setInterval line below current line
        const line = view.state.doc.lineAt(argFrom);
        const lineEnd = line.to;
        view.dispatch({
          changes: { from: lineEnd, to: lineEnd, insert: `\n${wiring};` },
        });
      });
      group.appendChild(btn);
    }
    dom.appendChild(group);
  }

  return dom;
}

// ── State field ───────────────────────────────────────────────────────────────

function computePickerTooltip(state) {
  const match = detectSetCall(state);
  if (!match) return null;

  return {
    pos: state.selection.main.head,
    above: true,
    strictSide: false,
    create(view) {
      const dom = buildPickerDOM(view, match.varName, match.argFrom, match.argTo);
      return { dom };
    },
  };
}

export const shaderSignalPickerField = StateField.define({
  create: (state) => computePickerTooltip(state),
  update(tooltip, tr) {
    if (!tr.docChanged && !tr.selection) return tooltip;
    return computePickerTooltip(tr.state);
  },
  provide: f => showTooltip.from(f),
});

export function shaderSignalPickerExtension() {
  return [shaderSignalPickerField];
}
