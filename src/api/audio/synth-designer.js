// ── Synth Designer ──────────────────────────────────────────────────────────────
// The no-code panel that authors a Synth Voice (ADR 046). A visual editor over
// the Voice descriptor `_buildSynth`/instantiateVoice consumes — pick an engine,
// tweak oscillator + ADSR, drag an effect chain, name it, save into the Voice
// registry. No new audio engine; the Faust track is a later, separate engine.
//
//   openSynthDesigner()            — blank FM voice
//   openSynthDesigner('Bass')      — edit an existing registered voice
//   openSynthDesigner({engine...}) — seed from an inline descriptor

import * as Tone from 'tone';
import { Voice, normalizeVoice, instantiateVoice, engineNames } from './voice.js';

const OSC_TYPES = ['sine', 'square', 'sawtooth', 'triangle'];
const FX_TYPES = ['reverb', 'chorus', 'delay', 'distortion', 'filter', 'compressor'];

let _designer = null; // single panel instance

// Deep-ish clone so edits don't mutate a registered descriptor in place.
function _cloneDesc(d) {
  return JSON.parse(JSON.stringify(normalizeVoice(d)));
}

function _el(tag, css, text) {
  const e = document.createElement(tag);
  if (css) e.style.cssText = css;
  if (text != null) e.textContent = text;
  return e;
}

function _row(label) {
  const r = _el('div', 'display:flex;align-items:center;gap:8px;margin:4px 0;');
  if (label) {
    const l = _el('div', 'width:96px;color:#a6adc8;font-size:12px;flex:0 0 auto;', label);
    r.appendChild(l);
  }
  return r;
}

function _slider(min, max, step, value, oninput) {
  const s = document.createElement('input');
  s.type = 'range';
  s.min = String(min);
  s.max = String(max);
  s.step = String(step);
  s.value = String(value);
  s.style.cssText = 'flex:1;';
  s.addEventListener('input', () => oninput(parseFloat(s.value)));
  return s;
}

function _select(options, value, onchange) {
  const sel = document.createElement('select');
  sel.style.cssText =
    'background:#15151f;color:#cdd6f4;border:1px solid #313244;border-radius:4px;padding:3px 6px;';
  for (const o of options) {
    const opt = document.createElement('option');
    opt.value = o;
    opt.textContent = o;
    if (o === value) opt.selected = true;
    sel.appendChild(opt);
  }
  sel.addEventListener('change', () => onchange(sel.value));
  return sel;
}

function _button(text, css, onclick) {
  const b = document.createElement('button');
  b.textContent = text;
  b.style.cssText =
    'background:#313244;color:#cdd6f4;border:none;border-radius:4px;padding:4px 10px;cursor:pointer;' +
    (css ?? '');
  b.addEventListener('click', onclick);
  return b;
}

// Audition: (re)build a temp voice from the current desc, play one note.
function _audition(state) {
  try {
    Tone.start?.();
  } catch (_) {}
  try {
    state.preview?.dispose?.();
  } catch (_) {}
  const v = instantiateVoice(state.desc);
  try {
    v.output.toDestination?.();
  } catch (_) {}
  state.preview = v;
  v.trigger('C4', '8n');
}

