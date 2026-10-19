/**
 * Skill layer: perfect dashes, parries, the style meter, hero ultimates and
 * per-weapon feel (src/game/style.ts, src/game/ultimates.ts, WEAPON_FEEL in
 * src/data/weapons.ts). These are Game methods (`this` is the Game),
 * installed on the class as fields, e.g. `updateSkill = SkillSys.updateSkill;`.
 *
 * Everything gameplay runs on the host in update(): clients send their
 * parry/ultimate presses (`parry` / `ult` messages) and the host simulates
 * them like its own. Snapshots carry each hero's style, ultimate charge and
 * buff (`sk`) plus a short list of skill events (perfect dash, parry,
 * ultimate, rank up) that every machine turns into sounds and, for its own
 * hero, local feedback (dash refund, flash, banner, announcer).
 */
import { hostileBullet } from './followups';
import { pvpFriendly } from '../pvp';
import type { Game } from '../game';
import { dashKeyPressed } from '../heroMechs';
import { parryWhiff, parryWindowMul } from './heroMechs';
import type { Hero } from '../hero';
import type { Enemy } from '../enemies';
import { BULLET_Y, Team } from '../bullets';
import { type DamageOpts } from '../weapons';
import { settings } from '../settings';
import { music } from '../../audio/music';
import { sfx } from '../../audio/sfx';
import { PAD_PARRY, PAD_ULT } from '../../core/keybinds';
import { feelOf, WEAPONS } from '../../data/weapons';
import { bulletThreat, rankName, skillTuning, styleTuning, type StyleNote } from '../style';
import { endUlt, power, startUlt, ultHitGain, ultKillGain, ultOf, ultTuning, updateUlt } from '../ultimates';
import { preloadSkillAudio, skillSound } from '../skillAudio';
import { SkillHud } from '../../ui/styleMeter';
import { bossLike } from '../bossRules';
import { bulletWasInReach, clientHeartbeat, clientRtt, heroParryLag, markParryPredicted, onlineStop, parryPredicted, refundRewoundHits, remoteParry } from '../netFeel';

/** Skill events: [seq, kind, hero index, x, z, extra]. pd = perfect dash, pa = parry, ul = ultimate, rk = rank up (extra = rank), hs = online hit-stop (extra = seconds), sw = parry swing (every attempt). */
type SkillEvent = [number, 'pd' | 'pa' | 'ul' | 'rk' | 'hs' | 'sw', number, number, number, number];

interface SkillWorld {
  seq: number;
  /** Recent events with the time they happened (host keeps ~1 s for snapshots). */
  events: { ev: SkillEvent; at: number }[];
  /** No new hit-stop before this sim step (keeps rapid hits from stuttering). */
  stopStep: number;
  /** Music beat tracking (wall-clock seconds). */
  beats: number;
  beatAt: number;
  beatPeriod: number;
  hud: SkillHud | null;
  preloaded: boolean;
  /** Last rank each hero announced (index -> rank). */
  ranks: number[];
  /** Online: no new hit-stop for hero i before this sim step. */
  heroStop: number[];
}

const worlds = new WeakMap<Game, SkillWorld>();
function world(g: Game): SkillWorld {
  let w = worlds.get(g);
  if (!w) {
    w = { seq: 0, events: [], stopStep: 0, beats: -1, beatAt: -9, beatPeriod: 0.5, hud: null, preloaded: false, ranks: [], heroStop: [] };
    worlds.set(g, w);
  }
  return w;
}

const now = () => performance.now() / 1000;
const r2 = (v: number) => Math.round(v * 100) / 100;

/** Kills with the clicks (left/right weapons) can land on the beat. */
function isClick(source: string): boolean {
  return !!WEAPONS[source]?.slot || source === 'charge';
}

/** True within ~0.09 s of a music beat (either side). */
function onBeat(w: SkillWorld): boolean {
  if (w.beatAt < 0) return false;
  const t = now();
  const since = t - w.beatAt;
  const until = w.beatPeriod - since;
  return since < 0.09 || (until > 0 && until < 0.09);
}

// ---------------------------------------------------------------- input

