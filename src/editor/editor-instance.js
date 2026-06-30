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
import {
  transformCode,
  makeLoopProtectionVisitor,
  makeTraceVisitor,
  friendlyError,
  extractScriptLine,
} from './live-patch.js';
import { detectAPIUsage } from './api-detector.js';
import { _beginRun, _endRun } from '../runtime/api-registry.js';
import {
  initInlineWidgets,
  inlineWidgetsExtension,
  toggleInlayHintsEffect,
  inlayHintsEnabledField,
} from './inline-widgets.js';
import { searchMarksField, initSearch } from './cm-search.js';
import { paramHintsExtension } from './param-hints.js';
import { windowMemberCompletionSource } from './completions.js';
import { shaderSignalPickerExtension } from './shader-signal-picker.js';
import { startAudio } from '../api/audio.js';
import {
  addEditorIcon,
  removeEditorIcon,
  updateEditorIconLabel,
  duplicateEditor,
} from '../api/desktop-files.js';
// Per-subsystem cleanups are no longer imported here — each module self-registers
// via onReset() and runResetHandlers() runs them all on reset (ADR 008).
import { runResetHandlers } from '../runtime/reset-registry.js';
import { emit, clearRunScoped } from '../events/index.js';
import { eventCompletionSource } from './event-completion.js';
import { PauseController } from '../runtime/pause-controller.js';
import {
  initBlockly,
  getWorkspaceCode,
  resizeBlockly,
  workspaceIsEmpty,
  loadWorkspaceJSON,
  registerSidebarDeleteZone,
} from '../blocks/blocks.js';
import { jsToBlocks } from '../blocks/js-to-blocks.js';

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

// ── Execution Trail decorations ───────────────────────────────────────────────
// Mirrors errorLineField pattern. Lines arrive as Set<number> via setTraceLinesEffect.
const setTraceLinesEffect = StateEffect.define();

const traceLineField = StateField.define({
  create: () => Decoration.none,
  update(decos, tr) {
    decos = decos.map(tr.changes);
    for (const e of tr.effects) {
      if (!e.is(setTraceLinesEffect)) continue;
      if (e.value === null) {
        decos = Decoration.none;
        continue;
      }
      const builder = new RangeSetBuilder();
      const lines = [...e.value].sort((a, b) => a - b);
      for (const ln of lines) {
        if (ln < 1 || ln > tr.state.doc.lines) continue;
        const line = tr.state.doc.line(ln);
        builder.add(line.from, line.to, Decoration.mark({ class: 'ar-trace-line' }));
      }
      decos = builder.finish();
    }
    return decos;
  },
  provide: (f) => EditorView.decorations.from(f),
});

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

const STORAGE_PREFIX = 'vl-ide-code-';
const EXEC_STATE_PREFIX = 'vl-ide-exec-';
const TITLE_PREFIX = 'vl-ide-title-';
const LEGACY_KEY = 'vl-ide-code';

const ICONS = {
  play: '<i class="fa-solid fa-play"></i>',
  pause: '<i class="fa-solid fa-pause"></i>',
  reset: '<i class="fa-solid fa-rotate-left"></i>',
};

// Which editor instance receives palette clicks (set when editor opens blocks mode)
export let activeBlocksEditor = null;

