import { describe, it, expect, vi } from 'vitest';
import {
  buildFrameStrip,
  buildTransport,
  buildToolButtonRow,
} from '../../../../src/api/widgets/widget-shell.js';

// A minimal FrameController stand-in — exercises the shared strip/transport
// wiring without a real FrameDoc or widget.
function fakeController() {
  const listeners = {};
  return {
    count: 3,
    index: 0,
    fps: 8,
    onion: false,
    isPlaying: false,
    calls: [],
    on(evt, fn) {
      (listeners[evt] ??= []).push(fn);
    },
    emit(evt, p) {
      (listeners[evt] ?? []).forEach((fn) => fn(p));
    },
    drawThumb(tc) {
      tc.width = 10;
      tc.height = 10;
    },
    add() {
      this.calls.push('add');
    },
    duplicate() {
      this.calls.push('duplicate');
    },
    clearCurrent() {
      this.calls.push('clear');
    },
    remove() {
      this.calls.push('remove');
    },
    move(d) {
      this.calls.push('move:' + d);
    },
    go(i) {
      this.calls.push('go:' + i);
    },
    play(f) {
      this.calls.push('play:' + f);
    },
    stop() {
      this.calls.push('stop');
    },
  };
}

describe('buildFrameStrip', () => {
  it('renders one thumbnail per frame and selects on click', () => {
    const ctrl = fakeController();
    const { el } = buildFrameStrip(ctrl);
    const thumbs = el.querySelectorAll('canvas');
    expect(thumbs.length).toBe(3);
    thumbs[2].parentElement.dispatchEvent(new Event('click'));
    expect(ctrl.calls).toContain('go:2');
  });

  it('buttons drive the controller mutations', () => {
    const ctrl = fakeController();
    const { el } = buildFrameStrip(ctrl);
    const btns = el.querySelectorAll('button');
    btns.forEach((b) => b.dispatchEvent(new Event('click')));
    expect(ctrl.calls).toEqual(
      expect.arrayContaining(['add', 'duplicate', 'clear', 'remove', 'move:-1', 'move:1']),
    );
  });

  it('refreshes thumbnails when the model emits mutate/select', () => {
    const ctrl = fakeController();
    const { el } = buildFrameStrip(ctrl);
    ctrl.count = 5;
    ctrl.emit('mutate', { action: 'add', index: 4, count: 5 });
    expect(el.querySelectorAll('canvas').length).toBe(5);
  });
});

describe('buildTransport', () => {
  it('play reads the fps input; stop halts; export buttons append', () => {
    const ctrl = fakeController();
    const onFpsChange = vi.fn();
    const extra = document.createElement('button');
    extra.textContent = 'Code';
    const row = buildTransport(ctrl, { onFpsChange, extraButtons: [extra] });

    const input = row.querySelector('input[type=number]');
    input.value = '24';
    const [playBtn, stopBtn] = row.querySelectorAll('button');
    playBtn.dispatchEvent(new Event('click'));
    stopBtn.dispatchEvent(new Event('click'));
    expect(ctrl.calls).toEqual(['play:24', 'stop']);

    input.dispatchEvent(new Event('change'));
    expect(ctrl.fps).toBe(24);
    expect(onFpsChange).toHaveBeenCalledWith(24);
    expect([...row.querySelectorAll('button')].some((b) => b.textContent === 'Code')).toBe(true);
  });
});

describe('buildToolButtonRow', () => {
  const TOOLS = [
    { id: 'pen', icon: 'P', title: 'Pen' },
    { id: 'eraser', icon: 'E', title: 'Eraser' },
    { id: 'fill', icon: 'F', title: 'Fill' },
  ];

  it('renders one button per tool with the active one bordered', () => {
    const row = buildToolButtonRow(TOOLS, { active: 'eraser', onSelect: () => {} });
    const btns = [...row.querySelectorAll('button[data-tool]')];
    expect(btns.map((b) => b.dataset.tool)).toEqual(['pen', 'eraser', 'fill']);
    // jsdom renders the hex borders as rgb(); the active button differs from inactive.
    const active = btns.find((b) => b.dataset.tool === 'eraser');
    const inactive = btns.find((b) => b.dataset.tool === 'pen');
    expect(active.style.borderColor).not.toBe(inactive.style.borderColor);
    expect(active.style.borderColor).toBeTruthy();
  });

  it('re-borders on click and reports (id, prev) to onSelect', () => {
    const seen = [];
    const row = buildToolButtonRow(TOOLS, {
      active: 'pen',
      onSelect: (id, prev) => seen.push([id, prev]),
    });
    const btns = [...row.querySelectorAll('button[data-tool]')];
    const fill = btns.find((b) => b.dataset.tool === 'fill');
    const pen = btns.find((b) => b.dataset.tool === 'pen');
    fill.dispatchEvent(new Event('click'));
    expect(seen).toEqual([['fill', 'pen']]);
    // active button gets a different (highlight) border than the inactive one
    expect(fill.style.borderColor).not.toBe(pen.style.borderColor);

    // second click threads the new prev and moves the highlight
    pen.dispatchEvent(new Event('click'));
    expect(seen[1]).toEqual(['pen', 'fill']);
    expect(pen.style.borderColor).not.toBe(fill.style.borderColor);
  });
});
