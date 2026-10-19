import { sfx } from '../audio/sfx';
import { threatAt } from '../audio/captions';
import { threatOf } from '../audio/threats';
import type { DamageNumbers } from '../ui/damageNumbers';
import type { Hud } from '../ui/hud';
import type { Fx } from './fx';
import type { Juice } from './juice';
import type { BurstOptions, Particles } from './particles';
import type { Scars } from './scars';

/**
 * Cosmetic effects bus. Gameplay code calls these instead of fx/particles/
 * sfx directly. They play locally and, on an online host, are also recorded
 * so clients can replay them (positioned events are filtered by distance).
 */
export type VfxEvent =
  | ['b', number, number, number, BurstOptions]
  | ['r', number, number, number, number, string, number]
  | ['s', number, number, number, number, string, number]
  | ['n', number, number, number, string | number, NumKind, number?]
  | ['a', number, number, string, number]
  | ['k', number, number, number]
  | ['h', 'banner' | 'toast' | 'flash', string, string, number]
  | ['z', number, number, number, number]
  | ['g', number, number, number, string, number]
  | ['c', number, number, number, string, number, number, number, number];

export interface DangerZone {
  x: number;
  z: number;
  r: number;
  t: number;
  life: number;
}

export type NumKind = 'hit' | 'crit' | 'player' | 'heal' | 'score';

/** Things the bus plays into. `listener()` is where the local player is (for sound and shake falloff). */
export interface VfxTargets {
  fx: Fx;
  particles: Particles;
  dmg: DamageNumbers;
  juice: Juice;
  hud: Hud;
  /** Danger zones drawn on the ground (telegraphed strikes). */
  zones: DangerZone[];
  scars: Scars;
  /** A dead enemy's body is flung (x, y, z, scale, facing, push direction); cosmetic. */
  corpse?(id: string, x: number, y: number, z: number, scale: number, facing: number, dirX: number, dirZ: number): void;
  listener(): { x: number; z: number };
}

const HEAR_RANGE = 32;

export class Vfx {
  recording = false;
  events: VfxEvent[] = [];

  constructor(private t: VfxTargets) {}

  private rec(e: VfxEvent): void {
    if (this.recording) this.events.push(e);
  }

  /** Take the recorded events (host sends them with the next snapshot). */
  drain(): VfxEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  burst(x: number, y: number, z: number, o: BurstOptions): void {
    this.t.particles.burst(x, y, z, o);
    this.rec(['b', x, y, z, o]);
  }

  ring(x: number, z: number, size: number, grow: number, color: string, life = 0.3): void {
    this.t.fx.ring(x, z, size, grow, color, life);
    this.rec(['r', x, z, size, grow, color, life]);
  }

  star(x: number, y: number, z: number, size: number, color = '#ffffff', life = 0.12): void {
    this.t.fx.star(x, y, z, size, color, life);
    this.rec(['s', x, y, z, size, color, life]);
  }

  /** Floating number or label. `by`: index of the hero whose hit it is (DAMAGE NUMBERS: MINE / OFF); left off for messages. */
  num(x: number, y: number, z: number, value: string | number, kind: NumKind = 'hit', by?: number): void {
    this.t.dmg.spawn(x, y, z, value, kind, by);
    // Older clients ignore the extra element; events without it always show.
    this.rec(by === undefined ? ['n', x, y, z, value, kind] : ['n', x, y, z, value, kind, by]);
  }

  /** Positional sound: plays if the local player is in earshot. `name` is an sfx method or "w:<weapon sound>". */
  sound(name: string, x: number, z: number, pitch = 1): void {
    this.playSound(name, x, z, pitch);
    this.rec(['a', x, z, name, pitch]);
  }

  /** Screen shake, scaled down with distance from the local player. */
  shake(x: number, z: number, amount: number): void {
    this.playShake(x, z, amount);
    this.rec(['k', x, z, amount]);
  }

  /** A red danger zone on the ground for `life` seconds, with a ring closing in. */
  zone(x: number, z: number, r: number, life: number): void {
    this.t.zones.push({ x, z, r, t: life, life });
    this.rec(['z', x, z, r, life]);
  }

  /** A mark left on the ground (scorch, frost, crater, goo) that fades after `life` seconds. */
  scar(x: number, z: number, r: number, color: string, life = 14): void {
    this.t.scars.add(x, z, r, color, life);
    this.rec(['g', x, z, r, color, life]);
  }

