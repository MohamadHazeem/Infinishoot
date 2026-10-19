import type { Game } from './game';
import { Team } from './bullets';
import { pilotGameplay } from './systems/gameplay';
import { pilotModes } from './systems/modes';
import { goldenPortalAt } from './systems/cinematics';
import { pilotHeroes3 } from './heroes3';
import { pvpFriendly } from './pvp';

/**
 * The autoplay brain: what a bot-driven hero wants to do this step. Shared by
 * the dev bot (src/dev/bot.ts: balance runs, smoke and co-op tests) and the
 * title screen's attract mode (src/game/systems/attract.ts), which turn the
 * intent into key presses or a scripted input. No cheats, no game state
 * changes: it only reads the world.
 *
 * It kites in a circle round the field centre, dodges enemy bullets, circles
 * the boss, shoots the boss (or the nearest enemy), holds right click in
 * bursts, dashes when cornered, fires the special when crowded, parries
 * bullets about to land and fires the ultimate with enemies close.
 */
export interface PilotIntent {
  /** Move direction (world x, z; not normalised). */
  mx: number;
  mz: number;
  /** What to aim at (world), or null when there is nothing to shoot. */
  target: { x: number; z: number } | null;
  /** Hold right click this step. */
  charge: boolean;
  dash: boolean;
  special: boolean;
  ult: boolean;
  parry: boolean;
  /** Combo cash-in tier to use this step (-1 = none; src/game/systems/gameplay.ts). */
  cash: number;
}

export class Autopilot {
  private rightT = 0;
  readonly out: PilotIntent = { mx: 0, mz: 0, target: null, charge: false, dash: false, special: false, ult: false, parry: false, cash: -1 };

  decide(g: Game): PilotIntent {
    const o = this.out;
    const p = g.player;
    let best = null as null | { x: number; z: number };
    let bd = 1e9;
    let ax = 0;
    let az = 0;
    for (const e of g.enemies.list) {
      // PvP: its own invisible stand-in isn't a target.
      if (!e.alive || pvpFriendly(g.pvp?.teams, e.pvpOwner, g.hero.index)) continue;
      const dx = p.x - e.x;
      const dz = p.z - e.z;
      const d = Math.hypot(dx, dz);
      if (d < bd) {
        bd = d;
        best = e;
      }
      if (d < 3.5) {
        ax += dx / (d * d + 0.1);
        az += dz / (d * d + 0.1);
      }
    }
    for (let i = 0; i < g.bullets.count; i++) {
      if (g.bullets.team[i] !== Team.Enemy) continue;
      const dx = p.x - g.bullets.x[i];
      const dz = p.z - g.bullets.z[i];
      const d = Math.hypot(dx, dz);
      if (d < 3) {
        ax += (dx / (d * d + 0.1)) * 2;
        az += (dz / (d * d + 0.1)) * 2;
      }
    }
    let boss = g.enemies.list.find((e) => e.active && e.def.boss);
    if (boss && !boss.alive) {
      // The Titan's core is sealed until its weak points break: go for the nearest open one (src/game/titan.ts).
      let wd = Infinity;
      for (const e of g.enemies.list) {
        const d = e.alive && e.def.titanPart ? Math.hypot(e.x - p.x, e.z - p.z) : Infinity;
        if (d < wd) [wd, boss] = [d, e];
      }
    }
    let mx: number;
    let mz: number;
    if (g.mode === 'portal') {
      // A flawless stage's golden portal beats the normal one (cinematics lane).
      const to = goldenPortalAt(g) ?? g.portal;
      mx = to.x - p.x;
      mz = to.z - p.z;
    } else if (boss) {
      // Circle the boss at a safe-ish distance.
      const dx = p.x - boss.x;
      const dz = p.z - boss.z;
      const d = Math.hypot(dx, dz) || 1;
      const want = (8 - d) * 0.3;
      mx = -dz / d + (dx / d) * want + ax * 3;
      mz = dx / d + (dz / d) * want + az * 3;
      best = boss;
    } else {
      // Orbit the field centre, pushed away from nearby threats.
      const r = Math.hypot(p.x, p.z) || 1;
      const radial = (14 - r) * 0.08;
      mx = -p.z / r + (p.x / r) * radial + ax * 3;
      mz = p.x / r + (p.z / r) * radial + az * 3;
    }
    // Supply crates and mech suits nearby, and combo cash-ins (gameplay lane).
    const mv = { mx, mz };
    if (g.mode !== 'portal') pilotHeroes3(g.hero.heroDef?.mech, p.x, p.z, mv, boss ?? null); // the Ronin fights up close (heroes3 lane; help ghosts drive a stand-in without a hero def)
    o.cash = pilotGameplay(g, mv, Math.hypot(ax, az) > 1);
    const aim = pilotModes(g, mv); // mini-games, the Pacifist road (modes lane)
    if (aim !== undefined) best = aim;
    o.mx = mv.mx;
    o.mz = mv.mz;
    o.target = best;
    // Right click: hold ~1.4 s (a full charge, or fire whenever a cooldown weapon is ready), then let go briefly.
    this.rightT = (this.rightT + 1 / 60) % 1.6;
    o.charge = !!best && this.rightT < 1.4 && g.mode !== 'portal'; // (a Ronin's dash-strike would carry it away from the portal)
    o.dash = bd < 1.3 && p.dashReady01 >= 1;
    o.special = g.hero.bombCharge >= 1 && Math.hypot(ax, az) > 1;
    // Skill layer: ultimate when charged with enemies close, parry when an enemy bullet is about to land.
    o.ult = g.hero.skill.ult >= 1 && bd < 8;
    o.parry = false;
    for (let i = 0; i < g.bullets.count; i++) {
      if (g.bullets.team[i] === Team.Enemy && Math.hypot(g.bullets.x[i] - p.x, g.bullets.z[i] - p.z) < 1.4) {
        o.parry = true;
        break;
      }
    }
    return o;
  }
}
