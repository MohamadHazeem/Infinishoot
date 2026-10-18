import type { Rng } from '../core/rng';
import type { Tag } from '../data/tags';
import type { Enemy } from './enemies';
import { emptyFlags, modMaxLevel, type DamageEvent, type ModApi, type ModDef, type ModFlags, type ModState } from './modTypes';
import type { Player } from './player';
import { passiveTuning, type Stats } from './stats';
import type { Weapon } from './weapons';

/** What the synergy engine needs from the game. */
export interface SynergyHost {
  readonly player: Player;
  /** Live stats: passive triggers (Spiked Shell, Tesla Boots, Cryo Rounds) read them. */
  readonly stats: Stats;
  readonly level: number;
  readonly gold: number;
  readonly weapons: Weapon[];
  readonly rng: Rng;
  blast(x: number, z: number, r: number, dmg: number, color: string, source: string, tags: Tag[]): void;
  zap(from: Enemy, hops: number, dmg: number): void;
  ignite(e: Enemy, dps: number): void;
  shock(e: Enemy): void;
  addGold(n: number): void;
}

export interface Slot {
  def: ModDef;
  st: ModState;
  /** Shop upgrades: acts like this many stacked copies. */
  level: number;
  /** Gold actually paid for it in total (purchase + upgrades), for sell refunds. */
  paid: number;
}

export const MAX_MOD_SLOTS = 5;

/**
 * Runs the player's Mods. Slots are ordered; an Echo in slot i adds a second
 * copy of slot i+1 at its own position. Every hook runs once per effective
 * copy (a level-N slot is N copies), so an echoed trigger fires twice. Damage
 * is the exception: each slot (and each Echo) applies once, scaled linearly by
 * its level, so levels and Echoes don't compound multipliers.
 */
export class Synergy implements ModApi {
  slots: Slot[] = [];
  flags: ModFlags = emptyFlags();
  moving = false;
  time = 0;
  private eff: Slot[] = [];
  private dmgEff: { s: Slot; n: number }[] = [];

  constructor(private host: SynergyHost) {}

  // ---------------------------------------------------------------- ModApi
  get player(): Player {
    return this.host.player;
  }
  get level(): number {
    return this.host.level;
  }
  get gold(): number {
    return this.host.gold;
  }
  /** A weapon's tags, plus its evolution's (Dragon's Breath adds Fire...). */
  private tagsOf(w: Weapon): readonly Tag[] {
    return w.tags;
  }
  tagCount(tag: Tag): number {
    let n = 0;
    for (const w of this.host.weapons) if (this.tagsOf(w).includes(tag)) n++;
    return n;
  }
  distinctTags(): number {
    const set = new Set<Tag>();
    for (const w of this.host.weapons) for (const t of this.tagsOf(w)) set.add(t);
    return set.size;
  }
  topTag(): Tag | null {
    const counts = new Map<Tag, number>();
    let best: Tag | null = null;
    let bestN = 0;
    for (const w of this.host.weapons) {
      for (const t of this.tagsOf(w)) {
        const n = (counts.get(t) ?? 0) + 1;
        counts.set(t, n);
        if (n > bestN) {
          bestN = n;
          best = t;
        }
      }
    }
    return best;
  }
  chance(p: number): boolean {
    return this.host.rng.chance(p);
  }
  blast(x: number, z: number, r: number, dmg: number, color: string, source: string, tags: Tag[]): void {
    this.host.blast(x, z, r, dmg, color, source, tags);
  }
  zap(from: Enemy, hops: number, dmg: number): void {
    this.host.zap(from, hops, dmg);
  }
  ignite(e: Enemy, dps: number): void {
    this.host.ignite(e, dps);
  }
  shock(e: Enemy): void {
    this.host.shock(e);
  }
  addGold(n: number): void {
    if (n > 0) this.host.addGold(n);
  }
  get freeSlots(): number {
    return MAX_MOD_SLOTS - this.slots.length;
  }

  // ---------------------------------------------------------------- slots

  reset(): void {
    this.slots = [];
    this.rebuild();
  }

  get full(): boolean {
    return this.slots.length >= MAX_MOD_SLOTS;
  }

  owns(id: string): boolean {
    return this.slots.some((s) => s.def.id === id);
  }

  add(def: ModDef, paid = def.price): void {
    this.slots.push({ def, st: { n: 0, t: 0 }, level: 1, paid });
    this.rebuild();
  }

  remove(i: number): Slot | undefined {
    const [s] = this.slots.splice(i, 1);
    this.rebuild();
    return s;
  }

  canUpgrade(i: number): boolean {
    const s = this.slots[i];
    return !!s && s.level < modMaxLevel(s.def);
  }

  upgrade(i: number, paid = 0): void {
    if (!this.canUpgrade(i)) return;
    this.slots[i].level++;
    this.slots[i].paid += paid;
    this.rebuild();
  }