export class EditorInstance {
  constructor(id, { nativeTimers, wm, toolkitWinId, defaultCode = '' }) {
    this.id = id;
    this.title = localStorage.getItem(TITLE_PREFIX + id) ?? (id === 1 ? 'Editor' : `Editor ${id}`);
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

    this.blocklyWorkspace = null;
    this.blocksMode = false;

    this._autoExec = localStorage.getItem(`vl-autoexec-${id}`) === '1';
    this._autoExecTimer = null;

    this._traceEnabled = localStorage.getItem(`vl-trace-${id}`) !== '0';
    this._traceDirty = new Set();
    this._traceActive = new Map(); // line → removal-timer id
    this._traceRAF = null;

    this.editorWinId = `win-editor-${id}`;

    this._buildDOM();
    this._setupGlobals();
    this._buildWindows();

    // Restore blocks mode pref — wait for FA font so icon widths are correct
    const _faReady = document.fonts.load('900 13px "Font Awesome 6 Free"').catch(() => {});
    if (localStorage.getItem(`vl-blocks-open-${id}`) === '1') {
      _faReady.then(() => requestAnimationFrame(() => this._openBlocks()));
    } else {
      _faReady.then(() => requestAnimationFrame(() => this._positionThumb(false)));
    }
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
    traceToggleBtn.className = 'ar-console-btn' + (this._traceEnabled ? ' ar-btn-active' : '');
    traceToggleBtn.title = 'Toggle execution trail';
    traceToggleBtn.innerHTML = '<i class="fa-solid fa-route"></i>';
    traceToggleBtn.addEventListener('click', () => {
      this._traceEnabled = !this._traceEnabled;
      localStorage.setItem(`vl-trace-${this.id}`, this._traceEnabled ? '1' : '0');
      traceToggleBtn.classList.toggle('ar-btn-active', this._traceEnabled);
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

    // Blocks area
    this.blocksArea = document.createElement('div');
    this.blocksArea.className = 'ar-blocks-area';
    this.blocksArea.style.display = 'none';
    this.blocksDiv = document.createElement('div');
    this.blocksDiv.style.flex = '1';
    this.blocksArea.appendChild(this.blocksDiv);

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
    this.editorColumn.appendChild(this.blocksArea);
    this.editorColumn.appendChild(this.consolePanel);

    // CodeMirror init
    const storageKey = STORAGE_PREFIX + this.id;
    // Migrate legacy key for editor 1
    if (this.id === 1 && !localStorage.getItem(storageKey) && localStorage.getItem(LEGACY_KEY)) {
      localStorage.setItem(storageKey, localStorage.getItem(LEGACY_KEY));
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

    // Drag-drop from toolkit into blocks area
    this.blocksArea.addEventListener('dragover', (e) => {
      if (e.dataTransfer.types.includes('application/x-ar-block-type')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }
    });
    this.blocksArea.addEventListener('drop', (e) => {
      const type = e.dataTransfer.getData('application/x-ar-block-type');
      if (!type || !this.blocklyWorkspace) return;
      e.preventDefault();
      e.stopPropagation();
      this._addBlockToWorkspace(type, e.clientX, e.clientY);
    });

    new ResizeObserver(() => {
      if (this.blocklyWorkspace && this.blocksArea.style.display !== 'none')
        resizeBlockly(this.blocklyWorkspace);
    }).observe(this.blocksArea);
  }

  _buildToolbar() {
    const bar = document.createElement('div');
    bar.className = 'ar-editor-toolbar';

    // Mode toggle
    const modeToggle = document.createElement('div');
    modeToggle.className = 'ar-mode-toggle';
    this._modeThumb = document.createElement('div');
    this._modeThumb.className = 'ar-mode-thumb';
    this._textBtn = document.createElement('div');
    this._textBtn.className = 'ar-toggle-opt ar-toggle-active';
    this._textBtn.innerHTML = '<i class="fa-solid fa-code"></i>';
    this._blocksBtn = document.createElement('div');
    this._blocksBtn.className = 'ar-toggle-opt';
    this._blocksBtn.innerHTML = '<i class="fa-solid fa-puzzle-piece"></i>';
    modeToggle.appendChild(this._modeThumb);
    modeToggle.appendChild(this._textBtn);
    modeToggle.appendChild(this._blocksBtn);

    this._textBtn.addEventListener('click', () => {
      if (this.blocksMode) {
        this._closeBlocks();
        localStorage.setItem(`vl-blocks-open-${this.id}`, '0');
      }
    });
    this._blocksBtn.addEventListener('click', () => {
      if (!this.blocksMode) {
        this._openBlocks();
        localStorage.setItem(`vl-blocks-open-${this.id}`, '1');
      }
    });

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
      localStorage.setItem(`vl-autoexec-${this.id}`, this._autoExec ? '1' : '0');
    });

    bar.appendChild(modeToggle);
    bar.appendChild(this.consoleToggleBtn);
    bar.appendChild(inlayBtn);
    this.executeBtn.style.marginLeft = 'auto';
    bar.appendChild(this.executeBtn);
    bar.appendChild(this.stopBtn);
    bar.appendChild(this._autoExecBtn);
    return bar;
  }

  _positionThumb(toBlocks) {
    const opt = toBlocks ? this._blocksBtn : this._textBtn;
    const container = this._modeThumb.parentElement;
    if (!container) return;
    const cr = container.getBoundingClientRect();
    const or = opt.getBoundingClientRect();
    this._modeThumb.style.left = or.left - cr.left + 'px';
    this._modeThumb.style.width = or.width + 'px';
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

    // Replace full audio controls with mute-only button for Blockly sounds
    editorWin.querySelector('.wm-audio-ctrl')?.remove();
    const muteCtrl = document.createElement('span');
    muteCtrl.className = 'wm-audio-ctrl';
    muteCtrl.style.display = 'none';
    const muteBtn = document.createElement('button');
    muteBtn.className = 'wm-mute';
    muteBtn.title = 'Mute blocks sounds';
    muteBtn.innerHTML = '<i class="fa-solid fa-volume-high"></i>';
    let _blocksMuted = false;
    muteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      _blocksMuted = !_blocksMuted;
      muteBtn.innerHTML = _blocksMuted
        ? '<i class="fa-solid fa-volume-xmark"></i>'
        : '<i class="fa-solid fa-volume-high"></i>';
      muteBtn.classList.toggle('muted', _blocksMuted);
      if (this.blocklyWorkspace) this.blocklyWorkspace.getAudioManager().setMuted(_blocksMuted);
    });
    muteCtrl.appendChild(muteBtn);
    this._blocksMuteCtrl = muteCtrl;
    const firstBtn = editorWin.querySelector('.wm-titlebar .wm-btn');
    editorWin.querySelector('.wm-titlebar').insertBefore(muteCtrl, firstBtn);
    // Auto-create a live-linked desktop icon for this editor
    addEditorIcon(this.id, this.editorWinId, this.title);