function _render(state) {
  const { body } = state;
  body.innerHTML = '';
  const desc = state.desc;
  desc.opts = desc.opts ?? {};
  desc.opts.oscillator = desc.opts.oscillator ?? {};
  desc.opts.envelope = desc.opts.envelope ?? {};

  // ── Engine + poly ──
  const engRow = _row('Engine');
  engRow.appendChild(
    _select(engineNames(), desc.engine, (v) => {
      desc.engine = v;
      _render(state);
    }),
  );
  const polyLab = _el(
    'label',
    'display:flex;align-items:center;gap:4px;color:#a6adc8;font-size:12px;',
  );
  const polyChk = document.createElement('input');
  polyChk.type = 'checkbox';
  polyChk.checked = desc.poly !== false;
  polyChk.addEventListener('change', () => {
    desc.poly = polyChk.checked;
  });
  polyLab.appendChild(polyChk);
  polyLab.appendChild(document.createTextNode('poly'));
  engRow.appendChild(polyLab);
  body.appendChild(engRow);

  // ── Oscillator ──
  const oscRow = _row('Wave');
  oscRow.appendChild(
    _select(OSC_TYPES, desc.opts.oscillator.type ?? 'sine', (v) => {
      desc.opts.oscillator.type = v;
    }),
  );
  body.appendChild(oscRow);

  // ── ADSR ──
  const env = desc.opts.envelope;
  const adsr = [
    ['Attack', 'attack', 0, 2, 0.01, env.attack ?? 0.01],
    ['Decay', 'decay', 0, 2, 0.01, env.decay ?? 0.2],
    ['Sustain', 'sustain', 0, 1, 0.01, env.sustain ?? 0.5],
    ['Release', 'release', 0, 4, 0.01, env.release ?? 0.5],
  ];
  for (const [label, key, mn, mx, st, val] of adsr) {
    const r = _row(label);
    const valEl = _el(
      'div',
      'width:36px;text-align:right;color:#6c7086;font-size:11px;',
      String(val),
    );
    r.appendChild(
      _slider(mn, mx, st, val, (v) => {
        env[key] = v;
        valEl.textContent = String(v);
      }),
    );
    r.appendChild(valEl);
    body.appendChild(r);
  }

  // ── Effects chain ──
  const fxHdr = _row('Effects');
  fxHdr.appendChild(
    _button('+ add', 'padding:2px 8px;font-size:11px;', () => {
      desc.effects = desc.effects ?? [];
      desc.effects.push({ type: 'reverb', wet: 0.3 });
      _render(state);
    }),
  );
  body.appendChild(fxHdr);

  desc.effects = desc.effects ?? [];
  desc.effects.forEach((fx, i) => {
    const r = _row('');
    r.style.paddingLeft = '96px';
    r.appendChild(
      _select(FX_TYPES, fx.type, (v) => {
        fx.type = v;
      }),
    );
    const wet = _slider(0, 1, 0.01, fx.wet ?? 0.3, (v) => {
      fx.wet = v;
    });
    wet.title = 'wet';
    r.appendChild(wet);
    r.appendChild(
      _button('✕', 'padding:2px 8px;font-size:11px;', () => {
        desc.effects.splice(i, 1);
        _render(state);
      }),
    );
    body.appendChild(r);
  });

  // ── Save row ──
  const saveRow = _row('Name');
  const nameIn = document.createElement('input');
  nameIn.type = 'text';
  nameIn.value = desc.name ?? state.name ?? '';
  nameIn.placeholder = 'my voice';
  nameIn.style.cssText =
    'flex:1;background:#15151f;color:#cdd6f4;border:1px solid #313244;border-radius:4px;padding:4px 6px;';
  nameIn.addEventListener('input', () => {
    state.name = nameIn.value;
  });
  saveRow.appendChild(nameIn);
  saveRow.appendChild(_button('▶', 'background:#45475a;', () => _audition(state)));
  saveRow.appendChild(
    _button('Save', 'background:#a6e3a1;color:#11111b;font-weight:600;', () => {
      const nm = (state.name || nameIn.value || '').trim();
      if (!nm) {
        nameIn.style.borderColor = '#f38ba8';
        return;
      }
      Voice.define(nm, desc);
      state.name = nm;
      saveRow.querySelector('.saved-msg')?.remove();
      const ok = _el('span', 'color:#a6e3a1;font-size:11px;margin-left:6px;', '✓ saved');
      ok.className = 'saved-msg';
      saveRow.appendChild(ok);
    }),
  );
  body.appendChild(saveRow);
}

export function openSynthDesigner(seed) {
  if (!window.wm) return null;
  // Reuse a single live panel.
  if (_designer && document.getElementById(_designer.winId)) {
    _designer.desc = _cloneDesc(seed);
    _designer.name = _designer.desc.name ?? '';
    _render(_designer);
    window.wm.focus?.(_designer.winId);
    return _designer.winId;
  }

  const winId = window.wm.spawn('Synth Designer', {
    type: 'html',
    html: '',
    w: 360,
    h: 460,
    audio: true,
  });
  const win = document.getElementById(winId);
  const wmBody = win?.querySelector('.wm-body');
  if (!wmBody) return null;
  wmBody.style.cssText += 'background:#0d0d14;overflow-y:auto;padding:10px;';
  const body = _el('div', 'display:flex;flex-direction:column;');
  wmBody.appendChild(body);

  const state = {
    winId,
    body,
    desc: _cloneDesc(seed),
    name: '',
    preview: null,
  };
  state.name = state.desc.name ?? '';
  _designer = state;

  window.wm.window?.(winId)?.onDispose(() => {
    try {
      state.preview?.dispose?.();
    } catch (_) {}
    if (_designer?.winId === winId) _designer = null;
  });
  if (win) win._widgetType = 'synth-designer';

  _render(state);
  return winId;
}

// Wire onto the Voice registry as the no-code door.
Voice.design = openSynthDesigner;

// Test helper
export function _resetDesignerForTesting() {
  _designer = null;
}
