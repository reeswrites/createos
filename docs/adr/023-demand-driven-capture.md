# Demand-driven capture with refcounted leases

Previously `getUserMedia` was called eagerly at page load for both the toolbar camera and mic, so the OS device light turned on immediately regardless of whether any code used them. The toolbar had separate toggle buttons (on/off), spawn buttons (new viz window), and a device dropdown — confusing, and the indicator of "is this device live" was absent.

We replaced this with demand-driven lazy capture: streams are acquired only when ≥1 consumer holds a lease (refcount 0→1 calls `getUserMedia`; 1→0 stops all tracks and clears the canvas/analyser). The toolbar camera and mic icons now simply spawn a viz window; they never toggle access. A small pulsing red dot on each icon lights when that device is genuinely active.

`src/api/media/media-lease.js` is the single lease registry. It holds `start`/`stop` fns registered by `camera.js` and `mic.js` via `initCameraLease`/`initMicLease`. Every consumer — whether a WM window or user code — acquires a lease and releases it when done. Run-scoped leases (code consumers) are tracked separately and released automatically on reset via `onReset`.

The indicator scope is "any live capture": both the toolbar stream and `Camera.open()` multi-cam streams in user code emit `camera:open`/`camera:close` bus events, and the indicator counts all of them.

## Ready-signal contract for async-acquired sources

Lazy acquisition is asynchronous (`getUserMedia` → `loadedmetadata`). A consumer that reads the source immediately after acquiring a lease sees a blank canvas or null analyser until the stream lands. The contract: **acquire → fire `camera:ready` / `mic:ready` once streaming → consumers that render once (viz windows, snapshots) subscribe to `*:ready` and re-render**. Continuous RAF consumers (draw.backdrop, video-signal, shader.camera) self-heal on the next frame and need no special handling. Apply this pattern to any future async-acquired source: acquire-first, ready-event-to-refresh.
