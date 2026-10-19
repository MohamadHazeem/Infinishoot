import { recordHeatClear } from './meta';
/**
 * Run spice: curses, relics, stage events, side challenges, pets, co-op pings and spectating.
 * Split out of src/game/game.ts: these are Game methods (`this` is the Game),
 * installed on the class as fields, e.g. `curseSum = Spice.curseSum;`.
 */
import { promptText } from '../../ui/prompts';
import type { Game } from '../game';
import { LOOP_STAGES, scoreTuning, dropTuning, xpForLevel } from '../game';
import { ENEMIES } from '../../data/enemies';
import { MOD_BY_ID } from '../../data/mods';
import { PASSIVES } from '../../data/passives';
import { WEAPONS } from '../../data/weapons';
import { Screens, type ShopFx } from '../../ui/screens';
import { Hero, MAX_GEARS, economyTuning } from '../hero';
import { PickupType } from '../pickups';
import { type EventHost } from '../runEvents';
import { CURSE_BY_ID, type CurseDef } from '../../data/curses';
import { rollRelic } from '../../data/relics';
import { STAGE_EVENTS, type EventId } from '../../data/stageEvents';

/** Sum of one curse field over the curses in effect. */
export function curseSum(this: Game, k: 'enemyHp' | 'enemySpeed' | 'enemyCount' | 'enemyDmg' | 'dmgTaken' | 'dashCd' | 'score'): number {
  let n = 0;
  for (const id of this.curses) n += (CURSE_BY_ID[id]?.[k as keyof CurseDef] as number | undefined) ?? 0;
  return n + this.routeMod(k); // the route node this stage came through (systems/route.ts)
}

/** Pause screen: evolution recipes for owned weapons and the live damage chart. */
export function pauseInfo(this: Game): Parameters<Screens['setPauseBuild']>[3] {
  const h = this.hero;
  const recipes = h.weapons
    .filter((w) => w.def.evolution)
    .map((w) => ({
      weapon: w.def.name,
      evo: w.def.evolution!.name,
      passive: PASSIVES[w.def.evolution!.passive]?.name ?? '?',
      have: (h.passives[w.def.evolution!.passive] ?? 0) > 0 && w.maxed,
      done: w.evolved,
    }));
  const damage = Object.entries(h.damageBy)
    .sort((a, b) => b[1] - a[1])
    .map(([id, dmg]) => ({ name: h.weapons.find((w) => w.def.id === id)?.name ?? this.sourceName(id), color: WEAPONS[id]?.color ?? MOD_BY_ID[id]?.color ?? '#ff3df0', dmg }));
  return { recipes, damage };
}

/** A hero takes the curse deal from their shop: gold now, harder run for everyone. */
export function takeCurse(this: Game, h: Hero): string {
  const id = h.curseOffer;
  const c = id ? CURSE_BY_ID[id] : null;
  if (!c || this.curses.includes(c.id)) return 'NO CURSE ON OFFER';
  this.curses.push(c.id);
  h.curseOffer = null;
  h.gold += c.gold;
  this.director.countMul = (1 + this.curseSum('enemyCount')) * this.difficulty.enemyCount * (this.meta.has('crowds') ? 1.25 : 1);
  for (const x of this.heroes) x.recomputeStats();
  this.vfx.sound('ominous', NaN, NaN);
  this.vfx.toast(`${h.name.toUpperCase()} TOOK A CURSE: ${c.name.toUpperCase()}`, 3);
  // Everyone's shop drops the same curse if they were offered it.
  for (const x of this.heroes) if (x !== h && x.curseOffer === c.id && !x.shopDone) this.presentShop(x);
  return '';
}

/** Bosses drop one relic per hero (a random one they don't have). */
export function grantRelics(this: Game): void {
  for (const h of this.heroes) {
    if (h.left) continue;
    const r = rollRelic(h.relics, h.stats.luck, () => this.rng.next());
    if (!r) continue;
    h.relics.push(r.id);
    h.recomputeStats();
    h.loadoutDirty = true;
    const msg = `RELIC: ${r.name.toUpperCase()} - ${r.desc}`;
    if (h === this.hero) this.hud.toast(msg, 4);
    else this.tell(h, { t: 'toast', msg });
  }
}

export function makeEventHost(this: Game): EventHost {
  const game = this;
  return {
    get rng() {
      return game.rng;
    },
    get stage() {
      return game.stage;
    },
    get dmgMul() {
      return game.director.dmgMul;
    },
    targets: () => this.aliveHeroes.map((h) => h.player),
    ownedWeapons: () => [...new Set(this.heroes.flatMap((h) => h.weapons.map((w) => w.def.id)))],
    meteor: (x, z, r, delay, dmg) => {
      this.strikes.push({ x, z, r, t: delay, dmg, foe: 40 * this.director.hpMul, cause: 'Meteor' });
      this.vfx.zone(x, z, r, delay);
    },
    spawnElite: () => {
      const pool = Object.values(ENEMIES).filter((d) => d.minMinute >= 0 && d.minMinute <= 2 + this.stage && (d.minStage ?? 1) <= this.stage && d.behavior !== 'spawner' && d.id !== 'swarmer');
      if (pool.length) this.spawnEnemy(this.rng.pick(pool), true);
    },
    spawnRing: () => this.spawnRing(ENEMIES.swarmer, 20 + this.stage * 8),
    vacuum: () => (this.pickups.vacuum = true),
    banner: (t, sub, sec) => this.vfx.banner(t, sub, sec),
    toast: (msg, sec) => this.vfx.toast(msg, sec),
    sound: (name) => this.vfx.sound(name, NaN, NaN),
    reward: (goldEach, score) => {
      for (const h of this.heroes) if (!h.left) h.gold += goldEach;
      this.score += score;
    },
  };
}

