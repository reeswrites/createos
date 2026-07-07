import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildRunScript, startRun } from '../../../src/runtime/run.js';

// The Run module lifted the execute() sequence out of EditorInstance so it can be
// exercised with a fake injector — no CodeMirror, no real <script>. buildRunScript is
// pure (the wrapped-code builder, incl. the PREAMBLE_LINES-sensitive offset).

describe('buildRunScript', () => {
  it('wraps user code in the async IIFE after the preamble', () => {
    const { code } = buildRunScript({
      raw: 'foo()',
      id: 3,
      preamble: 'const x = 1;',
      traceEnabled: false,
    });
    expect(code).toContain('(async function(){\nconst x = 1;\n');
    expect(code).toContain('foo()');
    // user code is NOT gated on audio-ready — that await would deadlock a
    // gesture-less auto-exec (audio unlocks lazily at acquireStrip; ADR 058)
    expect(code).not.toContain('await window.__ar_audioReady');
    // error + liveness tails are keyed to the editor id
    expect(code).toContain('__ar_e3_console.error');
    expect(code).toContain('__ar_instances?.get(3)?._checkLiveOrStop()');
  });

  it('injects trace calls only when traceEnabled', () => {
    const off = buildRunScript({ raw: 'a();', id: 1, preamble: '', traceEnabled: false }).code;
    const on = buildRunScript({ raw: 'a();', id: 1, preamble: '', traceEnabled: true }).code;
    expect(off).not.toContain('__ar_e1_trace');
    expect(on).toContain('__ar_e1_trace');
  });
});

describe('startRun', () => {
  let deps, calls;

  beforeEach(() => {
    calls = [];
    window.__ar_audioReady = Promise.resolve();
    window.__ar_instances = new Map();
    deps = {
      clearAutoExec: () => calls.push('clearAutoExec'),
      reset: (s) => calls.push(`reset:${s}`),
      ensureAudioChip: () => calls.push('ensureAudioChip'),
      prepareKeepAlive: (s) => {
        calls.push(`prepareKeepAlive:${s}`);
        return new Set();
      },
      clearConsole: () => calls.push('clearConsole'),
      setRunning: () => calls.push('setRunning'),
      startIdleWatcher: () => calls.push('startIdleWatcher'),
      onScript: (s) => calls.push(`onScript:${typeof s}`),
    };
  });

  afterEach(() => {
    delete window.__ar_keepAlive;
    delete window.__ar_instances;
  });

  it('runs the sequence in order and feeds the wrapped code to the injector', () => {
    let captured = null;
    const injector = {
      run(code) {
        captured = code;
        return { fake: true };
      },
    };

    startRun({
      raw: 'sketch()',
      id: 7,
      traceEnabled: false,
      soft: false,
      preamble: 'const p = 1;',
      deps,
      injector,
    });

    // The un-fakeable <script> step was replaced by our capture injector.
    expect(captured).toContain('sketch()');
    expect(captured).toContain('const p = 1;');
    // Order: reset before run, inject before idle watcher.
    expect(calls.indexOf('reset:false')).toBeLessThan(calls.indexOf('setRunning'));
    expect(calls).toContain('onScript:object');
    expect(calls[calls.length - 1]).toBe('startIdleWatcher');
    // Active editor was tagged for the run.
    expect(window.__ar_active_editor_id).toBe(7);
  });

  it('passes soft through to reset and keep-alive prep', () => {
    startRun({
      raw: '',
      id: 1,
      soft: true,
      preamble: '',
      deps,
      injector: { run: () => ({}) },
    });
    expect(calls).toContain('reset:true');
    expect(calls).toContain('prepareKeepAlive:true');
  });
});
