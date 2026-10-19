/** RUN lane, pure logic: route rolls and votes, ISO weeks and Weekly mutators, heat, RunMods knobs, the EVENTFUL extra event. */
import { ok } from './check';
import { Rng } from '../src/core/rng';
import { ROUTES, rollRoutes, routeTuning, tallyVotes } from '../src/data/routes';
import { isoWeek, weeklySeed, dailySeed, isChallenge } from '../src/data/modes';
import { MUTATORS, weeklyMutators } from '../src/data/mutators';
import { HEAT_MAX, HEAT_MODS, cleanHeat, heatScoreMul, heatTotal } from '../src/data/heat';
import { RunMods, cycleHeat } from '../src/game/runMods';
import { RunEvents } from '../src/game/runEvents';

// ---------------------------------------------------------------- routes
const a = rollRoutes(1234, 2, false);
ok(JSON.stringify(a) === JSON.stringify(rollRoutes(1234, 2, false)), 'route offers are a pure function of seed and stage');
ok(a.length === routeTuning.offers && new Set(a).size === a.length, `${routeTuning.offers} distinct route cards`);
let differ = 0;
let cursedFinal = 0;
const seen = new Set<string>();
for (let s = 0; s < 300; s++) {
  const r = rollRoutes(s * 7919, 3, false);
  r.forEach((x) => seen.add(x));
  if (JSON.stringify(r) !== JSON.stringify(rollRoutes(s * 7919, 4, false))) differ++;
  const f = rollRoutes(s * 7919, 4, true);
  if (f.length !== routeTuning.finalOffers) cursedFinal += 100;
  if (f.includes('cursed')) cursedFinal++;
}
ok(seen.size === ROUTES.length, 'every route shows up');
ok(differ > 200, 'different stages roll different routes');
ok(cursedFinal === 0, 'the final boss stage offers a reduced set, never CURSED');

ok(tallyVotes([1, 1, 0], 3) === 1, 'majority wins');
ok(tallyVotes([0, 1], 3) === 0 && tallyVotes([2, 1], 3, 0) === 2, 'a tie goes to the host');
ok(tallyVotes([-1, 1, 2], 3) === 1, 'a tie without the host: leftmost card');
ok(tallyVotes([-1, -1], 3) === 0, 'no votes: the first card');
ok(tallyVotes([2, -1, -1], 3) === 2, 'one vote decides');

// ---------------------------------------------------------------- weekly
ok(isoWeek('2026-10-19') === '2026-W43', 'ISO week of a Monday');
ok(isoWeek('2026-10-25') === '2026-W43', 'Sunday stays in the same week');
ok(isoWeek('2021-01-03') === '2020-W53', 'early January can belong to last year');
ok(isoWeek('2024-12-30') === '2025-W01', 'late December can belong to next year');
ok(weeklySeed('2026-W43') === weeklySeed('2026-W43') && weeklySeed('2026-W43') !== weeklySeed('2026-W44'), 'weekly seed per week');
ok(weeklySeed('2026-W43') !== dailySeed('2026-W43'), 'weekly and daily seeds differ');
ok(isChallenge('weekly') && isChallenge('daily') && !isChallenge('standard'), 'challenge modes');
const m = weeklyMutators('2026-W43');
ok(m.length === 2 && m[0] !== m[1] && JSON.stringify(m) === JSON.stringify(weeklyMutators('2026-W43')), 'two distinct mutators per week, stable');
const mseen = new Set<string>();
for (let w = 1; w <= 52; w++) weeklyMutators(`2027-W${String(w).padStart(2, '0')}`).forEach((x) => mseen.add(x));
ok(mseen.size === MUTATORS.length, 'a year of weeks uses every mutator');

