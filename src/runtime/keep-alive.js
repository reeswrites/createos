// keep-alive.js — output-liveness handle.
//
// An "output" (Shader, GLShader, viz, render pipeline, Media, ThreeScene, draw
// backdrop) keeps its program running while it is on screen by sitting in the
// active editor's `_keepAlive` Set (pointed to by `window.__ar_keepAlive`). The
// idle watcher stops a program once that Set empties and all outputs are gone.
//
// `liveOutput(token)` owns that membership: it CAPTURES the active editor's Set
// at registration and removes from the SAME Set on release — even if the active
// editor changed in between. The old open-coded sites re-read
// `window.__ar_keepAlive` on delete, so a stop after an editor switch deleted
// from the wrong Set and leaked a phantom live output. release() is idempotent,
// so the multiple stop paths each output has (error path + destroy) are safe.
//
// Inputs (camera/mic) are NOT outputs and must not register here — see CLAUDE.md.

export function liveOutput(token) {
  const set = (window.__ar_keepAlive ??= new Set());
  set.add(token);
  let released = false;
  return {
    release() {
      if (released) return;
      released = true;
      set.delete(token);
    },
    get token() {
      return token;
    },
  };
}

// Read-only accessors — use instead of reading window.__ar_keepAlive directly.
// editor-instance.js is the sole owner/writer of the Set; everyone else reads via these.
export function forEachLive(cb) {
  const set = window.__ar_keepAlive;
  if (set) for (const obj of set) cb(obj);
}

export function liveCount() {
  return window.__ar_keepAlive?.size ?? 0;
}
