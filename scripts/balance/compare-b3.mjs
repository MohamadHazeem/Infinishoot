// node scripts/balance/compare-b3.mjs before.json after.json
// Compare paired sweep rows, including uncensored death evidence and Titan phases.
import { readFileSync } from 'node:fs';
const [a, b] = process.argv.slice(2).map(p => JSON.parse(readFileSync(p, 'utf8')).results);
const median = xs => { const s = xs.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? (s[(s.length - 1) >> 1] + s[s.length >> 1]) / 2 : NaN; };
const f = x => Number.isFinite(x) ? x.toFixed(2) : '-';
const bossTimes = (rows, stage) => rows.flatMap(r => r.bosses.filter(x => x.stage === stage && x.killed && x.name !== 'The Architect').map(x => x.vuln));
console.log('# balance3 paired evidence\n');
console.log(`Before ${a.length} rows (${a.filter(r => r.error).length} errors), after ${b.length} (${b.filter(r => r.error).length} errors).`);
console.log('Titan phase clocks start after the rise; a strong build can break plates during the rise. Damage totals include overkill returned by Game.damage. Neither changes the official vulnerable-time measurement.');
for (const [name, rows] of [['Before', a], ['After', b]]) {
  const loops = rows.filter(r => r.set === 'loops' && !r.error);
  if (loops.length) {
    const t = bossTimes(loops, 11);
    console.log(`\n## ${name}: Titan\n\n${t.length}/${loops.length} killed; median ${f(median(t))}s, min ${f(Math.min(...t))}s, max ${f(Math.max(...t))}s.\n`);
    console.log('| Phase | Median seconds | Frames without damage (seconds) | >12m from all open targets (seconds) | Wall blocks nearest target (seconds) | Longest no-hit gap |');
    console.log('|---|---|---|---|---|---|');
    for (let phase = 1; phase <= 4; phase++) {
      const rs = loops.map(r => r.titanPhases?.[phase]).filter(Boolean);
      console.log(`| ${phase} | ${['seconds', 'idle', 'far', 'blocked'].map(k => f(median(rs.map(r => r[k])))).join(' | ')} | ${f(Math.max(...rs.map(r => r.maxGap)))} |`);
    }
    console.log('\n| Kit / seed | Total | Phase 1 / 2 / 3 / 4 seconds |');
    console.log('|---|---|---|');
    for (const r of loops) console.log(`| ${r.kit.join('/')} / ${r.seed} | ${f(bossTimes([r], 11)[0])} | ${[1, 2, 3, 4].map(p => f(r.titanPhases?.[p]?.seconds)).join(' / ')} |`);
  }
  const asc = rows.filter(r => r.set === 'asc' && !r.error);
  if (asc.length) {
    console.log(`\n## ${name}: Ascension\n\n| A | Boss times st1/2/3/4 | Ratios to A10 | Stage clear times | Mortal clears |\n|---|---|---|---|---|`);
    const ref = asc.filter(r => r.asc === 10 && r.god);
    for (const n of [...new Set(asc.map(r => r.asc))].sort((x, y) => x - y)) {
      const rs = asc.filter(r => r.asc === n), god = rs.filter(r => r.god);
      const times = [1, 2, 3, 4].map(st => median(bossTimes(god, st)));
      console.log(`| ${n} | ${times.map(f).join('/')} | ${times.map((t, i) => f(t / median(bossTimes(ref, i + 1)))).join('/')} | ${[1, 2, 3, 4].map(st => f(median(god.map(r => r.stages.find(s => s.stage === st)?.time)))).join('/')} | ${rs.filter(r => !r.god).map(r => r.cleared).join(', ')} |`);
    }
    const paired = asc.filter(r => r.asc >= 15 && r.god).flatMap(r => {
      const a10 = ref.find(x => x.seed === r.seed);
      return r.bosses.filter(x => x.killed).flatMap(x => {
        const base = a10?.bosses.find(y => y.stage === x.stage && y.name === x.name && y.killed);
        return base ? [{ asc: r.asc, seed: r.seed, stage: x.stage, ratio: x.vuln / base.vuln }] : [];
      });
    }).sort((x, y) => y.ratio - x.ratio);
    if (paired.length) console.log(`\nLargest same-seed high-Ascension / A10 boss-time ratio: ${f(paired[0].ratio)}x (A${paired[0].asc}, seed ${paired[0].seed}, stage ${paired[0].stage}); ${paired.filter(x => x.ratio > 2.5).length} above 2.5x.`);
    console.log('\nFatal-stage hit evidence (actual life lost, before/max life, simulation time).\n');
    for (const r of asc.filter(r => r.asc >= 15 && !r.god && r.died)) {
      const hs = r.hits.filter(h => h.stage === r.deathStage);
      const gaps = hs.slice(1).map((h, i) => h.time - hs[i].time);
      console.log(`- A${r.asc} seed ${r.seed}: stage ${r.deathStage}, ${r.deathCause}; min landed-hit gap ${f(Math.min(...gaps))}s; largest hit ${f(Math.max(...hs.map(h => h.lost / h.maxHp)) * 100)}% max life. Last hits: ${hs.slice(-6).map(h => `${h.source} raw ${h.raw}, lost ${h.lost} from ${h.hp}/${h.maxHp} @${h.time}s (invuln ${h.invuln})`).join('; ')}.`);
    }
  }
}
console.log('\n## Paired tolerance checks\n');
let identical = 0, compared = 0;
const outside = [];
for (const r of a.filter(r => !r.error)) {
  const s = b.find(s => s.id === r.id && !s.error);
  if (!s) continue;
  compared++;
  if (JSON.stringify([r.bosses, r.stages]) === JSON.stringify([s.bosses, s.stages])) identical++;
  for (const x of r.bosses.filter(x => x.killed)) {
    const y = s.bosses.find(y => y.stage === x.stage && y.name === x.name && y.killed);
    if (y && Math.abs(y.vuln - x.vuln) > Math.max(3, x.vuln * .25)) outside.push(`${r.id} st${x.stage} ${x.name}: ${f(x.vuln)} -> ${f(y.vuln)}s (${f(y.vuln / x.vuln)}x)`);
  }
}
console.log(`${identical}/${compared} paired rows have identical stage/boss records. ${outside.length} boss observations move >25% (3s floor); individual full-run build divergence is reported rather than hidden.`);
for (const x of outside) console.log(`- ${x}`);
console.log('\nAggregate loop boss medians (all four kits, both seeds):\n');
console.log('| Stage | Before | After | After / before |');
console.log('|---|---|---|---|');
for (let st = 1; st <= 12; st++) {
  const x = median(bossTimes(a.filter(r => r.set === 'loops' && !r.error), st));
  const y = median(bossTimes(b.filter(r => r.set === 'loops' && !r.error), st));
  console.log(`| ${st} | ${f(x)} | ${f(y)} | ${f(y / x)} |`);
}
