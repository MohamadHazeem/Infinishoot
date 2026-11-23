import { Rng } from '../core/rng';
import { ENEMIES } from '../data/enemies';
import { RELIC_BY_ID } from '../data/relics';
import type { BiomeRulesDef } from '../data/biomeRules';
import { en } from '../i18n/en';
import { Team } from './bullets';
import type { Game } from './game';
import { beamReach } from './systems/enemyFamilies';

export type Chamber = 'vault' | 'shrine' | 'lair';
export type ChamberPhase = 'sealed' | 'open' | 'lit' | 'warning' | 'guarded' | 'claimed';

export function chamberRoll(seed: number): Chamber | null {
  const roll = new Rng(seed ^ 0x5345414c).next();
  return roll < 0.08 ? 'lair' : roll < 0.28 ? 'shrine' : roll < 0.86 ? 'vault' : null;
}

const distance2 = (x: number, z: number, px: number, pz: number) => (x - px) ** 2 + (z - pz) ** 2;
const OPEN_RADIUS = 1.35;

export class IslandChamber {
  phase: ChamberPhase = 'sealed';
  guardianUid = -1;
  private wait = 0;
  private challenger = -1;
  private petCueIn = 0;

  constructor(
    readonly kind: Chamber,
    readonly x: number,
    readonly z: number,
  ) {}

  private shot(g: Game, dt: number): boolean {
    const b = g.bullets;
    for (let i = 0; i < b.count; i++) {
      if (b.team[i] !== Team.Player) continue;
      const dx = b.vx[i] * dt,
        dz = b.vz[i] * dt;
      const t = Math.max(
        0,
        Math.min(1, ((this.x - b.x[i]) * dx + (this.z - b.z[i]) * dz) / (dx * dx + dz * dz || 1)),
      );
      if (distance2(this.x, this.z, b.x[i] + dx * t, b.z[i] + dz * t) < (1 + b.radius[i]) ** 2)
        return true;
    }
    // Lasers and rails have no projectile slot. Test the actual muzzle flash and its wall-clipped segment.
    for (const h of g.heroes) {
      if (h.left || h.player.dead) continue;
      const p = h.player,
        dx = this.x - p.x,
        dz = this.z - p.z;
      const along = dx * p.aim.x + dz * p.aim.z;
      if (along <= 0 || Math.abs(dx * p.aim.z - dz * p.aim.x) > 1) continue;
      for (const w of h.weapons) {
        if (
          (w.def.id === 'laser' || w.def.id === 'rail') &&
          w.muzzleT > 0 &&
          along <= w.p.range &&
          beamReach(p.x, p.z, p.aim.x, p.aim.z, along, g.arena.colliders) >= along - 0.2
        )
          return true;
      }
    }
    return false;
  }