/** HUD lines under the timer: event, challenge, power-ups. */
export function spiceLines(this: Game): { text: string; kind: 'event' | 'challenge' | 'done' | 'buff' }[] {
  if (!this.isCombatMode) return [];
  const client = this.role === 'client';
  const out: { text: string; kind: 'event' | 'challenge' | 'done' | 'buff' }[] = [];
  const ev = client ? this.netEvent : this.runEvents.event ? [this.runEvents.event.id, this.runEvents.event.t] : null;
  if (ev && STAGE_EVENTS[ev[0] as EventId]) out.push({ text: `${STAGE_EVENTS[ev[0] as EventId].name.replace('!', '')} ${Math.ceil(Number(ev[1]))}`, kind: 'event' });
  const c = this.runEvents.challenge;
  const ch = client ? this.netChallenge : c ? ([c.text, c.cur, c.max, c.done] as [string, number, number, boolean]) : null;
  if (ch) out.push({ text: ch[3] ? `✓ ${ch[0]}` : `★ ${ch[0]} ${ch[1]}/${ch[2]}`, kind: ch[3] ? 'done' : 'challenge' });
  if (this.hero.player.dead && this.heroes.length > 1) {
    const t = this.spectateTarget();
    const who = this.heroes.find((x) => x.player === t);
    if (who) out.push({ text: `WATCHING ${who.name.toUpperCase()} · ${promptText('switch')} TO SWITCH`, kind: 'challenge' });
  }
  const [fz, od] = client ? this.netBuffs : [this.runEvents.frenzyT, this.runEvents.overdriveT];
  if (fz > 0) out.push({ text: `FRENZY ${Math.ceil(fz)}`, kind: 'buff' });
  if (od > 0) out.push({ text: `OVERDRIVE ${Math.ceil(od)}`, kind: 'buff' });
  return out;
}

export function goldFx(this: Game, h: Hero, n: number): void {
  this.vfx.num(h.player.x, 2.6, h.player.z, `+${n}●`, 'score');
  this.vfx.sound('coin', h.player.x, h.player.z);
}

export function stageClear(this: Game): void {
  this.mode = 'cleared';
  this.modeT = 0;
  this.bossesRun++;
  this.gpFinale(); // chain-reaction fireworks over the leftover horde and recent kills (systems/gameplay.ts)
  for (const e of this.enemies.list) {
    if (!e.active) continue;
    this.pickups.spawn(PickupType.Gem, e.x, e.z, e.def.xp * dropTuning.xpMul);
    this.vfx.burst(e.x, 0.6, e.z, { count: 2, color: e.def.bodyColor, speed: [2, 5], size: [0.15, 0.3], life: [0.3, 0.5], up: 4, gravity: 12 });
    this.enemies.kill(e);
  }
  this.bullets.clear();
  // Leftover chests vanish with the stage (clients mirror via 'chestsgone').
  for (const c of this.chests.list) this.vfx.burst(c.x, 0.4, c.z, { count: 10, color: '#ffd23f', color2: '#b8653a', speed: [2, 6], size: [0.15, 0.3], life: [0.3, 0.6], up: 5, gravity: 12 });
  this.chests.list = [];
  if (this.role === 'host') this.host!.broadcast({ t: 'chestsgone' });
  this.pickups.vacuum = true;
  const noHit = this.damagedThisStage ? 0 : scoreTuning.noHitBonus * this.stage;
  this.score += noHit;
  for (const h of this.heroes) {
    if (h.left) continue;
    // Gold: flat reward plus interest on what you're holding (capped).
    h.gold += economyTuning.clearGold + h.interest;
    h.synergy.stageClear();
    if (h.player.dead) this.reviveHero(h, 0.3, false);
    h.player.heal(h.player.maxHp * 0.3);
  }
  this.companionStageClear(); // pets level up
  let sub = `+${economyTuning.clearGold} GOLD + INTEREST`;
  if (noHit) sub += `<br>NO-HIT BONUS +${noHit.toLocaleString('en-US')}`;
  if (this.stage % LOOP_STAGES === 0) {
    // The final boss fell: that's the ending. The run carries on as a harder loop.
    const loop = this.stage / LOOP_STAGES;
    const bonus = scoreTuning.victoryBonus * loop;
    this.score += bonus;
    this.victories++;
    recordHeatClear(this);
    this.vfx.banner(loop === 1 ? 'VICTORY!' : `LOOP ${loop} CLEARED!`, `THE FINAL BOSS FALLS · +${bonus.toLocaleString('en-US')}<br>LOOP ${loop + 1} AWAITS: EVERYTHING HITS HARDER`, 4.5);
    this.vfx.sound('legendaryPick', NaN, NaN);
    this.vfx.flash(1);
    for (const h of this.heroes) if (!h.left) this.legendaryBurst(h);
  } else {
    this.vfx.banner('STAGE CLEAR!', sub, 2.4);
    this.vfx.sound('stageClear', NaN, NaN);
    this.vfx.flash(0.5);
  }
  this.checkAchievements();
}

