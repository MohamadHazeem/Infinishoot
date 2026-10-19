/**
 * Companion lane: growing pets and co-op team moves.
 * Game methods (`this` is the Game), installed on the class as fields, e.g.
 * `updatePets = CompanionSys.updatePets;`.
 *
 * Pets (src/data/pets.ts, state in Hero.petState): level up on every stage
 * clear and learn a skill per level: Fetch (pulls gems and coins), Zap,
 * Taunt (flies out as a decoy that nearby enemies chase), Shield (blocks one
 * big hit per stage) and Revive (once per run). Team moves
 * (src/game/teamMoves.ts): a shared TEAM meter that charges while heroes
 * stand together in combat, spent on a rotating team move. High-five
 * revives heal rescuer and rescued. Everything gameplay runs on the host;
 * clients get pet records and the meter/move in the snapshot's `cp` field
 * and draw beams, zaps and the HUD locally.
 */
import type { Game } from '../game';
import type { Hero } from '../hero';
import { PET_BY_ID, PET_SKILL_INFO, petTuning, rankOf } from '../../data/pets';
import { PickupType } from '../pickups';
import { TeamMeter, TeamMoveView, TEAM_MOVES, teamTuning, teamScale, linkedCount, segDist2, moveTime, type ActiveMove, type TeamMoveId } from '../teamMoves';
import { CompanionHud, type PetHudState, type TeamHudState } from '../../ui/companionHud';
import { binds, keyLabel, PAD_TEAM } from '../../core/keybinds';
import { settings } from '../settings';
import { sfx } from '../../audio/sfx';
import type { Enemy } from '../enemies';

/** Extra tuning for the high-five revive. */
export const highFiveTuning = {
  /** Life restored to rescuer(s) and rescued, as a fraction of max life. */
  heal: 0.25,
};

interface Rock {
  x: number;
  z: number;
  t: number;
}

/** Per-Game companion state (kept off the Game class so the lane stays self-contained). */
export interface CompanionState {
  meter: TeamMeter;
  move: ActiveMove | null;
  /** Beam: tick timer; nova: waves done; meteor: meteors dropped. */
  acc: number;
  done: number;
  rocks: Rock[];
  lastRunTime: number;
  /** The charging chime plays once per link. */
  chimed: boolean;
  /** Stage clears whose pet growth hasn't played yet. */
  growPending: number;
  // Presentation (every machine)
  view: TeamMoveView | null;
  hud: CompanionHud;
  seen: Map<Hero, [number, number]>;
  fxT: number;
  /** Client: local clock of the mirrored move between snapshots. */
  moveT: number;
  // Scratch (no per-step allocation)
  xs: Float64Array;
  zs: Float64Array;
  decoys: { x: number; z: number; radius: number; alive: boolean }[];
}

const states = new WeakMap<Game, CompanionState>();

/** This game's companion state (created on first use). */
export function companionState(this: Game): CompanionState {
  let s = states.get(this);
  if (!s) {
    s = {
      meter: new TeamMeter(),
      move: null,
      acc: 0,
      done: 0,
      rocks: [],
      lastRunTime: 0,
      chimed: false,
      growPending: 0,
      view: null,
      hud: new CompanionHud(),
      seen: new Map(),
      fxT: 0,
      moveT: 0,
      xs: new Float64Array(8),
      zs: new Float64Array(8),
      decoys: Array.from({ length: 8 }, () => ({ x: 0, z: 0, radius: 0.4, alive: true })),
    };
    states.set(this, s);
  }
  return s;
}

/** Team moves are on: online co-op with 2+ players still in, not PvP. */
function teamOn(g: Game): boolean {
  return !g.pvp && g.heroes.filter((h) => !h.left).length > 1;
}

const NAME = (h: Hero) => h.petState.def.name.toUpperCase();
const ZAP_COLOR = '#fff35c';

// ------------------------------------------------------------------ pets (host)

