/**
 * Title attract mode: behind the title logo, a live demo of the game played
 * by the autoplay brain (src/game/autopilot.ts) in a random biome the player
 * has already reached. The game stays in mode 'title' (menus, music, HUD and
 * saves behave as on the title screen); each demo step briefly runs the real
 * simulation with a scripted input, gameplay sounds muted, no damage numbers,
 * shakes or banners, and the profile locked (no saves, achievements, enemies
 * met, high scores or lifetime stats). It restarts on death or every
 * `attractTuning.length` seconds, and stops the moment the title screen isn't
 * showing (any menu, a run, online play, a hidden tab). Starting a run
 * rebuilds everything the demo touched (startRun / clientStart).
 * Installed on Game as `attractTick` and called from Game.update on the title.
 */
import * as THREE from 'three';
import type { Game, Mode } from '../game';
import type { Input } from '../../core/input';
import { Rng, randomSeed } from '../../core/rng';
import { Autopilot, type PilotIntent } from '../autopilot';
import { createWeapon } from '../weapons';
import { WEAPONS } from '../../data/weapons';
import { DIFF_BY_ID } from '../../data/modes';
import { loadoutOptions, type Loadout, type LoadoutSlot } from '../../data/loadout';
import { biomeStagesUpTo } from '../../data/biomes';
import { save, saveLock, unlockedLoadout, unlockedWeapons } from '../save';
import { audioSettings } from '../../audio/sfx';

export const attractTuning = {
  /** Run the demo behind the title at all. */
  enabled: true,
  /** Seconds on the title screen before the demo starts. */
  delay: 2,
  /** Seconds before the demo restarts in a new place. */
  length: 60,
  /** Seconds after the demo hero falls before it restarts. */
  deadWait: 1.6,
  /** Stage clock the demo starts at (the horde is livelier a minute or two in). */
  startTime: 90,
  /** Enemy count multiplier (lighter than a real run, so menus stay smooth). */
  crowd: 0.7,
  /** Auto weapons the demo hero brings, and their level range. */
  autoWeapons: 3,
  autoLevels: [2, 4] as [number, number],
  /** Camera offset (m) that puts the demo hero right of the title menu. */
  frameX: 7,
};

/** A stand-in for Input during demo steps: the autopilot's intent as a gamepad. */
class ScriptedInput {
  device: 'kbm' | 'pad' = 'pad';
  readonly mouse = { x: 0, y: 0, ndcX: 0, ndcY: 0, inside: false };
  readonly move = { x: 0, y: 0 };
  readonly padAim = { x: 0, y: 0 };
  readonly virtual = { active: false, move: { x: 0, y: 0 }, aim: { x: 0, y: 0 }, buttons: [] as boolean[] };
  rumbleOn = false;
  private charge = false;
  private actions = new Set<string>();

  set(o: PilotIntent, hx: number, hz: number): void {
    const l = Math.hypot(o.mx, o.mz);
    this.move.x = l > 0.05 ? o.mx / l : 0;
    this.move.y = l > 0.05 ? o.mz / l : 0;
    const t = o.target;
    const dx = t ? t.x - hx : 0;
    const dz = t ? t.z - hz : 0;
    const d = Math.hypot(dx, dz);
    this.padAim.x = d > 0.01 ? dx / d : 0;
    this.padAim.y = d > 0.01 ? dz / d : 0;
    this.charge = o.charge;
    this.actions.clear();
    if (o.dash) this.actions.add('dash');
    if (o.special) this.actions.add('bomb');
    if (o.ult) this.actions.add('ult');
    if (o.parry) this.actions.add('parry');
  }
  key(): boolean {
    return false;
  }
  keyPressed(): boolean {
    return false;
  }
  actionPressed(a: string): boolean {
    return this.actions.has(a);
  }
  actionDown(): boolean {
    return false;
  }
  rumble(): void {}
  mouseDown(): boolean {
    return false;
  }
  mousePressed(): boolean {
    return false;
  }
  padButton(i: number): boolean {
    return i === 2 && this.charge;
  }
  padButtonPressed(): boolean {
    return false;
  }
  poll(): void {}
  endStep(): void {
    this.actions.clear();
  }
}

interface AttractState {
  running: boolean;
  idle: number;
  t: number;
  deadT: number;
  arena: unknown;
  pilot: Autopilot;
  input: ScriptedInput;
  /** Stage whose biome the demo shows. */
  stage: number;
  steps: number;
  stepMs: number;
}

const states = new WeakMap<Game, AttractState>();

function state(g: Game): AttractState {
  let s = states.get(g);
  if (!s) {
    s = { running: false, idle: 0, t: 0, deadT: 0, arena: null, pilot: new Autopilot(), input: new ScriptedInput(), stage: 1, steps: 0, stepMs: 0 };
    states.set(g, s);
  }
  return s;
}

/** Is the demo playing right now? */
export function attractRunning(g: Game): boolean {
  const s = states.get(g);
  return !!s && s.running && s.arena === g.arena;
}

const LEAD = new THREE.Vector3();
/** Camera offset on the title: while the demo plays, frame its hero to the right of the menu. */
export function attractLead(g: Game): THREE.Vector3 {
  return attractRunning(g) ? LEAD.set(-attractTuning.frameX, 0, 0) : LEAD.set(0, 0, 0);
}

/** Average simulation cost of a demo step so far (ms), for tests and the debug panel. */
export function attractStepMs(g: Game): number {
  const s = states.get(g);
  return s && s.steps ? s.stepMs / s.steps : 0;
}

