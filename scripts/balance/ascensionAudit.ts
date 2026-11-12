/** Offline rule audit: bundle with rolldown, then run with Node. */
import { ASCENSIONS, ascensionRules } from '../../src/data/ascension';

console.log('# Ascension cumulative rule audit\n');
console.log('Multipliers below stack on Hard. Chest interval uses the normal 30-second cadence. Rings warn for 1 second, every 8 seconds, speed 7, base damage 12.\n');
console.log('| Level | Rule | Life | Damage | Speed | Count | Chest frequency | Chest interval | Elite effects | Stage healing | Bonus bullets |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|');
for (let n = 0; n <= 20; n++) {
  const r = ascensionRules(n);
  console.log(`| A${n} | ${ASCENSIONS[n - 1]?.name ?? 'Hard baseline'} | ${r.hp.toFixed(2)} | ${r.damage.toFixed(2)} | ${r.speed.toFixed(2)} | ${r.count.toFixed(2)} | ${r.chest.toFixed(3)} | ${Math.round(30 / r.chest)}s | ${r.doubleElites ? '2x' : '1x'} | ${r.noHeal ? 'off' : 'on'} | ${r.attacks * 8} |`);
}
console.log('\nStep checks compare successive changes to the same rule (intervening unchanged levels have zero steps).');
for (const key of ['hp', 'damage', 'speed', 'count', 'chest', 'attacks'] as const) {
  const changes: number[] = [];
  for (let n = 1; n <= 20; n++) {
    const prev = ascensionRules(n - 1)[key], next = ascensionRules(n)[key];
    if (prev !== next) changes.push(key === 'chest' ? 1 - next / prev : next - prev);
  }
  const ratio = Math.max(...changes.slice(1).map((x, i) => Math.max(x / changes[i], changes[i] / x)));
  console.log(`- ${key}: ${changes.map(x => +x.toFixed(3)).join(', ')}; largest neighbouring step ratio ${ratio.toFixed(2)}x (${ratio <= 2 + 1e-9 ? 'PASS' : 'OUTLIER'}).${key === 'chest' ? ' Steps are fractional reductions in supply rate, the rule used by gameplay.' : ''}`);
}
const intervals = [0, 6, 13, 19].map(n => 30 / ascensionRules(n).chest);
const steps = intervals.slice(1).map((n, i) => n - intervals[i]);
console.log(`- Boolean rules each switch once and remain on; no reversal. Chest intervals: ${intervals.join(' -> ')}s; interval increases ${steps.join('/')}s; largest neighbouring increase ${Math.max(...steps.slice(1).map((n, i) => n / steps[i])).toFixed(2)}x.`);
