import * as THREE from 'three';
import { Rng } from '../core/rng';
import { biomeForStage } from '../data/biomes';
import { ISLAND_RULES, TERRAIN, type BiomeRulesDef, type TerrainKind } from '../data/biomeRules';
import { commit } from '../render/instancing';
import { createRetroMaterial } from '../render/retroMaterial';
import { t } from '../i18n';
import { bossLike } from './bossRules';
import { Team } from './bullets';
import type { Enemy } from './enemies';
import type { Game } from './game';
import { PickupType } from './pickups';
import { save, persist, saveLock } from './save';
import { settings } from './settings';
import { customArenaActive } from './systems/editor';
import { chamberRoll, IslandChamber, type Chamber, type ChamberPhase } from './secrets2';

type Point = { x: number; z: number };
type Patch = Point & { kind: TerrainKind; cooldown: number };
interface FieldNet {
  seed: number;
  biome: string;
  xy: number[];
  kind: Chamber | null;
  phase: ChamberPhase;
  guard: number;
  finds: number;
}
const RADIUS = 2.5;
const PULSE = 0.2;
const inside = (p: Point, x: number, z: number, radius: number) =>
  (p.x - x) ** 2 + (p.z - z) ** 2 <= radius ** 2;

/** A separate RNG stream. Reserve complete footprints so props, hazards and objective pads stay playable. */
function site(g: Game, rng: Rng, occupied: Point[], near: boolean): Point | null {
  for (let i = 0; i < 320; i++) {
    const angle = rng.range(0, Math.PI * 2);
    const radius =
      i < 160 ? rng.range(near ? 6 : 8, near ? 10 : 24) : rng.range(11, g.arena.halfSize - 4);
    const x = Math.round(Math.cos(angle) * radius * 2) / 2,
      z = Math.round(Math.sin(angle) * radius * 2) / 2;
    if (Math.max(Math.abs(x), Math.abs(z)) + 3 >= g.arena.halfSize || g.walls.hitCircle(x, z, 3.5))
      continue;
    if (
      occupied.some((p) => inside(p, x, z, 6)) ||
      g.arena.hazards.some((p) => inside(p, x, z, p.r + 3))
    )
      continue;
    if (
      g.arena.pads.some((p) => inside(p, x, z, 4) || inside({ x: p.tx, z: p.tz }, x, z, 4)) ||
      g.arena.turrets.some((p) => inside(p, x, z, 4)) ||
      g.arena.spots.some((p) => inside(p, x, z, 4)) ||
      g.arena.chests.some((p) => inside(p, x, z, 4)) ||
      g.arena.conveyors.some(
        (p) => Math.abs(p.x - x) < p.w / 2 + 3 && Math.abs(p.z - z) < p.d / 2 + 3,
      )
    )
      continue;
    return { x, z };
  }
  return null;
}

