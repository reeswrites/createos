// test-harness.js — dev/e2e-only `window.__ar_test` seam for driving the app
// programmatically (MCP browser automation, Playwright/e2e). Gated to DEV or
// `?e2e=1` in app.js's onload, so it never ships in a production build.
//
// It wraps EXISTING seams — `replaceCode` (active-editor.js), the EditorInstance
// run methods, and `applyProject` — rather than re-deriving CodeMirror, the run
// sequence, or mixer internals. That means a rename lands in one place instead of
// scattered across every automation script. Reverse-engineering `__ar_instances`
// → `.cm` → `.execute()` by hand (what an ad-hoc MCP session does) breaks silently
// on any of those; this seam is the supported entry point.
//
// API (all on window.__ar_test):
//   loadCode(code, {editorId=1, run=true})  — replace an editor's doc and run it
//   loadDemo(fileOrId, {run=true})          — fetch a public/demos/*.vljson + apply
//   getState(editorId=1)                    — { running, live, hadOutput, code, ... }
//   stop(editorId=1)                        — teardown the run
//   audioPeak(ms=2000)                      — measure master output (peak + avg RMS)
//
// audioPeak exists because audio is otherwise unverifiable over MCP — you can't
// hear the tab. A non-zero peak proves sound is actually reaching the destination.

import { replaceCode } from '../editor/active-editor.js';

export function installTestHarness({ applyProject, appAPI } = {}) {
  const instances = () => window.__ar_instances;
  const inst = (id = 1) => instances()?.get(id) ?? null;

  async function loadCode(code, { editorId = 1, run = true } = {}) {
    const one = inst(editorId);
    if (!one) throw new Error('test-harness: no editor ' + editorId);
    one.stopRunning?.();
    replaceCode(code, { editorId });
    if (run) one.execute({});
    return true;
  }

  async function loadDemo(fileOrId, { run = true } = {}) {
    const file = String(fileOrId).endsWith('.vljson') ? fileOrId : fileOrId + '.vljson';
    const url = (import.meta.env.BASE_URL || '/') + 'demos/' + file + '?t=' + Date.now();
    const proj = await fetch(url).then((r) => {
      if (!r.ok) throw new Error('test-harness: demo not found ' + file);
      return r.json();
    });
    const editors = (proj.windows ?? []).filter((w) => w.type === 'editor');
    if (applyProject) {
      await applyProject(proj, window.wm, instances(), appAPI);
      // applyProject already ran any editor with executionState:'running' — only
      // kick the rest, so we don't double-execute (which zombies the first run).
      if (run) instances()?.forEach((i) => i.btnState !== 'running' && i.execute?.());
    } else if (editors.length) {
      await loadCode(editors[0].code, { editorId: editors[0].editorId ?? 1, run });
    }
    return { editors: editors.length };
  }

  function getState(editorId = 1) {
    const one = inst(editorId);
    if (!one) return null;
    return {
      running: one.btnState === 'running',
      live: one._isLive?.(),
      hadOutput: one._hadOutput,
      keepAlive: one._keepAlive?.size,
      code: one.cm?.state.doc.toString(),
    };
  }

  function stop(editorId = 1) {
    inst(editorId)?.stopRunning?.();
  }

  async function audioPeak(ms = 2000) {
    const T = appAPI?.audio?.Tone || window.audio?.Tone;
    if (!T) return null;
    try {
      await T.getContext().resume();
    } catch (_) {}
    const an = new T.Analyser('waveform', 512);
    T.getDestination().connect(an);
    let peak = 0,
      rms = 0,
      n = 0;
    const t0 = performance.now();
    while (performance.now() - t0 < ms) {
      const b = an.getValue();
      let s = 0;
      for (let i = 0; i < b.length; i++) {
        const v = Math.abs(b[i]);
        if (v > peak) peak = v;
        s += v * v;
      }
      rms += Math.sqrt(s / b.length);
      n++;
      await new Promise((r) => setTimeout(r, 25));
    }
    an.dispose();
    return { peak: +peak.toFixed(4), avgRMS: +(rms / Math.max(1, n)).toFixed(4) };
  }

  // Reset persisted mixer state to a clean slate. Automation that pokes mixer
  // strip facades (`.mute()`/`.solo()` are SETTERS — a no-arg call sets truthy)
  // can leave `localStorage['vl_mixer']` with a muted/soloed master that silences
  // every later run. Call this before an audio check to start from unity.
  function resetMixer() {
    try {
      localStorage.removeItem('vl_mixer');
    } catch (_) {}
    const mx = window.mixer;
    if (!mx) return false;
    try {
      mx.master.mute(false);
      mx.master.volume(0);
      for (const n of mx.names?.() ?? []) {
        mx.strip(n).mute(false);
        mx.strip(n).solo(false);
      }
    } catch (_) {}
    return true;
  }

  window.__ar_test = { loadCode, loadDemo, getState, stop, audioPeak, resetMixer };
  return window.__ar_test;
}
