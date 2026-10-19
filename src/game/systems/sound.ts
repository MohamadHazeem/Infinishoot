/** Local cosmetics only: works with authoritative state and mirrored client snapshots. */
import * as THREE from 'three';
import type { Game } from '../game';
import type { Hero } from '../hero';
import type { Enemy } from '../enemies';
import type { Weapon } from '../weapons';
import type { EnemyDef } from '../../data/enemies';
import { sfx } from '../../audio/sfx';
import { ambience } from '../../audio/ambienceAudio';
import { announcer } from '../../audio/announcer';
import { biomeAudio, comboLine, groundAudio, soundTuning } from '../../audio/mix';
import { music } from '../../audio/music';
import { CallGate, callPitch, enemyFamily, familyTuning } from '../../audio/families';
import { reaperInterval, threatTuning } from '../../audio/threats';
import { threatAt } from '../../audio/captions';
import { heroVoice, type Speaker } from '../../audio/heroVoice';
import type { BarkKind } from '../../audio/voice';
import { AudioA11y } from '../../ui/audioA11y';

// ---------------------------------------------------------------- cue names (host side, recorded for clients)

/** Sound key of an evolved weapon ('' if not evolved): "<id>.<evo id>" for track items, "<id>.evo" for partner evolutions. */
export function evoSoundKey(w: Weapon): string {
  if (w.build) return w.evoId ? w.def.id + '.' + w.evoId : '';
  return w.evolved ? w.def.id + '.evo' : '';
}

/** Effects-bus name for a weapon cue: evolved weapons carry their layer key ("w:scatter|scatter.flak"). */
export function weaponCue(name: string, w: Weapon | null | undefined): string {
  const key = w ? evoSoundKey(w) : '';
  return key ? 'w:' + name + '|' + key : 'w:' + name;
}

/** A special or the Bomb just went off: its evolution's layer next to the base cue. */
export function specialEvoCue(g: Game, h: Hero): void {
  const evo = h.specialEvo;
  if (evo) g.vfx.sound('evo:' + h.specialDef.id + '.' + evo, h.player.x, h.player.z);
}

const gates = new WeakMap<Game, CallGate>();
/** Enemy family call (host / solo), gated so crowds stay readable instead of noisy. */
export function familyCall(g: Game, def: EnemyDef, x: number, z: number, elite: boolean, chance = 1): void {
  if (def.hidden || g.role === 'client' || (chance < 1 && Math.random() > chance)) return;
  let gate = gates.get(g);
  if (!gate) gates.set(g, (gate = new CallGate()));
  const f = enemyFamily(def);
  if (!gate.allow(f, performance.now() / 1000)) return;
  g.vfx.sound('call:' + f, x, z, callPitch(def.radius, elite));
}

/** An enemy starts an attack wind-up: telegraph (threat cues for the dangerous ones) plus a family call. */
export function windupCue(g: Game, e: Enemy): void {
  const d = e.def;
  if (d.boss) g.vfx.sound('bossWindup', e.x, e.z);
  else if (d.behavior === 'charger') g.vfx.sound('chargerWindup', e.x, e.z);
  else if (d.behavior === 'exploder') e.tickT = 0;
  else if (d.shoot?.pattern === 'sniper') g.vfx.sound('threatSniper', e.x, e.z);
  else if (d.behavior === 'mortar') g.vfx.sound('threatMortar', e.x, e.z);
  else if (d.behavior === 'leaper') g.vfx.sound('threatLeap', e.x, e.z);
  else if (d.behavior !== 'spawner') g.vfx.sound('telegraph', e.x, e.z);
  familyCall(g, d, e.x, e.z, e.elite);
}

/** An enemy spawned (director spawns): sometimes a family call; elites announce where they land. */
export function spawnCue(g: Game, def: EnemyDef, x: number, z: number, elite: boolean): void {
  if (elite) g.vfx.sound('threatElite', x, z);
  familyCall(g, def, x, z, elite, elite ? 1 : familyTuning.spawnChance);
}

// ---------------------------------------------------------------- local, per frame

interface HeroAudio {
  hp: number;
  dead: boolean;
  low: boolean;
  dash: boolean;
  evo: number;
}

/** Evolved weapons plus an evolved special. */
function evoCount(h: Hero): number {
  let n = h.specialEvo ? 1 : 0;
  for (const w of h.weapons) if (w.evolved) n++;
  return n;
}

