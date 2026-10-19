// Balance sweep: `npm run sweep [-- options]`.
// Runs the dev autoplay bot headlessly (jsdom, scripts/balance/sweepRunner.ts)
// across loadout kits, heroes and difficulties, god and mortal, in parallel
// child processes, then writes notes/balance/sweep-<date>[-tag].md and .json.
//
// Options:
//   --sets=bench,herobench,kits,mortal,heroes,diff   which matrices to run (default: all)
//                                    bench: straight to each loop-1 boss with the kit at fixed ranks
//                                    (st1 3, st2 5, st3 7, st4 9 + each evolution), no autos/Mods/ult;
//                                    herobench: the same for every hero with the default kit, ultimate on
//                                    mortal runs dash through boss shockwave rings (the bot alone doesn't)
//   --seeds=2                        seeds per config (mortal runs get one more)
//   --jobs=8                         parallel processes
//   --secs=1500                      simulated-second cap per run
//   --stages=4                       stage clears per run (4 = one loop, ends with Omega)
//   --tag=before                     suffix for the output files
//   --kits=rail/charge/bomb,...      only these kits (left/right/special) in the kit sets
//   --quick                          1 seed, kits + mortal only
//   --from=file.json                 rebuild the report from a saved JSON without running
//   --merge=file.json                keep that file's results for the sets not run now
//   --append=file.json               keep all of that file's results and add these (use with --seed0)
//   --seed0=3                        first seed (default 1), to add seeds to an earlier sweep
//   --bundle=out.mjs                 only bundle the runner (to compare against older data later)
//   --runner=out.mjs                 run with a runner bundled earlier instead of the current source
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? '1'];
  }),
);
const quick = !!args.quick;
const seeds = Number(args.seeds ?? (quick ? 1 : 2));
const seed0 = Number(args.seed0 ?? 1);
const jobs = Number(args.jobs ?? Math.max(2, Math.min(10, Math.floor(cpus().length / 2))));
const secs = Number(args.secs ?? 1500);
const stages = Number(args.stages ?? 4);
const sets = (args.sets ?? (quick ? 'bench' : 'bench,herobench,kits,mortal,heroes,diff')).split(',');
const date = new Date().toISOString().slice(0, 10);
const tag = args.tag ? `-${args.tag}` : '';

const PRIMARY = ['buster', 'scatter', 'laser', 'orb', 'rail'];
const SECONDARY = ['charge', 'grenade', 'well', 'shield', 'orbital'];
const SPECIAL = ['bomb', 'storm', 'blizzard', 'meteor', 'blackhole'];
const HEROES = ['rookie', 'bulwark', 'dash', 'ace', 'duelist', 'furnace', 'twin'];
const DEF = ['buster', 'charge', 'bomb'];
const BENCH = [{ stage: 1, ranks: 3 }, { stage: 2, ranks: 5 }, { stage: 3, ranks: 7 }, { stage: 4, ranks: 9, evo: 0 }, { stage: 4, ranks: 9, evo: 1 }];
const QUEEN = 'st3r7';
const ITEM_SRC = { buster: ['buster'], scatter: ['scatter'], laser: ['laser'], orb: ['orb'], rail: ['rail'], charge: ['charge'], grenade: ['grenade'], well: ['well'], shield: ['shield'], orbital: ['orbital'], bomb: ['bomb'], storm: ['storm'], blizzard: ['blizzard', 'shatter'], meteor: ['meteor'], blackhole: ['blackhole'] };

/** Kits: each item in the default kit, plus a Latin square (every left x right pair once, specials rotated so every left x special and right x special pair shows up once too). */
function kitList() {
  const out = new Map();
  const put = (k) => out.set(k.join('/'), k);
  put(DEF);
  for (const p of PRIMARY) put([p, DEF[1], DEF[2]]);
  for (const s of SECONDARY) put([DEF[0], s, DEF[2]]);
  for (const s of SPECIAL) put([DEF[0], DEF[1], s]);
  for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) put([PRIMARY[i], SECONDARY[j], SPECIAL[(i + j) % 5]]);
  let kits = [...out.values()];
  if (args.kits) {
    const only = args.kits.split(',');
    kits = kits.filter((k) => only.includes(k.join('/')));
    for (const k of only) if (!kits.some((x) => x.join('/') === k)) kits.push(k.split('/'));
  }
  return kits;
}

