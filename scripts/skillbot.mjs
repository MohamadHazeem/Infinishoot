// Serial, fresh-process samples keep profile unlocks, pools, timers and RNG streams isolated.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

async function sample(seed, difficulty, seconds) {
  const { dom, jsdomErrors, seedRandom, simTimers } = await import('../tests/jsdomEnv.ts');
  dom.reconfigure({ url: 'http://localhost/?season=off' });
  seedRandom(seed);
  simTimers.install();
  const { Input } = await import('../src/core/input.ts');
  const { Game } = await import('../src/game/game.ts');
  const { installBot } = await import('../src/dev/bot.ts');
  const { settings } = await import('../src/game/settings.ts');
  const { DIFFICULTIES } = await import('../src/data/modes.ts');
  if (!DIFFICULTIES.some((d) => d.id === difficulty && !d.coopOnly))
    throw new Error('Unknown solo difficulty: ' + difficulty);
  settings.difficulty = difficulty;
  settings.hero = 'rookie';
  settings.pet = 'none';
  settings.cinematics = 'off';
  // jsdom has no layout boxes. Skip measuring HUD docks and scroll cues,
  // and keep the document's id-anchored selectors local to the requested subtree.
  const { HudDock } = await import('../src/ui/hudLayout.ts');
  const { MoreCue } = await import('../src/ui/menuFit.ts');
  HudDock.prototype.tick = () => {};
  MoreCue.prototype.watch = () => {};
  const queryAll = document.querySelectorAll.bind(document);
  document.querySelectorAll = (selector) => {
    const match = /^#([\w-]+) (.+)$/.exec(selector);
    if (match && !selector.includes(',')) {
      const root = document.getElementById(match[1]);
      if (root) return root.querySelectorAll(':scope ' + match[2]);
    }
    return queryAll(selector);
  };
  const input = new Input(document.getElementById('game'));
  const game = new Game(
    input,
    16 / 9,
    document.getElementById('hud'),
    document.getElementById('reticle'),
  );
  installBot(game, input);
  // Clock-dependent combat (e.g. music beats) should see simulation time.
  // Keep the real clock for the runner's CPU measurements outside update.
  Object.defineProperty(window.performance, 'now', {
    configurable: true,
    value: performance.now.bind(performance),
  });
  Object.defineProperty(performance, 'now', { configurable: true, value: () => simTimers.now });
  const update = game.update;
  game.update = function (dt) {
    simTimers.advance(dt * 1000);
    update.call(this, dt);
  };
  game.startRun({ seed, difficulty });
  const result = window.skillRun(seconds);
  if (jsdomErrors.length) throw new Error(jsdomErrors.join('\n'));
  return result;
}

function summarize(results) {
  const n = results.length;
  const reached = results.map((r) => r.stageReached).sort((a, b) => a - b);
  const deaths = new Map();
  for (const r of results)
    if (r.died) deaths.set(r.causeOfDeath, (deaths.get(r.causeOfDeath) ?? 0) + 1);
  return {
    runs: n,
    stageClearPct: [1, 2, 3, 4].map(
      (stage) => (100 * results.filter((r) => r.clearedStages.includes(stage)).length) / n,
    ),
    loopClearPct: (100 * results.filter((r) => r.loopCleared).length) / n,
    medianStage: (reached[(n - 1) >> 1] + reached[n >> 1]) / 2,
    meanRunSeconds: Math.round((results.reduce((s, r) => s + r.runSeconds, 0) / n) * 10) / 10,
    incomplete: results.filter((r) => !r.loopCleared && !r.died).length,
    topCauses: [...deaths].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5),
  };
}

async function main() {
  const { values } = parseArgs({
    options: {
      runs: { type: 'string', default: '20' },
      seed: { type: 'string', default: '1' },
      difficulty: { type: 'string', default: 'normal' },
      jsdom: { type: 'boolean' },
      seconds: { type: 'string', default: '2100' },
    },
  });
  const runs = Number(values.runs),
    first = Number(values.seed),
    seconds = Number(values.seconds);
  if (
    !Number.isSafeInteger(runs) ||
    runs < 1 ||
    !Number.isSafeInteger(first) ||
    first < 0 ||
    first + runs - 1 > 0xffffffff ||
    !(seconds > 0 && Number.isFinite(seconds))
  )
    throw new Error('Invalid runs, seed or seconds');
  const difficulties =
    values.difficulty === 'all' ? ['hard', 'normal', 'easy'] : [values.difficulty];
  const root = fileURLToPath(new URL('..', import.meta.url));
  process.chdir(root);
  const tmp = mkdtempSync(join(root, 'node_modules', '.skillbot-'));
  const runner = join(tmp, 'runner.mjs');
  const date = new Date().toISOString().slice(0, 10);
  const report = {
    date,
    firstSeed: first,
    secondsCap: seconds,
    requestedRunsPerDifficulty: runs,
    difficulties,
    hero: 'rookie',
    season: 'off',
    pet: 'none',
    results: [],
    summary: {},
  };
  const path = `notes/perf/skillbot-${date}.json`;
  mkdirSync('notes/perf', { recursive: true });
  try {
    const { rolldown } = await import('rolldown');
    const bundle = await rolldown({
      input: fileURLToPath(import.meta.url),
      platform: 'node',
      external: ['jsdom', 'rolldown'],
    });
    await bundle.write({ file: runner, format: 'esm', codeSplitting: false });
    await bundle.close();
    for (const difficulty of difficulties) {
      for (let i = 0; i < runs; i++) {
        const stdout = execFileSync(
          process.execPath,
          [runner, '--sample', String(first + i), difficulty, String(seconds)],
          { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 8 * 1024 * 1024 },
        );
        const line = stdout.split('\n').findLast((l) => l.startsWith('SKILLRESULT '));
        if (!line) throw new Error('Missing sample result for seed ' + (first + i));
        const r = JSON.parse(line.slice(12));
        report.results.push(r);
        report.summary[difficulty] = summarize(
          report.results.filter((row) => row.difficulty === difficulty),
        );
        // Publish complete samples as they finish. An interrupted sweep retains
        // its exact measured denominators and the requested cohort size.
        const checkpoint = path + '.' + process.pid + '.tmp';
        writeFileSync(checkpoint, JSON.stringify(report, null, 2) + '\n');
        renameSync(checkpoint, path);
        console.log(
          `${difficulty} ${i + 1}/${runs} seed ${r.seed}  stage ${r.stage}  ${r.loopCleared ? 'loop clear' : (r.causeOfDeath ?? 'incomplete (' + r.mode + ')')}  ${r.runSeconds}s`,
        );
      }
    }
    console.table(
      Object.entries(report.summary).map(([difficulty, s]) => ({
        difficulty,
        runs: s.runs,
        'clear % S1/S2/S3/S4': s.stageClearPct.join('/'),
        'loop %': s.loopClearPct,
        'median stage': s.medianStage,
        'mean game s': s.meanRunSeconds,
        incomplete: s.incomplete,
        'top deaths': s.topCauses.map(([id, n]) => id + ' ' + n).join(', '),
      })),
    );
    console.log(path);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (process.argv[2] === '--sample') {
  const r = await sample(Number(process.argv[3]), process.argv[4], Number(process.argv[5]));
  console.log('SKILLRESULT ' + JSON.stringify(r));
} else {
  await main();
}