/** Local hero (solo/host): parry and ultimate presses. */
export function skillInput(this: Game, h: Hero, control: boolean): void {
  if (!control) return;
  const input = this.input;
  // The Duelist has no dash: its dash key parries (src/game/heroMechs.ts).
  if (input.actionPressed('parry') || PAD_PARRY.some((b) => input.padButtonPressed(b)) || (h.player.noDash && dashKeyPressed(input))) this.tryParry(h);
  if (input.actionPressed('ult') || PAD_ULT.some((b) => input.padButtonPressed(b))) this.tryUlt(h);
}

/** Client: send presses to the host (it simulates them) and show the swing right away. */
export function skillClientInput(this: Game, control: boolean): void {
  const h = this.hero;
  const sk = h.skill;
  sk.parryCd = Math.max(0, sk.parryCd - 1 / 60);
  clientHeartbeat(this);
  if (!control || !this.client) return;
  const input = this.input;
  if ((input.actionPressed('parry') || PAD_PARRY.some((b) => input.padButtonPressed(b)) || (h.player.noDash && dashKeyPressed(input))) && sk.parryCd <= 0) {
    sk.parryCd = parryWhiff(h, skillTuning.parryCooldown);
    // The round trip lets the host rewind the judgement (src/game/netFeel.ts).
    this.client.send({ t: 'parry', rtt: clientRtt(this) });
    parrySwing(this, h);
    predictParry(this, h);
  }
  if ((input.actionPressed('ult') || PAD_ULT.some((b) => input.padButtonPressed(b))) && sk.ult >= 1 && sk.ultT <= 0) this.client.send({ t: 'ult' });
}

/** Host: a client's parry or ultimate press. */
export function skillMessage(this: Game, h: Hero, t: string): void {
  if (!this.isCombatMode || h.player.dead) return;
  if (t === 'parry') this.tryParry(h);
  else if (t === 'ult') this.tryUlt(h);
}

// ---------------------------------------------------------------- perfect dash

/** A dash just started (any hero, host): check for a last-moment dodge. */
export function skillDash(this: Game, h: Hero): void {
  const sk = h.skill;
  sk.dashPerfect = false;
  sk.dashScanT = skillTuning.perfectScan;
  if (threatened(this, h, true)) this.perfectDash(h);
}

/**
 * Is something about to hit (or passing through) hero h? `lead` = look ahead
 * (dash start: would it have hit within perfectLead s?); otherwise only what
 * overlaps right now (grazing through it mid-dash).
 */
function threatened(g: Game, h: Hero, lead: boolean): boolean {
  const p = h.player;
  const T = skillTuning;
  const b = g.bullets;
  for (let i = 0; i < b.count; i++) {
    if (!hostileBullet(g, h.index, i)) continue;
    const dx = b.x[i] - p.x;
    const dz = b.z[i] - p.z;
    if (dx * dx + dz * dz > 64) continue;
    const reach = b.radius[i] + p.radius * 0.8 + T.perfectMargin;
    if (lead ? bulletThreat(p.x, p.z, b.x[i], b.z[i], b.vx[i], b.vz[i], reach, T.perfectLead) : dx * dx + dz * dz <= reach * reach) return true;
  }
  let hit = false;
  g.hash.query(p.x, p.z, 4, (e) => {
    if (hit || !e.alive || e.frozen > 0 || e.pvpOwner >= 0 || e.contactDamage <= 0) return;
    const attacking = e.state === 'attack' || (lead && e.state === 'windup' && e.t < T.perfectLead);
    if (!attacking) return;
    const rr = e.radius + p.radius + T.perfectMargin + (lead ? 0.5 : 0);
    if ((e.x - p.x) ** 2 + (e.z - p.z) ** 2 < rr * rr) hit = true;
  });
  if (hit) return true;
  // Telegraphed ground strikes about to land on you.
  if (lead) for (const s of g.strikes) if (s.t < T.perfectLead + 0.1 && (s.x - p.x) ** 2 + (s.z - p.z) ** 2 < (s.r + p.radius) ** 2) return true;
  return false;
}

