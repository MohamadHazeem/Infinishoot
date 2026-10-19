import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Game } from '../game/game';
import type { Enemy } from '../game/enemies';
import { crusherPhase, crusherTuning, pressHeight } from '../game/hazards';
import { paint } from '../render/geometry';
import { commit } from '../render/instancing';
import { createRetroMaterial } from '../render/retroMaterial';
import { disposeObject } from '../render/dispose';
import { poseAnim } from './biomeProps';
import { bossDressingTuning, buildDressing, type Dressing } from './bossDressing';

/**
 * Per-frame world presentation, local and cosmetic on every machine (called
 * from the worldFx system each rendered frame):
 * - animated biome scenery (factory gears, floating islets)
 * - the Toy Factory crusher presses, posed from the stage clock: the host's
 *   director time, or on clients the synced stage timer (the host plays the
 *   slam effects and damage, which reach clients on the effects bus)
 * - boss arena dressing, built from the boss id when a boss shows up and
 *   cleaned up after it's gone (src/world/bossDressing.ts).
 */
interface WorldState {
  arena: unknown;
  t: number;
  /** Clients: estimated stage clock. */
  clock: number;
  presses: THREE.InstancedMesh | null;
  pads: { x: number; z: number }[];
  dressing: Dressing | null;
  dressUid: number;
  /** 0..1 rise progress; while `gone`, it counts back down. */
  dressK: number;
  gone: boolean;
  noBossT: number;
  scanT: number;
}

const states = new WeakMap<Game, WorldState>();
const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const v = new THREE.Vector3();
const one = new THREE.Vector3(1, 1, 1);

function pressGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, y: number, c: string) => {
    g.translate(0, y, 0);
    paint(g, c);
    parts.push(g.index ? g.toNonIndexed() : g);
  };
  const R = crusherTuning.radius;
  add(new THREE.CylinderGeometry(R * 0.92, R * 0.92, 0.55, 14), 0.28, '#ff5a4a');
  add(new THREE.CylinderGeometry(R * 0.97, R * 0.97, 0.14, 14), 0.6, '#ffcd3a');
  add(new THREE.CylinderGeometry(R * 0.55, R * 0.8, 0.45, 14), 0.88, '#ff5a4a');
  add(new THREE.CylinderGeometry(0.22, 0.22, 2.4, 8), 2.2, '#f4f4f4');
  add(new THREE.SphereGeometry(0.42, 10, 7), 3.5, '#ffcd3a');
  for (const p of parts) p.deleteAttribute('uv');
  return mergeGeometries(parts)!;
}

function state(g: Game): WorldState {
  let s = states.get(g);
  if (!s) {
    s = { arena: null, t: 0, clock: 0, presses: null, pads: [], dressing: null, dressUid: -1, dressK: 0, gone: false, noBossT: 0, scanT: 0 };
    states.set(g, s);
  }
  return s;
}

/** The stage clock the crushers follow on this machine. */
function stageClock(g: Game, s: WorldState, frameDt: number): number {
  if (g.role !== 'client') return g.director.time;
  // Clients: run a local clock, pulled toward the synced timer while there is one.
  if (g.mode === 'fight') s.clock += frameDt;
  if (g.netTimeLeft >= 0) {
    const want = g.director.duration - g.netTimeLeft;
    s.clock = Math.abs(want - s.clock) > 0.6 ? want : s.clock + (want - s.clock) * Math.min(1, frameDt * 4);
  }
  return s.clock;
}

function loadArena(g: Game, s: WorldState): void {
  s.arena = g.arena;
  s.clock = 0;
  s.pads = g.arena.hazards.filter((h) => h.kind === 'crusher').map((h) => ({ x: h.x, z: h.z }));
  s.presses = null;
  if (s.pads.length) {
    const mesh = new THREE.InstancedMesh(pressGeometry(), createRetroMaterial({ vertexColors: true }), s.pads.length);
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    g.arena.group.add(mesh); // disposed with the arena
    s.presses = mesh;
  }
  clearDressing(g, s);
}

