import * as THREE from 'three';
import type { EnemyDef } from '../data/enemies';
import { commit } from '../render/instancing';
import { BOSS_MOVES, bossMoveTuning, breathAngle, eightPoint, eightSize, eightTime } from './bosses';
import type { Enemy } from './enemies';
import type { TitanNet } from './titan';
import type { DuelNet } from './bossDuel';
import type { Bosses3Net } from './bosses3Field';

/** A slam shockwave: a ring wall expanding from (x, z). `hit` = bitmask of heroes it already hit. */
export interface Shockwave {
  x: number;
  z: number;
  r: number;
  delay: number;
  dmg: number;
  hit: number;
  cause: string;
}

/** Burning ground left by Rampage Rex. */
export interface FirePatch {
  x: number;
  z: number;
  r: number;
  t: number;
  dmg: number;
  tick: number;
}

/** What clients get each snapshot (see BossField.pack / unpack). */
export interface BossNet {
  /** Bosses and mini-bosses: uid, phase, move index, roaring (0/1), intro seconds left. */
  b: [number, number, number, number, number][];
  /** Mini-boss bar: name, hp01, phase, def id. */
  m: [string, number, number, string] | null;
  /** Shockwaves: x, z, radius, delay. */
  w: [number, number, number, number][];
  /** Fire: x, z, radius, seconds left. */
  f: [number, number, number, number][];
  /** The Titan and the boss duel (src/game/systems/bossLane.ts). */
  t?: TitanNet | null;
  d?: DuelNet | null;
  /** Biome bosses' arena (src/game/systems/bosses3.ts). */
  g?: Bosses3Net;
}

const SEG_CAP = 640;
const FIRE_CAP = 28;
const DOT_CAP = 96;
const LINK_CAP = 8;
const r2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Boss arena state shared by host and clients, and its rendering: shockwave
 * ring walls, burning ground, the figure-eight path and fire-breath cone
 * telegraphs, the roar shield ring and hive links. Gameplay (damage) runs on
 * the host in src/game/systems/bossFight.ts; this class only holds and draws.
 */
export class BossField {
  waves: Shockwave[] = [];
  fires: FirePatch[] = [];
  /** Hives telegraphed but not landed yet (host). */
  pendingHives: { x: number; z: number; t: number }[] = [];
  /** Swarm walls telegraphed but not released yet (host). */
  pendingWalls: { cx: number; cz: number; dx: number; dz: number; gap: number; t: number; dmg: number; src: Enemy }[] = [];
  /** Live mini-boss (host). */
  mini: Enemy | null = null;
  /** Stage whose mini-boss already came (host). */
  miniStage = 0;
  /** Mini-boss warning before it lands (host). */
  miniWarn: { def: EnemyDef; x: number; z: number; t: number } | null = null;
  /** Client: mini-boss bar from the host. */
  netMini: BossNet['m'] = null;
  /** Last boss phase told to the music (0 = no boss). */
  musicPhase = 0;
  /** Test links (`&phase=N`): push the stage boss into this phase once its entrance is over. */
  debugPhase = 0;

