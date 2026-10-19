/**
 * Debug panel helpers.
 * Split out of src/game/game.ts: these are Game methods (`this` is the Game),
 * installed on the class as fields, e.g. `debugLevelUp = Debug.debugLevelUp;`.
 */
import type { Game } from '../game';
import { type EliteModId } from '../../data/eliteMods';
import { ENEMIES } from '../../data/enemies';
import { MOD_BY_ID } from '../../data/mods';
import { createWeapon } from '../weapons';

export function debugLevelUp(this: Game): void {
  if (this.isCombatMode && this.authority) this.gainXp(this.xpNext - this.xp);
}

export function debugGiveWeapon(this: Game, id: string): void {
  if (!this.isCombatMode || !this.authority) return;
  const h = this.hero;
  const w = h.weapons.find((x) => x.def.id === id);
  if (w?.maxed) w.evolve();
  else if (w) w.levelUp();
  else h.weapons.push(createWeapon(id, this.scene));
  h.loadoutDirty = true;
}

export function debugSpawnElite(this: Game, defId: string, mod: EliteModId): void {
  const def = ENEMIES[defId];
  if (def && this.mode === 'fight' && this.authority) this.spawnEnemy(def, true, null, mod);
}

export function debugSkipToBoss(this: Game): void {
  if (this.mode === 'fight' && this.authority) this.director.time = Math.max(this.director.time, this.director.duration - 3);
}

export function debugGiveMod(this: Game, id: string): void {
  const m = MOD_BY_ID[id];
  const h = this.hero;
  if (!m || h.synergy.owns(id) || h.synergy.full) return;
  h.synergy.add(m, 0);
  h.recomputeStats();
}

export function debugAddGold(this: Game, n: number): void {
  this.hero.gold += n;
}
