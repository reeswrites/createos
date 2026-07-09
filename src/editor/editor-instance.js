import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  drawSelection,
  dropCursor,
} from '@codemirror/view';
import { EditorState, StateEffect, StateField, RangeSetBuilder } from '@codemirror/state';
import { Decoration } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { javascript, javascriptLanguage } from '@codemirror/lang-javascript';
import {
  EDITOR_MANIFEST,
  LEGACY_EDITOR_CODE,
  editorCodeKey,
  editorExecKey,
  editorTitleKey,
  editorAutoExecKey,
  editorTraceKey,
} from '../runtime/storage-keys.js';
import {
  bracketMatching,
  foldGutter,
  codeFolding,
  foldKeymap,
  indentOnInput,
  foldCode,
  syntaxHighlighting,
  defaultHighlightStyle,
} from '@codemirror/language';
import {
  closeBrackets,
  closeBracketsKeymap,
  autocompletion,
  completionKeymap,
} from '@codemirror/autocomplete';
import { highlightSelectionMatches } from '@codemirror/search';
import { linter, lintGutter } from '@codemirror/lint';
import esprima from 'esprima';
import { extractScriptLine } from './live-patch.js';
import { _endRun } from '../runtime/api-registry.js';
import {
  initInlineWidgets,
  inlineWidgetsExtension,
  toggleInlayHintsEffect,
  inlayHintsEnabledField,
} from './inline-widgets.js';
import { searchMarksField, initSearch } from './cm-search.js';
import { TraceController, traceLineField } from './trace-controller.js';
import { paramHintsExtension } from './param-hints.js';
import { windowMemberCompletionSource } from './completions.js';
import { shaderSignalPickerExtension } from './shader-signal-picker.js';
import {
  addEditorIcon,
  removeEditorIcon,
  updateEditorIconLabel,
  duplicateEditor,
} from '../api/platform/desktop-files.js';
// Per-subsystem cleanups are no longer imported here — each module self-registers
// via onReset() and runResetHandlers() runs them all on reset (ADR 008).
import { runResetHandlers } from '../runtime/reset-registry.js';
import { emit, clearRunScoped } from '../events/index.js';
import { eventCompletionSource } from './event-completion.js';
import { PauseController } from '../runtime/pause-controller.js';
import { setPaused, setUsesAudio } from '../runtime/run-context.js';
import { startRun } from '../runtime/run.js';

// After execute(), a persisted 'paused' editor needs a beat for the run to spin
// up before pauseRunning() takes effect. Shared by every resume-from-persist path.
const RESUME_PAUSE_DELAY_MS = 200;

// ── Syntax linter (esprima-based) ────────────────────────────────────────────

// Parse user code the way the runtime runs it: injected inside an async IIFE,
// so top-level `await` is legal (esprima rejects it in a bare script). Returns
// null on success, or the original script-parse error otherwise.
function _parseRunnable(code) {
  try {
    esprima.parseScript(code, { tolerant: false, range: true, loc: true });
    return null;
  } catch (errScript) {
    try {
      // Mirror app.js's async IIFE wrap so top-level await parses.
      esprima.parseScript('(async()=>{' + code + '\n})()', { tolerant: false });
      return null;
    } catch (_) {
      return errScript;
    }
  }
}

function _jsLinterSource(view) {
  const code = view.state.doc.toString();
  if (!code.trim()) return [];
  const err = _parseRunnable(code);
  if (!err) return [];
  // esprima error has .lineNumber, .column, .description, .index
  const from = err.index ?? 0;
  const to = Math.min(from + 1, view.state.doc.length);
  return [
    {
      from,
      to,
      severity: 'error',
      message: err.description ?? err.message ?? 'Syntax error',
    },
  ];
}

const jsLinterExtension = [lintGutter(), linter(_jsLinterSource, { delay: 400 })];

// ── Error line decoration ─────────────────────────────────────────────────────

const setErrorLineEffect = StateEffect.define();

const errorLineField = StateField.define({
  create: () => Decoration.none,
  update(decos, tr) {
    decos = decos.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setErrorLineEffect)) {
        if (e.value === null) {
          decos = Decoration.none;
        } else {
          const line = tr.state.doc.line(Math.max(1, Math.min(e.value, tr.state.doc.lines)));
          const builder = new RangeSetBuilder();
          builder.add(line.from, line.to, Decoration.mark({ class: 'ar-error-line' }));
          decos = builder.finish();
        }
      }
    }
    return decos;
  },
  provide: (f) => EditorView.decorations.from(f),
});

// Execution Trail decorations + the per-editor glow controller live in
// trace-controller.js (ADR 019); traceLineField below feeds the cm extension list.