export function perfectDash(this: Game, h: Hero): void {
  const sk = h.skill;
  const p = h.player;
  const T = skillTuning;
  if (sk.dashPerfect) return;
  sk.dashPerfect = true;
  this.mods2Event(h, 'perfectDash');
  sk.dashScanT = 0;
  sk.buffT = T.buffTime;
  p.invuln = Math.max(p.invuln, T.perfectIframes);
  sk.style.add(styleTuning.perfectDash, 'PERFECT DODGE');
  chargeUlt(this, h, ultTuning.perfectGain);
  if (!this.online && settings.slowMo !== false) this.slowMoT = Math.max(this.slowMoT, T.perfectSlowMo);
  this.vfx.star(p.x, 1.2, p.z, 3, '#ffcd75', 0.2);
  this.vfx.ring(p.x, p.z, 0.6, 5, '#ffffff', 0.3);
  this.vfx.burst(p.x, 1, p.z, { count: 22, color: '#ffcd75', color2: '#ffffff', speed: [3, 8], size: [0.12, 0.26], life: [0.3, 0.6], up: 4, gravity: 4, drag: 2 });
  this.vfx.num(p.x, 2.8, p.z, 'PERFECT!', 'score');
  emit(this, 'pd', h);
}

// ---------------------------------------------------------------- parry

/** Press parry: open a short window; a whiff costs the full cooldown. */
export function tryParry(this: Game, h: Hero): void {
  const sk = h.skill;
  if (sk.parryCd > 0 || h.player.dead || !this.isCombatMode) return;
  // Remote parries: with a measured ping the host rewinds (src/game/netFeel.ts), else the old fixed allowance.
  const lag = heroParryLag(this, h);
  sk.parryT = (lag > 0 ? remoteParry(lag, skillTuning.parryReach, skillTuning.parryWindow).window : h.remote ? skillTuning.parryWindowRemote : skillTuning.parryWindow) * parryWindowMul(h);
  sk.parryCd = parryWhiff(h, skillTuning.parryCooldown);
  sk.parried = 0;
  // The client already drew its own swing; everyone else draws it from the 'sw' event.
  if (!h.remote) parrySwing(this, h);
  emit(this, 'sw', h);
  doParry(this, h, lag);
  if (lag > 0) {
    // Bullets that hit in the last `lag` seconds would have been parried on the client's screen: undo and reflect them.
    const p = h.player;
    const n = refundRewoundHits(this, h, lag, (vx, vz) => {
      const l = Math.hypot(vx, vz) || 1;
      const before = this.bullets.count;
      this.bullets.spawn({ x: p.x - (vx / l) * 0.6, z: p.z - (vz / l) * 0.6, dirX: -vx / l, dirZ: -vz / l, speed: 10, life: 1, radius: 0.26, damage: 0, knockback: 0, team: Team.Enemy, color: '#ff3df0', width: 0.5, length: 0.5 });
      if (this.bullets.count > before) reflectBullet(this, h, this.bullets.count - 1);
    });
    if (n > 0) parried(this, h, n);
  }
}

/**
 * Client: judge the parry on our own screen for instant feedback. Bullets in
 * reach flip locally (cosmetic: the next snapshot brings the host's verdict).
 */
function predictParry(g: Game, h: Hero): void {
  const p = h.player;
  const T = skillTuning;
  const reach = p.radius + T.parryReach;
  const b = g.bullets;
  let n = 0;
  for (let i = 0; i < b.count; i++) {
    if (!hostileBullet(g, h.index, i)) continue;
    const dx = b.x[i] - p.x;
    const dz = b.z[i] - p.z;
    const rr = reach + b.radius[i];
    if (dx * dx + dz * dz > rr * rr) continue;
    b.team[i] = Team.Player;
    b.owner[i] = h.index;
    b.vx[i] = -b.vx[i];
    b.vz[i] = -b.vz[i];
    b.setColor(i, '#7df9ff');
    n++;
  }
  if (!n) return;
  markParryPredicted(g, true);
  skillSound('parry', true, 1);
  p.skillGlow = Math.max(p.skillGlow, 0.5);
  g.hud.flash(0.22);
  g.juice.shake(0.2);
  g.input.rumble(0.7, 0.5, 140);
  onlineStop(g, T.parryFreeze);
}

