// Cursor-based signature help: shows param names for known API calls at cursor.

import { StateField } from '@codemirror/state';
import { showTooltip } from '@codemirror/view';
import esprima from 'esprima';
import { deriveParamHints } from '../runtime/api-registry.js';

// Resolve a call path's params: the manual PARAM_HINTS table first, then the
// single source — param signatures carried on each API's descriptor (CONTEXT.md
// "API Descriptor"). Manual wins for un-migrated APIs; migrated APIs live only in
// their descriptor. Derivation is live (per lookup) so run-scoped registerAPI()
// signatures appear without an import-time snapshot.
export function resolveParamHint(path) {
  return PARAM_HINTS[path] ?? deriveParamHints()[path] ?? null;
}

// ── Param tables ──────────────────────────────────────────────────────────────

export const PARAM_HINTS = {
  // Draw
  'draw.rect':          ['x', 'y', 'w', 'h', 'color'],
  'draw.rectStroke':    ['x', 'y', 'w', 'h', 'color', 'thickness'],
  'draw.circle':        ['x', 'y', 'r', 'color'],
  'draw.ring':          ['x', 'y', 'r', 'color', 'thickness'],
  'draw.arc':           ['x', 'y', 'r', 'start', 'end', 'color'],
  'draw.arcStroke':     ['x', 'y', 'r', 'start', 'end', 'color', 'thickness'],
  'draw.line':          ['x1', 'y1', 'x2', 'y2', 'color', 'thickness'],
  'draw.text':          ['str', 'x', 'y', 'size', 'color', 'opts?'],
  'draw.image':         ['img', 'x', 'y', 'w?', 'h?'],
  'draw.poly':          ['points', 'color'],
  'draw.bg':            ['color'],
  'draw.alpha':         ['opacity'],
  'draw.blend':         ['mode'],
  'draw.translate':     ['x', 'y'],
  'draw.scale':         ['sx', 'sy?'],
  'draw.rotate':        ['angle'],
  // Shader / GLShader
  'Shader':             ['fragmentBody', 'opts?'],
  'GLShader':           ['fragmentBody', 'opts?'],
  'ShaderFX':           ['fragmentBody', 'opts?'],
  // PIXI — 'pixi.tick' migrated to pixi's API Descriptor (app.js); resolves via deriveParamHints()
  // Input / Events (ADR 014 — sensors replaced by bus)
  'on':                 ['event'],
  'tick':               ['ms'],
  'hold':               ['event'],
  'on.when':            ['patternOrFn', 'map?'],
  'on.every':           ['n'],
  'on.after':           ['event'],
  'on.within':          ['ms'],
  // Audio
  'audio.onLevel':      ['threshold', 'onEnter', 'onExit?'],
  'audio.onWord':       ['word', 'fn'],
  'audio.onSpeech':     ['fn'],
  'audio.say':          ['text', 'opts?'],
  // Strudel pattern engine (ADR 035)
  'note':               ['pattern'],
  's':                  ['pattern'],
  'n':                  ['pattern'],
  'sound':              ['pattern'],
  'stack':              ['...patterns'],
  'seq':                ['...patterns'],
  'cat':                ['...patterns'],
  'setcps':             ['cps'],
  'samples':            ['urlOrMap'],
  // Video signal
  'video.signal':       ['source', 'opts?'],
  'video.onMotion':     ['source', 'threshold', 'onEnter', 'onExit?'],
  'video.onBrightness': ['source', 'threshold', 'onEnter', 'onExit?'],
  // WM
  'wm.spawn':           ['title', 'opts?'],
  'wm.move':            ['id', 'x', 'y'],
  'wm.resize':          ['id', 'w', 'h'],
  'wm.show':            ['id'],
  'wm.hide':            ['id'],
  'wm.close':           ['id'],
  'wm.setZ':            ['id', 'z'],
  'wm.setOpacity':      ['id', 'opacity'],
  // Camera
  'Camera':             ['opts?'],
  // Desktop
  'desktop.add':        ['url', 'opts?'],
  'desktop.remove':     ['id'],
  // Vision
  'vision.onGesture':   ['name', 'fn'],
  'vision.onExpression':['name', 'fn'],
  // Layer
  'getLayer':           ['z'],
  'getCanvas':          ['z'],
  // captureWindow
  'captureWindow':      ['target', 'fps?'],
  // AudioFile
  'audio.load':         ['url'],
  'file.seek':          ['seconds'],
  'file.play':          ['offsetSeconds?'],
  'file.filter':        ['type', 'freq?', 'Q?'],
  'file.reverb':        ['decay?'],
  'file.eq':            ['low?', 'mid?', 'high?'],
  'file.delay':         ['time?', 'feedback?'],
  'file.pitchShift':    ['semitones'],
  'file.volume':        ['dB'],
  'file.onTime':        ['seconds', 'fn'],
  'file.loop':          ['enabled?'],
  'file.waveform':      ['opts?'],
  // Audio Viz Suite
  'audio.spectrogram':  ['source', 'opts?'],
  'audio.pianoRoll':    ['opts?'],
  // Mixer (ADR 032)
  'mixer.strip':        ['name'],
  'mixer.add':          ['node', 'opts?'],
};