function configs() {
  const cfgs = [];
  const add = (set, kit, hero, diff, god, n = seeds) => {
    for (let s = seed0; s < seed0 + n; s++) cfgs.push({ set, id: `${set}:${kit.join('/')}:${hero}:${diff}:${god ? 'god' : 'mortal'}:${s}`, kit, hero, diff, god, seed: s, secs, stages });
  };
  const kits = kitList();
  if (sets.includes('bench'))
    for (const k of kits)
      for (const b of BENCH)
        for (let s = seed0; s < seed0 + seeds; s++) cfgs.push({ set: 'bench', id: `bench:${k.join('/')}:st${b.stage}r${b.ranks}${b.evo ?? ''}:${s}`, kit: k, hero: 'rookie', diff: 'normal', god: true, seed: s, secs: 300, stages: 9, bench: b });
  // Hero bench: the default kit at bench ranks, ultimate on (each hero's ultimate is part of the hero).
  if (sets.includes('herobench'))
    for (const hero of HEROES)
      for (const b of BENCH)
        for (let s = seed0; s < seed0 + seeds + 1; s++) cfgs.push({ set: 'herobench', id: `herobench:${hero}:st${b.stage}r${b.ranks}${b.evo ?? ''}:${s}`, kit: DEF, hero, diff: 'normal', god: true, seed: s, secs: 300, stages: 9, bench: { ...b, ult: true } });
  if (sets.includes('kits')) for (const k of kits) add('kits', k, 'rookie', 'normal', true);
  if (sets.includes('mortal')) for (const k of kits) add('mortal', k, 'rookie', 'normal', false, seeds + 1);
  if (sets.includes('heroes')) for (const h of HEROES) for (const god of [true, false]) add('heroes', DEF, h, 'normal', god);
  if (sets.includes('diff'))
    for (const k of [DEF, ['scatter', 'grenade', 'storm'], ['laser', 'well', 'meteor']])
      for (const d of ['easy', 'normal', 'hard']) for (const god of [true, false]) add('diff', k, 'rookie', d, god);
  return cfgs;
}

function bundle() {
  if (args.runner) return args.runner;
  mkdirSync(`${root}node_modules/.sweep`, { recursive: true });
  const out = args.bundle ?? `${root}node_modules/.sweep/runner-${process.pid}.mjs`; // per sweep, so two sweeps can run at once
  execFileSync('npx', ['rolldown', 'scripts/balance/sweepRunner.ts', '--format', 'esm', '--platform', 'node', '--external', 'jsdom', '--inline-dynamic-imports', '-o', out], { cwd: root, stdio: 'ignore', shell: process.platform === 'win32' });
  return out;
}

function runOne(runner, cfg) {
  return new Promise((resolve) => {
    const p = spawn('node', [runner], { cwd: root, env: { ...process.env, SWEEP_CFG: JSON.stringify(cfg) } });
    let buf = '';
    let err = '';
    p.stdout.on('data', (d) => (buf += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => {
      const line = buf.split('\n').find((l) => l.startsWith('@@SWEEP '));
      if (line) resolve({ ...JSON.parse(line.slice(8)), set: cfg.set });
      else resolve({ ...cfg, error: `exit ${code}: ${err.split('\n').slice(0, 6).join(' | ')}` });
    });
  });
}

async function runAll(cfgs) {
  const runner = bundle();
  const results = [];
  let next = 0;
  let done = 0;
  const t0 = Date.now();
  const worker = async () => {
    while (next < cfgs.length) {
      const cfg = cfgs[next++];
      const r = await runOne(runner, cfg);
      results.push(r);
      done++;
      const eta = Math.round(((Date.now() - t0) / done) * (cfgs.length - done) / 1000);
      process.stdout.write(`\r[${done}/${cfgs.length}] ${cfg.id}${r.error ? ' ERROR' : ''} (eta ${eta}s)          `);
    }
  };
  await Promise.all(Array.from({ length: jobs }, worker));
  process.stdout.write('\n');
  return results;
}

// ---------------------------------------------------------------- analysis
const med = (a) => {
  const v = a.filter((x) => x != null && !Number.isNaN(x)).sort((x, y) => x - y);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const geo = (a) => (a.length ? Math.exp(a.reduce((x, y) => x + Math.log(y), 0) / a.length) : null);
const f1 = (x) => (x == null ? '-' : Number(x).toFixed(1));
const f0 = (x) => (x == null ? '-' : String(Math.round(x)));
const BOSSES = ['King Bopper', 'Rampage Rex', 'Hive Queen', 'Omega Overlord'];
const SHORT = { 'King Bopper': 'King', 'Rampage Rex': 'Rex', 'Hive Queen': 'Queen', 'Omega Overlord': 'Omega' };

/** Boss kill time (vulnerable seconds) per kit and boss, medians over seeds; only killed bosses. */
function bossTable(rows) {
  const by = new Map();
  for (const r of rows) {
    const k = r.kit.join('/') + (r.hero !== 'rookie' ? ` (${r.hero})` : '') + (r.diff !== 'normal' ? ` [${r.diff}]` : '');
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(r);
  }
  const out = [];
  for (const [k, rs] of by) {
    const b = {};
    for (const n of BOSSES) b[n] = med(rs.flatMap((r) => r.bosses.filter((x) => x.name === n && x.killed && x.stage <= 4).map((x) => x.vuln)));
    out.push({ key: k, kit: rs[0].kit, hero: rs[0].hero, diff: rs[0].diff, rows: rs, boss: b });
  }
  // Speed index: geometric mean over bosses of (median kit time / this kit's time); >1 = faster than the median kit.
  const medBoss = {};
  for (const n of BOSSES) medBoss[n] = med(out.map((o) => o.boss[n]));
  for (const o of out) {
    const ratios = BOSSES.filter((n) => o.boss[n] && medBoss[n]).map((n) => medBoss[n] / o.boss[n]);
    o.index = geo(ratios);
  }
  return { list: out, medBoss };
}

function stageCols(rs, f) {
  return [1, 2, 3, 4].map((s) => {
    const v = rs.map((r) => r.stages.find((x) => x.stage === s)).filter(Boolean).map(f);
    return med(v);
  });
}

function topSources(rs, n = 5, field = 'dps') {
  const tot = {};
  for (const r of rs) for (const [k, v] of Object.entries(r[field] ?? {})) tot[k] = (tot[k] ?? 0) + v / rs.length;
  const sum = Object.values(tot).reduce((a, b) => a + b, 0) || 1;
  return Object.entries(tot)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, v]) => `${k} ${Math.round((v / sum) * 100)}%`)
    .join(', ');
}

