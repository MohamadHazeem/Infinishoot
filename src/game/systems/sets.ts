/**
 * Item sets (src/data/sets.ts): counts each hero's set pieces and runs the 2 / 4 / 6 bonuses.
 * Gameplay runs on the host (solo/host) from small hooks in combat, statuses, dash and updateHero;
 * stat bonuses go through Hero.statsWithPassives (static) and Hero.refreshLive (timed buffs), so
 * clients get them with the synced stats. Effects travel on the effects bus (game.vfx).
 * Each machine counts its own hero's pieces (from the mirrored weapons, passives, relics and Mods)
 * for the UI chips, the pause SETS panel and the tier flourish, so the lane adds no snapshot field.
 */
import type { Game } from '../game';
import type { Hero } from '../hero';
import type { Enemy } from '../enemies';
import type { Stats } from '../stats';
import type { ModEvent } from '../modTypes';
import type { Tag } from '../../data/tags';
import { WEAPONS } from '../../data/weapons';
import { SET_COUNT, SET_INDEX, SET_PIECES, SETS, setTier, setsTuning as T } from '../../data/sets';
import { bossLike } from '../bossRules';
import { t } from '../../i18n';
import { setsView, setName, tierText } from '../../ui/setsUi';

const INF = SET_INDEX.inferno;
const STORM = SET_INDEX.storm;
const GLA = SET_INDEX.glacier;
const BUL = SET_INDEX.bulwark;
const SPD = SET_INDEX.speedster;
const BOOM = SET_INDEX.boomsmith;
const MACH = SET_INDEX.machinist;
const DUEL = SET_INDEX.duelist;

/** Damage sources made by set bonuses (damage breakdown names; they never retrigger set hit effects). */
export const SET_SOURCE_NAMES: Record<string, string> = {
  set_inferno: 'Inferno Set',
  set_storm: 'Stormcaller Set',
  set_glacier: 'Glacier Set',
  set_bulwark: 'Bulwark Set',
  set_speed: 'Speedster Set',
  set_boom: 'Boomsmith Set',
  set_bot: 'Support Bot',
};

const FIRE_BOOM: Tag[] = ['fire', 'explosive'];
const EXPLOSIVE: Tag[] = ['explosive'];
const FROST: Tag[] = ['frost'];
const TRAIL: Tag[] = ['trail'];
const BOT_TAGS: Tag[] = ['shock', 'chain'];
const NO_TAGS: Tag[] = [];

/** One hero's set state: piece counts, active tiers and the bonus timers. */
export class HeroSets {
  /** Pieces per set (index = SETS order). */
  readonly counts = new Int8Array(SET_COUNT);
  /** Active tier per set (0..3). */
  readonly tiers = new Int8Array(SET_COUNT);
  /** Count scratch for stat previews. */
  readonly scratch = new Int8Array(SET_COUNT);
  /** Any tier active (fast path for the damage hooks). */
  any = false;
  /** Client: this hero's Mod ids from the host's snapshot (the client has no real Mod slots). */
  clientMods: readonly string[] | null = null;
  hits = 0;
  stormCd = 0;
  waveCd = 0;
  barrier = false;
  barrierT = 0;
  /** Speedster 6: weapons faster and harder after a dash. */
  buffT = 0;
  /** Duelist 6: guaranteed crits. */
  critT = 0;
  botT = 0;
  carpetT = 0;
  /** Set-made explosions left this second. */
  budget = T.boomBudget;
  /** Boomsmith 4: the last enemy an explosive hit of ours left dead. */
  boomKill = -1;
  /** Carpet bombs waiting to land. */
  readonly drops: { x: number; z: number; t: number }[] = [];

  reset(): void {
    this.counts.fill(0);
    this.tiers.fill(0);
    this.any = false;
    this.hits = this.stormCd = this.waveCd = this.buffT = this.critT = this.botT = 0;
    this.barrier = false;
    this.barrierT = T.bulwarkBarrierCd;
    this.carpetT = T.carpetEvery;
    this.budget = T.boomBudget;
    this.boomKill = -1;
    this.drops.length = 0;
  }

  tier(set: number): number {
    return this.tiers[set];
  }
}

function add(out: Int8Array, id: string): void {
  const sets = SET_PIECES[id];
  if (sets) for (let i = 0; i < sets.length; i++) out[sets[i]]++;
}

