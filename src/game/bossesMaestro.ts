import type { Game } from './game';
import type { Enemy } from './enemies';
import { ENEMIES, type EnemyDef } from '../data/enemies';
import { refreshEnemyRegistry } from '../net/codec';
import { ENEMY_TIPS } from '../data/bestiary';
import { ENEMY_LORE2 } from '../data/codex2';
import { en } from '../i18n/en';

export const maestroTuning = { radius: 1.8, damage: 16, spacing: 4.8, routeChance: 0.25 };

export function registerMaestro(): void {
  if (ENEMIES.maestro || Object.keys(ENEMIES).length >= 256) return;
  // Append after the existing roster so previous snapshot indices keep their meaning.
  ENEMIES.maestro = {
    ...ENEMIES.king, id: 'maestro', name: en['beat.maestro'], title: en['beat.subtitle'], model: 'dj',
    remixLines: [en['beat.phase2'], en['beat.phase3']], weakPoint: 'core', secret: true,
    hp: 2100, speed: 2.8, radius: 1.7, bodyColor: '#3b5dc9', accentColor: '#ffcd75', contactDamage: 0,
  };
  ENEMY_TIPS.maestro = en['beat.tip'];
  ENEMY_LORE2.maestro = en['beat.lore'];
  refreshEnemyRegistry();
}

export function maestroRoute(seed: number, stage: number, road: string): boolean {
  if (stage < 2 || stage % 4 === 0 || road !== 'rhythm') return false;
  let h = Math.imul(seed ^ Math.imul(stage, 0x9e3779b1), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 16), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 0x100000000 < maestroTuning.routeChance;
}

export function routeConductor(g: Game, def: EnemyDef): EnemyDef {
  if (!ENEMIES.maestro || g.pvp || (g.runMode !== 'standard' && g.runMode !== 'endless') ||
      g.stage % 4 === 0 || !['king', 'rex', 'queen'].includes(def.id)) return def;
  return g.beatCombat.forceMaestro || maestroRoute(g.seed, g.stage, g.routeKind()) ? ENEMIES.maestro : def;
}

type Strike = Game['strikes'][number];
/** A bar opens on the downbeat. The target and the entire phrase are visible before its first accent. */
export class MaestroScore {
  private uid = -1;
  private phase = 0;
  private bar = -1;
  private lastTime = 0;
  private readonly notes: { strike: Strike; beat: number }[] = [];
  private readonly markers = Array.from({ length: 3 }, () => ({ x: 0, z: 0, r: maestroTuning.radius, t: 0, life: 1 }));

  // These same three discs feed the game's existing instanced danger renderer on either peer.
  // A fresh snapshot is sufficient to show a phrase to a player joining midway through the bar.
  private marker(g: Game, i: number, x: number, z: number, beat: number): void {
    const m = this.markers[i];
    m.x = x;
    m.z = z;
    m.life = (beat % 4 || 4) * 60 / g.beatCombat.bpm;
    m.t = Math.max(1 / 60, (beat - g.beatCombat.beat) * 60 / g.beatCombat.bpm);
    if (!g.enemies.zones.includes(m)) g.enemies.zones.push(m);
  }

  private hideFrom(g: Game, start: number): void {
    for (let i = start; i < this.markers.length; i++) {
      const index = g.enemies.zones.indexOf(this.markers[i]);
      if (index >= 0) g.enemies.zones.splice(index, 1);
    }
  }

  snapshot(): number[] | undefined {
    if (!this.notes.length) return undefined;
    const out: number[] = [];
    for (const { strike, beat } of this.notes) out.push(strike.x, strike.z, beat);
    return out;
  }

  mirror(g: Game, raw: unknown): void {
    const count = Array.isArray(raw) ? Math.min(3, Math.floor(raw.length / 3)) : 0;
    if (Array.isArray(raw)) for (let i = 0; i < count; i++)
      this.marker(g, i, raw[i * 3], raw[i * 3 + 1], raw[i * 3 + 2]);
    this.hideFrom(g, count);
  }