function report(results) {
  const L = [];
  const ok = results.filter((r) => !r.error);
  const errs = results.filter((r) => r.error);
  L.push(`# Balance sweep ${date}${tag}`, '');
  L.push(`Generated by \`npm run sweep\` (scripts/balance-sweep.mjs). ${results.length} runs (${errs.length} errors); seeds per config: ${[...new Set(results.map((r) => r.set))].map((st) => `${st} ${new Set(results.filter((r) => r.set === st).map((r) => r.seed)).size}`).join(', ')}; cap ${secs} s / ${stages} stages. Dev bot (src/dev/bot.ts + src/game/autopilot.ts): kites, picks the first card, buys Mods left to right. Boss times are **vulnerable seconds** (entrance and phase roars excluded), medians over seeds, killed bosses of loop 1 only. Speed index = geometric mean over bosses of (median kit time / kit time): 1.00 is the median kit, 2.00 kills bosses twice as fast. Fair band 0.63-1.60.`, '');
  if (errs.length) {
    L.push('## Errors', '');
    for (const e of errs) L.push(`- ${e.id}: ${e.error}`);
    L.push('');
  }
  const bench = ok.filter((r) => r.set === 'bench');
  if (bench.length) {
    const bkey = (r) => `st${r.bench.stage}r${r.bench.ranks}${r.bench.evo ?? ''}`;
    const cols = BENCH.map((b) => `st${b.stage}r${b.ranks}${b.evo ?? ''}`);
    const kits = [...new Set(bench.map((r) => r.kit.join('/')))];
    const t = (k, c) => med(bench.filter((r) => r.kit.join('/') === k && bkey(r) === c && r.bosses[0]?.killed).map((r) => r.bosses[0].vuln));
    const medCol = Object.fromEntries(cols.map((c) => [c, med(kits.map((k) => t(k, c)))]));
    const rows = kits.map((k) => {
      const ratios = cols.filter((c) => c !== QUEEN).map((c) => (t(k, c) && medCol[c] ? medCol[c] / t(k, c) : null)).filter(Boolean);
      return { k, idx: geo(ratios), times: cols.map((c) => t(k, c)), fails: bench.filter((r) => r.kit.join('/') === k && !r.bosses[0]?.killed).length };
    });
    rows.sort((a, b) => b.idx - a.idx);
    L.push('## Boss bench (kit only: fixed ranks, no auto weapons, Mods, ultimate, mech, crates, cash-ins; god)', '');
    L.push(`Each run starts at the stage's boss with every loadout item at the same ranks (round-robin over its tracks; stage 4 adds evolution 0 or 1). Vulnerable seconds to kill, median of the seeds. Columns: King st1 (3 ranks), Rex st2 (5), Queen st3 (7), Omega st4 (9 + evo 1st / 2nd). The index leaves the Queen out: with a kit alone her hives heal about as fast as it hurts her, so her times swing between a fast kill and a long heal race (full runs, with auto weapons and Mods, don't have that problem).`, '');
    L.push(`Median kit: ${cols.map((c) => `${c} ${f1(medCol[c])}`).join(', ')}.`, '');
    L.push(`| kit | index | ${cols.join(' | ')} | not killed in 300 s |`, `|---|---|${cols.map(() => '---').join('|')}|---|`);
    for (const r of rows) L.push(`| ${r.k} | ${r.idx ? r.idx.toFixed(2) : '-'}${r.idx && (r.idx > 1.6 || r.idx < 0.625) ? ' **!**' : ''} | ${r.times.map(f1).join(' | ')} | ${r.fails || ''} |`);
    L.push('');
    const idx = rows.map((r) => r.idx).filter(Boolean);
    L.push(`Kits in the fair band (0.63-1.60): ${idx.filter((x) => x <= 1.6 && x >= 0.625).length}/${idx.length}. Spread (max/min): ${(Math.max(...idx) / Math.min(...idx)).toFixed(2)}.`, '');
    L.push('### Item main effects in the bench (geometric mean index of the kits holding it)', '');
    L.push('| slot | item | kits | index | min | max | own boss DPS st1 / st2 / st3 / st4 evo1 / st4 evo2 |', '|---|---|---|---|---|---|---|');
    for (const [slot, items, i] of [['left', PRIMARY, 0], ['right', SECONDARY, 1], ['special', SPECIAL, 2]])
      for (const it of items) {
        const v = rows.filter((r) => r.k.split('/')[i] === it && r.idx).map((r) => r.idx);
        if (!v.length) continue;
        const dps = cols.map((c) => med(bench.filter((r) => r.kit[i] === it && bkey(r) === c && r.bosses[0]?.killed).map((r) => ITEM_SRC[it].reduce((a, src) => a + (r.bosses[0].dmg[src] ?? 0), 0) / Math.max(1, r.bosses[0].vuln))));
        L.push(`| ${slot} | ${it} | ${v.length} | ${geo(v).toFixed(2)} | ${Math.min(...v).toFixed(2)} | ${Math.max(...v).toFixed(2)} | ${dps.map(f0).join(' / ')} |`);
      }
    L.push('');
  }
  const hb = ok.filter((r) => r.set === 'herobench');
  if (hb.length) {
    const bkey = (r) => `st${r.bench.stage}r${r.bench.ranks}${r.bench.evo ?? ''}`;
    const cols = BENCH.map((b) => `st${b.stage}r${b.ranks}${b.evo ?? ''}`);
    const t = (h, c) => med(hb.filter((r) => r.hero === h && bkey(r) === c && r.bosses[0]?.killed).map((r) => r.bosses[0].vuln));
    const medCol = Object.fromEntries(cols.map((c) => [c, med(HEROES.map((h) => t(h, c)))]));
    L.push('## Hero bench (default kit at bench ranks, ultimate on, god)', '');
    L.push(`| hero | index | ${cols.join(' | ')} | top boss damage sources |`, `|---|---|${cols.map(() => '---').join('|')}|---|`);
    for (const h of HEROES) {
      const ratios = cols.filter((c) => c !== QUEEN).map((c) => (t(h, c) && medCol[c] ? medCol[c] / t(h, c) : null)).filter(Boolean);
      const rs = hb.filter((r) => r.hero === h && r.bosses[0]);
      const tot = {};
      for (const r of rs) for (const [k, v] of Object.entries(r.bosses[0].dmg)) tot[k] = (tot[k] ?? 0) + v;
      const sum = Object.values(tot).reduce((a, b) => a + b, 0) || 1;
      const top = Object.entries(tot).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k} ${Math.round((v / sum) * 100)}%`).join(', ');
      const idx = geo(ratios);
      L.push(`| ${h} | ${idx ? idx.toFixed(2) : '-'}${idx && (idx > 1.6 || idx < 0.625) ? ' **!**' : ''} | ${cols.map((c) => f1(t(h, c))).join(' | ')} | ${top} |`);
    }
    L.push('');
  }
  const god = ok.filter((r) => r.set === 'kits');
  if (god.length) {
    const { list, medBoss } = bossTable(god);
    list.sort((a, b) => (b.index ?? 0) - (a.index ?? 0));
    L.push('## Kits, god bot, Medium, Rookie', '');
    L.push(`Median kit: ${BOSSES.map((n) => `${SHORT[n]} ${f1(medBoss[n])} s`).join(', ')}.`, '');
    L.push('| kit (left/right/special) | index | King | Rex | Queen | Omega | level st1-4 | loadout ranks st1-4 | first evo | gold | top DPS sources (run) | boss damage sources |');
    L.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
    for (const o of list) {
      const lv = stageCols(o.rows, (x) => x.level).map(f0).join('/');
      const rk = stageCols(o.rows, (x) => x.ranks).map(f0).join('/');
      const evo = o.rows.map((r) => (r.firstEvo ? r.firstEvo.split(' ')[0] : '-')).join(' ');
      const flag = o.index && (o.index > 1.6 || o.index < 0.625) ? ' **!**' : '';
      L.push(`| ${o.key} | ${o.index ? o.index.toFixed(2) : '-'}${flag} | ${BOSSES.map((n) => f1(o.boss[n])).join(' | ')} | ${lv} | ${rk} | ${evo} | ${f0(med(o.rows.map((r) => r.goldEarned)))} | ${topSources(o.rows)} | ${topSources(o.rows, 4, 'bossDmg')} |`);
    }
    L.push('');
    // Main effects: mean index of kits holding each item.
    L.push('### Item main effects (mean speed index of every kit holding the item)', '');
    L.push('| slot | item | kits | mean index | min | max |', '|---|---|---|---|---|---|');
    for (const [slot, items, i] of [['left', PRIMARY, 0], ['right', SECONDARY, 1], ['special', SPECIAL, 2]]) {
      for (const it of items) {
        const v = list.filter((o) => o.kit[i] === it && o.index).map((o) => o.index);
        if (!v.length) continue;
        L.push(`| ${slot} | ${it} | ${v.length} | ${geo(v).toFixed(2)} | ${Math.min(...v).toFixed(2)} | ${Math.max(...v).toFixed(2)} |`);
      }
    }
    L.push('');
    const idx = list.map((o) => o.index).filter(Boolean);
    const inBand = idx.filter((x) => x <= 1.6 && x >= 0.625).length;
    L.push(`Kits in the fair band: ${inBand}/${idx.length}. Spread (max/min index): ${(Math.max(...idx) / Math.min(...idx)).toFixed(2)}.`, '');
    // Milestone 11 systems.
    const lane = (k) => mean(god.map((r) => r.lane[k]));
    L.push('### Milestone 11 systems (god kit runs, mean per run)', '');
    L.push(`Mechs ${f1(lane('mechs'))} (${f0(lane('mechT'))} s piloted), super weapons ${f1(lane('supers'))}, cash-ins ${f1(lane('cashIns'))}, mutant kills ${f0(lane('mutantKills'))}, overloads ${f1(lane('overloads'))}, comeback ${f0(lane('comebackT'))} s. Relics per run ${f1(mean(god.map((r) => r.relics.length)))}; gold earned ${f0(mean(god.map((r) => r.goldEarned)))}.`, '');
    const share = (srcs, field) => {
      let a = 0;
      let t = 0;
      for (const r of god) for (const [k, v] of Object.entries(r[field] ?? {})) {
        t += v;
        if (srcs.includes(k)) a += v;
      }
      return t ? ((a / t) * 100).toFixed(1) + '%' : '-';
    };
    const groups = {
      'mech (cannons, missiles, stomp, eject)': ['mech', 'mech_eject'],
      'super weapons': ['minigun', 'railgun', 'flamer'],
      'combo cash-in bomb': ['cashbomb'],
      'relics (gameplay lane)': ['r_dashfire', 'r_orbit', 'r_nova', 'r_keg'],
      'hero ultimate': ['ult'],
      overload: ['overload'],
      parry: ['parry'],
    };
    L.push('| source group | share of all damage | share of boss damage |', '|---|---|---|');
    for (const [g, s] of Object.entries(groups)) L.push(`| ${g} | ${share(s, 'dps')} | ${share(s, 'bossDmg')} |`);
    L.push('');
  }
  const mortal = ok.filter((r) => r.set === 'mortal');
  if (mortal.length) {
    L.push('## Kits, mortal bot, Medium, Rookie', '');
    const by = new Map();
    for (const r of mortal) {
      const k = r.kit.join('/');
      if (!by.has(k)) by.set(k, []);
      by.get(k).push(r);
    }
    const rows = [...by.entries()].map(([k, rs]) => ({ k, rs, st: mean(rs.map((r) => r.cleared)) }));
    rows.sort((a, b) => b.st - a.st);
    L.push('| kit | stages cleared (per seed) | mean | survived s | level at end | deaths (stage: cause) |', '|---|---|---|---|---|---|');
    for (const { k, rs, st } of rows) L.push(`| ${k} | ${rs.map((r) => r.cleared).join(' ')} | ${st.toFixed(1)} | ${f0(mean(rs.map((r) => r.runTime)))} | ${f0(mean(rs.map((r) => r.level)))} | ${rs.filter((r) => r.died).map((r) => `st${r.deathStage}: ${r.deathCause}`).join('; ') || '-'} |`);
    L.push('');
    const causes = {};
    for (const r of mortal) if (r.died) causes[r.deathCause] = (causes[r.deathCause] ?? 0) + 1;
    L.push(`Mean stages cleared: ${mean(mortal.map((r) => r.cleared)).toFixed(2)}. Deaths by cause: ${Object.entries(causes).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ${n}`).join(', ')}.`, '');
    const perStage = [1, 2, 3, 4, 5].map((s) => mortal.filter((r) => r.died && r.deathStage === s).length);
    L.push(`Deaths per stage 1-4 (5 = after victory): ${perStage.join(' / ')}; survived the cap: ${mortal.filter((r) => !r.died).length}.`, '');
    const ln = (k) => f1(mean(mortal.map((r) => r.lane[k])));
    L.push(`Milestone 11 systems per mortal run: mechs ${ln('mechs')} (${ln('mechT')} s), super weapons ${ln('supers')}, cash-ins ${ln('cashIns')}, mutant kills ${ln('mutantKills')}, comeback ${ln('comebackT')} s, relics ${f1(mean(mortal.map((r) => r.relics.length)))}, Mods ${f1(mean(mortal.map((r) => r.mods.length)))}, gold earned ${f0(mean(mortal.map((r) => r.goldEarned)))}.`, '');
  }
  const heroes = ok.filter((r) => r.set === 'heroes');
  if (heroes.length) {
    L.push('## Heroes, default kit (Buster / Charge Shot / Bomb), Medium', '');
    const g = heroes.filter((r) => r.god);
    const { list } = bossTable(g);
    L.push('| hero | god index | King | Rex | Queen | Omega | level st1-4 | top DPS sources | mortal stages cleared | mortal deaths |', '|---|---|---|---|---|---|---|---|---|---|');
    for (const h of HEROES) {
      const o = list.find((x) => x.hero === h);
      const m = heroes.filter((r) => !r.god && r.hero === h);
      if (!o) continue;
      L.push(`| ${h} | ${o.index ? o.index.toFixed(2) : '-'} | ${BOSSES.map((n) => f1(o.boss[n])).join(' | ')} | ${stageCols(o.rows, (x) => x.level).map(f0).join('/')} | ${topSources(o.rows, 4)} | ${m.map((r) => r.cleared).join(' ')} | ${m.filter((r) => r.died).map((r) => `st${r.deathStage}: ${r.deathCause}`).join('; ') || '-'} |`);
    }
    L.push('');
  }
  const diff = ok.filter((r) => r.set === 'diff');
  if (diff.length) {
    L.push('## Difficulty curve (3 kits x Easy / Medium / Hard)', '');
    L.push('| kit | difficulty | god: King / Rex / Queen / Omega (s) | god stage times st1-4 (s) | mortal stages cleared | mortal deaths | mortal hp left at stage ends |', '|---|---|---|---|---|---|---|');
    for (const k of [...new Set(diff.map((r) => r.kit.join('/')))])
      for (const d of ['easy', 'normal', 'hard']) {
        const g = diff.filter((r) => r.god && r.kit.join('/') === k && r.diff === d);
        const m = diff.filter((r) => !r.god && r.kit.join('/') === k && r.diff === d);
        const bt = BOSSES.map((n) => f1(med(g.flatMap((r) => r.bosses.filter((x) => x.name === n && x.killed && x.stage <= 4).map((x) => x.vuln))))).join(' / ');
        L.push(`| ${k} | ${d} | ${bt} | ${stageCols(g, (x) => x.time).map(f0).join('/')} | ${m.map((r) => r.cleared).join(' ')} | ${m.filter((r) => r.died).map((r) => `st${r.deathStage}: ${r.deathCause}`).join('; ') || '-'} | ${stageCols(m, (x) => x.hp).map(f0).join('/')} |`);
      }
    L.push('');
  }
  return L.join('\n');
}

