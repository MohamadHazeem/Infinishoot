import * as THREE from 'three';
import type { Game } from './game';
import type { Enemy, EnemyCtx } from './enemies';
import { hazardAt } from './hazards';
import { bossMoveTuning, enter, lockOn } from './bosses';
import { createRetroMaterial } from '../render/retroMaterial';
import { dangerLayer } from '../render/noiseGovernor';
import { commit } from '../render/instancing';
import { t, getLanguage } from '../i18n';
import { arabic2En as copy } from '../i18n/arabic2';

export type Act = 'crown' | 'brake' | 'brood' | 'scan';
export const actTuning = { window: 3.2, lastWindow: 2.8, radius: 1.55, hold: 0.45, stagger: 2.4, recoil: 0.22, lastRecoil: 0.28 };
export const isAct = (s: string): s is Act => s === 'crown' || s === 'brake' || s === 'brood' || s === 'scan';
const opening = { king: 'crown', rex: 'brake', queen: 'brood', omega: 'scan' } as const;
const music = {
  king: [0.75, 1, 1.25], rex: [1, 0.84, 0.67], queen: [1, 1.5, 1.26], omega: [1.26, 1, 0.63],
} as const;
const recoilOpts = { fixed: true, noStatus: true, source: 'arena' };

/** The brain owns the move, target, direction and remaining time. All four already travel
 * in bx + the enemy record and survive an ordinary pause. Only the authority resolves them. */
