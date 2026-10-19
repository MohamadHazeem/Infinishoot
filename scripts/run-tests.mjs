// Bundles each tests/*.test.ts with rolldown and runs it in Node.
//   npm test          -> unit tests (fast)
//   npm run smoke     -> the headless whole-game smoke test (about 2 minutes)
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const smoke = process.argv.includes('smoke');
const files = readdirSync(`${root}tests`).filter((f) => f.endsWith('.test.ts') && (smoke ? f === 'smoke.test.ts' : f !== 'smoke.test.ts'));
mkdirSync(`${root}node_modules/.tests`, { recursive: true });
let failed = 0;
for (const f of files) {
  const out = `${root}node_modules/.tests/${f.replace('.ts', '.mjs')}`;
  execFileSync('npx', ['rolldown', `tests/${f}`, '--format', 'esm', '--platform', 'node', '--external', 'jsdom', '--inline-dynamic-imports', '-o', out], { cwd: root, stdio: 'ignore', shell: process.platform === 'win32' }); // npx is npx.cmd on Windows
  console.log(`\n# ${f}`);
  try {
    // Wrapped import so a crash at load time is reported and fails the run.
    execFileSync('node', ['-e', `import(${JSON.stringify(pathToFileURL(out).href)}).catch((e) => { console.error('FAIL', e); process.exit(1); })`], { cwd: root, stdio: 'inherit' });
  } catch (error) {
    console.error(`FAIL ${f}: ${error.signal ?? `exit ${error.status}`}`);
    failed++;
  }
}
console.log(failed ? `\n${failed} test file(s) failed` : `\nAll ${files.length} test file(s) passed`);
process.exit(failed ? 1 : 0);
