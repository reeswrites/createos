import esprima from 'esprima';
import { EditorView, Decoration, WidgetType, ViewPlugin } from '@codemirror/view';
import { StateField, StateEffect, RangeSetBuilder } from '@codemirror/state';
import { resolveParamHint, calleePath, chainHead } from './param-hints.js';
import { getInlineControl, inferOptFields, formatOptValue } from './inline-controls.js';
import { isValidColor, hexToHsl, hslToHex, resolveToHex } from '../api/visual/color.js';

// ── Color popup (singleton) ───────────────────────────────────────────────────

let _popup = null;

function getColorPopup() {
  if (_popup) return _popup;

  const el = document.createElement('div');
  el.className = 'ar-color-popup';
  el.innerHTML = `
    <div class="ar-cp-preview"></div>
    <div class="ar-cp-row"><span>H</span><input type="range" class="ar-cp-h" min="0" max="359"></div>
    <div class="ar-cp-row"><span>S</span><input type="range" class="ar-cp-s" min="0" max="100"></div>
    <div class="ar-cp-row"><span>L</span><input type="range" class="ar-cp-l" min="5" max="95"></div>
    <input type="text" class="ar-cp-hex" maxlength="7" spellcheck="false">
  `;
  el.style.display = 'none';
  document.body.appendChild(el);

  const preview = el.querySelector('.ar-cp-preview');
  const hSlider = el.querySelector('.ar-cp-h');
  const sSlider = el.querySelector('.ar-cp-s');
  const lSlider = el.querySelector('.ar-cp-l');
  const hexInput = el.querySelector('.ar-cp-hex');

  let h = 0,
    s = 100,
    l = 50;
  let onChangeCb = null;
  let anchorEl = null;

  function updateSliderBg() {
    hSlider.style.background = `linear-gradient(to right,
      hsl(0,${s}%,${l}%),hsl(60,${s}%,${l}%),hsl(120,${s}%,${l}%),
      hsl(180,${s}%,${l}%),hsl(240,${s}%,${l}%),hsl(300,${s}%,${l}%),hsl(359,${s}%,${l}%))`;
    sSlider.style.background = `linear-gradient(to right,hsl(${h},0%,${l}%),hsl(${h},100%,${l}%))`;
    lSlider.style.background = `linear-gradient(to right,hsl(${h},${s}%,5%),hsl(${h},${s}%,50%),hsl(${h},${s}%,95%))`;
  }

  function emitColor() {
    const hex = hslToHex(h, s, l);
    preview.style.background = hex;
    hexInput.value = hex;
    updateSliderBg();
    onChangeCb?.(hex);
  }

  hSlider.addEventListener('input', () => {
    h = +hSlider.value;
    emitColor();
  });
  sSlider.addEventListener('input', () => {
    s = +sSlider.value;
    emitColor();
  });
  lSlider.addEventListener('input', () => {
    l = +lSlider.value;
    emitColor();
  });

  hexInput.addEventListener('change', () => {
    const v = hexInput.value.trim();
    if (/^#[0-9a-f]{6}$/i.test(v)) {
      [h, s, l] = hexToHsl(v);
      hSlider.value = h;
      sSlider.value = s;
      lSlider.value = l;
      emitColor();
    }
  });

  el.addEventListener('mousedown', (e) => e.stopImmediatePropagation());

  document.addEventListener('mousedown', (e) => {
    if (el.style.display === 'none') return;
    if (!el.contains(e.target) && e.target !== anchorEl && !anchorEl?.contains(e.target)) hide();
  });

  function reposition() {
    if (!anchorEl || el.style.display === 'none') return;
    const r = anchorEl.getBoundingClientRect();
    let left = r.left;
    let top = r.bottom + 4;
    if (left + 190 > window.innerWidth) left = window.innerWidth - 194;
    if (top + 160 > window.innerHeight) top = r.top - 160 - 4;
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }

  function show(anchor, hex, onChange) {
    anchorEl = anchor;
    onChangeCb = onChange;
    const resolved = resolveToHex(hex);
    [h, s, l] = hexToHsl(resolved);
    hSlider.value = h;
    sSlider.value = s;
    lSlider.value = l;
    preview.style.background = resolved;
    hexInput.value = resolved;
    updateSliderBg();
    el.style.display = 'block';
    reposition();
  }

  function hide() {
    if (el.style.display === 'none') return;
    el.style.display = 'none';
    onChangeCb = null;
    anchorEl = null;
  }

  function isOpen() {
    return el.style.display !== 'none';
  }
  function currentAnchor() {
    return anchorEl;
  }

  _popup = { show, hide, isOpen, currentAnchor };
  return _popup;
}

