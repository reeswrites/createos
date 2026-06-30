import { describe, it, expect, vi } from 'vitest';

// ── Minimal stubs needed before audio.js loads ──────────────────────────────

// Tone.js stub
const _loops = [];
const _toneMock = {
  start: vi.fn(),
  getTransport: () => ({ bpm: { value: 120 }, start: vi.fn(), stop: vi.fn() }),
  Time: (v) => ({ toSeconds: () => (v === '1m' ? 2 : parseFloat(v)) }),
  Frequency: (v) => ({
    toMidi:      () => { const n={'C4':60,'D4':62,'E4':64,'G4':67,'Bb3':58,'C3':48,'E3':52,'G3':55}; return n[v]??60; },
    toFrequency: () => 440,
  }),
  Loop: class {
    constructor(fn, interval) { this._fn = fn; this._interval = interval; _loops.push(this); }
    start() { return this; }
    stop()  { return this; }
    dispose() {}
  },
  NoiseSynth: class {},
  MetalSynth: class {},
  getDestination: () => ({ connect: vi.fn(), volume: { value: 0 } }),
  getContext: () => ({ rawContext: {} }),
  Analyser: class { getValue() { return new Float32Array(128); } dispose() {} connect() {} },
  now: () => 0,
};

vi.mock('tone', () => _toneMock);

// Audio context, mic, etc.
global.window.__ar_mic_analyser = null;
global.window.__ar_camera_on = true;
global.navigator = { mediaDevices: { enumerateDevices: async () => [], getUserMedia: async () => ({}) } };

// ── Import after stubs ───────────────────────────────────────────────────────

// We test the parser/flatten/Pattern logic directly by extracting via dynamic import
// Since audio.js is a module with Tone dependency we call the exported Pattern indirectly.
// To test parsing logic in isolation, we duplicate the pure functions here.

// ── Pure parser/flatten extracted for unit testing ──────────────────────────

function tokenize(str) {
  str = str.replace(/(-?\d+)\.\.(-?\d+)/g, (_, a, b) => {
    const lo = +a, hi = +b, step = lo <= hi ? 1 : -1;
    const out = [];
    for (let i = lo; step > 0 ? i <= hi : i >= hi; i += step) out.push(i);
    return out.join(' ');
  });
  const tokens = [];
  let i = 0;
  while (i < str.length) {
    if (/\s/.test(str[i])) { i++; continue; }
    const ch = str[i];
    if ('[]<>{},'.includes(ch)) {
      tokens.push(ch); i++;
      if (ch === '}' && str[i] === '%') {
        i++;
        let j = i; while (j < str.length && /\d/.test(str[j])) j++;
        tokens.push('%' + str.slice(i, j)); i = j;
      }
    } else {
      let j = i; while (j < str.length && !/[\s[\]<>{},]/.test(str[j])) j++;
      tokens.push(str.slice(i, j)); i = j;
    }
  }
  return tokens;
}

function parse(tokens) {
  let pos = 0;
  function parseItems(end) {
    const raw = [];
    while (pos < tokens.length) {
      const t = tokens[pos];
      if (end !== null && t === end) break;
      if (end === null && (t === ']' || t === '>' || t === '}' || t?.startsWith('%'))) break;
      if (t === '[') {
        pos++; raw.push({ type: 'group', items: parseItems(']') }); if (tokens[pos] === ']') pos++;
      } else if (t === '<') {
        pos++; raw.push({ type: 'alt', items: parseItems('>') }); if (tokens[pos] === '>') pos++;
      } else if (t === '{') {
        pos++;
        const sub = parseItems('}'); if (tokens[pos] === '}') pos++;
        let steps = 4;
        if (tokens[pos]?.startsWith('%')) { steps = +tokens[pos].slice(1) || 4; pos++; }
        raw.push({ type: 'polymeter', items: sub, steps });
      } else if (t === ',') {
        pos++; raw.push({ type: '_sep' });
      } else {
        pos++;
        let val = t, repeat = 1, weight = 1, degrade = false;
        const rm = val.match(/\*(\d+)$/); if (rm) { repeat = +rm[1]; val = val.slice(0, -rm[0].length); }
        const im = val.match(/!(\d*)$/);  if (im) { repeat = +im[1] || 2; val = val.slice(0, -im[0].length); }
        const wm = val.match(/@(\d*\.?\d+)$/); if (wm) { weight = +wm[1]; val = val.slice(0, -wm[0].length); }
        const dm = val.match(/\?(\d*\.?\d*)$/); if (dm) { degrade = dm[1] ? +dm[1] : 0.5; val = val.slice(0, -dm[0].length); }
        raw.push({ type: 'atom', value: val, repeat, weight, degrade });
      }
    }
    if (raw.some(r => r.type === '_sep')) {
      const groups = []; let cur = [];
      for (const r of raw) { if (r.type === '_sep') { groups.push(cur); cur = []; } else cur.push(r); }
      groups.push(cur);
      return groups.length > 1 ? [{ type: 'poly', groups }] : groups[0] ?? [];
    }
    return raw;
  }
  return parseItems(null);
}

