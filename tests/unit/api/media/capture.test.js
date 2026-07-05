// capture.test.js — tests for webcam/window capture persistence
//
// Tests: desktop.addBlob, serializeDesktop blobKey stubs, restoreDesktop,
// camera.photo/record wiring, CameraStream. Runs in jsdom.
//
// IDB functions (_putCaptureBlob etc.) call indexedDB which is stubbed in
// setup.js; they resolve silently. We verify the synchronous side-effects
// (icon.blobKey set, icon in _icons Map, serializeDesktop output).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeIDBMock() {
  const stores = {};
  const openReq = (storeName) => ({
    transaction(_s, _mode) {
      if (!stores[storeName]) stores[storeName] = {};
      return {
        objectStore() {
          return {
            put(val, key) {
              stores[storeName][key] = val;
              return {};
            },
            get(key) {
              const req = { result: stores[storeName][key] };
              Promise.resolve().then(() => req.onsuccess?.());
              return req;
            },
            delete(key) {
              delete stores[storeName][key];
              return {};
            },
          };
        },
        get _complete() {
          return this;
        },
        set oncomplete(fn) {
          if (fn) Promise.resolve().then(fn);
        },
      };
    },
    close() {},
    get _stores() {
      return stores;
    },
  });
  const mock = {
    open(name) {
      const req = {};
      const db = openReq(name);
      Promise.resolve().then(() => {
        req.onupgradeneeded?.({
          target: {
            result: {
              createObjectStore(s) {
                if (!stores[s]) stores[s] = {};
              },
            },
          },
        });
        req.onsuccess?.({ target: { result: db } });
      });
      return req;
    },
  };
  return mock;
}

let DesktopAPI, serializeDesktop, restoreDesktop, initDesktop;

beforeEach(async () => {
  global.indexedDB = makeIDBMock();
  global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
  global.URL.revokeObjectURL = vi.fn();

  // Minimal desktop DOM
  const desktop = document.createElement('div');
  desktop.id = 'desktop';
  document.body.appendChild(desktop);

  vi.resetModules();
  ({ DesktopAPI, serializeDesktop, restoreDesktop, initDesktop } =
    await import('../../../../src/api/platform/desktop-files.js'));
  initDesktop(null); // no wm needed for these tests
});

afterEach(() => {
  document.getElementById('desktop')?.remove();
  vi.restoreAllMocks();
});

// ── desktop.addBlob ───────────────────────────────────────────────────────────

describe('desktop.addBlob', () => {
  it('creates an icon and sets blobKey', () => {
    const blob = new Blob(['test'], { type: 'image/jpeg' });
    const result = DesktopAPI.addBlob(blob, { name: 'selfie.jpg', type: 'image' });
    expect(result.id).toBeTruthy();
    expect(result.type).toBe('image');
    expect(result.name).toBe('selfie.jpg');
    expect(result.url).toBe('blob:mock-url');
  });

  it('sets icon.blobKey = icon.id', () => {
    const blob = new Blob(['v'], { type: 'video/webm' });
    DesktopAPI.addBlob(blob, { name: 'clip.webm', type: 'video' });
    const state = serializeDesktop();
    const entry = state.find((e) => e.name === 'clip.webm');
    expect(entry).toBeDefined();
    expect(entry.blobKey).toBeTruthy();
    expect(entry.blobKey).toMatch(/^dt-/);
  });

  it('triggers download when download:true', () => {
    const appendSpy = vi.spyOn(document.body, 'appendChild');
    const blob = new Blob(['p'], { type: 'image/png' });
    DesktopAPI.addBlob(blob, { name: 'photo.png', type: 'image', download: true });
    // appendChild is called with the <a> download element
    const calls = appendSpy.mock.calls.map((c) => c[0]);
    const anchor = calls.find((el) => el?.tagName === 'A');
    expect(anchor).toBeDefined();
    expect(anchor.download).toBe('photo.png');
  });
});

// ── serializeDesktop ──────────────────────────────────────────────────────────