/** Pet skills: fetch, zap and taunt timers (host, fight mode). */
export function updatePets(this: Game, dt: number): void {
  for (const h of this.heroes) {
    const st = h.petState;
    if (!st.has || h.left || h.player.dead) continue;
    const p = h.player;
    const r = st.ranks;
    // Fetch: grab gems and coins in range and send them flying to you.
    if (r.fetch > 0 && (st.fetchT -= dt) <= 0) {
      st.fetchT = rankOf(petTuning.fetchEvery, r.fetch);
      const range2 = rankOf(petTuning.fetchRange, r.fetch) ** 2;
      let left = rankOf(petTuning.fetchCount, r.fetch);
      const pk = this.pickups;
      for (let i = 0; i < pk.count && left > 0; i++) {
        const t = pk.type[i];
        if ((t !== PickupType.Gem && t !== PickupType.Bolt) || pk.pulled[i] || pk.age[i] < 0.25) continue;
        const dx = p.x - pk.x[i];
        const dz = p.z - pk.z[i];
        if (dx * dx + dz * dz > range2) continue;
        pk.pulled[i] = 1;
        pk.pullT[i] = 0;
        const d = Math.hypot(dx, dz) || 1;
        pk.vx[i] = (dx / d) * 4;
        pk.vz[i] = (dz / d) * 4;
        left--;
      }
      if (left < rankOf(petTuning.fetchCount, r.fetch)) st.fetches++;
    }
    // Zap: the nearest enemy, chaining on with higher ranks.
    if (r.zap > 0 && (st.zapT -= dt) <= 0) {
      st.zapT = rankOf(petTuning.zapEvery, r.zap);
      const dmg = (petTuning.zapDmg + petTuning.zapPerLevel * this.level) * rankOf(petTuning.zapMul, r.zap);
      let from: { x: number; z: number } = p;
      const hit: Enemy[] = [];
      const n = rankOf(petTuning.zapTargets, r.zap);
      for (let k = 0; k < n; k++) {
        const e = this.nearestEnemy(from.x, from.z, k === 0 ? petTuning.zapRange : petTuning.zapRange * 0.6, (o) => hit.includes(o) || o.pvpOwner >= 0);
        if (!e) break;
        hit.push(e);
        if (k === 0) {
          st.zapX = e.x;
          st.zapZ = e.z;
        } else this.vfx.star(e.x, 1, e.z, 1.1, ZAP_COLOR, 0.12);
        this.damage(e, dmg, { source: 'pet', tags: ['shock', 'chain'], canCrit: true, loud: true }, h);
        from = e;
      }
      if (hit.length) st.zaps++;
    }
    // Taunt: fly out toward the crowd and pull its attention for a moment.
    if (r.taunt > 0) {
      if (st.tauntT > 0) {
        st.tauntT -= dt;
        if (st.tauntT <= 0) this.vfx.burst(st.tauntX, 1.5, st.tauntZ, { count: 8, color: st.def.color, color2: '#ffffff', speed: [2, 5], size: [0.12, 0.25], life: [0.2, 0.4], up: 2 });
      } else if ((st.tauntCd -= dt) <= 0) {
        const near = this.enemiesInRadius(p.x, p.z, petTuning.tauntCheck, this.scratch);
        let n = 0;
        let cx = 0;
        let cz = 0;
        for (const e of near) {
          if (e.def.boss || e.pvpOwner >= 0) continue;
          n++;
          cx += e.x;
          cz += e.z;
        }
        if (n < petTuning.tauntMinEnemies) st.tauntCd = 1;
        else {
          cx = cx / n - p.x;
          cz = cz / n - p.z;
          const d = Math.hypot(cx, cz);
          const dx = d > 0.5 ? cx / d : p.aim.x;
          const dz = d > 0.5 ? cz / d : p.aim.z;
          // Just past the crowd's middle, so the crowd is closer to the pet than to you.
          const out = Math.max(petTuning.tauntDist, Math.min(petTuning.tauntCheck + 1, d + 2));
          const lim = this.arena.halfSize - 2;
          st.tauntX = Math.max(-lim, Math.min(lim, p.x + dx * out));
          st.tauntZ = Math.max(-lim, Math.min(lim, p.z + dz * out));
          st.tauntT = rankOf(petTuning.tauntTime, r.taunt);
          st.tauntCd = rankOf(petTuning.tauntEvery, r.taunt);
          this.vfx.ring(st.tauntX, st.tauntZ, 1, 9, '#ef7d57', 0.45);
          this.vfx.num(st.tauntX, 2.6, st.tauntZ, 'HEY! OVER HERE!', 'score');
          this.vfx.sound('jumpPad', st.tauntX, st.tauntZ, 1.3);
        }
      }
    }
  }
}

