/**
 * Co-op revives.
 * Split out of src/game/game.ts: these are Game methods (`this` is the Game),
 * installed on the class as fields, e.g. `reviveHero = Coop.reviveHero;`.
 */
import type { Game } from '../game';
import { REVIVE_TIME, REVIVE_RANGE } from '../game';
import { Hero } from '../hero';
import { reviveHelperMul } from '../eightp';

export function reviveHero(this: Game, h: Hero, hpFrac: number, effects = true): void {
  const p = h.player;
  p.dead = false;
  p.hp = Math.max(1, p.maxHp * hpFrac);
  p.invuln = 2;
  p.rig.root.visible = true;
  h.reviveT = 0;
  if (effects) {
    this.vfx.ring(p.x, p.z, 1, 6, '#7dffb0', 0.4);
    this.vfx.burst(p.x, 1, p.z, { count: 24, color: '#7dffb0', color2: '#ffffff', speed: [3, 8], size: [0.12, 0.3], life: [0.4, 0.8], up: 6, gravity: 10 });
    this.vfx.num(p.x, 2.6, p.z, 'REVIVED!', 'heal');
    this.vfx.sound('powerUp', p.x, p.z);
  }
}

/** Stand next to a downed teammate to revive them. */
export function updateRevives(this: Game, dt: number): void {
  for (const h of this.heroes) {
    if (!h.player.dead || h.left) continue;
    const helpers = this.aliveHeroes.filter((o) => Math.hypot(o.player.x - h.player.x, o.player.z - h.player.z) < REVIVE_RANGE);
    // Guardian Angel on a helper: faster revives, more life on getting up.
    const speed = (1 + Math.max(0, ...helpers.map((o) => o.stats.reviveSpeed))) * reviveHelperMul(helpers.length, this.heroes.length); // eightp: extra helpers in 5-8 teams
    const hp = Math.min(1, 0.4 + Math.max(0, ...helpers.map((o) => o.stats.reviveHp)));
    h.reviveT = helpers.length ? h.reviveT + dt * speed : Math.max(0, h.reviveT - dt * 0.5);
    if (h.reviveT >= REVIVE_TIME) {
      this.mvpRevive(h, helpers);
      this.reviveHero(h, hp);
      // Teamwork: rescuer and rescued both get a burst of invincibility.
      h.player.invuln = Math.max(h.player.invuln, 3);
      for (const o of helpers) {
        o.player.invuln = Math.max(o.player.invuln, 3);
        o.player.happyT = 1.5;
        this.vfx.num(o.player.x, 2.8, o.player.z, 'TEAMWORK!', 'heal');
        this.vfx.ring(o.player.x, o.player.z, 1, 4, '#ffcd75', 0.35);
      }
      this.clutchRevive(h, helpers); // time lane: a last-second rescue gets its cutscene (before the high-five heals)
      this.highFive(h, helpers); // companion lane: high-five heals both
    }
  }
}
