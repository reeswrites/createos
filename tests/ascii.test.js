import { describe, it, expect, afterEach } from 'vitest';
import { ascii, canvasToAsciiText, cleanupAscii } from '../src/api/ascii.js';

describe('ascii.play', () => {
  afterEach(() => cleanupAscii());

  it('returns a player with el, stop, start, loop, frame, fps', () => {
    const frames = ['frame1', 'frame2'];
    const player = ascii.play(frames, 8);
    expect(player.el).toBeInstanceOf(HTMLPreElement);
    expect(typeof player.stop).toBe('function');
    expect(typeof player.start).toBe('function');
    expect(typeof player.loop).toBe('function');
    expect(typeof player.frame).toBe('function');
    expect(typeof player.fps).toBe('function');
    player.stop();
  });

  it('el shows first frame on creation', () => {
    const player = ascii.play(['AAA', 'BBB'], 8);
    expect(player.el.textContent).toBe('AAA');
    player.stop();
  });

  it('frame(n) jumps to nth frame', () => {
    const player = ascii.play(['AAA', 'BBB', 'CCC'], 8);
    player.stop();
    player.frame(2);
    expect(player.el.textContent).toBe('CCC');
  });

  it('frame() wraps negative indices', () => {
    const player = ascii.play(['A', 'B', 'C'], 8);
    player.stop();
    player.frame(-1);
    expect(player.el.textContent).toBe('C');
  });

  it('loop() returns player for chaining', () => {
    const player = ascii.play(['A'], 8);
    expect(player.loop(false)).toBe(player);
    player.stop();
  });

  it('stop() returns player for chaining', () => {
    const player = ascii.play(['A'], 8);
    expect(player.stop()).toBe(player);
  });

  it('start() returns player for chaining', () => {
    const player = ascii.play(['A'], 8);
    player.stop();
    expect(player.start()).toBe(player);
    player.stop();
  });

  it('accepts custom color/bg options', () => {
    const player = ascii.play(['X'], 8, { color: '#ff0', bg: '#111' });
    expect(player.el.style.color).toBe('rgb(255, 255, 0)');
    expect(player.el.style.background).toBe('rgb(17, 17, 17)');
    player.stop();
  });

  it('accepts single string (non-array frames)', () => {
    const player = ascii.play('hello', 8);
    expect(player.frames).toEqual(['hello']);
    player.stop();
  });
});

describe('canvasToAsciiText', () => {
  it('returns a string', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 10; canvas.height = 10;
    const result = canvasToAsciiText(canvas, { cols: 10 });
    expect(typeof result).toBe('string');
  });

  it('has newlines for each row', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 20; canvas.height = 20;
    const result = canvasToAsciiText(canvas, { cols: 10 });
    const rows = Math.round(10 / 2.5);
    expect(result.split('\n').length - 1).toBe(rows);
  });

  it('dark pixels map to early charset chars', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 4; canvas.height = 4;
    // Leave it all black (default)
    const result = canvasToAsciiText(canvas, { cols: 4, charset: ' .:-=+*#%@' });
    // All pixels are black → lum 0 → first char ' '
    expect(result.replace(/\n/g, '')).toBe('    '.repeat(Math.round(4 / 2.5)));
  });
});

describe('colored frame playback (AsciiEditor export format)', () => {
  afterEach(() => cleanupAscii());

  it('renders string frames unchanged via textContent', () => {
    const player = ascii.play(['hello world'], 8);
    player.stop();
    expect(player.el.textContent).toBe('hello world');
  });

  it('renders colored frame via innerHTML spans', () => {
    const frame = {
      w: 2, h: 1,
      cells: [
        { c: 'A', f: '#ff0000', b: null },
        { c: 'B', f: '#00ff00', b: '#0000ff' },
      ],
    };
    const player = ascii.play([frame], 8);
    player.stop();
    // innerHTML should contain span elements (not just textContent)
    expect(player.el.innerHTML).toContain('<span');
    expect(player.el.innerHTML).toContain('A');
    expect(player.el.innerHTML).toContain('B');
    expect(player.el.innerHTML).toContain('#ff0000');
    expect(player.el.innerHTML).toContain('#0000ff');
  });

  it('HTML-escapes chars to prevent XSS', () => {
    const frame = {
      w: 1, h: 1,
      cells: [{ c: '<', f: '#fff', b: null }],
    };
    const player = ascii.play([frame], 8);
    player.stop();
    expect(player.el.innerHTML).toContain('&lt;');
    expect(player.el.innerHTML).not.toContain('<script');
  });

  it('mixed string and colored frames do not throw', () => {
    const colored = { w: 1, h: 1, cells: [{ c: '@', f: '#0f0', b: null }] };
    const player = ascii.play(['text frame', colored], 8);
    player.stop();
    player.frame(0);
    expect(player.el.textContent).toBe('text frame');
    player.frame(1);
    expect(player.el.innerHTML).toContain('@');
  });
});

describe('cleanupAscii', () => {
  it('stops all active players', () => {
    const p1 = ascii.play(['A', 'B'], 8);
    const p2 = ascii.play(['X', 'Y'], 4);
    expect(p1._iid).not.toBeNull();
    expect(p2._iid).not.toBeNull();
    cleanupAscii();
    expect(p1._iid).toBeNull();
    expect(p2._iid).toBeNull();
  });
});
