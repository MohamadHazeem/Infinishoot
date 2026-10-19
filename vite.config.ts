import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig({
  // Relative asset paths so the build runs from any folder (the desktop app loads dist/index.html from disk).
  base: './',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  server: { port: 5173, open: false },
  build: { target: 'es2022', sourcemap: false, manifest: true, chunkSizeWarningLimit: 1000 }, // three.js ~550 kB + peerjs
});