const swingHand = { x: 0, z: 0 };

/**
 * The swing itself (cosmetic, local fx on each machine): a ring at the hand
 * and an arc of sparks sweeping across the aim. Every machine draws every
 * hero's swing: its own on the press, the others from the 'sw' skill event.
 */
function parrySwing(g: Game, h: Hero): void {
  const p = h.player;
  p.muzzle(swingHand);
  g.fx.ring(swingHand.x, swingHand.z, 0.5, 2.2, '#73eff7', 0.14);
  const a0 = Math.atan2(p.aim.z, p.aim.x);
  const r = p.radius + 0.9;
  for (let k = 0; k < 7; k++) {
    const t = k / 6;
    const a = a0 - 1.1 + t * 2.2;
    g.fx.star(p.x + Math.cos(a) * r, 1.1, p.z + Math.sin(a) * r, 0.4 + 0.4 * Math.sin(t * Math.PI), k === 3 ? '#ffffff' : '#73eff7', 0.1 + t * 0.08);
  }
  p.recoil = Math.max(p.recoil, 1.4);
  p.bounce(-3);
}

/** Enemies already handled by this parry check (reused, no allocation). */
const parrySeen = new Set<Enemy>();

/** Turn enemy bullet i into hero h's reflected shot, back at the nearest enemy. */
function reflectBullet(g: Game, h: Hero, i: number): void {
  const T = skillTuning;
  const b = g.bullets;
  // Back at the nearest enemy (the shooter, usually), else straight back.
  const t = g.nearestEnemy(b.x[i], b.z[i], 16, (e) => pvpFriendly(g.pvp?.teams, e.pvpOwner, h.index));
  let ux = -b.vx[i];
  let uz = -b.vz[i];
  if (t) {
    ux = t.x - b.x[i];
    uz = t.z - b.z[i];
  }
  const l = Math.hypot(ux, uz) || 1;
  b.team[i] = Team.Player;
  b.vx[i] = (ux / l) * T.reflectSpeed;
  b.vz[i] = (uz / l) * T.reflectSpeed;
  b.damage[i] = T.reflectDmg * 30 * power(g);
  b.knockback[i] = 8;
  b.life[i] = 1.2;
  b.owner[i] = h.index;
  b.kind[i] = 13;
  b.pierce[i] = 2;
  b.blast[i] = 0;
  b.clearHits(i);
  b.setColor(i, '#7df9ff');
  g.vfx.star(b.x[i], BULLET_Y, b.z[i], 1, '#ffffff', 0.08);
}

/** While the window is open: reflect bullets and stun attackers in reach. `rewind` > 0: judge bullets over the last `rewind` s (remote parry). */
function doParry(g: Game, h: Hero, rewind = 0): void {
  const p = h.player;
  const T = skillTuning;
  const lag = heroParryLag(g, h);
  const reach = p.radius + (lag > 0 ? remoteParry(lag, T.parryReach, T.parryWindow).reach : h.remote ? T.parryReachRemote : T.parryReach);
  const b = g.bullets;
  let n = 0;
  for (let i = 0; i < b.count; i++) {
    if (!hostileBullet(g, h.index, i)) continue;
    const dx = b.x[i] - p.x;
    const dz = b.z[i] - p.z;
    const rr = reach + b.radius[i];
    if (dx * dx + dz * dz > rr * rr && !(rewind > 0 && bulletWasInReach(p.x, p.z, b.x[i], b.z[i], b.vx[i], b.vz[i], b.radius[i], reach, rewind))) continue;
    reflectBullet(g, h, i);
    n++;
  }
  parrySeen.clear();
  g.hash.query(p.x, p.z, reach + 2, (e) => {
    // Big enemies sit in several hash cells: handle each one once.
    if (parrySeen.has(e) || !e.alive || e.pvpOwner >= 0 || e.contactDamage <= 0) return;
    parrySeen.add(e);
    const dx = e.x - p.x;
    const dz = e.z - p.z;
    const rr = reach + e.radius;
    if (dx * dx + dz * dz > rr * rr) return;
    // Only what's actually coming at you: lunging, charging or touching.
    const touching = dx * dx + dz * dz < (p.radius + e.radius + 0.35) ** 2;
    if (!touching && e.state !== 'attack' && e.state !== 'windup') return;
    const d = Math.hypot(dx, dz) || 1;
    const k = T.parryKnock * (1 - e.def.knockbackResist);
    e.kx += (dx / d) * k;
    e.kz += (dz / d) * k;
    e.squash(-8);
    if (!bossLike(e) && e.def.behavior !== 'reaper') {
      e.frozen = Math.max(e.frozen, T.parryStun);
      e.state = 'move';
    }
    e.flash = 0.12;
    g.vfx.num(e.x, 2 * e.scale, e.z, 'STUN', 'crit');
    n++;
  });
  if (n > 0) parried(g, h, n);
}