// ── Inline-control popup (singleton) ──────────────────────────────────────────
// Generic anchored popup hosting arbitrary panel DOM — the Tier 1 Inline Control
// panels (ADR 061). Separate from the colour popup (which owns its HSL sliders).

let _ctrlPopup = null;

function getControlPopup() {
  if (_ctrlPopup) return _ctrlPopup;

  const el = document.createElement('div');
  el.className = 'ar-ictrl-popup';
  el.style.display = 'none';
  document.body.appendChild(el);

  let anchorEl = null;
  let onCloseCb = null;

  el.addEventListener('mousedown', (e) => e.stopImmediatePropagation());
  document.addEventListener('mousedown', (e) => {
    if (el.style.display === 'none') return;
    if (!el.contains(e.target) && e.target !== anchorEl && !anchorEl?.contains(e.target)) hide();
  });

  function reposition() {
    if (!anchorEl || el.style.display === 'none') return;
    const r = anchorEl.getBoundingClientRect();
    const w = el.offsetWidth || 220;
    const h = el.offsetHeight || 120;
    let left = r.left;
    let top = r.bottom + 4;
    if (left + w > window.innerWidth) left = window.innerWidth - w - 4;
    if (top + h > window.innerHeight) top = r.top - h - 4;
    el.style.left = `${Math.max(4, left)}px`;
    el.style.top = `${Math.max(4, top)}px`;
  }

  function show(anchor, content, onClose) {
    anchorEl = anchor;
    onCloseCb = onClose ?? null;
    el.innerHTML = '';
    el.appendChild(content);
    el.style.display = 'block';
    reposition();
  }

  function hide() {
    if (el.style.display === 'none') return;
    el.style.display = 'none';
    el.innerHTML = '';
    anchorEl = null;
    const cb = onCloseCb;
    onCloseCb = null;
    cb?.();
  }

  function isOpen() {
    return el.style.display !== 'none';
  }
  function currentAnchor() {
    return anchorEl;
  }

  _ctrlPopup = { show, hide, isOpen, currentAnchor };
  return _ctrlPopup;
}

// ── State machinery ───────────────────────────────────────────────────────────

const setWidgetsEffect = StateEffect.define();
const setGhostEffect = StateEffect.define();
const setInlayEffect = StateEffect.define();

export const toggleInlayHintsEffect = StateEffect.define();

export const inlayHintsEnabledField = StateField.define({
  create: () => false,
  update(enabled, tr) {
    for (const e of tr.effects) if (e.is(toggleInlayHintsEffect)) return e.value;
    return enabled;
  },
});

