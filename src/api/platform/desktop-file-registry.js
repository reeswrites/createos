// desktop-file-registry.js — Desktop File-Type Adapter registry (leaf, no imports).
//
// Each JSON-blob widget file type registers a { glyph, cssClass, open } record
// BESIDE the widget module that owns it (piano.js registers 'piano', drumpad.js
// 'beat', …), the way window-registry.js registers WM window types (ADR 044).
// desktop-files.js derives its glyph, icon CSS class, double-click open-dispatch,
// and restore branch from this one table — instead of hand-enumerating the set
// {beat, launchpad, sprite, paint, ascii, note, piano} in six separate places.
//
//   glyph          — Font Awesome icon class shown as the desktop glyph
//   cssClass       — the dt-*-icon CSS class applied to the icon element
//   open(data, pos)— reconstruct + spawn the widget from its saved JSON blob.
//                    pos = { x, y, _desktopIconId }. The widget owns its own
//                    restore here (frame reconstruction, step replay, …) so
//                    desktop-files never reaches into widget private state.
//
// Every registered type is a JSON-blob file type: its icon.url points at a JSON
// blob; double-click fetches + parses it and calls open(data, pos).

const _types = new Map();

export function registerDesktopFileType(type, adapter) {
  _types.set(type, adapter);
}

export function getDesktopFileType(type) {
  return _types.get(type);
}

export function isDesktopFileType(type) {
  return _types.has(type);
}

// Font Awesome glyph classes for every registered type, as a plain map.
export function desktopFileGlyphs() {
  const out = {};
  for (const [t, a] of _types) if (a.glyph) out[t] = a.glyph;
  return out;
}

export function desktopFileCssClass(type) {
  return _types.get(type)?.cssClass ?? '';
}

// The per-type glyph appearance (bg/border/color) as [{cssClass, glyphStyle}] records,
// so desktop-files' _injectCSS derives the `.dt-icon.<cssClass> .dt-glyph { … }` rules
// instead of hardcoding them — appearance lives beside the widget's own registration
// (closes ADR 055's remaining split between widget cssClass and platform rule body).
export function desktopFileGlyphStyles() {
  const out = [];
  for (const a of _types.values()) {
    if (a.cssClass && a.glyphStyle) out.push({ cssClass: a.cssClass, glyphStyle: a.glyphStyle });
  }
  return out;
}
