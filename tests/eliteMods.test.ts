/** Elite modifiers: stats on spawn and the co-op enemy record round trip. */
import { ok } from './check';
import { ELITE_MODS, ELITE_MOD_IDS } from '../src/data/eliteMods';
import { ENEMIES } from '../src/data/enemies';
import { Enemy } from '../src/game/enemies';
import { packEnemies, unpackEnemies } from '../src/net/codec';
const def = ENEMIES.bopper;
const plain = new Enemy(def); plain.reset(0, 0, { elite: true });
for (const id of ELITE_MOD_IDS) {
  const e = new Enemy(def); e.reset(1, 2, { elite: true, eliteMod: id });
  const m = ELITE_MODS[id];
  ok(e.mod === m, id + ' mod set');
  ok(e.maxHp === Math.round(plain.maxHp * (m.hpMul ?? 1)), id + ' hp ' + e.maxHp + ' vs plain ' + plain.maxHp);
  ok(Math.abs(e.speedMul - plain.speedMul * (m.speedMul ?? 1)) < 1e-9, id + ' speed');
  ok(e.shield === Math.round(e.maxHp * (m.shield ?? 0)), id + ' shield ' + e.shield);
  // codec round trip, shield up and down
  for (const sh of [e.shield, 0]) {
    e.shield = sh; e.uid = 7;
    let got: any = null;
    unpackEnemies(packEnemies([e]), (r) => (got = { ...r }));
    ok(got.elite && got.eliteMod === id && got.shield === sh > 0 && got.action === 'ring', id + ' codec shield=' + (sh > 0));
  }
}
const n = new Enemy(def); n.reset(0, 0, { eliteMod: 'fast' });
ok(n.mod === null && n.shield === 0, 'non-elite ignores eliteMod');
// boss action still round-trips
const boss = Object.values(ENEMIES).find((d) => d.boss)!;
const b = new Enemy(boss); b.reset(0, 0, {}); b.action = 'rain';
let ga: any = null; unpackEnemies(packEnemies([b]), (r) => (ga = { ...r }));
ok(ga.action === 'rain' && ga.eliteMod === null && !ga.shield, 'boss action unaffected');
const pe = new Enemy(def); pe.reset(0, 0, { elite: true });
let gp: any = null; unpackEnemies(packEnemies([pe]), (r) => (gp = { ...r }));
ok(gp.elite && gp.eliteMod === null, 'elite without mod round-trips');