/** Taunting pets join the chase targets: enemies closer to the decoy than to a hero go for the pet. */
export function companionTargets(this: Game): void {
  const s = this.companionState();
  let k = 0;
  for (const h of this.heroes) {
    const st = h.petState;
    if (st.tauntT <= 0 || h.left || h.player.dead || k >= s.decoys.length) continue;
    const d = s.decoys[k++];
    d.x = st.tauntX;
    d.z = st.tauntZ;
    this.targets.push(d);
  }
}

/**
 * Stage clear: every pet will grow a level. The growth itself waits for a calm
 * moment (the portal walk after the shop, or a few seconds into the next
 * wave in Endless) so the STAGE CLEAR banner and the shop don't hide it.
 */
export function companionStageClear(this: Game): void {
  this.companionState().growPending++;
}

/** A calm moment after a stage clear: no banner, no menu. */
function calm(g: Game): boolean {
  return (g.mode === 'portal' && g.modeT > 0.6) || (g.mode === 'fight' && g.modeT > 2.6);
}

/** Every pet grows a level and learns its next skill; shields come back. */
export function petGrowth(this: Game): void {
  for (const h of this.heroes) {
    const st = h.petState;
    if (!st.has || h.left) continue;
    const learned = st.levelUp();
    st.stageRefresh();
    if (!learned) continue;
    if (learned === 'fetch') h.recomputeStats();
    const p = h.player;
    const info = PET_SKILL_INFO[learned];
    this.vfx.sound('petLevel', p.x, p.z);
    this.vfx.num(p.x, 3.6, p.z, `${NAME(h)} LV ${st.level}: ${info.name}${st.ranks[learned] > 1 ? '+' : ''}!`, 'score');
    this.vfx.ring(p.x, p.z, 1, 5, st.def.color, 0.5);
    this.vfx.burst(p.x, 1.6, p.z, { count: 26, color: st.def.color, color2: '#ffcd75', speed: [3, 8], size: [0.12, 0.28], life: [0.5, 0.9], up: 7, gravity: 10 });
    this.vfx.star(p.x, 1.8, p.z, 2, '#ffffff', 0.2);
    // Tell the owner what the pet just learned.
    const rank = st.ranks[learned];
    const msg = `${NAME(h)} LV ${st.level}: ${info.name}${rank > 1 ? ' ' + 'I'.repeat(rank) : ''} - ${info.desc(rank).toUpperCase()}`;
    if (h === this.hero) this.hud.toast(msg, 3);
    else this.tell(h, { t: 'toast', msg });
  }
}

/** Shield: blocks one big hit per stage. Returns true if the hit was blocked (hurtHero stops). */
export function petShield(this: Game, h: Hero, raw: number, fromX: number, fromZ: number): boolean {
  const st = h.petState;
  const p = h.player;
  if (!st.shieldReady || h.left) return false;
  const dmg = raw - h.stats.armor;
  if (dmg < p.maxHp * petTuning.shieldMinFrac && dmg < p.hp) return false;
  st.shieldReady = false;
  p.invuln = Math.max(p.invuln, petTuning.shieldIframes);
  this.vfx.ring(p.x, p.z, 1, 5, '#41a6f6', 0.4);
  this.vfx.star(p.x, 1.2, p.z, 2.4, '#73eff7', 0.18);
  this.vfx.burst(p.x, 1.2, p.z, { count: 16, color: '#41a6f6', color2: '#f4f4f4', speed: [3, 7], size: [0.12, 0.25], life: [0.3, 0.5], up: 3, gravity: 8 });
  this.vfx.num(p.x, 2.8, p.z, `${NAME(h)} BLOCKED!`, 'heal');
  this.vfx.sound('w:block', p.x, p.z);
  if (st.ranks.shield > 1) {
    // Bulwark: the block knocks everything nearby back.
    const base = petTuning.shieldBlastDmg + petTuning.shieldBlastPerLevel * this.level;
    for (const e of this.enemiesInRadius(p.x, p.z, petTuning.shieldBlastR, this.scratch).slice()) {
      const dx = e.x - p.x;
      const dz = e.z - p.z;
      const d = Math.hypot(dx, dz) || 1;
      this.damage(e, base, { source: 'pet', tags: [], knockback: 12, dirX: dx / d, dirZ: dz / d }, h);
    }
    this.vfx.ring(p.x, p.z, 1, petTuning.shieldBlastR * 2, '#f4f4f4', 0.3);
  }
  void fromX;
  void fromZ;
  return true;
}

