// storage-keys.js — the one registry of localStorage / IndexedDB key names.
// Leaf module, no imports.
//
// Values are FROZEN. Renaming any of these orphans a returning user's saved state,
// so this module concentrates the literals WITHOUT changing them — the historic
// vl- / vl_ split is preserved on purpose (settling it needs a migration, not a
// rename). Before this the ~15 keys were string literals scattered across ~10 files,
// two files both named their local const STORAGE_KEY with different values, and the
// vl-ide-* editor family mixed named prefixes with inline template literals.
//
// Per-editor keys are functions of the editor id; singleton keys are constants.

// ── Editor persistence: the vl-ide-* family ─────────────────────────────────────
export const EDITOR_MANIFEST = 'vl-ide-editors'; // ordered list of active editor ids
export const LEGACY_EDITOR_CODE = 'vl-ide-code'; // pre-multi-editor single-code key
export const editorCodeKey = (id) => `vl-ide-code-${id}`;
export const editorExecKey = (id) => `vl-ide-exec-${id}`;
export const editorTitleKey = (id) => `vl-ide-title-${id}`;
export const editorAutoExecKey = (id) => `vl-autoexec-${id}`;
export const editorTraceKey = (id) => `vl-trace-${id}`;
export const editorBlocksOpenKey = (id) => `vl-blocks-open-${id}`;

// ── Subsystem singletons ────────────────────────────────────────────────────────
export const WM_STATE = 'vl-wm-state';
export const DESKTOP_STATE = 'vl-desktop-state';
export const ACTIVE_PROJECT = 'vl-active-project';
export const ACTIVE_PROJECT_NAME = 'vl-active-project-name';
export const PROJECTS_DB = 'vl-projects'; // IndexedDB database name
export const MIXER = 'vl_mixer';
export const LIBRARY = 'vl_library';
export const VOICES = 'vl_voices';
export const GAZE_CALIB = 'vl_gaze_calib';
export const TUTORIAL_LESSON = 'vl_tutorial_lesson';