// Number of lines the execute() preamble adds before user code (1-based offset).
// Structure: `(async function(){\n` + 9 preamble lines + `\nawait ...\n` = 10.
// (9 = 5 PER_EDITOR_LOCALS windowed consts + 4 run-control sugar lines.)
const PREAMBLE_LINES = 10;

// ── Per-Editor Locals (CONTEXT.md) ───────────────────────────────────────────
// The single source of truth for the windowed per-editor locals. `_setupGlobals`
// creates each on `window[__ar_e{id}_<name>]`; `editorPreamble` aliases each back
// to a `const <name>` inside the user's IIFE. Both sides derive from this one
// table, so the two can't drift (the silent-mismatch bug they used to risk).
// Each entry is [name, make(instance)] → the value stored on the window global.
// Run-control sugar (stop/pause/resume) is NOT here: it has no window-global side
// and never grows, so it stays inline in editorPreamble.
const PER_EDITOR_LOCALS = [
  // ADR 040: global `draw` / getCanvas / getLayer / getDraw deleted. The sole 2D
  // surface is `new Canvas()` (window.Canvas), which owns its window + layer stack.
  [
    'setInterval',
    (i) =>
      (cb, delay, ...args) => {
        const id = i._native.setInterval(cb, delay, ...args);
        i._intervals.set(id, { cb, delay, args });
        return id;
      },
  ],
  [
    'clearInterval',
    (i) => (id) => {
      i._intervals.delete(id);
      i._native.clearInterval(id);
    },
  ],
  [
    'setTimeout',
    (i) =>
      (cb, delay = 0, ...args) => {
        let tid;
        const wrapped = (...a) => {
          i._timeouts.delete(tid);
          cb(...a);
        };
        tid = i._native.setTimeout(wrapped, delay, ...args);
        i._timeouts.set(tid, { cb, delay, createdAt: Date.now(), args });
        return tid;
      },
  ],
  [
    'clearTimeout',
    (i) => (tid) => {
      i._timeouts.delete(tid);
      i._native.clearTimeout(tid);
    },
  ],
  ['console', (i) => _makeEditorConsole(i)],
];

// Per-editor console: routes user console.* to the instance's embedded console
// while preserving native logging and filtering MediaPipe's WASM chatter.
function _makeEditorConsole(self) {
  const _log = console.log.bind(console);
  const _error = console.error.bind(console);
  return {
    log: (...args) => {
      _log(...args);
      const msg = args
        .map((a) => (typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)))
        .join(' ');
      if (!_isMediaPipeLog(msg)) self._appendConsole(msg);
    },
    error: (...args) => {
      _error(...args);
      const msg = args
        .map((a) =>
          a instanceof Error
            ? a.message
            : typeof a === 'object' && a !== null
              ? JSON.stringify(a, null, 2)
              : String(a),
        )
        .join(' ');
      if (!_isMediaPipeLog(msg)) self._appendConsole(`<span class="ar-console-err">${msg}</span>`);
    },
    warn: (...args) => {
      _log(...args);
      const msg = args.map((a) => String(a)).join(' ');
      self._appendConsole(`<span class="ar-console-warn">${msg}</span>`);
    },
    clear: () => self.clearConsole(),
  };
}

// Build the execute() preamble: PER_EDITOR_LOCALS aliased to consts, then the
// inline run-control sugar. Pure (id → string) so it's unit-testable.
// Must stay PREAMBLE_LINES-1 lines (see PREAMBLE_LINES above).
export function editorPreamble(id) {
  const ns = `__ar_e${id}`;
  const windowed = PER_EDITOR_LOCALS.map(([name]) => `const ${name} = window.${ns}_${name};`);
  const control = [
    `const stop        = () => window.__ar_instances?.get(${id})?.stopRunning();`,
    `const stopRunning = stop;`,
    `const pause       = () => window.__ar_instances?.get(${id})?.pauseRunning();`,
    `const resume      = () => window.__ar_instances?.get(${id})?.resumeRunning();`,
  ];
  return [...windowed, ...control].join('\n');
}

const ICONS = {
  play: '<i class="fa-solid fa-play"></i>',
  pause: '<i class="fa-solid fa-pause"></i>',
  reset: '<i class="fa-solid fa-rotate-left"></i>',
};

