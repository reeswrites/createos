import { defineConfig } from 'vite';

export default defineConfig({
  base: '/createos/',
  optimizeDeps: {
    // transformers (ONNX Runtime Web) is dynamically imported by the STT engine; excluding
    // it keeps the WASM/worker assets intact and out of the pre-bundle (ADR 039).
    exclude: ['@mediapipe/tasks-vision', '@huggingface/transformers'],
    include: [
      '@codemirror/view',
      '@codemirror/state',
      '@codemirror/commands',
      '@codemirror/language',
      '@codemirror/lang-javascript',
      '@codemirror/autocomplete',
      '@codemirror/search',
    ],
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['tests/**/*.test.js'],
    setupFiles: ['tests/setup.js'],
  },
});