// --compare=before.json,after.json: a before/after summary (bench indices against the BEFORE medians).
function compare(a, b) {
  const L = [];
  const key = (r) => `st${r.bench.stage}r${r.bench.ranks}${r.bench.evo ?? ''}`;
  const A = a.filter((r) => r.set === 'bench' && !r.error);
  const B = b.filter((r) => r.set === 'bench' && !r.error);
  const cols = BENCH.map((x) => `st${x.stage}r${x.ranks}${x.evo ?? ''}`).filter((c) => c !== QUEEN);
  const kits = [...new Set(A.map((r) => r.kit.join('/')))];
  const t = (R, k, c) => med(R.filter((r) => r.kit.join('/') === k && key(r) === c).map((r) => (r.bosses[0]?.killed ? r.bosses[0].vuln : 300)));
  const refA = Object.fromEntries(cols.map((c) => [c, med(kits.map((k) => t(A, k, c)))]));
  const refB = Object.fromEntries(cols.map((c) => [c, med(kits.map((k) => t(B, k, c)))]));
  const idx = (R, k, ref) => geo(cols.map((c) => ref[c] / t(R, k, c)));
  const rows = kits.map((k) => ({ k, a: idx(A, k, refA), b: idx(B, k, refB), abs: idx(B, k, refA) }));
  rows.sort((x, y) => y.b - x.b);
  L.push('### Boss bench, before -> after', '');
  L.push(`Index = geometric mean over King st1, Rex st2, Omega st4 (both evolutions) of median kit time / kit time; "after" is against the after median, "abs" against the before median (> before = this kit got faster). Median kit before: ${cols.map((c) => `${c} ${f1(refA[c])} s`).join(', ')}; after: ${cols.map((c) => `${c} ${f1(refB[c])} s`).join(', ')}.`, '');
  L.push('| kit | before | after | abs |', '|---|---|---|---|');
  for (const r of rows) L.push(`| ${r.k} | ${r.a.toFixed(2)} | ${r.b.toFixed(2)} | ${r.abs.toFixed(2)} |`);
  const va = rows.map((r) => r.a);
  const vb = rows.map((r) => r.b);
  const band = (v) => v.filter((x) => x >= 0.625 && x <= 1.6).length;
  L.push('', `Spread (max/min): ${(Math.max(...va) / Math.min(...va)).toFixed(2)} -> ${(Math.max(...vb) / Math.min(...vb)).toFixed(2)}; range ${Math.min(...va).toFixed(2)}-${Math.max(...va).toFixed(2)} -> ${Math.min(...vb).toFixed(2)}-${Math.max(...vb).toFixed(2)}; in the 0.63-1.60 band ${band(va)}/${va.length} -> ${band(vb)}/${vb.length}.`, '');
  L.push('| slot | item: bench main effect before -> after |', '|---|---|');
  for (const [slot, items, i] of [['left', PRIMARY, 0], ['right', SECONDARY, 1], ['special', SPECIAL, 2]])
    L.push(`| ${slot} | ${items.map((it) => `${it} ${geo(rows.filter((r) => r.k.split('/')[i] === it).map((r) => r.a)).toFixed(2)} -> ${geo(rows.filter((r) => r.k.split('/')[i] === it).map((r) => r.b)).toFixed(2)}`).join(', ')} |`);
  L.push('');
  // Full god runs: boss times per boss (median over every kit run).
  for (const [set, label] of [['kits', 'Full god runs (kits set)'], ['heroes', 'Full god runs, heroes (default kit)']]) {
    const ga = a.filter((r) => r.set === set && r.god && !r.error);
    const gb = b.filter((r) => r.set === set && r.god && !r.error);
    if (!ga.length || !gb.length) continue;
    const bt = (R, n) => med(R.flatMap((r) => r.bosses.filter((x) => x.name === n && x.killed && x.stage <= 4).map((x) => x.vuln)));
    L.push(`${label}: median boss time ${BOSSES.map((n) => `${SHORT[n]} ${f1(bt(ga, n))} -> ${f1(bt(gb, n))} s`).join(', ')}.`, '');
  }
  const kitIdx = (R) => {
    const { list } = bossTable(R.filter((r) => r.set === 'kits' && !r.error));
    return list.filter((o) => o.index).map((o) => o.index);
  };
  const ka = kitIdx(a);
  const kb = kitIdx(b);
  if (ka.length && kb.length) L.push(`Full god runs, kit speed index: range ${Math.min(...ka).toFixed(2)}-${Math.max(...ka).toFixed(2)} -> ${Math.min(...kb).toFixed(2)}-${Math.max(...kb).toFixed(2)}, spread ${(Math.max(...ka) / Math.min(...ka)).toFixed(2)} -> ${(Math.max(...kb) / Math.min(...kb)).toFixed(2)}, in band ${ka.filter((x) => x >= 0.625 && x <= 1.6).length}/${ka.length} -> ${kb.filter((x) => x >= 0.625 && x <= 1.6).length}/${kb.length}.`, '');
  // Mortal: stages cleared per item.
  const ma = a.filter((r) => r.set === 'mortal' && !r.error);
  const mb = b.filter((r) => r.set === 'mortal' && !r.error);
  if (ma.length && mb.length) {
    L.push('### Mortal bot (Medium), stages cleared, before -> after', '');
    L.push(`All kits: ${mean(ma.map((r) => r.cleared)).toFixed(2)} -> ${mean(mb.map((r) => r.cleared)).toFixed(2)}; deaths per stage 1-4 ${[1, 2, 3, 4].map((s) => ma.filter((r) => r.died && r.deathStage === s).length).join('/')} -> ${[1, 2, 3, 4].map((s) => mb.filter((r) => r.died && r.deathStage === s).length).join('/')}.`, '');
    L.push('| slot | item: mean stages cleared by the kits holding it, before -> after |', '|---|---|');
    for (const [slot, items, i] of [['left', PRIMARY, 0], ['right', SECONDARY, 1], ['special', SPECIAL, 2]])
      L.push(`| ${slot} | ${items.map((it) => `${it} ${mean(ma.filter((r) => r.kit[i] === it).map((r) => r.cleared)).toFixed(2)} -> ${mean(mb.filter((r) => r.kit[i] === it).map((r) => r.cleared)).toFixed(2)}`).join(', ')} |`);
    const dk = (R) => mean(R.filter((r) => r.kit.join('/') === DEF.join('/')).map((r) => r.cleared));
    L.push('', `Default kit (Buster / Charge Shot / Bomb): ${dk(ma).toFixed(2)} -> ${dk(mb).toFixed(2)} stages.`, '');
  }
  // Hero bench.
  const ha = a.filter((r) => r.set === 'herobench' && !r.error);
  const hb = b.filter((r) => r.set === 'herobench' && !r.error);
  if (ha.length && hb.length) {
    const hidx = (R) => {
      const ht = (h, c) => med(R.filter((r) => r.hero === h && key(r) === c).map((r) => (r.bosses[0]?.killed ? r.bosses[0].vuln : 300)));
      const ref = Object.fromEntries(cols.map((c) => [c, med(HEROES.map((h) => ht(h, c)))]));
      return Object.fromEntries(HEROES.map((h) => [h, geo(cols.map((c) => ref[c] / ht(h, c)))]));
    };
    const x = hidx(ha);
    const y = hidx(hb);
    L.push(`Hero bench index before -> after: ${HEROES.map((h) => `${h} ${x[h].toFixed(2)} -> ${y[h].toFixed(2)}`).join(', ')}.`, '');
  }
  return L.join('\n');
}

