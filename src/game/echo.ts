import { ENEMIES, type EnemyDef } from '../data/enemies';
import {
  EchoRecorder,
  normalizeEchoes,
  readEchoes,
  samplePeriod,
  saveEcho,
  type EchoTape,
} from '../data/echoTape';
import { echoEn } from '../i18n/g8echo';
import { EchoHud, newEncounterView, type EncounterView } from '../ui/echoHud';
import { Team } from './bullets';
import type { Enemy } from './enemies';
import type { Game } from './game';
import type { Hero } from './hero';
import { saveLock } from './save';
import { beamReach } from './systems/enemyFamilies';
import { customArenaActive } from './systems/editor';
import { timeBarrier } from './systems/time';
import { trialActive } from './systems/trials';
import { clockStage, TimeLoop } from './timeloop';

const mirror: EnemyDef = {
  ...ENEMIES.mirror_prism,
  name: echoEn['echo.name'],
  behavior: 'chase',
  hp: 520,
  speed: 0,
  contactDamage: 0,
  knockbackResist: 1,
  radius: 0.65,
  miniboss: true,
};
export const echoTuning = { arrival: 12, windup: 0.95, reward: 6 };
const eligible = (g: Game) =>
  g.authority &&
  (g.runMode === 'standard' || g.runMode === 'endless') &&
  !g.race &&
  !g.pvp &&
  !g.versus &&
  !g.onboarding.training &&
  !trialActive(g) &&
  !customArenaActive(g);

type ClockCheckpoint = ReturnType<TimeLoop['checkpoint']>;
type EchoNet = EncounterView & {
  uid: number;
  ox?: number;
  oz?: number;
  age: number;
  arm: number;
  bossHp?: number;
  tape?: EchoTape;
  checkpoint?: ClockCheckpoint;
};

export class EchoRuns {
  readonly clock = new TimeLoop();
  readonly view = newEncounterView('echo');
  readonly hud: EchoHud;
  wins = 0;
  private tape?: EchoTape;
  private body: Enemy | null = null;
  private uid = 0;
  private usedStage = 0;
  private queued = false;
  private recording = false;
  private recorder = new EchoRecorder();
  private sampleT = 0;
  private lastDash = 0;
  private playback = false;
  private age = 0;
  private cooldown = 0;
  private arm = 0;
  private warn = 0;
  private angle = 0;
  private reach = 0;
  private windX = 0;
  private windZ = 0;
  private moveFrame = -1;
  private dashT = 0;
  private remoteView: EchoNet | null = null;
  private checkpoint?: ClockCheckpoint;
  private recipients = new WeakMap<Hero, { step: number; attempt: number; kind: string }>();

