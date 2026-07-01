import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { EditorView } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import {
  initInlineWidgets,
  inlineWidgetsExtension,
  widgetsField,
  ghostField,
  ColorSwatchWidget,
  ScrubWidget,
} from '../../../../src/editor/inline-widgets.js';

// ── Canvas stub ───────────────────────────────────────────────────────────────
// colorToHex uses getContext('2d').getImageData; override stub from setup.js
HTMLCanvasElement.prototype.getContext = function (type) {
  if (type !== '2d') return null;
  return {
    fillStyle: '',
    fillRect: () => {},
    getImageData: () => ({ data: new Uint8ClampedArray([255, 0, 0, 255]) }),
  };
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeView(doc = '') {
  const state = EditorState.create({ doc, extensions: inlineWidgetsExtension() });
  return new EditorView({ state, parent: document.createElement('div') });
}

function iterDecos(view, field) {
  const result = [];
  const cur = view.state.field(field).iter();
  while (cur.value !== null) {
    result.push({ from: cur.from, to: cur.to, deco: cur.value });
    cur.next();
  }
  return result;
}

function widgetDecos(view) { return iterDecos(view, widgetsField); }

function settle() {
  vi.advanceTimersByTime(1000); // advance past all debounce timers
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('initInlineWidgets', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test('returns refresh / clear / destroy interface', () => {
    const view = makeView('');
    const api = initInlineWidgets(view);
    expect(typeof api.refresh).toBe('function');
    expect(typeof api.clear).toBe('function');
    expect(typeof api.destroy).toBe('function');
  });

  test('no widgets when code has no MemberExpression calls', () => {
    const view = makeView('console.log("hello");');
    // "hello" is not a valid CSS color → no widget
    settle();
    expect(widgetDecos(view)).toHaveLength(0);
  });

  test('no widgets for method call with no literal args', () => {
    const view = makeView('draw.clear();');
    settle();
    expect(widgetDecos(view)).toHaveLength(0);
  });

  test('places color swatch widget for valid CSS color string arg', () => {
    const view = makeView('draw.bg("red");');
    settle();
    const decos = widgetDecos(view);
    expect(decos).toHaveLength(1);
    expect(decos[0].deco.spec.widget).toBeInstanceOf(ColorSwatchWidget);
  });

  test('color swatch is a zero-width widget (inserted before the literal)', () => {
    const view = makeView('draw.bg("red");');
    settle();
    const [d] = widgetDecos(view);
    expect(d.from).toBe(d.to); // widget decoration, not replacement
  });

  test('color swatch widget toDOM returns ar-color-swatch span', () => {
    const view = makeView('draw.circle(0,0,10,"blue");');
    settle();
    const swatch = widgetDecos(view).find(d => d.deco.spec.widget instanceof ColorSwatchWidget);
    const dom = swatch.deco.spec.widget.toDOM(view);
    expect(dom.tagName).toBe('SPAN');
    expect(dom.className).toBe('ar-color-swatch');
  });

  test('places scrub widget for number literal arg', () => {
    const view = makeView('draw.rect(10, 20, 100, 50);');
    settle();
    const decos = widgetDecos(view);
    expect(decos).toHaveLength(4); // 4 numbers
    for (const d of decos) expect(d.deco.spec.widget).toBeInstanceOf(ScrubWidget);
  });

  test('scrub widget replaces the number text (from ≠ to)', () => {
    const view = makeView('draw.rect(10, 0, 0, 0);');
    settle();
    const [first] = widgetDecos(view);
    // "10" starts at offset 10 in 'draw.rect(10, 0, 0, 0);'
    expect(first.to - first.from).toBe(2); // "10" is 2 chars
  });

  test('scrub widget toDOM returns ar-scrub span with correct text', () => {
    const view = makeView('draw.circle(50, 50, 25);');
    settle();
    const [d] = widgetDecos(view);
    const dom = d.deco.spec.widget.toDOM(view);
    expect(dom.tagName).toBe('SPAN');
    expect(dom.className).toBe('ar-scrub');
    expect(dom.textContent).toBe('50');
  });

  test('places widgets for both color and numeric args', () => {
    const view = makeView('draw.rect(10, 20, 100, 50, "red");');
    settle();
    const decos = widgetDecos(view);
    const swatches = decos.filter(d => d.deco.spec.widget instanceof ColorSwatchWidget);
    const scrubs   = decos.filter(d => d.deco.spec.widget instanceof ScrubWidget);
    expect(swatches).toHaveLength(1);
    expect(scrubs).toHaveLength(4);
  });

  test('places widgets in multiple method calls', () => {
    const view = makeView('draw.circle(50, 50, 25);\ndraw.rect(10, 20, 100, 50);');
    settle();
    const decos = widgetDecos(view);
    expect(decos.length).toBeGreaterThan(4);
  });

  test('non-CSS string args get no widget', () => {
    const view = makeView('console.log("hello world");');
    settle();
    expect(widgetDecos(view)).toHaveLength(0);
  });

  test('does not crash on syntax error', () => {
    const view = makeView('draw.rect(((');
    expect(() => settle()).not.toThrow();
    expect(widgetDecos(view)).toHaveLength(0);
  });

  test('clear() removes all active widget decorations', () => {
    const view = makeView('draw.rect(10, 20, 100, 50, "red");');
    settle();
    expect(widgetDecos(view).length).toBeGreaterThan(0);

    const api = initInlineWidgets(view);
    api.clear();
    expect(widgetDecos(view)).toHaveLength(0);
  });

  test('clear() removes ghost decorations', () => {
    const view = makeView('draw.color()');
    // position cursor inside the call to trigger ghost
    view.dispatch({ selection: { anchor: 11 } }); // after '('
    settle();

    const api = initInlineWidgets(view);
    api.clear();
    expect(iterDecos(view, ghostField)).toHaveLength(0);
  });

  test('refresh() re-runs placement immediately', () => {
    const view = makeView('draw.rect(10, 20, 100, 50);');
    settle();
    const api = initInlineWidgets(view);

    // Manually clear, then refresh should repopulate
    api.clear();
    expect(widgetDecos(view)).toHaveLength(0);
    api.refresh();
    expect(widgetDecos(view).length).toBeGreaterThan(0);
  });

  test('widgets re-placed after doc change + debounce', () => {
    const view = makeView('');
    initInlineWidgets(view);
    settle();
    expect(widgetDecos(view)).toHaveLength(0);

    // Insert code
    view.dispatch({ changes: { from: 0, to: 0, insert: 'draw.circle(50, 50, 25);' } });
    vi.advanceTimersByTime(800);
    expect(widgetDecos(view).length).toBeGreaterThan(0);
  });

  test('destroy() prevents further widget placement', () => {
    const view = makeView('');
    const api = initInlineWidgets(view);
    api.destroy();

    view.dispatch({ changes: { from: 0, to: 0, insert: 'draw.circle(50, 50, 25);' } });
    vi.advanceTimersByTime(1000);
    expect(widgetDecos(view)).toHaveLength(0);
  });

  test('widgets cleared before re-placement on doc change', () => {
    const view = makeView('draw.rect(10, 20, 100, 50);');
    settle();
    const countBefore = widgetDecos(view).length;
    expect(countBefore).toBeGreaterThan(0);

    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: 'draw.circle(5, 5, 5, "red");' },
    });
    vi.advanceTimersByTime(800);
    const decos = widgetDecos(view);
    // Now has 3 scrubs + 1 swatch from circle call
    expect(decos.length).toBeGreaterThan(0);
    const swatches = decos.filter(d => d.deco.spec.widget instanceof ColorSwatchWidget);
    expect(swatches).toHaveLength(1);
  });

  test('ghost swatch appears when cursor inside .color() empty call', () => {
    const view = makeView('draw.color()');
    // cursor after '(' = position 11
    view.dispatch({ selection: { anchor: 11 } });
    vi.advanceTimersByTime(200);
    expect(iterDecos(view, ghostField).length).toBeGreaterThan(0);
  });

  test('ghost swatch does not appear outside .color() pattern', () => {
    const view = makeView('draw.rect(10, 20, 100, 50);');
    view.dispatch({ selection: { anchor: 5 } });
    vi.advanceTimersByTime(200);
    expect(iterDecos(view, ghostField)).toHaveLength(0);
  });
});