/** Revive: once per run the pet gets its hero back up. Returns true if it did (onHeroDown stops). */
export function petRevive(this: Game, h: Hero): boolean {
  const st = h.petState;
  if (!st.reviveReady || h.left) return false;
  st.reviveUsed = true;
  this.reviveHero(h, petTuning.reviveHp, false);
  const p = h.player;
  p.invuln = Math.max(p.invuln, petTuning.reviveIframes);
  p.happyT = 1.5;
  this.vfx.banner(`${NAME(h)} TO THE RESCUE!`, `${h.name} is back on their feet`, 1.8);
  this.vfx.sound('petLevel', p.x, p.z);
  this.vfx.sound('powerUp', p.x, p.z);
  this.vfx.ring(p.x, p.z, 1, 8, '#ffcd75', 0.5);
  this.vfx.burst(p.x, 1.2, p.z, { count: 30, color: '#ffcd75', color2: st.def.color, speed: [3, 9], size: [0.15, 0.3], life: [0.5, 0.9], up: 7, gravity: 10 });
  // A little room to breathe.
  for (const e of this.enemiesInRadius(p.x, p.z, 4, this.scratch)) {
    if (e.def.boss) continue;
    const dx = e.x - p.x;
    const dz = e.z - p.z;
    const d = Math.hypot(dx, dz) || 1;
    e.kx += (dx / d) * 14;
    e.kz += (dz / d) * 14;
  }
  return true;
}

// ------------------------------------------------------------------ high-five (host)

/** A finished co-op revive ends in a high-five: both heal, a little celebration, a bit of TEAM meter. */
export function highFive(this: Game, h: Hero, helpers: Hero[]): void {
  const p = h.player;
  p.heal(p.maxHp * highFiveTuning.heal);
  p.happyT = 1.6;
  for (const o of helpers) {
    o.player.heal(o.player.maxHp * highFiveTuning.heal);
    o.player.happyT = 1.6;
    const mx = (o.player.x + p.x) / 2;
    const mz = (o.player.z + p.z) / 2;
    this.vfx.star(mx, 2.2, mz, 2.6, '#ffcd75', 0.22);
    this.vfx.burst(mx, 2.2, mz, { count: 30, color: '#ffcd75', color2: '#73eff7', speed: [3, 8], size: [0.12, 0.26], life: [0.6, 1.1], up: 8, gravity: 12 });
    this.vfx.burst(mx, 2.2, mz, { count: 14, color: '#b13e53', color2: '#a7f070', speed: [2, 6], size: [0.1, 0.2], life: [0.6, 1.0], up: 9, gravity: 12 });
    this.vfx.star(mx, 2.2, mz, 1.4, '#f4f4f4', 0.3);
    this.vfx.ring(mx, mz, 0.5, 6, '#ffcd75', 0.4);
    this.vfx.num(mx, 4.3, mz, 'HIGH FIVE!', 'score');
    this.vfx.sound('highFive', mx, mz);
  }
  if (helpers.length && teamOn(this)) {
    const s = this.companionState();
    if (s.meter.add(teamTuning.highFiveBonus)) meterFull(this, s);
  }
}

// ------------------------------------------------------------------ team meter and moves (host)

function meterFull(g: Game, s: CompanionState): void {
  g.vfx.sound('teamCharge', NaN, NaN, 1.25);
  g.vfx.toast(`TEAM MOVE READY: ${TEAM_MOVES[s.meter.next].name}!`, 2.2);
}