  update(g: Game, def: BiomeRulesDef, dt: number): void {
    if (this.phase === 'claimed' || this.phase === 'guarded') return;
    if (this.phase === 'sealed') {
      if (!this.shot(g, dt)) {
        // A pet points out a nearby seam with a short trail. Following it to the door also opens it.
        this.petCueIn -= dt;
        let followed = false;
        for (const h of g.heroes) {
          if (h.left || h.player.dead || !h.petState.has) continue;
          const p = h.player,
            d2 = distance2(this.x, this.z, p.x, p.z);
          if (d2 < 2.25) followed = true;
          else if (d2 < 100 && this.petCueIn <= 0) {
            for (let i = 1; i <= 3; i++)
              g.vfx.ring(
                p.x + ((this.x - p.x) * i) / 4,
                p.z + ((this.z - p.z) * i) / 4,
                0.18,
                0.4,
                '#ffcd75',
                0.8,
              );
            this.petCueIn = 3;
          }
        }
        if (!followed) return;
      }
      this.phase = 'open';
      g.vfx.toast(en[`g7.open.${this.kind}`], 4);
      g.vfx.ring(this.x, this.z, 0.8, 4, '#ffcd75', 0.55);
      g.vfx.sound('chest', this.x, this.z);
      return;
    }
    if (this.phase === 'warning') {
      if (g.boss || g.director.bossSpawned || g.bossField.mini?.active || g.bossField.miniWarn) {
        this.phase = 'open';
        this.wait = 0;
        this.challenger = -1;
        return;
      }
      this.wait -= dt;
      if (this.wait > 0) return;
      // Never land on a hero, even if a teammate walks into the warning at the last instant.
      for (const h of g.heroes)
        if (!h.left && !h.player.dead && distance2(this.x, this.z, h.player.x, h.player.z) < 16) {
          this.wait = 0.6;
          g.vfx.zone(this.x, this.z, 4, this.wait);
          return;
        }
      const guard = g.enemies.spawn(
        ENEMIES[def.guardian],
        this.x,
        this.z,
        g.spawnOpts({ hpMul: g.director.bossHpMul * 0.6 }),
      );
      this.guardianUid = guard.uid;
      this.phase = 'guarded';
      g.bossField.mini = guard;
      return;
    }
    const padX = this.x + (this.kind === 'shrine' ? (this.phase === 'lit' ? 1.5 : -1.5) : 0);
    let occupant = -1;
    for (const h of g.heroes) {
      if (
        h.left ||
        h.player.dead ||
        distance2(padX, this.z, h.player.x, h.player.z) > OPEN_RADIUS ** 2
      )
        continue;
      occupant = h.index;
      if (
        this.kind === 'lair' &&
        (h.player.speed > 0.4 ||
          g.boss ||
          g.bossField.mini?.active ||
          g.bossField.miniWarn ||
          g.director.bossSpawned ||
          g.director.duration - g.director.time < 20)
      ) {
        occupant = -1;
        continue;
      }
      break;
    }
    if (this.kind === 'lair') {
      if (this.challenger !== occupant) this.wait = 0;
      this.challenger = occupant;
      if (occupant < 0 || (this.wait += dt) < 1.5) return;
      this.phase = 'warning';
      this.wait = 2.5;
      g.vfx.zone(this.x, this.z, 4, this.wait);
      g.vfx.toast(en['g7.lair.warn'], 3);
      g.vfx.sound('elite', this.x, this.z);
    } else if (occupant >= 0) {
      if (this.kind === 'shrine' && this.phase === 'open') {
        this.phase = 'lit';
        g.vfx.sound('gem', padX, this.z);
      } else this.claim(g, def);
    }
  }

  guardianKilled(g: Game, uid: number, def: BiomeRulesDef): void {
    if (this.phase === 'guarded' && this.guardianUid === uid) this.claim(g, def);
  }

  private claim(g: Game, def: BiomeRulesDef): void {
    this.phase = 'claimed';
    let awardedRelic = false;
    for (const h of g.heroes) {
      if (h.left) continue;
      if (this.kind === 'vault' && !h.hasRelic('r_ironheart')) {
        h.relics.push('r_ironheart');
        h.recomputeStats();
        if (!h.player.dead) h.player.heal(30);
        h.loadoutDirty = true;
      }
      if (this.kind === 'lair' && !h.hasRelic(def.relic)) {
        awardedRelic = true;
        h.relics.push(def.relic);
        h.recomputeStats();
        h.loadoutDirty = true;
      } else h.gold += this.kind === 'vault' ? 2 : this.kind === 'shrine' ? 4 : 12;
    }
    g.vfx.sound('chest', this.x, this.z);
    g.vfx.toast(
      this.kind === 'lair'
        ? awardedRelic
          ? RELIC_BY_ID[def.relic].name
          : en['g7.prize.duplicate']
        : en[this.kind === 'vault' ? 'g7.prize.vault' : 'g7.prize.shrine'],
      3,
    );
  }
}