  move(i: number, dir: -1 | 1): void {
    const j = i + dir;
    if (j < 0 || j >= this.slots.length) return;
    [this.slots[i], this.slots[j]] = [this.slots[j], this.slots[i]];
    this.rebuild();
  }

  /** Resolve Echoes and sum flags. */
  private rebuild(): void {
    this.eff = [];
    this.dmgEff = [];
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      // A level-N Mod (and an Echo of it) counts as N copies.
      const src = s.def.echo ? this.slots[i + 1] : s;
      if (!src || (s.def.echo && src.def.echo)) continue;
      for (let k = 0; k < src.level; k++) this.eff.push(src);
      if (src.def.dmg) this.dmgEff.push({ s: src, n: src.level });
    }
    const f = emptyFlags();
    for (const s of this.eff) {
      if (!s.def.flags) continue;
      for (const [k, v] of Object.entries(s.def.flags) as [keyof ModFlags, number | boolean][]) {
        if (typeof v === 'boolean') (f[k] as boolean) = (f[k] as boolean) || v;
        else (f[k] as number) += v;
      }
    }
    // Two Hair Triggers shouldn't make every 16th shot special: take the smallest N.
    const megas = this.eff.map((s) => s.def.flags?.busterMegaEvery ?? 0).filter((n) => n > 0);
    f.busterMegaEvery = megas.length ? Math.max(3, Math.min(...megas) - (megas.length - 1) * 2) : 0;
    this.flags = f;
  }

  // ---------------------------------------------------------------- stats

  /** Permanent stat changes (after passives). */
  applyStatic(s: Stats): void {
    for (const e of this.eff) e.def.stat?.(s);
  }

  /** Per-step stat changes. */
  applyLive(s: Stats): void {
    for (const e of this.eff) e.def.live?.(s, this, e.st);
  }

  // ---------------------------------------------------------------- damage

  /** Run a hit through the slots left to right: amount = (amount + add * n) * (1 + (mult - 1) * n), n = level. */
  damage(ev: DamageEvent, amount: number): number {
    for (const { s, n } of this.dmgEff) {
      const r = s.def.dmg!(ev, this, s.st);
      if (!r) continue;
      amount = (amount + (r.add ?? 0) * n) * (1 + ((r.mult ?? 1) - 1) * n);
    }
    return amount;
  }

  // ---------------------------------------------------------------- triggers
  // Passive triggers run after the Mods (so Phoenix can revive before Spiked Shell
  // checks for death), once each: Echo never copies them.

  hit(ev: DamageEvent): void {
    for (const e of this.eff) e.def.onHit?.(ev, this, e.st);
    // Cryo Rounds: a frozen enemy that dies shatters, so this opens the Frost combos.
    const fc = this.host.stats.freezeChance;
    if (fc > 0 && ev.e.hp > 0 && this.chance(fc)) {
      ev.e.frozen = Math.max(ev.e.frozen, passiveTuning.freezeTime * (ev.e.def.boss ? 0.15 : 1));
    }
  }
  crit(ev: DamageEvent): void {
    for (const e of this.eff) e.def.onCrit?.(ev, this, e.st);
  }
  kill(en: Enemy, source: string): void {
    for (const e of this.eff) e.def.onKill?.(en, source, this, e.st);
  }
  dash(): void {
    for (const e of this.eff) e.def.onDash?.(this, e.st);
    const s = this.host.stats;
    const p = this.player;
    if (s.dashZap > 0) this.blast(p.x, p.z, passiveTuning.dashZapRadius, s.dashZap, '#73eff7', 'tesla_boots', ['shock']);
  }
  hurt(): void {
    for (const e of this.eff) e.def.onHurt?.(this, e.st);
    const s = this.host.stats;
    const p = this.player;
    if (s.thorns > 0 && !p.dead) {
      this.blast(p.x, p.z, passiveTuning.thornsRadius, s.thorns * (1 + passiveTuning.thornsPerArmor * s.armor), '#a7f070', 'spiked_shell', []);
    }
  }
  gem(v: number): void {
    for (const e of this.eff) e.def.onGem?.(v, this, e.st);
  }
  levelUp(): void {
    for (const e of this.eff) e.def.onLevelUp?.(this, e.st);
  }
  stageClear(): void {
    for (const e of this.eff) e.def.onStageClear?.(this, e.st);
  }
  tick(dt: number): void {
    this.time += dt;
    for (const e of this.eff) e.def.tick?.(dt, this, e.st);
  }

  /** Readout text for slot i (e.g. a live multiplier), or ''. */
  readout(i: number): string {
    const s = this.slots[i];
    if (!s) return '';
    if (s.def.echo) {
      const next = this.slots[i + 1];
      return next && !next.def.echo ? `= ${next.def.name}` : 'no target';
    }
    return s.def.readout?.(this, s.st, s.level) ?? '';
  }
}