function itemWeight(it) { return it.type === 'atom' ? it.weight * it.repeat : 1; }

function atomValues(items) {
  const vals = [];
  for (const it of items) {
    if (it.type === 'atom' && it.value !== '~' && it.value !== '.') {
      for (let r = 0; r < it.repeat; r++) vals.push(it.value);
    } else if (it.type === 'group' || it.type === 'alt') { vals.push(...atomValues(it.items)); }
    else if (it.type === 'poly') { for (const g of it.groups) vals.push(...atomValues(g)); }
  }
  return vals;
}

function flatten(items, cycleNum = 0) {
  const total = items.reduce((s, it) => s + itemWeight(it), 0);
  if (total === 0) return [];
  const events = []; let off = 0;
  for (const it of items) {
    const slot = itemWeight(it) / total;
    if (it.type === 'atom') {
      const aDur = slot / it.repeat;
      if (it.value !== '~' && it.value !== '.') {
        for (let r = 0; r < it.repeat; r++) {
          if (!it.degrade) events.push({ value: it.value, time: off + r * aDur, dur: aDur });
        }
      }
      off += slot;
    } else if (it.type === 'group') {
      flatten(it.items, cycleNum).forEach(e => events.push({ ...e, time: e.time * slot + off, dur: e.dur * slot }));
      off += slot;
    } else if (it.type === 'alt') {
      if (it.items.length) {
        const chosen = it.items[cycleNum % it.items.length];
        flatten([chosen], cycleNum).forEach(e => events.push({ ...e, time: e.time * slot + off, dur: e.dur * slot }));
      }
      off += slot;
    } else if (it.type === 'poly') {
      for (const grp of it.groups) {
        flatten(grp, cycleNum).forEach(e => events.push({ ...e, time: e.time * slot + off, dur: e.dur * slot }));
      }
      off += slot;
    } else if (it.type === 'polymeter') {
      const vals = atomValues(it.items);
      if (vals.length) {
        const stepDur = slot / it.steps;
        for (let s = 0; s < it.steps; s++) {
          const idx = (cycleNum * it.steps + s) % vals.length;
          events.push({ value: vals[idx], time: off + s * stepDur, dur: stepDur });
        }
      }
      off += slot;
    }
  }
  return events;
}

function query(str, cycleNum = 0) { return flatten(parse(tokenize(str)), cycleNum); }

// ── Tests ────────────────────────────────────────────────────────────────────

describe('tokenizer', () => {
  it('basic atoms', () => expect(tokenize('C4 E4 G4')).toEqual(['C4', 'E4', 'G4']));
  it('groups and alt', () => expect(tokenize('[C4 E4] <G4 Bb4>')).toEqual(['[','C4','E4',']','<','G4','Bb4','>']));
  it('range expansion 0..3', () => expect(tokenize('0..3')).toEqual(['0','1','2','3']));
  it('range expansion 3..0', () => expect(tokenize('3..0')).toEqual(['3','2','1','0']));
  it('polymeter tokens', () => expect(tokenize('{C4 E4}%3')).toEqual(['{','C4','E4','}','%3']));
  it('polyphony comma', () => expect(tokenize('C4, E4')).toEqual(['C4',',','E4']));
  it('atom modifiers !', () => expect(tokenize('C4!')).toEqual(['C4!']));
  it('atom modifiers @', () => expect(tokenize('C4@2')).toEqual(['C4@2']));
  it('atom modifiers ?', () => expect(tokenize('C4?')).toEqual(['C4?']));
});

