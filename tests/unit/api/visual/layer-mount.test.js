import { describe, it, expect, afterEach } from 'vitest';
import { mountLayerCanvas } from '../../../../src/api/visual/layer.js';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('mountLayerCanvas', () => {
  it('creates a canvas, styles it as an absolute fill, and appends to the container', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const { canvas, parent, resizeObserver } = mountLayerCanvas({ z: 30, opacity: 0.5, container });

    expect(canvas.tagName).toBe('CANVAS');
    expect(parent).toBe(container);
    expect(container.contains(canvas)).toBe(true);
    expect(canvas.style.position).toBe('absolute');
    expect(canvas.style.zIndex).toBe('30');
    expect(canvas.style.opacity).toBe('0.5');
    expect(canvas.style.pointerEvents).toBe('none');
    expect(typeof resizeObserver.disconnect).toBe('function');
  });

  it('promotes a static container to position:relative', () => {
    const container = document.createElement('div');
    container.style.position = 'static';
    document.body.appendChild(container);
    mountLayerCanvas({ container });
    expect(container.style.position).toBe('relative');
  });

  it('tags WebGPU canvases so the mirror loop can skip them', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const { canvas } = mountLayerCanvas({ container, webgpu: true });
    expect(canvas._ar_webgpu).toBe(true);

    const { canvas: gl } = mountLayerCanvas({ container });
    expect(gl._ar_webgpu).toBeUndefined();
  });
});