/** Count a hero's pieces: weapons (fusions as their parts), the special, passives, relics and Mods. */
export function countPieces(h: Hero, out: Int8Array, passives: Record<string, number> = h.passives): Int8Array {
  out.fill(0);
  for (const w of h.weapons) {
    const parts = w.def.fusion ?? WEAPONS[w.def.id]?.fusion;
    if (parts) {
      add(out, parts[0]);
      add(out, parts[1]);
    } else add(out, w.def.id);
  }
  add(out, 'sp_' + h.special.id);
  for (const id in passives) if (passives[id] > 0) add(out, id);
  for (const id of h.relics) add(out, id);
  const mods = h.sets.clientMods;
  if (mods) for (const id of mods) add(out, id);
  else for (const s of h.synergy.slots) add(out, s.def.id);
  return out;
}

/** Static set bonuses on top of passives, relics and Mods (Hero.statsWithPassives). */
export function applySetStatic(h: Hero, s: Stats, passives: Record<string, number>): void {
  const c = countPieces(h, h.sets.scratch, passives);
  const tier = (i: number) => setTier(c[i]);
  if (tier(GLA) >= 2) s.freezeChance += T.glacierFreeze;
  if (tier(BUL) >= 1) s.armor += T.bulwarkArmor;
  if (tier(SPD) >= 1) {
    s.moveSpeedMul += T.speedMove;
    s.dashCooldownMul = Math.max(0.5, s.dashCooldownMul - T.speedDash);
  }
  if (tier(SPD) >= 2) s.dashCharges += 1;
  if (tier(MACH) >= 1) s.cooldownMul -= T.machCooldown;
  if (tier(MACH) >= 3) s.cooldownMul -= T.machCooldown6;
  s.cooldownMul = Math.max(0.4, s.cooldownMul);
  if (tier(DUEL) >= 1) s.critChance = Math.min(1, s.critChance + T.duelCrit);
  if (tier(DUEL) >= 2) s.critMult += T.duelCritMult;
}

/** Timed set buffs (Hero.refreshLive, every step). */
export function applySetLive(h: Hero): void {
  const st = h.sets;
  if (!st.any) return;
  if (st.buffT > 0 && st.tiers[SPD] >= 3) {
    h.stats.cooldownMul /= 1 + T.speedBuffRate;
    h.stats.damageMul *= 1 + T.speedBuffDmg;
  }
  if (st.critT > 0 && st.tiers[DUEL] >= 3) h.stats.critChance = 1;
}

/** Recount; returns true when any tier changed. Tiers that went up are written to `rose` (bit per set). */
function retier(st: HeroSets): number {
  let rose = 0;
  let changed = false;
  let any = false;
  for (let i = 0; i < SET_COUNT; i++) {
    const tr = setTier(st.counts[i]);
    if (tr !== st.tiers[i]) {
      changed = true;
      if (tr > st.tiers[i]) rose |= 1 << i;
      st.tiers[i] = tr;
    }
    if (tr > 0) any = true;
  }
  st.any = any;
  return changed ? rose | (1 << 30) : 0;
}

const stageDmg = (g: Game, base: number, per: number) => base + per * g.stage;

