import esprima from 'esprima';
import { EditorView, Decoration, WidgetType, ViewPlugin } from '@codemirror/view';
import { StateField, StateEffect, RangeSetBuilder } from '@codemirror/state';
import { PARAM_HINTS, calleePath } from './param-hints.js';

// ── Color utilities ───────────────────────────────────────────────────────────

function colorToHex(color) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

function isValidColor(color) {
  const s = new Option().style;
  s.color = color;
  return s.color !== '';
}

function hexToHsl(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  let h = 0,
    s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

function hslToHex(h, s, l) {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) =>
    Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
  return `#${f(0).toString(16).padStart(2, '0')}${f(8).toString(16).padStart(2, '0')}${f(4).toString(16).padStart(2, '0')}`;
}

function resolveToHex(color) {
  if (/^#[0-9a-f]{6}$/i.test(color)) return color;
  try {
    return colorToHex(color);
  } catch (_) {
    return '#ff0000';
  }
}

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
    const params = PARAM_HINTS[path];
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

function buildWidgetDecorations(code, setDragging) {
  let ast;
  try {
    ast = esprima.parseScript(code, { range: true, tolerant: true });
  } catch (_) {
    return Decoration.none;
  }

  const items = [];

  function visitCall(call) {
    if (call.callee?.type !== 'MemberExpression') return;
    for (const arg of call.arguments) {
      if (arg.type !== 'Literal') continue;
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
