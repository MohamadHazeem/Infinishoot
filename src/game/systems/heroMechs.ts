/**
 * Content lane: the Game side of the hero mechanics (src/game/heroMechs.ts):
 * the Furnace's heat aura, the Duelist's parry chain, the Twin's mirror
 * clone, their visuals and network bits, and the achievements that unlock
 * them. Game methods (`this` is the Game), installed on the class as fields.
 */
import * as THREE from 'three';
import type { Game } from '../game';
import { HEROES } from '../../data/heroes';
import { heroMechTuning, TwinClone } from '../heroMechs';
import type { Hero } from '../hero';
import { power } from '../ultimates';
import { commit } from '../../render/instancing';
import { heroes3Achievements, heroes3Parry, renderHeroes3, updateHeroes3 } from './heroes3';

const FIRE_TAGS = ['fire', 'area'] as const;

/** Damage source labels for the run summary. */
export const MECH_SOURCE_NAMES: Record<string, string> = {
  furnace: 'Furnace Aura',
  roller: 'Snowball',
  minion: 'Tinker Bots',
};

/** Make sure a Twin hero has its clone (host and clients; lazily, the hero's ctx comes after its def). */
function twinOf(g: Game, h: Hero): TwinClone | null {
  const m = h.mech;
  if (m.id !== 'twin' || h.left) {
    if (m.twin) {
      m.twin.dispose();
      m.twin = null;
    }
    return null;
  }
  if (!m.twin) m.twin = new TwinClone(g.scene, h.player, h.ctx, '#73eff7');
  return m.twin;
}

/** Host step, after the heroes' weapons: heat and aura, parry chains, the twin's shots. */
export function updateHeroMechs(this: Game, dt: number): void {
  const fighting = this.mode === 'fight';
  for (const h of this.heroes) {
    const m = h.mech;
    if (h.left) continue;
    const p = h.player;
    m.trackStill(dt, p.dead ? 99 : p.speed, fighting && !p.dead);
    if (!m.id) continue;
    if (m.id === 'duelist') m.tickChain(dt);
    if (m.id === 'furnace') {
      m.tickHeat(dt, p.dead ? 99 : p.speed, fighting && !p.dead);
      const r = m.auraR;
      if (r > 0 && !p.dead && (m.auraT -= dt) <= 0) {
        const T = heroMechTuning.furnace;
        m.auraT = T.auraTick;
        const pw = Math.pow(power(this), 0.9);
        let n = 0;
        for (const e of this.enemiesInRadius(p.x, p.z, r, this.scratch).slice()) {
          if (e.pvpOwner === h.index || e.hp <= 0) continue;
          this.damage(
            e,
            T.auraDamage * m.heat * pw,
            { source: 'furnace', tags: FIRE_TAGS, loud: n++ < 2 },
            h,
          );
          if (e.active && e.hp > 0) this.ignite(e, T.burnDps * pw * m.heat, h);
        }
        this.barrels.igniteNear(p.x, p.z, r * 0.6, h.index);
      }
    }
    if (m.id === 'twin') {
      const tw = twinOf(this, h);
      if (tw && !p.dead && this.isCombatMode)
        tw.update(
          dt,
          h.weapons.find((w) => w.def.slot === 'primary'),
        );
      else tw?.follow(dt);
    }
  }
  updateHeroes3(this, dt); // Ronin and Tinker (systems/heroes3.ts)
}

/** A hero landed a parry (from systems/skill.ts): the run's count, and the Duelist's chain. */
export function onParryLanded(this: Game, h: Hero): void {
  const m = h.mech;
  m.parries++;
  heroes3Parry(this, h); // the Ronin's counter-slash
  if (m.id !== 'duelist') return;
  const n = m.chainParry();
  if (n > 1) this.vfx.num(h.player.x, 3.3, h.player.z, `CHAIN x${n}`, 'crit');
  if (n === heroMechTuning.duelist.chainMax)
    this.vfx.ring(h.player.x, h.player.z, 0.6, 5, '#b13e53', 0.3);
}

/** Duelist: parry window multiplier and whiff cooldown (systems/skill.ts tryParry). */
export function parryWindowMul(h: Hero): number {
  return h.mech.id === 'duelist' ? heroMechTuning.duelist.parryWindowMul : 1;
}
export function parryWhiff(h: Hero, base: number): number {
  return h.mech.id === 'duelist' ? heroMechTuning.duelist.whiffCooldown : base;
}

/** Snapshot extra for a hero: the Twin's weapon state (undefined for everyone else). */
export function heroMechNet(this: Game, h: Hero): number[] | undefined {
  return h.mech.twin?.weapon ? h.mech.twin.weapon.net() : undefined;
}

/** Client: apply a hero's snapshot extra. */
export function applyHeroMechNet(this: Game, h: Hero, tw: unknown): void {
  if (!Array.isArray(tw)) return;
  const t = twinOf(this, h);
  if (!t) return;
  t.match(h.weapons.find((w) => w.def.slot === 'primary'));
  t.setNet(tw as number[]);
}

