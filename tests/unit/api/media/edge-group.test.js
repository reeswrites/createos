import { describe, it, expect } from 'vitest';
import { edgeGroup } from '../../../../src/api/media/edge-group.js';

// edge-group is the rising-edge fire-once dispatch extracted from vision.js's six
// parallel handler channels. It owns the handler list + per-handler `prev` state so
// each channel keeps only its `activeOf`/`onRise`/`onFall` closures.

describe('edgeGroup', () => {
  it('fires onRise once on the false→true edge, not while it stays active', () => {
    const g = edgeGroup();
    let fires = 0;
    g.add(() => fires++);

    g.dispatch(
      () => false,
      (h) => h.fn(),
    );
    expect(fires).toBe(0);

    g.dispatch(
      () => true,
      (h) => h.fn(),
    ); // rising edge
    expect(fires).toBe(1);

    g.dispatch(
      () => true,
      (h) => h.fn(),
    ); // still active — no re-fire
    expect(fires).toBe(1);

    g.dispatch(
      () => false,
      (h) => h.fn(),
    ); // falling — no rise fire
    expect(fires).toBe(1);

    g.dispatch(
      () => true,
      (h) => h.fn(),
    ); // re-arm → fires again
    expect(fires).toBe(2);
  });

  it('evaluates activeOf per handler using its meta (no global flatten)', () => {
    const g = edgeGroup();
    const hits = [];
    g.add(() => hits.push('left'), { dir: 'left' });
    g.add(() => hits.push('right'), { dir: 'right' });

    g.dispatch(
      (h) => h.dir === 'left',
      (h) => h.fn(),
    );
    expect(hits).toEqual(['left']); // only the matching handler fires
  });

  it('fires onFall on the true→false edge when provided (region enter/leave)', () => {
    const g = edgeGroup();
    const log = [];
    g.add(() => {}, { label: 'box' });

    let inside = false;
    const run = () =>
      g.dispatch(
        () => inside,
        (h) => log.push(`enter:${h.label}`),
        (h) => log.push(`leave:${h.label}`),
      );

    run(); // false→false: nothing
    inside = true;
    run(); // enter
    run(); // stays inside: nothing
    inside = false;
    run(); // leave
    expect(log).toEqual(['enter:box', 'leave:box']);
  });

  it('clear() drops handlers and resets edge state', () => {
    const g = edgeGroup();
    let fires = 0;
    g.add(() => fires++);
    expect(g.length).toBe(1);

    g.clear();
    expect(g.length).toBe(0);

    g.dispatch(
      () => true,
      (h) => h.fn(),
    );
    expect(fires).toBe(0); // no handlers left

    // A freshly added handler starts un-armed → next true is a rising edge.
    g.add(() => fires++);
    g.dispatch(
      () => true,
      (h) => h.fn(),
    );
    expect(fires).toBe(1);
  });
});
