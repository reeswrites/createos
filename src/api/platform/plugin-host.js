import { trackedGroup } from '../../runtime/tracked-group.js';
// plugin-host.js — sandboxed iframe plugins as first-class wm windows
// #19: PluginHost.load(url) / PluginHost.create(html)
// Signal bus: plugin.send(type, val), plugin.on(type, fn), plugin.bridge(name, fn)
// Canvas output: plugin.canvas → HTMLCanvasElement usable as GLShader/pipe source

const _plugins = trackedGroup({ teardown: (p) => p._destroy() });

// Manual "destroy-all" helper (tests / app.js); reset teardown is the group's own.
export function cleanupPlugins() {
  _plugins.teardownAll();
}

// ── Plugin ────────────────────────────────────────────────────────────────────

class Plugin {
  constructor(src) {
    this._src = src;
    this._handlers = {};
    this._bridges = [];
    this._iframe = null;
    this._winId = null;
    this._rafId = null;
    this._msgListener = null;
    // Mirror canvas for cross-origin frame capture
    this._mirrorCanvas = null;
    this._mirrorCtx = null;
    _plugins.add(this);
  }

  // Spawn in a wm window
  spawn(title = 'Plugin', opts = {}) {
    const { w = 400, h = 300 } = opts;

    // Build blob URL if src is HTML string
    let iframeSrc = this._src;
    if (this._src.trimStart().startsWith('<')) {
      const injected = this._src.replace(/<head[^>]*>/i, (m) => m + _PLUGIN_SHIM);
      const blob = new Blob([injected], { type: 'text/html' });
      iframeSrc = URL.createObjectURL(blob);
    }

    const iframe = document.createElement('iframe');
    iframe.src = iframeSrc;
    iframe.sandbox = 'allow-scripts allow-same-origin allow-forms allow-modals';
    iframe.allow = 'camera; microphone';
    iframe.style.cssText = 'width:100%;height:100%;border:none;display:block;';
    this._iframe = iframe;

    // Intercept wm.spawn and inject iframe directly
    const winId = window.wm?.spawn(title, {
      html: '<div style="position:absolute;inset:0;padding:0;"></div>',
      w,
      h,
      onClose: () => this._stopBridge(),
      ...opts,
    });
    this._winId = winId;

    if (winId) {
      const win = document.getElementById(winId);
      const body = win?.querySelector('.wm-body');
      if (body) {
        body.style.cssText += ';padding:0;overflow:hidden;position:relative;';
        body.innerHTML = '';
        body.appendChild(iframe);
      }
    }

    // Listen for messages from all sources (filter by iframe)
    this._msgListener = (e) => {
      if (e.source !== iframe.contentWindow) return;
      const msg = e.data;
      if (!msg || typeof msg !== 'object') return;

      // Frame capture protocol (cross-origin canvas sharing)
      // Use duck-type check so jsdom tests don't throw on missing ImageBitmap
      if (msg._vlFrame && msg.bitmap && typeof msg.bitmap.width === 'number') {
        if (!this._mirrorCanvas) {
          this._mirrorCanvas = document.createElement('canvas');
          this._mirrorCtx = this._mirrorCanvas.getContext('2d');
        }
        const bmp = msg.bitmap;
        this._mirrorCanvas.width = bmp.width;
        this._mirrorCanvas.height = bmp.height;
        this._mirrorCtx.drawImage(bmp, 0, 0);
        bmp.close();
        return;
      }

      // General message routing
      const { _vlType: type, _vlPayload: payload } = msg;
      if (type && this._handlers[type]) {
        for (const fn of this._handlers[type]) fn(payload);
      }
    };
    window.addEventListener('message', this._msgListener);

    // Try same-origin injection after load
    iframe.addEventListener('load', () => {
      this._injectAPI();
      this._startBridge();
    });

    return this;
  }

  // Inject vlPlugin shim into same-origin iframes (no-op for cross-origin)
  _injectAPI() {
    try {
      const iw = this._iframe?.contentWindow;
      if (!iw || !iw.document) return;
      if (iw.vlPlugin) return; // already injected via shim
      iw.vlPlugin = _makePluginAPI(this);
    } catch (_) {
      /* cross-origin — shim in <head> handles it */
    }
  }

