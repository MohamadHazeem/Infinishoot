/** Skill layer: style meter, perfect-dash threat check, ultimate charge, weapon feel data and bindings. */
import { ok } from './check';
import { HeroSkill, STYLE_RANKS, StyleMeter, bulletThreat, rankName, rankOf, rankProgress, skillTuning, styleTuning } from '../src/game/style';
import { ULTS, hordeThin, ultHitGain, ultKillGain, ultTuning } from '../src/game/ultimates';
import { DEFAULT_FEEL, WEAPONS, WEAPON_FEEL, feelOf } from '../src/data/weapons';
import { HEROES } from '../src/data/heroes';
import { ACTIONS, binds } from '../src/core/keybinds';

const T = styleTuning;

// Ranks
ok(STYLE_RANKS.join('') === 'DCBASSS', 'six ranks D, C, B, A, S, SS');
ok(rankOf(0) === 0 && rankOf(T.thresholds[1]) === 1 && rankOf(T.thresholds[5]) === 5 && rankOf(T.cap) === 5, 'rankOf follows the thresholds');
ok(rankName(4) === 'S' && rankName(99) === 'SS' && rankName(-3) === 'D', 'rankName clamps');
ok(Math.abs(rankProgress(T.thresholds[2] + (T.thresholds[3] - T.thresholds[2]) / 2) - 0.5) < 1e-6, 'progress is halfway between ranks');
ok(T.scoreMul.every((m, i) => i === 0 || m > T.scoreMul[i - 1]) && T.xpMul[5] <= 1.2, 'score multiplier rises per rank, XP only slightly');

// Plain kills are capped per second: a big horde alone can't climb past C.
{
  const s = new StyleMeter();
  for (let t = 0; t < 60; t += 1 / 60) {
    s.tick(1 / 60, true);
    for (let k = 0; k < 2; k++) s.kill({ source: k ? 'drones' : 'buster' }); // 120 kills a second
  }
  ok(s.rank <= 2, `120 kills/s from two weapons holds rank ${rankName(s.rank)} (<= B)`);
}
// Repeating one weapon earns less than mixing.
{
  const a = new StyleMeter();
  const b = new StyleMeter();
  a.tick(1, true);
  b.tick(1, true);
  let pa = 0;
  let pb = 0;
  for (let i = 0; i < 6; i++) pa += a.kill({ source: 'buster' });
  const mix = ['buster', 'drones', 'aura', 'fire', 'nova', 'mines'];
  for (let i = 0; i < 6; i++) pb += b.kill({ source: mix[i] });
  ok(pb > pa, `mixed kills earn more (${pb.toFixed(1)} vs ${pa.toFixed(1)})`);
}
// Skill moves climb, decay pulls back, a hit drops two ranks.
{
  const s = new StyleMeter();
  for (let i = 0; i < 8; i++) s.add(T.parry, 'PARRY!');
  ok(s.rank === 4 && s.best === 4, `8 parries reach ${rankName(s.rank)}`);
  ok(s.notes.length === 4 && s.seq === 8 && s.notes[3].text === 'PARRY!', 'notes keep the 4 newest and count every one');
  const before = s.rank;
  s.hit();
  ok(s.rank === before - T.hitDrop, 'a hit drops two ranks');
  ok(s.best === 4, 'best rank survives the hit');
  for (let t = 0; t < 120; t += 1 / 60) s.tick(1 / 60, true);
  ok(s.points === 0 || s.rank === 0, 'points decay away without play');
  const p = s.points;
  s.tick(5, false);
  ok(s.points === p, 'no decay outside fights');
}
// No-hit streaks pay every noHitEvery seconds.
{
  const s = new StyleMeter();
  for (let t = 0; t < T.noHitEvery + 0.5; t += 1 / 60) s.tick(1 / 60, true);
  ok(s.notes.some((n) => n.text.startsWith('UNTOUCHED')), 'an untouched streak earns a note');
}
// Multi-kills pay once when the burst ends.
{
  const s = new StyleMeter();
  s.tick(1, true);
  for (let i = 0; i < 8; i++) s.kill({ source: 'nova' });
  for (let t = 0; t < 0.5; t += 1 / 60) s.tick(1 / 60, true);
  ok(s.notes.some((n) => n.text === 'MULTI x8'), 'an 8-kill burst is a MULTI x8');
}
// Elites, bosses and beats.
{
  const s = new StyleMeter();
  s.kill({ source: 'buster', elite: true });
  s.kill({ source: 'buster', boss: true });
  ok(s.points >= T.eliteKill + T.bossKill, 'elite and boss kills pay their bonus');
  const b = new StyleMeter();
  b.tick(1, true);
  b.kill({ source: 'buster', beat: true });
  b.kill({ source: 'buster', beat: true });
  ok(b.notes.filter((n) => n.text === 'ON BEAT').length === 1, 'one ON BEAT per beat window');
}
// Skill state
{
  const k = new HeroSkill();
  ok(k.damageMul === 1, 'no buff by default');
  k.buffT = 1;
  ok(Math.abs(k.damageMul - (1 + skillTuning.buffDamage)) < 1e-9, 'perfect dash / parry buff raises damage');
  k.ult = 1;
  k.style.add(500);
  k.reset();
  ok(k.ult === 0 && k.style.points === 0 && k.buffT === 0, 'reset clears everything');
}

