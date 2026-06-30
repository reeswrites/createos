// run.js — the named sequence one execute() performs, lifted out of EditorInstance so
// the run lifecycle is testable without CodeMirror or a DOM. See CONTEXT.md "Run
// (module) / Code Injector".
//
//   buildRunScript({ raw, id, preamble, traceEnabled }) -> { code }   (pure)
//   scriptInjector                                                    (production injector)
//   startRun({ raw, id, traceEnabled, soft, preamble, deps, injector })
//
// EditorInstance.execute() shrinks to GATHERING its inputs (code from blocks/CM, the
// trace flag, the preamble) and delegating here. The Code Injector is the one
// un-fakeable step behind its own seam: scriptInjector appends a <script>; a test
// passes an injector that captures the wrapped code and runs nothing.

import {
  transformCode,
  makeLoopProtectionVisitor,
  makeTraceVisitor,
  friendlyError,
} from '../editor/live-patch.js';
import { detectAPIUsage } from '../editor/api-detector.js';
import { _beginRun } from './api-registry.js';
import { startAudio } from '../api/audio/audio.js';
import { emit } from '../events/index.js';
import { setActiveEditorId, setUsesAudio, setAudioReady, setFriendlyError } from './run-context.js';

// Pure: raw user code → the wrapped script string injected at run time. Applies the
// AST Transform Pipeline (loop protection always; trace injection when enabled),
// prepends the per-editor preamble, and wraps everything in the async IIFE whose
// .catch/.then route errors and liveness back to the instance. No DOM, no globals
// written — so a test can assert the preamble, the trace calls, and the line offset.
export function buildRunScript({ raw, id, preamble, traceEnabled }) {
  let protectedCode;
  try {
    const visitors = [makeLoopProtectionVisitor()];
    if (traceEnabled) visitors.push(makeTraceVisitor(id));
    protectedCode = transformCode(raw, visitors);
  } catch (_) {
    protectedCode = raw;
  }

  const ns = `__ar_e${id}`;
  const code =
    `(async function(){\n${preamble}\nawait window.__ar_audioReady;\n${protectedCode}\n})()` +
    `.catch(e => { const msg = window.__ar_friendlyError(e); window.${ns}_console.error('Error: ' + msg); window.__ar_instances?.get(${id})?._onError(e); })` +
    `.then(() => { window.__ar_instances?.get(${id})?._checkLiveOrStop(); });`;
  return { code };
}

// Production Code Injector: user code runs as a dynamically injected <script> tag, not
// a module, so all window APIs are in scope (see CLAUDE.md). Returns the element so the
// instance can hold it as currentScript.
export const scriptInjector = {
  run(code) {
    const script = document.createElement('script');
    try {
      script.appendChild(document.createTextNode(code));
    } catch {
      script.text = code;
    }
    document.body.appendChild(script);
    return script;
  },
};

// The run sequence. `deps` are the instance-coupled callbacks (reset, keep-alive prep,
// console clear, UI state, idle watcher); everything else is module state this owns.
export function startRun({
  raw,
  id,
  traceEnabled,
  soft,
  preamble,
  deps,
  injector = scriptInjector,
}) {
  // Camera/mic are demand-driven (ADR 023): consumers acquire leases when called.
  deps.clearAutoExec();
  deps.reset(soft);
  _beginRun(); // snapshot API registry so run-scoped registerAPI() calls revert on reset

  // Smart output detection: analyse user code first so audio only starts when needed.
  // ADR 040: no auto-opened output window — visual output spawns from new Canvas()/.show().
  const hints = detectAPIUsage(raw);
  setUsesAudio(hints.usesAudio);
  setAudioReady(hints.usesAudio ? startAudio() : Promise.resolve());
  if (hints.usesAudio) deps.ensureAudioChip();

  // Keep-alive Set is owned by the instance (fresh on hard reset); publish it for the
  // run (out of Run Context scope by design — keep-alive.js owns it).
  window.__ar_keepAlive = deps.prepareKeepAlive(soft);
  deps.clearConsole();

  // Tag listeners to this editor during synchronous setup.
  setActiveEditorId(id);
  emit('session:start', { code: raw });

  const { code } = buildRunScript({ raw, id, preamble, traceEnabled });
  setFriendlyError(friendlyError);

  deps.setRunning();
  deps.onScript(injector.run(code));
  deps.startIdleWatcher();
}
