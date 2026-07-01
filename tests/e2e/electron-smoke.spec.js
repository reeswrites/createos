// electron-smoke.spec.js — the ADR 053 e2e tier: launches a REAL Electron app to cover
// main / preload / IPC / consent, which the jsdom vitest suite can't reach. Kept OUT of
// the vitest gate (separate `npm run test:e2e`); needs a display (CI: xvfb on Linux).
//
// Prereq: a production build exists (`npm run electron:build` or `ELECTRON=1 npm run build`),
// since main.cjs loads dist/index.html when ELECTRON_START_URL is unset.

import { test, expect, _electron as electron } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('shell boots, preload exposes the narrow bridge, consent gate holds', async () => {
  const app = await electron.launch({ args: [join(root, 'electron', 'main.cjs')] });
  const win = await app.firstWindow();

  // 1. The renderer loaded.
  await expect(win.locator('body')).toBeVisible();

  // 2. The preload bridge is present and narrow — named fns only, no raw ipcRenderer/fs.
  const bridge = await win.evaluate(() => {
    const b = window.__createos_native;
    return {
      keys: b ? Object.keys(b).sort() : null,
      hasIpc: 'require' in window || 'ipcRenderer' in window,
    };
  });
  expect(bridge.keys).toContain('pickDirectory');
  expect(bridge.keys).toContain('readFile');
  expect(bridge.keys).toContain('oscSend');
  expect(bridge.hasIpc).toBe(false);

  // 3. Consent gate: reading a path that was never granted via a dialog must reject.
  const denied = await win.evaluate(async () => {
    try {
      await window.__createos_native.readFile('/etc/passwd');
      return 'RESOLVED';
    } catch (e) {
      return String(e);
    }
  });
  expect(denied).toMatch(/Access denied|outside any user-granted/i);

  await app.close();
});
