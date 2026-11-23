import * as THREE from 'three';
import { Bullets, Team, type BulletSpawn } from '../game/bullets';
import { Pickups } from '../game/pickups';
import type { Game } from '../game/game';
import type { Enemy } from '../game/enemies';
import { DECK, heightTuning } from './height';

/** The stock pools share instance matrices between outlines, glows and cores. Lift each live buffer once. */
function batches(scene: THREE.Scene, start: number) {
  const result: THREE.InstancedMesh[] = [];
  for (const obj of scene.children.slice(start))
    obj.traverse((child) => {
      const mesh = child as THREE.InstancedMesh;
      if (
        mesh.isInstancedMesh &&
        !result.some((other) => other.instanceMatrix === mesh.instanceMatrix)
      )
        result.push(mesh);
    });
  return result;
}

export class FieldPickups extends Pickups {
  private readonly batches: THREE.InstancedMesh[];
  constructor(private readonly game: Game) {
    const start = game.scene.children.length;
    super(game.scene);
    this.batches = batches(game.scene, start);
  }
  /** Loose loot settles onto the lowest walkable floor, including through the open bridge grate.
   * Magnets and the boss-chest vacuum can still pull it to a hero on either floor. */
  floor(i: number) {
    return this.game.arena.heights?.floor(this.x[i], this.z[i]) ?? 0;
  }
  override render(time: number) {
    super.render(time);
    const field = this.game.arena.heights;
    if (!field) return;
    for (const mesh of this.batches) {
      const a = mesh.instanceMatrix.array;
      for (let k = 12; k < mesh.count * 16; k += 16) a[k + 1] += field.floor(a[k], a[k + 2]);
    }
  }
}

export class FieldBullets extends Bullets {
  readonly floorY = new Float32Array(this.x.length);
  private readonly batches: THREE.InstancedMesh[];
  private readonly highTiles = new Uint32Array(4 * 640);
  private readonly candidates: Enemy[] = [];
  private frame = 0;
  private splitting = false;
  private splitFloor = 0;
  firingEnemy: Enemy | null = null;

  constructor(
    private readonly game: Game,
    access: { colorblind: boolean; reduceFlash: boolean },
  ) {
    const start = game.scene.children.length;
    super(game.scene, access);
    this.batches = batches(game.scene, start);
  }

  override spawn(b: BulletSpawn) {
    const i = this.count;
    super.spawn(b);
    if (i === this.count) return;
    const field = this.game.arena.heights;
    const owner = b.team === Team.Player ? this.game.heroes[b.owner ?? 0] : undefined;
    const source = owner?.player ?? this.firingEnemy;
    const y = this.splitting ? this.splitFloor : (owner?.floorY ?? this.firingEnemy?.floorY ?? 0);
    this.floorY[i] = field?.floor(b.x, b.z, y > DECK / 2) ?? 0;
    // Muzzles extend past their owners. A shot born inside the face of a ledge must stop there too.
    if (source && field && Math.abs(b.x - source.x) + Math.abs(b.z - source.z) < 3) {
      const result = field.shot(source.x, source.z, y, b.x, b.z);
      if (result < 0) {
        this.kill(i);
        return;
      }
      this.floorY[i] = result;
    }
    if (!this.splitting && y >= DECK - 0.01) this.damage[i] *= heightTuning.damage;
  }

  override kill(i: number) {
    if (this.splitting) this.splitFloor = this.floorY[i];
    this.floorY[i] = this.floorY[this.count - 1];
    super.kill(i);
  }

  override integrate(dt: number, authoritative = false) {
    this.splitting = authoritative;
    super.integrate(dt, authoritative);
    this.splitting = false;
    const field = this.game.arena.heights;
    if (!field) return;
    for (let i = 0; i < this.count; i++) {
      const x = this.x[i],
        z = this.z[i];
      const y = field.shot(this.px[i], this.pz[i], this.floorY[i], x, z);
      if (y < 0) {
        if (authoritative) {
          this.game.vfx.star(this.px[i], this.floorY[i] + 0.8, this.pz[i], 0.45, '#ffcd75', 0.09);
          this.kill(i--);
        }
      } else this.floorY[i] = y;
    }
  }

  /** Called by the stock hit loop. A deck between an enemy and a bullet protects either side. */
  override hasHit(i: number, uid: number) {
    if (super.hasHit(i, uid)) return true;
    if (!this.game.arena.heights?.site(this.x[i], this.z[i])) return false;
    const count = this.game.hash.queryInto(
      this.x[i],
      this.z[i],
      this.radius[i] + 2,
      this.candidates,
    );
    for (let n = 0; n < count; n++) {
      const e = this.candidates[n];
      if (e.uid === uid) return Math.abs(e.floorY - this.floorY[i]) > 1.1;
    }
    return false;
  }

  /** Enemy damage carries the projectile's previous XZ. Only consult the pool on a raised feature. */
  separated(h: { floorY: number }, x: number, z: number) {
    for (let i = 0; i < this.count; i++)
      if (this.team[i] === Team.Enemy && this.px[i] === x && this.pz[i] === z)
        return Math.abs(h.floorY - this.floorY[i]) > 1.1;
    return false;
  }

  override render(alpha: number, dt = 1 / 60) {
    super.render(alpha, dt);
    const field = this.game.arena.heights;
    if (!field) return;
    this.frame = (this.frame + 1) >>> 0;
    if (!this.frame) {
      this.highTiles.fill(0);
      this.frame = 1;
    }
    let high = false;
    for (let i = 0; i < this.count; i++) {
      if (this.floorY[i] <= 0) continue;
      high = true;
      const x = this.px[i] + (this.x[i] - this.px[i]) * alpha;
      const z = this.pz[i] + (this.z[i] - this.pz[i]) * alpha;
      const tile = field.grateCell(x, z);
      if (tile >= 0) this.highTiles[tile] = this.frame;
    }
    if (!high) return;
    for (const mesh of this.batches) {
      const a = mesh.instanceMatrix.array;
      for (let k = 12; k < mesh.count * 16; k += 16) {
        const x = a[k],
          z = a[k + 2],
          site = field.site(x, z);
        if (!site) continue;
        let y = field.floor(x, z);
        if (!y && site.bridge) {
          const tile = field.grateCell(x, z);
          if (tile >= 0 && this.highTiles[tile] === this.frame) y = DECK;
        }
        a[k + 1] += y;
      }
    }
  }
}
