import { describe, it, expect, beforeEach } from 'vitest';
import { runScoped, runScopedOutput, _scopedCount } from '../../../src/runtime/run-scoped.js';
import { runResetHandlers } from '../../../src/runtime/reset-registry.js';
import { liveCount } from '../../../src/runtime/keep-alive.js';

// Drain any handles a prior test left registered (run-scoped's onReset is global).
beforeEach(() => {
  window.__ar_keepAlive = new Set();
  window.__ar_active_editor_id = undefined;
  runResetHandlers(); // editorId == null → dispose everything
});

describe('runScoped — owner filtering', () => {
  it('resetting editor B leaves editor A live; resetting A disposes it', () => {
    const stops = [];
    window.__ar_active_editor_id = 1;
    runScoped({ onStop: () => stops.push('A') });
    window.__ar_active_editor_id = 2;
    runScoped({ onStop: () => stops.push('B') });

    runResetHandlers(2);
    expect(stops).toEqual(['B']); // only B's owner matched
    expect(_scopedCount()).toBe(1); // A survives

    runResetHandlers(1);
    expect(stops).toEqual(['B', 'A']);
    expect(_scopedCount()).toBe(0);
  });

  it('owner defaults eagerly to the active editor at call time', () => {
    window.__ar_active_editor_id = 7;
    const h = runScoped({ onStop() {} });
    expect(h.owner).toBe(7);
  });

  it('null owner (no editor context) is disposed by any reset', () => {
    window.__ar_active_editor_id = undefined;
    let stopped = false;
    runScoped({
      onStop: () => {
        stopped = true;
      },
    });
    runResetHandlers(99); // unrelated editor id
    expect(stopped).toBe(true);
  });
});

describe('dispose — idempotent, one teardown path', () => {
  it('onStop runs exactly once across double dispose + reset', () => {
    window.__ar_active_editor_id = 1;
    let count = 0;
    const h = runScoped({
      onStop: () => {
        count++;
      },
    });
    h.dispose();
    h.dispose();
    runResetHandlers(1);
    expect(count).toBe(1);
    expect(h.disposed).toBe(true);
  });
});

describe('runScopedOutput — keep-alive membership', () => {
  it('joins keep-alive on create, releases on dispose; core variant does not', () => {
    window.__ar_active_editor_id = 1;
    expect(liveCount()).toBe(0);

    const out = runScopedOutput({ onStop() {} });
    expect(liveCount()).toBe(1); // output joined keep-alive

    runScoped({ onStop() {} });
    expect(liveCount()).toBe(1); // core variant did NOT join

    out.dispose();
    expect(liveCount()).toBe(0); // released in the same idempotent step
  });

  it('caller onStop runs before keep-alive release', () => {
    window.__ar_active_editor_id = 1;
    const order = [];
    const out = runScopedOutput({
      token: {},
      onStop: () => order.push('onStop'),
    });
    // release is observable via liveCount dropping; assert onStop fired and count cleared
    out.dispose();
    expect(order).toEqual(['onStop']);
    expect(liveCount()).toBe(0);
  });
});