/** One host step: new-run reset, the meter, local input and the running move. */
export function updateCompanion(this: Game, dt: number): void {
  const s = this.companionState();
  if (this.runTime < s.lastRunTime - 0.5 || this.mode === 'title') {
    s.meter.reset();
    s.move = null;
    s.rocks.length = 0;
    s.chimed = false;
    s.growPending = 0;
  }
  s.lastRunTime = this.runTime;
  if (s.growPending > 0 && calm(this)) {
    s.growPending--;
    this.petGrowth();
  }
  if (!teamOn(this)) {
    s.meter.linked = 0;
    s.move = null;
    return;
  }
  const fight = this.mode === 'fight';
  // Who stands together?
  let n = 0;
  let cx = 0;
  let cz = 0;
  for (const h of this.heroes) {
    if (h.left || h.player.dead || n >= s.xs.length) continue;
    s.xs[n] = h.player.x;
    s.zs[n] = h.player.z;
    cx += h.player.x;
    cz += h.player.z;
    n++;
  }
  const linked = fight ? linkedCount(s.xs, s.zs, n, teamTuning.linkRange) : 0;
  let inCombat = false;
  if (linked >= 2 && s.meter.linkT >= teamTuning.linkTime - dt && n > 0) {
    inCombat = this.enemiesInRadius(cx / n, cz / n, teamTuning.combatRange, this.scratch).length >= teamTuning.combatEnemies;
  }
  const wasCharging = s.chimed;
  if (s.meter.update(dt, linked, inCombat)) meterFull(this, s);
  // A chime when a link starts charging (once per link).
  const charging = linked >= 2 && inCombat && !s.meter.ready;
  if (charging && !wasCharging) this.vfx.sound('teamCharge', NaN, NaN, 0.8);
  if (linked < 2) s.chimed = false;
  else if (charging) s.chimed = true;
  // Local hero's button (the host's own player).
  if (this.screens.current === 'none' && !this.paused && (this.input.actionPressed('team') || PAD_TEAM.some((b) => this.input.padButtonPressed(b)))) {
    if (!this.tryTeamMove(this.hero) && !s.meter.ready) sfx.deny();
  }
  if (s.move) {
    if (fight) runMove(this, s, dt);
    else {
      s.move = null;
      s.rocks.length = 0;
    }
  }
}

/** Client: the team button goes to the host. */
export function companionClientInput(this: Game, control: boolean): void {
  if (!control) return;
  if (this.input.actionPressed('team') || PAD_TEAM.some((b) => this.input.padButtonPressed(b))) {
    if (this.companionState().meter.ready) this.client?.send({ t: 'team' });
    else sfx.deny();
  }
}

/** Host: hero h fires the team move if the meter is full and a teammate is close. Returns true if it fired. */
export function tryTeamMove(this: Game, h: Hero): boolean {
  const s = this.companionState();
  if (!teamOn(this) || !s.meter.ready || s.move || h.left || h.player.dead || this.mode !== 'fight') return false;
  const p = h.player;
  let mask = 0;
  let n = 0;
  let cx = 0;
  let cz = 0;
  for (const o of this.heroes) {
    if (o.left || o.player.dead) continue;
    if (Math.hypot(o.player.x - p.x, o.player.z - p.z) > teamTuning.groupRange) continue;
    mask |= 1 << o.index;
    n++;
    cx += o.player.x;
    cz += o.player.z;
  }
  if (n < 2) {
    const msg = 'GET CLOSER TO A TEAMMATE FOR THE TEAM MOVE!';
    if (h === this.hero) this.hud.toast(msg, 2);
    else this.tell(h, { t: 'toast', msg });
    return false;
  }
  const id = s.meter.consume();
  let x = cx / n;
  let z = cz / n;
  if (id === 'beam') {
    // Everyone's beams meet where the hero who fired is aiming.
    const d = p.landDist(4, teamTuning.beamDist);
    x = p.x + p.aim.x * d;
    z = p.z + p.aim.z * d;
  }
  s.move = { id, t: 0, x, z, mask, by: h.index };
  s.acc = 0;
  s.done = 0;
  s.rocks.length = 0;
  const def = TEAM_MOVES.find((m) => m.id === id)!;
  this.vfx.banner(def.name + '!', `${h.name.toUpperCase()} CALLS IT · ${n} HEROES`, 1.4);
  this.vfx.sound('teamCharge', NaN, NaN, 1.5);
  this.vfx.flash(0.35);
  this.vfx.shake(x, z, 0.3);
  for (const o of this.heroes) {
    if (!(mask & (1 << o.index))) continue;
    o.player.happyT = Math.max(o.player.happyT, 1);
    this.vfx.ring(o.player.x, o.player.z, 1, 4, def.color, 0.35);
  }
  if (id === 'beam') this.vfx.sound('w:beam', x, z);
  return true;
}

/** Base damage of a team move made by n heroes. */
export function teamDamage(stage: number, n: number): number {
  const k = Math.max(0, stage - 1);
  return teamTuning.dmg * (1 + teamTuning.dmgPerStage * k + teamTuning.dmgPerStage2 * k * k) * teamScale(n);
}