  private clear(g: Game): void {
    for (const note of this.notes) {
      const i = g.strikes.indexOf(note.strike);
      if (i >= 0) g.strikes.splice(i, 1);
    }
    this.notes.length = 0;
    this.hideFrom(g, 0);
  }

  step(g: Game, dt: number): void {
    const e = g.boss;
    if (g.runTime < this.lastTime) {
      // Rewind recreates strike records. Discard the old phrase and give a fresh count-in.
      for (let i = g.strikes.length - 1; i >= 0; i--)
        if (g.strikes[i].cause === en['beat.strike']) g.strikes.splice(i, 1);
      this.uid = -1;
    }
    this.lastTime = g.runTime;
    if (!e?.alive || e.def.id !== 'maestro' || e.roarT > 0 || e.state === 'spawning' || g.mode !== 'fight') {
      if (this.notes.length) this.clear(g);
      this.uid = -1;
      return;
    }
    const { beat, bpm } = g.beatCombat;
    const bar = Math.floor(beat / 4);
    if (e.uid !== this.uid || e.phase !== this.phase) {
      this.clear(g);
      this.uid = e.uid;
      this.phase = e.phase;
      this.bar = bar; // count in to the next full bar after a roar
    }
    if (bar !== this.bar) {
      this.bar = bar;
      // Never play a backlog after a freeze. Leave two whole beats of warning.
      if (beat - bar * 4 < 0.12) this.phrase(g, e, bar * 4);
    }
    for (let i = this.notes.length - 1; i >= 0; i--) {
      const note = this.notes[i];
      const left = (note.beat - beat) * 60 / bpm;
      // updateStrikes consumes dt immediately after this pass. Its hazards remain readable
      // to the skilled pilot, and the ordinary strike pipeline applies damage exactly once.
      note.strike.t = dt + Math.max(0, left);
      if (left <= 0) {
        if (left < -0.05) {
          const index = g.strikes.indexOf(note.strike);
          if (index >= 0) g.strikes.splice(index, 1); // skip an accent missed during a hit-stop
        }
        this.notes.splice(i, 1);
      }
    }
    for (let i = 0; i < this.notes.length; i++) {
      const { strike, beat: due } = this.notes[i];
      this.marker(g, i, strike.x, strike.z, due);
    }
    this.hideFrom(g, this.notes.length);
  }

  private phrase(g: Game, e: Enemy, downbeat: number): void {
    let closest = Infinity;
    let target;
    for (const h of g.heroes) {
      if (h.left || h.player.dead) continue;
      const d = Math.hypot(h.player.x - e.x, h.player.z - e.z);
      if (d < closest) { target = h.player; closest = d; }
    }
    if (!target) return;
    const x = target.x, z = target.z;
    const sideX = -(z - e.z) / (closest || 1) * maestroTuning.spacing;
    const sideZ = (x - e.x) / (closest || 1) * maestroTuning.spacing;
    const note = (px: number, pz: number, accent: number) => {
      const beat = downbeat + accent;
      const delay = (beat - g.beatCombat.beat) * 60 / g.beatCombat.bpm;
      const strike = { x: px, z: pz, r: maestroTuning.radius, t: delay, dmg: maestroTuning.damage * e.dmgMul, cause: en['beat.strike'] };
      g.strikes.push(strike);
      this.notes.push({ strike, beat });
    };
    note(x, z, 2);
    const voices = Math.min(3, e.phase + (g.director.enrageStep > 1 ? 1 : 0));
    if (voices >= 2) {
      const side = this.bar % 2 ? 1 : -1;
      note(x + side * sideX, z + side * sideZ, 3);
      if (voices >= 3) note(x - side * sideX, z - side * sideZ, 3);
    }
    e.squash(7);
    g.vfx.sound('bossWindup', e.x, e.z);
  }
}