export const inlayField = StateField.define({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) if (e.is(setInlayEffect)) deco = e.value;
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

export const widgetsField = StateField.define({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) if (e.is(setWidgetsEffect)) deco = e.value;
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

export const ghostField = StateField.define({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) if (e.is(setGhostEffect)) deco = e.value;
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

// ── Widget types ──────────────────────────────────────────────────────────────

export class ColorSwatchWidget extends WidgetType {
  constructor(colorStr, argFrom, argLength) {
    super();
    this.colorStr = colorStr;
    this.argFrom = argFrom;
    this.argLength = argLength;
  }

  eq(other) {
    return this.colorStr === other.colorStr && this.argFrom === other.argFrom;
  }

  toDOM(view) {
    const hex = resolveToHex(this.colorStr);
    const swatch = document.createElement('span');
    swatch.className = 'ar-color-swatch';
    swatch.style.background = hex;
    swatch.title = this.colorStr;

    let currentLength = this.argLength;

    swatch.addEventListener('mousedown', (e) => e.stopImmediatePropagation());
    swatch.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const popup = getColorPopup();
      if (popup.isOpen() && popup.currentAnchor() === swatch) {
        popup.hide();
      } else {
        popup.show(swatch, hex, (newHex) => {
          const newStr = `"${newHex}"`;
          view.dispatch({
            changes: { from: this.argFrom, to: this.argFrom + currentLength, insert: newStr },
          });
          currentLength = newStr.length;
          swatch.style.background = newHex;
          swatch.title = newHex;
        });
      }
    });

    return swatch;
  }
}

export class ScrubWidget extends WidgetType {
  constructor(value, argFrom, argLength, setDragging) {
    super();
    this.value = value;
    this.argFrom = argFrom;
    this.argLength = argLength;
    this._setDragging = setDragging;
  }

  eq(other) {
    return this.value === other.value && this.argFrom === other.argFrom;
  }

  toDOM(view) {
    const scrub = document.createElement('span');
    scrub.className = 'ar-scrub';
    scrub.textContent = String(this.value);
    scrub.title = 'Alt-drag to scrub value';

    scrub.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      // Plain drag must reach CodeMirror so text selection works; scrubbing only
      // hijacks the drag when Alt/Option is held. Without this gate, dragging a
      // selection across any numeric call-arg scrubs the value instead of selecting.
      if (!e.altKey) return;
      e.preventDefault();
      this._setDragging(true);
      scrub.classList.add('ar-scrub-active');

      const startX = e.clientX;
      const startVal = this.value;
      const isInt = Number.isInteger(startVal);
      const mag = Math.abs(startVal) || 1;
      const step = mag >= 100 ? 2 : mag >= 10 ? 1 : 0.1;

      let currentFrom = this.argFrom;
      let currentLength = this.argLength;
      let currentVal = startVal;

      const onMove = (ev) => {
        const delta = ev.clientX - startX;
        let newVal = startVal + Math.round(delta / 3) * step;
        newVal = isInt ? Math.round(newVal) : Math.round(newVal * 10) / 10;
        if (newVal === currentVal) return;

        const newStr = String(newVal);
        view.dispatch({
          changes: { from: currentFrom, to: currentFrom + currentLength, insert: newStr },
        });
        currentLength = newStr.length;
        currentVal = newVal;
        scrub.textContent = newStr;
      };

      const onUp = () => {
        scrub.classList.remove('ar-scrub-active');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        this._setDragging(false);
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    return scrub;
  }
}

// Tier 1 Inline Control glyph (ADR 061): a small affordance after a route()/pipe()
// chain method that opens a bespoke, semantic control panel in a popup. `args` are
// the leading numeric-literal arg positions {value, from, to} captured at build time.
export class InlineControlWidget extends WidgetType {
  constructor(key, control, args, setDragging) {
    super();
    this.key = key; // encodes head.method + arg positions/values → drives eq()
    this.control = control;
    this.args = args;
    this._setDragging = setDragging;
  }

  eq(other) {
    return this.key === other.key;
  }

  toDOM(view) {
    const glyph = document.createElement('span');
    glyph.className = 'ar-inline-ctrl';
    glyph.textContent = this.control.glyph;
    glyph.title = this.control.title;
    glyph.addEventListener('mousedown', (e) => e.stopImmediatePropagation());
    glyph.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const popup = getControlPopup();
      if (popup.isOpen() && popup.currentAnchor() === glyph) {
        popup.hide();
        return;
      }
      // Mutable per-arg state for range tracking across successive edits, sorted by
      // source position (args arrive in order).
      const state = this.args.map((a) => ({
        from: a.from,
        len: a.to - a.from,
        value: a.value,
      }));
      const panel = this.control.buildPanel(
        state.map((s) => s.value),
        (newValues) => this._applyEdit(view, state, newValues),
      );
      // Suppress the doc-change rebuild while the popup is open so this glyph (the
      // popup anchor) is not destroyed mid-edit; releasing reschedules a rebuild.
      this._setDragging(true);
      popup.show(glyph, panel, () => this._setDragging(false));
    });
    return glyph;
  }

  _applyEdit(view, state, newValues) {
    const changes = [];
    for (let i = 0; i < state.length; i++) {
      const s = state[i];
      const val = newValues[i];
      // Round to 3 decimals to avoid float noise; integers render without a decimal,
      // fractions are allowed (a `0..1` range field must not lock to ints — ADR 061).
      const str = String(Math.round(val * 1000) / 1000);
      s._newStr = str;
      if (str !== String(s.value)) changes.push({ from: s.from, to: s.from + s.len, insert: str });
    }
    if (changes.length) view.dispatch({ changes });
    // Re-derive froms/lens after the atomic edit — positions shift by cumulative
    // length delta of earlier args (state is in ascending source order).
    let shift = 0;
    for (const s of state) {
      s.from += shift;
      const newLen = s._newStr.length;
      shift += newLen - s.len;
      s.len = newLen;
      s.value = Number(s._newStr);
    }
  }
}