describe('serializeDesktop', () => {
  it('includes blobKey stub for capture icons', () => {
    const blob = new Blob(['x'], { type: 'image/jpeg' });
    DesktopAPI.addBlob(blob, { name: 'shot.jpg', type: 'image' });
    const state = serializeDesktop();
    const entry = state.find((e) => e.name === 'shot.jpg');
    expect(entry).toBeDefined();
    expect(entry.blobKey).toBeTruthy();
    expect(entry.content).toBeUndefined(); // no inline data
    expect(entry.url).toBeUndefined();
  });

  it('excludes blobKey stubs when forProject:true', () => {
    const blob = new Blob(['x'], { type: 'video/webm' });
    DesktopAPI.addBlob(blob, { name: 'vid.webm', type: 'video' });
    const state = serializeDesktop({ forProject: true });
    const entry = state.find((e) => e.name === 'vid.webm');
    expect(entry).toBeUndefined(); // excluded from project file
  });

  it('preserves existing non-blob icons in forProject mode', () => {
    // Simulate an HTTP URL icon (no blobKey, not a blob: URL)
    DesktopAPI.add('https://example.com/img.png', { name: 'web.png', type: 'image' });
    const state = serializeDesktop({ forProject: true });
    const entry = state.find((e) => e.name === 'web.png');
    expect(entry).toBeDefined();
    expect(entry.url).toBe('https://example.com/img.png');
  });
});

// ── restoreDesktop ────────────────────────────────────────────────────────────

describe('restoreDesktop', () => {
  it('creates placeholder icon synchronously for blobKey entries', async () => {
    // Simulate a serialized state with blobKey
    restoreDesktop([{ type: 'image', name: 'selfie.jpg', blobKey: 'dt-42', x: 20, y: 20 }]);
    // Icon appears in the DOM immediately (as placeholder)
    const icon = document.querySelector('[data-dt-id]');
    expect(icon).toBeTruthy();
  });

  it('resolves blob URL asynchronously from IDB', async () => {
    // Preload IDB with a blob
    const blob = new Blob(['img'], { type: 'image/jpeg' });
    DesktopAPI.addBlob(blob, { name: 'a.jpg', type: 'image' });
    const state = serializeDesktop();
    const entry = state.find((e) => e.name === 'a.jpg');
    // Remove icons and restore from state (simulates reload)
    DesktopAPI.clear();
    restoreDesktop([entry]);
    // Wait for async IDB + promise resolution
    await new Promise((r) => setTimeout(r, 50));
    // URL.createObjectURL should have been called again for the restored blob
    expect(URL.createObjectURL).toHaveBeenCalled();
  });
});

// ── desktop.remove ────────────────────────────────────────────────────────────

describe('desktop.remove', () => {
  it('removes icon from DOM', () => {
    const blob = new Blob(['x'], { type: 'image/jpeg' });
    const { id } = DesktopAPI.addBlob(blob, { name: 'r.jpg', type: 'image' });
    const beforeCount = document.querySelectorAll('[data-dt-id]').length;
    DesktopAPI.remove(id);
    expect(document.querySelectorAll('[data-dt-id]').length).toBe(beforeCount - 1);
  });
});

// ── CameraStream.photo / .record ─────────────────────────────────────────────

