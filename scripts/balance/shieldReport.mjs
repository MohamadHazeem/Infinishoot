// node scripts/balance/shieldReport.mjs before.json after.json
import { readFileSync } from 'node:fs';
const median = a => { const v = a.filter(Number.isFinite).sort((a, b) => a - b); return v.length ? (v[(v.length - 1) >> 1] + v[v.length >> 1]) / 2 : NaN; };
const geo = a => a.length ? Math.exp(a.reduce((s, x) => s + Math.log(x), 0) / a.length) : NaN;
const datasets = process.argv.slice(2).map(p => JSON.parse(readFileSync(p, 'utf8')).results);
if (datasets.some(rs => rs.some(r => r.error))) throw new Error('Recover interrupted rows before computing the band');
// A targeted after run may omit unaffected kits. Keep the full before cohort
// as the normalization reference instead of normalizing Aegis against itself.
const measured = new Map(datasets[1].map(r => [r.id, r]));
const carried = datasets[0].filter(r => !measured.has(r.id));
if (carried.some(r => r.kit[1] === 'shield')) throw new Error('Missing after measurements for an Aegis configuration');
datasets[1] = datasets[0].map(r => measured.get(r.id) ?? r);
const metrics = datasets.map(rs => {
  const bench = rs.filter(r => r.set === 'bench'), kits = [...new Set(bench.map(r => r.kit.join('/')))];
  const columns = ['1/-', '2/-', '4/0', '4/1'];
  const col = r => `${r.bench.stage}/${r.bench.evo ?? '-'}`;
  const times = Object.fromEntries(kits.map(k => [k, Object.fromEntries(columns.map(c => [c, median(bench.filter(r => r.kit.join('/') === k && col(r) === c).map(r => r.bosses[0]?.killed ? r.bosses[0].vuln : 300))]))]));
  const refs = Object.fromEntries(columns.map(c => [c, median(kits.map(k => times[k][c]))]));
  const indices = Object.fromEntries(kits.map(k => [k, geo(columns.map(c => refs[c] / times[k][c]))]));
  const shield = kits.filter(k => k.split('/')[1] === 'shield');
  const main = geo(shield.map(k => indices[k]));
  const evo = ['4/0', '4/1'].map(c => geo(shield.map(k => refs[c] / times[k][c])));
  const runs = rs.filter(r => r.set === 'kits');
  const runKits = [...new Set(runs.map(r => r.kit.join('/')))];
  const bosses = ['King Bopper', 'Rampage Rex', 'Hive Queen', 'Omega Overlord'];
  const rt = Object.fromEntries(runKits.map(k => [k, Object.fromEntries(bosses.map(b => [b, median(runs.filter(r => r.kit.join('/') === k).flatMap(r => r.bosses.filter(x => x.killed && x.name === b && x.stage <= 4).map(x => x.vuln)))]))]));
  const rr = Object.fromEntries(bosses.map(b => [b, median(runKits.map(k => rt[k][b]))]));
  const ri = Object.fromEntries(runKits.map(k => [k, geo(bosses.map(b => rr[b] / rt[k][b]).filter(Number.isFinite))]));
  return { main, evo, indices, times, refs, kits: geo(runKits.filter(k => k.split('/')[1] === 'shield').map(k => ri[k])), ri };
});
console.log('# Aegis balance indices\n');
console.log('Same normalization as the sweep: median kit per boss, geometric mean across bosses/kits; Queen excluded from isolated bench. Evolution columns compare Omega at equal ranks/evolution choice.\n');
console.log(`After: ${datasets[0].length - carried.length} measured rows in the ${datasets[0].length}-row reference cohort; ${carried.length} unaffected non-shield rows retained from before. ${measured.size - datasets[0].length + carried.length} extra measured rows are outside that cohort. This lane changes no gameplay on non-shield A0 loop-1 kits.\n`);
console.log('Additional targeted control kits outside the original cohort are excluded from normalization.\n');
console.log('| Measure | Before | After | Target |');
console.log('|---|---|---|---|');
for (const [label, get, target] of [['Bench', m => m.main, '0.95–1.05'], ['Mirror Aegis (Omega)', m => m.evo[0], '≤1.15'], ['Pyre Aegis (Omega)', m => m.evo[1], '≤1.15'], ['Full kits', m => m.kits, '0.95–1.05']]) console.log(`| ${label} | ${get(metrics[0]).toFixed(3)} | ${get(metrics[1]).toFixed(3)} | ${target} |`);
console.log('\n| Shield kit | Bench before/after | Full run before/after |');
console.log('|---|---|---|');
for (const k of Object.keys(metrics[0].indices).filter(k => k.split('/')[1] === 'shield')) console.log(`| ${k} | ${metrics.map(m => m.indices[k]?.toFixed(3)).join(' / ')} | ${metrics.map(m => m.ri[k]?.toFixed(3)).join(' / ')} |`);
console.log('\nOther item main effects (same full cohort; 25% relative tolerance):\n');
console.log('| Slot | Item | Bench before / after | Full kits before / after | Within tolerance |');
console.log('|---|---|---|---|---|');
for (const [slot, i] of [['left', 0], ['right', 1], ['special', 2]]) {
  for (const it of new Set(Object.keys(metrics[0].indices).map(k => k.split('/')[i]))) {
    if (it === 'shield') continue;
    const keys = Object.keys(metrics[0].indices).filter(k => k.split('/')[i] === it);
    const bench = metrics.map(m => geo(keys.map(k => m.indices[k]).filter(Number.isFinite)));
    const kits = metrics.map(m => geo(keys.map(k => m.ri[k]).filter(Number.isFinite)));
    const pass = [bench, kits].every(v => !v.every(Number.isFinite) || Math.abs(v[1] / v[0] - 1) <= .25);
    console.log(`| ${slot} | ${it} | ${bench.map(v => v.toFixed(3)).join(' / ')} | ${kits.map(v => v.toFixed(3)).join(' / ')} | ${pass ? 'PASS' : 'OUTSIDE'} |`);
  }
}
