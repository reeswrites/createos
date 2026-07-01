import { defineConfig } from '@playwright/test';

// Electron e2e only (ADR 053). Separate from the vitest unit gate — run via
// `npm run test:e2e`. testDir is tests/e2e (vitest owns tests/unit; the .spec.js suffix
// keeps them disjoint even under one tests/ root).
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  timeout: 30_000,
});
