/**
 * Boss fights: phase changes, the new boss moves' gameplay (shockwaves, burning
 * ground, hives, swarm walls), mid-stage mini-bosses, the entrance cinematic and
 * syncing all of it to clients. Brains are in src/game/bosses.ts, drawing in
 * src/game/bossField.ts, the cinematic in src/game/bossIntro.ts.
 * These are Game methods (`this` is the Game), installed on the class as fields.
 */
import type { Game } from '../game';
import { ENEMIES, miniBossForStage } from '../../data/enemies';
import { music } from '../../audio/music';
import { sfx } from '../../audio/sfx';
import { Team } from '../bullets';
import { access, settings } from '../settings';
import { PHASE_LINES, bossMoveTuning, bossTuning, phaseGate, startIntro, startPhase, type BossApi } from '../bosses';
import type { BossNet } from '../bossField';
import { introTuning } from '../bossIntro';
import type { Enemy } from '../enemies';
import { smashCover } from '../coverBreak';
import { bossVoiceCue } from '../../audio/voices';
import { applyBossLaneNet, bossLaneHud, bossLaneNet, remixArrival, renderBossLane, titanStep, updateBossLane } from './bossLane';

/** Mid-stage mini-bosses. */
export const miniTuning = {
  fromStage: 2,
  at: 0.5, // fraction of the stage timer when one arrives
  warn: 2.5, // seconds of warning before it lands
  hp: 0.6, // x the stage's boss HP multiplier (on a def with ~30% of its boss's HP: ~18% of a boss)
};

/** A sound if this build has it (the recorded pack may add named cues), else a fallback. */
function cue(name: string, fallback: string): string {
  return typeof (sfx as unknown as Record<string, unknown>)[name] === 'function' ? name : fallback;
}

/** Tell the music which boss phase is playing (0 = no boss). The music module may not support it yet. */
function musicPhase(n: number): void {
  (music as unknown as { setBossPhase?: (n: number) => void }).setBossPhase?.(n);
}