// Pipe opts-object control (ADR 062): a glyph after a pipe chain method whose sole arg
// is an object literal, opening a popup with one field per literal-valued property —
// fields inferred (number input / colour swatch / text / checkbox), not registered.
export class ObjectControlWidget extends WidgetType {
  constructor(key, fields, setDragging) {
    super();
    this.key = key;
    this.fields = fields; // [{ name, kind, value, from, to }]
    this._setDragging = setDragging;
  }

  eq(other) {
    return this.key === other.key;
  }

  toDOM(view) {
    const glyph = document.createElement('span');
    glyph.className = 'ar-inline-ctrl';
    glyph.textContent = '⚙';
    glyph.title = 'edit options';
    glyph.addEventListener('mousedown', (e) => e.stopImmediatePropagation());
    glyph.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const popup = getControlPopup();
      if (popup.isOpen() && popup.currentAnchor() === glyph) {
        popup.hide();
        return;
      }
      // Per-field range state, ascending by source position (fields arrive in order).
      const state = this.fields.map((f) => ({ from: f.from, len: f.to - f.from }));
      const panel = document.createElement('div');
      panel.className = 'ar-ictrl-panel';
      this.fields.forEach((f, i) => panel.append(this._row(view, state, i, f)));
      this._setDragging(true);
      popup.show(glyph, panel, () => this._setDragging(false));
    });
    return glyph;
  }

  // One property row; the field kind picks the widget. Each edit writes only its own
  // property (single change) and shifts later fields by the length delta.
  _row(view, state, i, field) {
    const row = document.createElement('div');
    row.className = 'ar-ictrl-row';
    const lab = document.createElement('span');
    lab.className = 'ar-ictrl-label';
    lab.textContent = field.name;
    row.append(lab);

    const write = (kind, value) => this._writeField(view, state, i, formatOptValue(kind, value));

    if (field.kind === 'number') {
      const inp = document.createElement('input');
      inp.type = 'number';
      inp.step = 'any';
      inp.className = 'ar-ictrl-num';
      inp.value = String(field.value);
      inp.addEventListener('input', () => {
        if (Number.isFinite(Number(inp.value))) write('number', Number(inp.value));
      });
      row.append(inp);
    } else if (field.kind === 'boolean') {
      const inp = document.createElement('input');
      inp.type = 'checkbox';
      inp.checked = !!field.value;
      inp.addEventListener('change', () => write('boolean', inp.checked));
      row.append(inp);
    } else if (field.kind === 'color') {
      const sw = document.createElement('span');
      sw.className = 'ar-color-swatch';
      sw.style.background = resolveToHex(field.value);
      sw.addEventListener('mousedown', (e) => e.stopImmediatePropagation());
      sw.addEventListener('click', () => {
        getColorPopup().show(sw, resolveToHex(field.value), (hex) => {
          sw.style.background = hex;
          write('color', hex);
        });
      });
      row.append(sw);
    } else {
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.className = 'ar-ictrl-num ar-ictrl-text';
      inp.value = String(field.value);
      inp.addEventListener('input', () => write('text', inp.value));
      row.append(inp);
    }
    return row;
  }

  _writeField(view, state, i, newStr) {
    const s = state[i];
    view.dispatch({ changes: { from: s.from, to: s.from + s.len, insert: newStr } });
    const delta = newStr.length - s.len;
    s.len = newStr.length;
    for (let j = i + 1; j < state.length; j++) state[j].from += delta; // shift later fields
  }
}