export function attractTick(this: Game, dt: number): void {
  const s = state(this);
  const hidden = typeof document !== 'undefined' && document.hidden;
  const ok = attractTuning.enabled && this.mode === 'title' && this.role === 'solo' && !this.pvp && this.heroes.length === 1 && this.screens.current === 'title' && !this.paused && !hidden;
  // Something rebuilt the title world (back to the title after a run): start over.
  if (s.running && s.arena !== this.arena) s.running = false;
  if (!ok) {
    s.idle = 0;
    return;
  }
  if (!s.running) {
    if ((s.idle += dt) >= attractTuning.delay) startDemo(this, s);
    return;
  }
  s.t += dt;
  if (this.hero.player.dead) s.deadT += dt;
  if (s.t >= attractTuning.length || s.deadT >= attractTuning.deadWait || this.director.bossSpawned) {
    startDemo(this, s);
    return;
  }
  stepDemo(this, s, dt);
}

/** A random loadout from what this save has unlocked. */
function demoLoadout(rng: Rng): Loadout {
  const unlocked = unlockedLoadout();
  const pick = (slot: LoadoutSlot) => {
    const opts = loadoutOptions(slot).filter((id) => unlocked.includes(id));
    return opts.length ? rng.pick(opts) : loadoutOptions(slot)[0];
  };
  return { primary: pick('primary'), secondary: pick('secondary'), special: pick('special') };
}

function startDemo(g: Game, s: AttractState): void {
  const rng = new Rng(randomSeed());
  const stages = biomeStagesUpTo(save.lifetime.bestStage);
  s.stage = rng.pick(stages);
  g.seed = randomSeed();
  g.rng = new Rng(g.seed);
  g.difficulty = DIFF_BY_ID.normal;
  g.runMode = 'standard';
  g.curses = [];
  g.runEvents.reset();
  g.stage = 1;
  g.score = g.kills = g.combo = g.maxCombo = 0;
  g.runTime = g.comboT = 0;
  g.level = 1;
  g.xp = 0;
  g.xpNext = 1e12; // no level-up menus in the demo
  g.director.players = 1;
  // The biome's arena; enemies stay stage-1 strength.
  g.loadArena((g.seed ^ Math.imul(s.stage, 0x9e3779b1)) >>> 0, s.stage);
  g.clearWorld();
  const h = g.hero;
  h.loadoutPick = demoLoadout(rng);
  h.unlocked = unlockedWeapons();
  h.startRun();
  // A few auto weapons at mid levels so the demo looks like a run in full swing.
  const autos = h.unlocked.filter((id) => WEAPONS[id] && !WEAPONS[id].slot && !h.weapons.some((w) => w.def.id === id));
  for (let k = 0; k < attractTuning.autoWeapons && autos.length; k++) {
    const id = autos.splice(rng.int(0, autos.length - 1), 1)[0];
    const w = createWeapon(id, g.scene);
    for (let n = rng.int(attractTuning.autoLevels[0], attractTuning.autoLevels[1]); n > 1 && !w.maxed; n--) w.levelUp();
    h.weapons.push(w);
  }
  h.passives = { armor: 2, heart: 2 };
  h.recomputeStats();
  h.player.reset(h.stats);
  h.player.teleport(0, 0);
  h.loadoutDirty = true;
  g.director.start(1);
  g.director.time = Math.min(attractTuning.startTime, g.director.duration - 75);
  g.director.countMul = attractTuning.crowd;
  g.chestT = -1e9; // no chests (their finds pop up HUD boxes)
  g.modeT = 0;
  s.arena = g.arena;
  s.running = true;
  s.t = s.deadT = s.idle = 0;
}

type Swappable = { input: Input; mode: Mode };
const noop = () => {};

/** One simulation step of the demo, with the world's side effects muted. */
function stepDemo(g: Game, s: AttractState, dt: number): void {
  const t0 = performance.now();
  const p = g.hero.player;
  s.input.set(s.pilot.decide(g), p.x, p.z);
  const w = g as unknown as Swappable;
  const realInput = w.input;
  const sfx = audioSettings.sfx;
  const ui = audioSettings.ui;
  // Things that would leave the title screen or touch the profile do nothing during the step.
  const hooks = ['openLevelUp', 'openShop', 'stageClear', 'endRun', 'checkAchievements', 'pause', 'openPortal', 'startBossIntro'] as const;
  const saved = hooks.map((k) => g[k]);
  const dmgSpawn = g.dmg.spawn;
  w.input = s.input as unknown as Input;
  w.mode = 'fight';
  audioSettings.sfx = 0;
  audioSettings.ui = 0;
  saveLock.on = true;
  for (const k of hooks) (g as unknown as Record<string, unknown>)[k] = noop;
  g.dmg.spawn = noop;
  try {
    g.simulate(dt, true);
  } finally {
    w.input = realInput;
    w.mode = 'title';
    audioSettings.sfx = sfx;
    audioSettings.ui = ui;
    saveLock.on = false;
    hooks.forEach((k, i) => ((g as unknown as Record<string, unknown>)[k] = saved[i]));
    g.dmg.spawn = dmgSpawn;
    s.input.endStep();
    // No screen shake, hit-stop or camera kicks behind the menu.
    g.juice.reset();
  }
  s.steps++;
  s.stepMs += performance.now() - t0;
}
