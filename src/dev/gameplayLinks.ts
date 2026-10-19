import { ENEMIES } from '../data/enemies';
import { WEAPONS } from '../data/weapons';
import { MAX_WEAPONS } from '../game/hero';
import type { Game } from '../game/game';
import { SUPER_IDS, mutationTuning, overloadTuning, type SuperId } from '../game/gameplay';
import { createSuper } from '../game/weapons/super';
import { gpWorld, mutate, spawnCrate, spawnMechDrop, startMech } from '../game/systems/gameplay';

/**
 * Test-link options for the gameplay lane (screenshots and quick checks):
 *
 *   &mech[=s]            climb into a mech suit after s seconds (default 0.5)
 *   &mechdrop            a mech suit lies 4 m to your right
 *   &crate[=minigun]     a supply crate starts falling 6 m away (railgun, flamer; default random)
 *   &super=railgun       hold a super weapon now (minigun, railgun, flamer)
 *   &mutate[=8]          spawn 8 enemies around you and mutate them; &mutafter=10 mutates after 10 s
 *   &overload[=go]       a fully maxed kit (4 maxed auto weapons, both clicks ranked and evolved);
 *                        `go` fills the overload meter so it fires at once
 *   &combo=150           set the team combo (cash-in panel); &cashgo=1 cashes in tier 1 after 1 s
 *   &finale[=3]          a crowd around you, then the stage clears after 3 s (chain reaction)
 *   &comeback            1 life left and no revives (comeback mode)
 *   &relic=r_orbit,r_keg give relics
 */
export function gameplayLinks(game: Game, q: URLSearchParams): void {
  const h = game.hero;
  const p = h.player;
  const later = (s: number, f: () => void) => setTimeout(f, s * 1000);
  for (const id of (q.get('relic') ?? '').split(',').filter(Boolean)) if (!h.relics.includes(id)) h.relics.push(id);
  h.recomputeStats();
  if (q.has('mech')) later(Number(q.get('mech')) || 0.5, () => startMech(game, h));
  if (q.has('mechdrop')) spawnMechDrop(game, p.x + 4, p.z);
  if (q.has('crate')) {
    const k = q.get('crate') as SuperId;
    spawnCrate(game, p.x + 6, p.z - 1, SUPER_IDS.includes(k) ? k : SUPER_IDS[Math.floor(Math.random() * 3)]);
  }
  const sup = q.get('super') as SuperId;
  if (SUPER_IDS.includes(sup)) {
    const w = createSuper(sup);
    h.play.superW = w;
    h.play.superId = sup;
    h.play.superAmmo = w.ammo;
    h.play.superT = w.t;
  }
  if (q.get('mutafter')) mutationTuning.after = Number(q.get('mutafter'));
  if (q.has('mutate')) {
    const n = Number(q.get('mutate')) || 8;
    const ids = ['bopper', 'zippy', 'chonk', 'shooter'];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const e = game.enemies.spawn(ENEMIES[ids[i % ids.length]] ?? ENEMIES.bopper, p.x + Math.cos(a) * 6, p.z + Math.sin(a) * 6, game.spawnOpts({ instant: true }));
      mutate(game, gpWorld(game), e);
    }
  }
  if (q.has('overload')) {
    for (const w of h.weapons) {
      if (w.build) {
        (w.def.tracks ?? []).forEach((t, k) => {
          for (let r = 0; r < t.ranks.length; r++) w.addRank(k);
        });
        w.evolve(0);
      } else while (!w.maxed) w.levelUp();
    }
    const autos = ['drones', 'aura', 'lightning', 'discs', 'missiles', 'mines'].filter((id) => WEAPONS[id]);
    for (const id of autos) {
      if (h.weapons.filter((w) => !w.def.slot).length >= MAX_WEAPONS && !h.weapons.some((w) => w.def.id === id)) continue;
      for (let i = 0; i < WEAPONS[id].levels.length; i++) game.debugGiveWeapon(id);
    }
    h.loadoutDirty = true;
    if (q.get('overload') === 'go') {
      h.play.overloadReady = true;
      h.play.overload01 = 1 - 0.5 / overloadTuning.charge;
    }
  }
  if (q.get('combo')) {
    game.combo = Number(q.get('combo'));
    game.comboT = 1e6;
  }
  if (q.get('cashgo')) later(1, () => game.gpCashIn(h, Number(q.get('cashgo')) || 0));
  if (q.has('finale')) {
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      const d = 4 + (i % 4) * 2.5;
      game.enemies.spawn(ENEMIES.bopper, p.x + Math.cos(a) * d, p.z + Math.sin(a) * d, game.spawnOpts({ instant: true }));
    }
    later(Number(q.get('finale')) || 3, () => game.stageClear());
  }
  if (q.has('comeback')) {
    h.revivesLeft = 0;
    later(0.3, () => (p.hp = 1));
  }
}