// Perfect-dash threat check
ok(bulletThreat(0, 0, 3, 0, -20, 0, 0.6, 0.22), 'a bullet 3 m away at 20 m/s heading at you is a threat');
ok(!bulletThreat(0, 0, 3, 0, 20, 0, 0.6, 0.22), 'a bullet flying away is not');
ok(!bulletThreat(0, 0, 8, 0, -20, 0, 0.6, 0.22), 'a bullet too far to arrive in time is not');
ok(!bulletThreat(0, 0, 3, 2, -20, 0, 0.6, 0.22), 'a bullet passing 2 m to the side is not');
ok(bulletThreat(0, 0, 0.3, 0, 0, 0, 0.6, 0.22), 'a bullet already on you is');

// Ultimates
ok(HEROES.every((h) => !!ULTS[h.ult]), 'every hero has an ultimate');
ok(new Set(HEROES.map((h) => h.ult)).size === HEROES.length, 'every hero has its own ultimate');
ok(hordeThin(10) === 1 && hordeThin(ultTuning.hordeRef * 2) === 0.5, 'charge thins with the horde like drops');
ok(ultHitGain(1e6, 100, false) === ultTuning.hitGain, 'one hit charges at most one enemy life');
ok(Math.abs(ultHitGain(500, 1000, true) - ultTuning.bossGain / 2) < 1e-9, 'half a boss is half the boss charge');
ok(ultKillGain(true, false) === ultTuning.eliteGain && ultKillGain(false, true) === 0, 'elite kills charge, the boss kill itself is covered by its hits');
{
  // Rough pace: a minute of stage-1 killing (~15 kills/s, small horde) should not fill more than one ultimate.
  const perMin = 60 * 15 * (ultKillGain(false, false, 60) + ultHitGain(30, 30, false, 60));
  ok(perMin > 0.4 && perMin < 1.4, `about one ultimate a minute from kills alone (${perMin.toFixed(2)})`);
}

// Weapon feel
ok(Object.keys(WEAPON_FEEL).every((id) => !!WEAPONS[id]), 'feel table only names real weapons');
ok(Object.values(WEAPONS).every((w) => !!w.feel), 'every weapon has feel data');
ok(feelOf('nonsense') === DEFAULT_FEEL && feelOf('rail').kick > feelOf('buster').kick, 'unknown sources use defaults; the rail kicks harder than the buster');
ok(Object.values(WEAPONS).every((w) => w.feel!.knock > 0 && w.feel!.flash > 0 && w.feel!.critPitch > 0), 'feel values are positive');

// Bindings
ok(ACTIONS.some((a) => a.id === 'parry') && ACTIONS.some((a) => a.id === 'ult'), 'parry and ultimate are rebindable');
const used = Object.values(binds).flat().filter(Boolean);
ok(used.length === new Set(used).size, 'no key is bound twice');
