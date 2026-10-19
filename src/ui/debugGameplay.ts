import type GUI from 'lil-gui';
import type { Game } from '../game/game';
import { cashTuning, comebackTuning, crateTuning, finaleTuning, mechTuning, mutationTuning, overloadTuning, relicTuning, superTuning } from '../game/gameplay';
import { mechLook } from '../game/gameplayView';
import { spawnCrate, spawnMechDrop, startMech } from '../game/systems/gameplay';

/** Debug panel folder for the gameplay lane (src/ui/debugPanel.ts adds it). */
export function addGameplayFolder(gui: GUI, game: Game): void {
  const f = gui.addFolder('Gameplay: mech, crates, mutations').close();
  const act = {
    mech: () => startMech(game, game.hero),
    mechDrop: () => spawnMechDrop(game, game.hero.player.x + 4, game.hero.player.z),
    crate: () => spawnCrate(game, game.hero.player.x + 6, game.hero.player.z, (['minigun', 'railgun', 'flamer'] as const)[Math.floor(Math.random() * 3)]),
    overload: () => {
      game.hero.play.overloadReady = true;
      game.hero.play.overload01 = 0.99;
    },
    comeback: () => {
      game.hero.revivesLeft = 0;
      game.hero.player.hp = 1;
    },
    combo: () => {
      game.combo += 100;
      game.comboT = 30;
    },
  };
  f.add(act, 'mech').name('Mech suit now');
  f.add(act, 'mechDrop').name('Drop a mech suit');
  f.add(act, 'crate').name('Supply crate');
  f.add(act, 'overload').name('Overload now (if ready)');
  f.add(act, 'comeback').name('Comeback (1 life)');
  f.add(act, 'combo').name('+100 combo');
  const m = f.addFolder('Mech suit').close();
  m.add(mechTuning, 'duration', 5, 60, 1);
  m.add(mechTuning, 'dropChance', 0, 0.005, 0.0001);
  m.add(mechTuning, 'eliteChance', 0, 0.5, 0.01);
  m.add(mechTuning, 'dropCooldown', 0, 300, 5);
  m.add(mechTuning, 'speedMul', 0.3, 1.5, 0.02);
  m.add(mechTuning, 'armor', 0, 40, 1);
  m.add(mechTuning, 'armorPerStage', 0, 20, 1);
  m.add(mechTuning, 'cannonRate', 1, 20, 0.5);
  m.add(mechTuning, 'cannonDmg', 1, 100, 1);
  m.add(mechTuning, 'salvoEvery', 0.5, 8, 0.1);
  m.add(mechTuning, 'missileDmg', 1, 150, 1);
  m.add(mechTuning, 'stompDmg', 1, 150, 1);
  m.add(mechTuning, 'ejectDmg', 0, 500, 5);
  m.add(mechTuning, 'powerExp', 0, 1.2, 0.05).name('Power exp (hpMul^x)');
  m.add(mechLook, 'pilotY', 0, 3, 0.05).name('Pilot height');
  const c = f.addFolder('Supply crates').close();
  c.add(crateTuning, 'first', 0, 200, 5);
  c.add(crateTuning.every, '0', 5, 200, 5).name('Every min');
  c.add(crateTuning.every, '1', 5, 300, 5).name('Every max');
  c.add(crateTuning, 'life', 5, 60, 1);
  c.add(superTuning, 'railgunEvery', 0.1, 2, 0.05);
  c.add(superTuning, 'flamerRate', 5, 60, 1);
  const u = f.addFolder('Mutations, overload, comeback').close();
  u.add(mutationTuning, 'enabled').name('Mutations on');
  u.add(mutationTuning, 'after', 5, 120, 1).name('Mutate after (s)');
  u.add(mutationTuning, 'maxAlive', 0, 100, 1);
  u.add(mutationTuning, 'hpMul', 1, 6, 0.1);
  u.add(mutationTuning, 'speedMul', 1, 2, 0.05);
  u.add(mutationTuning, 'spitEvery', 1, 10, 0.5);
  u.add(overloadTuning, 'charge', 1, 120, 1).name('Overload charge (s)');
  u.add(overloadTuning, 'duration', 1, 15, 0.5).name('Overload length');
  u.add(overloadTuning, 'cooldownMul', 0.1, 1, 0.05);
  u.add(comebackTuning, 'enabled').name('Comeback on');
  u.add(comebackTuning, 'hpFrac', 0, 0.5, 0.01).name('Comeback below (life %)');
  u.add(comebackTuning, 'damageMul', 1, 4, 0.1);
  const k = f.addFolder('Cash-in, finale, relics').close();
  cashTuning.tiers.forEach((t) => k.add(t, 'cost', 5, 500, 5).name(`Cash ${t.name}`));
  k.add(cashTuning, 'growth', 0, 2, 0.05).name('Cost growth / use');
  k.add(finaleTuning, 'speed', 5, 60, 1).name('Finale speed');
  k.add(finaleTuning, 'maxTime', 0.5, 5, 0.1).name('Finale max time');
  k.add(finaleTuning, 'maxSites', 10, 300, 5);
  k.add(relicTuning, 'novaEvery', 2, 50, 1);
  k.add(relicTuning, 'kegChance', 0, 1, 0.05);
  k.add(relicTuning, 'orbitMax', 1, 20, 1);
  k.add(relicTuning, 'comboPerTier', 0, 0.2, 0.01);
}