  _startBridge() {
    if (this._rafId) return;
    const loop = () => {
      if (!this._iframe?.isConnected) {
        this._stopBridge();
        return;
      }
      for (const { name, fn } of this._bridges) {
        try {
          this.send(name, fn());
        } catch (_) {}
      }
      this._rafId = requestAnimationFrame(loop);
    };
    this._rafId = requestAnimationFrame(loop);
  }

  _stopBridge() {
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  // Send a typed message to the iframe
  send(type, payload) {
    this._iframe?.contentWindow?.postMessage({ _vlType: type, _vlPayload: payload }, '*');
    return this;
  }

  // Register a handler for messages from the iframe
  on(type, fn) {
    (this._handlers[type] ??= []).push(fn);
    return this;
  }

  off(type, fn) {
    this._handlers[type] = (this._handlers[type] ?? []).filter((h) => h !== fn);
    return this;
  }

  // Bridge a live signal to the iframe (called each RAF)
  // fn() is evaluated each frame; result sent as send(name, value)
  bridge(name, fn) {
    this._bridges.push({ name, fn });
    window.__ar_signalRoutes?.push({
      source: name,
      sink: `Plugin:${this._winId ?? '?'}`,
      label: name,
    });
    return this;
  }

  // Get canvas: same-origin → iframe canvas; cross-origin → mirror canvas
  get canvas() {
    // Same-origin: direct access
    try {
      const iframeDoc = this._iframe?.contentDocument;
      if (iframeDoc) {
        const c = iframeDoc.querySelector('canvas');
        if (c) return c;
      }
    } catch (_) {}
    // Cross-origin: mirror from frame-capture protocol
    return this._mirrorCanvas;
  }

  // wm convenience
  close() {
    window.wm?.close?.(this._winId);
    return this;
  }
  show() {
    window.wm?.show?.(this._winId);
    return this;
  }
  hide() {
    window.wm?.hide?.(this._winId);
    return this;
  }

  _destroy() {
    this._stopBridge();
    if (this._msgListener) {
      window.removeEventListener('message', this._msgListener);
      this._msgListener = null;
    }
  }
}

// ── Shim injected into HTML-string plugins ────────────────────────────────────

function _makePluginAPI(host) {
  return {
    on(type, fn) {
      host.on(type, fn);
      return this;
    },
    off(type, fn) {
      host.off(type, fn);
      return this;
    },
    send(type, payload) {
      window.parent?.postMessage({ _vlType: type, _vlPayload: payload }, '*');
      return this;
    },
    // Share canvas with host via ImageBitmap transfer
    shareCanvas(canvas) {
      const loop = () => {
        if (!canvas.isConnected) return;
        try {
          const bmp = canvas.transferToImageBitmap();
          window.parent?.postMessage({ _vlFrame: true, bitmap: bmp }, '*', [bmp]);
        } catch (_) {}
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
      return this;
    },
  };
}

// Script tag injected into <head> of HTML-string plugins to expose vlPlugin
const _PLUGIN_SHIM = `
<script>
window.addEventListener('message', e => {
  if (!e.data || !e.data._vlType) return;
  window.dispatchEvent(new CustomEvent('vl:' + e.data._vlType, { detail: e.data._vlPayload }));
});
window.vlPlugin = {
  on(type, fn) {
    window.addEventListener('vl:' + type, e => fn(e.detail));
    return this;
  },
  send(type, payload) {
    window.parent.postMessage({ _vlType: type, _vlPayload: payload }, '*');
    return this;
  },
  shareCanvas(canvas) {
    const loop = () => {
      if (!canvas.isConnected) return;
      try {
        const bmp = canvas.transferToImageBitmap();
        window.parent.postMessage({ _vlFrame: true, bitmap: bmp }, '*', [bmp]);
      } catch(_) {}
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    return this;
  },
};
</script>
`;

// ── Public API ────────────────────────────────────────────────────────────────

export const PluginHost = {
  // Load an iframe from a URL
  load(url) {
    return new Plugin(url);
  },

  // Create an iframe from an HTML string (blob URL, sandboxed)
  create(html) {
    return new Plugin(html);
  },
};