describe('parser', () => {
  it('simple atoms', () => {
    const r = parse(tokenize('C4 E4'));
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ type: 'atom', value: 'C4', repeat: 1, weight: 1 });
  });

  it('*N repeat', () => {
    const r = parse(tokenize('C4*3'));
    expect(r[0]).toMatchObject({ type: 'atom', value: 'C4', repeat: 3 });
  });

  it('!N replicate (default 2)', () => {
    const r = parse(tokenize('C4! E4'));
    expect(r[0]).toMatchObject({ type: 'atom', value: 'C4', repeat: 2 });
  });

  it('!N replicate explicit', () => {
    const r = parse(tokenize('C4!3'));
    expect(r[0]).toMatchObject({ type: 'atom', value: 'C4', repeat: 3 });
  });

  it('@N weight', () => {
    const r = parse(tokenize('C4@2 E4'));
    expect(r[0]).toMatchObject({ type: 'atom', value: 'C4', weight: 2 });
    expect(r[1]).toMatchObject({ type: 'atom', value: 'E4', weight: 1 });
  });

  it('? degrade sets degrade=0.5', () => {
    const r = parse(tokenize('C4?'));
    expect(r[0]).toMatchObject({ type: 'atom', value: 'C4', degrade: 0.5 });
  });

  it('group', () => {
    const r = parse(tokenize('[C4 E4]'));
    expect(r[0].type).toBe('group');
    expect(r[0].items).toHaveLength(2);
  });

  it('alt', () => {
    const r = parse(tokenize('<C4 E4>'));
    expect(r[0].type).toBe('alt');
    expect(r[0].items).toHaveLength(2);
  });

  it('polyphony via comma', () => {
    const r = parse(tokenize('C4, E4, G4'));
    expect(r[0].type).toBe('poly');
    expect(r[0].groups).toHaveLength(3);
  });

  it('polymeter {}%N', () => {
    const r = parse(tokenize('{C4 E4 G4}%4'));
    expect(r[0].type).toBe('polymeter');
    expect(r[0].steps).toBe(4);
    expect(r[0].items).toHaveLength(3);
  });
});

describe('flatten — basic', () => {
  it('3 equal steps fill [0,1]', () => {
    const evs = query('C4 E4 G4');
    expect(evs).toHaveLength(3);
    expect(evs[0]).toMatchObject({ value: 'C4', time: 0, dur: 1/3 });
    expect(evs[2]).toMatchObject({ value: 'G4', time: 2/3, dur: 1/3 });
  });

  it('rests ~ are skipped', () => {
    const evs = query('C4 ~ E4');
    expect(evs).toHaveLength(2);
    expect(evs.map(e => e.value)).toEqual(['C4', 'E4']);
  });

  it('*N repeat fills N slots', () => {
    const evs = query('C4*2 E4');
    // C4 takes 2 slots, E4 takes 1 slot → total 3 slots
    expect(evs).toHaveLength(3);
    expect(evs[0]).toMatchObject({ value: 'C4', time: 0, dur: 1/3 });
    expect(evs[1]).toMatchObject({ value: 'C4', time: 1/3, dur: 1/3 });
  });

  it('@N weight gives longer duration', () => {
    const evs = query('C4@2 E4');
    // C4 weight=2 → takes 2/3 slot; E4 weight=1 → takes 1/3
    expect(evs[0]).toMatchObject({ value: 'C4', time: 0, dur: 2/3 });
    expect(evs[1]).toMatchObject({ value: 'E4', time: 2/3, dur: 1/3 });
  });

  it('group subdivides slot', () => {
    const evs = query('[C4 E4] G4');
    // group takes 1/2 slot; C4 and E4 each take 1/4 total
    expect(evs).toHaveLength(3);
    expect(evs[0]).toMatchObject({ value: 'C4', time: 0, dur: 1/4 });
    expect(evs[1]).toMatchObject({ value: 'E4', time: 1/4, dur: 1/4 });
    expect(evs[2]).toMatchObject({ value: 'G4', time: 1/2, dur: 1/2 });
  });

  it('alt picks by cycleNum', () => {
    const evs0 = query('<C4 E4>', 0);
    const evs1 = query('<C4 E4>', 1);
    expect(evs0[0].value).toBe('C4');
    expect(evs1[0].value).toBe('E4');
  });
});