export function makeBossApi(this: Game): BossApi {
  const T = bossMoveTuning;
  return {
    shockwave: (e, x, z, delay) => {
      if (this.bossField.waves.length >= 8) return;
      this.bossField.waves.push({ x, z, r: e.radius * 1.4, delay, dmg: T.shockDamage * e.dmgMul, hit: 0, cause: `${e.def.name}'s shockwave` });
      if (delay <= 0) this.vfx.ring(x, z, e.radius, 3, '#ffcd75', 0.35);
    },
    rampage: (e, fire) => {
      // Cover it charges into really breaks (src/game/coverBreak.ts); crates and pillars take a hit too.
      smashCover(this, e.x, e.z, e.radius);
      const prop = this.toys.propAt(e.x, e.z, e.radius * 0.9);
      if (prop >= 0) this.damageProp(this.toys.props[prop], 1e6, this.hero.index, e.lungeX, e.lungeZ);
      // Smash props it runs through: debris, shake, and barrels go up.
      if (this.walls.hitCircle(e.x, e.z, e.radius * 0.9) && this.stepN % 4 === 0) {
        this.vfx.burst(e.x + e.lungeX * e.radius, 0.8, e.z + e.lungeZ * e.radius, { count: 10, color: '#94b0c2', color2: '#566c86', speed: [4, 10], size: [0.2, 0.45], life: [0.4, 0.8], up: 6, gravity: 16 });
        this.vfx.shake(e.x, e.z, 0.35);
        if (this.stepN % 12 === 0) this.vfx.sound(cue('coverBreak', 'impact'), e.x, e.z, 2);
      }
      this.barrels.igniteNear(e.x, e.z, e.radius + 0.6, 0);
      // Scorched earth: charges leave burning ground (more often from phase 2; Inferno all the time).
      if (fire && this.stepN % (e.def.remix?.fireEvery ?? (e.phase >= 2 ? 15 : 24)) === 0) this.bossApi.firePatch(e, e.x - e.lungeX * e.radius, e.z - e.lungeZ * e.radius);
    },
    firePatch: (e, x, z) => {
      const f = this.bossField.fires;
      if (f.length >= 24) f.shift();
      f.push({ x, z, r: 1.4, t: T.fireLife + (e.phase >= 3 ? 2 : 0), dmg: T.fireDamage * e.dmgMul, tick: 0.5 });
      this.vfx.scar(x, z, 1.2, '#5d275d', T.fireLife + 4);
    },
    shot: (e, dx, dz, speed, damage, color, life, radius) => {
      this.bullets.spawn({
        x: e.x + dx * (e.radius + 0.2),
        z: e.z + dz * (e.radius + 0.2),
        dirX: dx,
        dirZ: dz,
        speed,
        life,
        radius,
        damage: damage * e.dmgMul,
        knockback: 5,
        team: Team.Enemy,
        color: access.colorblind ? '#ffffff' : color,
        width: radius * 1.8,
        length: radius * 1.8,
      });
    },
    plantHive: (_e, x, z) => {
      if (!this.bossApi.open(x, z, 1)) return false;
      this.bossField.pendingHives.push({ x, z, t: 1 });
      this.vfx.zone(x, z, 1.3, 1);
      return true;
    },
    hiveCount: () => this.enemies.countOf('hive') + this.bossField.pendingHives.length,
    swarmWall: (e, tx, tz) => {
      const a = this.rng.range(0, Math.PI * 2);
      const dx = Math.cos(a);
      const dz = Math.sin(a);
      const cx = tx - dx * 13;
      const cz = tz - dz * 13;
      const gap = this.rng.range(-7, 7);
      this.bossField.pendingWalls.push({ cx, cz, dx, dz, gap, t: 0.9, dmg: T.wallDamage, src: e });
      // Telegraph the line the wall starts from, and where the gap is.
      for (let o = -14; o <= 14; o += 7) this.vfx.zone(cx - dz * o, cz + dx * o, 2.2, 0.9);
      this.vfx.ring(cx - dz * gap, cz + dx * gap, 1, 5, '#a7f070', 0.9);
      this.vfx.toast('SWARM WALL! FIND THE GAP');
      this.vfx.sound(cue('bossRoar', 'elite'), e.x, e.z);
    },
    open: (x, z, r) => {
      const lim = this.arena.halfSize - 2;
      return Math.abs(x) < lim && Math.abs(z) < lim && !this.walls.hitCircle(x, z, r);
    },
    titan: (e, dt) => titanStep.call(this, e, dt), // src/game/systems/bossLane.ts
  };
}

/** Game.damage hook: clamp HP at a phase threshold and start the phase change. */
export function bossHpGate(this: Game, e: Enemy): void {
  if (e.def.behavior === 'titan') return; // the Titan's phases follow its weak points (systems/bossLane.ts)
  const phase = phaseGate(e);
  if (!phase) return;
  startPhase(e, phase);
  const lines = e.def.remixLines ? ['', ...e.def.remixLines] : (PHASE_LINES[e.def.behavior] ?? []);
  const mini = !!e.def.miniboss;
  const last = phase > (e.def.phases?.length ?? 0);
  this.vfx.banner(mini ? `${e.def.name.toUpperCase()} ENRAGED!` : last ? 'FINAL PHASE!' : `PHASE ${phase}!`, mini ? 'LOOK OUT' : (lines[phase - 1] ?? ''), mini ? 1.4 : 2);
  this.vfx.sound(cue('bossPhase', 'boss'), e.x, e.z);
  const voice = bossVoiceCue(e.def, 'phase'); // own roar, choir stab, phase line (src/audio/voices.ts)
  this.vfx.sound(voice || cue('bossRoar', 'bossWindup'), voice ? NaN : e.x, voice ? NaN : e.z, 0.7);
  this.vfx.shake(NaN, NaN, mini ? 0.5 : 0.9);
  if (!mini) this.vfx.flash(0.35);
  this.vfx.ring(e.x, e.z, e.radius, 10, '#ffcd75', 0.6);
  this.vfx.ring(e.x, e.z, e.radius, 6, '#ff3d5e', 0.45);
  this.vfx.burst(e.x, 1 + e.hopY, e.z, { count: 30, color: '#ffcd75', color2: e.def.bodyColor, speed: [4, 11], size: [0.2, 0.4], life: [0.4, 0.8], up: 6, gravity: 12 });
  this.juice.freeze(0.12);
  // A breather: the roar blows away enemy bullets near the boss.
  for (let i = 0; i < this.bullets.count; i++) {
    if (this.bullets.team[i] === Team.Enemy && Math.hypot(this.bullets.x[i] - e.x, this.bullets.z[i] - e.z) < 9) this.bullets.kill(i--);
  }
}

