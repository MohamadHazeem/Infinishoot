import * as THREE from 'three';
import { createRetroMaterial, type RetroMaterial } from '../render/retroMaterial';

/**
 * Co-op team moves. When two or more living heroes stand close together
 * while enemies are around, a shared TEAM meter charges; when it is full
 * any of them can fire a team move (key `team`, D-pad down). Moves rotate:
 * Unity Beam (every hero fires a beam into one point that then bursts),
 * Team Nova (three expanding shockwaves from the group) and Meteor Call
 * (meteors rain on the crowds around the group). All scale with the number
 * of heroes taking part. The meter and the running move are simulated on
 * the host (src/game/systems/companion.ts) and synced in the snapshot;
 * beams are drawn locally on every machine from that state (TeamMoveView).
 */
export type TeamMoveId = 'beam' | 'nova' | 'meteor';

export const TEAM_MOVES: { id: TeamMoveId; name: string; color: string }[] = [
  { id: 'beam', name: 'UNITY BEAM', color: '#73eff7' },
  { id: 'nova', name: 'TEAM NOVA', color: '#ffcd75' },
  { id: 'meteor', name: 'METEOR CALL', color: '#ef7d57' },
];

export const teamTuning = {
  /** Heroes this close (chained) count as standing together. */
  linkRange: 6,
  /** Seconds together before the meter starts to charge. */
  linkTime: 1.5,
  /** In combat: at least this many enemies within this range of the group. */
  combatRange: 15,
  combatEnemies: 3,
  /** Seconds of charging (two heroes) to fill the meter; each extra hero charges it this much faster. */
  chargeTime: 16,
  perExtraHero: 0.35,
  /** A high-five adds this much to the meter. */
  highFiveBonus: 0.25,
  /** Heroes within this range of the one who fires join the move. */
  groupRange: 12,
  /** Base damage: dmg x (1 + dmgPerStage x (s - 1) + dmgPerStage2 x (s - 1)^2) x teamScale(n), then the hero's own stats. */
  dmg: 90,
  dmgPerStage: 0.8,
  dmgPerStage2: 0.2,
  /** Each hero past two adds this much to the move's power. */
  perHero: 0.4,
  // Unity Beam
  beamTime: 1.4,
  beamTick: 0.1,
  beamDist: 10,
  beamWidth: 1.3,
  beamTickMul: 0.22,
  beamBlastR: 3.5,
  beamBlastMul: 2.5,
  // Team Nova
  novaWaves: 3,
  novaGap: 0.28,
  novaRadius: 8,
  novaPerHero: 2,
  novaMul: 2.4,
  novaKnock: 14,
  // Meteor Call
  meteorTime: 1.8,
  meteorCount: 5,
  meteorPerHero: 3,
  meteorArea: 14,
  meteorDelay: 0.7,
  meteorR: 2.8,
  meteorMul: 1.5,
};

/** Power factor for a move made by n heroes (1 for two). */
export function teamScale(n: number): number {
  return 1 + teamTuning.perHero * Math.max(0, n - 2);
}

/** How long a move runs (seconds). */
export function moveTime(id: TeamMoveId): number {
  const T = teamTuning;
  return id === 'beam' ? T.beamTime : id === 'nova' ? T.novaGap * T.novaWaves + 0.2 : T.meteorTime + T.meteorDelay;
}

/**
 * The size of the largest group of points chained within `range` of each
 * other (a hero within range of any member joins). n is small (2-4).
 */
export function linkedCount(xs: ArrayLike<number>, zs: ArrayLike<number>, n: number, range: number): number {
  let best = n > 0 ? 1 : 0;
  const r2 = range * range;
  let seen = 0;
  for (let s = 0; s < n; s++) {
    if (seen & (1 << s)) continue;
    let group = 1 << s;
    let grew = true;
    while (grew) {
      grew = false;
      for (let i = 0; i < n; i++) {
        if (group & (1 << i)) continue;
        for (let j = 0; j < n; j++) {
          if (!(group & (1 << j))) continue;
          if ((xs[i] - xs[j]) ** 2 + (zs[i] - zs[j]) ** 2 <= r2) {
            group |= 1 << i;
            grew = true;
            break;
          }
        }
      }
    }
    seen |= group;
    let c = 0;
    for (let i = 0; i < n; i++) if (group & (1 << i)) c++;
    if (c > best) best = c;
  }
  return best;
}

/** Squared distance from (px, pz) to the segment a-b. */
export function segDist2(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2)) : 0;
  const cx = ax + dx * t - px;
  const cz = az + dz * t - pz;
  return cx * cx + cz * cz;
}

/**
 * The shared TEAM meter: charges while `linked` (2+) heroes have stood
 * together for linkTime seconds in combat. Pure logic, no game access.
 */