/** Host step for one hero, before refreshLive (systems hook in Game.updateHero). */
export function setsStep(this: Game, h: Hero, dt: number): void {
  const st = h.sets;
  countPieces(h, st.counts);
  const ch = retier(st);
  if (ch) {
    h.recomputeStats();
    const rose = ch & ~(1 << 30);
    if (rose && !h.player.dead) {
      for (let i = 0; i < SET_COUNT; i++) {
        if (!(rose & (1 << i))) continue;
        const c = SETS[i].color;
        this.vfx.ring(h.player.x, h.player.z, 1, 7, c, 0.5);
        this.vfx.burst(h.player.x, 1.2, h.player.z, { count: 18, color: c, color2: '#f4f4f4', speed: [3, 7], size: [0.12, 0.25], life: [0.4, 0.7], up: 6, gravity: 8 });
      }
    }
  }
  if (!st.any || h.left) return;
  st.budget = Math.min(T.boomBudget, st.budget + T.boomBudget * dt);
  if (st.stormCd > 0) st.stormCd -= dt;
  if (st.waveCd > 0) st.waveCd -= dt;
  if (st.buffT > 0) st.buffT -= dt;
  if (st.critT > 0) st.critT -= dt;
  const p = h.player;
  if (p.dead) return;
  // Bulwark 6: a barrier forms again after the cooldown.
  if (st.tiers[BUL] >= 3 && !st.barrier && (st.barrierT -= dt) <= 0) {
    st.barrier = true;
    this.vfx.ring(p.x, p.z, 0.6, 2.6, SETS[BUL].color, 0.45);
    this.vfx.sound('w:shieldUp', p.x, p.z);
  }
  // Machinist 4/6: the support bot zaps the nearest enemy.
  if (st.tiers[MACH] >= 2 && (st.botT -= dt) <= 0) {
    const six = st.tiers[MACH] >= 3;
    st.botT = six ? T.botEvery6 : T.botEvery;
    const e = this.nearestEnemy(p.x, p.z, T.botRange, (o) => o.pvpOwner === h.index);
    if (e) {
      const dmg = stageDmg(this, T.botDmg, T.botDmgPerStage);
      this.vfx.burst(p.x, 1.6, p.z, { count: 2, color: '#41a6f6', color2: '#ffffff', speed: [0, 0.5], size: [0.12, 0.2], life: [0.08, 0.14], arc: [Math.round(e.x * 100) / 100, Math.round(e.z * 100) / 100] });
      this.vfx.star(e.x, 1, e.z, 1, '#73eff7', 0.1);
      this.vfx.sound('w:minionZap', e.x, e.z);
      this.damage(e, dmg, { source: 'set_bot', tags: BOT_TAGS }, h);
      if (six && e.active && e.hp > 0) this.zap(e, T.botHops6, dmg * 0.6, h);
    }
  }
  // Boomsmith 6: a carpet bomb on the crowd around you.
  if (st.tiers[BOOM] >= 3 && (st.carpetT -= dt) <= 0) {
    st.carpetT = T.carpetEvery;
    const near = this.enemiesInRadius(p.x, p.z, T.carpetRange, scratch);
    for (let i = 0; i < T.carpetBlasts && near.length; i++) {
      const k = Math.floor(this.rng.next() * near.length);
      const e = near[k];
      near[k] = near[near.length - 1];
      near.pop();
      st.drops.push({ x: e.x, z: e.z, t: 0.45 + i * 0.12 });
      this.vfx.ring(e.x, e.z, T.carpetR * 1.6, T.carpetR * 0.4, SETS[BOOM].color, 0.45);
    }
    if (st.drops.length) this.vfx.sound('bossWindup', p.x, p.z, 1.6);
  }
  for (let i = st.drops.length - 1; i >= 0; i--) {
    const d = st.drops[i];
    if ((d.t -= dt) > 0) continue;
    st.drops[i] = st.drops[st.drops.length - 1];
    st.drops.pop();
    this.blast(d.x, d.z, T.carpetR, stageDmg(this, T.carpetDmg, T.carpetDmgPerStage), SETS[BOOM].color, 'set_boom', EXPLOSIVE, false, h);
  }
}
const scratch: Enemy[] = [];

/** Extra damage multiplier for a hit (combat.ts damage(), after statuses). */
export function setsDamageMul(this: Game, e: Enemy, by: Hero): number {
  const st = by.sets;
  if (!st.any) return 1;
  let m = 1;
  if (st.tiers[INF] >= 1 && e.burnT > 0) m += T.infernoBurnMul;
  if (st.tiers[STORM] >= 1 && e.shockT > 0) m += T.stormShockMul;
  if (st.tiers[GLA] >= 1 && e.frozen > 0) m += T.glacierFrozenMul;
  return m;
}

/** After a hit with statuses (combat.ts damage()). */
export function setsHit(this: Game, e: Enemy, crit: boolean, amount: number, source: string, tags: readonly Tag[], by: Hero): void {
  const st = by.sets;
  if (!st.any || this.role === 'client') return;
  if (tags.includes('explosive') && e.hp <= 0) st.boomKill = e.uid;
  if (source.startsWith('set_') || source === 'zap' || source === 'burn') return;
  const alive = e.active && e.hp > 0 && e.shield <= 0;
  // Duelist 4: crits Expose.
  if (crit && alive && st.tiers[DUEL] >= 2) this.expose(e);
  // Inferno 6: every hit ignites.
  if (alive && st.tiers[INF] >= 3 && !tags.includes('fire')) this.ignite(e, Math.max(3, amount * T.infernoIgnite), by);
  // Stormcaller 4: hits on Shocked enemies arc on.
  if (alive && st.tiers[STORM] >= 2 && e.shockT > 0 && this.rng.chance(T.stormArcChance)) this.zap(e, T.stormArcHops, Math.max(4, amount * T.stormArcFrac), by);
  // Stormcaller 6: every Nth hit calls a lightning storm.
  if (st.tiers[STORM] >= 3 && ++st.hits >= T.stormEvery && st.stormCd <= 0) {
    st.hits = 0;
    st.stormCd = T.stormCooldown;
    stormCall(this, by);
  }
}

