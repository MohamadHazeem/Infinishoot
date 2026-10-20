/**
 * `npm run coop8` body (bundled and run by scripts/coop8.mjs): an 8-player
 * online co-op team in one Node process (tests/eightpHarness.ts: a host Game
 * and 7 client Games in jsdom, messages structured-cloned, snapshots measured
 * as PeerJS binarypack bytes). Every machine plays with the autopilot brain
 * through its own input. The run is pushed through a big horde, a boss and
 * the boss's chests while the script measures host CPU (update and snapshot
 * building) and bytes per client, and checks host-vs-client state every 4 s.
 * Fails on runtime errors, lasting desyncs or a blown snapshot budget.
 */
import { bootDom, makeTeam, summary } from '../tests/eightpHarness';

const args = process.argv.slice(2);
const opt = (k: string, d: number) => {
  const i = args.indexOf(k);
  return i >= 0 ? Number(args[i + 1]) : d;
};
const PLAYERS = Math.max(2, Math.min(8, opt('--players', 8)));
const SECONDS = opt('--seconds', 40);
const jsonOut = (() => {
  const i = args.indexOf('--json');
  return i >= 0 ? args[i + 1] : '';
})();

/**
 * Budgets (per client): average snapshot size (6 KB = 120 KB/s), the largest one (keyframes with a
 * capped 450-enemy horde are ~10 KB of enemy records alone; PeerJS chunks anything over 16 KB), and
 * host snapshot build time per client (jsdom on a loaded machine; Chromium is faster).
 */
const BUDGET = { avgBytes: 6000, maxBytes: 24000, buildMs: 3 };

const errors: string[] = [];
const origError = console.error;
process.on('uncaughtException', (e) => errors.push('uncaught ' + (e as Error).stack));
process.on('unhandledRejection', (e) => errors.push('unhandled ' + ((e as Error)?.stack ?? String(e))));
// Never "pass" silently: if the run ends without reaching its PASS/FAIL report (a thrown error that the
// handlers above swallowed, or a top-level await that never settles and lets the event loop drain), say
// so with whatever was collected and exit non-zero.
let reported = false;
process.on('exit', (code) => {
  if (reported) return;
  origError(`\nFAIL coop8: the run ended (exit ${code}) before its report` + (errors.length ? '\n' + errors.slice(0, 12).join('\n') : ' (nothing was thrown: a top-level await never settled)'));
  process.exitCode = 1;
});
console.error = (...a: unknown[]) => {
  const s = a.map(String).join(' ');
  if (/Error|TypeError|undefined/.test(s)) errors.push('console.error ' + s.slice(0, 300));
  origError(...a);
};