export function openShop(this: Game): void {
  this.mode = 'shop';
  // Now and then (from stage 2) the secret merchant turns up instead.
  this.secretShop = (this.stage >= 2 && this.rng.chance(0.22)) || this.routeSecretShop();
  if (this.secretShop) this.vfx.banner('SECRET SHOP!', 'A STRANGE MERCHANT APPEARS', 1.8);
  for (const h of this.heroes) {
    if (h.left) continue;
    h.openShop(this.secretShop, this.preShop);
    this.presentShop(h);
    this.shopFx(h, 'open');
  }
}

/** Shop sound and particles on the screen of the player who acted. */
export function shopFx(this: Game, h: Hero, kind: ShopFx, i = 0): void {
  if (h === this.hero) this.screens.shopFx(kind, i);
  else this.tell(h, { t: 'shopfx', kind, i });
}

export function closeShop(this: Game): void {
  if (['shop', 'wait'].includes(this.screens.current)) this.screens.show('none');
  for (const h of this.heroes) this.tell(h, { t: 'go' });
  if (this.preShop) {
    // Leftover starting gold isn't kept; the stage starts now.
    this.preShop = false;
    for (const h of this.heroes) h.gold = 0;
    this.mode = 'fight';
    this.modeT = 0;
    this.vfx.banner(`STAGE ${this.stage}`, this.stageSub(this.stage), 2.2);
    return;
  }
  if (this.pvp?.phase === 'stage') this.pvpStageDone();
  else if (this.runMode === 'endless') this.endlessNextWave();
  else if (!this.openRoute()) this.openPortal();
}

/** Endless: no portal; the next, harder wave starts right here. */
export function endlessNextWave(this: Game): void {
  this.stage++;
  this.director.start(this.stage);
  this.director.countMul = (1 + this.curseSum('enemyCount')) * this.difficulty.enemyCount * (this.meta.has('crowds') ? 1.25 : 1);
  this.runEvents.startStage(this.director.duration);
  for (const h of this.heroes) {
    h.phoenixUsed = false;
    if (h.hasRelic('r_clover')) h.rerollsLeft = Math.min(MAX_GEARS, h.rerollsLeft + 1);
  }
  this.pickups.vacuum = false;
  this.damagedThisStage = false;
  this.mode = 'fight';
  this.modeT = 0;
  this.vfx.banner(`WAVE ${this.stage}`, 'IT NEVER ENDS', 2);
  this.vfx.sound('wave', NaN, NaN);
  this.checkAchievements();
}

/** Boss Rush: skip straight to the boss and hand out bonus levels to fight it with. */
export function bossRushStage(this: Game): void {
  this.director.time = this.director.duration - 2.5;
  const levels = this.stage === 1 ? 5 : 3;
  let xp = 0;
  for (let l = 0; l < levels; l++) xp += xpForLevel(this.level + l);
  this.gainXp(xp - this.xp);
}

export function openPortal(this: Game): void {
  const p = (this.aliveHeroes[0] ?? this.hero).player;
  const spot = this.portalSpot(p.x, p.z);
  this.portal.open(spot.x, spot.z);
  this.vfx.ring(this.portal.x, this.portal.z, 1, 6, '#ff3df0', 0.5);
  this.vfx.banner('ENTER THE PORTAL', `STAGE ${this.stage + 1} AWAITS`, 1.6);
  this.mode = 'portal';
  this.modeT = 0;
}

/**
 * A portal spot about 6 m from (px, pz) that is clear of walls and reachable in a straight line,
 * trying nearer and farther rings when the 6 m one is blocked; worst case right where the player stands.
 */
export function portalSpot(this: Game, px: number, pz: number): { x: number; z: number } {
  const lim = this.arena.halfSize - 4;
  for (const dist of [6, 4, 8, 2.5]) {
    for (let i = 0; i < 16; i++) {
      const dx = Math.cos((i / 16) * Math.PI * 2);
      const dz = Math.sin((i / 16) * Math.PI * 2);
      const x = px + dx * dist;
      const z = pz + dz * dist;
      if (Math.abs(x) > lim || Math.abs(z) > lim || this.walls.hitCircle(x, z, 1.8)) continue;
      let clear = true;
      for (let d = 0.5; d < dist && clear; d += 0.5) clear = !this.walls.hitCircle(px + dx * d, pz + dz * d, 0.4);
      if (clear) return { x, z };
    }
  }
  return { x: px, z: pz };
}