function parried(g: Game, h: Hero, n: number): void {
  const sk = h.skill;
  const p = h.player;
  const T = skillTuning;
  const first = sk.parried === 0;
  sk.parried += n;
  p.invuln = Math.max(p.invuln, T.parryIframes);
  sk.parryCd = Math.min(sk.parryCd, 0.12); // a clean parry gives the button straight back
  sk.buffT = T.buffTime;
  chargeUlt(g, h, ultTuning.parryGain * Math.min(4, n));
  sk.style.add(first ? styleTuning.parry + styleTuning.parryExtra * (n - 1) : styleTuning.parryExtra * n, first ? (n > 1 ? `PARRY x${n}` : 'PARRY!') : undefined);
  if (!first) return;
  g.mods2Event(h, 'parry');
  g.onParryLanded(h);
  if (!g.online && h === g.hero) g.juice.freeze(T.parryFreeze);
  else if (h === g.hero) onlineStop(g, T.parryFreeze); // host's own parry; clients get theirs from the `pa` event
  g.vfx.ring(p.x, p.z, 0.8, 4.5, '#73eff7', 0.25);
  g.vfx.star(p.x, 1.2, p.z, 2.6, '#ffffff', 0.14);
  g.vfx.burst(p.x, 1.1, p.z, { count: 18, color: '#73eff7', color2: '#ffffff', speed: [4, 10], size: [0.12, 0.24], life: [0.15, 0.35], up: 2, gravity: 6 });
  g.vfx.num(p.x, 2.8, p.z, 'PARRY!', 'crit');
  g.vfx.shake(p.x, p.z, 0.25);
  emit(g, 'pa', h);
}

// ---------------------------------------------------------------- ultimate

export function tryUlt(this: Game, h: Hero): void {
  const sk = h.skill;
  if (sk.ult < 1 || sk.ultT > 0 || h.player.dead || !this.isCombatMode || this.pvp?.phase === 'duel' || this.modesHolster(h)) return;
  sk.ult = 0;
  sk.style.add(styleTuning.ult, ultOf(h).name);
  this.mods2Event(h, 'ultimate');
  startUlt(this, h);
  // Mega Barrage opens with a beat of real bullet time (solo, setting on).
  if (ultOf(h).id === 'barrage' && !this.online && settings.slowMo !== false) this.slowMoT = Math.max(this.slowMoT, 0.5);
  emit(this, 'ul', h);
}

function chargeUlt(g: Game, h: Hero, v: number): void {
  const sk = h.skill;
  if (sk.ultT > 0 || g.pvp?.phase === 'duel') return;
  const was = sk.ult;
  sk.ult = Math.min(1, sk.ult + v);
  if (was < 1 && sk.ult >= 1) {
    g.vfx.num(h.player.x, 3, h.player.z, 'ULTIMATE READY', 'score');
    g.vfx.ring(h.player.x, h.player.z, 0.6, 3, ultOf(h).color, 0.35);
  }
}

// ---------------------------------------------------------------- per step (host)

