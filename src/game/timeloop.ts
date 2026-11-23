import { Rng } from '../core/rng';
import { echoEn } from '../i18n/g8echo';
import { newEncounterView } from '../ui/echoHud';
import type { Game } from './game';
import { spawnPattern } from './enemyBullets';
import { Shot } from '../data/patterns';
import type { Hero } from './hero';
import { timeBarrier } from './systems/time';

export const clockTuning = {
  seconds: 60,
  attempts: 5,
  warning: 1.2,
  spacing: 9,
  reward: 18,
  interval: 2.7,
};
const traceHz = 5;
const traceSize = (clockTuning.seconds * traceHz + 2) * 3;

/** The lattice covers the entire island. Time, position, size and travel direction never depend on input. */
export function clockScore(seed: number, stage: number) {
  const rng = new Rng(seed ^ Math.imul(stage, 0x79a21) ^ 0x74c7ef31);
  return Array.from({ length: 21 }, (_, beat) => ({
    at: 2 + beat * clockTuning.interval,
    x: rng.range(-4, 4),
    z: rng.range(-4, 4),
    radius: rng.range(2.45, 3.25),
    angle: rng.range(0, Math.PI * 2),
  }));
}
export function clockStage(seed: number, stage: number) {
  return stage >= 5 && stage % 4 === 1 && new Rng(seed ^ Math.imul(stage, 0x79a21)).chance(0.25);
}

function packTrack(path: Float32Array, count: number) {
  const packed = new Int16Array(count * 3);
  for (let i = 0; i < packed.length; i++)
    packed[i] = Math.round(path[i] * (i % 3 === 2 ? 100 : 16));
  return packed.buffer;
}
function unpackTrack(path: Float32Array, bytes: ArrayBuffer) {
  const packed = new Int16Array(bytes);
  const n = Math.min(packed.length, path.length);
  for (let i = 0; i < n; i++) path[i] = packed[i] / (i % 3 === 2 ? 100 : 16);
  return Math.floor(n / 3);
}

interface ClockEntry {
  trace: ArrayBuffer;
  seat: number;
  hp: number;
  x: number;
  z: number;
  charge: number;
  stamina: number;
  dashCd: number;
  phoenix: boolean;
  ult: number;
  style: number;
  parryCd: number;
}

class ClockTrack {
  readonly path = new Float32Array(traceSize);
  count = 0;
  readonly hp: number;
  readonly x: number;
  readonly z: number;
  readonly charge: number;
  readonly stamina: number;
  readonly dashCd: number;
  readonly phoenix: boolean;
  readonly ult: number;
  readonly style: number;
  readonly parryCd: number;
  constructor(h: Hero) {
    this.hp = h.player.hp;
    this.x = h.player.x;
    this.z = h.player.z;
    this.charge = h.bombCharge;
    this.stamina = h.player.dashStock;
    this.dashCd = h.player.dashCd;
    this.phoenix = h.phoenixUsed;
    this.ult = h.skill.ult;
    this.style = h.skill.style.points;
    this.parryCd = h.skill.parryCd;
    this.record(h);
  }
  record(h: Hero) {
    if (this.count * 3 >= traceSize) return;
    const i = this.count++ * 3,
      p = h.player;
    this.path[i] = p.x;
    this.path[i + 1] = p.z;
    this.path[i + 2] = Math.atan2(p.aim.x, p.aim.z);
  }
  restore(h: Hero) {
    const p = h.player;
    p.teleport(this.x, this.z);
    p.dead = false;
    p.hp = Math.max(1, this.hp);
    p.rig.root.visible = true;
    p.invuln = 1;
    p.dashStock = this.stamina;
    p.dashCd = this.dashCd;
    h.bombCharge = this.charge;
    h.bombT = -1;
    h.skill.ult = this.ult;
    h.phoenixUsed = this.phoenix;
    if (h.remote) {
      h.remote.x = this.x;
      h.remote.z = this.z;
    }
    h.skill.style.points = this.style;
    h.skill.parryT = h.skill.buffT = h.skill.dashScanT = 0;
    h.skill.parryCd = this.parryCd;
    h.reviveT = 0;
    this.count = 0;
    this.record(h);
  }
}

export class TimeLoop {
  readonly view = newEncounterView('clock');
  active = false;
  won = false;
  elapsed = 0;
  private wave = 0;
  private firing = -1;
  private score: ReturnType<typeof clockScore> = [];
  private tracks = new Map<Hero, ClockTrack>();
  private past = new Float32Array(traceSize);
  private pastCount = 0;
  private nextSample = 0;
  private lost: Hero | null = null;
  private blemish: Hero | null = null;
  private marks: { x: number; z: number }[] = [];
  private sparkT = 0;

