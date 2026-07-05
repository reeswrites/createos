import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FrameDoc } from '../../../../src/api/widgets/frame-doc.js';

// FrameDoc is the DOM-free frame model. Frames here are simple tagged objects
// so the model logic is testable without canvases or cell grids.

let seq = 0;
const hooks = () => ({
  createBlank: () => ({ id: ++seq, content: 'blank' }),
  copyFrame: (f) => ({ id: ++seq, content: f.content + '*' }),
  clearFrame: (f) => {
    f.content = 'cleared';
  },
});

describe('FrameDoc model', () => {
  beforeEach(() => {
    seq = 0;
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts with one blank frame at index 0', () => {
    const fd = new FrameDoc(hooks());
    expect(fd.count).toBe(1);
    expect(fd.index).toBe(0);
    expect(fd.current().content).toBe('blank');
  });

  it('seeds from supplied frames when given', () => {
    const fd = new FrameDoc({ ...hooks(), frames: [{ id: 1 }, { id: 2 }] });
    expect(fd.count).toBe(2);
  });

  it('add() appends and moves index to the new frame', () => {
    const fd = new FrameDoc(hooks());
    const i = fd.add();
    expect(fd.count).toBe(2);
    expect(i).toBe(1);
    expect(fd.index).toBe(1);
  });

  it('duplicate() copies the current frame via copyFrame', () => {
    const fd = new FrameDoc(hooks());
    fd.duplicate();
    expect(fd.count).toBe(2);
    expect(fd.current().content).toBe('blank*');
  });

  it('clearCurrent() resets content in place', () => {
    const fd = new FrameDoc(hooks());
    fd.clearCurrent();
    expect(fd.current().content).toBe('cleared');
    expect(fd.count).toBe(1);
  });

  it('remove() refuses to drop the last frame', () => {
    const fd = new FrameDoc(hooks());
    fd.remove();
    expect(fd.count).toBe(1);
  });

  it('remove() deletes current and clamps index', () => {
    const fd = new FrameDoc(hooks());
    fd.add();
    fd.add(); // 3 frames, index 2
    fd.remove(); // drop index 2
    expect(fd.count).toBe(2);
    expect(fd.index).toBe(1);
  });

  it('move() swaps with a neighbour and follows the frame', () => {
    const fd = new FrameDoc(hooks());
    fd.add(); // index 1
    const before = fd.current();
    fd.move(-1); // swap to index 0
    expect(fd.index).toBe(0);
    expect(fd.current()).toBe(before);
  });

  it('move() is a no-op at the boundary', () => {
    const fd = new FrameDoc(hooks());
    fd.add();
    fd.move(+1); // already last
    expect(fd.index).toBe(1);
  });

  it('index setter wraps both directions', () => {
    const fd = new FrameDoc(hooks());
    fd.add();
    fd.add(); // 3 frames
    fd.index = -1;
    expect(fd.index).toBe(2);
    fd.index = 3;
    expect(fd.index).toBe(0);
  });

  it('play() advances index on an interval and emits tick; stop() halts', () => {
    const fd = new FrameDoc(hooks());
    fd.add(); // 2 frames, index 1
    const ticks = [];
    fd.on('tick', (e) => ticks.push(e.index));
    fd.play(10);
    expect(fd.isPlaying).toBe(true);
    vi.advanceTimersByTime(300); // 3 ticks at 10fps
    fd.stop();
    expect(fd.isPlaying).toBe(false);
    expect(ticks.length).toBe(3);
    const after = ticks.length;
    vi.advanceTimersByTime(300);
    expect(ticks.length).toBe(after); // no ticks after stop
  });

  it('emits mutate{action} for structural ops and select for go()', () => {
    const fd = new FrameDoc(hooks());
    const evs = [];
    fd.on('mutate', (e) => evs.push('mutate:' + e.action));
    fd.on('select', () => evs.push('select'));
    fd.add();
    fd.duplicate();
    fd.go(0);
    expect(evs).toEqual(['mutate:add', 'mutate:duplicate', 'select']);
  });

  it('onion setter emits onion event', () => {
    const fd = new FrameDoc(hooks());
    const on = [];
    fd.on('onion', (e) => on.push(e.on));
    fd.onion = true;
    expect(fd.onion).toBe(true);
    expect(on).toEqual([true]);
  });
});