export class TeamMeter {
  charge = 0;
  /** Seconds the current group has stood together. */
  linkT = 0;
  /** Heroes in the largest group right now (for the HUD). */
  linked = 0;
  /** Index into TEAM_MOVES of the next move. */
  next = 0;

  get ready(): boolean {
    return this.charge >= 1;
  }

  reset(): void {
    this.charge = 0;
    this.linkT = 0;
    this.linked = 0;
    this.next = 0;
  }

  /** One step. Returns true on the step the meter becomes full. */
  update(dt: number, linked: number, inCombat: boolean): boolean {
    this.linked = linked;
    if (linked < 2) {
      this.linkT = 0;
      return false;
    }
    this.linkT = Math.min(teamTuning.linkTime + 1, this.linkT + dt);
    if (!inCombat || this.linkT < teamTuning.linkTime || this.charge >= 1) return false;
    const rate = (1 + teamTuning.perExtraHero * (linked - 2)) / teamTuning.chargeTime;
    this.charge = Math.min(1, this.charge + rate * dt);
    return this.charge >= 1;
  }

  /** Add a bonus (high-five). Returns true if that filled it. */
  add(frac: number): boolean {
    const was = this.charge;
    this.charge = Math.min(1, this.charge + frac);
    return was < 1 && this.charge >= 1;
  }

  /** Spend a full meter: returns the move to run and rotates to the next. */
  consume(): TeamMoveId {
    const id = TEAM_MOVES[this.next].id;
    this.next = (this.next + 1) % TEAM_MOVES.length;
    this.charge = 0;
    return id;
  }
}

/** The running team move (host state, mirrored on clients). */
export interface ActiveMove {
  id: TeamMoveId;
  /** Seconds since it started. */
  t: number;
  /** Convergence point (beam) or centre (nova, meteor). */
  x: number;
  z: number;
  /** Bit mask of the heroes taking part. */
  mask: number;
  /** Index of the hero who fired it. */
  by: number;
}

const MAX_BEAMS = 4;

/**
 * Unity Beam visuals: one beam from each hero in the move to the meeting
 * point plus a growing orb there. Built lazily, drawn every frame from the
 * synced move state and the heroes' rendered positions.
 */
export class TeamMoveView {
  private beams: THREE.Mesh[] = [];
  private cores: THREE.Mesh[] = [];
  private mats: RetroMaterial[] = [];
  private orb: THREE.Mesh | null = null;
  private group = new THREE.Group();

  constructor(private scene: THREE.Scene) {}

  private build(): void {
    const geo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5);
    const core = createRetroMaterial({ color: '#f4f4f4', unlit: 1 });
    for (let i = 0; i < MAX_BEAMS; i++) {
      const mat = createRetroMaterial({ color: '#73eff7', unlit: 1 });
      const b = new THREE.Mesh(geo, mat);
      const c = new THREE.Mesh(geo, core);
      b.frustumCulled = c.frustumCulled = false;
      this.mats.push(mat);
      this.beams.push(b);
      this.cores.push(c);
      this.group.add(b, c);
    }
    this.orb = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), createRetroMaterial({ color: '#73eff7', unlit: 1 }));
    this.group.add(this.orb);
    this.scene.add(this.group);
  }

  /** Hide everything (no beam running). */
  hide(): void {
    this.group.visible = false;
  }

  /** Draw beams from each source to (x, z). k01 is the beam's progress 0..1. */
  draw(sources: { x: number; z: number; color: string }[], x: number, z: number, k01: number, time: number): void {
    if (!this.orb) this.build();
    this.group.visible = true;
    const grow = Math.min(1, k01 * 6);
    const fade = k01 > 0.85 ? (1 - k01) / 0.15 : 1;
    const w = (0.38 + 0.1 * Math.sin(time * 40)) * grow * fade;
    for (let i = 0; i < MAX_BEAMS; i++) {
      const b = this.beams[i];
      const c = this.cores[i];
      const s = sources[i];
      b.visible = c.visible = !!s;
      if (!s) continue;
      const dx = x - s.x;
      const dz = z - s.z;
      const len = Math.max(0.1, Math.hypot(dx, dz));
      const yaw = Math.atan2(dx, dz);
      b.position.set(s.x, 1, s.z);
      b.rotation.set(0, yaw, 0);
      b.scale.set(w, w, len);
      c.position.copy(b.position);
      c.rotation.copy(b.rotation);
      c.scale.set(w * 0.45, w * 0.45, len);
      this.mats[i].uniforms.uColor.value.set(s.color);
    }
    const orb = this.orb!;
    orb.position.set(x, 1, z);
    orb.scale.setScalar((0.3 + k01 * 0.8) * fade * (1 + 0.12 * Math.sin(time * 30)));
    orb.rotation.y = time * 5;
  }
}