// ---------------------------------------------------------------- presentation (every machine)

let auraMesh: THREE.InstancedMesh | null = null;
const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const v = new THREE.Vector3();
const s = new THREE.Vector3();
const up = new THREE.Vector3(0, 1, 0);

function aura(g: Game): THREE.InstancedMesh {
  if (auraMesh && auraMesh.parent === g.scene) return auraMesh;
  const mat = new THREE.MeshBasicMaterial({
    color: '#ff7a2f',
    transparent: true,
    opacity: 0.4,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  // A ring of flame tongues: a jagged band, drawn twice (outer slow, inner fast).
  const geo = new THREE.RingGeometry(0.9, 1, 24, 1).rotateX(-Math.PI / 2);
  auraMesh = new THREE.InstancedMesh(geo, mat, 16);
  auraMesh.frustumCulled = false;
  auraMesh.renderOrder = 1;
  auraMesh.count = 0;
  g.scene.add(auraMesh);
  return auraMesh;
}

/** Draw heat glow and aura, ember puffs and the Twin clone. Clients also tick heat here (cosmetic). */
export function renderHeroMechs(this: Game, alpha: number, frameDt: number): void {
  const am = aura(this);
  am.count = 0;
  const time = this.animTime;
  for (const h of this.heroes) {
    const m = h.mech;
    const p = h.player;
    if (!m.id) {
      p.heatGlow = 0;
      continue;
    }
    if (m.id === 'furnace') {
      // Clients derive heat from the synced velocity (the host's drives damage).
      if (!this.authority && frameDt > 0)
        m.tickHeat(frameDt, p.dead ? 99 : p.speed, this.mode === 'fight' && !p.dead);
      p.heatGlow = p.dead || h.left ? 0 : m.heat;
      const r = m.auraR;
      const x = p.rig.root.position.x;
      const z = p.rig.root.position.z;
      if (r > 0 && !p.dead && am.count < 15) {
        for (let k = 0; k < 2; k++) {
          const rr = r * (k ? 0.82 + 0.05 * Math.sin(time * 9) : 1 + 0.04 * Math.sin(time * 6));
          q.setFromAxisAngle(up, (k ? -1 : 1) * time * (k ? 2.5 : 1.2));
          m4.compose(v.set(x, 0.07 + k * 0.004, z), q, s.set(rr, 1, rr));
          am.setMatrixAt(am.count++, m4);
        }
        (am.material as THREE.MeshBasicMaterial).opacity = 0.2 + 0.3 * m.heat;
      }
      // Embers rise off a hot Furnace; smoke puffs from its chimney.
      if (frameDt > 0 && m.heat > 0.2 && !p.dead && Math.random() < m.heat * frameDt * 14) {
        const a = Math.random() * Math.PI * 2;
        const d = Math.random() * Math.max(0.6, r);
        this.particles.burst(x + Math.cos(a) * d, 0.3, z + Math.sin(a) * d, {
          count: 1,
          color: '#ff7a2f',
          color2: '#ffcd75',
          speed: [0.2, 1],
          size: [0.12, 0.26],
          life: [0.4, 0.8],
          up: 3,
          drag: 1,
        });
      }
      if (frameDt > 0 && m.heat > 0.6 && !p.dead && Math.random() < frameDt * 4) {
        const back = p.aim;
        this.particles.burst(x - back.x * 0.4, 1.7, z - back.z * 0.4, {
          count: 1,
          color: '#566c86',
          color2: '#333c57',
          speed: [0.2, 0.6],
          size: [0.2, 0.35],
          life: [0.6, 1],
          up: 2.5,
          drag: 1,
        });
      }
    } else p.heatGlow = 0;
    if (m.id === 'twin') {
      const tw = twinOf(this, h);
      if (!tw) continue;
      if (!this.authority && frameDt > 0) tw.follow(frameDt);
      tw.render(alpha, time, !p.dead && !h.left && this.mode !== 'title');
    }
  }
  commit(am.instanceMatrix, am.count);
  renderHeroes3(this, frameDt); // Tinker bots (systems/heroes3.ts)
}

/** Achievements that unlock the mechanic heroes (appended to checkAchievements). */
export function heroMechAchievements(this: Game): [string, boolean][] {
  const h = this.hero;
  const clicks = h.weapons.filter((w) => w.def.slot === 'primary' || w.def.slot === 'secondary');
  return [
    ['riposte', h.mech.parries >= 25],
    ['immovable', h.mech.stillBest >= 20],
    ['double_trouble', clicks.length >= 2 && clicks.every((w) => w.evolved)],
    ...heroes3Achievements(this),
  ];
}

/** The hero an achievement unlocks, for its toast. */
export function heroUnlockedBy(id: string): string {
  return HEROES.find((x) => x.unlock === id)?.name ?? '';
}
