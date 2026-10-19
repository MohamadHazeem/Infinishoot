/** Host-only bridges from gameplay events/positions to the ordered Mod API.
 * Buffs/readouts use the existing hero snapshot; novas/heals use the effects bus.
 * No separate state store: selling a Mod drops its timers, restarting resets them.
 */
import type { Game } from '../game';
import type { Hero } from '../hero';
import type { Enemy } from '../enemies';
import type { ModEvent } from '../modTypes';
import { mods2Tuning } from '../../data/mods';
import { Fire } from '../weapons/fire';

function nearby(a: Hero, b: Hero): boolean {
  return (
    (a.player.x - b.player.x) ** 2 + (a.player.z - b.player.z) ** 2 <= mods2Tuning.allyRadius ** 2
  );
}

export function mods2Event(this: Game, h: Hero, kind: ModEvent): void {
  if (this.role === 'client' || h.left || h.player.dead || this.pvp?.phase === 'duel') return;
  h.synergy.event(kind);
  const ally =
    kind === 'parry'
      ? 'allyParry'
      : kind === 'perfectDash'
        ? 'allyDash'
        : kind === 'ultimate'
          ? 'allyUltimate'
          : null;
  if (!ally || !this.coop) return;
  for (const o of this.heroes) {
    if (o !== h && !o.left && !o.player.dead && nearby(h, o)) o.synergy.event(ally);
  }
}

/** Called before refreshLive; positional checks only run for the relevant owned Mods. */
export function mods2Position(this: Game, h: Hero): void {
  const syn = h.synergy;
  syn.nearWall =
    syn.needsWall && this.walls.hitCircle(h.player.x, h.player.z, mods2Tuning.wallRadius);
  syn.ownFire = false;
  if (syn.needsFire) {
    for (const w of h.weapons)
      if (w instanceof Fire && w.covers(h.player.x, h.player.z)) {
        syn.ownFire = true;
        break;
      }
  }
}

/** Applied after refreshLive; addition/cap before division avoids order-dependent aura stacking. */
export function mods2Auras(this: Game, h: Hero): void {
  if (h.player.dead || this.role === 'client') return;
  let reload = 0;
  for (const o of this.heroes)
    if (o !== h && !o.left && !o.player.dead && nearby(h, o)) reload += o.synergy.flags.allyReload;
  const speed = 1 + Math.min(mods2Tuning.reloadCap, reload);
  h.stats.cooldownMul /= speed;
  // Charge Shot fills a hold meter; the other right-clicks already use cooldownMul.
  if (h.loadoutPick.secondary === 'charge') h.stats.chargeSpeed *= speed;
}

export function mods2Crit(this: Game, e: Enemy, by: Hero): number {
  if (this.role === 'client' || e.burnT <= 0 || e.burnOwner === by.index) return 0;
  const owner = this.heroes[e.burnOwner];
  return owner && !owner.left && !owner.player.dead
    ? Math.min(mods2Tuning.burnCritCap, owner.synergy.flags.allyBurnCrit)
    : 0;
}

/** Actual recovery only: no overheal, no recursive sharing, no revived/disconnected recipients. */
export function mods2Heal(this: Game, by: Hero, healed: number): void {
  if (this.role === 'client' || healed <= 0) return;
  const share = healed * Math.min(0.2, by.synergy.flags.allySiphon);
  if (share <= 0) return;
  for (const h of this.heroes) {
    if (h === by || h.left || h.player.dead || !nearby(by, h)) continue;
    const gain = h.player.heal(share);
    if (gain > 0) this.vfx.num(h.player.x, 2.4, h.player.z, `+${+gain.toFixed(1)}`, 'heal');
  }
}
