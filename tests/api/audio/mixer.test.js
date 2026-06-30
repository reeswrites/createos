import { describe, test, expect, vi, beforeEach } from 'vitest';

// ── Minimal Tone mock (mixer only needs Gain/Volume/Meter/Channel/Filter/connect) ──
vi.mock('tone', () => {
  const node = () => ({ connect: vi.fn(), disconnect: vi.fn(), chain: vi.fn(), dispose: vi.fn() });
  return {
    default: {},
    Gain:    vi.fn(function () { return node(); }),
    Volume:  vi.fn(function () { return { ...node(), volume: { value: 0 } }; }),
    Meter:   vi.fn(function () { return { ...node(), getValue: () => -80 }; }),
    Channel: vi.fn(function () { return { ...node(), volume: { value: 0 }, pan: { value: 0 }, mute: false }; }),
    Filter:  vi.fn(function () { return { ...node(), frequency: { value: 0 }, gain: { value: 0 }, Q: { value: 0 } }; }),
    connect: vi.fn(),
    getDestination: () => ({ connect: vi.fn(), disconnect: vi.fn(), volume: { value: 0 } }),
  };
});

const m = await import('../../../src/api/audio/mixer.js');
const { mixer, acquireStrip, getStrip, cleanupMixer, serializeMixer, restoreMixer } = m;

// localStorage is non-functional in this jsdom env (mixer guards it with try/catch);
// assert persisted settings via serializeMixer() instead.
beforeEach(() => { cleanupMixer(null); restoreMixer({}); });

describe('Mixer strips', () => {
  test('acquireStrip creates + getStrip returns it', () => {
    const s = acquireStrip('lead', { type: 'instrument' });
    expect(s.name).toBe('lead');
    expect(getStrip('lead')).toBe(s);
  });

  test('auto-names from nameHint with per-run counter', () => {
    const a = acquireStrip(null, { type: 'instrument', nameHint: 'fm' });
    const b = acquireStrip(null, { type: 'instrument', nameHint: 'fm' });
    expect(a.name).toBe('fm 1');
    expect(b.name).toBe('fm 2');
  });

  test('volume setter persists to settings + localStorage', () => {
    acquireStrip('lead');
    mixer.strip('lead').volume(-6);
    expect(getStrip('lead')._channel.volume.value).toBe(-6);
    expect(serializeMixer().lead.volume).toBe(-6);
  });

  test('setting a strip before it exists is applied on creation', () => {
    mixer.strip('bass').pan(-0.5);          // no live strip yet
    const s = acquireStrip('bass');
    expect(s._channel.pan.value).toBe(-0.5); // applied from persisted settings
  });

  test('solo ducks non-soloed strips (deterministic, our own logic)', () => {
    const a = acquireStrip('a'), b = acquireStrip('b');
    mixer.strip('a').solo(true);
    expect(a._channel.mute).toBe(false); // soloed plays
    expect(b._channel.mute).toBe(true);  // others duck
    mixer.strip('a').solo(false);
    expect(b._channel.mute).toBe(false); // un-solo restores
  });

  test('new source created while a solo is active also ducks', () => {
    acquireStrip('a');
    mixer.strip('a').solo(true);
    const c = acquireStrip('late');
    expect(c._channel.mute).toBe(true);
  });

  test('cleanupMixer tears down run strips for the editor but keeps settings', () => {
    acquireStrip('lead', { type: 'instrument', owner: 7, lifecycle: 'run' });
    mixer.strip('lead').volume(-9);
    cleanupMixer(7);
    expect(getStrip('lead')).toBeNull();
    // settings survive → re-created strip inherits them
    const s2 = acquireStrip('lead', { type: 'instrument', owner: 7 });
    expect(s2._channel.volume.value).toBe(-9);
  });

  test('cleanupMixer(editorId) spares another editor\'s run strip', () => {
    acquireStrip('mine', { owner: 1, lifecycle: 'run' });
    acquireStrip('yours', { owner: 2, lifecycle: 'run' });
    cleanupMixer(1);
    expect(getStrip('mine')).toBeNull();
    expect(getStrip('yours')).not.toBeNull();
  });

  test('window-lifecycle strips survive reset', () => {
    acquireStrip('vid', { type: 'window', owner: 'win-x', lifecycle: 'window' });
    cleanupMixer(null);
    expect(getStrip('vid')).not.toBeNull();
  });

  test('serializeMixer / restoreMixer round-trips settings', () => {
    acquireStrip('lead');
    mixer.strip('lead').volume(-4).pan(0.2);
    const snap = serializeMixer();
    expect(snap.lead.volume).toBe(-4);
    restoreMixer({ lead: { volume: 3, pan: -0.1, mute: false, solo: false, eq: null } });
    expect(getStrip('lead')._channel.volume.value).toBe(3);
  });

  test('mixer.add inserts an arbitrary node and returns a handle', () => {
    const fakeNode = { connect: vi.fn() };  // raw AudioNode (no toDestination)
    const h = mixer.add(fakeNode, { name: 'fx' });
    expect(h.name).toBe('fx');
    expect(getStrip('fx')).not.toBeNull();
  });
});