function stormCall(g: Game, h: Hero): void {
  const p = h.player;
  const near = g.enemiesInRadius(p.x, p.z, T.stormRange, scratch);
  const picks: Enemy[] = [];
  for (let i = 0; i < T.stormBolts && near.length; i++) {
    const k = Math.floor(g.rng.next() * near.length);
    picks.push(near[k]);
    near[k] = near[near.length - 1];
    near.pop();
  }
  if (!picks.length) return;
  g.vfx.num(p.x, 3, p.z, 'STORM!', 'crit', h.index);
  g.vfx.sound('thunder', p.x, p.z);
  const dmg = stageDmg(g, T.stormBolt, T.stormBoltPerStage);
  for (const e of picks) {
    if (!e.active || e.hp <= 0) continue;
    g.vfx.burst(e.x, 9, e.z, { count: 2, color: '#fff35c', color2: '#ffffff', speed: [0, 0.5], size: [0.15, 0.25], life: [0.1, 0.16], arc: [Math.round(e.x * 100) / 100, Math.round(e.z * 100) / 100] });
    g.vfx.ring(e.x, e.z, 0.5, 2.4, '#fff35c', 0.25);
    g.vfx.star(e.x, 1, e.z, 1.6, '#fff35c', 0.12);
    g.damage(e, dmg, { source: 'set_storm', tags: BOT_TAGS, loud: true }, h);
  }
}

/** On a kill, before the enemy goes back to the pool (statuses.ts killEnemy). */
export function setsKill(this: Game, e: Enemy, _source: string, by: Hero | null): void {
  if (!by || !by.sets.any || this.role === 'client') return;
  const st = by.sets;
  const boomKill = st.boomKill === e.uid;
  if (boomKill) st.boomKill = -1;
  // Inferno 4: Burning enemies explode.
  if (st.tiers[INF] >= 2 && e.burnT > 0 && st.budget >= 1) {
    st.budget--;
    this.blast(e.x, e.z, T.infernoBoomR, stageDmg(this, T.infernoBoom, T.infernoBoomPerStage), SETS[INF].color, 'set_inferno', FIRE_BOOM, false, by);
  }
  // Glacier 6: Frozen kills burst into a freezing nova.
  if (st.tiers[GLA] >= 3 && e.frozen > 0 && st.budget >= 1) {
    st.budget--;
    glacierNova(this, e.x, e.z, by);
  }
  // Boomsmith 4: what our explosions kill can explode again.
  if (st.tiers[BOOM] >= 2 && boomKill && st.budget >= 1 && this.rng.chance(T.boomChance)) {
    st.budget--;
    this.blast(e.x, e.z, T.boomR, stageDmg(this, T.boomDmg, T.boomDmgPerStage), SETS[BOOM].color, 'set_boom', EXPLOSIVE, false, by);
  }
}

function glacierNova(g: Game, x: number, z: number, h: Hero): void {
  g.vfx.ring(x, z, 1, T.glacierNovaR * 2, '#9fe8ff', 0.3);
  g.vfx.burst(x, 0.8, z, { count: 12, color: '#ffffff', color2: '#73eff7', speed: [4, 9], size: [0.12, 0.25], life: [0.25, 0.45], up: 3, gravity: 10 });
  g.vfx.sound('w:freeze', x, z);
  const dmg = stageDmg(g, T.glacierNova, T.glacierNovaPerStage);
  const list = g.enemiesInRadius(x, z, T.glacierNovaR, scratch).slice();
  for (const o of list) {
    if (!o.active || o.hp <= 0) continue;
    o.frozen = Math.max(o.frozen, bossLike(o) ? 0.3 : T.glacierNovaFreeze);
    g.damage(o, dmg, { source: 'set_glacier', tags: FROST, noStatus: true }, h);
  }
}

/** Explosion size multiplier (combat.ts blast(), explosive blasts). */
export function setsBlastMul(this: Game, by: Hero): number {
  return by.sets.tiers[BOOM] >= 1 ? 1 + T.boomArea : 1;
}

/** Bulwark 6: the barrier eats the hit. True = blocked (statuses.ts hurtHero, before damage). */
export function setsBlock(this: Game, h: Hero): boolean {
  const st = h.sets;
  if (!st.barrier || st.tiers[BUL] < 3 || this.role === 'client') return false;
  st.barrier = false;
  st.barrierT = T.bulwarkBarrierCd;
  const p = h.player;
  p.invuln = Math.max(p.invuln, 0.5);
  this.vfx.ring(p.x, p.z, 0.6, 4, SETS[BUL].color, 0.35);
  this.vfx.num(p.x, 2.8, p.z, 'BLOCKED', 'player');
  this.vfx.sound('shieldBreak', p.x, p.z);
  return true;
}