class InlayHintWidget extends WidgetType {
  constructor(label) {
    super();
    this.label = label;
  }
  eq(other) {
    return this.label === other.label;
  }
  toDOM() {
    const span = document.createElement('span');
    span.className = 'ar-inlay-hint';
    span.textContent = this.label + ':';
    return span;
  }
  ignoreEvent() {
    return true;
  }
}

class GhostSwatchWidget extends WidgetType {
  constructor(insertAt) {
    super();
    this.insertAt = insertAt;
  }
  eq(other) {
    return this.insertAt === other.insertAt;
  }

  toDOM(view) {
    let currentStr = '';
    const swatch = document.createElement('span');
    swatch.className = 'ar-color-swatch ar-color-swatch-ghost';
    swatch.title = 'Pick a color';

    swatch.addEventListener('mousedown', (e) => e.stopImmediatePropagation());
    swatch.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const popup = getColorPopup();
      if (popup.isOpen() && popup.currentAnchor() === swatch) {
        popup.hide();
        return;
      }
      popup.show(swatch, '#ff0000', (newHex) => {
        const newStr = `"${newHex}"`;
        view.dispatch({
          changes: { from: this.insertAt, to: this.insertAt + currentStr.length, insert: newStr },
        });
        currentStr = newStr;
        swatch.style.background = newHex;
      });
    });

    return swatch;
  }
}

// ── AST-based decoration builders ─────────────────────────────────────────────

function buildInlayDecorations(code) {
  let ast;
  try {
    ast = esprima.parseScript(code, { range: true, tolerant: true });
  } catch (_) {
    return Decoration.none;
  }

  const items = [];

  function visitCall(node) {
    const callee = node.callee;
    const path = calleePath(callee);
    if (!path) return;
    // Same resolver the cursor tooltip uses (manual → API Descriptor → Canvas
    // method) so inlay hints appear for every descriptor-registered global, not
    // just the residual manual table — one seam, one behaviour.
    const params = resolveParamHint(path);
    if (!params) return;
    for (let i = 0; i < node.arguments.length; i++) {
      const paramName = params[i];
      if (!paramName || (paramName.endsWith('?') && node.arguments.length <= i)) continue;
      const label = paramName.replace(/\?$/, '');
      const arg = node.arguments[i];
      items.push({
        from: arg.range[0],
        deco: Decoration.widget({ widget: new InlayHintWidget(label), side: -1 }),
      });
    }
  }

  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'CallExpression' || node.type === 'NewExpression') visitCall(node);
    for (const v of Object.values(node)) {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object' && v.type) walk(v);
    }
  }

  walk(ast);
  items.sort((a, b) => a.from - b.from);
  const builder = new RangeSetBuilder();
  for (const { from, deco } of items) builder.add(from, from, deco);
  return builder.finish();
}

