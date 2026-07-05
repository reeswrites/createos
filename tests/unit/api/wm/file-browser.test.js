import { describe, it, expect, vi } from 'vitest';
import {
  makeFileEntry,
  renderFlatFiles,
  renderDirContents,
} from '../../../../src/api/wm/file-browser.js';

// The file-tree render leaf extracted from wm.js — pure DOM rendering over
// FileSystemHandle entries, testable with fake handles and no desktop.

describe('file-browser render leaf', () => {
  it('renders a file entry that calls onSelect with a blob url on click', async () => {
    const fileHandle = {
      kind: 'file',
      name: 'Photo.PNG',
      getFile: async () => new Blob(['x'], { type: 'image/png' }),
    };
    const onSelect = vi.fn();
    const el = makeFileEntry(fileHandle, 0, onSelect);
    expect(el.textContent).toContain('🖼'); // image icon by extension
    expect(el.textContent).toContain('Photo.png'); // extension lower-cased

    el.querySelector('div').dispatchEvent(new Event('click'));
    await Promise.resolve();
    expect(onSelect).toHaveBeenCalledWith(expect.any(String), 'Photo.png', fileHandle);
  });

  it('renders a directory entry with a disclosure arrow (no getFile call)', () => {
    const dir = { kind: 'directory', name: 'assets', values: async function* () {} };
    const el = makeFileEntry(dir, 1, vi.fn());
    expect(el.textContent).toContain('📁');
    expect(el.textContent).toContain('assets');
  });

  it('renderFlatFiles sorts, skips dotfiles, and wires click', () => {
    const container = document.createElement('div');
    const files = [{ name: 'b.wav' }, { name: '.hidden' }, { name: 'a.txt' }];
    // jsdom: URL.createObjectURL may be undefined
    global.URL.createObjectURL ??= () => 'blob:fake';
    renderFlatFiles(container, files, vi.fn());
    const rows = [...container.children];
    expect(rows.length).toBe(2); // dotfile skipped
    expect(rows[0].textContent).toContain('a.txt'); // sorted
    expect(rows[1].textContent).toContain('b.wav');
  });

  it('renderDirContents sorts directories before files and skips dotfiles', async () => {
    const container = document.createElement('div');
    const dirHandle = {
      async *values() {
        yield { kind: 'file', name: 'z.txt', getFile: async () => new Blob([]) };
        yield { kind: 'directory', name: 'sub', values: async function* () {} };
        yield { kind: 'file', name: '.dot', getFile: async () => new Blob([]) };
      },
    };
    await renderDirContents(container, dirHandle, 0, vi.fn());
    const rows = [...container.children];
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('sub'); // directory first
    expect(rows[1].textContent).toContain('z.txt');
  });
});