// Deterministic runs (bots, drops, card picks), so before/after numbers compare: mulberry32.
let seed = opt('--seed', 8) >>> 0;
Math.random = () => {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

await bootDom();
const { settings } = await import('../src/game/settings');
const { cheats, INTEREST } = await import('../src/game/game');
const { ENEMIES } = await import('../src/data/enemies');
if (args.includes('--no-stagger')) (await import('../src/game/eightp')).eightpTuning.staggerFrom = 99; // compare: every client's snapshot on the same step
settings.deathReplay = false;
settings.finishers = false;
settings.cinematics = 'off';
settings.bossIntros = false;

// COOP8_BODY=1: which snapshot body fields change most (JSON size of changed values, per snapshot).
const bodyCost: Record<string, number> = {};
let bodyN = 0;
if (process.env.COOP8_BODY) {
  const { SnapEncoder } = await import('../src/net/snapCodec');
  const last = new WeakMap<object, Record<string, string>>();
  const enc = SnapEncoder.prototype.encode;
  SnapEncoder.prototype.encode = function (this: object, body: Record<string, unknown>, recs: never, extra: never) {
    let prev = last.get(this);
    if (!prev) last.set(this, (prev = {}));
    bodyN++;
    for (const [k, v] of Object.entries(body)) {
      if (k === 'heroes') {
        (v as Record<string, unknown>[]).forEach((h, i) => {
          if (Array.isArray(h.w))
            (h.w as unknown[][]).forEach((w, k) => {
              const j = JSON.stringify(w);
              const key = `w:${w[0]}`;
              if (prev![`${key}${i}.${k}`] !== j) bodyCost[key] = (bodyCost[key] ?? 0) + j.length;
              prev![`${key}${i}.${k}`] = j;
            });
          for (const [f, x] of Object.entries(h)) {
            const j = JSON.stringify(x ?? null);
            const key = `heroes.${f}`;
            if (prev![`${key}${i}`] !== j) bodyCost[key] = (bodyCost[key] ?? 0) + j.length + 2;
            prev![`${key}${i}`] = j;
          }
        });
        continue;
      }
      const j = JSON.stringify(v ?? null);
      if (prev[k] !== j) bodyCost[k] = (bodyCost[k] ?? 0) + j.length + 2;
      prev[k] = j;
    }
    return enc.call(this, body, recs, extra);
  } as typeof enc;
}

const t0 = performance.now();
const T = await makeTeam(PLAYERS, { bots: true, renderEvery: 6 });
const { A, clients } = T;
await new Promise((r) => setTimeout(r, 0));
T.flush();
A.hostStart();
T.flush();
for (let i = 0; i < 120 && A.mode !== 'fight'; i++) T.step(1);
const log = (s: string) => console.log(`[coop8 ${((performance.now() - t0) / 1000).toFixed(0)}s] ${s}`);
log(`${PLAYERS} players: host ${A.mode}, heroes ${A.heroes.length}, clients ${clients.map((c) => c.mode + ':' + c.local).join(' ')}`);
if (A.mode !== 'fight' || clients.some((c) => c.mode !== 'fight' || c.heroes.length !== PLAYERS)) errors.push('the run did not start on every machine');
cheats.god = true; // the measurement wants a long fight, not a wipe

// Spread the team out a bit (a real 8-player team doesn't stand in one spot) and warm up.
T.step(180);
T.resetStats();

let desyncStreak = 0;
let worstDesync = '';
let checks = 0;
let bossAt = -1;
let bossKilled = false;
// Owned boss chests are counted as they drop: since coopstress, stage clear vacuums leftover chests to their owners.
const { PickupType } = await import('../src/game/pickups');
const { OWNED_CHEST } = await import('../src/game/game');
const owned = new Set<number>();
const spawn0 = A.pickups.spawn.bind(A.pickups);
(A.pickups as any).spawn = (t: number, x: number, z: number, v?: number) => {
  if (t === PickupType.Chest && v !== undefined && v >= OWNED_CHEST) owned.add(v - OWNED_CHEST);
  return (spawn0 as any)(t, x, z, v);
};
const aliveSamples: number[] = [];
const bulletSamples: number[] = [];
const steps = Math.round(SECONDS * 60);
for (let s = 0; s < steps; s++) {
  try {
    T.step(1);
  } catch (e) {
    errors.push('step ' + (e as Error).stack);
    break;
  }
  // Keep a big horde around the team (the director would ramp to it over a stage).
  if (s % 120 === 0 && A.mode === 'fight' && A.enemies.activeCount < 220) {
    const h = A.heroes[(s / 120) % A.heroes.length | 0];
    const kinds = [ENEMIES.swarmer, ENEMIES.bopper, ENEMIES.zippy, ENEMIES.blaster ?? ENEMIES.bopper];
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      A.enemies.spawn(kinds[i % kinds.length], h.player.x + Math.cos(a) * 14, h.player.z + Math.sin(a) * 14, { ...A.spawnOpts(), instant: true });
    }
  }
  if (s === Math.round(steps * 0.55)) {
    A.debugSkipToBoss();
    log('skip to the boss');
  }
  const boss = A.enemies.list.find((e) => e.active && e.def.boss);
  if (boss && bossAt < 0) {
    bossAt = s;
    log(`boss in: ${boss.def.name}`);
  }
  if (boss && bossAt >= 0 && s - bossAt === 60 * 8) {
    boss.hp = 0;
    A.killEnemy(boss, 'test', A.hero);
    bossKilled = true;
    log('boss down');
  }
  if (s % 300 === 0 && process.env.COOP8_DEBUG) log(`mode ${A.mode} screen ${A.screens.current} needs ${A.heroes.map((h) => (h.needsPick ? 1 : 0)).join('')} alive ${A.enemies.activeCount}`);
  if (s % 30 === 0) {
    aliveSamples.push(A.enemies.activeCount);
    bulletSamples.push(A.bullets.count);
  }
  // Host vs client checks every 4 s (fight only).
  if (s % 240 === 60 && A.mode === 'fight') {
    checks++;
    const bad: string[] = [];
    for (const c of clients) {
      if (c.mode !== A.mode && !(A.mode === 'fight' && c.mode === 'levelup')) bad.push(`P${c.local + 1} mode ${c.mode} vs ${A.mode}`);
      const mine = A.heroes[c.local];
      const own = Math.hypot(mine.player.x - c.player.x, mine.player.z - c.player.z);
      if (own > 3) bad.push(`P${c.local + 1} own hero ${own.toFixed(1)} m off`);
      for (let i = 0; i < A.heroes.length; i++) {
        if (i === c.local || A.heroes[i].left) continue;
        const d = Math.hypot(A.heroes[i].player.x - c.heroes[i].player.x, A.heroes[i].player.z - c.heroes[i].player.z);
        if (d > 4) bad.push(`P${c.local + 1} sees P${i + 1} ${d.toFixed(1)} m off`);
      }
      const near = A.enemies.list.filter((e) => e.active && Math.abs(e.x - mine.player.x) < INTEREST && Math.abs(e.z - mine.player.z) < INTEREST).length;
      const mirrored = c.netEnemies.size;
      if (Math.abs(near - mirrored) > Math.max(12, near * 0.25)) bad.push(`P${c.local + 1} enemies ${mirrored} vs host ${near}`);
    }
    if (bad.length) {
      desyncStreak++;
      worstDesync = bad.slice(0, 4).join('; ');
      log(`check ${checks}: ${bad.length} mismatches (${worstDesync})`);
      if (desyncStreak >= 2) errors.push(`lasting desync: ${worstDesync}`);
    } else {
      desyncStreak = 0;
      if (checks % 2 === 0) log(`check ${checks}: ok (alive ${A.enemies.activeCount}, bullets ${A.bullets.count}, mode ${A.mode}, stage ${A.stage})`);
    }
  }
}