if (args.compare) {
  const [fa, fb] = args.compare.split(',');
  const out = compare(JSON.parse(readFileSync(fa, 'utf8')).results, JSON.parse(readFileSync(fb, 'utf8')).results);
  if (args.out) writeFileSync(args.out, out);
  console.log(out);
  process.exit(0);
}
if (args.bundle) {
  console.log('bundled', bundle());
  process.exit(0);
}
let results;
if (args.from) results = JSON.parse(readFileSync(args.from, 'utf8')).results;
else {
  const cfgs = configs();
  console.log(`sweep: ${cfgs.length} runs, ${jobs} jobs`);
  results = await runAll(cfgs);
  if (args.append) results = [...JSON.parse(readFileSync(args.append, 'utf8')).results, ...results];
  if (args.merge) results = [...JSON.parse(readFileSync(args.merge, 'utf8')).results.filter((r) => !sets.includes(r.set)), ...results];
}
mkdirSync(`${root}notes/balance`, { recursive: true });
const base = `${root}notes/balance/sweep-${date}${tag}`;
if (!args.from) writeFileSync(`${base}.json`, JSON.stringify({ date, seeds, secs, stages, sets, results }, null, 0));
writeFileSync(`${base}.md`, report(results));
console.log(`wrote ${base}.md${args.from ? '' : ' and .json'}`);