  private segs: THREE.InstancedMesh;
  private fireBase: THREE.InstancedMesh;
  private flames: THREE.InstancedMesh;
  private dots: THREE.InstancedMesh;
  private links: THREE.InstancedMesh;
  private cones: THREE.Mesh[] = [];
  private rings: THREE.Mesh[] = [];
  private dotMat: THREE.MeshBasicMaterial;
  private coneMat: THREE.MeshBasicMaterial;
  private ringMat: THREE.MeshBasicMaterial;
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);
  private c = new THREE.Color();
  private p = { x: 0, z: 0 };
  private list: Enemy[] = [];

  constructor(scene: THREE.Scene) {
    const add = <T extends THREE.Mesh>(m: T): T => {
      m.frustumCulled = false;
      m.renderOrder = 1;
      scene.add(m);
      return m;
    };
    const inst = (geo: THREE.BufferGeometry, mat: THREE.Material, cap: number) => {
      const m = add(new THREE.InstancedMesh(geo, mat, cap));
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.count = 0;
      return m;
    };
    // Shockwave: a ring of chunky blocks you dash through.
    this.segs = inst(new THREE.BoxGeometry(1, 0.9, 0.5).translate(0, 0.45, 0), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9 }), SEG_CAP);
    this.segs.setColorAt(0, this.c.set('#ffcd75'));
    this.fireBase = inst(
      new THREE.CircleGeometry(1, 12).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#b13e53', transparent: true, opacity: 0.5, depthWrite: false }),
      FIRE_CAP,
    );
    this.flames = inst(new THREE.ConeGeometry(0.28, 1, 5).translate(0, 0.5, 0), new THREE.MeshBasicMaterial({ color: '#ffffff' }), FIRE_CAP * 4);
    this.flames.setColorAt(0, this.c.set('#ef7d57'));
    this.dotMat = new THREE.MeshBasicMaterial({ color: '#ff2d4a', transparent: true, opacity: 0.6, depthWrite: false });
    this.dots = inst(new THREE.CircleGeometry(0.42, 8).rotateX(-Math.PI / 2), this.dotMat, DOT_CAP);
    this.links = inst(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0, 0.5),
      new THREE.MeshBasicMaterial({ color: '#ffcd75', transparent: true, opacity: 0.45, depthWrite: false }),
      LINK_CAP,
    );
    this.coneMat = new THREE.MeshBasicMaterial({ color: '#ff2d4a', transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide });
    this.ringMat = new THREE.MeshBasicMaterial({ color: '#ffcd75', transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide });
    const arc = bossMoveTuning.breathArc + 0.08;
    for (let i = 0; i < 2; i++) {
      const cone = add(new THREE.Mesh(new THREE.CircleGeometry(1, 20, -arc, arc * 2).rotateX(-Math.PI / 2), this.coneMat));
      cone.visible = false;
      this.cones.push(cone);
      const ring = add(new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 24).rotateX(-Math.PI / 2), this.ringMat));
      ring.visible = false;
      this.rings.push(ring);
    }
  }

  clear(): void {
    this.waves.length = 0;
    this.fires.length = 0;
    this.pendingHives.length = 0;
    this.pendingWalls.length = 0;
    this.mini = null;
    this.miniWarn = null;
    this.netMini = null;
  }

  /** Host: snapshot extras for clients. `introLeft` = seconds of the entrance still to play. */
  pack(bosses: Enemy[], introLeft: (e: Enemy) => number): BossNet {
    const mini = this.mini && this.mini.active ? this.mini : null;
    return {
      b: bosses.map((e) => [e.uid, e.phase, Math.max(0, BOSS_MOVES.indexOf(e.move as never)), e.roarT > 0 ? 1 : 0, r2(introLeft(e))]),
      m: mini ? [mini.def.name, r2(Math.max(0, mini.hp / mini.maxHp)), mini.phase, mini.def.id] : null,
      w: this.waves.map((w) => [r2(w.x), r2(w.z), r2(w.r), r2(w.delay)]),
      f: this.fires.map((f) => [r2(f.x), r2(f.z), r2(f.r), r2(f.t)]),
    };
  }

  /** Client: mirror the host's arena state. */
  unpack(n: BossNet, byUid: (uid: number) => Enemy | undefined): void {
    for (const [uid, phase, move, roar] of n.b) {
      const e = byUid(uid);
      if (!e) continue;
      e.phase = phase;
      e.enraged = phase > 1;
      e.move = BOSS_MOVES[move] ?? '';
      e.roarT = roar ? 1 : 0;
    }
    this.netMini = n.m;
    this.waves.length = 0;
    for (const [x, z, r, delay] of n.w) this.waves.push({ x, z, r, delay, dmg: 0, hit: 0, cause: '' });
    this.fires.length = 0;
    for (const [x, z, r, t] of n.f) this.fires.push({ x, z, r, t, dmg: 0, tick: 0 });
  }

  /** Client: move shockwaves on between snapshots. */
  advance(dt: number): void {
    for (const w of this.waves) {
      if (w.delay > 0) w.delay -= dt;
      else w.r += bossMoveTuning.shockSpeed * dt;
    }
    for (const f of this.fires) f.t -= dt;
  }

  render(enemies: readonly Enemy[], time: number): void {
    const T = bossMoveTuning;
    // Shockwave ring walls: blocks around the circle, bobbing like a wave.
    let n = 0;
    for (const w of this.waves) {
      if (w.delay > 0 || w.r <= 0) continue;
      const fade = Math.max(0.15, Math.min(1, (T.shockMax - w.r) / 4));
      const segs = Math.max(12, Math.min(120, Math.round((Math.PI * 2 * w.r) / 0.9)));
      const width = ((Math.PI * 2 * w.r) / segs) * 1.04;
      for (let i = 0; i < segs && n < SEG_CAP; i++) {
        const a = (i / segs) * Math.PI * 2;
        this.q.setFromAxisAngle(this.up, Math.atan2(-Math.cos(a), -Math.sin(a)));
        const h = fade * (0.8 + 0.35 * Math.sin(time * 18 + i * 0.9));
        this.m4.compose(this.v.set(w.x + Math.cos(a) * w.r, 0, w.z + Math.sin(a) * w.r), this.q, this.s.set(width, h, 1));
        this.segs.setMatrixAt(n, this.m4);
        this.segs.setColorAt(n++, this.c.set(i % 2 ? '#ffcd75' : '#ef7d57'));
      }
    }
    this.segs.count = n;

    // Burning ground: a dark-red scorch with flickering flame tongues.
    let fb = 0;
    let fl = 0;
    for (let k = 0; k < this.fires.length && fb < FIRE_CAP; k++) {
      const f = this.fires[k];
      if (f.t <= 0) continue;
      const life = Math.min(1, f.t / 0.6);
      const rr = f.r * (0.7 + 0.3 * life);
      this.m4.makeScale(rr, 1, rr).setPosition(f.x, 0.04, f.z);
      this.fireBase.setMatrixAt(fb++, this.m4);
      for (let j = 0; j < 4; j++) {
        const a = j * 1.9 + k * 2.3;
        const d = f.r * (j === 0 ? 0 : 0.55);
        const hgt = life * (0.7 + 0.5 * Math.abs(Math.sin(time * 11 + j * 2 + k)));
        this.m4.compose(this.v.set(f.x + Math.cos(a) * d, 0, f.z + Math.sin(a) * d), this.q.identity(), this.s.set(1.2 * life, hgt * (j === 0 ? 1.4 : 1), 1.2 * life));
        this.flames.setMatrixAt(fl, this.m4);
        this.flames.setColorAt(fl++, this.c.set(j === 0 ? '#ffcd75' : '#ef7d57'));
      }
    }
    this.fireBase.count = fb;
    this.flames.count = fl;

    // Telegraphs and roar rings for every boss on the field.
    const bosses = this.bossesIn(enemies);
    let d = 0;
    let links = 0;
    this.dotMat.opacity = 0.45 + 0.3 * Math.sin(time * 24);
    this.coneMat.opacity = 0.22 + 0.12 * Math.sin(time * 26);
    this.ringMat.opacity = 0.55 + 0.35 * Math.sin(time * 20);
    for (let i = 0; i < 2; i++) {
      this.cones[i].visible = false;
      this.rings[i].visible = false;
    }
    let slot = 0;
    for (const e of bosses) {
      const i = slot++;
      if (i >= 2) break;
      if (e.move === 'eight' && (e.state === 'windup' || e.state === 'attack')) {
        // Dotted path of the figure-eight, from where Rex is now to the end.
        const total = eightTime(e);
        const from = e.state === 'attack' ? (1 - Math.max(0, e.t) / total) * Math.PI * 2 : 0;
        const steps = 40;
        for (let k = 0; k <= steps && d < DOT_CAP; k++) {
          const s = (k / steps) * Math.PI * 2;
          if (s < from) continue;
          eightPoint(s, eightSize(e), e.targetX, e.targetZ, e.lungeX, e.lungeZ, this.p);
          this.m4.makeTranslation(this.p.x, 0.05, this.p.z);
          this.dots.setMatrixAt(d++, this.m4);
        }
      }
      if (e.move === 'breath' && (e.state === 'windup' || e.state === 'attack')) {
        const cone = this.cones[i];
        const base = Math.atan2(e.lungeZ, e.lungeX);
        const a = e.state === 'attack' ? breathAngle(base, e.t) : base;
        cone.visible = true;
        cone.position.set(e.x, 0.06, e.z);
        cone.rotation.y = -a;
        const R = T.breathRange * (e.state === 'attack' ? 1 : 0.6 + 0.4 * Math.min(1, 1 - e.t / 0.9));
        cone.scale.set(R, 1, R);
      }
      if (e.roarT > 0 && e.phase > 1) {
        const ring = this.rings[i];
        ring.visible = true;
        const rr = e.radius * (1.6 + 0.15 * Math.sin(time * 16));
        ring.position.set(e.x, 0.07 + e.hopY, e.z);
        ring.scale.set(rr, 1, rr);
      }
    }
    // Hive links: gold threads from each hive to the Queen it heals.
    const queen = bosses.find((e) => e.def.behavior === 'queen' && e.def.boss);
    if (queen) {
      for (const h of enemies) {
        if (!h.active || h.def.id !== 'hive' || links >= LINK_CAP) continue;
        const dx = queen.x - h.x;
        const dz = queen.z - h.z;
        this.q.setFromAxisAngle(this.up, Math.atan2(dx, dz));
        this.m4.compose(this.v.set(h.x, 0.08, h.z), this.q, this.s.set(0.18 + 0.06 * Math.sin(time * 10), 1, Math.hypot(dx, dz)));
        this.links.setMatrixAt(links++, this.m4);
      }
    }
    this.dots.count = d;
    this.links.count = links;
    for (const m of [this.segs, this.fireBase, this.flames, this.dots, this.links]) commit(m.instanceMatrix, m.count);
    for (const m of [this.segs, this.flames]) if (m.instanceColor) commit(m.instanceColor, m.count);
  }

  /** Active bosses and mini-bosses (reuses one array). */
  bossesIn(enemies: readonly Enemy[]): Enemy[] {
    this.list.length = 0;
    for (const e of enemies) if (e.active && e.def.phases) this.list.push(e);
    return this.list;
  }
}