  start(g: Game) {
    this.reset();
    this.active = true;
    this.score = clockScore(g.seed, g.stage);
    this.view.stage = g.stage;
    this.view.attempt = 1;
    this.view.intro = true;
    this.view.seconds = 60;
    for (const h of g.heroes) if (!h.left) this.tracks.set(h, new ClockTrack(h));
    this.clearHazards(g);
    g.damagedThisStage = false;
    timeBarrier(g);
  }
  cancel(g: Game) {
    if (!this.active) return;
    this.clearHazards(g);
    this.reset();
    timeBarrier(g);
  }
  reset() {
    this.active = this.won = this.view.ghost = false;
    this.firing = -1;
    this.elapsed = this.wave = this.pastCount = this.sparkT = 0;
    this.nextSample = 1 / traceHz;
    this.lost = this.blemish = null;
    this.tracks.clear();
    this.marks.length = 0;
  }
  checkpoint() {
    const party: ClockEntry[] = [];
    for (const [h, r] of this.tracks) {
      const { hp, x, z, charge, stamina, dashCd, phoenix, ult, style, parryCd } = r;
      party.push({
        trace: packTrack(r.path, r.count),
        seat: h.index,
        hp,
        x,
        z,
        charge,
        stamina,
        dashCd,
        phoenix,
        ult,
        style,
        parryCd,
      });
    }
    return { party, marks: this.marks.slice(), past: packTrack(this.past, this.pastCount) };
  }
  /** A promoted client has the island seed and the party's starting resources. Resume after the last
   * visible beat; skip any in-flight impact whose windup the new authority cannot reconstruct. */
  promote(
    g: Game,
    view: typeof this.view,
    checkpoint: ReturnType<TimeLoop['checkpoint']>,
    age: number,
  ) {
    const damaged = g.damagedThisStage;
    this.start(g);
    this.view.stage = view.stage;
    this.view.attempt = view.attempt;
    this.view.hero = view.hero;
    this.view.intro = view.intro;
    this.view.seconds = view.seconds;
    this.elapsed = age;
    this.wave = this.score.findIndex((w) => w.at > age);
    if (this.wave < 0) this.wave = this.score.length;
    g.damagedThisStage = damaged;
    this.marks = checkpoint.marks.slice(-4);
    for (const entry of checkpoint.party) {
      const h = g.heroes[entry.seat];
      const track = h && this.tracks.get(h);
      if (track) {
        const { trace, ...resources } = entry;
        Object.assign(track, resources);
        track.count = unpackTrack(track.path, trace);
        // Bridge the short interval between the periodic checkpoint and the last mirrored pose.
        while (track.count < Math.min(Math.floor(age * traceHz) + 1, traceSize / 3))
          track.record(h);
      }
    }
    this.nextSample = age + 1 / traceHz;
    this.pastCount = unpackTrack(this.past, checkpoint.past);
    this.view.ghost = this.pastCount > 0;
  }
  origin(h: Hero) {
    return this.tracks.get(h);
  }
  down(h: Hero) {
    if (!this.active || this.view.attempt >= clockTuning.attempts) return false;
    this.lost ??= h;
    return true;
  }
  hurt(h: Hero) {
    if (this.active) this.blemish ??= h;
  }
  private clearHazards(g: Game) {
    g.strikes.length = g.enemies.zones.length = 0;
    g.bullets.clear();
    g.enemies.clear();
    g.hash.clear();
    g.fx.clear();
    g.particles.clear();
  }
  private rewind(g: Game, h: Hero) {
    const track = this.tracks.get(h);
    if (track) {
      this.past.set(track.path);
      this.pastCount = track.count;
      this.view.hero = h.heroDef.id;
    }
    this.marks.push({ x: h.player.x, z: h.player.z });
    this.clearHazards(g);
    for (const [hero, record] of this.tracks) if (!hero.left) record.restore(hero);
    this.view.attempt++;
    this.firing = -1;
    this.elapsed = this.wave = this.sparkT = 0;
    this.nextSample = 1 / traceHz;
    this.lost = this.blemish = null;
    g.damagedThisStage = false;
    this.view.intro = true;
    this.view.seconds = 60;
    g.vfx.sound('portal', h.player.x, h.player.z);
    timeBarrier(g);
  }
  private warn(g: Game, wave: (typeof this.score)[number]) {
    // Every cell spawns on every pass. Only its cosmetic warning needs interest filtering.
    const edge = g.arena.halfSize;
    for (let ix = -6; ix <= 6; ix++)
      for (let iz = -6; iz <= 6; iz++) {
        const x = ix * clockTuning.spacing + wave.x,
          z = iz * clockTuning.spacing + wave.z;
        if (Math.abs(x) > edge || Math.abs(z) > edge) continue;
        let visible = false;
        for (const h of g.heroes)
          if (
            !h.left &&
            !h.player.dead &&
            (h.player.x - x) ** 2 + (h.player.z - z) ** 2 < 24 ** 2
          ) {
            visible = true;
            break;
          }
        g.strikes.push({
          x,
          z,
          r: wave.radius,
          t: clockTuning.warning,
          dmg: 19,
          cause: echoEn['echo.pulse'],
        });
        if (visible) g.vfx.zone(x, z, wave.radius, clockTuning.warning);
      }
    g.vfx.star(wave.x, 1, wave.z, 1.3, '#ffcd75', clockTuning.warning);
    g.vfx.sound('telegraph', wave.x, wave.z);
  }
  private pulses(g: Game, dt: number) {
    // Resolve the same circles the skilled pilot can see through g.strikes.
    // One impact cue per pulse avoids playing over a hundred explosion sounds at once.
    for (let i = g.strikes.length - 1; i >= 0; i--) {
      const s = g.strikes[i];
      if ((s.t -= dt) > 0) continue;
      for (const h of g.heroes) {
        if (h.left || h.player.dead) continue;
        const distance = Math.hypot(h.player.x - s.x, h.player.z - s.z);
        if (distance < s.r + h.player.radius * 0.6) g.hurtHero(h, s.dmg, s.x, s.z, null, s.cause);
      }
      g.strikes[i] = g.strikes[g.strikes.length - 1];
      g.strikes.pop();
    }
    if (this.firing < 0) return;
    const w = this.score[this.firing];
    if (this.elapsed < w.at + clockTuning.warning) return;
    this.firing = -1;
    g.vfx.ring(w.x, w.z, 1, 6, '#ef7d57', 0.35);
    for (let i = 0; i < 7; i++) {
      const a = w.angle + (i * Math.PI) / 4;
      spawnPattern(g.bullets, Shot.Plain, w.x, w.z, Math.sin(a), Math.cos(a), 7.5, 13);
    }
  }
  private ghost(g: Game, dt: number) {
    const v = this.view;
    v.ghost = this.pastCount > 0;
    if (v.ghost) {
      const frame = Math.min(this.elapsed * traceHz, this.pastCount - 1);
      const i = Math.floor(frame) * 3,
        j = Math.min(i + 3, (this.pastCount - 1) * 3);
      const a = frame % 1;
      v.x = this.past[i] + (this.past[j] - this.past[i]) * a;
      v.z = this.past[i + 1] + (this.past[j + 1] - this.past[i + 1]) * a;
      v.facing = this.past[i + 2];
      if ((this.sparkT -= dt) <= 0) {
        this.sparkT = 0.85;
        g.vfx.ring(v.x, v.z, 0.45, 0.5, '#73eff7', 0.6);
        for (const m of this.marks) {
          g.vfx.ring(m.x, m.z, 0.9, 0, '#ffcd75', 1);
          g.vfx.star(m.x, 0.55, m.z, 0.75, '#ffcd75', 1);
        }
      }
    }
  }
  step(g: Game, dt: number, localControl: boolean) {
    if (!this.active || g.mode !== 'fight') return false;
    this.elapsed += dt;
    g.runTime += dt;
    g.director.time = g.director.duration - clockTuning.seconds + this.elapsed;
    this.view.intro = this.elapsed < 3;
    this.view.seconds = Math.max(0, Math.ceil(60 - this.elapsed));
    for (const h of g.heroes) {
      if (h.left) continue;
      if (!this.tracks.has(h)) this.tracks.set(h, new ClockTrack(h));
      g.updateHero(h, dt, localControl);
    }
    g.updateSkill(dt);
    if (this.elapsed >= this.nextSample) {
      this.nextSample += 1 / traceHz;
      for (const [h, r] of this.tracks) if (!h.left) r.record(h);
    }
    const wave = this.score[this.wave];
    if (wave && this.elapsed >= wave.at) {
      this.warn(g, wave);
      this.firing = this.wave++;
    }
    // The clock has no loot or director spawns. Its strikes share the regular hit/parry pipeline.
    this.pulses(g, dt);
    g.updateBullets(dt);
    g.fx.update(dt);
    g.particles.update(dt);
    if (this.view.attempt === clockTuning.attempts && g.heroes.length > 1) g.updateRevives(dt);
    this.ghost(g, dt);
    if (this.lost) this.rewind(g, this.lost);
    else if (this.elapsed + 1e-8 >= clockTuning.seconds && g.mode === 'fight') {
      if (g.damagedThisStage && this.view.attempt < clockTuning.attempts)
        this.rewind(g, this.blemish ?? g.hero);
      else {
        this.won = !g.damagedThisStage;
        this.active = false;
        this.clearHazards(g);
        if (this.won) for (const h of g.heroes) if (!h.left) h.gold += clockTuning.reward;
        timeBarrier(g);
        g.stageClear();
        g.vfx.toast(echoEn[this.won ? 'echo.flawless' : 'echo.normal'], 3);
      }
    }
    return true;
  }
}