function drawField(
  g: Game,
  patches: Patch[],
  room: IslandChamber | null,
  def: BiomeRulesDef,
  mesh?: THREE.InstancedMesh,
): THREE.InstancedMesh {
  if (!mesh) {
    mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(),
      createRetroMaterial({ unlit: 0.32 }),
      112,
    );
    mesh.name = 'Island terrain and vault';
    g.arena.group.add(mesh);
    // disposeObject owns geometry/material; dispose instance attributes with the same arena.
    const batch = mesh;
    mesh.geometry.addEventListener('dispose', () => batch.dispose());
  }
  const m = new THREE.Matrix4(),
    c = new THREE.Color();
  let n = 0;
  const box = (x: number, y: number, z: number, w: number, h: number, d: number, color: string) => {
    m.makeScale(w, h, d).setPosition(x, y, z);
    mesh.setMatrixAt(n, m);
    mesh.setColorAt(n++, c.set(color));
  };
  for (const p of patches) {
    const { ink, glyph } = TERRAIN[p.kind];
    // Inlaid stone corners leave the floor and enemy telegraphs visible between them.
    for (const a of [-1, 1])
      for (const b of [-1, 1]) {
        box(p.x + a * 1.7, 0.085, p.z + b * 1.7, 0.68, 0.12, 0.68, def.stone);
        box(p.x + a * 1.7, 0.16, p.z + b * 1.7, 0.32, 0.08, 0.32, ink);
      }
    // A little terrain silhouette at the back of each inlay reads above the grass at low resolution.
    const x = p.x,
      z = p.z - 1.7;
    switch (p.kind) {
      case 'roots':
        for (const side of [-1, 1]) {
          box(x + side * 0.38, 0.22, z, 0.25, 0.44, 0.24, '#946153');
          box(x + side * 0.56, 0.49, z, 0.53, 0.24, 0.34, ink);
          box(x + side * 0.26, 0.65, z, 0.28, 0.24, 0.25, '#a7f070');
        }
        break;
      case 'prism':
      case 'ice':
        for (let i = 0; i < 3; i++) {
          const height = i === 1 ? 0.95 : 0.5;
          box(x + (i - 1) * 0.44, height / 2, z + i * 0.08, 0.38, height, 0.4, ink);
          box(x + (i - 1) * 0.44, height + 0.08, z + i * 0.08, 0.2, 0.16, 0.2, '#f4f4f4');
        }
        break;
      case 'magnet':
      case 'shelter':
        for (const side of [-1, 1]) {
          box(x + side * 0.42, 0.38, z, 0.34, 0.74, 0.38, ink);
          box(x + side * 0.42, 0.77, z, 0.34, 0.14, 0.38, '#f4f4f4');
        }
        box(x, p.kind === 'shelter' ? 0.9 : 0.19, z, 1.2, 0.27, 0.42, ink);
        break;
      case 'tide':
      case 'spring':
        for (let i = 0; i < 3; i++)
          box(
            x,
            0.17 + 0.2 * i,
            z,
            1.25 - 0.3 * i,
            0.22,
            0.95 - 0.23 * i,
            i === 1 ? def.stone : ink,
          );
        break;
    }
    box(p.x, 0.06, p.z, 1.7, 0.09, 1.7, def.stone);
    for (let j = 0; j < 3; j++)
      for (let i = 0; i < 3; i++)
        if (glyph[j][i] === '1')
          box(p.x + (i - 1) * 0.42, 0.13, p.z + (j - 1) * 0.42, 0.44, 0.08, 0.44, ink);
  }
  if (room) {
    const { x, z, phase, kind } = room;
    box(x, 0.08, z, 4.7, 0.16, 3.5, def.stone);
    for (const side of [-1, 1]) {
      box(x + 2.1 * side, 0.4, z, 0.38, 0.7, 3.5, def.stone);
      box(x + 1.45 * side, 0.62, z - 1.45, 0.6, 1.22, 0.6, '#566c86');
      box(x + 1.45 * side, 1.28, z - 1.45, 0.8, 0.18, 0.8, '#ffcd75');
    }
    if (phase === 'sealed') {
      box(x, 0.78, z, 2.6, 1.48, 0.85, def.stone);
      box(x, 1.56, z, 2.9, 0.2, 1.05, '#94b0c2');
      for (const face of [-1, 1]) {
        box(x - 0.18, 1.27, z + face * 0.44, 0.16, 0.46, 0.05, '#ffcd75');
        box(x, 1.03, z + face * 0.44, 0.5, 0.12, 0.05, '#ffcd75');
        box(x + 0.18, 0.68, z + face * 0.44, 0.15, 0.6, 0.05, '#ffcd75');
      }
    } else if (kind === 'shrine') {
      for (const side of [-1, 1]) {
        const lit = phase === 'claimed' || (phase === 'open' ? side === -1 : side === 1);
        box(x + 1.5 * side, 0.22, z, 1.25, 0.18, 1.25, lit ? '#ffcd75' : '#566c86');
        for (let i = 0; i < (side === -1 ? 1 : 2); i++)
          box(
            x + side * 1.5 + i * 0.4 - (side === 1 ? 0.2 : 0),
            0.34,
            z,
            0.18,
            0.09,
            0.6,
            '#29366f',
          );
      }
    } else if (kind === 'lair') {
      box(x, 0.35, z, 1.8, 0.38, 1.4, '#ffcd75');
      for (const i of [-1, 0, 1])
        box(x + 0.65 * i, 0.68, z, 0.35, 0.45, 0.55, phase === 'claimed' ? '#94b0c2' : '#ffcd75');
    } else {
      box(x, 0.36, z, 1.4, 0.44, 0.95, '#29366f');
      box(
        x,
        phase === 'claimed' ? 0.72 : 0.61,
        z - (phase === 'claimed' ? 0.45 : 0),
        1.45,
        phase === 'claimed' ? 0.65 : 0.22,
        phase === 'claimed' ? 0.16 : 1,
        '#ffcd75',
      );
    }
  }
  mesh.count = n;
  commit(mesh.instanceMatrix, n);
  if (mesh.instanceColor) commit(mesh.instanceColor, n);
  mesh.computeBoundingSphere();
  return mesh;
}