export function updateSkill(this: Game, dt: number): void {
  const fighting = this.mode === 'fight';
  const w = world(this);
  for (const h of this.heroes) {
    if (h.left) continue;
    const sk = h.skill;
    const p = h.player;
    sk.buffT = Math.max(0, sk.buffT - dt);
    sk.parryCd = Math.max(0, sk.parryCd - dt);
    sk.style.tick(dt, fighting && !p.dead);
    if (p.dead) {
      sk.parryT = sk.dashScanT = 0;
      if (sk.ultT > 0) endUlt(this, h);
      continue;
    }
    if (sk.dashScanT > 0) {
      sk.dashScanT -= dt;
      if (!sk.dashPerfect && threatened(this, h, false)) this.perfectDash(h);
    }
    if (sk.parryT > 0) {
      sk.parryT -= dt;
      doParry(this, h);
    }
    if (sk.ultT > 0) updateUlt(this, h, dt);
    // Announce new ranks of A and up.
    const r = sk.style.rank;
    const last = w.ranks[h.index] ?? 0;
    if (r > last && r >= 3) emit(this, 'rk', h, r);
    w.ranks[h.index] = r;
  }
}

/** Per step after the heroes' weapons ran: kick and recoil on each new shot. */
export function weaponFeel(this: Game, h: Hero): void {
  const p = h.player;
  for (const wpn of h.weapons) {
    if (!wpn.shotStarted()) continue;
    const f = wpn.feel;
    if (h === this.hero && f.kick > 0) this.juice.kick(-p.aim.x, -p.aim.z, f.kick);
    if (f.recoil > 0) p.recoil = Math.max(p.recoil, f.recoil);
  }
}

/** Muzzle flash size for a hero: the biggest feel of the weapons flashing now. */
export function muzzleScale(this: Game, h: Hero): number {
  let s = 0;
  for (const wpn of h.weapons) if (wpn.muzzleT > 0) s = Math.max(s, wpn.feel.flash);
  return s || 1;
}

// ---------------------------------------------------------------- combat hooks

/** Every damage hit (Game.damage): ultimate charge and weapon crit / hit-stop feel. */
export function skillHit(this: Game, e: Enemy, o: DamageOpts, dealt: number, crit: boolean, by: Hero): void {
  if (o.source !== 'ult' && dealt > 0) chargeUlt(this, by, ultHitGain(dealt, e.maxHp, !!e.def.boss, this.director.targetAlive));
  if (!o.loud) return;
  const f = feelOf(o.source);
  // Hit-stop only freezes a solo world (online it would stop everyone).
  const canStop = by === this.hero && !this.online;
  let stop = 0;
  if (crit) {
    const hx = o.hx ?? e.x;
    const hz = o.hz ?? e.z;
    if (f.critFlash > 1.05) this.vfx.star(hx, BULLET_Y, hz, 1.5 * f.critFlash, '#fff35c', 0.12 + 0.04 * (f.critFlash - 1));
    this.vfx.sound('hit', e.x, e.z, f.critPitch);
    stop = f.critStop;
  } else stop = f.hitStop;
  if (canStop && stop > 0) {
    const w = world(this);
    if (this.stepN >= w.stopStep) {
      this.juice.freeze(stop);
      w.stopStep = this.stepN + 10;
    }
  } else if (this.online && stop > 0 && !by.left) {
    // Online: hold the picture on the hitter's own screen only (render-side, src/game/netFeel.ts).
    const w = world(this);
    if (this.stepN >= (w.heroStop[by.index] ?? 0)) {
      w.heroStop[by.index] = this.stepN + 10;
      if (by === this.hero) onlineStop(this, stop);
      else if (by.remote) emit(this, 'hs', by, Math.round(stop * 1000) / 1000);
    }
  }
}

/**
 * A hit-stop for hero `by`'s big hit (heroes3 lane: the Ronin's cleave, cut and
 * counter-slash): freezes a solo world, online only the hitter's own picture
 * (like weapon feel above), with the same 10-step spacing.
 */
