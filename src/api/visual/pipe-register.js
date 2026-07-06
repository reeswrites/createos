// pipe.register — user-extensible named pipeline stages, plus the Blockly-block
// code generation that backs them. Extracted from render-pipeline.js (its rendering
// core owns Stages + the Pipeline driver; this owns the authoring-surface codegen,
// a separate concern). installPipeRegister() is called once at module load with the
// pieces it needs, avoiding a circular import back into render-pipeline.
//
// Registering a named stage makes it:
//   • A chainable method on all Pipeline instances: pipe(cam).myStage(opts)
//   • A draggable toolkit entry in the text editor sidebar
//   • A Blockly block (auto-generated from descriptor.fields) draggable in blocks mode
//
// descriptor:
//   label   — display name (default: name)
//   hint    — tooltip text
//   colour  — Blockly block hue (default: 80)
//   fields  — array of field descriptors for auto-block generation:
//             { name, label?, type: 'number'|'color'|'text'|'boolean', default }
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

function _pipeBlockFieldDef(f) {
  if (f.type === 'number') return { type: 'field_number', name: f.name, value: f.default ?? 0 };
  if (f.type === 'color' || f.type === 'colour')
    return { type: 'field_colour', name: f.name, colour: f.default ?? '#ffffff' };
  if (f.type === 'boolean')
    return { type: 'field_checkbox', name: f.name, checked: f.default ?? false };
  return { type: 'field_input', name: f.name, text: String(f.default ?? '') };
}

function _generatePipeBlock(name, label, colour, fields) {
  // Args: %1=camera index, %2..%N+1=user fields, %N+2=title, %N+3=W, %N+4=H
  const fieldMsgs = fields.map((f, i) => `${f.label ?? f.name} %${i + 2}`).join(' ');
  const ti = fields.length + 2; // title arg index
  const sep = fieldMsgs ? ' ' + fieldMsgs : '';
  const definition = {
    type: `pipe_custom_${name}`,
    message0: `pipe camera %1 → ${label}${sep} → window %${ti} %${ti + 1} × %${ti + 2}`,
    args0: [
      { type: 'field_number', name: 'INDEX', value: 0, min: 0, precision: 1 },
      ...fields.map(_pipeBlockFieldDef),
      { type: 'field_input', name: 'TITLE', text: label },
      { type: 'field_number', name: 'W', value: 700, min: 100 },
      { type: 'field_number', name: 'H', value: 500, min: 100 },
    ],
    previousStatement: null,
    nextStatement: null,
    colour,
    tooltip: `${label} pipeline stage`,
  };

  const generator = (b) => {
    const idx = b.getFieldValue('INDEX');
    const opts = {};
    for (const f of fields) {
      const v = b.getFieldValue(f.name);
      opts[f.name] = f.type === 'number' ? Number(v) : v;
    }
    const title = JSON.stringify(b.getFieldValue('TITLE'));
    const w = b.getFieldValue('W');
    const h = b.getFieldValue('H');
    return (
      `const _cam${idx} = await Camera.open({ index: ${idx} });\n` +
      `pipe(_cam${idx}).${name}(${JSON.stringify(opts)}).show(${title}, { w: ${w}, h: ${h} });\n`
    );
  };

  return { definition, generator };
}

/**
 * Install `pipe.register` on the pipe factory. Called once by render-pipeline.js.
 * @param {{ pipe: Function, Pipeline: Function, CustomStage: Function }} deps
 */
export function installPipeRegister({ pipe, Pipeline, CustomStage }) {
  pipe.register = function (name, factory, descriptor = {}) {
    const label = descriptor.label ?? name;
    const hint = descriptor.hint ?? `pipe().${name}() — custom pipeline stage`;
    const colour = descriptor.colour ?? 80;
    const fields = descriptor.fields ?? [];
    const blockType = `pipe_custom_${name}`;

    // 1. Add stage method to all Pipeline instances (persists across resets)
    Pipeline.prototype[name] = function (opts = {}) {
      this._stages.push(new CustomStage(this._last(), (src) => factory(src, opts)));
      return this;
    };

    // 2. Build toolkit snippet
    const optsStr = fields.length
      ? `{ ${fields.map((f) => `${f.name}: ${JSON.stringify(f.default ?? '')}`).join(', ')} }`
      : '';
    const code =
      descriptor.code ??
      `const cam = await Camera.open();\npipe(cam)\n  .${name}(${optsStr})\n  .show('${label}', { w: 700, h: 500 });`;
    const cmd = {
      label,
      code,
      hint,
      blockType, // enables drag-into-blocks-mode from text toolkit
      tags: ['pipe', name, 'pipeline', 'custom'],
    };

    // 3. Live toolkit panel insertion (updates any currently-open toolkit windows)
    if (window.__ar_addToolkitEntry) {
      window.__ar_addToolkitEntry('Pipeline', cmd);
    }

    // 4. Blockly block + generator (registered even when no fields — allows blockType drag)
    const blockDef = _generatePipeBlock(name, label, colour, fields);

    // 5. Register block via API registry; skip toolkit if already injected live above
    window.registerAPI?.(`_pipe_${name}`, null, {
      category: 'Pipeline',
      toolkit: window.__ar_addToolkitEntry ? [] : [cmd], // avoid double-add
      blocks: [blockDef],
    });
  };
}
