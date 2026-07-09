// media-kind.js — the one taxonomy leaf answering "what media kind is this file?"
// Single source of truth for extension→media classification, replacing three
// drifted copies (toolbar Files button, Local-Files browser icons, desktop-files
// classify). Union of all prior lists (desktop-files was the fullest superset).
// DOM-free, no imports.

const VIDEO_EXTS = new Set(['mp4', 'webm', 'mov', 'avi', 'mkv', 'ogv']);
const AUDIO_EXTS = new Set(['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'opus']);

// mediaKind(name) → 'video' | 'audio' | null. Case-insensitive on the extension.
// Accepts a full filename ("clip.MP4") or a bare extension ("mp4").
export function mediaKind(name) {
  const ext = String(name || '')
    .split('.')
    .pop()
    .toLowerCase();
  if (VIDEO_EXTS.has(ext)) return 'video';
  if (AUDIO_EXTS.has(ext)) return 'audio';
  return null;
}