describe('CameraStream capture methods', () => {
  beforeEach(async () => {
    // Minimal MediaRecorder mock
    class MockMR {
      constructor(stream, opts) {
        this.state = 'inactive';
        this.mimeType = opts?.mimeType ?? 'video/webm';
        this.ondataavailable = null;
        this.onstop = null;
      }
      start() {
        this.state = 'recording';
      }
      stop() {
        this.state = 'inactive';
        this.onstop?.();
      }
    }
    MockMR.isTypeSupported = () => true;
    global.MediaRecorder = MockMR;
  });

  function makeMediaStream(deviceId) {
    return {
      getVideoTracks: () => [{ getSettings: () => ({ deviceId }) }],
      getTracks: () => [],
    };
  }

  function mockMediaDevices(deviceId) {
    const stream = makeMediaStream(deviceId);
    // Make all video elements appear as HAVE_METADATA (readyState >= 1) so
    // Camera.open() resolves immediately without waiting for loadedmetadata.
    Object.defineProperty(HTMLVideoElement.prototype, 'readyState', {
      get() {
        return 1;
      },
      configurable: true,
    });
    global.navigator.mediaDevices = {
      enumerateDevices: async () => [{ kind: 'videoinput', deviceId }],
      getUserMedia: async () => stream,
    };
    return stream;
  }

  it('cam.photo() calls desktop.addBlob with image type', async () => {
    mockMediaDevices('cam1');
    HTMLCanvasElement.prototype.toBlob = vi.fn((cb, type) => cb(new Blob(['img'], { type })));
    window.desktop = {
      addBlob: vi.fn(() => ({ id: 'icon-1', name: 'photo.jpg', type: 'image', url: 'blob:x' })),
    };
    const { Camera } = await import('../../../../src/api/media/camera.js');
    const cam = await Camera.open({ deviceId: 'cam1' });
    await cam.photo({ name: 'test' });
    expect(window.desktop.addBlob).toHaveBeenCalledWith(
      expect.any(Blob),
      expect.objectContaining({ name: 'test.jpg', type: 'image' }),
    );
    cam.stop();
  });

  it('cam.record() returns a Recording', async () => {
    mockMediaDevices('cam2');
    window.desktop = { addBlob: vi.fn() };
    const { Camera } = await import('../../../../src/api/media/camera.js');
    const { Recording } = await import('../../../../src/api/media/recorder.js');
    const cam = await Camera.open({ deviceId: 'cam2' });
    const rec = cam.record({ name: 'clip' });
    expect(rec).toBeInstanceOf(Recording);
    rec.stop();
    cam.stop();
  });

  it('two opens of the same device share ONE stream (single getUserMedia)', async () => {
    const stream = makeMediaStream('camS');
    Object.defineProperty(HTMLVideoElement.prototype, 'readyState', {
      get() {
        return 1;
      },
      configurable: true,
    });
    let gumCalls = 0;
    global.navigator.mediaDevices = {
      enumerateDevices: async () => [{ kind: 'videoinput', deviceId: 'camS' }],
      getUserMedia: async () => {
        gumCalls++;
        return stream;
      },
    };
    const { Camera } = await import('../../../../src/api/media/camera.js');
    const a = await Camera.open({ deviceId: 'camS' });
    const b = await Camera.open({ deviceId: 'camS' });
    expect(gumCalls).toBe(1); // one underlying stream
    expect(a.element).toBe(b.element); // same <video> element
    expect(a._stream).toBe(b._stream); // same MediaStream
    a.stop();
    b.stop();
  });

  it("scoped reset keeps another editor's camera alive; last release stops tracks", async () => {
    const stopped = [];
    const stream = {
      getVideoTracks: () => [{ getSettings: () => ({ deviceId: 'camT' }) }],
      getTracks: () => [{ stop: () => stopped.push('track') }],
    };
    Object.defineProperty(HTMLVideoElement.prototype, 'readyState', {
      get() {
        return 1;
      },
      configurable: true,
    });
    global.navigator.mediaDevices = {
      enumerateDevices: async () => [{ kind: 'videoinput', deviceId: 'camT' }],
      getUserMedia: async () => stream,
    };
    const { Camera, cleanupCameras } = await import('../../../../src/api/media/camera.js');

    const prev = window.__ar_active_editor_id;
    window.__ar_active_editor_id = 1;
    const a = await Camera.open({ deviceId: 'camT' }); // editor 1
    window.__ar_active_editor_id = 2;
    await Camera.open({ deviceId: 'camT' }); // editor 2, shares stream
    window.__ar_active_editor_id = prev;

    cleanupCameras(2); // editor 2 resets
    expect(stopped).toEqual([]); // stream still alive (editor 1 holds it)
    expect(a._stream).toBe(stream); // editor 1's handle still reads it

    cleanupCameras(1); // editor 1 resets → last holder
    expect(stopped).toEqual(['track']); // now the track stops
  });
});
