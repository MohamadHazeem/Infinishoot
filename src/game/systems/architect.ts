/** ultboss: host simulation, one `ac` snapshot field, local presentation. */
import type { Game } from '../game';
import type { Enemy } from '../enemies';
import type { Arena } from '../../world/fieldArena';
import type { AABB } from '../../world/collision';
import type { PilotIntent } from '../autopilot';
import { ENEMIES } from '../../data/enemies';
import { StaticBoxGrid } from '../../core/spatialHash';
import { Team } from '../bullets';
import { grantAchievement, markCodex, persist, save, saveLock, unlockMeta } from '../save';
import { clearBossLane } from './bossLane';
import { clearSecrets } from './secrets';
import { worldRun } from './worldEvents';
import * as Gauntlet from './gauntlet';
import { ArchitectState, architectTuning as T, architectEligible, architectHp, hpGate, corePosition, tileAt, dangerHits, activeCore, packArchitect, unpackArchitect, wallPose, type ArchitectNet, type Danger } from '../architect/model';
import { ArchitectView } from '../architect/view';
import { ArchitectUi } from '../architect/ui';
import { architectEn } from '../architect/strings';
import { settings } from '../settings';
import { portraits } from '../../ui/portraits';

interface Lane {
  s: ArchitectState; boss: Enemy | null; cores: (Enemy | null)[];
  view: ArchitectView | null; ui: ArchitectUi | null; ended: boolean;
  arena: Arena | null; original: Partial<Arena> | null; wallKey: number; projectionZoom: number | null;
}
const lanes = new WeakMap<Game, Lane>();
function lane(g: Game): Lane {
  let l = lanes.get(g);
  if (!l) { l = { s: new ArchitectState(), boss: null, cores: [], view: null, ui: null, ended: false, arena: null, original: null, wallKey: -1, projectionZoom: null }; lanes.set(g, l); }
  return l;
}
export function architectState(g: Game): ArchitectState { return lane(g).s; }
export function architectActive(g: Game): boolean { return lanes.get(g)?.s.active ?? false; }
const P = { x: 0, z: 0 }, W = { x: 0, z: 0, w: 0, d: 0 };
const TAU = Math.PI * 2;