/** Authority owns rolls, contacts, kills and rewards. Clients only build the mirrored model and local tips. */
export class IslandField {
  private arena: Game['arena'] | null = null;
  private def?: BiomeRulesDef;
  private patches: Patch[] = [];
  private mesh?: THREE.InstancedMesh;
  private drawn?: ChamberPhase;
  private wire?: FieldNet;
  private pulse = 0;
  private tipWait = 0;
  private near: Enemy[] = [];
  private mirrored = false;
  private sent = new WeakMap<object, { field: FieldNet; at: number }>();
  room: IslandChamber | null = null;
  finds = 0;

  reset(): void {
    this.finds = 0;
    this.arena = null;
    this.wire = undefined;
    this.room = null;
    this.mirrored = false;
  }

  installView(g: Game): void {
    const render = g.render.bind(g);
    g.render = (alpha, dt) => {
      // Three creates UUIDs using Math.random. Keep that work on the presentation RNG in replays.
      if (
        this.arena === g.arena &&
        this.wire &&
        this.def &&
        (!this.mesh || this.drawn !== this.wire.phase)
      ) {
        this.mesh = drawField(g, this.patches, this.room, this.def, this.mesh);
        this.drawn = this.wire.phase;
      }
      render(alpha, dt);
    };
  }

  snapshot(g: Game): FieldNet | undefined {
    return this.arena === g.arena ? this.wire : undefined;
  }

  /** A drop-in gets a full layout on its first packet. Refresh after two seconds for a reconnected peer. */
  snapshotFor(g: Game, recipient: object): FieldNet | undefined {
    const field = this.snapshot(g);
    if (!field) return;
    const last = this.sent.get(recipient);
    if (last?.field === field && g.stepN - last.at < 120) return;
    this.sent.set(recipient, { field, at: g.stepN });
    return field;
  }

  preview(g: Game, site: string | null): void {
    if (!site || g.role !== 'solo' || g.mode !== 'fight') return;
    if (this.arena !== g.arena) this.prepare(g);
    const index = site === 'door' ? 6 : /^[1-3]$/.test(site) ? (Number(site) - 1) * 2 : -1;
    const pos = this.wire?.xy;
    if (pos && index >= 0 && index < pos.length && pos[index] !== 127)
      g.player.teleport(pos[index], pos[index + 1] + (site === 'door' ? 2.5 : 0));
  }

