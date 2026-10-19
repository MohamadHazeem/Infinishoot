/** Cross-lane projectile allegiance, shared by defensive weapons and skill checks. */
import type { Game } from '../game';
import { Team } from '../bullets';
import { pvpFriendly } from '../pvp';

export function hostileBullet(g: Game, hero: number, bullet: number): boolean {
  const b = g.bullets;
  if (b.team[bullet] === Team.Enemy) return true;
  const owner = b.owner[bullet];
  return g.pvp?.phase === 'duel' && b.team[bullet] === Team.Player && owner >= 0 && owner < g.heroes.length && !pvpFriendly(g.pvp.teams, owner, hero);
}

/** Team counters are absolute so repeated snapshots and reconnects cannot double goals. */
export function applyFollowupsNet(g: Game, raw: unknown): void {
  if (!Array.isArray(raw) || raw.length !== 2 || !raw.every((n) => Number.isSafeInteger(n) && n >= 0)) return;
  g.elitesRun = raw[0];
  g.bossesRun = raw[1];
}