function heroesIn(g: Game, mask: number, out: Hero[]): Hero[] {
  out.length = 0;
  for (const h of g.heroes) if (mask & (1 << h.index) && !h.left && !h.player.dead) out.push(h);
  return out;
}
const group: Hero[] = [];
const hitList: Enemy[] = [];

function runMove(g: Game, s: CompanionState, dt: number): void {
  const m = s.move!;
  m.t += dt;
  const T = teamTuning;
  const members = heroesIn(g, m.mask, group);
  const n = Math.max(2, members.length);
  const by = g.heroes[m.by] ?? g.hero;
  const base = teamDamage(g.stage, n);
  if (m.id === 'beam') {
    s.acc -= dt;
    if (s.acc <= 0 && m.t < T.beamTime - 0.15) {
      s.acc += T.beamTick;
      for (const h of members) {
        const ax = h.player.x;
        const az = h.player.z;
        const mx = (ax + m.x) / 2;
        const mz = (az + m.z) / 2;
        const half = Math.hypot(m.x - ax, m.z - az) / 2;
        hitList.length = 0;
        for (const e of g.enemiesInRadius(mx, mz, half + T.beamWidth, g.scratch)) hitList.push(e);
        for (const e of hitList) {
          const w = T.beamWidth + e.radius;
          if (segDist2(e.x, e.z, ax, az, m.x, m.z) > w * w) continue;
          g.damage(e, base * T.beamTickMul, { source: 'team', tags: ['shock'], canCrit: true, noStatus: e.def.boss }, h);
        }
      }
    }
    if (s.done === 0 && m.t >= T.beamTime - 0.15) {
      s.done = 1;
      const r = T.beamBlastR * Math.sqrt(teamScale(n));
      g.blast(m.x, m.z, r, base * T.beamBlastMul, '#73eff7', 'team', ['explosive', 'shock'], false, by);
      g.vfx.ring(m.x, m.z, 1, r * 2.6, '#f4f4f4', 0.4);
      g.vfx.sound('bomb', m.x, m.z);
      g.vfx.shake(m.x, m.z, 0.6);
      g.vfx.flash(0.4);
    }
  } else if (m.id === 'nova') {
    const R = T.novaRadius + T.novaPerHero * (n - 2);
    while (s.done < T.novaWaves && m.t >= s.done * T.novaGap) {
      const k = (s.done + 1) / T.novaWaves;
      const r = R * (0.5 + 0.5 * k);
      s.done++;
      g.vfx.ring(m.x, m.z, 1, r * 2, s.done === T.novaWaves ? '#f4f4f4' : '#ffcd75', 0.45);
      g.vfx.burst(m.x, 0.6, m.z, { count: 18, color: '#ffcd75', color2: '#ef7d57', speed: [8, 16], size: [0.15, 0.3], life: [0.3, 0.5], up: 2, drag: 2 });
      g.vfx.sound('bomb', m.x, m.z);
      g.vfx.shake(m.x, m.z, 0.35);
      hitList.length = 0;
      for (const e of g.enemiesInRadius(m.x, m.z, r, g.scratch)) hitList.push(e);
      for (const e of hitList) {
        const dx = e.x - m.x;
        const dz = e.z - m.z;
        const d = Math.hypot(dx, dz) || 1;
        g.damage(e, (base * T.novaMul) / T.novaWaves, { source: 'team', tags: ['area'], knockback: T.novaKnock, dirX: dx / d, dirZ: dz / d, canCrit: true }, by);
      }
    }
  } else {
    // Meteor Call: drops spread over meteorTime, each lands meteorDelay after its marker.
    const total = T.meteorCount + T.meteorPerHero * n;
    while (s.done < total && m.t >= (s.done / total) * T.meteorTime) {
      s.done++;
      let tx: number;
      let tz: number;
      const near = g.enemiesInRadius(m.x, m.z, T.meteorArea, g.scratch);
      if (near.length && s.done % 3 !== 0) {
        const e = near[g.rng.int(0, near.length - 1)];
        tx = e.x + g.rng.range(-0.8, 0.8);
        tz = e.z + g.rng.range(-0.8, 0.8);
      } else {
        const a = g.rng.next() * Math.PI * 2;
        const d = T.meteorArea * Math.sqrt(g.rng.next());
        tx = m.x + Math.cos(a) * d;
        tz = m.z + Math.sin(a) * d;
      }
      s.rocks.push({ x: tx, z: tz, t: 0 });
      g.vfx.ring(tx, tz, T.meteorR * 3, 0.67, '#ef7d57', T.meteorDelay);
    }
    for (let i = s.rocks.length - 1; i >= 0; i--) {
      const r = s.rocks[i];
      r.t += dt;
      if (r.t < T.meteorDelay) {
        if (r.t > T.meteorDelay - 0.35) {
          const y = (12 * (T.meteorDelay - r.t)) / 0.35;
          g.vfx.burst(r.x + y * 0.4, y, r.z - y * 0.25, { count: 2, color: '#ef7d57', color2: '#ffcd75', speed: [0, 0.8], size: [0.3, 0.5], life: [0.12, 0.25], drag: 4 });
        }
        continue;
      }
      g.blast(r.x, r.z, T.meteorR, base * T.meteorMul, '#ef7d57', 'team', ['explosive', 'fire'], false, by);
      g.vfx.shake(r.x, r.z, 0.25);
      g.vfx.burst(r.x, 0.4, r.z, { count: 10, color: '#ef7d57', color2: '#333c57', speed: [4, 9], size: [0.2, 0.4], life: [0.35, 0.6], up: 7, gravity: 16 });
      s.rocks.splice(i, 1);
    }
  }
  if (m.t >= moveTime(m.id) && s.rocks.length === 0) s.move = null;
}