// ---------------------------------------------------------------- heat
ok(heatTotal({}) === 0 && heatScoreMul(0) === 1, 'no heat, no bonus');
const full = Object.fromEntries(HEAT_MODS.map((d) => [d.id, 99]));
ok(heatTotal(cleanHeat(full)) === HEAT_MAX && HEAT_MAX >= 20, `ranks clamp to their max (max heat ${HEAT_MAX})`);
ok(JSON.stringify(cleanHeat({ hp: 2, bogus: 3, speed: -1, dmg: 1.7 })) === JSON.stringify({ hp: 2, dmg: 1 }), 'cleanHeat drops junk');
let h = {};
for (let i = 0; i < 4; i++) h = cycleHeat(h, 'hp');
ok(heatTotal(h) === 0, 'clicking cycles 0-1-2-3-0');
ok(HEAT_MODS.length >= 8 && HEAT_MODS.length <= 12, `${HEAT_MODS.length} heat modifiers`);

// ---------------------------------------------------------------- RunMods knobs
const rm = new RunMods();
ok(rm.sum('enemyHp') === 0 && rm.eliteMul === 1 && rm.priceMul === 1 && rm.iframeMul === 1 && rm.damageMul === 1, 'neutral by default');
rm.reset({ hp: 2, elites: 1, hunger: 2, iframes: 1, purse: 2 }, ['glass', 'giants']);
ok(Math.abs(rm.sum('enemyHp') - (0.3 + 0.6)) < 1e-9, 'heat and Giants add enemy life');
ok(rm.sum('dmgTaken') === 1 && rm.damageMul === 2, 'Glass World doubles damage both ways');
ok(rm.noLevelHeal && rm.noHearts && rm.iframeMul < 1 && rm.priceMul > 1 && rm.eliteMul < 1, 'heat knobs');
ok(rm.enemyScale > 1, 'Giants grow enemies');
ok(Math.abs(rm.sum('score') - 0.05 * rm.heatTotal) < 1e-9, 'heat adds to the score bonus');
rm.route = 'treasure';
ok(rm.chestEveryMul < 1 && rm.chestMaxAdd > 0, 'TREASURE: more chests');
rm.route = 'shop';
ok(rm.priceMul < 1.3 * 0.71 && rm.clearGold > 0, 'BARGAIN: cheaper shop, stage-clear gold');
rm.reset();
rm.route = 'elite';
ok(rm.eliteMul === routeTuning.eliteMul && rm.relicLuck > 0, 'ELITE HUNT: more elites, luckier relic');
rm.route = 'event';
ok(rm.eventMods.events === 2 && rm.eventMods.rewardMul > 1, 'EVENTFUL knobs');
ok(rm.tagLines().length === 1 && rm.tagLines()[0][0].text.includes('EVENTFUL'), 'HUD tag shows the route');

// ---------------------------------------------------------------- EVENTFUL: two events, bigger rewards
let gold = 0;
const banners: string[] = [];
const host = {
  rng: new Rng(5), stage: 2, dmgMul: 1, targets: () => [{ x: 0, z: 0 }], ownedWeapons: () => ['buster'],
  meteor: () => {}, spawnElite: () => {}, spawnRing: () => {}, vacuum: () => {},
  banner: (t: string) => banners.push(t), toast: () => {}, sound: () => {}, reward: (g: number) => (gold += g),
};
let twoEvents = 0;
for (let seed = 1; seed < 30; seed++) {
  host.rng = new Rng(seed);
  const ev = new RunEvents(host as never);
  ev.mods = { events: 2, rewardMul: 2.5, challengeAt: 8 };
  ev.startStage(240);
  let n = 0;
  let last: string | null = null;
  for (let t = 0; t < 240; t += 1 / 60) {
    ev.update(1 / 60, t, false);
    const id = ev.event ? `${ev.event.id}` : null;
    if (id && id !== last) n++;
    last = id;
    if ((t < 7.9 && ev.challenge) || (t > 9 && !ev.challenge)) n += 100; // the challenge starts at 8 s
  }
  if (n >= 2 && n < 100) twoEvents++;
}
ok(twoEvents >= 27, `EVENTFUL runs two events per stage (${twoEvents}/29)`);
const plain = new RunEvents(host as never);
plain.startStage(240);
let plainEvents = 0;
let lastP: string | null = null;
for (let t = 0; t < 240; t += 1 / 60) {
  plain.update(1 / 60, t, false);
  const id = plain.event ? plain.event.id : null;
  if (id && id !== lastP) plainEvents++;
  lastP = id;
}
ok(plainEvents === 1, 'without the route: one event');
