import { loadJson, saveJson } from '../core/storage';
import { HERO_BY_ID } from './heroes';
import { MOD_BY_ID } from './mods';
import { PASSIVES } from './passives';
import { RELIC_BY_ID } from './relics';
import { buildKey } from './tracks';
import { SPECIALS } from './specials';
import { WEAPONS } from './weapons';
import type { Hero } from '../game/hero';

export const echoKey = 'echo.runs.v1';
const frames = 128;
export const samplePeriod = 0.25;
const stride = 4; // radial speed, tangential speed, distance to target, dash edge
export interface EchoArm {
  id: string;
  level: number;
  key: string;
  special: boolean;
  attack: 'burst' | 'strike' | 'pulse' | 'beam';
  damage: number;
  shots: number;
  speed: number;
  radius: number;
  interval: number;
  range: number;
}
export interface EchoTape {
  hero: string;
  level: number;
  passives: Record<string, number>;
  mods: Record<string, number>;
  relics: string[];
  arms: EchoArm[];
  moves: number[];
}
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const num = (n: unknown, lo: number, hi: number, fallback: number) =>
  typeof n === 'number' && Number.isFinite(n) ? clamp(n, lo, hi) : fallback;

function ranks(value: unknown, catalog: Record<string, unknown>) {
  const out: Record<string, number> = {};
  if (value && typeof value === 'object')
    for (const id of Object.keys(catalog)) {
      const lv = (value as Record<string, unknown>)[id];
      if (typeof lv === 'number' && Number.isFinite(lv) && lv >= 1)
        out[id] = Math.floor(Math.min(99, lv));
    }
  return out;
}

export function normalizeEchoes(raw: unknown): EchoTape[] {
  if (!Array.isArray(raw)) return [];
  const tapes: EchoTape[] = [];
  for (const row of raw.slice(0, 3)) {
    if (!row || !Array.isArray(row.arms) || !Array.isArray(row.moves)) continue;
    const arms: EchoArm[] = [];
    for (const a of row.arms.slice(0, 9)) {
      if (
        !a ||
        typeof a.id !== 'string' ||
        !Object.hasOwn(a.special === true ? SPECIALS : WEAPONS, a.id)
      )
        continue;
      arms.push({
        id: a.id,
        special: a.special === true,
        level: Math.round(num(a.level, 1, 100, 1)),
        key: typeof a.key === 'string' ? a.key.slice(0, 80) : '',
        attack:
          a.attack === 'pulse' || a.attack === 'strike' || a.attack === 'beam' ? a.attack : 'burst',
        damage: num(a.damage, 4, 16, 8),
        speed: num(a.speed, 5, 13, 9),
        shots: Math.round(num(a.shots, 1, 5, 1)),
        range: num(a.range, 3, 15, 9),
        radius: num(a.radius, 1.25, 3.2, 2),
        interval: num(a.interval, 0.8, 2.4, 1.4),
      });
    }
    const moves: number[] = [];
    for (let i = 0; i + stride <= Math.min(frames * stride, row.moves.length); i += stride) {
      moves.push(
        num(row.moves[i], -7, 7, 0),
        num(row.moves[i + 1], -7, 7, 0),
        num(row.moves[i + 2], 3, 16, 8),
        row.moves[i + 3] === 1 ? 1 : 0,
      );
    }
    if (arms.length && moves.length)
      tapes.push({
        hero:
          typeof row.hero === 'string' && Object.hasOwn(HERO_BY_ID, row.hero) ? row.hero : 'rookie',
        passives: ranks(row.passives, PASSIVES),
        mods: ranks(row.mods, MOD_BY_ID),
        relics: Array.isArray(row.relics)
          ? row.relics
              .slice(0, 32)
              .filter((id: unknown) => typeof id === 'string' && Object.hasOwn(RELIC_BY_ID, id))
          : [],
        level: Math.round(num(row.level, 1, 999, 1)),
        arms,
        moves,
      });
  }
  return tapes;
}

export const readEchoes = () => normalizeEchoes(loadJson<unknown>(echoKey, []));
export const saveEcho = (tape: EchoTape) =>
  saveJson(echoKey, normalizeEchoes([tape, ...readEchoes()]));

/** Record movement relative to what the hero is fighting so the same kite works in a different arena. */
export class EchoRecorder {
  private samples = new Float32Array(frames * stride);
  private written = 0;
  clear() {
    this.written = 0;
  }
  sample(radial: number, tangent: number, range: number, dashed: boolean) {
    const i = (this.written++ % frames) * stride;
    this.samples[i] = Math.round(clamp(radial, -7, 7) * 4) / 4;
    this.samples[i + 1] = Math.round(clamp(tangent, -7, 7) * 4) / 4;
    this.samples[i + 2] = Math.round(clamp(range, 3, 16) * 2) / 2;
    this.samples[i + 3] = +dashed;
  }
  finish(h: Hero, level: number): EchoTape | null {
    if (this.written < 8) return null;
    const moves: number[] = [];
    for (let n = Math.max(0, this.written - frames); n < this.written; n++) {
      const i = (n % frames) * stride;
      moves.push(this.samples[i], this.samples[i + 1], this.samples[i + 2], this.samples[i + 3]);
    }
    const arm = (
      id: string,
      level: number,
      key: string,
      special: boolean,
      p: Record<string, number>,
    ): EchoArm => {
      const attack = special || p.blast || p.delay || (p.radius && !p.speed) ? 'strike' : 'burst';
      return {
        id,
        level,
        key,
        special,
        attack:
          id === 'rail' || id === 'laser'
            ? 'beam'
            : id === 'bomb' || id === 'aura' || id === 'shield'
              ? 'pulse'
              : attack,
        damage: clamp((p.dmg ?? (p.dps ?? 50) * 0.2) * h.stats.damageMul * 0.35, 4, 16),
        range: clamp(p.range ?? 10, 3, 15),
        shots: clamp(Math.round(p.pellets ?? p.shots ?? p.beams ?? p.count ?? 1), 1, 5),
        speed: clamp((p.speed ?? 18) * 0.55, 5, 13),
        radius: clamp((p.blast || p.radius || 3) * h.stats.areaMul * 0.72, 1.25, 3.2),
        interval: clamp((p.cd ?? 2 / (p.rate ?? 1)) * h.stats.cooldownMul, 0.8, 2.4),
      };
    };
    const arms = h.weapons.map((w) => arm(w.def.id, w.level, w.buildKey, false, w.p));
    arms.push(
      arm(
        h.special.id,
        h.special.level,
        h.specialBuild ? buildKey(h.specialBuild) : '',
        true,
        h.specialP,
      ),
    );
    return {
      hero: h.heroDef.id,
      level,
      arms,
      moves,
      passives: { ...h.passives },
      mods: Object.fromEntries(h.synergy.slots.map((s) => [s.def.id, s.level])),
      relics: [...h.relics],
    };
  }
}