  private prepare(g: Game): void {
    this.arena = g.arena;
    this.room = null;
    this.mesh = undefined;
    this.wire = undefined;
    this.patches = [];
    this.pulse = 0;
    this.tipWait = 0;
    const b = biomeForStage(g.arenaStage);
    this.def = b.rules;
    if (
      !this.def ||
      g.pvp ||
      g.versus ||
      g.onboarding.training ||
      customArenaActive(g) ||
      g.runMode === 'raid' ||
      g.runMode === 'bossrush' ||
      g.runMode === 'gauntlet'
    )
      return;
    const rng = new Rng(g.arena.seed ^ 0x54494c45),
      used: Point[] = [],
      xy: number[] = [];
    const kind = chamberRoll(g.arena.seed);
    const door = kind && site(g, rng, used, true);
    if (door && kind) {
      this.room = new IslandChamber(kind, door.x, door.z);
      used.push(door);
    }
    for (const effect of this.def.terrain) {
      const p = site(g, rng, used, false);
      if (p) {
        used.push(p);
        this.patches.push({ ...p, kind: effect, cooldown: 0 });
      }
      xy.push(p?.x ?? 127, p?.z ?? 127);
    }
    if (door) xy.push(door.x, door.z);
    this.wire = {
      seed: g.arena.seed,
      biome: b.id,
      xy,
      kind: this.room?.kind ?? null,
      phase: 'sealed',
      guard: -1,
      finds: this.finds,
    };
  }

  mirror(g: Game, raw: unknown): void {
    const n = raw as FieldNet | undefined;
    if (!n || n.seed !== g.arena.seed || !ISLAND_RULES[n.biome]) return;
    if (this.arena !== g.arena || !this.wire) {
      this.arena = g.arena;
      this.def = ISLAND_RULES[n.biome];
      this.mesh = undefined;
      this.patches = [];
      this.tipWait = 0;
      for (let i = 0; i < 3; i++)
        if (n.xy[i * 2] !== 127)
          this.patches.push({
            x: n.xy[i * 2],
            z: n.xy[i * 2 + 1],
            kind: this.def.terrain[i],
            cooldown: 0,
          });
      this.room = n.kind ? new IslandChamber(n.kind, n.xy[6], n.xy[7]) : null;
    }
    this.wire = n;
    this.finds = n.finds;
    this.mirrored = true;
    if (this.room) {
      this.room.phase = n.phase;
      this.room.guardianUid = n.guard;
    }
  }

  private changed(before: ChamberPhase | undefined): void {
    if (!this.room || !this.wire || this.room.phase === before) return;
    if (before === 'sealed') this.finds++;
    this.wire = {
      ...this.wire,
      phase: this.room.phase,
      finds: this.finds,
      guard: this.room.guardianUid,
    };
  }

  kill(g: Game, uid: number): void {
    if (
      this.room?.phase !== 'guarded' ||
      this.room.guardianUid !== uid ||
      this.arena !== g.arena ||
      !g.authority ||
      !this.def
    )
      return;
    this.room.guardianKilled(g, uid, this.def);
    this.changed('guarded');
  }

  update(g: Game, dt: number): void {
    if (!g.authority || g.mode !== 'fight') return;
    if (this.arena !== g.arena) this.prepare(g);
    if (!this.wire || !this.def) return;
    // A promoted host rebuilds enemies with fresh UIDs. Rebind the lair to that mini-boss;
    // if the migration checkpoint predates the spawn, the crown can be challenged again.
    if (this.mirrored) {
      this.mirrored = false;
      const room = this.room;
      if (room?.phase === 'warning' || room?.phase === 'guarded') {
        const mini = g.bossField.mini;
        if (room.phase === 'guarded' && mini?.active && mini.def.id === this.def.guardian)
          room.guardianUid = mini.uid;
        else {
          const old = room.phase;
          room.phase = 'open';
          room.guardianUid = -1;
          this.changed(old);
        }
        this.wire = { ...this.wire, guard: room.guardianUid };
      }
    }
    const before = this.room?.phase;
    this.room?.update(g, this.def, dt);
    this.changed(before);
    this.pulse += dt;
    if (this.pulse < PULSE) return;
    for (const patch of this.patches) this.apply(g, patch, this.pulse);
    this.tips(g, this.pulse);
    this.pulse = 0;
  }

