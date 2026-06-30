// text-layer.js — Shared text-object layer for paint overlay and Paint widget.
// See ADR 024.

let _uid = 0;
const _id = () => 'tl' + ++_uid;

function _fontStr({ fontSize, fontFamily, bold, italic }) {
  return `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}${fontSize}px ${fontFamily}`;
}

// Arc text: (x, y) is the visual anchor at the midpoint of the arc.
// radius > 0 → curves upward; radius < 0 → curves downward.
function _renderArc(ctx, text, x, y, radius, font, fill, kerning) {
  const r = Math.abs(radius);
  const up = radius > 0;
  const cy = y + (up ? r : -r);

  ctx.save();
  ctx.font = font;
  ctx.fillStyle = fill;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'center';

  const chars = [...text];
  const gw = chars.map((c) => ctx.measureText(c).width);
  const total = gw.reduce((s, w) => s + w, 0) + kerning * Math.max(0, chars.length - 1);
  let a = (up ? -Math.PI / 2 : Math.PI / 2) - total / r / 2;

  chars.forEach((ch, i) => {
    const mid = a + gw[i] / 2 / r;
    ctx.save();
    ctx.translate(x + r * Math.cos(mid), cy + r * Math.sin(mid));
    ctx.rotate(mid + (up ? Math.PI / 2 : -Math.PI / 2));
    ctx.fillText(ch, 0, 0);
    ctx.restore();
    a += (gw[i] + (i < chars.length - 1 ? kerning : 0)) / r;
  });
  ctx.restore();
}

export class TextLayer {
  #container;
  #posDiv;
  #mirrorCanvas;
  #objects = [];
  #selected = null;
  #panel = null;
  #active = false;
  #defaults = { fontSize: 24, fontFamily: 'sans-serif', color: '#ffffff' };
  #onKey;
  #onOutside;

