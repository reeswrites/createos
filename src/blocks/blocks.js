import * as Blockly from 'blockly';
import { javascriptGenerator } from 'blockly/javascript';
import 'blockly/blocks';
import './blocks-defs.js'; // side-effect: registers custom block shapes
import './blocks-generators.js'; // side-effect: registers block→JS generators

// Blockly v13 bug: moving a block SVG to the drag layer fires pointercancel,
// which triggers handleUp prematurely and aborts the drop. Filter it out.
{
  const _origHandleUp = Blockly.Gesture.prototype.handleUp;
  Blockly.Gesture.prototype.handleUp = function (e) {
    if (e.type === 'pointercancel' && this.isDragging()) return;
    _origHandleUp.call(this, e);
  };
}

// ── Toolbox ──────────────────────────────────────────────────────────────────

export const TOOLBOX = {
  kind: 'categoryToolbox',
  contents: [
    {
      kind: 'category',
      name: 'Logic',
      colour: '%{BKY_LOGIC_HUE}',
      contents: [
        { kind: 'block', type: 'controls_if' },
        { kind: 'block', type: 'logic_compare' },
        { kind: 'block', type: 'logic_operation' },
        { kind: 'block', type: 'logic_negate' },
        { kind: 'block', type: 'logic_boolean' },
        { kind: 'block', type: 'logic_null' },
      ],
    },
    {
      kind: 'category',
      name: 'Math',
      colour: '%{BKY_MATH_HUE}',
      contents: [
        { kind: 'block', type: 'math_number' },
        { kind: 'block', type: 'math_arithmetic' },
        { kind: 'block', type: 'math_single' },
        { kind: 'block', type: 'math_trig' },
        { kind: 'block', type: 'math_random_float' },
        { kind: 'block', type: 'ctrl_random' },
        { kind: 'block', type: 'ctrl_random_color' },
      ],
    },
    {
      kind: 'category',
      name: 'Text',
      colour: '%{BKY_TEXTS_HUE}',
      contents: [
        { kind: 'block', type: 'text' },
        { kind: 'block', type: 'text_join' },
        { kind: 'block', type: 'text_print' },
      ],
    },
    {
      kind: 'category',
      name: 'Variables',
      colour: '%{BKY_VARIABLES_HUE}',
      custom: 'VARIABLE',
    },
    {
      kind: 'category',
      name: 'Control',
      colour: 120,
      contents: [
        { kind: 'block', type: 'ctrl_interval' },
        { kind: 'block', type: 'ctrl_timeout' },
        { kind: 'block', type: 'ctrl_onkey' },
        { kind: 'block', type: 'ctrl_onkey_char' },
        { kind: 'block', type: 'ctrl_stop' },
        { kind: 'block', type: 'ctrl_pause' },
        { kind: 'block', type: 'ctrl_resume' },
      ],
    },
    {
      kind: 'category',
      name: 'Drumpad',
      colour: 20,
      contents: [
        {
          kind: 'block',
          type: 'drumpad_on_pad',
          inputs: { DP: { block: { type: 'drumpad_open' } } },
        },
        {
          kind: 'block',
          type: 'drumpad_on_hit',
          inputs: { DP: { block: { type: 'drumpad_open' } } },
        },
        {
          kind: 'block',
          type: 'drumpad_on_step',
          inputs: { DP: { block: { type: 'drumpad_open' } } },
        },
        {
          kind: 'block',
          type: 'drumpad_signal',
          inputs: { DP: { block: { type: 'drumpad_open' } } },
        },
        { kind: 'block', type: 'drumpad_open' },
      ],
    },
    {
      kind: 'category',
      name: 'Piano',
      colour: 20,
      contents: [
        {
          kind: 'block',
          type: 'piano_on_note',
          inputs: { PIANO: { block: { type: 'piano_open' } } },
        },
        {
          kind: 'block',
          type: 'piano_on_step',
          inputs: { PIANO: { block: { type: 'piano_open' } } },
        },
        {
          kind: 'block',
          type: 'piano_signal',
          inputs: { PIANO: { block: { type: 'piano_open' } } },
        },
        { kind: 'block', type: 'piano_open' },
      ],
    },
    {
      kind: 'category',
      name: 'Audio',
      colour: 260,
      contents: [
        { kind: 'block', type: 'audio_create_synth' },
        { kind: 'block', type: 'audio_play' },
        { kind: 'block', type: 'audio_bpm' },
        { kind: 'block', type: 'audio_transport_start' },
        { kind: 'block', type: 'mixer_show' },
        { kind: 'block', type: 'mixer_volume' },
        { kind: 'block', type: 'mixer_pan' },
        { kind: 'block', type: 'mixer_mute' },
        { kind: 'block', type: 'audio_reverb' },
        { kind: 'block', type: 'audio_delay' },
        { kind: 'block', type: 'audio_distort' },
        { kind: 'block', type: 'audio_volume' },
        { kind: 'block', type: 'audio_connect' },
        { kind: 'block', type: 'audio_filter' },
        { kind: 'block', type: 'audio_meter' },
        { kind: 'block', type: 'audio_meter_value' },
        { kind: 'block', type: 'audio_chain' },
        { kind: 'block', type: 'audio_attack' },
        { kind: 'block', type: 'audio_release' },
        // Audio visualizer
        {
          kind: 'block',
          type: 'audio_viz_start',
          inputs: { VIZ: { block: { type: 'audio_viz' } } },
        },
        { kind: 'block', type: 'audio_viz' },
        { kind: 'block', type: 'audio_viz_stop' },
        { kind: 'block', type: 'audio_viz_shader' },
        // Mic triggers
        { kind: 'block', type: 'audio_on_level' },
        { kind: 'block', type: 'audio_level' },
        // Speech
        { kind: 'block', type: 'audio_on_word' },
        { kind: 'block', type: 'audio_say' },
      ],
    },
    {
      kind: 'category',
      name: 'Shader',
      colour: 330,
      contents: [
        // Pre-nested: start shader [preset shader]
        {
          kind: 'block',
          type: 'shader_start',
          inputs: { SHADER: { block: { type: 'shader_preset' } } },
        },
        // Pre-nested: start shader [window editor greyscale]
        {
          kind: 'block',
          type: 'shader_start',
          inputs: { SHADER: { block: { type: 'shader_window_effect' } } },
        },
        // Creators (value blocks — can also feed stop/opacity/set_uniform)
        { kind: 'block', type: 'shader_preset' },
        { kind: 'block', type: 'shader_new' },
        { kind: 'block', type: 'shader_wgsl' },
        { kind: 'block', type: 'shader_js_fn' },
        { kind: 'block', type: 'shader_fn_body' },
        { kind: 'block', type: 'shader_window_effect' },
        { kind: 'block', type: 'shader_mic_viz' },
        // Action blocks
        { kind: 'block', type: 'shader_stop' },
        { kind: 'block', type: 'shader_opacity' },
        { kind: 'block', type: 'shader_set_uniform' },
        // Fn-body building blocks
        { kind: 'block', type: 'shader_return_rgba' },
        { kind: 'block', type: 'shader_math_trig' },
        { kind: 'block', type: 'shader_math_fn' },
        { kind: 'block', type: 'shader_param_uv_x' },
        { kind: 'block', type: 'shader_param_uv_y' },
        { kind: 'block', type: 'shader_param_time' },
        { kind: 'block', type: 'shader_param_mouse_x' },
        { kind: 'block', type: 'shader_param_mouse_y' },
        { kind: 'block', type: 'shader_param_res_x' },
        { kind: 'block', type: 'shader_param_res_y' },
        { kind: 'block', type: 'shader_param_custom_x' },
        { kind: 'block', type: 'shader_param_custom_y' },
        { kind: 'block', type: 'shader_param_custom_z' },
        { kind: 'block', type: 'shader_param_custom_w' },
      ],
    },
    {
      kind: 'category',
      name: 'Vision',
      colour: 180,
      contents: [
        { kind: 'block', type: 'vision_on_gesture' },
        { kind: 'block', type: 'vision_on_expression' },
        { kind: 'block', type: 'vision_gesture' },
        { kind: 'block', type: 'vision_face_detected' },
        { kind: 'block', type: 'vision_nearest' },
        { kind: 'block', type: 'vision_gaze' },
        { kind: 'block', type: 'vision_on_gaze' },
        { kind: 'block', type: 'vision_on_blink' },
      ],
    },
    {
      kind: 'category',
      name: 'Draw',
      colour: 60,
      contents: [
        { kind: 'block', type: 'draw_bg' },
        { kind: 'block', type: 'canvas_fill_rect' },
        { kind: 'block', type: 'canvas_fill_circle' },
        { kind: 'block', type: 'draw_ring' },
        { kind: 'block', type: 'draw_rect_stroke' },
        { kind: 'block', type: 'draw_line' },
        { kind: 'block', type: 'draw_text' },
        { kind: 'block', type: 'draw_text_rich' },
        { kind: 'block', type: 'canvas_clear' },
        { kind: 'block', type: 'draw_alpha' },
        { kind: 'block', type: 'draw_reset' },
        { kind: 'block', type: 'canvas_blur' },
        { kind: 'block', type: 'canvas_layer_opacity' },
        { kind: 'block', type: 'canvas_blend_mode' },
        { kind: 'block', type: 'draw_pixelate' },
        { kind: 'block', type: 'draw_backdrop' },
      ],
    },
    {
      kind: 'category',
      name: 'Canvas (window)',
      colour: 200,
      contents: [
        { kind: 'block', type: 'canvas_new' },
        { kind: 'block', type: 'canvas_surface_bg' },
        {
          kind: 'block',
          type: 'canvas_surface_circle',
          inputs: {
            X: { shadow: { type: 'math_number', fields: { NUM: 400 } } },
            Y: { shadow: { type: 'math_number', fields: { NUM: 300 } } },
          },
        },
        { kind: 'block', type: 'canvas_on' },
        { kind: 'block', type: 'canvas_pointer' },
      ],
    },
    {
      kind: 'category',
      name: 'Media',
      colour: 45,
      contents: [
        { kind: 'block', type: 'media_video' },
        { kind: 'block', type: 'media_video_play' },
        { kind: 'block', type: 'media_video_stop' },
        { kind: 'block', type: 'media_image_layer' },
      ],
    },
    {
      kind: 'category',
      name: 'PIXI',
      colour: 290,
      contents: [
        {
          kind: 'block',
          type: 'pixi_add_to_stage',
          inputs: { OBJ: { block: { type: 'pixi_graphics_circle' } } },
        },
        { kind: 'block', type: 'pixi_graphics_circle' },
        { kind: 'block', type: 'pixi_graphics_rect' },
        { kind: 'block', type: 'pixi_text' },
        { kind: 'block', type: 'pixi_sprite' },
        { kind: 'block', type: 'pixi_add_to_stage' },
        { kind: 'block', type: 'pixi_tick' },
        { kind: 'block', type: 'pixi_set_pos' },
        { kind: 'block', type: 'pixi_set_rotation' },
        { kind: 'block', type: 'pixi_set_alpha' },
        { kind: 'block', type: 'pixi_blur_filter' },
        { kind: 'block', type: 'pixi_clear_stage' },
      ],
    },
    {
      kind: 'category',
      name: 'GLShader',
      colour: 15,
      contents: [
        {
          kind: 'block',
          type: 'glshader_start',
          inputs: { SHADER: { block: { type: 'glshader_preset' } } },
        },
        { kind: 'block', type: 'glshader_preset' },
        { kind: 'block', type: 'glshader_body' },
        { kind: 'block', type: 'glshader_start' },
        { kind: 'block', type: 'glshader_stop' },
        { kind: 'block', type: 'glshader_opacity' },
      ],
    },
    {
      kind: 'category',
      name: 'Camera',
      colour: 165,
      contents: [
        // Pre-nested: start shader [camera shader greyscale]
        {
          kind: 'block',
          type: 'shader_start',
          inputs: { SHADER: { block: { type: 'shader_camera_effect' } } },
        },
        // Creator alone (for wiring to stop/opacity/set_uniform)
        { kind: 'block', type: 'shader_camera_effect' },
        { kind: 'block', type: 'shader_video_effect' },
        { kind: 'block', type: 'camera_open' },
        { kind: 'block', type: 'camera_stop' },
      ],
    },
    {
      kind: 'category',
      name: 'Pipeline',
      colour: 80,
      contents: [
        { kind: 'block', type: 'pipe_ascii_camera' },
        {
          kind: 'block',
          type: 'pipe_ascii_shader_camera',
        },
        { kind: 'block', type: 'pipe_camera_glshader' },
        { kind: 'block', type: 'pipe_pixelate_camera' },
        { kind: 'block', type: 'pipe_subtitle_video' },
      ],
    },
    {
      kind: 'category',
      name: 'Windows',
      colour: 200,
      contents: [
        { kind: 'block', type: 'wm_layout' },
        { kind: 'block', type: 'wm_show_hide' },
        { kind: 'block', type: 'wm_move' },
        { kind: 'block', type: 'wm_resize_win' },
        { kind: 'block', type: 'wm_close_win' },
        { kind: 'block', type: 'wm_set_z' },
        { kind: 'block', type: 'wm_set_opacity' },
        { kind: 'block', type: 'wm_spawn_html' },
        { kind: 'block', type: 'wm_spawn_camera' },
        { kind: 'block', type: 'wm_spawn_canvas' },
        {
          kind: 'block',
          type: 'wm_spawn_image',
          inputs: { SRC: { block: { type: 'wm_pick_file' } } },
        },
        {
          kind: 'block',
          type: 'wm_spawn_video',
          inputs: { SRC: { block: { type: 'wm_pick_file' } } },
        },
        {
          kind: 'block',
          type: 'wm_spawn_shader',
          inputs: { SHADER: { block: { type: 'shader_preset' } } },
        },
        { kind: 'block', type: 'wm_pick_file' },
        { kind: 'block', type: 'wm_browse' },
        { kind: 'block', type: 'wm_on_stroke' },
        { kind: 'block', type: 'wm_paint_signal' },
      ],
    },
    {
      kind: 'category',
      name: 'ASCII / Sprite',
      colour: 55,
      contents: [
        {
          kind: 'block',
          type: 'ascii_show',
          inputs: { ANIM: { block: { type: 'ascii_play' } } },
        },
        { kind: 'block', type: 'ascii_play' },
        { kind: 'block', type: 'sprite_create' },
        { kind: 'block', type: 'sprite_pixel' },
        { kind: 'block', type: 'sprite_play' },
        { kind: 'block', type: 'sprite_show' },
        { kind: 'block', type: 'paint_open' },
        { kind: 'block', type: 'paint_open_backdrop' },
        {
          kind: 'block',
          type: 'paint_on_stroke',
          inputs: { P: { block: { type: 'paint_open_ref' } } },
        },
        {
          kind: 'block',
          type: 'paint_on_color',
          inputs: { P: { block: { type: 'paint_open_ref' } } },
        },
        {
          kind: 'block',
          type: 'paint_signal',
          inputs: { P: { block: { type: 'paint_open_ref' } } },
        },
        { kind: 'block', type: 'ascii_editor_open' },
        {
          kind: 'block',
          type: 'ascii_editor_on_cell',
          inputs: { AE: { block: { type: 'ascii_editor_open_ref' } } },
        },
        {
          kind: 'block',
          type: 'ascii_editor_on_stroke',
          inputs: { AE: { block: { type: 'ascii_editor_open_ref' } } },
        },
        {
          kind: 'block',
          type: 'ascii_editor_signal',
          inputs: { AE: { block: { type: 'ascii_editor_open_ref' } } },
        },
        {
          kind: 'block',
          type: 'sprite_editor_on_pixel',
          inputs: { SP: { block: { type: 'sprite_editor_open' } } },
        },
        {
          kind: 'block',
          type: 'sprite_editor_on_stroke',
          inputs: { SP: { block: { type: 'sprite_editor_open' } } },
        },
        {
          kind: 'block',
          type: 'sprite_editor_signal',
          inputs: { SP: { block: { type: 'sprite_editor_open' } } },
        },
        { kind: 'block', type: 'sprite_editor_open' },
      ],
    },
    {
      kind: 'category',
      name: 'Three.js 3D',
      colour: 195,
      contents: [
        {
          kind: 'block',
          type: 'three_start',
          inputs: { SCENE: { block: { type: 'three_scene' } } },
        },
        { kind: 'block', type: 'three_scene' },
        { kind: 'block', type: 'three_tick' },
        { kind: 'block', type: 'three_box_mesh' },
        { kind: 'block', type: 'three_add' },
        { kind: 'block', type: 'three_rotate' },
        { kind: 'block', type: 'three_signal_graph' },
      ],
    },
  ],
};

