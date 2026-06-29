import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock THREE.WebGLRenderer before importing ThreeScene (jsdom has no WebGL)
vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal();
  const mockCanvas = document.createElement('canvas');
  mockCanvas.style.cssText = '';
  const MockRenderer = class {
    constructor() {
      this.domElement = document.createElement('canvas');
      this.domElement.style.cssText = '';
    }
    setSize() {}
    setPixelRatio() {}
    render() {}
    dispose() {}
  };
  return { ...actual, WebGLRenderer: MockRenderer };
});

import { ThreeScene, cleanupThree, THREE } from '../src/api/three-scene.js';

// Minimal DOM stubs
function makeWrapper() {
  const el = document.createElement('div');
  el.id = 'canvasWrapper';
  el.style.width = '800px';
  el.style.height = '600px';
  Object.defineProperty(el, 'offsetWidth',  { get: () => 800 });
  Object.defineProperty(el, 'offsetHeight', { get: () => 600 });
  document.body.appendChild(el);
  return el;
}

describe('ThreeScene', () => {
  let wrapper;
  let keepAlive;

  beforeEach(() => {
    wrapper = makeWrapper();
    keepAlive = new Set();
    window.__ar_canvasWrapper = wrapper;
    window.__ar_keepAlive = keepAlive;
    window.__ar_paused = false;
    window.__ar_signalRoutes = [];
  });

  afterEach(() => {
    cleanupThree();
    wrapper.remove();
    delete window.__ar_canvasWrapper;
    delete window.__ar_keepAlive;
    delete window.__ar_signalRoutes;
  });

  it('constructs scene, camera, renderer', () => {
    const s = new ThreeScene();
    expect(s.scene).toBeDefined();
    expect(s.camera).toBeDefined();
    expect(s.renderer).toBeDefined();
    expect(s.canvas).toBeDefined();
    expect(s.canvas.tagName).toBe('CANVAS');
  });

  it('canvas z-index defaults to 30', () => {
    const s = new ThreeScene({ z: 30 });
    expect(s.canvas.style.zIndex).toBe('30');
  });

  it('mount(el) appends canvas to the target and registers keepAlive (ADR 040)', () => {
    const s = new ThreeScene();
    s.mount(wrapper);
    expect(wrapper.contains(s.canvas)).toBe(true);
    expect(keepAlive.has(s)).toBe(true);
    s.stop();
  });

  it('stop() removes from keepAlive', () => {
    const s = new ThreeScene();
    s.start();
    s.stop();
    expect(keepAlive.has(s)).toBe(false);
  });

  it('tick() registers callbacks', () => {
    const fn = vi.fn();
    const s = new ThreeScene();
    s.tick(fn);
    expect(s._tickFns).toHaveLength(1);
    expect(s._tickFns[0]).toBe(fn);
  });

  it('add() delegates to scene.add', () => {
    const s = new ThreeScene();
    const spy = vi.spyOn(s.scene, 'add');
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshNormalMaterial());
    s.add(mesh);
    expect(spy).toHaveBeenCalledWith(mesh);
  });

  it('remove() delegates to scene.remove', () => {
    const s = new ThreeScene();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshNormalMaterial());
    s.add(mesh);
    const spy = vi.spyOn(s.scene, 'remove');
    s.remove(mesh);
    expect(spy).toHaveBeenCalledWith(mesh);
  });

  it('z() updates canvas z-index and returns this', () => {
    const s = new ThreeScene();
    const ret = s.z(50);
    expect(s.canvas.style.zIndex).toBe('50');
    expect(ret).toBe(s);
  });

  it('opacity() updates canvas opacity and returns this', () => {
    const s = new ThreeScene();
    const ret = s.opacity(0.5);
    expect(s.canvas.style.opacity).toBe('0.5');
    expect(ret).toBe(s);
  });

  it('resize() updates renderer and camera aspect', () => {
    const s = new ThreeScene({ width: 800, height: 600 });
    s.resize(1280, 720);
    expect(s.camera.aspect).toBeCloseTo(1280 / 720, 3);
  });

  it('bind() stores binding and registers signal route', () => {
    const s = new ThreeScene();
    const fn = () => 0.5;
    s.bind('audioLevel', fn);
    expect(s._bindings['audioLevel']).toBe(fn);
    expect(window.__ar_signalRoutes).toHaveLength(1);
    expect(window.__ar_signalRoutes[0].source).toBe('audioLevel');
    expect(window.__ar_signalRoutes[0].sink).toBe('ThreeScene');
  });

  it('get() calls bound function', () => {
    const s = new ThreeScene();
    s.bind('level', () => 0.7);
    expect(s.get('level')).toBeCloseTo(0.7);
  });

  it('get() returns undefined for unknown binding', () => {
    const s = new ThreeScene();
    expect(s.get('unknown')).toBeUndefined();
  });

  it('start() returns this for chaining', () => {
    const s = new ThreeScene();
    expect(s.start()).toBe(s);
    s.stop();
  });

  it('stop() returns this for chaining', () => {
    const s = new ThreeScene();
    s.start();
    expect(s.stop()).toBe(s);
  });

  it('tick() returns this for chaining', () => {
    const s = new ThreeScene();
    expect(s.tick(() => {})).toBe(s);
  });

  it('cleanupThree() destroys all scenes', () => {
    const s1 = new ThreeScene();
    const s2 = new ThreeScene();
    s1.start();
    s2.start();
    cleanupThree();
    expect(s1._destroyed).toBe(true);
    expect(s2._destroyed).toBe(true);
    expect(keepAlive.size).toBe(0);
  });

  it('cleanupThree() removes canvases from DOM', () => {
    const s = new ThreeScene();
    s.mount(wrapper);
    expect(wrapper.contains(s.canvas)).toBe(true);
    cleanupThree();
    expect(wrapper.contains(s.canvas)).toBe(false);
  });

  it('double start() does not create duplicate RAF loop', () => {
    const s = new ThreeScene();
    s.start();
    const id1 = s._rafId;
    s.start(); // second call is no-op
    expect(s._rafId).toBe(id1);
    s.stop();
  });
});

describe('THREE namespace', () => {
  it('exports THREE with core classes', () => {
    expect(THREE.Scene).toBeDefined();
    expect(THREE.Mesh).toBeDefined();
    expect(THREE.BoxGeometry).toBeDefined();
    expect(THREE.MeshNormalMaterial).toBeDefined();
    expect(THREE.PerspectiveCamera).toBeDefined();
    expect(THREE.WebGLRenderer).toBeDefined();
    expect(THREE.BufferGeometry).toBeDefined();
    expect(THREE.BufferAttribute).toBeDefined();
    expect(THREE.Points).toBeDefined();
    expect(THREE.PointsMaterial).toBeDefined();
  });
});
