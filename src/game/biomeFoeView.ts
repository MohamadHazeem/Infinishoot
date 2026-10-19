import * as THREE from 'three';
import { commit } from '../render/instancing';
import { createRetroMaterial } from '../render/retroMaterial';
import { biomeFoeTuning, lavaPuddles } from './biomeFoes';
import type { Enemy } from './enemies';
import type { EnemyPose } from './enemyAnim';

const LINES = 64;
const RINGS = 96;
const DISCS = 2 * 160 + 32;
const CONES = 16;
const FINS = 24;

/** Telegraph colours: danger red for hits, warm sand for the shark's ripple, pale cyan for wind. */
const C = {
  dive: new THREE.Color('#ff7a2f'),
  march: new THREE.Color('#ffb627'),
  roll: new THREE.Color('#9fe8ff'),
  danger: new THREE.Color('#ff2d4a'),
  ripple: new THREE.Color('#f2e2b8'),
  spill: new THREE.Color('#ff7a2f'),
  lavaRim: new THREE.Color('#b13e53'),
  lavaCore: new THREE.Color('#ff7a2f'),
  lavaHot: new THREE.Color('#ffcd75'),
};

function decal(
  geo: THREE.BufferGeometry,
  cap: number,
  opacity: number,
  scene: THREE.Scene,
  additive = false,
): THREE.InstancedMesh {
  const mat = new THREE.MeshBasicMaterial({
    color: '#ffffff',
    transparent: true,
    opacity,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  const m = new THREE.InstancedMesh(geo, mat, cap);
  m.setColorAt(0, new THREE.Color('#ffffff'));
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  m.frustumCulled = false;
  m.renderOrder = 1;
  m.count = 0;
  scene.add(m);
  return m;
}

/**
 * Ground telegraphs and poses for the biome foes (src/game/biomeFoes.ts),
 * drawn from synced state on every machine: bee dive lines, soldier march
 * lines, the shark's sand ripple and bite ring, the snowball's heading, the
 * slug's spill ring and lava puddles, and the kite's wind cone.
 */
export class BiomeFoeView {
  private lines: THREE.InstancedMesh;
  private rings: THREE.InstancedMesh;
  private discs: THREE.InstancedMesh;
  private cones: THREE.InstancedMesh;
  /** Shark fins cutting through the sand (the body isn't drawn while it swims). */
  private fins: THREE.InstancedMesh;
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);
  private col = new THREE.Color();
  private eul = new THREE.Euler(0, 0, 0, 'YXZ');
  /** Snowballs: rolled angle from the drawn motion (works the same on clients). */
  private rolls = new Map<Enemy, { uid: number; x: number; z: number; a: number }>();

  constructor(scene: THREE.Scene) {
    this.lines = decal(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0, 0.5),
      LINES,
      0.5,
      scene,
    );
    this.rings = decal(
      new THREE.RingGeometry(0.84, 1, 28).rotateX(-Math.PI / 2),
      RINGS,
      0.7,
      scene,
    );
    this.discs = decal(new THREE.CircleGeometry(1, 18).rotateX(-Math.PI / 2), DISCS, 0.85, scene);
    // The wind cone: a flat fan centred on +Z, 32 degrees either side (the kite's arc).
    const arc = (32 * Math.PI) / 180;
    this.fins = new THREE.InstancedMesh(
      new THREE.ConeGeometry(0.5, 1, 4).scale(0.3, 1, 1.1).translate(0, 0.5, 0),
      createRetroMaterial({ color: '#ffffff' }),
      FINS,
    );
    this.fins.setColorAt(0, new THREE.Color('#ffffff'));
    this.fins.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.fins.frustumCulled = false;
    this.fins.count = 0;
    scene.add(this.fins);
    this.cones = decal(
      new THREE.CircleGeometry(1, 12, Math.PI / 2 - arc, arc * 2)
        .rotateX(-Math.PI / 2)
        .scale(1, 1, -1),
      CONES,
      0.22,
      scene,
      true,
    );
  }

  begin(): void {
    this.lines.count = this.rings.count = this.discs.count = this.cones.count = this.fins.count = 0;
  }

  private line(
    x: number,
    z: number,
    dx: number,
    dz: number,
    len: number,
    w: number,
    c: THREE.Color,
    y = 0.05,
  ): void {
    if (this.lines.count >= LINES) return;
    this.q.setFromAxisAngle(this.up, Math.atan2(dx, dz));
    this.m4.compose(this.v.set(x, y, z), this.q, this.s.set(w, 1, len));
    this.lines.setMatrixAt(this.lines.count, this.m4);
    this.lines.setColorAt(this.lines.count++, c);
  }

  private ring(x: number, z: number, r: number, c: THREE.Color, y = 0.05): void {
    if (this.rings.count >= RINGS) return;
    this.m4.makeScale(r, 1, r).setPosition(x, y, z);
    this.rings.setMatrixAt(this.rings.count, this.m4);
    this.rings.setColorAt(this.rings.count++, c);
  }

  private disc(x: number, z: number, r: number, c: THREE.Color, y = 0.04): void {
    if (this.discs.count >= DISCS) return;
    this.m4.makeScale(r, 1, r).setPosition(x, y, z);
    this.discs.setMatrixAt(this.discs.count, this.m4);
    this.discs.setColorAt(this.discs.count++, c);
  }

  /**
   * One biome foe drawn at (x, z): its telegraphs, plus pose tweaks on `P`
   * (the shark sinks while it swims, the snowball rolls, the kite bobs...).
   */
  enemy(e: Enemy, x: number, z: number, time: number, P: EnemyPose): void {
    const d = e.def;
    const winding = e.state === 'windup' && e.frozen <= 0;
    const pulse = 0.5 + 0.5 * Math.sin(time * 30);
    switch (d.behavior) {
      case 'diver': {
        const D = d.dive!;
        if (winding)
          this.line(
            x,
            z,
            e.lungeX,
            e.lungeZ,
            D.speed * D.duration + 1,
            0.22 + 0.12 * pulse,
            C.dive,
          );
        if (e.state === 'attack') P.pitch += 0.5;
        P.y += Math.sin(time * 9 + e.uid) * 0.08;
        break;
      }
      case 'shark': {
        const B = d.shark!;
        if (e.under) {
          // Only the fin shows: the body is scaled away and a fin drawn in its place.
          P.sx = P.sy = P.sz = 0.001;
          if (this.fins.count < FINS) {
            const fh = e.radius * biomeFoeTuning.sharkFin * (1 + 0.08 * Math.sin(time * 8 + e.uid));
            this.q.setFromEuler(this.eul.set(0, e.facing, Math.sin(time * 6 + e.uid) * 0.15));
            this.m4.compose(this.v.set(x, 0, z), this.q, this.s.set(fh, fh, fh));
            this.fins.setMatrixAt(this.fins.count, this.m4);
            this.fins.setColorAt(this.fins.count++, this.col.set(d.bodyColor));
          }
          // A sand ripple trails it: two rings swelling out.
          for (let k = 0; k < 2; k++) {
            const f = (time * 1.6 + k * 0.5 + e.uid * 0.13) % 1;
            this.ring(x, z, e.radius * (1.1 + f * 1.4), C.ripple, 0.03 + k * 0.002);
          }
        }
        if (winding) {
          // The bite ring under you: a fixed ring with a second one closing in.
          const r = B.radius * e.scale;
          this.ring(e.targetX, e.targetZ, r, C.danger);
          this.ring(
            e.targetX,
            e.targetZ,
            Math.max(0.1, r * Math.min(1, e.t / B.windup)),
            C.danger,
            0.055,
          );
          this.disc(e.targetX, e.targetZ, r * 0.98, C.ripple, 0.035);
        }
        break;
      }
      case 'roller': {
        let s = this.rolls.get(e);
        if (!s || s.uid !== e.uid) this.rolls.set(e, (s = { uid: e.uid, x, z, a: 0 }));
        const moved = Math.hypot(x - s.x, z - s.z);
        if (moved < 3) s.a += moved / Math.max(0.2, e.radius);
        s.x = x;
        s.z = z;
        // Built round its centre: lift it by its radius and roll it forward.
        P.y += e.radius;
        P.pitch += s.a;
        P.sx = P.sz = 1;
        P.sy = 1;
        // Big ones show where they're heading (they can barely turn).
        if (e.sub >= d.roll!.crashAt && e.state === 'move')
          this.line(
            x,
            z,
            Math.sin(e.facing),
            Math.cos(e.facing),
            3 + e.radius * 2,
            e.radius * 1.2,
            C.roll,
          );
        break;
      }
      case 'slug': {
        if (winding) {
          const O = d.ooze!;
          const k = 1 - Math.max(0, e.t) / O.windup;
          P.sx *= 1 + 0.35 * k;
          P.sz *= 1 + 0.35 * k;
          P.sy *= 1 + 0.5 * k;
          this.ring(x, z, O.spillR * e.scale, C.spill);
          this.ring(x, z, O.spillR * e.scale * Math.max(0.1, k), C.spill, 0.055);
        }
        break;
      }
      case 'marcher': {
        const M = d.march!;
        if (winding) {
          // Rewinding: shakes on the spot while its path lights up.
          P.yaw += Math.sin(time * 70 + e.uid) * 0.18;
          this.line(
            x,
            z,
            e.lungeX,
            e.lungeZ,
            Math.min(10, M.speed * M.walk),
            0.35 + 0.15 * pulse,
            C.march,
          );
        } else if (e.state === 'recover') {
          // Wound down: slumps forward.
          const k = Math.min(1, (M.rest - e.t) / 0.5);
          P.pitch += 0.4 * k;
          P.sy *= 1 - 0.1 * k;
        } else if (e.state === 'attack') P.roll += Math.sin(time * 18 + e.uid) * 0.12; // stiff tin march
        break;
      }
      case 'kite': {
        P.y += 0.6 + Math.sin(time * 2.2 + e.uid) * 0.3;
        P.roll += Math.sin(time * 1.6 + e.uid) * 0.25;
        if (winding && this.cones.count < CONES) {
          const G = d.gust!;
          const k = 1 - Math.max(0, e.t) / G.windup;
          P.pitch -= 0.45 * k; // rears back to blow
          this.q.setFromAxisAngle(this.up, Math.atan2(e.lungeX, e.lungeZ));
          this.m4.compose(this.v.set(x, 0.06, z), this.q, this.s.set(G.range, 1, G.range));
          this.cones.setMatrixAt(this.cones.count, this.m4);
          this.cones.setColorAt(
            this.cones.count++,
            this.col.setRGB(0.35 + 0.35 * pulse, 0.8 + 0.2 * pulse, 1),
          );
        }
        break;
      }
    }
  }

  /** Lava puddles and the upload. Call once per frame after every enemy. */
  end(time: number): void {
    for (const p of lavaPuddles.list) {
      // Swells in, simmers, and shrinks away over the last half second.
      const k = Math.min(1, p.t * 6, (p.life - p.t) / 0.5);
      if (k <= 0) continue;
      const r = p.r * k;
      this.disc(p.x, p.z, r, C.lavaRim, 0.036);
      const hot = 0.5 + 0.5 * Math.sin(time * 7 + p.x * 3 + p.z);
      this.col.copy(C.lavaCore).lerp(C.lavaHot, hot * 0.5);
      this.disc(p.x, p.z, r * (0.68 + 0.08 * hot), this.col, 0.038);
    }
    (this.lines.material as THREE.MeshBasicMaterial).opacity = 0.6 + 0.2 * Math.sin(time * 26);
    (this.rings.material as THREE.MeshBasicMaterial).opacity = 0.55 + 0.25 * Math.sin(time * 22);
    for (const m of [this.lines, this.rings, this.discs, this.cones, this.fins]) {
      commit(m.instanceMatrix, m.count);
      if (m.instanceColor) commit(m.instanceColor, m.count);
    }
    if (this.rolls.size > 64)
      for (const [e, s] of this.rolls) if (!e.active || e.uid !== s.uid) this.rolls.delete(e);
  }
}