/** Replace only this encounter's terrain; restore before any stage/reset disposes the old arena. */
function arenaOn(g: Game, l: Lane): void {
  if (l.arena === g.arena) return;
  const a = g.arena;
  l.arena = a;
  l.original = { colliders: a.colliders, hazards: a.hazards, conveyors: a.conveyors, props: a.props, pads: a.pads, turrets: a.turrets, spots: a.spots, barrels: a.barrels, deco: a.deco };
  a.colliders = []; a.hazards = []; a.conveyors = []; a.props = []; a.pads = []; a.turrets = []; a.spots = []; a.barrels = []; a.deco = undefined;
  a.group.visible = false;
  g.enemyCtx.colliders = a.colliders;
  g.barrels.load(a); g.toys.load(a, g.stage, '#73eff7'); g.toys.objective.state = 'failed';
  g.chests.clear(); g.strikes.length = 0;
  l.wallKey = -1;
  syncWalls(g, l);
}
function syncWalls(g: Game, l: Lane): void {
  const s = l.s;
  const wallsOn = s.active && s.phase === 1 && s.layoutTime >= T.warning;
  const key = wallsOn ? s.layout + 1 : 0;
  if (key === l.wallKey) return;
  l.wallKey = key;
  const boxes: AABB[] = g.arena.colliders;
  boxes.length = 0;
  const edge = T.half;
  boxes.push({ minX: -50, maxX: -edge, minZ: -50, maxZ: 50 }, { minX: edge, maxX: 50, minZ: -50, maxZ: 50 },
    { minX: -edge, maxX: edge, minZ: -50, maxZ: -edge }, { minX: -edge, maxX: edge, minZ: edge, maxZ: 50 });
  if (wallsOn) for (let i = 0; i < 4; i++) {
    wallPose(i, s.layout, W);
    boxes.push({ minX: W.x - W.w / 2, maxX: W.x + W.w / 2, minZ: W.z - W.d / 2, maxZ: W.z + W.d / 2 });
  }
  g.walls = new StaticBoxGrid(boxes);
}
function clearShots(g: Game): void { for (let i = g.bullets.count - 1; i >= 0; i--) if (g.bullets.team[i] === Team.Enemy) g.bullets.kill(i); }
function clearAttacks(g: Game, s: ArchitectState): void {
  for (const d of s.dangers) d.kind = 0;
  clearShots(g); g.strikes.length = 0;
}
export function startArchitect(g: Game, preview = false): void {
  if (g.role === 'client' || g.pvp || g.runMode === 'raid') return;
  clearBossLane.call(g); clearSecrets(g);
  g.bossField.clear(); g.bossIntro.stop(); g.introLeft = 0;
  const world = worldRun(g); world.ev = null; world.planned = null;
  g.runEvents.reset();
  g.enemies.clear(); g.bullets.clear(); g.pickups.clear();
  const l = lane(g), s = l.s = new ArchitectState();
  s.active = true; s.preview = preview; l.ended = false;
  g.mode = 'fight'; g.modeT = 0; g.screens.show('none');
  g.director.hold = true; g.director.bossSpawned = true; g.bossField.miniStage = g.stage;
  const boss = g.enemies.spawn(ENEMIES.architect, 0, -3, { instant: true });
  boss.hp = boss.maxHp = architectHp(g.heroes.filter(h => !h.left).length, g.difficulty.enemyHp);
  boss.dmgMul = g.difficulty.enemyDmg;
  boss.roarT = T.entrance;
  s.uid = boss.uid; l.boss = g.boss = boss; l.cores = [];
  arenaOn(g, l);
  for (const h of g.heroes) {
    if (h.left) continue;
    if (h.player.dead) g.reviveHero(h, 0.5, false);
    h.player.pos.x = (h.index % 4 - 1.5) * 2; h.player.pos.z = 7 + Math.floor(h.index / 4) * 2;
    h.player.prev.x = h.player.x; h.player.prev.z = h.player.z; h.player.vel.x = h.player.vel.z = 0;
    h.player.invuln = T.entrance; h.player.heal(h.player.maxHp * 0.3);
  }
  g.vfx.banner(architectEn['architect.name'], architectEn['architect.subtitle'], 3);
  g.vfx.portrait('boss:architect', 'determined', architectEn['architect.intro'], 3);
  g.vfx.sound('bossRoar', 0, -3); g.vfx.sound('bossPhase', 0, -3);
}
/** Intercept only the real stage-12 Omega clear. A later loop never repeats this encounter. */
export function stageClear(this: Game): void {
  const l = lane(this), s = l.s;
  if (s.done) return;
  if (s.active) {
    if (l.boss?.active && l.boss.uid === s.uid) return;
    finish(this, l);
    return;
  }
  if (architectEligible(this.stage, this.runMode, !!this.pvp, s.sawOmega)) { this.bossesRun++; startArchitect(this); return; }
  Gauntlet.stageClear.call(this);
}
/** Called before the normal damage pipeline, including burns and fixed/Nuke hits. */
export function architectCanDamage(g: Game, e: Enemy): boolean {
  if (e.def.id !== 'architect' && e.def.id !== 'architect_core') return true;
  const l = lanes.get(g);
  if (!l?.s.active || e.under || e.roarT > 0) return false;
  return e.def.id === 'architect' ? !(l.s.desperate && !l.s.desperationDone) : e.uid === l.s.coreUids[l.s.core];
}
/** BossHpGate hook: our phases are bespoke and cannot be skipped by overkill. */
export function architectHpGate(g: Game, e: Enemy): boolean {
  if (e.def.id !== 'architect') return false;
  const l = lane(g), s = l.s;
  e.hp = hpGate(s.phase, e.hp, e.maxHp, s.desperate);
  if (s.phase < 3 && e.hp <= e.maxHp * (s.phase === 1 ? 0.66 : 0.33) + 0.01) phase(g, l, s.phase === 1 ? 2 : 3);
  else if (s.phase === 3 && !s.desperate && e.hp <= e.maxHp * T.desperationAt + 0.01) desperation(g, l);
  return true;
}
function phase(g: Game, l: Lane, next: 2 | 3): void {
  const s = l.s, b = l.boss!;
  s.phase = b.phase = next; s.phaseTime = 0; s.pause = T.transition; s.pattern = 0; s.cycleTime = 0; s.pulse = 1;
  s.layout = 0; s.layoutTime = T.warning; s.echoTime = 0;
  b.roarT = T.transition;
  clearAttacks(g, s);
  g.vfx.banner(architectEn[next === 2 ? 'architect.p2' : 'architect.p3'], architectEn[next === 2 ? 'architect.echo' : 'architect.coreHint'], 2.4);
  g.vfx.sound('bossPhase', 0, -3); g.vfx.ring(0, -3, 2, 10, '#73eff7', 0.7);
  if (next === 3) {
    for (const e of g.enemies.list) if (e.active && e !== b) g.enemies.kill(e);
    b.under = true;
    for (let i = 0; i < 3; i++) {
      corePosition(i, s.time, P);
      const e = g.enemies.spawn(ENEMIES.architect_core, P.x, P.z, { instant: true });
      e.hp = e.maxHp = b.maxHp * T.coreShare; e.under = i > 0; e.roarT = T.transition;
      s.coreUids[i] = e.uid; l.cores[i] = e;
    }
  }
}
function danger(g: Game, s: ArchitectState, kind: number, x: number, z: number, r: number, warn = T.warning, life = 0.6, dx = 1, dz = 0): Danger | null {
  for (const d of s.dangers) if (!d.kind) {
    d.kind = kind; d.x = x; d.z = z; d.dx = dx; d.dz = dz; d.r = r; d.age = 0; d.warn = warn; d.life = life; d.hit = 0;
    g.vfx.sound('telegraph', x, z);
    return d;
  }
  return null;
}
function desperation(g: Game, l: Lane): void {
  const s = l.s;
  s.desperate = true; clearAttacks(g, s);
  for (let i = 0; i < 4; i++) danger(g, s, 4, 0, -3, 1, T.desperationWarn + i * 0.85, 2.4);
  g.vfx.banner(architectEn['architect.pulse'], '', 3);
  g.vfx.sound('bossWindup', 0, -3);
}
function pulse(g: Game, s: ArchitectState, x: number, z: number, count: number, angle: number): void {
  // A 60-degree rotating safe wedge stays legible even with eight heroes.
  const speed = T.bulletSpeed + (s.phase === 3 ? 0.6 : 0);
  for (let i = 0; i < count; i++) {
    const a = i * TAU / count;
    if (a < Math.PI / 3) continue;
    g.bullets.spawn({ x, z, dirX: Math.cos(a + angle), dirZ: Math.sin(a + angle), speed, life: 4.6,
      radius: 0.23, damage: T.bulletDamage * g.difficulty.enemyDmg, knockback: 2, team: Team.Enemy, color: '#ff3df0', width: 0.5, length: 0.5 });
  }
}
function target(g: Game, s: ArchitectState): void {
  const living = g.aliveHeroes;
  const h = living[s.pattern % Math.max(1, living.length)] ?? g.hero;
  s.tx = Math.max(-13, Math.min(13, h.player.x)); s.tz = Math.max(-13, Math.min(13, h.player.z));
}
function attack(g: Game, l: Lane): void {
  const s = l.s;
  target(g, s);
  if (s.phase === 1) {
    s.layout = 1 + s.pattern % 2; s.layoutTime = 0;
    danger(g, s, 2, s.tx, 0, 1.1, 2.2, 0.7, 0, 1);
    danger(g, s, 1, 0, s.tz, 3.3, 2.8, 0.6);
  } else if (s.phase === 2) {
    s.echo = s.pattern % 4; s.echoTime = 5.5;
    // Adjacent signatures overlap, but lock their aim before their warnings start.
    echo(g, l, s.echo, 1.7);
    echo(g, l, (s.echo + 1) % 4, 2.5);
  } else {
    danger(g, s, 2, 0, s.tz, 0.9, 1.8, 0.6);
    danger(g, s, 1, s.tx, s.tz, 2.8, 2.7, 0.5);
  }
  s.pattern++;
}
function echo(g: Game, l: Lane, kind: number, warn: number): void {
  const s = l.s;
  if (kind === 0) { // King's ground slam, then a second landing.
    danger(g, s, 1, s.tx, s.tz, 4, warn, 0.5);
    danger(g, s, 1, -s.tx * 0.6, -s.tz * 0.6, 3.3, warn + 0.8, 0.5);
  } else if (kind === 1) { // Rex charges across a locked lane.
    const d = Math.hypot(s.tx + 8, s.tz + 7) || 1;
    danger(g, s, 2, s.tx, s.tz, 1.2, warn, 0.6, (s.tx + 8) / d, (s.tz + 7) / d);
  } else if (kind === 2) { // Queen's temporary holographic hives release rings of stingers.
    danger(g, s, 3, -9, 4, 2.2, warn, 3);
    danger(g, s, 3, 9, -4, 2.2, warn, 3);
  } else { // Glitch's beat grid leaves broad lanes between four lasers.
    for (const x of [-9, 9]) danger(g, s, 2, x, 0, 0.7, warn, 0.45, 0, 1);
    for (const z of [-9, 9]) danger(g, s, 2, 0, z, 0.7, warn + 0.6, 0.45);
  }
}
function tickDangers(g: Game, l: Lane, dt: number): void {
  const s = l.s;
  let final = false;
  for (const d of s.dangers) {
    if (!d.kind) continue;
    const before = d.age; d.age += dt;
    if (d.age > d.warn + d.life) { d.kind = 0; continue; }
    if (d.kind === 4) final = true;
    if (before < d.warn && d.age >= d.warn) {
      g.vfx.sound(d.kind === 2 ? 'thunder' : 'bossSlam', d.x, d.z);
      if (d.kind === 3) pulse(g, s, d.x, d.z, 12, s.time);
    }
    for (const h of g.heroes) {
      if (h.left || h.player.dead) continue;
      const bit = 1 << h.index, p = h.player;
      if (d.hit & bit || !dangerHits(d, p.x, p.z, p.radius)) continue;
      // A dash or parry crossing consumes this pulse for that player, including its trailing edge.
      if (p.dashing || h.skill.parryT > 0) { d.hit |= bit; continue; }
      if (p.invuln > 0) continue;
      d.hit |= bit;
      g.hurtHero(h, (d.kind === 4 ? p.maxHp * 2 : T.hazardDamage) * g.difficulty.enemyDmg, d.x, d.z, null, 'The Architect');
    }
  }
  if (s.desperate && !final) s.desperationDone = true;
}
function pin(e: Enemy, x: number, z: number): void { e.x = e.px = x; e.z = e.pz = z; e.vx = e.vz = e.kx = e.kz = 0; }
/** Before weapons: observes Omega even if the killing blow lands in this very step. */
export function updateArchitect(g: Game, dt: number): void {
  const l = lane(g), s = l.s;
  if (g.boss?.def.id === 'omega' && g.stage === T.stage) s.sawOmega = true;
  if (!s.active || g.role === 'client' || g.mode !== 'fight') return;
  const b = l.boss;
  if (!b?.active || b.uid !== s.uid) return; // the stage-clear hook owns completion, after the finisher
  g.director.hold = true;
  s.time += dt; s.phaseTime += dt; s.layoutTime += dt; s.echoTime = Math.max(0, s.echoTime - dt);
  s.pause = Math.max(0, s.pause - dt); b.roarT = s.pause;
  pin(b, 0, -3);
  if (s.phase === 3) {
    let sum = 0;
    for (let i = 0; i < 3; i++) {
      const e = l.cores[i];
      const live = !!e?.active && e.uid === s.coreUids[i] && e.hp > 0;
      s.coreHp[i] = live ? e!.hp / e!.maxHp : 0;
      if (!live) continue;
      sum += e!.hp; corePosition(i, s.time, P); pin(e!, P.x, P.z); e!.roarT = s.pause;
    }
    const next = activeCore(s.coreHp);
    if (next !== s.core) {
      s.core = next;
      clearShots(g);
      g.vfx.toast(architectEn[next === 3 ? 'architect.heart' : 'architect.break'], 2);
      g.vfx.sound('bossPhase', 0, -3);
    }
    for (let i = 0; i < 3; i++) if (l.cores[i]?.active && l.cores[i]!.uid === s.coreUids[i]) l.cores[i]!.under = i !== s.core;
    if (b.under) b.hp = Math.max(b.maxHp * 0.105, b.maxHp * (0.33 - T.coreShare * 3) + sum);
    b.under = next < 3;
  }
  syncWalls(g, l);
  for (const h of g.heroes) if (!h.left && !h.player.dead) constrainHero(g, s, h.index, true);
  tickDangers(g, l, dt);
  if (s.pause <= 0 && (!s.desperate || s.desperationDone)) {
    s.cycleTime -= dt;
    if (s.cycleTime <= 0) { attack(g, l); s.cycleTime = s.phase === 1 ? T.cycle : 6.5; }
    s.pulse -= dt;
    if (s.pulse <= 0) { pulse(g, s, 0, -3, s.phase === 3 ? 24 : 16, s.time * 0.3); s.pulse = s.phase === 3 ? T.pulseEvery : 2.1; }
  }
  s.hp = b.hp / b.maxHp;
}
/** Predict bounds/walls locally. Only the host judges a fall and stamps its safe landing. */
function constrainHero(g: Game, s: ArchitectState, index: number, host: boolean): void {
  const h = g.heroes[index], p = h.player;
  p.pos.x = Math.max(-17.2, Math.min(17.2, p.x)); p.pos.z = Math.max(-17.2, Math.min(17.2, p.z));
  if (host && s.layoutTime >= T.warning && !p.dashing && !tileAt(p.x, p.z, s.layout)) {
    if (p.invuln <= 0) g.hurtHero(h, T.fallDamage * g.difficulty.enemyDmg, p.x, p.z, null, 'The Architect');
    if (Math.abs(p.x) < Math.abs(p.z)) p.pos.x = Math.sign(p.x) * 4; else p.pos.z = Math.sign(p.z) * 4;
    p.prev.x = p.x; p.prev.z = p.z;
    const r = s.rescues[index]; r[0]++; r[1] = p.x; r[2] = p.z;
  }
  g.walls.resolveCircle(p.pos, p.radius);
}
export function architectLocalStep(g: Game): void {
  const s = lanes.get(g)?.s;
  if (s?.active && !g.player.dead) constrainHero(g, s, g.hero.index, false);
}
function reward(g: Game, s: ArchitectState): void {
  if (s.preview || saveLock.on) return;
  const earned = grantAchievement('true_ending');
  if (earned) g.newAchievements.push(earned.id);
  markCodex('enemy:architect');
  if (!save.discovered.includes('story:boss:architect')) save.discovered.push('story:boss:architect');
  unlockMeta(); persist();
}
function finish(g: Game, l: Lane): void {
  const s = l.s;
  s.active = false; s.done = true; s.hp = 0;
  clearAttacks(g, s); g.director.hold = true;
  g.bossesRun++; g.victories++; g.score += 150000;
  reward(g, s); g.checkAchievements();
  g.mode = 'dead'; g.modeT = 0; g.gameOverShown = true;
  g.endRun();
}
/** Early update hook: every peer gets its own accessible ending controls after the reliable results message. */
export function architectEndingStep(g: Game, dt: number): boolean {
  const l = lanes.get(g);
  if (!l?.s.done || g.mode === 'title') return false;
  if (!l.ended && g.mode === 'dead') {
    l.ended = true; reward(g, l.s);
    l.ui ??= new ArchitectUi(g); l.ui.start();
  }
  return l.ui?.tick(dt) ?? false;
}
export function architectNet(g: Game): ArchitectNet | null {
  const s = lanes.get(g)?.s;
  return s && (s.active || s.done) ? packArchitect(s) : null;
}
export function applyArchitectNet(g: Game, raw: unknown): void {
  if (!raw) { if (lanes.get(g)?.s.active || lanes.get(g)?.s.done) clearArchitect(g); return; }
  const n = raw as ArchitectNet, l = lane(g);
  const arrival = !l.s.active && !l.s.done;
  const rescue = n.rs[g.hero.index], rescued = rescue[0] > l.s.rescues[g.hero.index][0];
  unpackArchitect(n, l.s);
  if (arrival && !n.done) g.player.teleport((g.hero.index % 4 - 1.5) * 2, 7 + Math.floor(g.hero.index / 4) * 2);
  arenaOn(g, l); syncWalls(g, l);
  if (rescued && !n.done) g.player.teleport(rescue[1], rescue[2]);
  // Core shields must be known before local aim/prediction; generic enemy records don't carry `under`.
  const b = g.netEnemies.get(n.u);
  if (b) b.under = n.p === 3 && n.c < 3;
  for (let i = 0; i < 3; i++) { const e = g.netEnemies.get(n.cu[i]); if (e) e.under = i !== n.c; }
}
export function clearArchitect(g: Game): void {
  const l = lanes.get(g); if (!l) return;
  if (l.arena && l.original) {
    Object.assign(l.arena, l.original); l.arena.group.visible = true;
    if (g.arena === l.arena) { g.walls = new StaticBoxGrid(g.arena.colliders); g.enemyCtx.colliders = g.arena.colliders; }
  }
  l.arena = null; l.original = null; l.s = new ArchitectState(); l.boss = null; l.cores.length = 0;
  restoreProjection(g, l);
  l.view?.hide(); l.ui?.stop(); l.ended = false;
}
function restoreProjection(g: Game, l: Lane): void {
  if (l.projectionZoom === null) return;
  g.cam.camera.zoom = l.projectionZoom; l.projectionZoom = null; g.cam.camera.updateProjectionMatrix();
}
/** Render before camera.update, after other automatic camera framing. */
export function renderArchitect(g: Game): void {
  const l = lanes.get(g); if (!l) return;
  const s = l.s;
  if (s.active) {
    // The complete platform must stay visible: cameraRig's normal distance cap is sized for crowds.
    if (l.projectionZoom === null) { l.projectionZoom = g.cam.camera.zoom; g.cam.camera.zoom = 0.65; g.cam.camera.updateProjectionMatrix(); }
    l.view ??= new ArchitectView(g.scene); l.ui ??= new ArchitectUi(g);
    g.arena.group.visible = false;
    g.cam.cine = 0; g.cam.auto = 1;
    g.cam.frameTeam(-g.playerPos.x, -g.playerPos.z, 2.2);
    g.lead.set(0, 0, 0); g.objHud.update(null, null);
  }
  if (!s.active) restoreProjection(g, l);
  l.view?.draw(s); l.ui?.hudDraw(s, s.active && g.screens.current === 'none');
}
/** The normal bot still aims/fires; this just teaches it the ordered cores and final pulse timing. */
export function pilotArchitect(g: Game, o: PilotIntent): void {
  const l = lanes.get(g); if (!l?.s.active) return;
  const s = l.s, p = g.player;
  const e = s.phase === 3 && s.core < 3 ? (g.role === 'client' ? g.netEnemies.get(s.coreUids[s.core]) : l.cores[s.core]) : g.boss;
  if (e?.alive) o.target = e;
  if (Math.abs(p.x) > 14) o.mx = -Math.sign(p.x);
  if (Math.abs(p.z) > 14) o.mz = -Math.sign(p.z);
  o.special ||= g.hero.bombCharge >= 1;
  for (const d of s.dangers) {
    if (d.kind !== 4) continue;
    const until = d.warn + Math.hypot(p.x, p.z + 3) / T.desperationSpeed - d.age;
    if (until > 0 && until < 0.15) { o.dash = p.dashReady01 >= 1; o.parry = !o.dash; }
  }
}
/** Direct QA link. `architectphase` reaches a phase without defeating its earlier health pools. */
export function architectLinks(g: Game, q: URLSearchParams): void {
  if (!q.has('architect')) return;
  startArchitect(g, true);
  const l = lane(g), s = l.s;
  const ph = Math.max(1, Math.min(3, Number(q.get('architectphase')) || 1));
  if (ph >= 2) { l.boss!.hp = l.boss!.maxHp * 0.66; phase(g, l, 2); }
  if (ph === 3) { l.boss!.hp = l.boss!.maxHp * 0.33; phase(g, l, 3); }
  if (q.has('architectpulse')) {
    if (s.phase !== 3) phase(g, l, 3);
    for (const e of l.cores) if (e?.active) g.enemies.kill(e);
    s.core = 3; l.boss!.under = false; l.boss!.hp = l.boss!.maxHp * 0.1; desperation(g, l);
  }
  if (q.has('architectshot')) {
    save.firstten.hidden = true; // preview only, never persisted by test links
    const toast = document.getElementById('toast'); if (toast) toast.style.visibility = 'hidden';
    s.pause = 0; s.time = 6; s.phaseTime = 4; l.boss!.roarT = 0;
    s.pattern = Number(q.get('architectecho')) || 0;
    if (!q.has('architectpulse')) attack(g, l);
    s.layoutTime = 0.8;
    for (const d of s.dangers) if (d.kind) d.age = q.has('architectpulse') ? T.desperationWarn + 0.6 : 1;
    s.hp = l.boss!.hp / l.boss!.maxHp;
    g.paused = true; g.hud.showBanner('', '', 0.01); g.hud.toast('', 0.01);
    settings.portraitPops = false; portraits.clear(); syncWalls(g, l);
    g.playerPos.set(g.player.x, 0, g.player.z); g.lead.set(0, 0, 0);
    g.cam.cine = 0; g.cam.auto = 1; g.cam.frameTeam(-g.player.x, -g.player.z, 2.2);
    for (let i = 0; i < 80; i++) g.cam.update(g.playerPos, g.lead, 0.1);
  }
  if (q.has('architectending')) { s.active = false; s.done = true; g.mode = 'dead'; g.gameOverShown = true; }
}