  /** A dead enemy's body flies off tumbling along (dirX, dirZ); boss kills also start the kill-cam. */
  corpse(id: string, x: number, y: number, z: number, scale: number, facing: number, dirX: number, dirZ: number): void {
    const r2 = (v: number) => Math.round(v * 100) / 100;
    this.t.corpse?.(id, x, y, z, scale, facing, dirX, dirZ);
    this.rec(['c', r2(x), r2(z), r2(y), id, r2(scale), r2(facing), r2(dirX), r2(dirZ)]);
  }

  /** Team-wide HUD messages. */
  banner(title: string, sub = '', seconds = 1.6): void {
    this.t.hud.showBanner(title, sub, seconds);
    this.rec(['h', 'banner', title, sub, seconds]);
  }
  toast(msg: string, seconds = 2.2): void {
    this.t.hud.toast(msg, seconds);
    this.rec(['h', 'toast', msg, '', seconds]);
  }
  flash(amount: number): void {
    this.t.hud.flash(amount);
    this.rec(['h', 'flash', '', '', amount]);
  }

  private near(x: number, z: number): number {
    if (Number.isNaN(x)) return 0;
    const l = this.t.listener();
    return Math.hypot(x - l.x, z - l.z);
  }

  private playSound(name: string, x: number, z: number, pitch: number): void {
    const d = this.near(x, z);
    if (d > HEAR_RANGE) return;
    // Pan by the sideways offset from the listener and fade with distance.
    if (!Number.isNaN(x)) sfx.at((x - this.t.listener().x) / 14, d < 6 ? 1 : 1 - ((d - 6) / (HEAR_RANGE - 6)) * 0.7);
    sfx.named(name, pitch);
    sfx.at(0, 1);
    if (threatOf(name)) threatAt(name, x, z); // SOUND ARROWS (off-screen telegraphs)
  }

  private playShake(x: number, z: number, amount: number): void {
    const d = this.near(x, z);
    const k = d < 8 ? 1 : Math.max(0, 1 - (d - 8) / 20);
    if (k > 0) this.t.juice.shake(amount * k);
    // Directional: the camera also punches toward where the impact happened.
    if (k > 0 && d > 1) {
      const l = this.t.listener();
      const kick = Math.min(6, amount * k * 7);
      this.t.juice.kick((x - l.x) / d, (z - l.z) / d, kick);
    }
  }

  /** Client: replay an event received from the host. */
  apply(e: VfxEvent): void {
    switch (e[0]) {
      case 'b':
        this.t.particles.burst(e[1], e[2], e[3], e[4]);
        break;
      case 'r':
        this.t.fx.ring(e[1], e[2], e[3], e[4], e[5], e[6]);
        break;
      case 's':
        this.t.fx.star(e[1], e[2], e[3], e[4], e[5], e[6]);
        break;
      case 'n':
        this.t.dmg.spawn(e[1], e[2], e[3], e[4], e[5], e[6]);
        break;
      case 'a':
        this.playSound(e[3], e[1], e[2], e[4]);
        break;
      case 'k':
        this.playShake(e[1], e[2], e[3]);
        break;
      case 'z':
        this.t.zones.push({ x: e[1], z: e[2], r: e[3], t: e[4], life: e[4] });
        break;
      case 'g':
        this.t.scars.add(e[1], e[2], e[3], e[4], e[5]);
        break;
      case 'c':
        this.t.corpse?.(e[4], e[1], e[3], e[2], e[5], e[6], e[7], e[8]);
        break;
      case 'h':
        if (e[1] === 'banner') this.t.hud.showBanner(e[2], e[3], e[4]);
        else if (e[1] === 'toast') this.t.hud.toast(e[2], e[4]);
        else this.t.hud.flash(e[4]);
        break;
    }
  }

  /** Where a positioned event happens (NaN for team-wide ones). */
  static position(e: VfxEvent): [number, number] {
    switch (e[0]) {
      case 'b':
      case 's':
      case 'n':
        return [e[1], e[3]];
      case 'r':
      case 'a':
      case 'k':
      case 'z':
      case 'g':
      case 'c':
        return [e[1], e[2]];
      default:
        return [NaN, NaN];
    }
  }
}