/** Host: the boss just spawned. Play its entrance (if enabled) while it idles. */
export function startBossIntro(this: Game, e: Enemy): void {
  const on = settings.bossIntros !== false;
  startIntro(e, on ? bossTuning.intro : 0.6);
  this.introUid = e.uid;
  this.introLeft = introTuning.length;
  const voice = bossVoiceCue(e.def, 'intro'); // own roar, then the intro line (src/audio/voices.ts)
  this.vfx.sound(voice || cue('bossRoar', 'boss'), voice ? NaN : e.x, voice ? NaN : e.z);
  this.vfx.shake(NaN, NaN, 0.6);
  if (on) {
    this.slowMoT = Math.max(this.slowMoT, 0.9);
    this.bossIntro.start(e.uid, e.def.name, e.def.title ?? '', e.def.bodyColor);
  } else this.hud.showBanner('WARNING!', `${e.def.name.toUpperCase()} APPROACHES`, 2.2);
  remixArrival.call(this, e); // rematches say so (systems/bossLane.ts)
}

/** Local skip (any machine): the host also cuts the slow motion and the boss's idle short. */
export function skipBossIntro(this: Game): void {
  if (!this.authority) return;
  this.slowMoT = 0;
  if (this.boss && this.boss.uid === this.introUid && this.boss.roarT > 0.3 && this.boss.phase === 1) this.boss.roarT = 0.3;
  this.introLeft = 0;
}

/** Host step: boss moves' gameplay, mini-bosses. */
export function updateBossFight(this: Game, dt: number): void {
  const f = this.bossField;
  const T = bossMoveTuning;
  // Shockwaves: hurt heroes the ring passes over, unless they dash through.
  for (let i = f.waves.length - 1; i >= 0; i--) {
    const w = f.waves[i];
    if (w.delay > 0) {
      w.delay -= dt;
      if (w.delay <= 0) this.vfx.ring(w.x, w.z, 1, 3, '#ffcd75', 0.35);
      continue;
    }
    w.r += T.shockSpeed * dt;
    if (w.r > T.shockMax) {
      f.waves.splice(i, 1);
      continue;
    }
    for (const h of this.aliveHeroes) {
      const p = h.player;
      const bit = 1 << h.index;
      if (w.hit & bit || p.dashing || p.invuln > 0) continue;
      if (Math.abs(Math.hypot(p.x - w.x, p.z - w.z) - w.r) < T.shockBand + p.radius * 0.5) {
        w.hit |= bit;
        this.hurtHero(h, w.dmg, w.x, w.z, null, w.cause);
      }
    }
  }
  // Burning ground.
  for (let i = f.fires.length - 1; i >= 0; i--) {
    const fp = f.fires[i];
    fp.t -= dt;
    if (fp.t <= 0) {
      f.fires.splice(i, 1);
      continue;
    }
    if ((fp.tick -= dt) > 0) continue;
    fp.tick = 0.5;
    for (const h of this.aliveHeroes) {
      const p = h.player;
      if (Math.hypot(p.x - fp.x, p.z - fp.z) < fp.r + p.radius * 0.3) this.hurtHero(h, fp.dmg, fp.x, fp.z, null, 'Burning ground');
    }
  }
  // Hives land after their telegraph and hatch Swarmers until destroyed.
  for (let i = f.pendingHives.length - 1; i >= 0; i--) {
    const h = f.pendingHives[i];
    if ((h.t -= dt) > 0) continue;
    f.pendingHives.splice(i, 1);
    if (this.enemies.activeCount >= 480 || this.walls.hitCircle(h.x, h.z, 0.9)) continue;
    const hive = this.enemies.spawn(ENEMIES.hive, h.x, h.z, this.spawnOpts({ hpMul: this.director.hpMul, instant: true }));
    hive.timerA = 3.5; // first hatch
    hive.squash(10);
    this.vfx.burst(h.x, 0.5, h.z, { count: 16, color: '#ffcd75', color2: '#ef7d57', speed: [3, 7], size: [0.15, 0.3], life: [0.3, 0.6], up: 5, gravity: 14 });
    this.vfx.ring(h.x, h.z, 0.8, 3, '#ffcd75', 0.3);
    this.vfx.sound('spawn', h.x, h.z);
  }
  // Swarm walls: a line of stingers sweeps across with one gap.
  for (let i = f.pendingWalls.length - 1; i >= 0; i--) {
    const w = f.pendingWalls[i];
    if ((w.t -= dt) > 0) continue;
    f.pendingWalls.splice(i, 1);
    const lim = this.arena.halfSize - 1;
    for (let o = -17; o <= 17; o += 0.9) {
      if (Math.abs(o - w.gap) < 2.3) continue;
      const x = w.cx - w.dz * o;
      const z = w.cz + w.dx * o;
      if (Math.abs(x) > lim || Math.abs(z) > lim) continue;
      this.bullets.spawn({
        x,
        z,
        dirX: w.dx,
        dirZ: w.dz,
        speed: T.wallSpeed,
        life: 5,
        radius: 0.42,
        damage: w.dmg * w.src.dmgMul,
        knockback: 6,
        team: Team.Enemy,
        color: access.colorblind ? '#ffffff' : '#ffd23f',
        width: 0.8,
        length: 0.8,
      });
    }
    this.vfx.sound('wave', w.cx, w.cz);
  }
  this.updateMiniBoss(dt);
  updateBossLane.call(this, dt); // rematches, the Titan, the boss duel (systems/bossLane.ts)
  // Test links: force a phase (`&phase=N`).
  const b = this.boss;
  if (f.debugPhase > (b?.phase ?? 99) && b!.roarT <= 0 && b!.def.phases && b!.def.behavior !== 'titan') {
    b!.hp = Math.min(b!.hp, b!.maxHp * (b!.def.phases[b!.phase - 1] ?? 0));
    this.bossHpGate(b!);
  }
}