  /**
   * @param {object} opts
   * @param {HTMLElement} opts.container  — element to append posDiv into
   * @param {number}      opts.width
   * @param {number}      opts.height
   * @param {number}      [opts.left=0]   — position within container
   * @param {number}      [opts.top=0]
   */
  constructor({ container, width, height, left = 0, top = 0 }) {
    this.#container = container;

    const pos = document.createElement('div');
    pos.style.cssText =
      `position:absolute;left:${left}px;top:${top}px;` +
      `width:${width}px;height:${height}px;pointer-events:none;overflow:visible;z-index:51;`;
    container.appendChild(pos);
    this.#posDiv = pos;

    const mc = document.createElement('canvas');
    mc.width = width;
    mc.height = height;
    mc.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;';
    pos.appendChild(mc);
    this.#mirrorCanvas = mc;

    // Click outside → deselect
    this.#onOutside = (e) => {
      if (!this.#selected) return;
      if (e.target.closest?.('[data-tl]') || e.target.closest?.('.tl-panel')) return;
      this.#deselect();
    };
    container.addEventListener('pointerdown', this.#onOutside, true);

    // Delete key removes selected object
    this.#onKey = (e) => {
      if (!this.#active || !this.#selected) return;
      const tag = document.activeElement?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || document.activeElement?.isContentEditable)
        return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        this.#remove(this.#selected);
      }
    };
    document.addEventListener('keydown', this.#onKey);

    // Empty-area click in active mode → place new text
    pos.addEventListener('pointerdown', (e) => {
      if (!this.#active) return;
      if (e.target.closest('[data-tl]') || e.target.closest('.tl-panel')) return;
      e.stopPropagation();
      const rect = pos.getBoundingClientRect();
      this.placeAt(e.clientX - rect.left, e.clientY - rect.top);
    });
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  get canvas() {
    return this.#mirrorCanvas;
  }

  /** Update defaults used when placing new text (color, fontSize, fontFamily). */
  setDefaults(opts) {
    Object.assign(this.#defaults, opts);
  }

  /** Enable/disable pointer interaction (call when text tool is active/inactive). */
  setActive(val) {
    this.#active = val;
    this.#posDiv.style.pointerEvents = val ? 'auto' : 'none';
    for (const o of this.#objects) {
      if (o._div) o._div.style.pointerEvents = val ? 'auto' : 'none';
    }
    if (!val) this.#deselect();
  }

  /** Reposition and resize mirror canvas (e.g. after overlay is built). */
  updateRect(left, top, w, h) {
    Object.assign(this.#posDiv.style, {
      left: left + 'px',
      top: top + 'px',
      width: w + 'px',
      height: h + 'px',
    });
    this.#mirrorCanvas.width = w;
    this.#mirrorCanvas.height = h;
    this.#redraw();
  }

  /** Place text at (x, y) and immediately enter edit mode. Returns a handle. */
  placeAt(x, y, opts = {}) {
    const merged = { ...this.#defaults, ...opts };
    const h = this.addText('', x, y, merged, { runScoped: false });
    const o = this.#objects.find((o) => o.id === h.id);
    if (o) {
      this.#select(o.id);
      this.#editObj(o);
    }
    return h;
  }

  /**
   * Add a text object programmatically.
   * @returns {object} handle — { id, setText, setStyle, moveTo, remove, on }
   */
  addText(text, x, y, opts = {}, { runScoped = false } = {}) {
    const o = {
      id: _id(),
      text: String(text),
      x,
      y,
      fontSize: opts.fontSize ?? 24,
      fontFamily: opts.fontFamily ?? 'sans-serif',
      color: opts.color ?? '#ffffff',
      bold: opts.bold ?? false,
      italic: opts.italic ?? false,
      align: opts.align ?? 'left',
      rotation: opts.rotation ?? 0,
      kerning: opts.kerning ?? 0,
      curve: opts.curve ?? null,
      opacity: opts.opacity ?? 1,
      _runScoped: runScoped,
      _on: new Map(),
      _div: null,
    };
    this.#objects.push(o);
    this.#buildDiv(o);
    this.#redraw();
    return this.#handle(o);
  }

  /** Remove all run-scoped objects (called on editor reset). */
  clearRunScoped() {
    [...this.#objects].filter((o) => o._runScoped).forEach((o) => this.#remove(o.id));
  }

  /** Remove all objects. */
  clear() {
    [...this.#objects].forEach((o) => this.#remove(o.id));
  }

  /** Render all text objects onto an external canvas context (for export/snapshot). */
  renderToContext(ctx) {
    for (const o of this.#objects) this.#renderObj(ctx, o);
  }

  /** Tear down all DOM nodes and listeners. */
  destroy() {
    this.clear();
    this.#panel?.remove();
    this.#mirrorCanvas.remove();
    this.#posDiv.remove();
    this.#container.removeEventListener('pointerdown', this.#onOutside, true);
    document.removeEventListener('keydown', this.#onKey);
  }

  // ── Mirror canvas ─────────────────────────────────────────────────────────────

  #redraw() {
    const mc = this.#mirrorCanvas;
    const ctx = mc.getContext('2d');
    ctx.clearRect(0, 0, mc.width, mc.height);
    for (const o of this.#objects) this.#renderObj(ctx, o);
  }

  #renderObj(ctx, o) {
    if (!o.text) return;
    const font = _fontStr(o);
    ctx.save();
    if (o.curve?.type === 'arc' && o.curve.radius) {
      _renderArc(ctx, o.text, o.x, o.y, o.curve.radius, font, o.color, o.kerning);
    } else {
      ctx.font = font;
      ctx.fillStyle = o.color;
      ctx.textAlign = o.align;
      ctx.textBaseline = 'top';
      if (o.kerning) ctx.letterSpacing = o.kerning + 'px';
      if (o.rotation) {
        ctx.translate(o.x, o.y);
        ctx.rotate((o.rotation * Math.PI) / 180);
        ctx.fillText(o.text, 0, 0);
      } else {
        ctx.fillText(o.text, o.x, o.y);
      }
      if (o.kerning) ctx.letterSpacing = '0px';
    }
    ctx.restore();
  }

  // ── Handle ────────────────────────────────────────────────────────────────────

  #handle(o) {
    const self = this;
    const h = {
      get id() {
        return o.id;
      },
      setText(s) {
        o.text = String(s);
        self.#redraw();
        return h;
      },
      setStyle(opts) {
        const keys = [
          'fontSize',
          'fontFamily',
          'color',
          'bold',
          'italic',
          'align',
          'rotation',
          'kerning',
          'curve',
          'opacity',
        ];
        keys.forEach((k) => {
          if (opts[k] !== undefined) o[k] = opts[k];
        });
        self.#updateDiv(o);
        self.#redraw();
        if (self.#selected === o.id) {
          self.#panel?.remove();
          self.#panel = null;
          self.#buildPanel(o);
        }
        return h;
      },
      moveTo(x, y) {
        o.x = x;
        o.y = y;
        self.#positionDiv(o);
        self.#redraw();
        return h;
      },
      remove() {
        self.#remove(o.id);
      },
      on(ev, fn) {
        if (!o._on.has(ev)) o._on.set(ev, new Set());
        o._on.get(ev).add(fn);
        return h;
      },
      cancelAnimate() {
        o._cancelAnimate?.();
        return h;
      },
    };
    return h;
  }

  #fire(o, ev, data) {
    o._on.get(ev)?.forEach((fn) => {
      try {
        fn(data);
      } catch (_) {}
    });
  }

  #remove(id) {
    const idx = this.#objects.findIndex((o) => o.id === id);
    if (idx === -1) return;
    const [o] = this.#objects.splice(idx, 1);
    o._div?.remove();
    if (this.#selected === id) {
      this.#selected = null;
      this.#panel?.remove();
      this.#panel = null;
    }
    this.#redraw();
  }

  // ── Interaction divs ──────────────────────────────────────────────────────────

  #buildDiv(o) {
    const div = document.createElement('div');
    div.dataset.tl = o.id;
    this.#styleDiv(o, div);
    this.#positionDiv(o, div);

    div.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (!this.#active) return;
      this.#select(o.id);
      let sx = e.clientX,
        sy = e.clientY,
        ox = o.x,
        oy = o.y,
        moved = false;
      const onMove = (ev) => {
        const dx = ev.clientX - sx,
          dy = ev.clientY - sy;
        if (!moved && Math.abs(dx) + Math.abs(dy) > 2) moved = true;
        o.x = ox + dx;
        o.y = oy + dy;
        this.#positionDiv(o);
        if (this.#panel && this.#selected === o.id) {
          this.#panel.style.left = Math.max(0, o.x) + 'px';
          this.#panel.style.top = Math.max(2, o.y - 46) + 'px';
        }
        this.#redraw();
        if (moved) this.#fire(o, 'move', { x: o.x, y: o.y });
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });

    div.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      if (!this.#active) return;
      this.#editObj(o);
    });

    this.#posDiv.appendChild(div);
    o._div = div;
  }

  #styleDiv(o, div = o._div) {
    if (!div) return;
    const sel = this.#selected === o.id;
    div.style.cssText = [
      'position:absolute;',
      `pointer-events:${this.#active ? 'auto' : 'none'};`,
      'cursor:move;user-select:none;',
      'min-width:16px;min-height:14px;padding:3px 5px;',
      `border:1.5px dashed ${sel ? 'rgba(203,166,247,0.85)' : 'transparent'};`,
      'border-radius:3px;box-sizing:border-box;',
      `transform:rotate(${o.rotation}deg);transform-origin:top left;white-space:nowrap;`,
      `opacity:${o.opacity};`,
    ].join('');
  }