// ------------------------------------------------------------------ network

const MOVE_IDS: TeamMoveId[] = ['beam', 'nova', 'meteor'];

/** Snapshot section: pet records per hero and the TEAM meter / running move. */
export function companionNet(this: Game): Record<string, unknown> {
  const s = this.companionState();
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const m = s.move;
  return {
    p: this.heroes.map((h) => h.petState.net()),
    m: [r2(s.meter.charge), s.meter.linked, r2(s.meter.linkT), s.meter.next],
    a: m ? [MOVE_IDS.indexOf(m.id), r2(m.t), r2(m.x), r2(m.z), m.mask, m.by] : null,
  };
}

/** Client: mirror pet records, the meter and the running move. */
export function applyCompanionNet(this: Game, d: unknown): void {
  if (!d || typeof d !== 'object') return;
  const o = d as { p?: number[][]; m?: number[]; a?: number[] | null };
  const s = this.companionState();
  o.p?.forEach((rec, i) => {
    const h = this.heroes[i];
    if (h && Array.isArray(rec)) h.petState.setNet(rec);
  });
  if (o.m) {
    s.meter.charge = o.m[0];
    s.meter.linked = o.m[1];
    s.meter.linkT = o.m[2];
    s.meter.next = o.m[3] % TEAM_MOVES.length;
  }
  const a = o.a;
  if (a && MOVE_IDS[a[0]]) {
    if (!s.move || s.move.id !== MOVE_IDS[a[0]] || Math.abs(s.moveT - a[1]) > 0.3) s.moveT = a[1];
    s.move = { id: MOVE_IDS[a[0]], t: a[1], x: a[2], z: a[3], mask: a[4], by: a[5] };
  } else s.move = null;
}

// ------------------------------------------------------------------ presentation (every machine)

const petHud: PetHudState = { def: PET_BY_ID.none, level: 1, maxLevel: 1, ranks: { fetch: 0, zap: 0, taunt: 0, shield: 0, revive: 0 }, shieldReady: false, reviveReady: false };
const teamHud: TeamHudState = { charge: 0, linked: 0, link01: 0, next: TEAM_MOVES[0], firing: '', key: 'T' };
const beamSources: { x: number; z: number; color: string }[] = [];
const srcPool = Array.from({ length: 4 }, () => ({ x: 0, z: 0, color: '#ffffff' }));

