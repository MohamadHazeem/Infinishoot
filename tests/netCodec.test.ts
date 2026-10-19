/**
 * Co-op safety: the binary snapshot records must round-trip every enemy kind,
 * state, boss action and elite modifier, and the id tables must still fit
 * their bit fields as content grows.
 */
import { ok } from './check';
import { ENEMIES } from '../src/data/enemies';
import { ELITE_MOD_IDS } from '../src/data/eliteMods';
import { BOSS_ACTIONS, type Enemy } from '../src/game/enemies';
import { packEnemies, unpackEnemies, type EnemyRecord } from '../src/net/codec';

const ids = Object.keys(ENEMIES);
ok(ids.length <= 256, `enemy kinds fit a byte (${ids.length})`);
ok(BOSS_ACTIONS.length <= 8, `boss actions fit 3 bits (${BOSS_ACTIONS.length})`);
ok(ELITE_MOD_IDS.length <= 127, `elite mods fit 7 bits (${ELITE_MOD_IDS.length})`);

const states = ['spawning', 'move', 'windup', 'attack', 'recover'] as const;
const list: Enemy[] = ids.map((id, i) => ({
  uid: 1000 + i,
  def: ENEMIES[id],
  state: states[i % states.length],
  elite: i % 3 === 0,
  mod: i % 3 === 0 ? { id: ELITE_MOD_IDS[i % ELITE_MOD_IDS.length] } : null,
  shield: i % 2,
  frozen: i % 2,
  burnT: (i + 1) % 2,
  shockT: 0,
  flash: 1,
  action: BOSS_ACTIONS[i % BOSS_ACTIONS.length],
  t: 1.5,
  x: -123.45 + i,
  z: 67.89 - i,
  facing: 1.2,
  sq: -0.3,
  hopY: 1.25,
  lungeX: 0,
  lungeZ: 1,
  targetX: 5.5,
  targetZ: -7.25,
  hp: 30,
  maxHp: 120,
})) as unknown as Enemy[];

const got: EnemyRecord[] = [];
unpackEnemies(packEnemies(list), (r) => got.push({ ...r }));
ok(got.length === list.length, `all ${list.length} enemies decoded`);
let bad = 0;
got.forEach((r, i) => {
  const e = list[i] as unknown as Record<string, any>;
  const fails = [
    r.uid !== e.uid && 'uid',
    r.def.id !== e.def.id && 'def',
    r.state !== e.state && 'state',
    r.elite !== e.elite && 'elite',
    r.eliteMod !== (e.elite ? e.mod.id : null) && 'eliteMod',
    r.action !== e.action && 'action',
    Math.abs(r.x - e.x) > 0.006 && 'x',
    Math.abs(r.z - e.z) > 0.006 && 'z',
    Math.abs(r.facing - e.facing) > 0.03 && 'facing',
    Math.abs(r.hp01 - 0.25) > 0.005 && 'hp',
  ].filter(Boolean);
  if (fails.length) {
    bad++;
    console.error(`  ${e.def.id}: ${fails.join(', ')}`);
  }
});
ok(bad === 0, 'every enemy record round-trips');