// ── AST helpers ───────────────────────────────────────────────────────────────

export function calleePath(node) {
  if (!node) return null;
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'MemberExpression' && !node.computed) {
    const obj = calleePath(node.object);
    return obj ? `${obj}.${node.property.name}` : null;
  }
  return null;
}

function findCallAtCursor(ast, cursor) {
  let best = null;

  function walk(node) {
    if (!node || typeof node !== 'object' || !node.range) return;
    if (node.type === 'CallExpression' || node.type === 'NewExpression') {
      const [start, end] = node.range;
      if (cursor >= start && cursor <= end) {
        const callee = node.callee;
        const calleeEnd = callee?.range?.[1] ?? start;
        // Cursor must be AFTER the opening paren (i.e., inside the arg list)
        if (cursor > calleeEnd) {
          // prefer innermost: larger start wins
          if (!best || start > best.start) {
            const args = node.arguments;
            // Determine which arg index cursor falls in
            let argIdx = 0;
            for (let i = 0; i < args.length; i++) {
              const aEnd = args[i + 1] ? args[i + 1].range[0] : (end - 1);
              if (cursor < aEnd) { argIdx = i; break; }
              argIdx = i;
            }

            const path = calleePath(callee);
            best = { start, end, path, argIdx };
          }
        }
      }
    }
    for (const v of Object.values(node)) {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object' && v.type) walk(v);
    }
  }

  walk(ast);
  return best;
}

// ── Tooltip computation ───────────────────────────────────────────────────────

function computeTooltip(state) {
  const cursor = state.selection.main.head;
  const code   = state.doc.toString();

  let ast;
  try { ast = esprima.parseScript(code, { range: true, tolerant: true }); }
  catch (_) { return null; }

  const match = findCallAtCursor(ast, cursor);
  if (!match) return null;

  const params = resolveParamHint(match.path);
  if (!params) return null;

  const idx = Math.min(match.argIdx, params.length - 1);

  return {
    pos: cursor,
    above: true,
    strictSide: false,
    create() {
      const dom = document.createElement('div');
      dom.className = 'ar-param-hint';

      const name = document.createElement('span');
      name.className = 'ar-param-name';
      name.textContent = match.path;
      dom.appendChild(name);

      const open = document.createTextNode('(');
      dom.appendChild(open);

      params.forEach((p, i) => {
        if (i > 0) dom.appendChild(document.createTextNode(', '));
        const span = document.createElement('span');
        span.textContent = p;
        span.className = i === idx ? 'ar-param-active' : 'ar-param-dim';
        dom.appendChild(span);
      });

      dom.appendChild(document.createTextNode(')'));
      return { dom };
    },
  };
}

// ── StateField ────────────────────────────────────────────────────────────────

export const paramHintsField = StateField.define({
  create: (state) => computeTooltip(state),
  update(tooltip, tr) {
    if (!tr.docChanged && !tr.selection) return tooltip;
    return computeTooltip(tr.state);
  },
  provide: f => showTooltip.from(f),
});

export function paramHintsExtension() {
  return [paramHintsField];
}