const per = [...T.stats.snapBytes.entries()].map(([id, l]) => ({ id, n: l.length, ...summary(l) }));
const all = summary([...T.stats.snapBytes.values()].flat());
const host = summary(T.stats.hostMs);
const build = summary(T.stats.snapMs);
const perStep = summary(T.stats.snapStepMs);
function summaryQ(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length * q)] : 0;
}
const simSeconds = T.stats.hostMs.length / 60;
const report = {
  players: PLAYERS,
  simSeconds: Math.round(simSeconds),
  wallSeconds: Math.round((performance.now() - t0) / 1000),
  hostUpdateMs: { avg: +host.avg.toFixed(2), p95: +host.p95.toFixed(2), max: +host.max.toFixed(1) },
  snapshotMsPerHostStep: { avg: +perStep.avg.toFixed(2), p50: +perStep.p50.toFixed(2), p90: +summaryQ(T.stats.snapStepMs, 0.9).toFixed(2), p95: +perStep.p95.toFixed(2), max: +perStep.max.toFixed(1) },
  snapshotBuildMsPerClient: { avg: +build.avg.toFixed(3), p95: +build.p95.toFixed(3), max: +build.max.toFixed(2) },
  snapshotBytesPerClient: { avg: Math.round(all.avg), p95: all.p95, max: all.max },
  kBpsPerClient: +(per.reduce((a, p) => a + p.avg * p.n, 0) / Math.max(1, per.length) / Math.max(1, simSeconds) / 1024).toFixed(1),
  otherDownKBps: +(T.stats.otherBytes / Math.max(1, simSeconds) / 1024).toFixed(1),
  upKBpsTotal: +(T.stats.upBytes / Math.max(1, simSeconds) / 1024).toFixed(1),
  enemiesAlive: summary(aliveSamples),
  bullets: summary(bulletSamples),
  bytesByField: Object.fromEntries(Object.entries(T.stats.parts).map(([k, v]) => [k, Math.round(v / Math.max(1, [...T.stats.snapBytes.values()].flat().length))])),
  biggestSnapshot: T.stats.biggest,
  checks,
  bossKilled,
  ownedChests: owned.size,
  perClient: per.map((p) => ({ id: p.id, snaps: p.n, avg: Math.round(p.avg), max: p.max })),
};
console.log(JSON.stringify(report, null, 1));
if (bodyN) console.log('body JSON bytes changed per snapshot:', Object.entries(bodyCost).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => `${k} ${(v / bodyN).toFixed(0)}`).join(', '));
if (jsonOut) (await import('node:fs')).writeFileSync(jsonOut, JSON.stringify(report, null, 1));

if (all.avg > BUDGET.avgBytes) errors.push(`average snapshot ${Math.round(all.avg)} B over the ${BUDGET.avgBytes} B budget`);
if (all.max > BUDGET.maxBytes) errors.push(`largest snapshot ${all.max} B over ${BUDGET.maxBytes} B`);
if (build.avg > BUDGET.buildMs) errors.push(`snapshot build ${build.avg.toFixed(2)} ms per client over ${BUDGET.buildMs} ms`);
if (bossKilled && owned.size < PLAYERS) errors.push(`only ${owned.size} owned boss chests for ${PLAYERS} heroes`);
if (!checks) errors.push('no host-vs-client checks ran');
reported = true;
if (errors.length) {
  console.log(`\nFAIL coop8: ${errors.length} problem(s)\n` + errors.slice(0, 12).join('\n'));
  process.exit(1);
}
console.log(`\nPASS coop8: ${PLAYERS} players, ${checks} state checks, ${Math.round(all.avg)} B per snapshot per client`);
process.exit(0);