// ── Public API ───────────────────────────────────────────────────────────────

export function initBlockly(container) {
  const workspace = Blockly.inject(container, {
    scrollbars: true,
    trashcan: true,
    zoom: { controls: true, wheel: true, startScale: 1.0, maxScale: 3, minScale: 0.3 },
    grid: { spacing: 20, length: 3, colour: '#ccc', snap: true },
  });
  return workspace;
}

export function getWorkspaceCode(workspace) {
  const code = javascriptGenerator.workspaceToCode(workspace);
  // ADR 040: the "quick draw" blocks emit against an implicit default `canvas`
  // (global `draw` is gone). Declare it once when used and not already created.
  if (/(^|[^.\w])canvas\./.test(code) && !/\bnew Canvas\b/.test(code)) {
    return `const canvas = new Canvas();\n${code}`;
  }
  return code;
}

export function resizeBlockly(workspace) {
  if (workspace) Blockly.svgResize(workspace);
}

export function initPaletteWorkspace(container) {
  return Blockly.inject(container, {
    scrollbars: true,
    zoom: { controls: false, wheel: true, startScale: 0.75 },
    grid: { spacing: 20, length: 3, colour: '#e8e8e8' },
    move: { scrollbars: true, drag: false, wheel: true },
  });
}

export function workspaceIsEmpty(workspace) {
  return workspace.getAllBlocks(false).length === 0;
}

