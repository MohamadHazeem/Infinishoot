// Shared headless-browser helpers for scripts/fuzz.mjs and scripts/soak.mjs.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';

export const root = fileURLToPath(new URL('../..', import.meta.url));

/** Offline: every host but the local server fails to resolve (no PeerJS broker, leaderboard or web fonts). */
export const OFFLINE = '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1';
/** The GPU through Metal on a Mac (a page boots in ~1 s; SwiftShader took ~15 s), else SwiftShader. FUZZ_GL=swiftshader forces it. */
export const GL = process.platform === 'darwin' && process.env.FUZZ_GL !== 'swiftshader' ? ['--use-angle=metal'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
export const CHROME_ARGS = [...GL, '--autoplay-policy=no-user-gesture-required', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', OFFLINE];

/** Chromium like scripts/shot.mjs: SHOT_CHROME, else Playwright's headless shell cache. */
export function findChrome() {
  if (process.env.SHOT_CHROME) return process.env.SHOT_CHROME;
  const roots = [join(homedir(), 'Library/Caches/ms-playwright'), join(homedir(), '.cache/ms-playwright')];
  for (const r of roots) {
    if (!existsSync(r)) continue;
    for (const d of readdirSync(r).filter((x) => x.startsWith('chromium_headless_shell-')).sort().reverse()) {
      for (const sub of readdirSync(join(r, d))) {
        const p = join(r, d, sub, 'chrome-headless-shell');
        if (existsSync(p)) return p;
      }
    }
  }
  return undefined;
}

/**
 * A development-mode bundle (the dev bot is in: `import.meta.env.DEV`), served statically. A fresh
 * browser context per link loads it in about a second, where the dev server's ~1000 modules took a minute.
 * Returns the base URL and a close function.
 */
export async function serveDevBundle(name = 'web') {
  const web = join(root, 'node_modules', '.fuzz', name); // one folder per script, so a fuzz and a soak can run at once
  execFileSync('npx', ['vite', 'build', '--mode', 'development', '--outDir', web, '--emptyOutDir', '--minify', 'false', '--logLevel', 'error'], { cwd: root, stdio: 'inherit', env: { ...process.env, NODE_ENV: 'development' }, shell: process.platform === 'win32' });
  const server = await preview({ root, build: { outDir: web }, preview: { port: 0, host: '127.0.0.1' }, logLevel: 'error' });
  return { base: `http://127.0.0.1:${server.httpServer.address().port}/`, close: () => new Promise((r) => server.httpServer.close(r)) };
}