  constructor(
    private g: Game,
    root: HTMLElement,
  ) {
    this.hud = new EchoHud(g, root);
    const sub = g.stageSub.bind(g);
    g.stageSub = (stage) =>
      eligible(g) && clockStage(g.seed, stage) ? echoEn['echo.brief'] : sub(stage);
    const load = g.loadStage.bind(g);
    g.loadStage = (stage) => {
      load(stage);
      this.clearStage();
      this.recording = !this.playback && eligible(g) && !saveLock.on;
      if (eligible(g) && !saveLock.on) {
        if (clockStage(g.seed, stage)) this.clock.start(g);
        else this.queued = !!this.tape && stage % 4 === 2 && this.usedStage !== stage;
      }
    };
    const boss = g.debugBoss.bind(g),
      skip = g.debugSkipToBoss.bind(g);
    g.debugBoss = (options) => {
      if (options.now || options.mini) this.clock.cancel(g);
      boss(options);
    };
    g.debugSkipToBoss = () => {
      this.clock.cancel(g);
      skip();
    };
    const finish = g.endRun.bind(g);
    g.endRun = (quit) => {
      this.finish();
      finish(quit);
    };
    const title = g.goTitle.bind(g);
    g.goTitle = () => {
      this.finish();
      this.clearStage();
      title();
    };
    const down = g.onHeroDown.bind(g);
    g.onHeroDown = (h) => {
      if (!this.clock.down(h)) down(h);
    };
    const stand = g.lastStand.bind(g);
    g.lastStand = (h) => (this.clock.active && this.clock.view.attempt < 5 ? false : stand(h));
    const hurt = g.mvpHurt.bind(g);
    g.mvpHurt = (h, damage) => {
      if (damage > 0) this.clock.hurt(h);
      hurt(h, damage);
    };
    const bomb = g.tryBomb.bind(g),
      ult = g.tryUlt.bind(g),
      rewind = g.requestRewind.bind(g);
    g.tryBomb = (h) => {
      if (!this.clock.active) bomb(h);
    };
    g.tryUlt = (h) => {
      if (!this.clock.active) ult(h);
    };
    g.requestRewind = (h) => {
      if (!this.clock.active) rewind(h);
    };
    const render = g.render.bind(g);
    g.render = (alpha, dt) => {
      const view = this.current;
      if (view || this.hud.visible) this.hud.draw(view, dt);
      render(alpha, dt);
    };
  }
  get current() {
    if (!this.g.authority) return this.remoteView;
    return this.clock.active ? this.clock.view : this.body ? this.view : null;
  }
  private clearStage() {
    this.body = null;
    this.uid = 0;
    this.queued = false;
    this.recipients = new WeakMap();
    this.checkpoint = undefined;
    this.remoteView = null;
    this.clock.reset();
    this.hud.reset();
  }
  reset() {
    this.finish();
    this.clearStage();
    // The replay recorder makes a fresh header before startRun and fills its initial checksum afterwards.
    // Keep the opponent on that header so playing an exported run uses its original rival on any profile.
    const replay = (
      window as Window & { replay?: { export(): { header?: Record<string, unknown> } } }
    ).replay;
    const header = this.g.authority && !saveLock.on ? replay?.export().header : undefined;
    this.playback = !!header?.initial || header?.initialRandom !== undefined;
    this.tape = this.playback
      ? normalizeEchoes([header?.mirrorEcho])[0]
      : this.g.authority && !saveLock.on
        ? readEchoes()[0]
        : undefined;
    if (header && !this.playback && this.tape) header.mirrorEcho = this.tape;
    this.usedStage = this.wins = this.sampleT = this.lastDash = 0;
    this.recorder.clear();
  }
  private finish() {
    if (!this.recording) return;
    this.recording = false;
    if (!eligible(this.g) || saveLock.on) return;
    const tape = this.recorder.finish(this.g.hero, this.g.level);
    if (tape) saveEcho(tape);
  }
  private sample(dt: number) {
    const g = this.g,
      p = g.player;
    if (!this.recording || p.dead || (this.sampleT -= dt) > 0) return;
    this.sampleT += samplePeriod;
    const target = g.nearestEnemy(p.x, p.z, 20);
    const dx = target ? target.x - p.x : p.aim.x,
      dz = target ? target.z - p.z : p.aim.z;
    const len = Math.hypot(dx, dz) || 1;
    this.recorder.sample(
      (p.vel.x * dx + p.vel.z * dz) / len,
      (p.vel.z * dx - p.vel.x * dz) / len,
      target ? len : Number.isFinite(p.aimDist) ? p.aimDist : 9,
      this.lastDash !== p.dashSerial,
    );
    this.lastDash = p.dashSerial;
  }
  /** QA uses the actual equipped gear, including items granted by the test link. No demo tape is persisted. */
  preview(kind: 'echo' | 'clock') {
    const g = this.g;
    if (!eligible(g)) return;
    this.recording = false;
    this.queued = false;
    if (kind === 'clock') {
      this.clock.start(g);
      return;
    }
    const rec = new EchoRecorder();
    for (let i = 0; i < 32; i++) rec.sample(0, i < 16 ? 3 : -3, 7, i === 7 || i === 21);
    this.tape = rec.finish(g.hero, g.level)!;
    this.spawn();
  }
  private spawn() {
    const g = this.g,
      p = g.player;
    if (!this.tape || this.body) return;
    let x = p.x,
      z = p.z,
      found = false;
    for (let i = 0; i < 16; i++) {
      const a = (i + 1) * 2.4;
      x = p.x + Math.sin(a) * 7;
      z = p.z + Math.cos(a) * 7;
      if (
        Math.max(Math.abs(x), Math.abs(z)) >= g.arena.halfSize - 1 ||
        g.walls.hitCircle(x, z, 0.8)
      )
        continue;
      found = true;
      break;
    }
    if (!found) return;
    this.body = g.enemies.spawn(mirror, x, z, {
      instant: true,
      hpMul: (1 + 0.45 * (g.stage - 1)) * (1 + 0.45 * (g.heroes.length - 1)),
    });
    this.body.scale = 0; // The hero rig supplies the body. Radius and targetability are independent.
    this.body.under = true;
    this.uid = this.body.uid;
    this.age = this.warn = this.arm = this.dashT = 0;
    this.moveFrame = -1;
    this.cooldown = 2.8;
    this.usedStage = g.stage;
    this.queued = false;
    Object.assign(this.view, newEncounterView('echo'), {
      stage: g.stage,
      hero: this.tape.hero,
      ghost: true,
      x,
      z,
    });
    this.showArm();
    timeBarrier(g);
    g.vfx.ring(x, z, 0.75, 2, '#73eff7', 0.8);
    g.vfx.sound('mirrorCopy', x, z);
  }
  private showArm() {
    const a = this.tape!.arms[this.arm];
    this.view.weapon = a.id;
    this.view.special = a.special;
    this.view.rank = a.level;
  }
  private fight(dt: number) {
    const g = this.g,
      e = this.body!,
      tape = this.tape!,
      v = this.view;
    if (!e.active || e.uid !== this.uid) {
      this.body = null;
      return;
    }
    let target = g.hero,
      best = Infinity;
    for (const h of g.heroes) {
      if (h.left || h.player.dead) continue;
      const d = Math.hypot(h.player.x - e.x, h.player.z - e.z);
      if (d < best) {
        best = d;
        target = h;
      }
    }
    if (!Number.isFinite(best)) return;
    const p = target.player,
      nx = (p.x - e.x) / (best || 1),
      nz = (p.z - e.z) / (best || 1);
    this.age += dt;
    v.intro = this.age < 2.6;
    e.under = v.intro;
    v.hp = Math.round((100 * e.hp) / e.maxHp);
    if (v.intro || e.frozen > 0) return;
    const a = tape.arms[this.arm];
    if (this.warn > 0) {
      this.warn -= dt;
      if (this.warn <= 0) {
        if (a.attack === 'beam') {
          const dx = Math.sin(this.angle),
            dz = Math.cos(this.angle);
          for (const h of g.heroes) {
            if (h.left || h.player.dead) continue;
            const x = h.player.x - this.windX,
              z = h.player.z - this.windZ;
            const along = x * dx + z * dz;
            if (
              along > 0 &&
              along < this.reach &&
              Math.abs(x * dz - z * dx) < h.player.radius + 0.25
            )
              g.hurtHero(h, a.damage, this.windX, this.windZ, e, mirror.name);
          }
          for (let d = 0.5; d < this.reach; d += 0.8)
            g.vfx.star(this.windX + dx * d, 1, this.windZ + dz * d, 0.65, '#ff3df0', 0.16);
        } else if (a.attack === 'burst') {
          for (let i = 0; i < a.shots; i++) {
            const dir = this.angle + (i - (a.shots - 1) / 2) * 0.16;
            g.bullets.spawn({
              x: this.windX,
              z: this.windZ,
              dirX: Math.sin(dir),
              dirZ: Math.cos(dir),
              team: Team.Enemy,
              speed: a.speed,
              knockback: 3,
              damage: a.damage,
              life: 2.2,
              radius: 0.23,
              color: '#ff3df0',
              width: 0.48,
              length: 0.8,
            });
          }
          g.vfx.sound('enemyShoot', this.windX, this.windZ);
        }
        this.cooldown = a.interval;
        this.arm = (this.arm + 1) % tape.arms.length;
      }
    } else if ((this.cooldown -= dt) <= 0) {
      this.showArm();
      this.angle = Math.atan2(nx, nz);
      this.warn = echoTuning.windup;
      this.windX = e.x;
      this.windZ = e.z;
      g.vfx.sound('telegraph', e.x, e.z);
      if (a.attack === 'burst' || a.attack === 'beam') {
        this.reach = beamReach(
          e.x,
          e.z,
          nx,
          nz,
          a.attack === 'beam' ? a.range : 5,
          g.arena.colliders,
        );
        g.vfx.star(e.x, 1.15, e.z, 1.6, '#ffcd75', this.warn);
        const lanes = a.attack === 'beam' ? 1 : a.shots;
        for (let i = 0; i < lanes; i++) {
          const dir = this.angle + (i - (lanes - 1) / 2) * 0.16;
          for (let d = 0.5; d < this.reach; d += 1.1)
            g.vfx.ring(
              e.x + Math.sin(dir) * d,
              e.z + Math.cos(dir) * d,
              a.attack === 'beam' ? 0.55 : 0.28,
              0,
              '#ef7d57',
              this.warn,
            );
        }
      } else {
        const x = a.attack === 'pulse' ? e.x : p.x,
          z = a.attack === 'pulse' ? e.z : p.z;
        g.strikes.push({
          x,
          z,
          r: a.radius,
          t: this.warn,
          dmg: a.damage,
          cause: echoEn['echo.name'],
        });
        g.vfx.zone(x, z, a.radius, this.warn);
      }
    } else {
      const i = (Math.floor(this.age / samplePeriod) % (tape.moves.length / 4)) * 4;
      if (i !== this.moveFrame && tape.moves[i + 3]) {
        this.dashT = 0.16;
        g.vfx.ring(e.x, e.z, 0.5, 2, '#73eff7', 0.35);
      }
      this.moveFrame = i;
      this.dashT = Math.max(0, this.dashT - dt);
      const approach = Math.max(
        -5,
        Math.min(6, tape.moves[i] * 0.42 + (best - tape.moves[i + 2]) * 0.9),
      );
      const side = tape.moves[i + 1] * 0.62;
      const step = dt * (this.dashT > 0 ? 3 : 1) * (e.slowT > 0 ? 1 - e.slowAmt : 1);
      const limit = g.arena.halfSize - e.radius;
      e.x = Math.max(-limit, Math.min(limit, e.x + (nx * approach - nz * side) * step));
      e.z = Math.max(-limit, Math.min(limit, e.z + (nz * approach + nx * side) * step));
      g.walls.resolveCircle(e, e.radius);
    }
    v.x = e.x;
    v.z = e.z;
    v.facing = this.warn > 0 ? this.angle : Math.atan2(nx, nz);
    v.dash = this.dashT > 0;
  }
  killed(e: Enemy) {
    if (e !== this.body || e.uid !== this.uid) return;
    this.body = null;
    this.wins++;
    for (const h of this.g.heroes) if (!h.left) h.gold += echoTuning.reward;
    this.g.vfx.toast(echoEn['echo.reward'], 3);
    timeBarrier(this.g);
  }
  step(dt: number, control: boolean) {
    const g = this.g;
    if (g.mode !== 'fight' || !g.authority) return false;
    if (this.remoteView) {
      const net = this.remoteView;
      this.remoteView = null;
      if (net.stage === g.stage && net.kind === 'clock' && this.checkpoint)
        this.clock.promote(g, net, this.checkpoint, net.age);
      else if (net.stage === g.stage && net.kind === 'echo' && this.tape) {
        // Migration rebuilds pool entries and assigns fresh UIDs. Match the mirror chassis by max life and position.
        let best = Infinity;
        for (const foe of g.enemies.list)
          if (foe.active && foe.def.id === mirror.id && foe.maxHp === net.bossHp) {
            const d = Math.hypot(foe.x - net.x, foe.z - net.z);
            if (d < best) {
              this.body = foe;
              best = d;
            }
          }
        if (this.body) {
          this.body.def = mirror;
          this.body.scale = 0;
          this.uid = this.body.uid;
          this.usedStage = g.stage;
          this.age = net.age;
          this.arm = net.arm % this.tape.arms.length;
          this.warn = 0;
          this.cooldown = echoTuning.windup;
          this.queued = false;
          this.view.stage = net.stage;
          this.view.hero = net.hero;
          this.view.ghost = true;
          this.view.x = this.body.x;
          this.view.z = this.body.z;
          this.view.facing = net.facing;
          this.showArm();
        }
      }
    }
    this.sample(dt);
    if (this.clock.active) return this.clock.step(g, dt, control);
    if (this.queued && g.director.time >= echoTuning.arrival && !g.director.bossSpawned)
      this.spawn();
    if (this.body) this.fight(dt);
    return false;
  }
  snapshot(h: Hero) {
    const v = this.current;
    if (!v) return null;
    const last = this.recipients.get(h);
    const full =
      !last ||
      this.g.stepN - last.step >= 120 ||
      last.attempt !== v.attempt ||
      last.kind !== v.kind;
    if (full) this.recipients.set(h, { step: this.g.stepN, attempt: v.attempt, kind: v.kind });
    const origin = this.clock.active && this.clock.origin(h);
    return {
      ...v,
      age: Math.round((this.clock.active ? this.clock.elapsed : this.age) * 10) / 10,
      arm: this.arm,
      ...(this.body && { bossHp: this.body.maxHp }),
      ...(full &&
        (this.clock.active ? { checkpoint: this.clock.checkpoint() } : { tape: this.tape })),
      ...(origin && { ox: origin.x, oz: origin.z }),
      uid: this.body ? this.uid : 0,
      x: Math.round(v.x * 20) / 20,
      z: Math.round(v.z * 20) / 20,
      facing: Math.round(v.facing * 20) / 20,
    };
  }
  receive(raw: unknown) {
    const net = raw as EchoNet | undefined;
    if (!net || net.stage !== this.g.stage || (net.kind !== 'echo' && net.kind !== 'clock')) {
      this.remoteView = null;
      return;
    }
    if (net.checkpoint) this.checkpoint = net.checkpoint;
    if (net.tape) this.tape = normalizeEchoes([net.tape])[0];
    if (net.kind === 'echo') {
      const enemy = this.g.netEnemies.get(net.uid);
      if (enemy) enemy.scale = 0;
    } else if (
      net.attempt > 1 &&
      this.remoteView?.kind === 'clock' &&
      this.remoteView.attempt !== net.attempt
    ) {
      const g = this.g;
      if (typeof net.ox === 'number' && typeof net.oz === 'number')
        g.player.teleport(net.ox, net.oz);
      g.enemies.zones.length = 0;
    }
    this.remoteView = net;
  }
}
