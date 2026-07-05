// widget-restorer-registry.js — how a code-generated widget window is rebuilt from
// a saved WM record, keyed by widgetType.
//
// Sibling to the Window Type Adapter (window-registry.js) and the Desktop File-Type
// Adapter (desktop-file-registry.js): each widget registers its OWN restorer BESIDE
// its class (drumpad.js registers 'drumpad', piano.js 'piano', …) instead of app.js
// building one giant global object literal that reached into widget privates
// (sp._frames, sp._render()). `wm.restoreState` looks a widgetType up here. Same
// "register beside your own code" discipline as onReset / registerWindowType /
// registerDesktopFileType. Leaf module — no imports.

const _restorers = new Map();

// register('drumpad', (savedWindowRecord) => new Drumpad({...})). Called at module
// load, like registerWindowType — the widget module must be in the boot import graph.
export function registerWidgetRestorer(type, fn) {
  _restorers.set(type, fn);
}

// Rebuild the widget for a saved record. No-op (returns undefined) if the type has
// no registered restorer — e.g. a legacy widget dropped from a build.
export function restoreWidget(type, state) {
  const fn = _restorers.get(type);
  return fn ? fn(state) : undefined;
}

export function hasWidgetRestorer(type) {
  return _restorers.has(type);
}
