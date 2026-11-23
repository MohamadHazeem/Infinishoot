import { t, localize } from '../i18n';
import type { PortraitLook } from '../ui/portraitArt';
import { compactScene, Cutscene, cutsceneGame, shotFrame } from './cutscene';

export const finisherTuning = {
  /** Total length (s), and the calm (reduced motion) version. */
  length: 2.1,
  calmLength: 1.5,
  /** Freeze-frame before the panels. */
  freeze: 0.14,
  /** Panels slam in over this long. */
  panelIn: 0.2,
  /** When the hit lands. */
  strike: 0.36,
  /** When the K.O. title slams in. */
  title: 0.5,
  /** Exit wipe at the end. */
  out: 0.3,
  /** Presses before this are ignored (the killing click may still be held). */
  minSkip: 0.3,
  /** Screen shake on the hit (canvas pixels, scaled by the shake setting). */
  shake: 3,
};

export interface FinisherFrame {
  /** 0..1 dim of the frozen world (freeze-frame). */
  freeze: number;
  /** 0..1 panels in (stepped), then 1 until the exit. */
  panel: number;
  /** Seconds since the hit landed (-1 before). */
  sinceHit: number;
  title: boolean;
  /** 0..1 exit wipe. */
  out: number;
  done: boolean;
}

export function finisherLength(calm: boolean): number {
  return calm ? finisherTuning.calmLength : finisherTuning.length;
}

/** Where the finisher is at time `t` (calm = reduced motion: no slams, panels appear at once). */
export function finisherFrame(t: number, calm: boolean, out: FinisherFrame = { freeze: 0, panel: 0, sinceHit: -1, title: false, out: 0, done: false }): FinisherFrame {
  const T = finisherTuning;
  const len = finisherLength(calm);
  const k = (v: number) => Math.max(0, Math.min(1, v));
  const steps = (v: number, n: number) => (calm ? (v > 0 ? 1 : 0) : Math.ceil(k(v) * n) / n);
  const freeze = calm ? 0.06 : T.freeze;
  const strike = calm ? 0.2 : T.strike;
  out.freeze = k(t / Math.max(0.01, freeze));
  out.panel = t < freeze ? 0 : steps((t - freeze) / T.panelIn, 4);
  out.sinceHit = t >= strike ? t - strike : -1;
  out.title = t >= (calm ? 0.3 : T.title) && t < len - T.out * 0.5;
  out.out = t <= len - T.out ? 0 : steps((t - (len - T.out)) / T.out, 3);
  out.done = t >= len;
  return out;
}

/** Spiky ink-burst radius around a centre: `spikes` points, `r` base, `amp` spike depth (0..1), turned by `rot`. */
export function burstRadius(angle: number, spikes: number, r: number, amp: number, rot = 0): number {
  const u = ((angle + rot) / (Math.PI * 2)) * spikes;
  const f = u - Math.floor(u);
  const tri = 1 - Math.abs(f * 2 - 1); // 0 at the notches, 1 at the tips
  return r * (1 - amp + amp * tri * 2);
}

/** The panel seam's x at row y (canvas pixels): a diagonal leaning left toward the bottom. */
export function seamX(y: number, w: number, h: number): number {
  return w * (0.57 - 0.14 * (y / Math.max(1, h)));
}

/**
 * Manga focus lines: is the pixel at angle `a`, distance `r` on a line?
 * `bins` lines round the circle (about half drawn), each starting somewhere
 * between `minR` and `minR + spanR` and widening outward. `seed` reshuffles.
 */
export function focusLine(a: number, r: number, bins: number, minR: number, spanR: number, seed: number): boolean {
  const u = ((a + Math.PI) / (Math.PI * 2)) * bins;
  const b = Math.floor(u);
  if (hash01(b * 7 + seed * 131) < 0.45) return false;
  const start = minR + hash01(b + seed * 13) * spanR;
  if (r < start) return false;
  return u - b < 0.18 + 0.45 * Math.min(1, (r - start) / (spanR + 8));
}

/** Small stable hash 0..1 for focus-line bins. */
export function hash01(n: number): number {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

export interface FinisherCast {
  hero: PortraitLook;
  heroName: string;
  heroColor: string;
  boss: PortraitLook;
  bossName: string;
  bossColor: string;
  bossAccent: string;
  /** The final boss: FINAL K.O. */
  omega: boolean;
  /** Boss position on screen (0..1), for the freeze-frame focus lines. */
  focus: { x: number; y: number } | null;
  calm: boolean;
  flashes: boolean;
  /** Shake setting multiplier (0 = off). */
  shake: number;
}


/** The kill and the killer use their live scene models. Solo retains the existing kill
 * hold and skip callback. A network kill has already resolved when the local card plays. */
export class FinisherView {
  t = -1;
  onSkip: (() => void) | null = null;
  onCue: ((cue: 'whoosh' | 'hit') => void) | null = null;
  private shot: Cutscene;
  private game;
  private duration = 0;

  constructor(hud: HTMLElement) {
    this.game = cutsceneGame(hud);
    this.shot = new Cutscene(this.game, hud, 'finisher');
  }
  get active(): boolean { return this.t >= 0; }
  get length(): number { return this.duration; }
  start(cast: FinisherCast): void {
    const g = this.game, p = g.player, boss = g.boss;
    this.duration = compactScene(g) ? 0.95 : finisherLength(cast.calm);
    this.t = 0;
    const x = boss?.x ?? p.x, z = boss?.z ?? p.z;
    const face = Math.atan2(p.x - x, p.z - z);
    const hero = p.rig;
    const title = t(cast.omega ? 'text.final_k_o_e658cc' : 'ui.ko');
    const defeated = t(cast.omega ? 'text.falls_d208bb' : 'text.defeated_834b2b', { 0: localize(cast.bossName) });
    this.shot.start({
      title, line: localize(cast.bossName), duration: this.duration, hero,
      frames: [
        shotFrame(0, x, z, face, 3, 5, 10, 1.6, 45),
        shotFrame(0.30, x, z, face, 2.2, 4, 8.5, 1.6, 41),
        shotFrame(0.32, p.x, p.z, p.rig.root.rotation.y, 1.1, 3.15, 4.8, 1.0, 37, true),
        shotFrame(1, p.x, p.z, p.rig.root.rotation.y, 0.65, 3.65, 5.5, 1.0, 40),
      ],
      beats: [
        { at: 0.07, sound: () => this.onCue?.('whoosh') },
        { at: 0.32, pose: 'victory', line: defeated, sound: () => this.onCue?.('hit') },
      ], skip: () => this.skip(),
    });
  }
  skip(): void {
    this.stop();
    this.onSkip?.();
  }
  stop(): void {
    this.t = -1;
    this.shot.stop();
  }
  update(dt: number): boolean {
    if (!this.active) return false;
    this.t += dt;
    if (!this.game.bossIntro.preferences.finishers || this.t >= this.duration) {
      this.skip();
      return true;
    }
    this.shot.sample(this.t);
    return false;
  }
}