    // Close = hide (code preserved, icon re-opens it).
    // Exception: brand-new editor with no content → destroy so icon is removed.
    editorWin._wmOnClose = () => {
      if (this.btnState === 'running' || this.btnState === 'paused') {
        this.reset();
        this._setIdle();
      }
      const hasContent =
        this._everHadContent ||
        this.cm.state.doc.toString().trim().length > 0 ||
        (this.blocksMode &&
          this.blocklyWorkspace &&
          this.blocklyWorkspace.getAllBlocks(false).length > 0);
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
        localStorage.setItem(TITLE_PREFIX + this.id, newTitle);
      } catch (_) {}
      const ownTitle = editorWin.querySelector('.wm-title');
      if (ownTitle && ownTitle.textContent !== newTitle) ownTitle.textContent = newTitle;
      updateEditorIconLabel(this.id, newTitle);
    };
    editorWin._wmIsEditor = true;

    new ResizeObserver(() => {
      this.cm.requestMeasure();
      this.inlineWidgets.refresh();
      if (this.blocklyWorkspace && this.blocksArea.style.display !== 'none')
        resizeBlockly(this.blocklyWorkspace);
    }).observe(editorWin);
  }

  // ── Globals injected into IIFE ─────────────────────────────────────────────

  _setupGlobals() {
    const ns = `__ar_e${this.id}`;
    for (const [name, make] of PER_EDITOR_LOCALS) {
      window[`${ns}_${name}`] = make(this);
    }
    window[`${ns}_trace`] = (line) => {
      if (!this._traceEnabled) return;
      this._traceDirty.add(line);
      this._scheduleTraceFlush();
    };
  }

  _scheduleTraceFlush() {
    if (this._traceRAF !== null) return;
    this._traceRAF = requestAnimationFrame(() => this._flushTrace());
  }

  _flushTrace() {
    this._traceRAF = null;
    if (!this._traceDirty.size) return;
    const lines = new Set(this._traceActive.keys());
    for (const line of this._traceDirty) {
      // Cancel existing removal timer so hot lines stay lit
      const existing = this._traceActive.get(line);
      if (existing != null) this._native.clearTimeout(existing);
      const tid = this._native.setTimeout(() => {
        this._traceActive.delete(line);
        if (this.cm) {
          const active = new Set(this._traceActive.keys());
          this.cm.dispatch({ effects: setTraceLinesEffect.of(active) });
        }
      }, 800);
      this._traceActive.set(line, tid);
      lines.add(line);
    }
    this._traceDirty.clear();
    if (this.cm) this.cm.dispatch({ effects: setTraceLinesEffect.of(new Set(lines)) });
  }

  _clearTrace() {
    if (this._traceRAF !== null) {
      cancelAnimationFrame(this._traceRAF);
      this._traceRAF = null;
    }
    for (const tid of this._traceActive.values()) this._native.clearTimeout(tid);
    this._traceActive.clear();
    this._traceDirty.clear();
    if (this.cm) this.cm.dispatch({ effects: setTraceLinesEffect.of(null) });
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

  // ── Blocks ─────────────────────────────────────────────────────────────────

  _addBlockToWorkspace(type, clientX, clientY) {
    if (!this.blocklyWorkspace) return;
    const ws = this.blocklyWorkspace;
    const block = ws.newBlock(type);
    block.initSvg();
    block.render();
    const injectDiv = ws.getInjectionDiv();
    if (clientX != null) {
      const rect = injectDiv.getBoundingClientRect();
      block.moveTo({
        x: (clientX - rect.left - ws.scrollX) / ws.scale,
        y: (clientY - rect.top - ws.scrollY) / ws.scale,
      });
    } else {
      block.moveTo({
        x: (-ws.scrollX + injectDiv.offsetWidth / 2) / ws.scale,
        y: (-ws.scrollY + injectDiv.offsetHeight / 2) / ws.scale,
      });
    }
  }

  _openBlocks() {
    this.blocksMode = true;
    activeBlocksEditor = this;
    window.__ar_active_blocks_editor = this;
    this.editorWrap.style.display = 'none';
    this.blocksArea.style.display = 'flex';
    this._textBtn.classList.remove('ar-toggle-active');
    this._blocksBtn.classList.add('ar-toggle-active');
    this._positionThumb(true);

    if (!this.blocklyWorkspace) {
      this.blocklyWorkspace = initBlockly(this.blocksDiv);
      const toolkitWin = document.getElementById(this._toolkitWinId);
      if (toolkitWin) registerSidebarDeleteZone(this.blocklyWorkspace, toolkitWin);
      this.blocklyWorkspace
        .getAudioManager()
        .setMuted(
          this._blocksMuteCtrl?.querySelector('button')?.classList.contains('muted') ?? false,
        );
    }

    if (this._blocksMuteCtrl) this._blocksMuteCtrl.style.display = '';

    if (workspaceIsEmpty(this.blocklyWorkspace)) {
      try {
        const json = jsToBlocks(this.cm.state.doc.toString());
        if (json) loadWorkspaceJSON(this.blocklyWorkspace, json);
      } catch (e) {
        console.error('[blocks] js→blocks conversion failed:', e);
      }
    }
    resizeBlockly(this.blocklyWorkspace);
  }

  loadBlocksJSON(json) {
    if (!this.blocksMode) this._openBlocks();
    if (this.blocklyWorkspace && json) loadWorkspaceJSON(this.blocklyWorkspace, json);
  }

  _closeBlocks() {
    if (this.blocklyWorkspace) {
      const code = workspaceIsEmpty(this.blocklyWorkspace)
        ? ''
        : getWorkspaceCode(this.blocklyWorkspace);
      this.cm.dispatch({
        changes: { from: 0, to: this.cm.state.doc.length, insert: code },
        selection: { anchor: 0 },
      });
    }
    if (this._blocksMuteCtrl) this._blocksMuteCtrl.style.display = 'none';
    this.blocksMode = false;
    if (activeBlocksEditor === this) activeBlocksEditor = null;
    if (window.__ar_active_blocks_editor === this) window.__ar_active_blocks_editor = null;
    this.blocksArea.style.display = 'none';
    this.editorWrap.style.display = '';
    this._textBtn.classList.add('ar-toggle-active');
    this._blocksBtn.classList.remove('ar-toggle-active');
    this._positionThumb(false);
    this.cm.requestMeasure();
    this.inlineWidgets.refresh();
  }

  // ── Execution state machine ────────────────────────────────────────────────

  _saveExecState(state) {
    try {
      localStorage.setItem(EXEC_STATE_PREFIX + this.id, state);
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
    this._clearTrace(); // every stop path converges here (manual stop, error, idle auto-stop) — kill stale execution-trail glow
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

  stopRunning() {
    emit('session:stop', {});
    clearRunScoped();
    for (const id of this._intervals.keys()) this._native.clearInterval(id);
    for (const id of this._timeouts.keys()) this._native.clearTimeout(id);
    this._intervals.clear();
    this._timeouts.clear();
    this._listeners.forEach(({ target, type, handler, options }) =>
      target?.removeEventListener(type, handler, options),
    );
    this._listeners = [];
    runResetHandlers(this.id, false); // hard reset/stop — tear everything down (Canvas windows too)
    this._pause.clear();
    this._setStopped(); // _setStopped() clears the execution trail
  }

  pauseRunning() {
    if (this.idleWatcher) {
      this._native.clearInterval(this.idleWatcher);
      this.idleWatcher = null;
    }
    this._pause.pause();
    window.__ar_paused = true;
    this._setPaused();
  }

  resumeRunning() {
    window.__ar_paused = false;
    this._pause.resume();
    this._setRunning();
    this._startIdleWatcher();
  }

  // soft=true: preserve _keepAlive + _hadOutput so output window stays alive during auto-exec re-run.
  reset({ soft = false } = {}) {
    if (this.btnState === 'running' || this.btnState === 'paused') emit('session:stop', {});
    _endRun(); // restore any registerAPI() overrides made during this run
    this.cm.dispatch({ effects: setErrorLineEffect.of(null) });
    this._clearTrace();
    window.__ar_paused = false;
    window.__ar_usesAudio = undefined;
    this._pause.clear();
    this._listeners.forEach(({ target, type, handler, options }) =>
      target?.removeEventListener(type, handler, options),
    );
    this._listeners = [];
    for (const id of this._intervals.keys()) this._native.clearInterval(id);
    for (const id of this._timeouts.keys()) this._native.clearTimeout(id);
    this._intervals.clear();
    this._timeouts.clear();
    runResetHandlers(this.id, soft); // every subsystem's cleanup, registered via onReset (ADR 008) — scoped to this editor; soft → Canvas windows survive
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
    const blocksActive =
      this.blocksMode && this.blocklyWorkspace && !workspaceIsEmpty(this.blocklyWorkspace);
    const raw = blocksActive
      ? getWorkspaceCode(this.blocklyWorkspace)
      : this.cm.state.doc.toString();

    // Camera/mic are demand-driven (ADR 023): consumers acquire leases when called,
    // so no pre-run regex checks needed.
    this._native.clearTimeout(this._autoExecTimer);
    this._autoExecTimer = null;

    this.reset({ soft });
    _beginRun(); // snapshot API registry so run-scoped registerAPI() calls are reverted on reset

    // Smart output detection: analyse user code before executing so we only start
    // audio when it's needed. ADR 040: there is no auto-opened output window —
    // visual output comes from `new Canvas()` / `.show()`, which spawn their own.
    const _apiHints = detectAPIUsage(raw);

    window.__ar_usesAudio = _apiHints.usesAudio;
    window.__ar_audioReady = _apiHints.usesAudio ? startAudio() : Promise.resolve();
    if (_apiHints.usesAudio) this._wm.ensureAudioChip?.(); // master audio control in taskbar (ADR 040)
    if (!soft) {
      this._keepAlive = new Set();
      this._hadOutput = false;
    }
    window.__ar_keepAlive = this._keepAlive;
    this.consoleEl.innerHTML = '';

    // Tag listeners to this editor during synchronous setup
    window.__ar_active_editor_id = this.id;
    emit('session:start', { code: raw });

    let protected_code;
    try {
      const visitors = [makeLoopProtectionVisitor()];
      if (this._traceEnabled) visitors.push(makeTraceVisitor(this.id));
      protected_code = transformCode(raw, visitors);
    } catch (_) {
      protected_code = raw;
    }

    const ns = `__ar_e${this.id}`;
    const preamble = editorPreamble(this.id);

    const code =
      `(async function(){\n${preamble}\nawait window.__ar_audioReady;\n${protected_code}\n})()` +
      `.catch(e => { const msg = window.__ar_friendlyError(e); window.${ns}_console.error('Error: ' + msg); window.__ar_instances?.get(${this.id})?._onError(e); })` +
      `.then(() => { window.__ar_instances?.get(${this.id})?._checkLiveOrStop(); });`;

    window.__ar_friendlyError = friendlyError;

    this._setRunning();
    const script = document.createElement('script');
    try {
      script.appendChild(document.createTextNode(code));
    } catch {
      script.text = code;
    }
    document.body.appendChild(script);
    this.currentScript = script;
    this._startIdleWatcher();
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  destroy() {
    if (this.btnState === 'running' || this.btnState === 'paused') this.stopRunning();
    removeEditorIcon(this.id);

    EditorInstance.removeFromManifest(this.id);
    try {
      localStorage.removeItem(STORAGE_PREFIX + this.id);
    } catch (_) {}
    try {
      localStorage.removeItem(EXEC_STATE_PREFIX + this.id);
    } catch (_) {}
    try {
      localStorage.removeItem(TITLE_PREFIX + this.id);
    } catch (_) {}
    try {
      localStorage.removeItem(`vl-autoexec-${this.id}`);
    } catch (_) {}
    try {
      localStorage.removeItem(`vl-blocks-open-${this.id}`);
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
      const s = localStorage.getItem('vl-ide-editors');
      if (s) return JSON.parse(s);
    } catch (_) {}
    return [];
  }

  static saveManifest(ids) {
    localStorage.setItem('vl-ide-editors', JSON.stringify(ids));
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
