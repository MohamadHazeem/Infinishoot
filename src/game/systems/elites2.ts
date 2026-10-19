/** Elite gameplay runs on the authority; movement fields also feed client prediction. */
import type { Game } from '../game';
import type { Enemy } from '../enemies';
import type { Player } from '../player';
import { ELITE_MODS, elites2Tuning as T, berserkBonus, pickEliteMod, CHAMPION_DESC, type EliteModId } from '../../data/eliteMods';
import { ENEMIES } from '../../data/enemies';
import { markCodex } from '../save';
import { localize, t } from '../../i18n';

const FROST_CAP = 64;
interface Frost { x: number; z: number; t: number; id: number }
interface State { arena: Game['arena']; frost: Frost[]; cursor: number; serial: number }
const states = new WeakMap<Game, State>();
function state(g: Game): State {
  let s = states.get(g);
  if (!s || s.arena !== g.arena) {
    s = { arena: g.arena, frost: Array.from({ length: FROST_CAP }, () => ({ x: 0, z: 0, t: 0, id: 0 })), cursor: 0, serial: 0 };
    states.set(g, s);
  }
  return s;
}
export function hasEliteMod(e: Enemy, id: EliteModId): boolean { return e.mod?.id === id || e.mod2?.id === id; }
export function discoverElite(e: Enemy): void {
  if (e.mod) markCodex(`elite:${e.mod.id}`);
  if (e.mod2) { markCodex(`elite:${e.mod2.id}`); markCodex('elite:champion'); }
}
export function makeChampion(g: Game, e: Enemy, forced?: EliteModId): void {
  if (!e.elite || !e.mod || e.mod2) return;
  const id = forced && forced !== e.mod.id ? forced : pickEliteMod(g.rng.next(), !!e.def.split || e.def.behavior === 'spawner' || e.def.behavior === 'exploder', e.def.behavior === 'spawner', e.mod.id);
  e.mod2 = ELITE_MODS[id];
  e.hp = e.maxHp = Math.round(e.maxHp * T.championHp * (e.mod2.hpMul ?? 1));
  e.speedMul *= e.mod2.speedMul ?? 1;
  e.shield = Math.round(e.maxHp * (e.mod?.shield ?? e.mod2.shield ?? 0));
  e.modT = e.mod?.teleport ?? e.mod2.teleport ?? 0;
}
/** The canonical toast travels through Vfx and is translated by each receiver. */
export function eliteToast(e: Enemy): string {
  return e.mod2 ? `CHAMPION ${e.mod!.name.toUpperCase()} + ${e.mod2.name.toUpperCase()} ${e.def.name.toUpperCase()} INCOMING!`
    : `ELITE ${e.mod!.name.toUpperCase()} ${e.def.name.toUpperCase()} INCOMING!`;
}
export function eliteLabel(e: Enemy): string {
  return e.mod2 ? t('elites2.tag', { name: localize(e.def.name) }) : '';
}
export function eliteDetail(e: Enemy): string {
  return e.mod2 ? `${localize(e.mod!.name)} + ${localize(e.mod2.name)}` : '';
}
export function phaseAt(age: number): boolean { return age % T.phaseEvery >= T.phaseEvery - T.phaseTime; }