  #positionDiv(o, div = o._div) {
    if (!div) return;
    div.style.left = o.x + 'px';
    div.style.top = o.y + 'px';
  }

  #updateDiv(o) {
    this.#styleDiv(o);
    this.#positionDiv(o);
  }

  // ── Edit mode ─────────────────────────────────────────────────────────────────

  #editObj(o) {
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.value = o.text;
    inp.style.cssText = [
      'position:absolute;',
      `left:${o.x}px;top:${o.y}px;`,
      `font:${_fontStr(o)};color:${o.color};`,
      'background:transparent;border:none;',
      'border-bottom:1.5px dashed rgba(203,166,247,0.7);',
      'outline:none;min-width:40px;',
      `letter-spacing:${o.kerning}px;`,
      `transform:rotate(${o.rotation}deg);transform-origin:top left;`,
      'z-index:4;padding:0 2px;',
    ].join('');

    let done = false;
    const commit = () => {
      if (done) return;
      done = true;
      inp.remove();
      const t = inp.value;
      if (t !== o.text) {
        const prev = o.text;
        o.text = t;
        this.#redraw();
        this.#fire(o, 'edit', { text: t, prev });
      }
    };
    inp.addEventListener('blur', commit);
    inp.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        inp.blur();
      }
      if (ev.key === 'Escape') {
        done = true;
        inp.remove();
      }
    });
    this.#posDiv.appendChild(inp);
    _nextTick(() => {
      inp.focus();
      inp.select();
    });
  }

  // ── Selection ─────────────────────────────────────────────────────────────────

  #select(id) {
    if (this.#selected === id) return;
    const prev = this.#selected;
    if (prev) {
      const po = this.#objects.find((o) => o.id === prev);
      if (po) {
        this.#styleDiv(po);
        this.#fire(po, 'deselect', {});
      }
      this.#panel?.remove();
      this.#panel = null;
    }
    this.#selected = id;
    if (!id) return;
    const o = this.#objects.find((o) => o.id === id);
    if (!o) {
      this.#selected = null;
      return;
    }
    this.#styleDiv(o);
    this.#buildPanel(o);
    this.#fire(o, 'select', {});
  }

  #deselect() {
    this.#select(null);
  }

  // ── Contextual font panel ─────────────────────────────────────────────────────

  #buildPanel(o) {
    this.#panel?.remove();
    const panel = document.createElement('div');
    panel.className = 'tl-panel';
    panel.style.cssText = [
      'position:absolute;',
      `left:${Math.max(0, o.x)}px;top:${Math.max(2, o.y - 46)}px;`,
      'background:rgba(18,18,30,0.92);border:1px solid #45475a;',
      'border-radius:7px;padding:4px 7px;',
      'display:flex;gap:4px;align-items:center;flex-wrap:wrap;z-index:5;',
      'backdrop-filter:blur(4px);',
    ].join('');

    const _lbl = (t) => {
      const s = document.createElement('span');
      s.textContent = t;
      s.style.cssText = 'font-size:10px;color:#6c7086;flex-shrink:0;';
      panel.appendChild(s);
    };
    const _num = (val, step, w, fn) => {
      const inp = document.createElement('input');
      inp.type = 'number';
      inp.value = val;
      inp.step = String(step);
      inp.style.cssText =
        `width:${w}px;background:#313244;color:#cdd6f4;border:1px solid #45475a;` +
        'border-radius:4px;padding:1px 3px;font-size:11px;flex-shrink:0;';
      inp.addEventListener('input', () => fn(inp.value));
      panel.appendChild(inp);
    };
    const _tog = (label, title, state, fn, extraStyle = '') => {
      const b = document.createElement('button');
      b.textContent = label;
      b.title = title;
      b.style.cssText =
        `background:${state ? '#45475a' : '#313244'};color:#cdd6f4;border:1px solid #45475a;` +
        `border-radius:4px;padding:1px 6px;font-size:11px;cursor:pointer;flex-shrink:0;${extraStyle}`;
      let cur = state;
      b.addEventListener('click', () => {
        cur = !cur;
        b.style.background = cur ? '#45475a' : '#313244';
        fn(cur);
      });
      panel.appendChild(b);
    };

    // Font family
    const fontSel = document.createElement('select');
    [
      'sans-serif',
      'serif',
      'monospace',
      'cursive',
      'Georgia',
      'Arial',
      'Verdana',
      'Courier New',
      'Impact',
    ].forEach((f) => {
      const opt = document.createElement('option');
      opt.value = opt.textContent = f;
      if (f === o.fontFamily) opt.selected = true;
      fontSel.appendChild(opt);
    });
    fontSel.style.cssText =
      'background:#313244;color:#cdd6f4;border:1px solid #45475a;border-radius:4px;' +
      'padding:1px 2px;font-size:11px;max-width:100px;flex-shrink:0;';
    fontSel.addEventListener('change', () => {
      o.fontFamily = fontSel.value;
      this.#updateDiv(o);
      this.#redraw();
    });
    panel.appendChild(fontSel);

    _tog(
      'B',
      'Bold',
      o.bold,
      (v) => {
        o.bold = v;
        this.#updateDiv(o);
        this.#redraw();
      },
      'font-weight:bold;',
    );
    _tog(
      'I',
      'Italic',
      o.italic,
      (v) => {
        o.italic = v;
        this.#updateDiv(o);
        this.#redraw();
      },
      'font-style:italic;',
    );

    // Align buttons
    [
      ['⬅', 'left'],
      ['↔', 'center'],
      ['➡', 'right'],
    ].forEach(([ic, a]) => {
      const b = document.createElement('button');
      b.textContent = ic;
      b.title = 'Align ' + a;
      b.dataset.align = a;
      b.style.cssText =
        `background:${o.align === a ? '#45475a' : '#313244'};color:#cdd6f4;` +
        'border:1px solid #45475a;border-radius:4px;padding:1px 5px;font-size:11px;cursor:pointer;flex-shrink:0;';
      b.addEventListener('click', () => {
        o.align = a;
        panel.querySelectorAll('[data-align]').forEach((x) => (x.style.background = '#313244'));
        b.style.background = '#45475a';
        this.#redraw();
      });
      panel.appendChild(b);
    });

    _lbl('rot');
    _num(o.rotation, 1, 44, (v) => {
      o.rotation = parseFloat(v) || 0;
      this.#updateDiv(o);
      this.#redraw();
    });
    _lbl('kern');
    _num(o.kerning, 0.5, 40, (v) => {
      o.kerning = parseFloat(v) || 0;
      this.#redraw();
    });
    _lbl('curve r');
    _num(o.curve?.radius ?? 0, 10, 50, (v) => {
      const r = parseFloat(v) || 0;
      o.curve = r ? { type: 'arc', radius: r } : null;
      this.#redraw();
    });

    panel.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.#posDiv.appendChild(panel);
    this.#panel = panel;
  }
}

const _nextTick = (fn) => Promise.resolve().then(fn);