/** Test links: `&miniboss` brings this stage's mini-boss in now; `&bossnow` the stage boss. */
export function debugBoss(this: Game, o: { mini?: boolean; now?: boolean; phase?: number }): void {
  if (!this.authority || this.mode !== 'fight') return;
  if (o.phase) this.bossField.debugPhase = o.phase;
  if (o.now) this.director.time = Math.max(this.director.time, this.director.duration);
  if (o.mini) {
    this.bossField.miniStage = 0;
    this.director.time = Math.max(this.director.time, this.director.duration * miniTuning.at);
    if (this.stage < miniTuning.fromStage) {
      // Stage 1 has no mini-boss: bring one anyway.
      const def = miniBossForStage(2);
      const p = this.hero.player;
      this.bossField.miniStage = this.stage;
      this.bossField.miniWarn = { def, x: p.x + 9, z: p.z - 3, t: 0.4 };
    }
  }
}

/** Around the middle of each stage from stage 2, a mini-boss lands after a warning. */
export function updateMiniBoss(this: Game, dt: number): void {
  const f = this.bossField;
  const d = this.director;
  if (f.mini && !f.mini.active) f.mini = null;
  if (f.miniWarn) {
    const w = f.miniWarn;
    if ((w.t -= dt) > 0) return;
    f.miniWarn = null;
    if (this.mode !== 'fight' || d.bossSpawned) return;
    f.mini = this.enemies.spawn(w.def, w.x, w.z, this.spawnOpts({ hpMul: d.bossHpMul * miniTuning.hp }));
    f.mini.squash(12);
    this.vfx.sound(cue('bossRoar', 'boss'), w.x, w.z, 1.3);
    this.vfx.ring(w.x, w.z, 1, 8, w.def.bodyColor, 0.5);
    this.vfx.shake(w.x, w.z, 0.5);
    return;
  }
  const ok = this.mode === 'fight' && !this.pvp && this.runMode !== 'bossrush' && this.stage >= miniTuning.fromStage && !d.bossSpawned && f.miniStage !== this.stage;
  if (!ok || d.time < d.duration * miniTuning.at || d.time > d.duration - 30) return;
  const def = miniBossForStage(this.stage);
  const pos = this.ringPoint(10, 14, def.radius + 0.6);
  if (!pos) return; // try again next step
  f.miniStage = this.stage;
  f.miniWarn = { def, x: pos.x, z: pos.z, t: miniTuning.warn };
  this.vfx.banner('MINI-BOSS!', `${def.name.toUpperCase()} INCOMING`, 2);
  this.vfx.zone(pos.x, pos.z, def.radius * 1.8, miniTuning.warn);
  this.vfx.sound('elite', NaN, NaN);
  this.vfx.shake(NaN, NaN, 0.3);
}