export class EditorInstance {
  constructor(id, { nativeTimers, wm, toolkitWinId, defaultCode = '' }) {
    this.id = id;
    this.title = localStorage.getItem(editorTitleKey(id)) ?? (id === 1 ? 'Editor' : `Editor ${id}`);
    this._native = nativeTimers;
    this._wm = wm;
    this._toolkitWinId = toolkitWinId;
    this._defaultCode = defaultCode;

    this.btnState = 'idle';
    this.currentScript = null;
    this.idleWatcher = null;
    this._everHadContent = false; // set true when editor first has non-empty content
    this._intervals = new Map();
    this._timeouts = new Map();
    this._listeners = [];
    this._keepAlive = new Set();
    this._hadOutput = false;
    // Pause mechanics (freeze/restore tracked timers) live in PauseController
    // (ADR 043); the idle watcher, UI state, and window.__ar_paused stay here.
    // trackedSetters resolves the namespaced setters at resume time so restored
    // timers re-register in this._intervals/_timeouts.
    this._pause = new PauseController({
      intervals: this._intervals,
      timeouts: this._timeouts,
      clearInterval: this._native.clearInterval,
      clearTimeout: this._native.clearTimeout,
      trackedSetters: () => {
        const ns = `__ar_e${this.id}`;
        return { setInterval: window[`${ns}_setInterval`], setTimeout: window[`${ns}_setTimeout`] };
      },
    });

    this._autoExec = localStorage.getItem(editorAutoExecKey(id)) === '1';
    this._autoExecTimer = null;

    // Execution-trail glow — own state machine behind a small interface (ADR 019).
    // getCm is a closure so the controller (built now) can dispatch into cm (built later).
    this._trace = new TraceController({
      native: this._native,
      getCm: () => this.cm,
      enabled: localStorage.getItem(editorTraceKey(id)) !== '0',
    });

    this.editorWinId = `win-editor-${id}`;

    this._buildDOM();
    this._setupGlobals();
    this._buildWindows();
  }

  // ── DOM construction ───────────────────────────────────────────────────────

