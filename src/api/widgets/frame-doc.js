// frame-doc.js — the animation frame model shared by the creative widgets.
//
// A FrameDoc owns an ordered list of opaque "frames" and a current index, plus
// the transport (play/stop/fps) and onion-skin flag. It is element-agnostic:
// Paint frames are offscreen <canvas>es, AsciiEditor frames are cell arrays.
// The widget supplies the element-specific operations as hooks:
//
//   createBlank()      → a fresh empty frame
//   copyFrame(src)     → a deep copy of a frame (for duplicate)
//   clearFrame(frame)  → reset a frame's content in place
//   drawThumb(tc, frame, i) → render frame i into a thumbnail <canvas> (optional)
//
// FrameDoc is the FrameController interface consumed by widget-shell's
// buildFrameStrip()/buildTransport(). It is a pure data+timer model — it owns no
// DOM and emits events; the widget subscribes to render. See CONTEXT.md "FrameDoc".

import { WidgetEvents } from './widget-events.js';

// restoreFrames — the frame-count reconcile shared by every frame widget's undo
// restore. frame-snapshot.js extracted the PURE half (the per-frame pixel/cell
// copy); this is the RISKY half that was left copy-pasted three ways: growing and
// truncating the live frame list and clamping the current index. Getting the
// truncation or index wrong leaks frames or points at a missing one — so it earns
// exactly one home. The element-specific parts stay closures on the caller:
//   frames    the live frame array (mutated in place)
//   snap      { fi, frames: [...] } captured by the widget's _snap* method
//   grow()    append one blank frame (offscreen <canvas> vs cell array)
//   paint(frame, data, i)  restore one captured frame's content
//   setIndex(fi)           set the current index (raw _fi vs controller.frame())
// The caller keeps the post-restore render/refresh — that genuinely differs.
export function restoreFrames({ frames, snap, grow, paint, setIndex }) {
  while (frames.length < snap.frames.length) grow();
  frames.length = snap.frames.length;
  snap.frames.forEach((data, i) => paint(frames[i], data, i));
  setIndex(snap.fi);
}

export class FrameDoc {
  constructor({
    frames = null,
    createBlank,
    copyFrame,
    clearFrame,
    drawThumb,
    fps = 8,
    thumbAspect = null,
    thumbPixelated = false,
  } = {}) {
    this._createBlank = createBlank;
    this._copyFrame = copyFrame;
    this._clearFrame = clearFrame;
    this._drawThumb = drawThumb;
    // Optional thumbnail display hints consumed by widget-shell.buildFrameStrip.
    this.thumbAspect = thumbAspect; // CSS width/height ratio override
    this.thumbPixelated = thumbPixelated; // image-rendering:pixelated
    this.fps = fps;
    this._fi = 0;
    this._onion = false;
    this._iid = null;
    this._events = new WidgetEvents();
    this._frames = frames && frames.length ? frames : [createBlank()];
  }

  // ── Queries ──────────────────────────────────────────────────────────────
  get frames() {
    return this._frames;
  }
  // Replace the whole frame list in place (e.g. AsciiEditor grid resize remaps
  // every frame). Caller is responsible for keeping index in range.
  set frames(v) {
    this._frames = v;
  }
  get count() {
    return this._frames.length;
  }
  get index() {
    return this._fi;
  }
  set index(n) {
    const len = this._frames.length;
    this._fi = ((n % len) + len) % len;
  }
  get isPlaying() {
    return this._iid != null;
  }
  get onion() {
    return this._onion;
  }
  set onion(v) {
    this._onion = !!v;
    this._events.emit('onion', { on: this._onion });
  }

  current() {
    return this._frames[this._fi];
  }
  prev() {
    const len = this._frames.length;
    return this._frames[(this._fi - 1 + len) % len];
  }
  drawThumb(tc, i) {
    this._drawThumb?.(tc, this._frames[i], i);
  }

  // ── Navigation ─────────────────────────────────────────────────────────────
  // go() is a user-driven selection (thumbnail click): render, no history/save.
  go(n) {
    this.index = n;
    this._events.emit('select', { index: this._fi, count: this.count });
    return this;
  }

  // ── Structural mutations ─────────────────────────────────────────────────
  // Each emits 'mutate' {action} — the widget commits history + autosaves.
  // Low-level append: add a blank frame, return its index. No index move, no
  // event — this is the public `addFrame()` contract some widgets expose.
  push() {
    this._frames.push(this._createBlank());
    return this._frames.length - 1;
  }
  // Editor "add": append, select the new frame, notify (strip + autosave).
  add() {
    const i = this.push();
    this._fi = i;
    this._emitMutate('add');
    return this._fi;
  }
  duplicate() {
    const copy = this._copyFrame ? this._copyFrame(this.current()) : this._createBlank();
    this._frames.push(copy);
    this._fi = this._frames.length - 1;
    this._emitMutate('duplicate');
    return this._fi;
  }
  clearCurrent() {
    this._clearFrame?.(this.current());
    this._emitMutate('clear');
  }
  remove() {
    if (this._frames.length <= 1) return;
    this._frames.splice(this._fi, 1);
    this._fi = Math.min(this._fi, this._frames.length - 1);
    this._emitMutate('delete');
  }
  move(dir) {
    const fi = this._fi;
    const to = fi + dir;
    if (to < 0 || to >= this._frames.length) return;
    [this._frames[fi], this._frames[to]] = [this._frames[to], this._frames[fi]];
    this._fi = to;
    this._emitMutate('move');
  }
  _emitMutate(action) {
    this._events.emit('mutate', { action, index: this._fi, count: this.count });
  }

  // ── Transport ──────────────────────────────────────────────────────────────
  play(fps = this.fps) {
    if (this._iid) return this;
    this.fps = fps;
    this._iid = setInterval(() => {
      this._fi = (this._fi + 1) % this._frames.length;
      this._events.emit('tick', { index: this._fi });
    }, 1000 / fps);
    return this;
  }
  stop() {
    if (this._iid) clearInterval(this._iid);
    this._iid = null;
    return this;
  }

  // ── Events ───────────────────────────────────────────────────────────────
  // Events: 'mutate' {action,index,count}, 'select' {index,count},
  //         'tick' {index}, 'onion' {on}.
  on(evt, fn) {
    this._events.on(evt, fn);
    return this;
  }

  destroy() {
    this.stop();
    this._events.clear();
  }
}