export function updateElites2(this: Game, dt: number): void {
  if (!this.authority) return;
  const s = state(this);
  for (const f of s.frost) if (f.t > 0) f.t = Math.max(0, f.t - dt);
  for (const e of this.enemies.list) {
    if (!e.active || e.state === 'spawning' || e.under || !e.mod || e.hp <= 0) continue;
    // Phase clocks always advance, even if frozen: immunity can never get stuck on.
    e.eliteAge += dt;
    const phased = hasEliteMod(e, 'phasing') && phaseAt(e.eliteAge);
    if (phased !== e.phaseOut) {
      e.phaseOut = phased;
      this.vfx.ring(e.x, e.z, e.radius, e.radius * 3, ELITE_MODS.phasing.color, phased ? T.phaseTime : 0.3);
      this.vfx.sound('portal', e.x, e.z);
    }
    if (e.phaseOut || e.frozen > 0) continue;
    if (hasEliteMod(e, 'berserk')) {
      const rage = berserkBonus(e.hp, e.maxHp);
      const speed = 1 + rage * T.berserkSpeed, damage = 1 + rage * T.berserkDamage;
      // Relative factors preserve other systems' speed changes without compounding.
      e.speedMul *= speed / e.eliteRageSpeed;
      e.dmgMul *= damage / e.eliteRageDamage;
      e.eliteRageSpeed = speed; e.eliteRageDamage = damage;
    }
    if (hasEliteMod(e, 'summoner') && (e.eliteSummonT -= dt) <= 0) {
      e.eliteSummonT = T.summonEvery;
      for (let n = 0; n < T.summonCount && this.enemies.activeCount < T.summonCap; n++) {
        const a = this.rng.next() * Math.PI * 2;
        const x = e.x + Math.cos(a) * (e.radius + 1.2), z = e.z + Math.sin(a) * (e.radius + 1.2);
        if (Math.abs(x) > this.arena.halfSize - 2 || Math.abs(z) > this.arena.halfSize - 2 || this.walls.hitCircle(x, z, ENEMIES.swarmer.radius)) continue;
        this.enemies.spawn(ENEMIES.swarmer, x, z, this.spawnOpts());
      }
      this.vfx.ring(e.x, e.z, e.radius, 4, ELITE_MODS.summoner.color, 0.5);
      this.vfx.sound('spawn', e.x, e.z);
    }
    if (hasEliteMod(e, 'frostbite') && (e.eliteFrostT -= dt) <= 0) {
      e.eliteFrostT = T.frostEvery;
      const f = s.frost[s.cursor++ % FROST_CAP];
      f.x = e.x; f.z = e.z; f.t = T.frostLife; f.id = ++s.serial;
      frostFx(this, f);
    }
    if (hasEliteMod(e, 'gravity')) {
      const b = this.bullets, rr = T.gravityRadius ** 2;
      for (let i = 0; i < b.count; i++) {
        const dx = e.x - b.x[i], dz = e.z - b.z[i], d2 = dx * dx + dz * dz;
        if (d2 < 0.25 || d2 > rr) continue;
        const k = T.bulletPull * dt / Math.sqrt(d2);
        b.vx[i] += dx * k; b.vz[i] += dz * k;
      }
      if ((e.elitePulseT -= dt) <= 0) {
        e.elitePulseT = 1;
        this.vfx.ring(e.x, e.z, T.gravityRadius, e.radius, '#a35cff', 0.9);
      }
    }
  }
}
function frostFx(g: Game, f: Frost): void {
  // Trail cosmetics derive from el2 snapshots (including late joins); do not also replay them as events.
  const recording = g.vfx.recording;
  g.vfx.recording = false;
  try {
    g.vfx.scar(f.x, f.z, T.frostRadius, '#73eff7', f.t);
    g.vfx.ring(f.x, f.z, T.frostRadius, T.frostRadius, '#73eff7', f.t);
  } finally { g.vfx.recording = recording; }
}
/** Prediction reads authoritative enemies/trails. Dashes escape both fields. */
export function eliteGround(g: Game, x: number, z: number, out: Player['ground']): void {
  let pullX = 0, pullZ = 0;
  for (const e of g.enemies.list) {
    if (!e.alive || e.phaseOut || e.frozen > 0 || !hasEliteMod(e, 'gravity')) continue;
    const dx = e.x - x, dz = e.z - z, d = Math.hypot(dx, dz);
    if (d > 0.5 && d < T.gravityRadius) { pullX += dx / d * T.gravityPull; pullZ += dz / d * T.gravityPull; }
  }
  // Bound stacked gravity wells: a crowd cannot immobilize the hero.
  const scale = Math.min(1, T.gravityPull / (Math.hypot(pullX, pullZ) || 1));
  let slow = false;
  const s = states.get(g);
  if (s?.arena === g.arena) for (const f of s.frost) if (f.t > 0 && (x - f.x) ** 2 + (z - f.z) ** 2 < T.frostRadius ** 2) { slow = true; break; }
  for (const h of g.heroes) {
    const p = h.player;
    if (p.ground !== out) continue;
    if (p.dashing || p.dead) return;
    out.pushX += pullX * scale - (slow ? p.vel.x * T.frostSlow : 0);
    out.pushZ += pullZ * scale - (slow ? p.vel.z * T.frostSlow : 0);
    return;
  }
}
/** Convert the fourth colliding player bullet in place; never duplicate explosive damage. */
export function reflectEliteBullet(g: Game, e: Enemy, i: number): boolean {
  if (!hasEliteMod(e, 'mirrored') || ++e.eliteHits % T.reflectEvery !== 0) return false;
  const b = g.bullets, speed = Math.hypot(b.vx[i], b.vz[i]) || 1;
  const k = -Math.min(speed, T.reflectMaxSpeed) / speed;
  b.vx[i] *= k; b.vz[i] *= k;
  b.team[i] = 1; b.kind[i] = 0; b.homing[i] = b.blast[i] = b.pierce[i] = b.bounce[i] = 0;
  b.damage[i] = Math.max(1, Math.min(T.reflectMaxDamage, b.damage[i] * T.reflectDamage));
  b.life[i] = Math.min(b.life[i], 2);
  b.setColor(i, '#ff3df0');
  b.markHit(i, e.uid);
  g.vfx.ring(e.x, e.z, e.radius, e.radius * 2, ELITE_MODS.mirrored.color, 0.2);
  g.vfx.sound('parry', e.x, e.z);
  return true;
}
export function elites2Net(g: Game): number[][] {
  const s = state(g);
  return s.frost.filter(f => f.t > 0).map(f => [f.id, f.x, f.z, Math.round(f.t * 100) / 100]);
}
export function applyElites2Net(g: Game, raw: unknown): void {
  if (!Array.isArray(raw)) return;
  const s = state(g), last = s.serial;
  for (const f of s.frost) f.t = 0;
  let n = 0;
  for (const row of raw) {
    if (n >= FROST_CAP || !Array.isArray(row) || row.length !== 4 || !row.every(Number.isFinite)) continue;
    const f = s.frost[n++];
    [f.id, f.x, f.z, f.t] = row;
    f.t = Math.max(0, Math.min(T.frostLife, f.t));
    if (f.id > last) frostFx(g, f);
    s.serial = Math.max(s.serial, f.id);
  }
}

