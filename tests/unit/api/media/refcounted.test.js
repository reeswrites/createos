// refcounted.test.js — the pure count→edge primitive shared by media-lease + CameraSource.

import { describe, it, expect, vi } from 'vitest';
import { refcounted } from '../../../../src/api/media/refcounted.js';

describe('refcounted', () => {
  it('fires open only on the 0→1 edge', () => {
    const open = vi.fn();
    const rc = refcounted({ open });
    expect(rc.count).toBe(0);
    rc.acquire();
    expect(open).toHaveBeenCalledTimes(1);
    expect(rc.count).toBe(1);
    rc.acquire();
    rc.acquire();
    expect(open).toHaveBeenCalledTimes(1); // still once
    expect(rc.count).toBe(3);
  });

  it('fires close only on the 1→0 edge', () => {
    const close = vi.fn();
    const rc = refcounted({ close });
    const a = rc.acquire();
    const b = rc.acquire();
    a.release();
    expect(close).not.toHaveBeenCalled();
    expect(rc.count).toBe(1);
    b.release();
    expect(close).toHaveBeenCalledTimes(1);
    expect(rc.count).toBe(0);
  });

  it('is idempotent under double-release (no extra close, no negative count)', () => {
    const close = vi.fn();
    const rc = refcounted({ close });
    const h = rc.acquire();
    h.release();
    h.release();
    h.release();
    expect(close).toHaveBeenCalledTimes(1);
    expect(rc.count).toBe(0);
  });

  it('clamps at 0 and re-opens after a full release cycle', () => {
    const open = vi.fn();
    const close = vi.fn();
    const rc = refcounted({ open, close });
    const a = rc.acquire();
    a.release();
    a.release(); // stale double-release must not drive count negative
    expect(rc.count).toBe(0);
    const b = rc.acquire();
    expect(open).toHaveBeenCalledTimes(2); // fresh 0→1 fires open again
    expect(rc.count).toBe(1);
    b.release();
    expect(close).toHaveBeenCalledTimes(2);
  });

  it('does not throw when open/close are omitted', () => {
    const rc = refcounted();
    const h = rc.acquire();
    expect(rc.count).toBe(1);
    expect(() => h.release()).not.toThrow();
    expect(rc.count).toBe(0);
  });
});