export function heroHitStop(g: Game, by: Hero, seconds: number): void {
  if (seconds <= 0 || by.left) return;
  const w = world(g);
  if (!g.online) {
    if (by === g.hero && g.stepN >= w.stopStep) {
      g.juice.freeze(seconds);
      w.stopStep = g.stepN + 10;
    }
  } else if (g.stepN >= (w.heroStop[by.index] ?? 0)) {
    w.heroStop[by.index] = g.stepN + 10;
    if (by === g.hero) onlineStop(g, seconds);
    else if (by.remote) emit(g, 'hs', by, Math.round(seconds * 1000) / 1000);
  }
}

/** Every kill (Game.killEnemy): style and ultimate charge for the killer. */
export function skillKill(this: Game, e: Enemy, source: string, by: Hero | null): void {
  if (!by) return;
  if (source !== 'ult') chargeUlt(this, by, ultKillGain(e.elite, !!e.def.boss, this.director.targetAlive));
  by.skill.style.kill({ source, elite: e.elite, boss: !!e.def.boss, beat: isClick(source) && onBeat(world(this)) });
}

/** A hero got hit: the style meter drops. */
export function skillHurt(this: Game, h: Hero): void {
  const before = h.skill.style.hit();
  if (before >= 3 && h.skill.style.rank < before) this.vfx.num(h.player.x, 3.2, h.player.z, `STYLE ${rankName(before)} > ${rankName(h.skill.style.rank)}`, 'player');
}

/** Score multiplier for kills by hero `by` (its style rank). */
export function styleScoreMul(this: Game, by: Hero | null): number {
  return by ? by.skill.style.scoreMul : 1;
}

/** XP multiplier for gems from kills by hero `by`. */
export function styleXpMul(this: Game, by: Hero | null): number {
  return by ? by.skill.style.xpMul : 1;
}

// ---------------------------------------------------------------- events and network

function emit(g: Game, kind: SkillEvent[1], h: Hero, extra = 0): void {
  const w = world(g);
  const ev: SkillEvent = [++w.seq, kind, h.index, r2(h.player.x), r2(h.player.z), extra];
  if (g.role === 'host') {
    const t = now();
    w.events.push({ ev, at: t });
    while (w.events.length && t - w.events[0].at > 1.5) w.events.shift();
  }
  playEvent(g, ev);
}

/** Every machine: sounds for a skill event, plus local feedback when it's this machine's hero. */
function playEvent(g: Game, ev: SkillEvent): void {
  const [, kind, i, x, z, extra] = ev;
  const h = g.heroes[i];
  if (!h) return;
  const mine = i === g.local;
  const me = g.hero.player;
  const d = Math.hypot(x - me.x, z - me.z);
  const gain = mine ? 1 : Math.max(0, 1 - d / 30) * 0.7;
  const p = h.player;
  if (kind === 'pd') {
    p.skillGlow = Math.max(p.skillGlow, 0.6);
    skillSound('perfect', mine, gain);
    if (mine) {
      p.refundDash();
      g.hud.flash(0.12);
      g.juice.shake(0.12);
      g.input.rumble(0.3, 0.6, 120);
    }
  } else if (kind === 'pa') {
    p.skillGlow = Math.max(p.skillGlow, 0.5);
    // A client that predicted this parry already played its feedback.
    const predicted = mine && g.role === 'client' && parryPredicted(g);
    if (!predicted) skillSound('parry', mine, gain);
    if (mine) {
      g.hero.skill.parryCd = 0;
      markParryPredicted(g, false);
      if (!predicted) {
        g.hud.flash(0.22);
        g.juice.shake(0.2);
        g.input.rumble(0.7, 0.5, 140);
        if (g.role === 'client') onlineStop(g, skillTuning.parryFreeze);
      }
    }
  } else if (kind === 'hs') {
    if (mine && g.role === 'client') onlineStop(g, extra);
  } else if (kind === 'ul') {
    if (mine) music.silence(0.4);
    const def = ultOf(h);
    p.skillGlow = Math.max(p.skillGlow, def.duration);
    skillSound('ult', mine, gain);
    if (mine) {
      g.hud.showBanner(def.name, 'ULTIMATE!', 1.3);
      g.hud.flash(0.4);
      if (def.id === 'blitz') p.refundDash(true);
    }
  } else if (kind === 'rk' && mine) skillSound(extra >= 4 ? 'rankS' : 'rankA', true, 1);
  else if (kind === 'sw' && !mine && !p.dead) parrySwing(g, h);
}

