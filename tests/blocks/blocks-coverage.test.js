import { describe, it, expect } from 'vitest';
import { TOOLKIT_CATEGORIES } from '../../src/editor/completions.js';
import { TOOLBOX } from '../../src/blocks/blocks.js';

// ── Blocks-coverage gate (ADR 011) ────────────────────────────────────────────
//
// CLAUDE.md's #1 failure mode: "capabilities that exist in text with NO blocks
// path at all — that's what causes data loss on mode switch." This test turns
// that prose rule into a build-time gate at the right altitude: FUNCTIONAL
// coverage per capability area (ADR 002 — not syntactic per-method mirroring).
//
// Every learner-reachable toolkit category must be exactly one of:
//   • COVERAGE              — has ≥1 reachable block (matched by type prefix), OR
//   • TEXT_ONLY_INTENTIONAL — deliberately no blocks path (advanced/niche), OR
//   • BLOCKS_TODO           — a known gap worth filling (visible backlog).
// A NEW toolkit category in none of these fails the test, forcing a conscious
// classification.

// Every block type reachable from the toolbox (what a learner can actually drag).
function collectBlockTypes(node, acc = new Set()) {
  if (node?.type) acc.add(node.type);
  for (const c of node?.contents ?? []) collectBlockTypes(c, acc);
  return acc;
}
const BLOCK_TYPES = [...collectBlockTypes(TOOLBOX)];
const hasBlock = (prefixes) => BLOCK_TYPES.some((t) => prefixes.some((p) => t.includes(p)));

// Toolkit category → block-type prefixes that provide its functional coverage.
const COVERAGE = {
  'Draw':            ['draw_', 'canvas_'],
  'Media':           ['media_'],
  'Shader':          ['shader_'],
  'Audio':           ['audio_', 'drumpad_'],
  'Piano':           ['piano_'],
  'Audio→Visual':    ['audio_viz'],
  'Canvas':          ['canvas_', 'draw_'],
  'Pipeline':        ['pipe_'],
  'Vision':          ['vision_'],
  'Control':         ['ctrl_'],
  'Events':          ['_on_'],            // drumpad_on_*, wm_on_*, paint_on_*, vision_on_*, *_editor_on_*
  'Camera & Mic':    ['camera_', 'shader_camera', 'audio_on_word', 'audio_level'],
  'Windows':         ['wm_'],
  'PIXI':            ['pixi_'],
  'GLShader':        ['glshader_'],
  'Three.js 3D':     ['three_'],
  'ASCII Animation': ['ascii_play', 'ascii_show'],
  'Pixel Art':       ['sprite_'],
  'Paint Canvas':    ['paint_'],
  'ASCII Editor':    ['ascii_editor_'],
  'Signal Graph':    ['three_signal_graph'],
};

// Learner-reachable in text, intentionally NO blocks path. Each entry is the
// conscious "text-only on purpose" decision ADR 002's functional-coverage rule
// asks for — advanced / hardware / niche desktop-shell surfaces.
const TEXT_ONLY_INTENTIONAL = new Set([
  'Patterns',       // Strudel is a text-first DSL (ADR 035); mirroring its function
                    //   algebra as blocks is lossy + high-maintenance. Text-only on
                    //   purpose; the round-trip is protected by the js_raw passthrough
                    //   block (ADR 037), not by native Strudel blocks.
  'Desktop',        // file-icon management — imperative, low value as blocks
  'Desktop Shell',  // Electron/Tauri bridge — desktop-only, advanced
  'MIDI',           // hardware I/O — advanced
  'External Data',  // fetch / weather / scraping — advanced, async
  'Window Physics', // niche window-toy
  'Status Bar',     // niche desktop-shell chrome
  'Plugin iframes', // sandboxed-plugin authoring — advanced
]);

// Known gaps — learner-facing, no blocks path yet. The gate passes today while
// keeping the backlog visible. When blocks land, move the entry to COVERAGE.
const BLOCKS_TODO = new Set([
  'Route',        // cross-domain signal chain (ADR 025) — closure-heavy API; blocks pending
  'Sensors',      // mouse/keyboard/gamepad/motion — high learner value, deserves blocks
  'Haptics',      // sensors.vibrate — small; could fold into a Sensors block set
  'Notepad',      // rich-text window widget — high learner value, blocks path pending
  'Capture',      // webcam photo/record + output-window recording — pending blocks
  'Actors',       // pattern/pipeline actor control — reactive wiring blocks pending (ADR 017)
  'Serial / GPIO', // WebSerial hardware I/O — user-gesture connect awkward in blocks; text-first (ADR 020)
  'Performance',  // replay/timeline of recorded Takes (ADR 031) — data-array + closure heavy; blocks pending
]);

const TOOLKIT_NAMES = TOOLKIT_CATEGORIES.map((c) => c.name);

describe('blocks coverage gate', () => {
  it('every toolkit category is classified (covered / text-only / todo)', () => {
    const unclassified = TOOLKIT_NAMES.filter(
      (n) => !(n in COVERAGE) && !TEXT_ONLY_INTENTIONAL.has(n) && !BLOCKS_TODO.has(n),
    );
    expect(
      unclassified,
      `New toolkit category with no classification. For each: add a COVERAGE prefix ` +
      `(it has blocks), add to TEXT_ONLY_INTENTIONAL (text-only on purpose), or ` +
      `BLOCKS_TODO (gap to fill). Unclassified: ${unclassified.join(', ')}`,
    ).toEqual([]);
  });

  it('every COVERAGE category actually has a reachable block', () => {
    const broken = Object.entries(COVERAGE)
      .filter(([, prefixes]) => !hasBlock(prefixes))
      .map(([name]) => name);
    expect(
      broken,
      `These categories claim block coverage but no matching block is reachable in ` +
      `the toolbox (block renamed/removed?): ${broken.join(', ')}`,
    ).toEqual([]);
  });

  it('BLOCKS_TODO entries still lack coverage (else promote to COVERAGE)', () => {
    // Self-cleaning backlog: if a TODO capability gains blocks, this flags it so
    // the entry gets moved to COVERAGE rather than silently rotting.
    const nowCovered = [...BLOCKS_TODO].filter((name) => {
      const guessPrefix = name.toLowerCase().slice(0, 5);
      return BLOCK_TYPES.some((t) => t.startsWith(guessPrefix));
    });
    expect(
      nowCovered,
      `These BLOCKS_TODO categories appear to have blocks now — move them to ` +
      `COVERAGE with explicit prefixes: ${nowCovered.join(', ')}`,
    ).toEqual([]);
  });

  it('the buckets are disjoint', () => {
    for (const name of TOOLKIT_NAMES) {
      const inN = (name in COVERAGE ? 1 : 0) + (TEXT_ONLY_INTENTIONAL.has(name) ? 1 : 0) + (BLOCKS_TODO.has(name) ? 1 : 0);
      expect(inN, `${name} is in more than one bucket`).toBeLessThanOrEqual(1);
    }
  });
});
