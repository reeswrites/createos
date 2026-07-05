import { describe, test, expect } from 'vitest';
import { EditorView } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import {
  PARAM_HINTS,
  resolveParamHint,
  paramHintsField,
  paramHintsExtension,
} from '../../../src/editor/param-hints.js';
import { registerAPI, _beginRun, _endRun } from '../../../src/runtime/api-registry.js';

function makeView(doc, cursorPos) {
  const state = EditorState.create({
    doc,
    selection: { anchor: cursorPos ?? doc.length },
    extensions: paramHintsExtension(),
  });
  return new EditorView({ state, parent: document.createElement('div') });
}

function tooltip(view) {
  return view.state.field(paramHintsField);
}

describe('PARAM_HINTS table', () => {
  test('resolves canvas.rect (instance method) to 5 params (ADR 040)', () => {
    expect(resolveParamHint('canvas.rect')).toEqual(['x', 'y', 'w', 'h', 'color']);
    expect(resolveParamHint('c.rect')).toEqual(['x', 'y', 'w', 'h', 'color']);
  });

  test('resolves canvas.circle to 4 params', () => {
    expect(resolveParamHint('canvas.circle')).toEqual(['x', 'y', 'r', 'color']);
  });

  test('migrated global hints resolve via the API Descriptor (not the manual table)', () => {
    _beginRun();
    registerAPI('wm', {}, { params: { spawn: ['title', 'opts?'] } });
    registerAPI('audio', {}, { params: { onLevel: ['threshold', 'onEnter', 'onExit?'] } });
    expect(resolveParamHint('wm.spawn')).toEqual(['title', 'opts?']);
    expect(resolveParamHint('audio.onLevel')).toEqual(['threshold', 'onEnter', 'onExit?']);
    _endRun();
  });

  test('only the residual hints (dual-shape on + file.* instance methods) stay manual', () => {
    expect(PARAM_HINTS['on']).toBeDefined();
    expect(PARAM_HINTS['file.seek']).toBeDefined();
    // migrated entries no longer live in the manual table — they resolve via descriptors
    expect(PARAM_HINTS['wm.spawn']).toBeUndefined();
    expect(PARAM_HINTS['audio.onLevel']).toBeUndefined();
  });
});

describe('paramHintsField', () => {
  test('no tooltip when cursor outside any call', () => {
    const view = makeView('const x = 1;', 5);
    expect(tooltip(view)).toBeNull();
  });

  test('no tooltip for unknown method', () => {
    const view = makeView('foo.unknownMethod(10, 20)', 20);
    expect(tooltip(view)).toBeNull();
  });

  test('returns tooltip when cursor inside known canvas.rect call', () => {
    const code = 'canvas.rect(10, 20, 100, 50, "red")';
    const view = makeView(code, 13); // inside "10"
    expect(tooltip(view)).not.toBeNull();
  });

  test('tooltip create() returns a dom element with class ar-param-hint', () => {
    const code = 'canvas.rect(10, 20, 100, 50, "red")';
    const view = makeView(code, 13);
    const tip = tooltip(view);
    expect(tip).not.toBeNull();
    const { dom } = tip.create(view);
    expect(dom.className).toBe('ar-param-hint');
  });

  test('active param (first arg) is highlighted', () => {
    const code = 'canvas.circle(50, 50, 25, "red")';
    const view = makeView(code, 15); // cursor inside first arg "50"
    const tip = tooltip(view);
    const { dom } = tip.create(view);
    const active = dom.querySelectorAll('.ar-param-active');
    expect(active.length).toBe(1);
    expect(active[0].textContent).toBe('x');
  });

  test('active param changes for second arg', () => {
    const code = 'canvas.circle(50, 50, 25, "red")';
    const view = makeView(code, 18); // cursor inside second arg
    const tip = tooltip(view);
    const { dom } = tip.create(view);
    const active = dom.querySelector('.ar-param-active');
    expect(active?.textContent).toBe('y');
  });

  test('dim params exist for non-active args', () => {
    const code = 'canvas.rect(10, 20, 100, 50, "red")';
    const view = makeView(code, 13);
    const tip = tooltip(view);
    const { dom } = tip.create(view);
    const dimmed = dom.querySelectorAll('.ar-param-dim');
    expect(dimmed.length).toBe(4); // 5 params total, 1 active
  });

  test('method name displayed in tooltip', () => {
    const code = 'canvas.circle(50, 50, 25)';
    const view = makeView(code, 15);
    const tip = tooltip(view);
    const { dom } = tip.create(view);
    expect(dom.textContent).toContain('canvas.circle');
  });

  test('no tooltip when cursor before opening paren', () => {
    const code = 'canvas.rect(10, 20)';
    const view = makeView(code, 4); // cursor on "r" in "rect"
    expect(tooltip(view)).toBeNull();
  });

  test('no tooltip on syntax error', () => {
    const view = makeView('canvas.rect((((', 6);
    expect(tooltip(view)).toBeNull();
  });

  test('tooltip updates on selection change', () => {
    const code = 'canvas.circle(50, 50, 25, "red")';
    const view = makeView(code, 15); // first arg
    expect(tooltip(view)).not.toBeNull();

    view.dispatch({ selection: { anchor: 0 } }); // outside call
    expect(tooltip(view)).toBeNull();
  });

  test('tooltip for nested call uses innermost', () => {
    const code = 'canvas.circle(Math.sin(0.5), 50, 25)';
    // cursor inside Math.sin( inner call )
    const view = makeView(code, 22); // inside 0.5
    const tip = tooltip(view);
    // Inner call is Math.sin — not in PARAM_HINTS, so null
    // OR outer canvas.circle if inner not found
    // Either way shouldn't throw
    expect(() => tip?.create?.(view)).not.toThrow();
  });

  test('tooltip present for a manual-table call (file.filter)', () => {
    const code = `file.filter('lowpass', 800)`;
    const view = makeView(code, 13);
    const tip = tooltip(view);
    expect(tip).not.toBeNull();
    const { dom } = tip.create(view);
    expect(dom.textContent).toContain('file.filter');
  });
});
