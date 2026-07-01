import { defineConfig } from 'vite';
import { readFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const _dir = dirname(fileURLToPath(import.meta.url));
const FAUST_SRC = join(_dir, 'node_modules/@grame/faustwasm/libfaust-wasm');
const FAUST_FILES = ['libfaust-wasm.js', 'libfaust-wasm.data', 'libfaust-wasm.wasm'];
const FAUST_MIME = {
  '.js': 'text/javascript',
  '.data': 'application/octet-stream',
  '.wasm': 'application/wasm',
};

// Serve the libfaust WASM compiler assets (~5 MB) from node_modules — in dev via
// middleware, at build by copying into dist/libfaust-wasm/. Keeps the binaries out
// of git and out of the main bundle; the Faust Voice engine (ADR 046) fetches them
// lazily on first use. Mirrors the MediaPipe/transformers "keep WASM intact" stance.
function faustAssets() {
  return {
    name: 'faust-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const m =
          req.url && req.url.match(/\/libfaust-wasm\/(libfaust-wasm\.(?:js|data|wasm))(?:\?.*)?$/);
        if (!m) return next();
        const file = join(FAUST_SRC, m[1]);
        if (!existsSync(file)) return next();
        const ext = m[1].slice(m[1].lastIndexOf('.'));
        res.setHeader('Content-Type', FAUST_MIME[ext] ?? 'application/octet-stream');
        res.end(readFileSync(file));
      });
    },
    closeBundle() {
      const outDir = join(_dir, 'dist', 'libfaust-wasm');
      try {
        mkdirSync(outDir, { recursive: true });
        for (const f of FAUST_FILES) copyFileSync(join(FAUST_SRC, f), join(outDir, f));
      } catch (e) {
        console.warn('faust-assets: copy to dist failed', e);
      }
    },
  };
}

export default defineConfig({
  // Electron loads the build over file://, where an absolute base can't resolve — use a
  // relative base for the desktop build (ELECTRON=1) and the GitHub-Pages path otherwise.
  base: process.env.ELECTRON === '1' ? './' : '/createos/',
  plugins: [faustAssets()],
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
    include: ['tests/unit/**/*.test.js'],
    setupFiles: ['tests/unit/setup.js'],
  },
});