/** Host snapshot part: every hero's skill state, plus the events this client hasn't had. */
export function skillNet(this: Game, forHero: Hero): Record<string, unknown> {
  const w = world(this);
  const ev: SkillEvent[] = [];
  for (const e of w.events) if (e.ev[0] > forHero.skill.sentEv) ev.push(e.ev);
  forHero.skill.sentEv = w.seq;
  const st = forHero.skill.style;
  const notes = st.seq !== forHero.skill.netSeq ? [st.seq, ...st.notes.map((n) => [n.text, n.pts])] : null;
  forHero.skill.netSeq = st.seq;
  return {
    h: this.heroes.map((h) => {
      const sk = h.skill;
      const dur = ultOf(h).duration;
      return [Math.round(sk.style.points), sk.style.best, r2(sk.ult), r2(sk.ultT / dur), sk.buffT > 0 ? 1 : 0];
    }),
    n: notes,
    e: ev,
  };
}

/** Client: mirror skill state and play the new events. */
export function applySkillNet(this: Game, data: unknown): void {
  const s = data as { h?: number[][]; n?: [number, ...[string, number][]] | null; e?: SkillEvent[] } | undefined;
  if (!s) return;
  s.h?.forEach((a, i) => {
    const h = this.heroes[i];
    if (!h) return;
    const sk = h.skill;
    const def = ultOf(h);
    sk.style.points = a[0];
    sk.style.best = a[1];
    sk.ult = a[2];
    sk.ultT = a[3] * def.duration;
    sk.buffT = a[4] ? 1 : 0;
    if (h === this.hero) h.player.ultSpeed = sk.ultT > 0 && def.id === 'blitz' ? ultTuning.blitzSpeed : 1;
  });
  if (s.n) {
    const [seq, ...notes] = s.n;
    const st = this.hero.skill.style;
    st.notes.length = 0;
    for (const [text, pts] of notes) st.notes.push({ text, pts } as StyleNote);
    st.seq = seq;
  }
  for (const ev of s.e ?? []) playEvent(this, ev);
}

// ---------------------------------------------------------------- render (every machine)

export function renderSkill(this: Game, frameDt: number, frozen: boolean): void {
  const w = world(this);
  if (!w.hud) {
    const root = document.getElementById('ingame')?.parentElement;
    if (!root) return;
    w.hud = new SkillHud(root);
  }
  // Load the recorded cues once audio is unlocked and a run is on.
  if (!w.preloaded && this.mode !== 'title' && sfx.output('sfx')) {
    w.preloaded = true;
    preloadSkillAudio();
  }
  // Beat clock from the music (local on every machine).
  if (music.beats !== w.beats) {
    const t = now();
    if (w.beats >= 0) {
      const per = t - w.beatAt;
      if (per > 0.2 && per < 1.2) w.beatPeriod = per;
    }
    w.beats = music.beats;
    w.beatAt = t;
  }
  const h = this.hero;
  // Buffed and ultimate-running heroes shimmer on every machine.
  for (const o of this.heroes) if (!o.left && (o.skill.buffT > 0 || o.skill.ultT > 0)) o.player.skillGlow = Math.max(o.player.skillGlow, 0.1);
  // Clients don't simulate weapons: kick the camera when our own shots arrive.
  if (this.role === 'client' && !frozen) this.weaponFeel(h);
  const st = h.skill.style;
  const def = ultOf(h);
  w.hud.update(
    {
      points: st.points,
      rank: st.rank,
      notes: st.notes,
      seq: st.seq,
      ult01: h.skill.ult,
      ultActive: h.skill.ultT > 0 ? h.skill.ultT / def.duration : 0,
      ultName: def.name,
      visible: this.mode !== 'title',
    },
    frozen ? 0 : frameDt,
  );
}

/** Best style rank this run, for the game-over summary. */
export function bestStyle(this: Game, h: Hero): string {
  return rankName(h.skill.style.best);
}
