# Performance capture is an action log, not the undo stack

## Context

Widgets needed a way to export not just their final state (the existing **Snapshot** path: `dp.pattern(...)`, `p.note(...)`, `draw.image(...)`) but the *temporal* way a result was made — a **Performance** that replays as code. The obvious-looking reuse was `WidgetHistory` (the undo/redo stack), since it already records "state over edits."

## Decision

Performance capture is a **separate, append-only log of timestamped actions** (`{ t, …action }`, wall-clock ms from take start), captured by subscribing to each widget's existing event stream — `WidgetEvents` `'*'` for Drumpad/Piano/Sprite/Ascii, the global bus `note:char` for Notepad, and **new** pointermove path capture in Paint (its `stroke` event carries only a bbox, not the brush path). It is **not** built on `WidgetHistory`.

Replay schedules the log on the harness clock (patched `setTimeout`, run-scoped, self-registering a live output) via a shared leaf `src/api/signal/replay-clock.js`, used by both per-widget `.replay(actions)` and the cross-widget `timeline().track(widget, actions, { at })`. Performances are never persisted to `.vljson`/IDB — the emitted code is their persistence, exactly like Snapshot export.

## Considered options

- **Reuse `WidgetHistory` (rejected).** It is snapshot-based, not action-based: `capture()`/`restore()` store opaque whole-state blobs, debounced 350 ms, capped at 60, with no timestamps and no action semantics. Replaying it yields a jerky 350 ms-quantized sequence of full-state diffs — a flipbook, not a performance — and it can't represent sub-step timing or splicing.
- **Snapshot-only for Paint (rejected for v1).** Paint could export per-stroke canvas snapshots and avoid new capture, but that is base64 flipbook output, not a real drawing performance. We chose to add true stroke-path capture instead.

## Action schemas

Every action carries `t` = wall-clock ms from Take start. `op` is present only on widgets that record more than one action type. Each `op` maps 1:1 to a public "do one action" method the replay calls — several of which are new, because today's triggers are private (`_trigger`, `_triggerAttack`, `_setCell`, `_paintAt`).

```js
// Drumpad — one-shot hits (no duration)
{ t, vi }                                   // → dp.hit(vi)        NEW public (wraps _trigger)

// Piano — sustained notes (needs duration; see below)
{ t, note, dur }                            // → p.strike(note, dur)  NEW public

// Sprite — pixels + frame moves
{ t, op:'pixel', x, y, color }              // → sp.pixel(x,y,color)   existing public
{ t, op:'frame', i }                        // → sp.frame(i)           existing public

// Ascii — cells + frame moves
{ t, op:'cell', c, r, ch, fg, bg }          // → ed.cell(c,r,ch,fg,bg) NEW public (wraps _setCell; gate _cellEventsOn)
{ t, op:'frame', i }                        // → ed.frame(i)

// Notepad — typing ('\b' = backspace, matching existing convention)
{ t, ch }                                   // → np.type(ch)           existing public

// Paint — stroke path + frame moves (needs path capture; see below)
{ t, op:'stroke', tool, color, size, pts:[{x,y,dt},…] }  // → pt.stroke(pts,{tool,color,size}) NEW public
{ t, op:'frame', i }
```

Capture source per widget: `WidgetEvents '*'` for Drumpad/Sprite/Ascii (their events are complete), the global bus `note:char` for Notepad, and **two widgets whose existing events are lossy and need new capture**:

- **Piano** — `note` fires on attack only; `_triggerRelease` emits nothing, so note duration is lost. Fix: fire a note-off on release and pair attack→release into `dur`.
- **Paint** — the `stroke` event carries a bbox, not the brush path. Fix: arm a pointermove point buffer (with per-point `dt`) only while a Take is active, so strokes replay as animated drawing.

Replay envelope — solo is the degenerate one-track case of the timeline:

```js
sp.replay([{t:0,op:'pixel',x:2,y:3,color:'#f00'}, …], { loop:false });

timeline()
  .track(p,  takeA, { at:0 })
  .track(p,  takeB, { at:4000 })   // same widget, take spliced later
  .track(dp, beat,  { at:0 })
  .play({ loop:false });
```

## Consequences

- Two distinct capture systems now coexist and must stay terminologically separate: **Performance** (timestamped actions, this ADR) vs **Recording** (video media stream, recorder.js). The glossary reserves each word; code and docs must not blur them.
- Paint gains recording-armed pointermove capture — a small new code path in `paint.js` that is inert unless a Take is active.
- New public surface (`.replay()` per widget, `window.timeline`, Capture ● buttons, plus per-widget action methods `dp.hit`/`p.strike`/`ed.cell`/`pt.stroke`) is hard to change once demos depend on it; needs `TOOLKIT_CATEGORIES` + `KNOWN_GLOBALS` entries and Blocks coverage (ADR 011).
- The bulk of the work is making private triggers public and adding the two lossy-event fixes (Piano note-off, Paint path buffer) — not the scheduler, which is a thin `replay-clock.js` leaf modeled on the existing Route timeline.