/** Per frame: HUD, local zap/fetch/taunt cosmetics, team beams and link sparkles. */
export function renderCompanion(this: Game, rdt: number): void {
  const s = this.companionState();
  const local = this.hero;
  const playing = this.mode !== 'title' && !!local;
  const st = local?.petState;
  // HUD (reused objects: no per-frame allocation)
  if (playing && st?.has && !local.left) {
    petHud.def = st.def;
    petHud.level = st.level;
    petHud.maxLevel = st.maxLevel;
    petHud.ranks = st.ranks;
    petHud.shieldReady = st.shieldReady;
    petHud.reviveReady = st.reviveReady;
    s.hud.setPet(petHud);
  } else s.hud.setPet(null);
  const on = playing && teamOn(this);
  if (on) {
    teamHud.charge = s.meter.charge;
    teamHud.linked = s.meter.linked;
    teamHud.link01 = s.meter.linkT / teamTuning.linkTime;
    teamHud.next = TEAM_MOVES[s.meter.next];
    teamHud.firing = s.move ? (TEAM_MOVES.find((m) => m.id === s.move!.id)?.name ?? '') : '';
    teamHud.key = keyLabel(binds.team[0] || binds.team[1]);
    s.hud.setTeam(teamHud);
  } else s.hud.setTeam(null);
  if (!playing) {
    s.seen.clear();
    s.view?.hide();
    return;
  }
  // Zaps and fetches: every machine plays them from the synced counters.
  const L = this.heroes[this.local]?.player ?? { x: 0, z: 0 };
  for (const h of this.heroes) {
    const ps = h.petState;
    if (!ps.has) continue;
    const seen = s.seen.get(h);
    if (!seen) {
      s.seen.set(h, [ps.zaps, ps.fetches]);
      continue;
    }
    const visible = !h.left && !h.player.dead;
    if (seen[0] !== ps.zaps) {
      seen[0] = ps.zaps;
      if (visible) {
        h.petView?.zap();
        this.fx.star(ps.zapX, 1, ps.zapZ, 1.3, ZAP_COLOR, 0.12);
        this.fx.ring(ps.zapX, ps.zapZ, 0.5, 2, ZAP_COLOR, 0.2);
        const d = Math.hypot(ps.zapX - L.x, ps.zapZ - L.z);
        if (settings.petSounds !== false && d < 32) {
          sfx.at((ps.zapX - L.x) / 14, d < 6 ? 1 : 1 - ((d - 6) / 26) * 0.7);
          sfx.weapon('zap');
          sfx.at(0, 1);
        }
      }
    }
    if (seen[1] !== ps.fetches) {
      seen[1] = ps.fetches;
      if (visible) {
        h.petView?.zap();
        this.fx.ring(h.player.x, h.player.z, 2, 3, ps.def.color, 0.3);
      }
    }
  }
  // Taunting decoys pulse; linked heroes spark while the meter charges.
  s.fxT -= rdt;
  if (s.fxT <= 0 && rdt > 0) {
    s.fxT = 0.3;
    for (const h of this.heroes) {
      const ps = h.petState;
      if (ps.tauntT > 0 && !h.player.dead && !h.left) this.fx.ring(ps.tauntX, ps.tauntZ, 1, 5, '#ef7d57', 0.3);
    }
    if (on && s.meter.linked >= 2 && s.meter.linkT >= teamTuning.linkTime && !s.meter.ready) {
      const hs = this.heroes;
      for (let i = 0; i < hs.length; i++) {
        for (let j = i + 1; j < hs.length; j++) {
          const a = hs[i].player;
          const b = hs[j].player;
          if (hs[i].left || hs[j].left || a.dead || b.dead || Math.hypot(a.x - b.x, a.z - b.z) > teamTuning.linkRange) continue;
          this.particles.burst((a.x + b.x) / 2, 1.2, (a.z + b.z) / 2, { count: 3, color: '#73eff7', color2: '#f4f4f4', speed: [0.5, 2], size: [0.1, 0.2], life: [0.3, 0.5], up: 2 });
        }
      }
    }
  }
  // Unity Beam: drawn locally from the move state and rendered hero positions.
  const m = s.move;
  if (m && m.id === 'beam' && on) {
    if (this.role === 'client') s.moveT += rdt;
    else s.moveT = m.t;
    beamSources.length = 0;
    for (const h of this.heroes) {
      if (!(m.mask & (1 << h.index)) || h.left || h.player.dead || beamSources.length >= srcPool.length) continue;
      const src = srcPool[beamSources.length];
      const r = h.player.rig.root.position;
      src.x = r.x;
      src.z = r.z;
      src.color = h.color;
      beamSources.push(src);
    }
    if (!s.view) s.view = new TeamMoveView(this.scene);
    s.view.draw(beamSources, m.x, m.z, Math.min(1, s.moveT / teamTuning.beamTime), this.animTime);
  } else s.view?.hide();
}