const speakers = new WeakMap<Hero, Speaker>();
/** The hero as a voice speaker (one object per hero, refreshed in place: no per-frame garbage). */
function speakerOf(g: Game, h: Hero): Speaker {
  let s = speakers.get(h);
  if (!s) speakers.set(h, (s = { heroId: '', index: 0, name: '', color: '' }));
  s.heroId = h.heroDef.id;
  s.index = h.index;
  s.name = g.heroes.length > 1 ? h.name : h.heroDef.name;
  s.color = h.color;
  return s;
}

interface AudioState {
  mode: string;
  started: boolean;
  steps: number;
  combo: number;
  scan: number;
  pass: number;
  goUntil: number;
  strikes: number;
  heroes: (HeroAudio | undefined)[];
  level: number;
  evoScan: number;
  reaperScan: number;
  reaperT: number;
  reaper: Enemy | null;
}
let a11y: AudioA11y | null = null;
const proj = new THREE.Vector3();
const states = new WeakMap<Game, AudioState>();
export function updateSound(this: Game, dt: number, frozen: boolean): void {
  let state = states.get(this);
  if (!state) {
    state = { mode: 'title', started: false, steps: 0, combo: 0, scan: 0, pass: 0, goUntil: 0, strikes: 0, heroes: [], level: 1, evoScan: 0, reaperScan: 0, reaperT: 0, reaper: null };
    states.set(this, state);
  }
  const mode = this.mode;
  const active = mode !== 'title' && mode !== 'dead';
  const fighting = this.isCombatMode && !this.paused && !frozen;
  const biome = biomeAudio(this.arenaStage);
  sfx.crowd = this.enemies.activeCount;
  ambience.update(biome, active, !fighting);
  // Rain bed and thunder follow the weather (worked out locally on every machine).
  ambience.setRain(active ? this.ambience.rain : 0);
  if (this.ambience.strikes !== state.strikes) {
    if (active && this.ambience.strikes > state.strikes) sfx.thunder(this.ambience.strikeDist);
    state.strikes = this.ambience.strikes;
  }
  announcer.update();
  if (
    mode === 'title' ||
    (state.mode === 'dead' && mode !== 'dead') ||
    (this.preShop && state.started)
  ) {
    if (state.started) announcer.reset();
    state.started = false;
    state.combo = state.steps = state.goUntil = 0;
  }
  if (fighting && !state.started) {
    state.started = true;
    state.goUntil = 4; // Brief grace if the user gesture is also the run-start click.
  }
  if (state.goUntil > 0) {
    state.goUntil -= dt;
    if (announcer.say('go')) state.goUntil = 0;
  }
  if (mode !== state.mode) {
    if (mode === 'dead') announcer.say('game_over');
    if (mode === 'cleared') {
      announcer.say('stage_clear');
      if (!this.hero.player.dead) heroVoice.bark('victory', speakerOf(this, this.hero), { force: true });
    }
    state.mode = mode;
  }
  heroVoice.local = active ? speakerOf(this, this.hero) : null;
  heroVoices(this, state, dt, fighting);
  if (this.hero.level > state.level && active && !this.hero.player.dead) heroVoice.bark('levelUp', speakerOf(this, this.hero));
  state.level = this.hero.level;
  // Style rank drives the music's style layer (next bar).
  music.setStyleRank(fighting ? this.hero.skill.style.rank : 0);
  reaperToll(this, state, dt, fighting);
  overlays(this, dt);
  if (fighting) {
    const tier = this.combo >= 150 ? 3 : this.combo >= 100 ? 2 : this.combo >= 50 ? 1 : 0;
    if (tier > state.combo) {
      const line = comboLine(this.combo);
      if (line) announcer.say(line);
    }
    state.combo = tier;
  }
  const p = this.hero.player;
  if (!fighting || p.dead) {
    state.steps = 0;
    return;
  }
  if (!p.dashing && p.speed > 0.8) {
    state.steps += Math.min(dt, 0.05) * p.speed;
    if (state.steps >= soundTuning.stepStride) {
      state.steps %= soundTuning.stepStride;
      sfx.footstep(p.ground.pushX || p.ground.pushZ ? 'metal' : groundAudio(biome));
    }
  } else state.steps = 0;
  // Round-robin at most 32 slots/frame and one whoosh/0.4 s. No per-projectile objects.
  state.pass -= dt;
  const b = this.bullets;
  if (state.pass > 0 || b.count === 0) return;
  for (let n = 0, count = Math.min(32, b.count); n < count; n++) {
    const i = state.scan++ % b.count;
    if (b.width[i] < 0.7 && b.radius[i] < 0.34) continue;
    const dx = b.x[i] - p.x,
      dz = b.z[i] - p.z;
    const distance = dx * dx + dz * dz;
    const approach = dx * b.vx[i] + dz * b.vz[i];
    if (distance > 0.8 && distance < 9 && approach < -2 && b.vx[i] ** 2 + b.vz[i] ** 2 > 64) {
      sfx.whoosh(dx / 3);
      state.pass = 0.4;
      break;
    }
  }
}

