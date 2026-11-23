// Bundles each tests/*.test.ts with rolldown and runs it in Node.
//   npm test          -> unit tests, several files at once (TEST_JOBS=n to change, TEST_JOBS=1 for one at a time)
//   npm run smoke     -> the headless whole-game smoke test (about 2 minutes)
// A file that fails while others run beside it is run once more on its own, so a timing failure on a loaded
// machine is told apart from a real one; such files are listed as "passed on retry".
import { execFile } from 'node:child_process';
import { mkdirSync, readdirSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const smoke = process.argv.includes('smoke');
const only = process.argv.slice(2).filter((a) => a !== 'smoke');
const files = readdirSync(`${root}tests`).filter(
  (f) =>
    f.endsWith('.test.ts') &&
    (smoke ? f === 'smoke.test.ts' : f !== 'smoke.test.ts') &&
    (!only.length || only.some((o) => f.includes(o))),
);
const jobs = Math.max(1, Number(process.env.TEST_JOBS) || Math.max(2, Math.floor(availableParallelism() / 2)));
mkdirSync(`${root}node_modules/.tests`, { recursive: true });

const sh = process.platform === 'win32'; // npx is npx.cmd on Windows
function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd: root, shell: sh, maxBuffer: 64 << 20 }, (error, stdout, stderr) =>
      resolve({ error, output: stdout + stderr }),
    );
  });
}

async function runFile(f) {
  const out = `${root}node_modules/.tests/${f.replace('.ts', '.mjs')}`;
  const bundled = await run('npx', ['rolldown', `tests/${f}`, '--format', 'esm', '--platform', 'node', '--external', 'jsdom', '--inline-dynamic-imports', '-o', out]);
  if (bundled.error) return { ok: false, output: bundled.output, why: 'bundle failed' };
  // Wrapped import so a crash at load time is reported and fails the run.
  const r = await run('node', ['-e', `import(${JSON.stringify(pathToFileURL(out).href)}).catch((e) => { console.error('FAIL', e); process.exit(1); })`]);
  return { ok: !r.error, output: r.output, why: r.error ? (r.error.signal ?? `exit ${r.error.code}`) : '' };
}

const failed = [];
let next = 0;
async function worker() {
  while (next < files.length) {
    const f = files[next++];
    const r = await runFile(f);
    process.stdout.write(`\n# ${f}\n${r.output}`);
    if (!r.ok) {
      if (jobs > 1) console.error(`(failed beside other tests: ${r.why}; will retry alone)`);
      else console.error(`FAIL ${f}: ${r.why}`);
      failed.push(f);
    }
  }
}
await Promise.all(Array.from({ length: Math.min(jobs, files.length) }, worker));

let still = failed;
const retried = [];
if (jobs > 1 && failed.length) {
  still = [];
  for (const f of failed) {
    const r = await runFile(f);
    process.stdout.write(`\n# ${f} (retry alone)\n${r.output}`);
    if (r.ok) retried.push(f);
    else {
      console.error(`FAIL ${f}: ${r.why}`);
      still.push(f);
    }
  }
}
if (retried.length) console.log(`\nPassed on retry (failed only beside other tests): ${retried.join(', ')}`);
console.log(still.length ? `\n${still.length} test file(s) failed: ${still.join(', ')}` : `\nAll ${files.length} test file(s) passed`);
process.exit(still.length ? 1 : 0);