/** Shared pixel HUD rules, injected once, no global stylesheet edits. */
export function installEliteStyle(): void {
  if (typeof document === 'undefined' || document.getElementById('elites2-style')) return;
  const css = document.createElement('style'); css.id = 'elites2-style';
  css.textContent = `.ebar .elite-name:empty,.ebar .elite-detail:empty{display:none}.ebar .elite-name,.ebar .elite-detail{display:block;position:absolute;inset-inline-start:50%;transform:translateX(-50%);bottom:calc(13 * var(--p));white-space:nowrap;color:var(--yellow,#ffcd75);background:#1a1c2c;padding:var(--p) calc(2 * var(--p));font:calc(7 * var(--p)) 'Jersey 15',sans-serif;font-style:normal}.ebar .elite-detail{bottom:calc(23 * var(--p));font-size:calc(6 * var(--p));color:#f4f4f4}html[lang=ar] .ebar .elite-name,html[lang=ar] .ebar .elite-detail{font-family:'Noto Sans Arabic',sans-serif;font-size:calc(5 * var(--p))}`;
  document.head.append(css);
}
export function eliteGuide(): string {
  return `<div class="bst"><b>${t('elites2.champions')}</b><small>${localize(CHAMPION_DESC)}</small></div>` + Object.values(ELITE_MODS).slice(6).map(m => `<div class="bst" style="--c:${m.color}"><i class="sw" style="background:${m.color}"></i><b>${localize(m.name)}</b><small>${localize(m.desc)}</small></div>`).join('');
}

/** Fixed-size rewind storage: no arrays allocated while recording a frame. */
export const ELITES2_HISTORY_SIZE = FROST_CAP * 4 + 2;
export function recordElites2(g: Game, out: Float32Array): void {
  const s = states.get(g);
  out.fill(0);
  if (!s || s.arena !== g.arena) return;
  out[0] = s.cursor; out[1] = s.serial;
  for (let i = 0; i < FROST_CAP; i++) {
    const f = s.frost[i], o = 2 + i * 4;
    out[o] = f.id; out[o + 1] = f.x; out[o + 2] = f.z; out[o + 3] = f.t;
  }
}
export function restoreElites2(g: Game, data: Float32Array): void {
  const s = state(g);
  s.cursor = data[0]; s.serial = data[1];
  for (let i = 0; i < FROST_CAP; i++) {
    const f = s.frost[i], o = 2 + i * 4;
    f.id = data[o]; f.x = data[o + 1]; f.z = data[o + 2]; f.t = data[o + 3];
  }
}