/** Barks derived from synced state, for every hero in earshot (co-op: each with their own voice). */
function heroVoices(g: Game, st: AudioState, dt: number, fighting: boolean): void {
  st.evoScan -= dt;
  const scanEvo = st.evoScan <= 0;
  if (scanEvo) st.evoScan = 0.25;
  const me = g.hero.player;
  for (const h of g.heroes) {
    const p = h.player;
    let prev = st.heroes[h.index];
    if (!prev) st.heroes[h.index] = prev = { hp: p.hp, dead: p.dead, low: false, dash: false, evo: evoCount(h) };
    if (h.left) continue;
    const mine = h === g.hero;
    const dx = p.x - me.x;
    const dz = p.z - me.z;
    const d = Math.hypot(dx, dz);
    const evo = scanEvo ? evoCount(h) : prev.evo;
    if (fighting && (mine || d < 30)) {
      let kind: BarkKind | null = null;
      if (p.dead && !prev.dead) kind = 'death';
      else if (!p.dead && prev.dead) kind = 'revive';
      else if (!p.dead && evo > prev.evo) kind = 'evolve';
      else if (!p.dead && p.hp < prev.hp - 0.5) kind = p.hp < p.maxHp * 0.25 && !prev.low ? 'lowLife' : 'hurt';
      else if (mine && p.dashing && !prev.dash) kind = 'dash';
      if (kind) {
        // Remote heroes' yelps play but stay off the caption strip; dashes are never captioned.
        const routine = kind === 'hurt' || kind === 'dash';
        heroVoice.bark(kind, speakerOf(g, h), { pan: mine ? 0 : dx / 14, gain: mine ? 1 : Math.max(0.3, 1 - d / 30), caption: kind === 'dash' ? false : mine || !routine, force: !routine });
      }
    }
    prev.hp = p.hp;
    prev.dead = p.dead;
    prev.dash = p.dashing;
    prev.evo = evo;
    if (p.hp < p.maxHp * 0.25) prev.low = true;
    else if (p.hp > p.maxHp * 0.4) prev.low = false;
  }
}

/** The Reaper's toll: a bell that rings faster as it closes in, panned toward it (local to each machine). */
function reaperToll(g: Game, st: AudioState, dt: number, fighting: boolean): void {
  st.reaperScan -= dt;
  if (st.reaperScan <= 0) {
    st.reaperScan = 0.25;
    st.reaper = null;
    if (fighting) {
      let best = threatTuning.reaperRange;
      const me = g.hero.player;
      for (const e of g.enemies.list) {
        if (!e.active || e.hp <= 0 || e.def.id !== 'reaper') continue;
        const d = Math.hypot(e.x - me.x, e.z - me.z);
        if (d < best) {
          best = d;
          st.reaper = e;
        }
      }
    }
  }
  const r = st.reaper;
  st.reaperT -= dt;
  if (!r || !fighting || st.reaperT > 0) return;
  const me = g.hero.player;
  const d = Math.hypot(r.x - me.x, r.z - me.z);
  st.reaperT = reaperInterval(d);
  sfx.at((r.x - me.x) / 14, Math.max(0.3, 1 - d / threatTuning.reaperRange));
  sfx.threatReaper();
  sfx.at(0, 1);
  threatAt('threatReaper', r.x, r.z);
}

/** Captions strip and sound arrows (created on first use). */
function overlays(g: Game, dt: number): void {
  if (!a11y) {
    if (typeof document === 'undefined') return;
    const hud = document.getElementById('hud');
    if (!hud) return;
    a11y = new AudioA11y(hud);
  }
  const cam = g.cam.camera;
  const w = innerWidth;
  const h = innerHeight;
  a11y.update(
    dt,
    (x, z) => {
      proj.set(x, 0.5, z).project(cam);
      if (proj.z > 1) return null;
      return { x: ((proj.x + 1) / 2) * w, y: ((1 - proj.y) / 2) * h };
    },
    w,
    h,
  );
}

/** The overlay instance (tests and screenshots). */
export function audioOverlays(): AudioA11y | null {
  return a11y;
}
