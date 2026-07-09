// refcounted.js — the pure count→edge primitive shared by demand-driven media sources.
//
// Two media subsystems hand-rolled the identical 0→1-open / 1→0-close refcount:
// media-lease.js (toolbar camera/mic singletons) and camera.js (CameraSource shared
// streams). This is that shape, extracted with NOTHING else: no keep-alive, no reset
// wiring, no owner tags. Callers own their own lifecycle/scoping and only borrow the
// edge detection — media-lease adds runScoped teardown, CameraSource adds the shared
// -source map + editor-owner tag around it.
//
//   const rc = refcounted({ open: () => start(), close: () => stop() });
//   const h = rc.acquire();   // fires open() on 0→1
//   h.release();              // fires close() on 1→0; idempotent, double-release safe
//   rc.count;                 // current live handle count (never negative)

/**
 * Create a refcount that fires `open` on the 0→1 edge and `close` on the 1→0 edge.
 * @param {object}   cbs
 * @param {Function} [cbs.open]   called when the count rises from 0 to 1.
 * @param {Function} [cbs.close]  called when the count falls from 1 to 0.
 * @returns {{ acquire: () => { release: () => void }, count: number }}
 */
export function refcounted({ open, close } = {}) {
  let count = 0;
  return {
    acquire() {
      count++;
      if (count === 1) open?.();
      let released = false;
      return {
        release() {
          if (released) return;
          released = true;
          count = Math.max(0, count - 1);
          if (count === 0) close?.();
        },
      };
    },
    get count() {
      return count;
    },
  };
}