export class BossActs {
  private readonly tiles: THREE.InstancedMesh;
  private readonly matrix = new THREE.Matrix4();
  private readonly color = new THREE.Color();
  private readonly hint = document.createElement('div');
  private shown = '';
  private lang = '';
  constructor(private readonly g: Game, hud: HTMLElement) {
    this.hint.className = 'boss-act-hint';
    this.hint.style.cssText = 'width:fit-content;margin-inline:auto;padding-inline:calc(2 * var(--p));background:var(--ink);color:var(--cyan);font-size:calc(8 * var(--p));line-height:1.25;text-shadow:none';
    this.hint.hidden = true;
    hud.querySelector('#bossbar')?.appendChild(this.hint);
    this.tiles = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), createRetroMaterial({ unlit: 1 }), 160);
    this.tiles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.tiles.frustumCulled = false;
    this.tiles.count = 0;
    this.tiles.setColorAt(0, this.color);
    this.tiles.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    dangerLayer(this.tiles);
    g.scene.add(this.tiles);
  }

  /** Three pitched beats during the final roar, above the phase-three arrangement. */
  roar(e: Enemy, dt: number): void {
    const phrase = music[e.def.id as keyof typeof music];
    if (!phrase) return;
    for (let i = 0; i < phrase.length; i++) {
      const at = 1.28 - i * 0.48;
      if (e.roarT <= at || e.roarT - dt > at) continue;
      this.g.vfx.sound('droneRevive', NaN, NaN, phrase[i]);
      if (!i) {
        const move = opening[e.def.id as keyof typeof opening];
        this.g.vfx.banner(copy[`g4.last.${move}`], copy[`g4.hint.${move}`], 1.3);
      }
    }
  }

  begin(e: Enemy, move: Act, ctx: EnemyCtx, nx: number, nz: number): void {
    const g = this.g, p = ctx.target;
    const duration = e.phase === 3 ? actTuning.lastWindow : actTuning.window;
    e.move = move;
    e.action = 'summon';
    lockOn(e, nx, nz);
    e.vx = e.vz = e.burst = 0;
    e.targetX = p.x;
    e.targetZ = p.z;
    // Place the counterweight / brood beside the hero, or the brake post off Rex's axis.
    // Try both sides and reject candidates outside the shrinking duel or behind cover.
    if (move !== 'scan') {
      let placed = false;
      if (move === 'brood' && g.bossApi.hiveCount() >= bossMoveTuning.hiveMax) {
        let closest = Infinity;
        for (const hive of g.enemies.list) {
          if (!hive.active || hive.def.id !== 'hive') continue;
          const distance = Math.hypot(hive.x - p.x, hive.z - p.z);
          if (distance >= closest) continue;
          closest = distance;
          e.burst = hive.uid;
          e.targetX = hive.x;
          e.targetZ = hive.z;
          placed = true;
        }
        if (!placed) { this.rest(e, 0.3); return; }
      }
      for (let i = 0; i < 12 && !placed; i++) {
        const a = Math.atan2(nz, nx) + (i % 2 ? -1 : 1) * (move === 'brake' ? 0.52 : 1.5) + Math.floor(i / 2) * 0.85;
        const distance = move === 'brake' ? 6.8 : 4.2;
        const x = (move === 'brake' ? e.x : p.x) + Math.cos(a) * distance;
        const z = (move === 'brake' ? e.z : p.z) + Math.sin(a) * distance;
        const duel = g.bossDuel;
        if (duel && Math.hypot(x - duel.x, z - duel.z) > duel.r - 2) continue;
        if (hazardAt(g.arena.hazards, x, z) >= 0) continue;
        if (!g.bossApi.open(x, z, actTuning.radius) || !g.walls.segmentClear(p.x, p.z, x, z, 0.55)) continue;
        if (move === 'brake' && !g.walls.segmentClear(e.x, e.z, x, z, e.radius)) continue;
        if (move === 'brood' && !g.bossApi.plantHive(e, x, z)) continue;
        e.targetX = x;
        e.targetZ = z;
        placed = true;
      }
      if (!placed) { this.rest(e, 0.3); return; }
    }
    // The scan tracks eligible heroes individually during its last beat.
    if (move === 'scan') for (const h of g.heroes) if (!h.left && !h.player.dead) e.burst |= 1 << h.index;
    enter(e, 'windup', duration, -7, ctx);
  }

  private rest(e: Enemy, duration: number): void {
    e.move = '';
    e.vx = e.vz = 0;
    enter(e, 'recover', duration, 6);
  }

  private counter(e: Enemy, owner: number): void {
    this.rest(e, actTuning.stagger);
    e.exposeT = Math.max(e.exposeT, actTuning.stagger);
    this.g.vfx.ring(e.x, e.z, e.radius, 3, '#73eff7', 0.48);
    this.g.vfx.sound('shieldBreak', e.x, e.z);
    this.g.vfx.toast(copy['g4.counter'], 1.4);
    // Set recovery before damage: crossing a phase gate can replace it with a roar.
    const hero = this.g.heroes[owner];
    const credited = hero && !hero.left ? hero : this.g.heroes[this.nearest(e.x, e.z)] ?? this.g.hero;
    this.g.damage(e, e.maxHp * (e.phase === 3 ? actTuning.lastRecoil : actTuning.recoil), recoilOpts, credited);
  }

  step(e: Enemy, ctx: EnemyCtx, nx: number, nz: number): boolean {
    const g = this.g, move = e.move;
    e.vx = e.vz = 0;
    if (move === 'brakeRush') {
      if (e.state === 'windup') {
        if (e.t > 0) return true;
        enter(e, 'attack', 0.5, 8);
      }
      if (Math.hypot(e.x - e.targetX, e.z - e.targetZ) <= actTuning.radius + 0.35) {
        this.counter(e, e.burst); return true;
      }
      if (e.t <= 0) this.rest(e, 0.65);
      else { e.vx = e.lungeX * 24; e.vz = e.lungeZ * 24; g.bossApi.rampage(e, e.phase === 3); }
      return true;
    }
    if (move === 'brake') lockOn(e, nx, nz);
    for (const h of g.heroes) {
      const p = h.player;
      if (h.left || p.dead) continue;
      if (move === 'crown' && Math.hypot(p.x - e.targetX, p.z - e.targetZ) <= actTuning.radius) {
        this.counter(e, h.index); return true;
      }
      if (move === 'scan' && e.t <= actTuning.hold) {
        if ((p.vel.x * p.vel.x + p.vel.z * p.vel.z) > 0.45 || p.dashing) e.burst &= ~(1 << h.index);
        if (e.t <= 0 && (e.burst & (1 << h.index))) { this.counter(e, h.index); return true; }
      }
    }
    if (move === 'brood') {
      // Bind by UID when the warned hive lands. A later occupant of a pooled slot can't inherit it.
      let hive: Enemy | undefined;
      for (const h of g.enemies.list) if (h.active && h.def.id === 'hive' &&
        (e.burst ? h.uid === e.burst : Math.hypot(h.x - e.targetX, h.z - e.targetZ) < 0.7)) { hive = h; break; }
      if (hive) {
        e.burst = hive.uid;
        e.targetX = hive.x;
        e.targetZ = hive.z;
        const dx = hive.x - e.x, dz = hive.z - e.z;
        const dd = dx * dx + dz * dz || 1;
        for (const h of g.heroes) {
          if (h.left || h.player.dead) continue;
          const x = h.player.x - e.x, z = h.player.z - e.z;
          const along = (x * dx + z * dz) / dd;
          if (along > 0.18 && along < 0.85 && (x * dz - z * dx) ** 2 < dd * 0.85 ** 2) {
            g.enemies.kill(hive);
            this.counter(e, h.index); return true;
          }
        }
      } else if (e.burst || !this.hivePending(e)) {
        this.counter(e, this.nearest(e.targetX, e.targetZ)); return true;
      }
    }
    if (e.t > 0) return true;
    if (move === 'brake') {
      e.move = 'brakeRush';
      e.action = 'charge';
      e.burst = this.nearest(ctx.target.x, ctx.target.z);
      enter(e, 'windup', 0.85, -7, ctx);
      return true;
    }
    // A missed counter starts a marked pattern. No damage lands on the deadline.
    const p = ctx.target;
    if (move === 'crown') {
      for (let i = -1; i <= 1; i++) ctx.strike(p.x - nz * i * 3, p.z + nx * i * 3, 1.9, 1.1 + 0.15 * Math.abs(i), 18);
    } else if (move === 'brood') {
      g.bossApi.swarmWall(e, p.x, p.z);
    } else {
      for (let i = -2; i <= 2; i++) {
        ctx.strike(p.x + nx * i * 3, p.z + nz * i * 3, 1.6, 1.15, 20);
        if (i && e.phase === 3) ctx.strike(p.x - nz * i * 3, p.z + nx * i * 3, 1.6, 1.5, 20);
      }
    }
    this.rest(e, 0.45);
    return true;
  }

  private hivePending(e: Enemy): boolean {
    for (const h of this.g.bossField.pendingHives) if (h.x === e.targetX && h.z === e.targetZ) return true;
    return false;
  }

  private nearest(x: number, z: number): number {
    let best = 0, distance = Infinity;
    for (const h of this.g.heroes) {
      if (h.left || h.player.dead) continue;
      const d = (h.player.x - x) ** 2 + (h.player.z - z) ** 2;
      if (d < distance) { best = h.index; distance = d; }
    }
    return best;
  }

  private tile(x: number, z: number, size: number, color: string): void {
    const mesh = this.tiles;
    if (mesh.count >= mesh.instanceMatrix.count) return;
    this.matrix.makeScale(size, 0.12, size).setPosition(x, 0.18, z);
    mesh.setMatrixAt(mesh.count, this.matrix);
    mesh.setColorAt(mesh.count++, this.color.set(color));
  }

  private markRing(x: number, z: number, radius: number, color: string): void {
    for (let i = 0; i < 16; i++) {
      const angle = Math.PI * i / 8;
      this.tile(x + radius * Math.cos(angle), z + radius * Math.sin(angle), i % 4 ? 0.24 : 0.52, color);
    }
  }

  render(): void {
    const g = this.g, mesh = this.tiles;
    mesh.count = 0;
    let instruction = '';
    for (const e of g.bossField.bossesIn(g.enemies.list)) {
      if (e.state === 'windup' && (e.move === 'skipFork' || e.move === 'skipCentre')) {
        const fork = e.move === 'skipFork';
        const base = Math.atan2(e.lungeZ, e.lungeX);
        for (let side = fork ? -1 : 0; side <= (fork ? 1 : 0); side += 2) {
          const a = base + side * 0.3;
          for (let d = 2; d <= 9; d++) this.tile(e.x + Math.cos(a) * d, e.z + Math.sin(a) * d, 0.28, '#ef7d57');
        }
      }
      if (!isAct(e.move) && e.move !== 'brakeRush') continue;
      instruction = e.move === 'brakeRush' ? 'dodge' : e.move;
      if (e.move === 'scan') {
        const radius = 1.3 + Math.max(0, e.t - actTuning.hold);
        for (const h of g.heroes) {
          if (h.left || h.player.dead || (!g.localCoop && h !== g.hero)) continue;
          this.markRing(h.player.x, h.player.z, radius, '#73eff7');
        }
        continue;
      }
      const x = e.targetX, z = e.targetZ;
      const color = e.move === 'brood' ? '#ffcd75' : '#73eff7';
      this.markRing(x, z, actTuning.radius, color);
      if (e.move === 'crown') {
        for (let k = -1; k <= 1; k++) {
          this.tile(x + k * 0.45, z, 0.48, color);
          this.tile(x + k * 0.45, z - (k ? 0.33 : 0.55), 0.28, '#f4f4f4');
        }
      }
      if (e.move === 'brake' || e.move === 'brakeRush') {
        this.tile(x, z, 0.9, color);
        this.tile(x, z, 0.44, '#f4f4f4');
      }
      if (e.move === 'brake' || e.move === 'brood') {
        for (let k = e.move === 'brood' ? 2 : 1; k <= (e.move === 'brood' ? 6 : 7); k++) this.tile(e.x + (x - e.x) * k / 8, e.z + (z - e.z) * k / 8, 0.22, color);
      }
    }
    const lang = getLanguage();
    if (this.shown !== instruction || this.lang !== lang) {
      this.shown = instruction;
      this.lang = lang;
      this.hint.hidden = !instruction;
      this.hint.textContent = instruction ? t(`g4.hint.${instruction}`) : '';
    }
    if (!mesh.count) return;
    commit(mesh.instanceMatrix, mesh.count);
    if (mesh.instanceColor) commit(mesh.instanceColor, mesh.count);
  }
}