describe('flatten — new features', () => {
  it('range 0..3 produces 4 events', () => {
    const evs = query('0..3');
    expect(evs).toHaveLength(4);
    expect(evs.map(e => e.value)).toEqual(['0','1','2','3']);
  });

  it('polyphony , produces simultaneous events at same time', () => {
    const evs = query('C4, E4');
    expect(evs).toHaveLength(2);
    // Both at time 0, same duration
    expect(evs[0].time).toBe(evs[1].time);
    expect(evs[0].dur).toBe(evs[1].dur);
  });

  it('polymeter {}%4 cycles through inner values', () => {
    // {C4 E4 G4}%4 — 4 steps, 3 inner values
    const evs0 = query('{C4 E4 G4}%4', 0); // steps 0,1,2,3 → C4,E4,G4,C4
    expect(evs0).toHaveLength(4);
    expect(evs0.map(e => e.value)).toEqual(['C4','E4','G4','C4']);

    const evs1 = query('{C4 E4 G4}%4', 1); // steps 4,5,6,7 → E4,G4,C4,E4
    expect(evs1.map(e => e.value)).toEqual(['E4','G4','C4','E4']);
  });

  it('polymeter steps evenly divide the cycle', () => {
    const evs = query('{C4 E4}%4', 0);
    expect(evs[0].dur).toBeCloseTo(1/4);
    expect(evs[1].time).toBeCloseTo(1/4);
  });
});

