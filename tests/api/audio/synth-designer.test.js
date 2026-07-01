import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('tone', () => {
  function makeNode(tag) {
    return {
      __tag: tag,
      triggerAttackRelease: vi.fn(),
      triggerAttack: vi.fn(),
      triggerRelease: vi.fn(),
      connect: vi.fn(function () { return this; }),
      chain: vi.fn(function () { return this; }),
      toDestination: vi.fn(function () { return this; }),
      start: vi.fn(),
      dispose: vi.fn(),
    };
  }
  const mk = (tag) => vi.fn(function () { return makeNode(tag); });
  return {
    default: {},
    start: vi.fn(),
    Synth: mk('Synth'),
    FMSynth: mk('FMSynth'),
    AMSynth: mk('AMSynth'),
    MonoSynth: mk('MonoSynth'),
    DuoSynth: mk('DuoSynth'),
    PluckSynth: mk('PluckSynth'),
    MembraneSynth: mk('MembraneSynth'),
    MetalSynth: mk('MetalSynth'),
    NoiseSynth: mk('NoiseSynth'),
    PolySynth: vi.fn(function () { return makeNode('Poly'); }),
    Gain: mk('Gain'),
    Reverb: mk('Reverb'),
    Chorus: mk('Chorus'),
    FeedbackDelay: mk('FeedbackDelay'),
    Distortion: mk('Distortion'),
    Filter: mk('Filter'),
    Compressor: mk('Compressor'),
  };
});

import { openSynthDesigner, _resetDesignerForTesting } from '../../../src/api/audio/synth-designer.js';
import { Voice, _resetVoicesForTesting } from '../../../src/api/audio/voice.js';

function makeWmWindow(id) {
  const body = document.createElement('div');
  body.className = 'wm-body';
  const win = document.createElement('div');
  win.id = id;
  win.appendChild(body);
  document.body.appendChild(win);
  return win;
}

let _n = 0;
beforeEach(() => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
  _n = 0;
  _resetVoicesForTesting();
  _resetDesignerForTesting();
  document.body.innerHTML = '';
  window.wm = {
    spawn: vi.fn(() => {
      const id = `win-sd-${++_n}`;
      makeWmWindow(id);
      return id;
    }),
    focus: vi.fn(),
    window: vi.fn(() => ({ onDispose: vi.fn() })),
  };
  vi.clearAllMocks();
});

function panelOf(winId) {
  return document.getElementById(winId);
}
function byText(root, tag, text) {
  return [...root.querySelectorAll(tag)].find((e) => e.textContent.trim() === text);
}

describe('Synth Designer', () => {
  it('spawns a panel and renders engine + ADSR + save controls', () => {
    const id = openSynthDesigner({ engine: 'fm', name: 'Lead' });
    const panel = panelOf(id);
    expect(panel.querySelector('select')).toBeTruthy(); // engine select
    expect(panel.querySelectorAll('input[type=range]').length).toBeGreaterThanOrEqual(4); // ADSR
    expect(byText(panel, 'button', 'Save')).toBeTruthy();
  });

  it('Save registers a Voice from the current descriptor', () => {
    const id = openSynthDesigner({ engine: 'am', name: 'Bassy' });
    const panel = panelOf(id);
    byText(panel, 'button', 'Save').click();
    expect(Voice.get('Bassy')).toMatchObject({ kind: 'synth', engine: 'am', name: 'Bassy' });
  });

  it('Save with an empty name does not register and flags the input', () => {
    const id = openSynthDesigner({ engine: 'fm' });
    const panel = panelOf(id);
    const before = Voice.list().length;
    byText(panel, 'button', 'Save').click();
    expect(Voice.list().length).toBe(before);
    const nameIn = panel.querySelector('input[type=text]');
    expect(nameIn.style.borderColor).toContain('243'); // #f38ba8 → rgb flag
  });

  it('+ add appends an effect row; ✕ removes it', () => {
    const id = openSynthDesigner({ engine: 'fm', name: 'Fx' });
    const panel = panelOf(id);
    byText(panel, 'button', '+ add').click();
    byText(panel, 'button', 'Save').click();
    expect(Voice.get('Fx').effects.length).toBe(1);
    byText(panelOf(id), 'button', '✕').click();
    byText(panelOf(id), 'button', 'Save').click();
    expect(Voice.get('Fx').effects.length).toBe(0);
  });

  it('reuses a single panel across opens', () => {
    const a = openSynthDesigner({ engine: 'fm', name: 'A' });
    const b = openSynthDesigner({ engine: 'duo', name: 'B' });
    expect(a).toBe(b);
    expect(window.wm.spawn).toHaveBeenCalledTimes(1);
  });

  it('audition (▶) instantiates and triggers without throwing', () => {
    const id = openSynthDesigner({ engine: 'fm', name: 'P' });
    const panel = panelOf(id);
    expect(() => byText(panel, 'button', '▶').click()).not.toThrow();
  });
});