function clearDressing(g: Game, s: WorldState): void {
  if (!s.dressing) return;
  g.scene.remove(s.dressing.floor, s.dressing.props);
  disposeObject(s.dressing.floor);
  disposeObject(s.dressing.props);
  s.dressing = null;
  s.dressUid = -1;
}

/** The live boss this machine knows about (host: the sim's; clients: the mirrored one). */
function findBoss(g: Game): Enemy | null {
  if (g.role !== 'client') return g.boss && g.boss.active && g.boss.def.boss ? g.boss : null;
  for (const e of g.netEnemies.values()) if (e.active && e.def.boss) return e;
  return null;
}

export function worldRender(g: Game, frameDt: number): void {
  const s = state(g);
  if (s.arena !== g.arena) loadArena(g, s);
  const frozen = (g.paused && g.role === 'solo') || g.mode === 'levelup' || g.mode === 'shop';
  const dt = frozen ? 0 : frameDt;
  s.t += dt;
  for (const a of g.arena.anim) poseAnim(a, s.t);

  // Crusher presses.
  if (s.presses) {
    const t = stageClock(g, s, dt);
    const active = g.mode === 'fight' || (g.mode === 'title' && g.director.time > 0);
    for (let i = 0; i < s.pads.length; i++) {
      const p = s.pads[i];
      const ph = active ? crusherPhase(t, i) : 0.5;
      let y = active ? pressHeight(ph) : 4.6;
      // A little shudder while it winds down.
      const left = (1 - ph) * crusherTuning.period;
      if (active && left < crusherTuning.warn && left > 0.12) y += Math.sin(s.t * 60 + i) * 0.04;
      q.identity();
      m4.compose(v.set(p.x, y, p.z), q, one);
      s.presses.setMatrixAt(i, m4);
    }
    commit(s.presses.instanceMatrix, s.pads.length);
  }

  // Boss dressing.
  const T = bossDressingTuning;
  let boss: Enemy | null = null;
  if (s.dressing && !s.gone) boss = findBoss(g);
  else if ((s.scanT -= frameDt) <= 0) {
    s.scanT = 0.25;
    boss = findBoss(g);
  }
  if (boss && boss.uid !== s.dressUid && (!s.dressing || s.gone)) {
    clearDressing(g, s);
    const d = buildDressing(boss.def.id, boss.x, boss.z, (x, z, r) => g.walls.hitCircle(x, z, r), g.arena.seed);
    if (d) {
      d.floor.position.set(boss.x, 0, boss.z);
      d.props.position.set(boss.x, 0, boss.z);
      g.scene.add(d.floor, d.props);
      s.dressing = d;
      s.dressUid = boss.uid;
      s.dressK = 0;
      s.gone = false;
      s.noBossT = 0;
    }
  }
  const d = s.dressing;
  if (!d) return;
  if (!s.gone) {
    if (boss && boss.uid === s.dressUid) s.noBossT = 0;
    else if ((s.noBossT += frameDt) > T.linger || g.mode === 'title' && !boss) s.gone = true;
  }
  // Frame time, not sim time: the dressing still sinks while the shop is open after the fight.
  s.dressK = s.gone ? s.dressK - frameDt / T.sink : Math.min(1, s.dressK + frameDt / T.rise);
  if (s.gone && s.dressK <= 0) {
    clearDressing(g, s);
    return;
  }
  const k = Math.max(0, s.dressK);
  const ease = 1 - (1 - k) * (1 - k) * (1 - k);
  d.floor.scale.set(Math.max(0.01, ease), 1, Math.max(0.01, ease));
  d.props.position.y = -3.2 * (1 - ease);
  if (d.spin) d.spin.children.forEach((c, i) => (c.rotation.y += dt * (0.35 + i * 0.2) * (i % 2 ? -1 : 1)));
}

/** The boss dressing on show ('king', 'rex'...), or null; for tests. */
export function dressingOf(g: Game): string | null {
  return states.get(g)?.dressing?.id ?? null;
}