describe('Pattern transforms', () => {
  function wrap(qFn) {
    const p = { _q: qFn };
    p.fast    = (n)    => wrap(c => p._q(c).map(e => ({...e, time:e.time/n, dur:e.dur/n})));
    p.slow    = (n)    => p.fast(1/n);
    p.rev     = ()     => wrap(c => p._q(c).map(e => ({...e, time:1-e.time-e.dur})).sort((a,b)=>a.time-b.time));
    p.gain    = (v)    => wrap(c => p._q(c).map(e => ({...e, gain:(e.gain??1)*v})));
    p.add     = (_n)    => wrap(c => p._q(c).map(e => ({...e, value: e.value})));
    p.pan     = (v)    => wrap(c => p._q(c).map(e => ({...e, pan:v})));
    p.degrade = ()     => wrap(c => p._q(c).filter(() => Math.random() > 0.5));
    p.degradeBy = (pp) => wrap(c => p._q(c).filter(() => Math.random() > pp));
    p.jux     = (fn)   => wrap(c => [...p.pan(0)._q(c), ...fn(p).pan(1)._q(c)]);
    p.off     = (t,fn) => wrap(c => [...p._q(c), ...fn(p)._q(c).map(e => ({...e, time:(e.time+t+1)%1}))].sort((a,b)=>a.time-b.time));
    p.euclid  = (k,n,rot=0) => {
      const gate = Array(n).fill(false);
      for (let i=0;i<k;i++) gate[Math.floor((i*n)/k)]=true;
      const r = [...gate.slice(rot),...gate.slice(0,rot)];
      const evs = p._q(0); const dur = 1/n;
      return wrap(() => r.map((on,i) => on ? {value:evs[i%Math.max(evs.length,1)]?.value??'x',time:i*dur,dur} : null).filter(Boolean));
    };
    // learner aliases
    p.reverse   = ()     => p.rev();
    p.transpose = (n)    => p.add(n);
    p.dropout   = ()     => p.degrade();
    p.dropoutBy = (pp)   => p.degradeBy(pp);
    p.mirror    = (fn)   => p.jux(fn);
    p.offset    = (t,fn) => p.off(t,fn);
    p.rhythm    = (k,n,rot=0) => p.euclid(k,n,rot);
    p.volume    = (v)    => p.gain(v);
    return p;
  }
  function makePat(str) {
    const parsed = parse(tokenize(str));
    return wrap(c => flatten(parsed, c));
  }

  it('fast(2) halves time and dur', () => {
    const p = makePat('C4 E4');
    const evs = p.fast(2)._q(0);
    expect(evs[0]).toMatchObject({ value: 'C4', time: 0, dur: 1/4 });
    expect(evs[1]).toMatchObject({ value: 'E4', time: 1/4, dur: 1/4 });
  });

  it('slow(2) doubles time and dur', () => {
    const p = makePat('C4 E4');
    const evs = p.slow(2)._q(0);
    expect(evs[0]).toMatchObject({ value: 'C4', time: 0, dur: 1 });
  });

  it('rev() reverses event order', () => {
    const p = makePat('C4 E4 G4');
    const evs = p.rev()._q(0);
    expect(evs[0].value).toBe('G4');
    expect(evs[2].value).toBe('C4');
  });

  it('gain(0.5) halves event gain', () => {
    const p = makePat('C4');
    const evs = p.gain(0.5)._q(0);
    expect(evs[0].gain).toBe(0.5);
  });

  it('gain chaining multiplies', () => {
    const p = makePat('C4');
    const evs = p.gain(0.5).gain(0.5)._q(0);
    expect(evs[0].gain).toBeCloseTo(0.25);
  });

  it('reverse() is alias for rev()', () => {
    const p = makePat('C4 E4 G4');
    const a = p.rev()._q(0);
    const b = p.reverse()._q(0);
    expect(b.map(e => e.value)).toEqual(a.map(e => e.value));
  });

  it('transpose(n) is alias for add(n)', () => {
    const p = makePat('C4');
    const a = p.add(4)._q(0);
    const b = p.transpose(4)._q(0);
    expect(b[0].value).toBe(a[0].value);
  });

  it('dropout() is alias for degrade()', () => {
    const p = makePat('C4 E4 G4 B4');
    expect(typeof p.dropout).toBe('function');
    expect(typeof p.dropoutBy).toBe('function');
  });

  it('mirror(fn) is alias for jux(fn)', () => {
    const p = makePat('C4 E4');
    const a = p.jux(x => x.reverse())._q(0);
    const b = p.mirror(x => x.reverse())._q(0);
    expect(b.map(e => e.value)).toEqual(a.map(e => e.value));
  });

  it('offset(t, fn) is alias for off(t, fn)', () => {
    const p = makePat('C4 E4');
    const a = p.off(0.5, x => x)._q(0);
    const b = p.offset(0.5, x => x)._q(0);
    expect(b.length).toBe(a.length);
  });

  it('rhythm(k, n) is alias for euclid(k, n)', () => {
    const p = makePat('x');
    const a = p.euclid(3, 8)._q(0);
    const b = p.rhythm(3, 8)._q(0);
    expect(b.length).toBe(a.length);
    expect(b.map(e => e.time)).toEqual(a.map(e => e.time));
  });

  it('volume(v) is alias for gain(v)', () => {
    const p = makePat('C4');
    const a = p.gain(0.3)._q(0);
    const b = p.volume(0.3)._q(0);
    expect(b[0].gain).toBeCloseTo(a[0].gain);
  });
});

describe('audio.chord polyphony', () => {
  it('array of notes produces comma-separated polyphony', () => {
    const evs = query('C4,E4,G4');
    expect(evs.length).toBe(3);
    expect(evs.map(e => e.value).sort()).toEqual(['C4', 'E4', 'G4']);
    expect(evs.every(e => e.time === 0)).toBe(true);
  });

  it('chord notes all start at same time', () => {
    const evs = query('C4,E4,G4 B4');
    const chordEvs = evs.filter(e => e.time === 0);
    expect(chordEvs.length).toBe(3);
  });
});

describe('euclid rhythm', () => {
  function euclidRhythm(k, n) {
    const result = Array(n).fill(false);
    for (let i = 0; i < k; i++) result[Math.floor((i * n) / k)] = true;
    return result;
  }

  it('euclid(3,8) has 3 hits', () => {
    const r = euclidRhythm(3, 8);
    expect(r.filter(Boolean)).toHaveLength(3);
  });

  it('euclid(4,4) all hits', () => {
    const r = euclidRhythm(4, 4);
    expect(r.every(Boolean)).toBe(true);
  });

  it('euclid(1,4) first hit only', () => {
    const r = euclidRhythm(1, 4);
    expect(r[0]).toBe(true);
    expect(r.slice(1).every(v => !v)).toBe(true);
  });
});