export function buildWidgetDecorations(code, setDragging = () => {}) {
  let ast;
  try {
    ast = esprima.parseScript(code, { range: true, tolerant: true });
  } catch (_) {
    return Decoration.none;
  }

  const items = [];
  // Arg start-positions owned by a Tier 1 Inline Control — suppressed as individual
  // scrubbers below (the control edits them as a coupled group). ADR 061.
  const controlledArgStarts = new Set();

  // Pass 1 — Inline Controls: whole-call, chain-head anchored. Attaches a glyph after
  // a `route()`/`pipe()` chain method that has a registered control, but only when the
  // leading args it owns are ALL numeric literals (all-or-nothing; else Tier 0 covers).
  (function walkControls(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'CallExpression') {
      const head = chainHead(node);
      const control = head ? getInlineControl(head.head, head.method) : null;
      if (control && node.arguments.length >= control.arity) {
        const owned = node.arguments.slice(0, control.arity);
        if (owned.every((a) => a.type === 'Literal' && typeof a.value === 'number')) {
          const argState = owned.map((a) => ({ value: a.value, from: a.range[0], to: a.range[1] }));
          const key =
            `${head.head}.${head.method}:` + argState.map((a) => `${a.from},${a.value}`).join(';');
          const at = node.callee.range[1]; // right after `.method`, before `(`
          items.push({
            from: at,
            to: at,
            deco: Decoration.widget({
              widget: new InlineControlWidget(key, control, argState, setDragging),
              side: -1,
            }),
          });
          for (const a of argState) controlledArgStarts.add(a.from);
        }
      }
    }
    for (const v of Object.values(node)) {
      if (Array.isArray(v)) v.forEach(walkControls);
      else if (v && typeof v === 'object' && v.type) walkControls(v);
    }
  })(ast);

  // Pass 1b — Pipe opts-object controls (ADR 062): a chain method whose sole arg is an
  // object literal gets a ⚙ glyph with a field per literal-valued property (inferred, not
  // registered). Disjoint from Pass 1 (that needs numeric positional args) and Pass 2
  // (scrubbers/swatches never reach object properties), so no suppression needed.
  (function walkObjectControls(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'CallExpression' && node.arguments.length === 1) {
      const arg = node.arguments[0];
      if (arg.type === 'ObjectExpression' && chainHead(node)) {
        const fields = inferOptFields(arg);
        if (fields.length) {
          const key = 'opts:' + fields.map((f) => `${f.from},${f.kind},${f.value}`).join(';');
          const at = node.callee.range[1];
          items.push({
            from: at,
            to: at,
            deco: Decoration.widget({
              widget: new ObjectControlWidget(key, fields, setDragging),
              side: -1,
            }),
          });
        }
      }
    }
    for (const v of Object.values(node)) {
      if (Array.isArray(v)) v.forEach(walkObjectControls);
      else if (v && typeof v === 'object' && v.type) walkObjectControls(v);
    }
  })(ast);

  function visitCall(call) {
    if (call.callee?.type !== 'MemberExpression') return;
    for (const arg of call.arguments) {
      if (arg.type !== 'Literal') continue;
      if (controlledArgStarts.has(arg.range[0])) continue; // owned by an Inline Control
      if (typeof arg.value === 'string' && isValidColor(arg.value)) {
        items.push({
          from: arg.range[0],
          to: arg.range[0],
          deco: Decoration.widget({
            widget: new ColorSwatchWidget(arg.value, arg.range[0], arg.range[1] - arg.range[0]),
            side: -1,
          }),
        });
      } else if (typeof arg.value === 'number') {
        items.push({
          from: arg.range[0],
          to: arg.range[1],
          deco: Decoration.replace({
            widget: new ScrubWidget(
              arg.value,
              arg.range[0],
              arg.range[1] - arg.range[0],
              setDragging,
            ),
          }),
        });
      }
    }
  }

  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'CallExpression') visitCall(node);
    for (const v of Object.values(node)) {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object' && v.type) walk(v);
    }
  }

  walk(ast);
  items.sort((a, b) => (a.from !== b.from ? a.from - b.from : a.to - b.to));

  const builder = new RangeSetBuilder();
  for (const { from, to, deco } of items) builder.add(from, to, deco);
  return builder.finish();
}

