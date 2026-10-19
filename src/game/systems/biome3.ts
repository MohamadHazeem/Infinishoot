import { biome3TentacleGeometry } from '../biome3Models';
import { biome3Calm } from '../../world/biome3Arena';
/** Host-owned encounter state. A bounded pool and one instanced tentacle draw. */
import * as THREE from 'three';
import { bossMoveTuning } from '../bosses';
import type { Game } from '../game';
import { biome3Tuning as T, type Biome3Api } from '../biome3Brain';
import { createRetroMaterial } from '../../render/retroMaterial';
import { commit } from '../../render/instancing';
import { access, settings } from '../settings';

const CAP = 24;
interface Tentacle {
  x: number;
  z: number;
  t: number;
  dmg: number;
  uid: number;
}
export interface Biome3Net {
  tentacles: number[][];
  ink: number;
  whirl: [number, number, number, number];
}
interface State {
  arena: unknown;
  tentacles: Tentacle[];
  mesh: THREE.InstancedMesh | null;
  ink: number;
  wx: number;
  wz: number;
  wt: number;
  uid: number;
  pulse: number;
  overlay: HTMLDivElement | null;
}
const states = new WeakMap<Game, State>();
function state(g: Game): State {
  let s = states.get(g);
  if (!s) {
    s = {
      arena: g.arena,
      tentacles: Array.from({ length: CAP }, () => ({ x: 0, z: 0, t: -1, dmg: 0, uid: -1 })),
      mesh: null,
      ink: 0,
      wx: 0,
      wz: 0,
      wt: 0,
      uid: -1,
      pulse: 0,
      overlay: null,
    };
    states.set(g, s);
  }
  if (s.arena !== g.arena) {
    s.arena = g.arena;
    s.mesh = null;
    s.ink = s.wt = 0;
    for (const t of s.tentacles) t.t = -1;
    if (s.overlay) s.overlay.style.display = 'none';
  }
  return s;
}
export function makeBiome3Api(this: Game): Biome3Api {
  return {
    frosting: (e, delay) => {
      if (this.bossField.waves.length >= 8) return;
      this.bossField.waves.push({
        x: e.x,
        z: e.z,
        r: e.radius * 1.4,
        delay,
        dmg: bossMoveTuning.shockDamage * e.dmgMul,
        hit: 0,
        cause: e.def.name,
        color: '#ff7eb6',
      });
      this.vfx.sound('whoosh', e.x, e.z);
    },
    tentacle: (e, x, z) => {
      if (!this.bossApi.open(x, z, T.tentacleRadius)) return;
      const s = state(this),
        t = s.tentacles.find((t) => t.t < 0);
      if (!t) return;
      t.x = x;
      t.z = z;
      t.t = T.tentacleDelay + 0.6;
      t.dmg = T.tentacleDamage * e.dmgMul;
      t.uid = e.uid;
      this.vfx.zone(x, z, T.tentacleRadius, T.tentacleDelay);
      this.vfx.sound('bossWindup', x, z, 1.1);
    },
    ink: (e) => {
      state(this).ink = T.inkTime;
      this.vfx.toast('INK CLOUD! KEEP MOVING', T.inkTime);
      this.vfx.burst(e.x, 1.2, e.z, {
        count: 20,
        color: '#333c57',
        color2: '#5d275d',
        size: [0.3, 0.7],
        speed: [2, 6],
        life: [0.6, 1.2],
        up: 3,
        gravity: 0,
      });
      this.vfx.sound('whoosh', e.x, e.z);
    },
    whirlpool: (e) => {
      const s = state(this);
      s.wx = e.x;
      s.wz = e.z;
      s.wt = T.whirlTime;
      s.uid = e.uid;
      s.pulse = 0;
      this.vfx.ring(e.x, e.z, 1, T.whirlRadius, '#73eff7', 0.9);
      this.vfx.toast('WHIRLPOOL! DASH OUT', 1.5);
      this.vfx.sound('bossWindup', e.x, e.z, 0.8);
    },
  };
}
function live(g: Game, uid: number): boolean {
  for (const e of g.enemies.list) if (e.active && e.uid === uid && e.hp > 0) return true;
  return false;
}
/** Returns a normalized pull with tangential drift; no allocation in the hot path. */
export function whirlForce(dx: number, dz: number, out: { x: number; z: number }): void {
  const d = Math.hypot(dx, dz);
  const k = d > 2.8 && d < T.whirlRadius ? 1 / d : 0;
  out.x = (dx - dz * 0.45) * k;
  out.z = (dz + dx * 0.45) * k;
}
const force = { x: 0, z: 0 };
export function updateBiome3(this: Game, dt: number): void {
  const s = state(this);
  s.ink = Math.max(0, s.ink - dt);
  for (const t of s.tentacles) {
    if (t.t < 0) continue;
    if (!live(this, t.uid)) {
      t.t = -1;
      continue;
    }
    const before = t.t;
    t.t -= dt;
    if (before > 0.6 && t.t <= 0.6) {
      for (const h of this.aliveHeroes) {
        if (
          Math.hypot(h.player.x - t.x, h.player.z - t.z) <
          T.tentacleRadius + h.player.radius * 0.5
        )
          this.hurtHero(h, t.dmg, t.x, t.z, null, 'Kraken tentacle');
      }
      this.vfx.ring(t.x, t.z, 0.5, T.tentacleRadius * 1.5, '#73eff7', 0.3);
      this.vfx.sound('impact', t.x, t.z);
    }
  }
  if (s.wt > 0) {
    s.wt = live(this, s.uid) ? Math.max(0, s.wt - dt) : 0;
    if (s.wt > 0 && (s.pulse -= dt) <= 0) {
      s.pulse = 0.2;
      this.vfx.ring(s.wx, s.wz, T.whirlRadius, 2, '#73eff7', 0.8);
      // First 0.8 seconds are warning only. Dash resists the pull.
      if (s.wt < T.whirlTime - 0.8)
        for (const h of this.aliveHeroes) {
          if (h.player.dashing) continue;
          whirlForce(s.wx - h.player.x, s.wz - h.player.z, force);
          if (!force.x && !force.z) continue;
          if (h === this.hero) h.player.shove(force.x, force.z, T.whirlPush);
          else this.tell(h, { t: 'shove', dx: force.x, dz: force.z, f: T.whirlPush });
        }
    }
  }
  let kraken = false;
  for (const e of this.enemies.list)
    if (e.active && e.def.behavior === 'kraken') {
      kraken = true;
      break;
    }
  if (!kraken) s.ink = 0;
}
export function biome3Net(this: Game): Biome3Net | undefined {
  const s = state(this);
  if (!s.ink && !s.wt && !s.tentacles.some((t) => t.t >= 0)) return undefined;
  return {
    tentacles: s.tentacles.filter((t) => t.t >= 0).map((t) => [t.x, t.z, t.t]),
    ink: s.ink,
    whirl: [s.wx, s.wz, s.wt, s.uid],
  };
}
export function applyBiome3Net(this: Game, n: Biome3Net | undefined): void {
  const s = state(this);
  s.ink = n?.ink ?? 0;
  [s.wx, s.wz, s.wt, s.uid] = n?.whirl ?? [0, 0, 0, -1];
  for (let i = 0; i < CAP; i++) {
    const t = s.tentacles[i],
      src = n?.tentacles[i];
    t.t = src?.[2] ?? -1;
    if (src) {
      t.x = src[0];
      t.z = src[1];
    }
  }
}
const matrix = new THREE.Matrix4();
export function renderBiome3(this: Game, dt: number, paused: boolean): void {
  const s = state(this);
  if (this.role === 'client' && !paused) {
    s.ink = Math.max(0, s.ink - dt);
    s.wt = Math.max(0, s.wt - dt);
    for (const t of s.tentacles) if (t.t >= 0) t.t -= dt;
  }
  let n = 0;
  for (const t of s.tentacles) {
    if (t.t < 0 || t.t > 0.6) continue;
    if (!s.mesh) {
      s.mesh = new THREE.InstancedMesh(
        biome3TentacleGeometry(),
        createRetroMaterial({ vertexColors: true }),
        CAP,
      );
      s.mesh.frustumCulled = false;
      this.arena.group.add(s.mesh);
    }
    const height = biome3Calm() ? 0.8 : Math.min(1, t.t / 0.18, (0.6 - t.t) / 0.08);
    matrix.makeScale(1, Math.max(0.05, height), 1).setPosition(t.x, 0.02, t.z);
    s.mesh.setMatrixAt(n++, matrix);
  }
  if (s.mesh) {
    s.mesh.count = n;
    commit(s.mesh.instanceMatrix, n);
  }
  if (s.ink > 0 && !s.overlay) {
    const el = document.createElement('div');
    el.className = 'biome3-ink';
    el.setAttribute('aria-hidden', 'true');
    el.style.cssText =
      'position:fixed;inset:12% 7%;pointer-events:none;z-index:3;background:#1a1c2c;clip-path:polygon(0 20%,12% 20%,12% 0,35% 0,35% 13%,70% 13%,70% 0,92% 0,92% 28%,100% 28%,100% 80%,85% 80%,85% 100%,57% 100%,57% 86%,23% 86%,23% 100%,5% 100%,5% 64%,0 64%)';
    document.body.append(el);
    s.overlay = el;
  }
  if (s.overlay) {
    s.overlay.style.display = s.ink > 0 && this.mode === 'fight' ? '' : 'none';
    // The HUD and attack cues stay readable even in the ordinary version.
    s.overlay.style.opacity = String(
      Math.min(1, s.ink / 0.3) * (access.reduceFlash || settings.reduceScreenEffects ? 0.12 : 0.42),
    );
  }
}