export function registerSidebarDeleteZone(workspace, sidebarEl) {
  let _overlay = null;

  function _showOverlay() {
    if (_overlay) return;
    _overlay = document.createElement('div');
    _overlay.style.cssText =
      'position:absolute;inset:0;background:rgba(183,28,28,0.18);display:flex;align-items:center;justify-content:center;pointer-events:none;z-index:9999;border-radius:inherit;font-size:28px;';
    _overlay.textContent = '🗑';
    sidebarEl.style.position = 'relative';
    sidebarEl.appendChild(_overlay);
  }

  function _hideOverlay() {
    _overlay?.remove();
    _overlay = null;
  }

  const component = {
    id: 'sidebar-delete-zone',

    wouldDelete(dragElement) {
      const deletable = dragElement?.isDeletable?.() ?? false;
      const isTop = !dragElement?.getParent?.();
      return deletable && isTop;
    },

    getClientRect() {
      const r = sidebarEl.getBoundingClientRect();
      return new Blockly.utils.Rect(r.top, r.bottom, r.left, r.right);
    },

    onDragEnter(dragElement) {
      if (this.wouldDelete(dragElement)) _showOverlay();
    },

    onDragOver() {},

    onDragExit() {
      _hideOverlay();
    },

    onDrop() {
      _hideOverlay();
    },

    shouldPreventMove() {
      return false;
    },
  };

  workspace.getComponentManager().addComponent({
    component,
    weight: 0,
    capabilities: ['drag_target', 'delete_area'],
  });
  workspace.recordDragTargets();
}

