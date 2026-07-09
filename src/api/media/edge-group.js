// Rising-edge handler group — the fire-once dispatch shared by every vision
// detector channel (gesture / expression / gaze-dir / blink / wink / region).
//
// Each channel used to hand-roll the identical `if (active && !h.prev){…}
// h.prev = active` transition plus its own `.push`/`.length = 0`. This owns the
// handler list, per-handler `prev` edge state, add/clear, and the transition.
//
// The per-handler `active` predicate stays a caller closure (`activeOf(h)`) so
// channels with a per-handler match (gesture === h.gesture, region hit-test) are
// NOT flattened into one global-active call. `onFall` is optional — region gaze
// needs enter (rising) AND leave (falling); the rising-only channels omit it.
export function edgeGroup() {
  const handlers = [];
  return {
    // Region gaze checks whether any handler is registered before doing the
    // (calibration-gated) work — mirror the old `_gazeRegionHandlers.length`.
    get length() {
      return handlers.length;
    },
    // Register a handler. `meta` carries the channel's match key
    // (`{ dir }`, `{ eye }`, `{ gesture }`, `{ expr }`, `{ target, label }`).
    add(fn, meta = {}) {
      const h = { fn, prev: false, ...meta };
      handlers.push(h);
      return h;
    },
    // Drop all handlers + their edge state (the old `.length = 0` reset).
    clear() {
      handlers.length = 0;
    },
    // Edge dispatch: `activeOf(h)` computes this handler's active state,
    // `onRise(h)` fires on the false→true edge, optional `onFall(h)` on true→false.
    dispatch(activeOf, onRise, onFall) {
      for (const h of handlers) {
        const active = !!activeOf(h);
        if (active && !h.prev) onRise(h);
        else if (!active && h.prev && onFall) onFall(h);
        h.prev = active;
      }
    },
  };
}
