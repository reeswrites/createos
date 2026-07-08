// inline-controls.js — Tier 1 Inline Controls (ADR 061).
//
// A bespoke, semantic editing widget scoped to ONE call's arguments inside a
// recognized route()/pipe() chain — e.g. `.scale(0,1,0,100)`'s four numbers as
// TWO coupled ranges, not four unrelated scrubbers. Distinct from a Tier 0 scrubber
// (one literal) and a Tier 2 chain inspector (whole chain, read-only).
//
// This module is the EDITOR-SIDE registry + the popup-panel DOM builders. It is
// deliberately CodeMirror-free (imports nothing from @codemirror/*) so it is unit
// testable by calling buildPanel with fake values + a spy onEdit. The editor
// plumbing — glyph widget, popup show/hide, arg-range tracking, view.dispatch — lives
// in inline-widgets.js (InlineControlWidget), which consults getInlineControl().
//
// A control:
//   { arity, glyph, title, buildPanel(values, onEdit) -> HTMLElement }
//   arity     — number of leading args it owns (all must be numeric literals to attach)
//   glyph     — the small inline affordance character
//   buildPanel(values, onEdit) — returns the popup contents; calls onEdit(newValues[])
//               (an array of `arity` numbers) live as the user drags.
//
// Controls are keyed by `${head}.${method}` (head = 'route' | 'pipe'), a STATIC,
// project-shipped set. A user's custom pipe.register stage gets no control (falls
// back to Tier 0). See ADR 061.

import { isValidColor } from '../api/visual/color.js';

const _controls = new Map(); // `${head}.${method}` → control

export function registerInlineControl(head, method, control) {
  _controls.set(`${head}.${method}`, control);
}

export function getInlineControl(head, method) {
  return _controls.get(`${head}.${method}`) ?? null;
}

// Test/introspection helper.
export function _inlineControlKeys() {
  return [..._controls.keys()];
}

// ── Pipe opts-object control (ADR 062) ──────────────────────────────────────────
// A generic-by-inference control over a stage's opts object — pixelate({blockSize:8}),
// ascii({cols,color}). Unlike the positional controls above (bespoke, registered), the
// fields are INFERRED from the object literal: each property's value-literal type picks
// the widget. This is correct here (not the redundant generic panel rejected for Tier 1)
// because pipe opts get zero Tier 0 coverage — Tier 0 skips the ObjectExpression arg. It
// also covers user pipe.register stages for free. Per-property: only literal-valued
// properties become fields; non-literal ones are skipped. See ADR 062.

// Infer editable fields from an ObjectExpression AST node. Pure (AST in, plain records
// out) so it is unit-testable without CodeMirror. Each field: { name, kind, value,
// from, to } where kind ∈ 'number'|'color'|'text'|'boolean' and from/to are the VALUE
// literal's char range (covers quotes for strings). Non-literal properties are dropped.
export function inferOptFields(objExpr) {
  if (objExpr?.type !== 'ObjectExpression') return [];
  const fields = [];
  for (const p of objExpr.properties) {
    if (p.type !== 'Property' || p.computed) continue;
    const name =
      p.key.type === 'Identifier'
        ? p.key.name
        : p.key.type === 'Literal'
          ? String(p.key.value)
          : null;
    if (!name) continue;
    const v = p.value;
    if (v.type !== 'Literal') continue;
    let kind;
    if (typeof v.value === 'number') kind = 'number';
    else if (typeof v.value === 'boolean') kind = 'boolean';
    else if (typeof v.value === 'string') kind = isValidColor(v.value) ? 'color' : 'text';
    else continue;
    fields.push({ name, kind, value: v.value, from: v.range[0], to: v.range[1] });
  }
  return fields;
}

// Format an edited opt value back to its source literal by kind. Pure/testable.
export function formatOptValue(kind, value) {
  if (kind === 'number') return String(Math.round(value * 1000) / 1000);
  if (kind === 'boolean') return String(!!value);
  return JSON.stringify(String(value)); // color / text — quoted
}

// ── DOM helpers ────────────────────────────────────────────────────────────────

function _numInput(value) {
  const inp = document.createElement('input');
  inp.type = 'number';
  inp.step = 'any';
  inp.className = 'ar-ictrl-num';
  inp.value = String(value);
  return inp;
}

// One labelled min→max range row. onChange(min, max) fires live on either input.
// Returns { el } — the row element.
function _rangeRow(label, minVal, maxVal, onChange) {
  const row = document.createElement('div');
  row.className = 'ar-ictrl-row';

  const lab = document.createElement('span');
  lab.className = 'ar-ictrl-label';
  lab.textContent = label;

  const lo = _numInput(minVal);
  const arrow = document.createElement('span');
  arrow.className = 'ar-ictrl-arrow';
  arrow.textContent = '→';
  const hi = _numInput(maxVal);

  const fire = () => {
    const a = Number(lo.value);
    const b = Number(hi.value);
    if (Number.isFinite(a) && Number.isFinite(b)) onChange(a, b);
  };
  lo.addEventListener('input', fire);
  hi.addEventListener('input', fire);

  row.append(lab, lo, arrow, hi);
  return { el: row };
}

// ── Built-in controls (v1: route positional-numeric methods) ────────────────────

// scale(a, b, c, d) — a two-coupled-range remap: input a→b mapped to output c→d.
// The semantic lift over four flat scrubbers: the four numbers read as two ranges.
registerInlineControl('route', 'scale', {
  arity: 4,
  glyph: '⇄',
  title: 'scale — edit input→output ranges',
  buildPanel(values, onEdit) {
    const v = values.slice(0, 4);
    const panel = document.createElement('div');
    panel.className = 'ar-ictrl-panel';
    const inRow = _rangeRow('in', v[0], v[1], (a, b) => {
      v[0] = a;
      v[1] = b;
      onEdit(v.slice());
    });
    const outRow = _rangeRow('out', v[2], v[3], (c, d) => {
      v[2] = c;
      v[3] = d;
      onEdit(v.slice());
    });
    panel.append(inRow.el, outRow.el);
    return panel;
  },
});

// clamp / norm / gate (lo, hi) — one min→max range. Shared builder proves the
// registry holds a reused control shape across several methods.
const rangeControl = {
  arity: 2,
  glyph: '⇄',
  title: 'edit low→high range',
  buildPanel(values, onEdit) {
    const v = values.slice(0, 2);
    const panel = document.createElement('div');
    panel.className = 'ar-ictrl-panel';
    const row = _rangeRow('range', v[0], v[1], (a, b) => {
      v[0] = a;
      v[1] = b;
      onEdit(v.slice());
    });
    panel.append(row.el);
    return panel;
  },
};
registerInlineControl('route', 'clamp', rangeControl);
registerInlineControl('route', 'norm', rangeControl);
registerInlineControl('route', 'gate', rangeControl);
