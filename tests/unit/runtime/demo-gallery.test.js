import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { groupDemos, GOAL_ORDER, GOAL_LABELS } from '../../../src/runtime/toolbar/demo-gallery.js';

describe('groupDemos (ADR 064 outcome sections)', () => {
  const demos = [
    { id: 'a', goal: 'move' },
    { id: 'b', goal: 'face' },
    { id: 'c', goal: 'move' },
    { id: 'd', goal: 'sound' },
  ];

  test('groups by goal in GOAL_ORDER, dropping empty buckets', () => {
    const secs = groupDemos(demos);
    expect(secs.map((s) => s.goal)).toEqual(['face', 'sound', 'move']); // GOAL_ORDER, non-empty only
    expect(secs.find((s) => s.goal === 'move').demos.map((d) => d.id)).toEqual(['a', 'c']);
  });

  test('each section carries its beginner-facing label', () => {
    const face = groupDemos(demos).find((s) => s.goal === 'face');
    expect(face.label).toBe(GOAL_LABELS.face);
  });

  test('unknown/missing goal falls into a trailing "More" section (never dropped)', () => {
    const secs = groupDemos([{ id: 'x', goal: 'move' }, { id: 'y' }, { id: 'z', goal: 'bogus' }]);
    const last = secs[secs.length - 1];
    expect(last.goal).toBe('more');
    expect(last.demos.map((d) => d.id)).toEqual(['y', 'z']);
  });

  test('empty input → no sections', () => {
    expect(groupDemos([])).toEqual([]);
  });
});

describe('demo index.json goal integrity', () => {
  const demos = JSON.parse(
    readFileSync(resolve(process.cwd(), 'public/demos/index.json'), 'utf8'),
  );

  test('every demo has a goal in the taxonomy (no drift)', () => {
    const bad = demos.filter((d) => !GOAL_ORDER.includes(d.goal));
    expect(
      bad.map((d) => d.id),
      'demos missing/with an unknown goal — assign one of ' + GOAL_ORDER.join(', '),
    ).toEqual([]);
  });

  test('every demo keeps its core fields', () => {
    for (const d of demos) {
      expect(d.id && d.title && d.file, `demo ${d.id} missing a core field`).toBeTruthy();
    }
  });
});