  tips(g: Game, dt: number): void {
    if (
      this.arena !== g.arena ||
      !this.wire ||
      !settings.tips ||
      g.mode !== 'fight' ||
      g.hero.player.dead ||
      g.screens.current !== 'none'
    )
      return;
    if ((this.tipWait -= dt) > 0) return;
    this.tipWait = 0.5;
    const p = g.hero.player;
    const show = (key: string) => {
      if (save.tips.includes(key)) return false;
      save.tips.push(key);
      if (!saveLock.on) persist();
      g.hud.toast(t(key), 4.5);
      this.tipWait = 6;
      return true;
    };
    if (this.room?.phase === 'sealed' && inside(this.room, p.x, p.z, 7) && show('g7.crack')) return;
    for (const patch of this.patches)
      if (inside(patch, p.x, p.z, 5) && show(TERRAIN[patch.kind].tip)) return;
  }

  private apply(g: Game, p: Patch, dt: number): void {
    p.cooldown = Math.max(0, p.cooldown - dt);
    if (p.kind === 'shelter' || p.kind === 'spring' || p.kind === 'magnet') {
      if (p.cooldown > 0) return;
      for (const h of g.heroes) {
        if (h.left || h.player.dead || !inside(p, h.player.x, h.player.z, RADIUS)) continue;
        if (p.kind === 'spring') {
          h.bombCharge = Math.min(1, h.bombCharge + 0.035 * dt);
          continue;
        }
        if (p.kind === 'magnet') {
          const loot = g.pickups;
          for (let i = 0; i < loot.count; i++)
            if (
              loot.type[i] === PickupType.Gem &&
              !loot.pulled[i] &&
              inside(p, loot.x[i], loot.z[i], 8)
            )
              loot.pulled[i] = 1;
        } else {
          const b = g.bullets;
          for (let i = 0; i < b.count; i++)
            if (b.team[i] === Team.Enemy && inside(p, b.x[i], b.z[i], RADIUS + 1)) {
              g.vfx.ring(b.x[i], b.z[i], 0.35, 1, '#73eff7', 0.25);
              b.kill(i);
              p.cooldown = 1.6;
              break;
            }
        }
        break;
      }
      return;
    }
    for (const e of g.enemiesInRadius(p.x, p.z, RADIUS, this.near)) {
      if (!e.targetable || bossLike(e) || e.def.behavior === 'reaper' || e.def.hidden) continue;
      if (p.kind === 'roots') {
        e.slowAmt = Math.max(e.slowT > 0 ? e.slowAmt : 0, 0.35);
        e.slowT = Math.max(e.slowT, PULSE + 0.1);
      } else if (p.kind === 'prism') {
        e.exposeT = Math.max(e.exposeT, 0.8);
      } else if (p.kind === 'tide') {
        if (p.cooldown > 0) continue;
        const dx = e.x - p.x,
          dz = e.z - p.z,
          d = Math.hypot(dx, dz) || 1;
        e.kx += (dx * 7) / d;
        e.kz += (dz * 7) / d;
      } else if (p.kind === 'ice') {
        const speed = Math.hypot(e.vx, e.vz);
        if (speed > 0.5 && e.kx * e.kx + e.kz * e.kz < 4) {
          e.kx = (4 * e.vx) / speed;
          e.kz = (4 * e.vz) / speed;
        }
      }
    }
    if (p.kind === 'tide' && p.cooldown === 0 && this.near.length) {
      p.cooldown = 2;
      g.vfx.ring(p.x, p.z, 0.4, 4.5, TERRAIN.tide.ink, 0.4);
    }
  }
}
