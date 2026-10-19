// 8-player co-op check (eightp lane): host + 7 clients as in-process Node/jsdom peers
// (8 Chromium pages are too heavy for one machine; `npm run coop` keeps the real
// two-browser WebRTC check). Measures host CPU and snapshot bytes per client and
// fails on runtime errors, lasting desyncs or a blown snapshot budget.
//   npm run coop8                         8 players, 40 simulated seconds
//   npm run coop8 -- --players 4          compare with a 4-player team
//   npm run coop8 -- --seconds 90 --json shots/coop8.json
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
mkdirSync(`${root}node_modules/.tests`, { recursive: true });
const out = `${root}node_modules/.tests/coop8-run.mjs`;
execFileSync('npx', ['rolldown', 'scripts/coop8-run.ts', '--format', 'esm', '--platform', 'node', '--external', 'jsdom', '--inline-dynamic-imports', '-o', out], { cwd: root, stdio: 'ignore', shell: process.platform === 'win32' });
try {
  execFileSync('node', [out, ...process.argv.slice(2)], { cwd: root, stdio: 'inherit' });
} catch {
  process.exit(1);
}