export function loadWorkspaceJSON(workspace, json) {
  Blockly.serialization.workspaces.load(json, workspace);
}

export function saveWorkspaceJSON(workspace) {
  return Blockly.serialization.workspaces.save(workspace);
}

const _BKY_HUES = { LOGIC: 210, MATH: 230, TEXTS: 160, VARIABLES: 330 };

export const TOOLBOX_CATEGORY_META = TOOLBOX.contents.map((c) => {
  let hue = c.colour;
  if (typeof hue === 'string') {
    const m = hue.match(/BKY_(\w+?)_HUE/);
    hue = m ? (_BKY_HUES[m[1]] ?? 230) : 230;
  }
  const blocks = (c.contents || [])
    .filter((item) => item.kind === 'block')
    .map((item) => ({
      type: item.type,
      label: item.type.replace(/^[a-z]+_/, '').replace(/_/g, ' '),
    }));
  return { name: c.name, hue, blocks };
});

// Dynamic user-library category — populated at boot by populateLibraryBlocks()
TOOLBOX_CATEGORY_META.push({ name: 'My Library', hue: 270, blocks: [] });

// Add a registered block type to a palette category (used by window.__ar_applyLibraryBlock)
export function addBlockToCategoryMeta(categoryName, blockType) {
  const cat = TOOLBOX_CATEGORY_META.find((c) => c.name === categoryName);
  if (cat)
    cat.blocks.push({ type: blockType, label: blockType.replace(/^user_/, '').replace(/_/g, ' ') });
}

export function onPaletteClick(paletteWorkspace, callback) {
  paletteWorkspace.getInjectionDiv().addEventListener(
    'pointerdown',
    (e) => {
      const g = e.target.closest('g.blocklyBlock');
      if (!g) return;
      e.stopPropagation();
      e.preventDefault();
      callback(g.classList[0]); // first class is block type name
    },
    true,
  );
}

export function finishBlockRenders() {
  return Blockly.renderManagement.finishQueuedRenders();
}

export function hideInternalToolbox(workspace) {
  const tb = workspace.getToolbox();
  if (!tb?.HtmlDiv) return;
  const el = tb.HtmlDiv;
  el.style.display = 'none';
  tb.position = () => {
    el.style.display = 'none';
  };
  Blockly.svgResize(workspace);
}

/**
 * Dynamically register Blockly blocks for a plugin / registerAPI extension.
 * @param {string} _name — API name (unused, satisfies applier contract)
 * @param {Array<{definition: object, generator: function}>} blocksDefs
 */
export function applyExternalBlocks(_name, blocksDefs) {
  for (const { definition, generator } of blocksDefs) {
    Blockly.defineBlocksWithJsonArray([definition]);
    javascriptGenerator.forBlock[definition.type] = generator;
  }
}