/** After a hit landed on the hero (statuses.ts hurtHero). Bulwark 4: a shockwave. */
export function setsHurt(this: Game, h: Hero): void {
  const st = h.sets;
  if (st.tiers[BUL] < 2 || st.waveCd > 0 || this.role === 'client') return;
  st.waveCd = T.bulwarkWaveCd;
  const p = h.player;
  this.vfx.ring(p.x, p.z, 1, T.bulwarkWaveR * 2, SETS[BUL].color, 0.3);
  this.vfx.shake(p.x, p.z, 0.2);
  const dmg = stageDmg(this, T.bulwarkWave, T.bulwarkWavePerStage);
  for (const e of this.enemiesInRadius(p.x, p.z, T.bulwarkWaveR, scratch).slice()) {
    if (e.pvpOwner === h.index) continue;
    const d = Math.hypot(e.x - p.x, e.z - p.z) || 1;
    this.damage(e, dmg, { source: 'set_bulwark', tags: NO_TAGS, dirX: (e.x - p.x) / d, dirZ: (e.z - p.z) / d, knockback: 14, noStatus: true }, h);
  }
}

/** Every dash (game.ts onDash). Speedster 4: slipstream burst; 6: the post-dash buff. */
export function setsDash(this: Game, h: Hero): void {
  const st = h.sets;
  if (this.role === 'client') return;
  if (st.tiers[SPD] >= 2) this.blast(h.player.x, h.player.z, T.speedSlipR, stageDmg(this, T.speedSlip, T.speedSlipPerStage), SETS[SPD].color, 'set_speed', TRAIL, false, h);
  if (st.tiers[SPD] >= 3) st.buffT = T.speedBuffTime;
}

/** Skill events (mods2Event). Duelist 6: parry / perfect dodge -> guaranteed crits. */
export function setsEvent(this: Game, h: Hero, kind: ModEvent): void {
  const st = h.sets;
  if (this.role === 'client' || st.tiers[DUEL] < 3 || (kind !== 'parry' && kind !== 'perfectDash')) return;
  st.critT = T.duelGuaranteed;
  this.vfx.num(h.player.x, 3, h.player.z, 'EN GARDE!', 'crit', h.index);
  this.vfx.ring(h.player.x, h.player.z, 0.8, 3.5, SETS[DUEL].color, 0.3);
}

export function setSourceName(id: string): string | undefined {
  return SET_SOURCE_NAMES[id];
}

// ---------------------------------------------------------------- local presentation (every machine)

let lastMods: unknown = null;
let shownRun = -1;
const shown = new Int8Array(SET_COUNT);

/** Every frame (render): count this machine's hero for the UI and play the tier flourish. */
export function setsFrame(g: Game): void {
  const h = g.hero;
  if (!h) return;
  if (g.role === 'client') {
    if (g.netMods !== lastMods) {
      lastMods = g.netMods;
      h.sets.clientMods = g.netMods.map((m) => m.id);
    }
    countPieces(h, h.sets.counts);
    retier(h.sets);
  }
  setsView.counts = h.sets.counts;
  // New run (or the first frames of one): take the tiers silently, so loadout pieces don't fanfare.
  const runKey = g.runTime < 1.5 ? -1 : 1;
  if (runKey < 0 || shownRun < 0) {
    shown.set(h.sets.tiers);
    shownRun = runKey;
    return;
  }
  for (let i = 0; i < SET_COUNT; i++) {
    const tr = h.sets.tiers[i];
    if (tr > shown[i]) flourish(g, i, tr);
    shown[i] = tr;
  }
}

function flourish(g: Game, set: number, tier: number): void {
  const def = SETS[set];
  const n = [0, 2, 4, 6][tier];
  g.hud.showBanner(t('sets.banner', { set: setName(def.id), n }), tierText(def.id, tier), 2.4);
  // Lazy: hero.ts imports this module, and unit tests load heroes without a window (sfx needs one).
  void import('../../audio/sfx').then(({ sfx }) => sfx.play('setTier', 0.3, 'ui', (k) => {
    const base = 392 * 2 ** (tier / 12);
    [1, 1.26, 1.5, 2].forEach((m, i) => k.tone('square', base * m, base * m, 0.12, 0.09, i * 0.07));
    k.tone('triangle', base * 2, base * 2.02, 0.5, 0.08, 0.3);
    if (tier >= 3) k.noise(0.4, 0.12, 6000, 2000, 1, 0.3);
  }));
}