/** Host: boss extras for the snapshot. */
export function bossNet(this: Game): BossNet {
  return { ...this.bossField.pack(this.bossField.bossesIn(this.enemies.list), (e) => (e.uid === this.introUid ? Math.max(0, this.introLeft) : 0)), ...bossLaneNet.call(this) };
}

/** Client: mirror the host's boss state, and start the entrance when the host does. */
export function applyBossNet(this: Game, n: BossNet | undefined): void {
  if (!n) return;
  this.bossField.unpack(n, (uid) => this.netEnemies.get(uid));
  applyBossLaneNet.call(this, n); // the Titan and the boss duel
  for (const [uid, , , , intro] of n.b) {
    if (intro < 0.3 || this.bossIntro.uid === uid) continue;
    const e = this.netEnemies.get(uid);
    if (!e || !e.def.boss) continue;
    this.bossIntro.uid = uid;
    if (settings.bossIntros !== false) this.bossIntro.start(uid, e.def.name, e.def.title ?? '', e.def.bodyColor, Math.max(0, introTuning.length - intro));
    else this.hud.showBanner('WARNING!', `${e.def.name.toUpperCase()} APPROACHES`, 2.2);
  }
}

/** Every machine, every frame: draw the boss arena, steer the intro camera, tell the music the phase. */
export function renderBossFight(this: Game, frameDt: number, paused: boolean): void {
  const f = this.bossField;
  if (this.role === 'client' && !paused) f.advance(frameDt);
  if (this.introLeft > 0 && !paused) this.introLeft -= frameDt; // entrance signal for clients (real time)
  f.render(this.enemies.list, this.animTime);
  renderBossLane.call(this, frameDt, paused); // the Titan, the ring of fire
  // Entrance camera: pan toward the boss, zoom in a little.
  const boss = this.role === 'client' ? f.bossesIn(this.enemies.list).find((e) => e.def.boss) : this.boss;
  if (this.bossIntro.active && (this.mode !== 'fight' || !boss?.active)) this.bossIntro.stop(this.cam.camera);
  if (this.bossIntro.active && boss) this.bossIntro.update(paused ? 0 : frameDt, this.playerPos, boss, this.lead, this.cam.camera);
  // Music: boss phase changes (0 when no boss).
  const ph = boss && boss.active && boss.def.boss ? Math.min(3, boss.phase) : 0; // the Titan's core phase (4) plays as the last
  if (ph !== f.musicPhase) {
    f.musicPhase = ph;
    musicPhase(ph);
  }
}

export type BossBar = { name: string; hp01: number; ticks?: number[]; phase?: number; mini?: boolean };

/** The HUD boss bar: the stage boss, else the mini-boss, with phase ticks. */
export function bossHud(this: Game, boss: { name: string; hp01: number } | null): BossBar | null {
  return bossLaneHud.call(this, bossBar.call(this, boss)); // Titan weak points, duel tag (systems/bossLane.ts)
}

function bossBar(this: Game, boss: { name: string; hp01: number } | null): BossBar | null {
  const f = this.bossField;
  const client = this.role === 'client';
  if (boss) {
    const e = client ? f.bossesIn(this.enemies.list).find((x) => x.def.boss) : this.boss;
    return { ...boss, ticks: e?.def.phases, phase: e?.phase ?? 1 };
  }
  if (client) {
    const m = f.netMini;
    return m ? { name: m[0], hp01: m[1], phase: m[2], ticks: ENEMIES[m[3]]?.phases, mini: true } : null;
  }
  const m = f.mini && f.mini.active ? f.mini : null;
  return m ? { name: m.def.name, hp01: Math.max(0, m.hp / m.maxHp), phase: m.phase, ticks: m.def.phases, mini: true } : null;
}