  _buildDOM() {
    // ADR 040: the editor no longer owns a 2D canvas stack or output window —
    // visual output is `new Canvas()` (spawns its own wm window).

    // Console panel
    this.consoleEl = document.createElement('div');
    this.consoleEl.className = 'ar-console-output';

    const consoleLabelRow = document.createElement('div');
    consoleLabelRow.className = 'ar-console-label';
    const consoleLabelText = document.createElement('span');
    consoleLabelText.textContent = 'Console';

    const consoleBtns = document.createElement('div');
    consoleBtns.className = 'ar-console-btns';

    const consoleHideBtn = document.createElement('button');
    consoleHideBtn.className = 'ar-console-btn';
    consoleHideBtn.title = 'Hide console';
    consoleHideBtn.innerHTML = '<i class="fa-solid fa-chevron-down"></i>';
    consoleHideBtn.addEventListener('click', () => {
      this.consolePanel.style.display = 'none';
      this.consoleToggleBtn.classList.remove('ar-btn-active');
      this.cm.requestMeasure();
      this.inlineWidgets.refresh();
    });

    const consoleClearBtn = document.createElement('button');
    consoleClearBtn.className = 'ar-console-btn';
    consoleClearBtn.title = 'Clear console';
    consoleClearBtn.innerHTML = '<i class="fa-solid fa-eraser"></i>';
    consoleClearBtn.addEventListener('click', () => this.clearConsole());

    const consolePopBtn = document.createElement('button');
    consolePopBtn.className = 'ar-console-btn';
    consolePopBtn.title = 'Pop out to window';
    consolePopBtn.innerHTML = '<i class="fa-solid fa-arrow-up-right-from-square"></i>';
    consolePopBtn.addEventListener('click', () => this._popoutConsole());

    const traceToggleBtn = document.createElement('button');
    traceToggleBtn.className = 'ar-console-btn' + (this._trace.enabled ? ' ar-btn-active' : '');
    traceToggleBtn.title = 'Toggle execution trail';
    traceToggleBtn.innerHTML = '<i class="fa-solid fa-route"></i>';
    traceToggleBtn.addEventListener('click', () => {
      this._trace.enabled = !this._trace.enabled;
      localStorage.setItem(editorTraceKey(this.id), this._trace.enabled ? '1' : '0');
      traceToggleBtn.classList.toggle('ar-btn-active', this._trace.enabled);
    });
    this._traceToggleBtn = traceToggleBtn;

    consoleBtns.appendChild(traceToggleBtn);
    consoleBtns.appendChild(consoleHideBtn);
    consoleBtns.appendChild(consoleClearBtn);
    consoleBtns.appendChild(consolePopBtn);
    consoleLabelRow.appendChild(consoleLabelText);
    consoleLabelRow.appendChild(consoleBtns);

    this.consolePanel = document.createElement('div');
    this.consolePanel.className = 'ar-console-panel';
    this.consolePanel.style.display = 'none';
    this.consolePanel.appendChild(consoleLabelRow);
    this.consolePanel.appendChild(this.consoleEl);

    // Editor wrap + CodeMirror
    this.editorWrap = document.createElement('div');
    this.editorWrap.className = 'ar-editor-wrap';
    const editorDiv = document.createElement('div');
    editorDiv.style.cssText = 'flex:1;min-height:0;';
    this.editorWrap.appendChild(editorDiv);

    // Toolbar
    const toolbar = this._buildToolbar();

    // Editor column
    this.editorColumn = document.createElement('div');
    this.editorColumn.className = 'ar-editor-column';
    this.editorColumn.appendChild(toolbar);
    this.editorColumn.appendChild(this.editorWrap);
    this.editorColumn.appendChild(this.consolePanel);

    // CodeMirror init
    const storageKey = editorCodeKey(this.id);
    // Migrate legacy key for editor 1
    if (
      this.id === 1 &&
      !localStorage.getItem(storageKey) &&
      localStorage.getItem(LEGACY_EDITOR_CODE)
    ) {
      localStorage.setItem(storageKey, localStorage.getItem(LEGACY_EDITOR_CODE));
    }
    const initialCode = localStorage.getItem(storageKey) ?? this._defaultCode;
    if (initialCode.trim().length > 0) this._everHadContent = true;

    let saveTimer;
    let _openSearch = null;

    this.cm = new EditorView({
      state: EditorState.create({
        doc: initialCode,
        extensions: [
          history({ minDepth: 50, newGroupDelay: 500 }),
          javascript(),
          javascriptLanguage.data.of({ autocomplete: windowMemberCompletionSource }),
          javascriptLanguage.data.of({ autocomplete: eventCompletionSource }),
          syntaxHighlighting(defaultHighlightStyle),
          lineNumbers(),
          highlightActiveLine(),
          bracketMatching(),
          closeBrackets(),
          foldGutter(),
          codeFolding(),
          drawSelection(),
          dropCursor(),
          indentOnInput(),
          autocompletion({ defaultKeymap: false }),
          highlightSelectionMatches(),
          searchMarksField,
          errorLineField,
          traceLineField,
          jsLinterExtension,
          inlineWidgetsExtension(),
          paramHintsExtension(),
          shaderSignalPickerExtension(),
          EditorView.lineWrapping,
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            emit('editor:change', { code: update.state.doc.toString() });
            clearTimeout(saveTimer);
            saveTimer = this._native.setTimeout(() => {
              const savedCode = this.cm.state.doc.toString();
              localStorage.setItem(storageKey, savedCode);
              emit('editor:save', { code: savedCode });
            }, 500);
            if (!this._everHadContent && this.cm.state.doc.toString().trim().length > 0)
              this._everHadContent = true;
            if (this._autoExec) {
              this._native.clearTimeout(this._autoExecTimer);
              this._autoExecTimer = this._native.setTimeout(() => {
                const code = this.cm.state.doc.toString();
                // Only auto-run if code parses cleanly (async-IIFE aware)
                if (_parseRunnable(code)) return;
                this.execute({ soft: true });
              }, 1000);
            }
          }),
          keymap.of([
            ...defaultKeymap,
            ...historyKeymap,
            ...closeBracketsKeymap,
            ...completionKeymap,
            ...foldKeymap,
            indentWithTab,
            { key: 'Ctrl-q', run: foldCode },
            {
              key: 'Mod-f',
              run: () => {
                _openSearch?.();
                return true;
              },
              preventDefault: true,
            },
          ]),
        ],
      }),
      parent: editorDiv,
    });

    this.inlineWidgets = initInlineWidgets(this.cm);
    this.search = initSearch(this.cm, this.editorWrap);
    _openSearch = this.search.open;

    // Drag-drop from toolkit into CM (text mode)
    this.cm.dom.addEventListener('dragover', (e) => {
      if (e.dataTransfer.types.includes('application/x-ar-toolkit')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }
    });
    this.cm.dom.addEventListener('drop', (e) => {
      const code = e.dataTransfer.getData('application/x-ar-toolkit');
      if (!code) return;
      e.preventDefault();
      e.stopPropagation();
      const offset =
        this.cm.posAtCoords({ x: e.clientX, y: e.clientY }) ?? this.cm.state.doc.length;
      const insertText = code + '\n';
      this.cm.focus();
      this.cm.dispatch({
        changes: { from: offset, to: offset, insert: insertText },
        selection: { anchor: offset + insertText.length },
      });
    });
  }

  _buildToolbar() {
    const bar = document.createElement('div');
    bar.className = 'ar-editor-toolbar';

    // Execute button
    this.executeBtn = document.createElement('button');
    this.executeBtn.className = 'ar-btn ar-btn-green';
    this.executeBtn.title = 'Run';
    this.executeBtn.innerHTML = ICONS.play;
    this.executeBtn.addEventListener('click', () => {
      if (this.btnState === 'idle') this.execute();
      else if (this.btnState === 'running') this.pauseRunning();
      else if (this.btnState === 'paused') this.resumeRunning();
      else this.reset();
    });

    // Stop button
    this.stopBtn = document.createElement('button');
    this.stopBtn.className = 'ar-btn ar-btn-red';
    this.stopBtn.title = 'Stop';
    this.stopBtn.innerHTML = '<i class="fa-solid fa-stop"></i>';
    this.stopBtn.style.display = 'none';
    this.stopBtn.addEventListener('click', () => {
      if (this.btnState === 'running' || this.btnState === 'paused') this.stopRunning();
    });

    // Console toggle
    this.consoleToggleBtn = document.createElement('button');
    this.consoleToggleBtn.className = 'ar-btn';
    this.consoleToggleBtn.title = 'Toggle Console';
    this.consoleToggleBtn.innerHTML = '<i class="fa-solid fa-terminal"></i>';
    this.consoleToggleBtn.addEventListener('click', () => {
      const open = this.consolePanel.style.display === 'flex';
      this.consolePanel.style.display = open ? 'none' : 'flex';
      this.consoleToggleBtn.classList.toggle('ar-btn-active', !open);
      this.cm.requestMeasure();
      this.inlineWidgets.refresh();
    });

    // Inlay hints toggle
    const inlayBtn = document.createElement('button');
    inlayBtn.className = 'ar-btn';
    inlayBtn.title = 'Toggle inline parameter names';
    inlayBtn.innerHTML = '<i class="fa-solid fa-tag"></i>';
    inlayBtn.addEventListener('click', () => {
      const enabled = this.cm.state.field(inlayHintsEnabledField, false);
      this.cm.dispatch({ effects: toggleInlayHintsEffect.of(!enabled) });
      inlayBtn.classList.toggle('ar-btn-active', !enabled);
    });

    // Auto-execute toggle
    this._autoExecBtn = document.createElement('button');
    this._autoExecBtn.className = 'ar-btn' + (this._autoExec ? ' ar-btn-active' : '');
    this._autoExecBtn.title = 'Auto-run on edit (debounced)';
    this._autoExecBtn.innerHTML = '<i class="fa-solid fa-bolt"></i>';
    this._autoExecBtn.addEventListener('click', () => {
      this._autoExec = !this._autoExec;
      this._autoExecBtn.classList.toggle('ar-btn-active', this._autoExec);
      localStorage.setItem(editorAutoExecKey(this.id), this._autoExec ? '1' : '0');
    });

    bar.appendChild(this.consoleToggleBtn);
    bar.appendChild(inlayBtn);
    this.executeBtn.style.marginLeft = 'auto';
    bar.appendChild(this.executeBtn);
    bar.appendChild(this.stopBtn);
    bar.appendChild(this._autoExecBtn);
    return bar;
  }

  // ── Window manager integration ─────────────────────────────────────────────

  _buildWindows() {
    // Editor window — reasonable default size for code sketching
    const desk = document.getElementById('desktop');
    const dw = desk?.offsetWidth ?? 1280,
      dh = desk?.offsetHeight ?? 720;
    const ew = Math.round(Math.min(660, dw * 0.5));
    const eh = Math.round(Math.min(560, dh * 0.8));
    this._wm.spawn(this.title, { id: this.editorWinId, type: 'html', html: '', w: ew, h: eh });
    const editorWin = document.getElementById(this.editorWinId);
    const editorBody = editorWin.querySelector('.wm-body');
    editorBody.style.overflow = 'hidden';
    editorBody.appendChild(this.editorColumn);
    editorWin.querySelector('.wm-dup')?.addEventListener('click', (e) => {
      e.stopPropagation();
      duplicateEditor(this.id);
    });

    // Editor windows carry no audio controls — sketch audio routes through the
    // mixer/master, not a per-editor strip.
    editorWin.querySelector('.wm-audio-ctrl')?.remove();
    // Auto-create a live-linked desktop icon for this editor
    addEditorIcon(this.id, this.editorWinId, this.title);

    // Close = hide (code preserved, icon re-opens it).
    // Exception: brand-new editor with no content → destroy so icon is removed.
    editorWin._wmOnClose = () => {
      if (this.btnState === 'running' || this.btnState === 'paused') {
        this.reset();
        this._setIdle();
      }
      const hasContent = this._everHadContent || this.cm.state.doc.toString().trim().length > 0;
      if (!hasContent && this.id !== 1) {
        // Never had content and not the primary editor → clean up completely
        this.destroy();
        return;
      }
      editorWin.style.display = 'none';
    };
    editorWin._wmOnTitleChange = (newTitle) => {
      this.title = newTitle;
      try {
        localStorage.setItem(editorTitleKey(this.id), newTitle);
      } catch (_) {}
      const ownTitle = editorWin.querySelector('.wm-title');
      if (ownTitle && ownTitle.textContent !== newTitle) ownTitle.textContent = newTitle;
      updateEditorIconLabel(this.id, newTitle);
    };
    editorWin._wmIsEditor = true;

    new ResizeObserver(() => {
      this.cm.requestMeasure();
      this.inlineWidgets.refresh();
    }).observe(editorWin);
  }

  // ── Globals injected into IIFE ─────────────────────────────────────────────

  _setupGlobals() {
    const ns = `__ar_e${this.id}`;
    for (const [name, make] of PER_EDITOR_LOCALS) {
      window[`${ns}_${name}`] = make(this);
    }
    window[`${ns}_trace`] = (line) => this._trace.record(line);
  }

  // ── Console ────────────────────────────────────────────────────────────────

  _appendConsole(html) {
    this.consoleEl.innerHTML += (this.consoleEl.innerHTML ? '<br>' : '') + html;
    this.consoleEl.scrollTop = this.consoleEl.scrollHeight;
    // Only auto-show inline panel when console isn't popped out to a float window
    const isPopped = !!document.getElementById(`win-console-${this.id}`);
    if (!isPopped && this.consolePanel.style.display !== 'flex') {
      this.consolePanel.style.display = 'flex';
      this.consoleToggleBtn.classList.add('ar-btn-active');
      this.cm.requestMeasure();
      this.inlineWidgets.refresh();
    }
  }

  clearConsole() {
    this.consoleEl.innerHTML = '';
    this.consolePanel.style.display = 'none';
    this.consoleToggleBtn.classList.remove('ar-btn-active');
    this.cm.requestMeasure();
    this.inlineWidgets.refresh();
  }

  _popoutConsole() {
    const floatId = `win-console-${this.id}`;
    // Already popped out — focus it
    if (document.getElementById(floatId)) {
      this._wm.focus(floatId);
      return;
    }

    // Hide inline panel, move consoleEl into float window
    this.consolePanel.style.display = 'none';
    this.consoleToggleBtn.classList.remove('ar-btn-active');

    this._wm.spawn(`${this.title} — Console`, {
      id: floatId,
      type: 'html',
      html: '',
      w: 480,
      h: 240,
    });
    const floatWin = document.getElementById(floatId);
    const body = floatWin.querySelector('.wm-body');
    body.style.cssText += 'padding:0;overflow:hidden;';
    body.appendChild(this.consoleEl);

    // On float close → rescue consoleEl back into inline panel
    floatWin._wmOnClose = () => {
      this.consolePanel.appendChild(this.consoleEl);
      floatWin._wmOnClose = null;
      floatWin.remove();
    };

    this.cm.requestMeasure();
    this.inlineWidgets.refresh();
  }

  // ── Project round-trip (the editor-owned half) ────────────────────────────────
  // The code + authoring mode this editor owns. The window-owned half of an editor
  // record (title / geometry / audio / editorId) is composed by the caller from the
  // DOM window — see project.js / project-manager.js. This is the single source of
  // the editor field-list that those callers used to hand-list in parallel.
  serialize() {
    return {
      code: this.cm.state.doc.toString(),
      mode: 'text',
      executionState: this.btnState,
    };
  }

  // Apply a serialized editor record's code (the inverse of serialize()).
  // Execution-state restore stays with the caller — it needs all windows to exist.
  applyRecord(rec) {
    this.cm.dispatch({
      changes: { from: 0, to: this.cm.state.doc.length, insert: rec.code ?? '' },
    });
  }

  // ── Execution state machine ────────────────────────────────────────────────

  // Resume from a persisted execution state (localStorage autosave / .vljson /
  // embed). 'running' re-runs; 'paused' re-runs then pauses after a short beat
  // so the run has spun up. No-op for falsy/'stopped'/'idle'. Must be called
  // after all windows exist (execute() may need output windows).
  restoreExecutionState(state) {
    if (state !== 'running' && state !== 'paused') return;
    this.execute();
    if (state === 'paused') {
      this._native.setTimeout(() => this.pauseRunning(), RESUME_PAUSE_DELAY_MS);
    }
  }

  _saveExecState(state) {
    try {
      localStorage.setItem(editorExecKey(this.id), state);
    } catch (_) {}
  }

  _setIdle() {
    this.btnState = 'idle';
    this._saveExecState('idle');
    this.executeBtn.innerHTML = ICONS.play;
    this.executeBtn.title = 'Run';
    this.executeBtn.className = 'ar-btn ar-btn-green';
    this.stopBtn.style.display = 'none';
    this._updateTaskbarChip();
  }

  _setRunning() {
    this.btnState = 'running';
    this._saveExecState('running');
    this.executeBtn.innerHTML = ICONS.pause;
    this.executeBtn.title = 'Pause';
    this.executeBtn.className = 'ar-btn ar-btn-orange';
    this.stopBtn.style.display = '';
    this._updateTaskbarChip();
  }

  _setPaused() {
    this.btnState = 'paused';
    this._saveExecState('paused');
    this.executeBtn.innerHTML = ICONS.play;
    this.executeBtn.title = 'Resume';
    this.executeBtn.className = 'ar-btn ar-btn-green';
    this.stopBtn.style.display = '';
    this._updateTaskbarChip();
  }

  _onError(e) {
    emit('session:error', { error: e?.message ?? String(e), line: extractScriptLine(e) });
    this._setStopped();
    const scriptLine = extractScriptLine(e);
    if (scriptLine !== null) {
      const userLine = scriptLine - PREAMBLE_LINES;
      if (userLine >= 1 && userLine <= this.cm.state.doc.lines) {
        this.cm.dispatch({
          effects: setErrorLineEffect.of(userLine),
          selection: { anchor: this.cm.state.doc.line(userLine).from },
        });
        this.cm.dispatch({
          effects: EditorView.scrollIntoView(this.cm.state.doc.line(userLine).from, {
            y: 'center',
          }),
        });
      }
    }
  }

  _setStopped() {
    this._trace.clear(); // every stop path converges here (manual stop, error, idle auto-stop) — kill stale execution-trail glow
    if (this.idleWatcher) {
      this._native.clearInterval(this.idleWatcher);
      this.idleWatcher = null;
    }
    const isPopped = !!document.getElementById(`win-console-${this.id}`);
    if (!isPopped) {
      this.consolePanel.style.display = 'none';
      this.consoleToggleBtn.classList.remove('ar-btn-active');
    }
    this._setIdle();
    if (!isPopped) {
      this.cm.requestMeasure();
      this.inlineWidgets.refresh();
    }
  }

  _updateTaskbarChip() {
    const chip = document.querySelector(`.wm-taskbar-chip[data-win-id="${this.editorWinId}"]`);
    if (!chip) return;
    const dot = chip.querySelector('.wm-chip-dot');
    if (!dot) return;
    const colors = { idle: '#888', running: '#4caf50', paused: '#ff9800' };
    dot.style.background = colors[this.btnState] ?? '#888';
  }

  _isLive() {
    if (this._keepAlive.size > 0) {
      this._hadOutput = true;
      return true;
    }
    if (this._hadOutput) return false;
    return this._intervals.size > 0 || this._listeners.length > 0;
  }

  _checkLiveOrStop() {
    // Not-live means every output is gone (e.g. the user closed the Canvas/output
    // window). Any timers/audio/RAF still running are "orphaned drivers" — do a
    // REAL teardown (stopRunning), not a cosmetic _setStopped, so they're cleared.
    if (this.btnState === 'running' && !this._isLive()) this.stopRunning();
  }

  _startIdleWatcher() {
    this.idleWatcher = this._native.setInterval(() => {
      if (this.btnState !== 'running') {
        this._native.clearInterval(this.idleWatcher);
        this.idleWatcher = null;
        return;
      }
      if (!this._isLive()) this.stopRunning(); // tear down orphaned drivers, not just the UI
    }, 300);
  }

  // The "kill every tracked driver" sequence shared by stopRunning() and reset():
  // clear tracked timers, drop their maps, remove run-scoped listeners, run every
  // subsystem's onReset cleanup, and drop any frozen-pause state. One method so the two
  // stop paths can't drift (a resource added to one but forgotten in the other). `soft`
  // is forwarded to runResetHandlers (soft → Canvas windows survive; ADR 040).
  _teardownDrivers(soft) {
    for (const id of this._intervals.keys()) this._native.clearInterval(id);
    for (const id of this._timeouts.keys()) this._native.clearTimeout(id);
    this._intervals.clear();
    this._timeouts.clear();
    this._listeners.forEach(({ target, type, handler, options }) =>
      target?.removeEventListener(type, handler, options),
    );
    this._listeners = [];
    runResetHandlers(this.id, soft);
    this._pause.clear();
  }

  stopRunning() {
    emit('session:stop', {});
    clearRunScoped();
    this._teardownDrivers(false); // hard stop — tear everything down (Canvas windows too)
    this._setStopped(); // _setStopped() clears the execution trail
  }

  pauseRunning() {
    if (this.idleWatcher) {
      this._native.clearInterval(this.idleWatcher);
      this.idleWatcher = null;
    }
    this._pause.pause();
    setPaused(true);
    this._setPaused();
  }

  resumeRunning() {
    setPaused(false);
    this._pause.resume();
    this._setRunning();
    this._startIdleWatcher();
  }

  // soft=true: preserve _keepAlive + _hadOutput so output window stays alive during auto-exec re-run.
  reset({ soft = false } = {}) {
    if (this.btnState === 'running' || this.btnState === 'paused') emit('session:stop', {});
    _endRun(); // restore any registerAPI() overrides made during this run
    this.cm.dispatch({ effects: setErrorLineEffect.of(null) });
    this._trace.clear();
    setPaused(false);
    setUsesAudio(undefined);
    // Shared driver teardown (onReset cleanups scoped to this editor, ADR 008).
    this._teardownDrivers(soft);
    if (!soft) {
      this._keepAlive = new Set();
      this._hadOutput = false;
      window.__ar_keepAlive = this._keepAlive;
    }
    if (this.currentScript) {
      document.body.removeChild(this.currentScript);
      this.currentScript = null;
    }
    if (this.idleWatcher) {
      this._native.clearInterval(this.idleWatcher);
    }
    this.idleWatcher = null;
    this._setIdle();
  }

  execute({ soft = false } = {}) {
    const raw = this.cm.state.doc.toString();

    // Gather this instance's inputs + callbacks; the run sequence lives in run.js so
    // it can be exercised with a fake injector (no CodeMirror/DOM). See run.js.
    startRun({
      raw,
      id: this.id,
      traceEnabled: this._trace.enabled,
      soft,
      preamble: editorPreamble(this.id),
      deps: {
        clearAutoExec: () => {
          this._native.clearTimeout(this._autoExecTimer);
          this._autoExecTimer = null;
        },
        reset: (s) => this.reset({ soft: s }),
        ensureAudioChip: () => this._wm.ensureAudioChip?.(), // master audio control (ADR 040)
        prepareKeepAlive: (s) => {
          if (!s) {
            this._keepAlive = new Set();
            this._hadOutput = false;
          }
          return this._keepAlive;
        },
        clearConsole: () => {
          this.consoleEl.innerHTML = '';
        },
        setRunning: () => this._setRunning(),
        startIdleWatcher: () => this._startIdleWatcher(),
        onScript: (script) => {
          this.currentScript = script;
        },
      },
    });
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  destroy() {
    if (this.btnState === 'running' || this.btnState === 'paused') this.stopRunning();
    removeEditorIcon(this.id);

    EditorInstance.removeFromManifest(this.id);
    try {
      localStorage.removeItem(editorCodeKey(this.id));
    } catch (_) {}
    try {
      localStorage.removeItem(editorExecKey(this.id));
    } catch (_) {}
    try {
      localStorage.removeItem(editorTitleKey(this.id));
    } catch (_) {}
    try {
      localStorage.removeItem(editorAutoExecKey(this.id));
    } catch (_) {}

    const editorWin = document.getElementById(this.editorWinId);
    if (editorWin) {
      editorWin._wmOnClose = null;
      editorWin.remove();
    }
    this._wm.saveState(); // flush WM state now so orphaned window IDs don't respawn on reload

    const ns = `__ar_e${this.id}`;
    for (const key of Object.keys(window).filter((k) => k.startsWith(ns + '_'))) {
      delete window[key];
    }
    window.__ar_instances?.delete(this.id);
  }

  // ── Manifest persistence ───────────────────────────────────────────────────

  static loadManifest() {
    try {
      const s = localStorage.getItem(EDITOR_MANIFEST);
      if (s) return JSON.parse(s);
    } catch (_) {}
    return [];
  }

  static saveManifest(ids) {
    localStorage.setItem(EDITOR_MANIFEST, JSON.stringify(ids));
  }

  static removeFromManifest(id) {
    EditorInstance.saveManifest(EditorInstance.loadManifest().filter((i) => i !== id));
  }
}

function _isMediaPipeLog(s) {
  return /^[IW]\d{4}|Graph successfully|TensorFlow Lite|gl_context|inference_feedback|gesture_recognizer_graph|face_landmarker_graph|landmark_projection|hand_gesture|Custom gesture/.test(
    s,
  );
}
