// pipe.register — user-extensible named pipeline stages, plus the toolkit-snippet
// authoring surface that backs them. Extracted from render-pipeline.js (its rendering
// core owns Stages + the Pipeline driver; this owns the authoring-surface concern).
// installPipeRegister() is called once at module load with the pieces it needs,
// avoiding a circular import back into render-pipeline.
//
// Registering a named stage makes it:
//   • A chainable method on all Pipeline instances: pipe(cam).myStage(opts)
//   • A draggable toolkit entry in the text editor sidebar
//
// descriptor:
//   label   — display name (default: name)
//   hint    — tooltip text
//   fields  — array of field descriptors { name, label?, type, default }. Used to
//             synthesise the default snippet opts; also the metadata a future Tier-1
//             micro-widget will consume (ADR 060) — kept even though blocks are gone.
//   code    — custom toolkit snippet (auto-generated if omitted)
//
// The factory receives (srcDrawable, opts) — same as .use() but with opts injected.
// Must return { canvas: HTMLCanvasElement, read() }.
//
// Example:
//   pipe.register('glowAscii', (src, opts = {}) => {
//     const canvas = document.createElement('canvas');
//     canvas.width = 800; canvas.height = 600;
//     const ctx = canvas.getContext('2d');
//     return { canvas, read() { /* draw */ } };
//   }, {
//     label: 'Glow ASCII',
//     hint:  'ASCII art with bloom glow',
//     fields: [
//       { name: 'cols',  label: 'cols',  type: 'number', default: 120 },
//       { name: 'color', label: 'color', type: 'color',  default: '#00ff41' },
//     ],
//   });
//
//   pipe(cam).glowAscii({ cols: 120, color: '#00ff41' }).show('Glow', { w: 700, h: 500 });

/**
 * Install `pipe.register` on the pipe factory. Called once by render-pipeline.js.
 * @param {{ pipe: Function, Pipeline: Function, CustomStage: Function }} deps
 */
export function installPipeRegister({ pipe, Pipeline, CustomStage }) {
  pipe.register = function (name, factory, descriptor = {}) {
    const label = descriptor.label ?? name;
    const hint = descriptor.hint ?? `pipe().${name}() — custom pipeline stage`;
    const fields = descriptor.fields ?? [];

    // 1. Add stage method to all Pipeline instances (persists across resets).
    //    Route through _pushStage (not a bare _stages.push) so a registered stage is
    //    first-class: it gets an _id + _stageName + _stageRegistry entry + stage-added
    //    event, so route()'s toggle/remove and the pipe:stage:set command can target it.
    Pipeline.prototype[name] = function (opts = {}, id) {
      const stage = new CustomStage(this._last(), (src) => factory(src, opts));
      return this._pushStage(stage, name, id);
    };

    // 2. Build toolkit snippet
    const optsStr = fields.length
      ? `{ ${fields.map((f) => `${f.name}: ${JSON.stringify(f.default ?? '')}`).join(', ')} }`
      : '';
    const code =
      descriptor.code ??
      `const cam = await Camera.open();\npipe(cam)\n  .${name}(${optsStr})\n  .show('${label}', { w: 700, h: 500 });`;
    const cmd = { label, code, hint, tags: ['pipe', name, 'pipeline', 'custom'] };

    // 3. Toolkit panel insertion — live hook if a panel is open, else via the registry.
    if (window.__ar_addToolkitEntry) {
      window.__ar_addToolkitEntry('Pipeline', cmd);
    } else {
      window.registerAPI?.(`_pipe_${name}`, null, { category: 'Pipeline', toolkit: [cmd] });
    }
  };
}