function buildGhostDecoration(view) {
  const state = view.state;
  const cursor = state.selection.main.head;
  const line = state.doc.lineAt(cursor);
  const before = line.text.slice(0, cursor - line.from);
  const after = line.text.slice(cursor - line.from);
  if (!/(\w+)\.color\(\s*$/.test(before) || !/^\s*\)/.test(after)) return Decoration.none;

  const builder = new RangeSetBuilder();
  builder.add(
    cursor,
    cursor,
    Decoration.widget({ widget: new GhostSwatchWidget(cursor), side: -1 }),
  );
  return builder.finish();
}

// ── ViewPlugin ────────────────────────────────────────────────────────────────

export const inlineWidgetsPlugin = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this._view = view;
      this._dragging = false;
      this._destroyed = false;
      this._rebounce = null;
      this._ghostDebounce = null;
      this._setDragging = this._setDragging.bind(this);
      this._scheduleWidgets(300);
    }

    update(update) {
      if (this._destroyed || this._dragging) return;
      const inlayToggled = update.transactions.some((tr) =>
        tr.effects.some((e) => e.is(toggleInlayHintsEffect)),
      );
      if (update.docChanged || inlayToggled) {
        clearTimeout(this._rebounce);
        this._rebounce = setTimeout(() => this._rebuildWidgets(), 700);
      } else if (update.selectionSet) {
        clearTimeout(this._ghostDebounce);
        this._ghostDebounce = setTimeout(() => this._rebuildGhost(), 60);
      }
    }

    _scheduleWidgets(ms) {
      clearTimeout(this._rebounce);
      this._rebounce = setTimeout(() => this._rebuildWidgets(), ms);
    }

    _rebuildWidgets() {
      if (this._destroyed || this._dragging) return;
      const code = this._view.state.doc.toString();
      const decos = buildWidgetDecorations(code, this._setDragging);
      const inlayEnabled = this._view.state.field(inlayHintsEnabledField, false);
      const inlay = inlayEnabled ? buildInlayDecorations(code) : Decoration.none;
      this._view.dispatch({ effects: [setWidgetsEffect.of(decos), setInlayEffect.of(inlay)] });
      this._rebuildGhost();
    }

    _rebuildGhost() {
      if (this._destroyed || this._dragging) return;
      const deco = buildGhostDecoration(this._view);
      this._view.dispatch({ effects: setGhostEffect.of(deco) });
    }

    _setDragging(on) {
      this._dragging = on;
      if (!on) this._scheduleWidgets(200);
    }

    refresh() {
      if (this._destroyed) return;
      clearTimeout(this._rebounce);
      this._rebuildWidgets();
    }

    clear() {
      this._view.dispatch({
        effects: [
          setWidgetsEffect.of(Decoration.none),
          setGhostEffect.of(Decoration.none),
          setInlayEffect.of(Decoration.none),
        ],
      });
    }

    destroy() {
      clearTimeout(this._rebounce);
      clearTimeout(this._ghostDebounce);
      this._destroyed = true;
      this.clear();
    }
  },
);

// ── Public API ────────────────────────────────────────────────────────────────

export function inlineWidgetsExtension() {
  return [widgetsField, ghostField, inlayField, inlayHintsEnabledField, inlineWidgetsPlugin];
}

export function initInlineWidgets(view) {
  const plugin = view.plugin(inlineWidgetsPlugin);
  return {
    refresh: () => plugin?.refresh(),
    clear: () => plugin?.clear(),
    destroy: () => plugin?.destroy(),
  };
}
