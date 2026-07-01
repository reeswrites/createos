// native-fs-adapter.js — handle-shaped adapters over native filesystem paths (ADR 049).
//
// In Electron the native bridge hands back a plain { path, name } for a picked file or
// folder. The whole existing file-browser flow (file-browser.js renderDirContents, wm's
// browse/pickFile) is written against the FileSystemHandle shape, so rather than branch
// that code we wrap native paths in objects that quack like FileSystemFileHandle /
// FileSystemDirectoryHandle: `.name`, `.kind`, `.values()` async iterator, `.getFile()`,
// `.queryPermission() → 'granted'`. Only the acquisition swaps; the consumers are unchanged.
//
// Directory listing and file reads go back over the bridge (`listDir`/`readFile`), where
// the main process enforces that the path is under a user-granted root (ADR 050) — so a
// stale or malicious adapter can't read outside what the user picked.

import { nativeCap } from '../../runtime/native.js';

function _mimeFromName(name) {
  const ext = name.split('.').pop().toLowerCase();
  const map = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    bmp: 'image/bmp',
    mp4: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/quicktime',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    flac: 'audio/flac',
    m4a: 'audio/mp4',
    json: 'application/json',
    js: 'text/javascript',
    txt: 'text/plain',
  };
  return map[ext] ?? 'application/octet-stream';
}

/** Wrap a native file path in a FileSystemFileHandle-shaped adapter. */
export function makeNativeFileHandle(path, name) {
  return {
    kind: 'file',
    name,
    _nativePath: path,
    async getFile() {
      const readFile = nativeCap('readFile');
      if (!readFile) throw new Error('native readFile unavailable');
      const { bytes, type } = await readFile(path);
      const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      return new File([buf], name, { type: type ?? _mimeFromName(name) });
    },
    async queryPermission() {
      return 'granted';
    },
    async requestPermission() {
      return 'granted';
    },
  };
}

/** Wrap a native directory path in a FileSystemDirectoryHandle-shaped adapter. */
export function makeNativeDirHandle(path, name) {
  return {
    kind: 'directory',
    name,
    _nativePath: path,
    async *values() {
      const listDir = nativeCap('listDir');
      if (!listDir) return;
      const entries = await listDir(path);
      for (const e of entries) {
        yield e.kind === 'directory'
          ? makeNativeDirHandle(e.path, e.name)
          : makeNativeFileHandle(e.path, e.name);
      }
    },
    async queryPermission() {
      return 'granted';
    },
    async requestPermission() {
      return 'granted';
    },
  };
}
