import { HERO_PATHS, archetypeTuning as T, type BuildPath } from '../data/archetypes';
import { MOD_BY_ID } from '../data/mods';
import { PASSIVES } from '../data/passives';
import { TAGS, type Tag } from '../data/tags';
import { WEAPONS } from '../data/weapons';
import { en } from '../i18n/en';
import { localize, t } from '../i18n';
import type { Offer } from '../ui/screens';
import { bossLike, freezeMul } from './bossRules';
import type { Enemy } from './enemies';
import type { Hero } from './hero';

type Mods = readonly { def: { id: string }; level: number }[];
export interface PathHint { id: string; points: number }
const goal = () => T.weaponRanks + T.supportRanks;

/** Damage summaries travel to other locales with the canonical English source name. */
export function pathDamageName(source: string): string | undefined {
  if (source.startsWith('path.')) return (en as Record<string, string>)['paths.' + source.slice(5)];
}

// A fusion represents two fully ranked weapons, even though its own ladder is one level.
function weaponRanks(h: Hero, path: BuildPath, offer?: Offer): number {
  const ref = offer?.pick?.split('|')[0] ?? offer?.id.replace(/_evo$/, '');
  let best = 0;
  for (const w of h.weapons) {
    if (offer?.kind === 'fusion' && offer.fuses?.includes(w.def.id)) continue;
    const upgrading = ref === w.def.id;
    const newTag = upgrading && offer?.kind === 'evo' && offer.tags?.includes(path.tag);
    if (w.tags.includes(path.tag) || newTag) {
      const rank = w.def.fusion ? T.weaponRanks : w.level + (upgrading ? 1 : 0);
      best = Math.max(best, rank);
    }
  }
  if (offer && ref && (offer.kind === 'weapon' || offer.kind === 'fusion') && WEAPONS[ref]?.tags.includes(path.tag)) {
    best = Math.max(best, offer.kind === 'fusion' ? T.weaponRanks : 1);
  }
  return Math.min(T.weaponRanks, best);
}

function supportRanks(h: Hero, path: BuildPath, mods: Mods, add?: string): number {
  const [a, b, mod] = path.items;
  let ranks = (h.passives[a] ?? 0) + (h.passives[b] ?? 0);
  for (const m of mods) if (m.def.id === mod) ranks += m.level;
  if (add && path.items.includes(add)) ranks++;
  return Math.min(T.supportRanks, ranks);
}

export function pathPoints(h: Hero, path: BuildPath, mods: Mods = h.synergy.slots): number {
  return weaponRanks(h, path) + supportRanks(h, path, mods);
}

/** Canonical ids and counts travel with the offer; each peer translates at display time. */
export function offerPathHints(h: Hero, offers: Offer[]): Offer[] {
  for (const o of offers) {
    const hints: PathHint[] = [];
    for (const p of h.heroDef.paths) {
      const weapon = o.kind === 'passive' || o.kind === 'gold' || o.kind === 'heal' || o.kind === 'special' ? undefined : o;
      const points = weaponRanks(h, p, weapon) + supportRanks(h, p, h.synergy.slots, o.kind === 'passive' ? o.id : undefined);
      if (points > pathPoints(h, p)) hints.push({ id: p.id, points });
    }
    if (hints.length) o.paths = hints;
    else delete o.paths;
  }
  return offers;
}

export function shopPathHints(h: Hero): Record<string, PathHint[]> {
  const hints: Record<string, PathHint[]> = {};
  for (const p of h.heroDef.paths) {
    const id = p.items[2];
    const points = pathPoints(h, p);
    if (supportRanks(h, p, h.synergy.slots) < T.supportRanks) (hints[id] ??= []).push({ id: p.id, points: points + 1 });
  }
  return hints;
}

const pathIds = new Set(Object.values(HERO_PATHS).flat().map(p => p.id));
const name = (id: string) => t('paths.' + id);
export function pathChips(hints?: PathHint[]): string {
  if (!hints?.length) return '';
  const known = hints.filter(h => pathIds.has(h.id) && Number.isInteger(h.points) && h.points > 0 && h.points <= goal());
  if (!known.length) return '';
  return '<div class="set-chips">' + known.map(h =>
    `<span class="set-chip adds path-chip" style="--c:var(--cyan)" title="${t('paths.desc.' + h.id)}">◆ ${name(h.id)} <b dir="ltr">${h.points}/${goal()}</b>${h.points === goal() ? ' ★' : ''}</span>`
  ).join('') + '</div>';
}

export function pausePaths(heroes: readonly Hero[], mods: Mods): string {
  return heroes.map(h => pathPanel(h, heroes.length > 1 ? h.synergy.slots : mods, heroes.length > 1)).join('');
}

export function pathPanel(h: Hero, mods: Mods, sharedScreen = false): string {
  const seat = sharedScreen ? t('death.seat', { n: h.index + 1 }) + ' · ' + localize(h.heroDef.name) + ' · ' : '';
  const rows = h.heroDef.paths.map(p => {
    const w = weaponRanks(h, p), s = supportRanks(h, p, mods);
    const [a, b, mod] = p.items;
    const recipe = t('paths.recipe', {
      tag: localize(TAGS[p.tag].label), w, weapons: T.weaponRanks, s, supports: T.supportRanks,
      a: localize(PASSIVES[a].name), b: localize(PASSIVES[b].name), mod: localize(MOD_BY_ID[mod].name),
    });
    return `<div class="path-row"><b>${w + s === goal() ? '★ ' : ''}${name(p.id)}</b> · ${recipe}<div>${t('paths.desc.' + p.id)}</div></div>`;
  });
  return `<section class="path-panel"><div class="pi-t">${seat}${t('paths.title', { seconds: T.cooldown })}</div>${rows.join('')}</section>`;
}

const explosive: Tag[] = ['explosive'];
const colors = { mark: '#b86fbd', frost: '#73eff7', pull: '#41a6f6', push: '#ef7d57' } as const;

export class HeroPaths {
  private active = 0;
  private readonly readyIn = [T.cooldown, T.cooldown];
  private readonly targets: Enemy[] = [];
  private charging = false;
  private parries = 0;

  reset(): void {
    this.active = this.parries = 0;
    this.charging = false;
    this.readyIn.fill(T.cooldown);
    this.targets.length = 0;
  }

  /** Build mutations, including restored builds, run outside the combat hot loop. */
  refresh(h: Hero): void {
    let mask = 0;
    for (let i = 0; i < h.heroDef.paths.length; i++) {
      if (pathPoints(h, h.heroDef.paths[i]) < goal()) continue;
      mask |= 1 << i;
      if (!(this.active & (1 << i))) this.readyIn[i] = T.cooldown;
    }
    this.active = mask;
  }

  step(h: Hero, dt: number): void {
    const released = this.charging && !h.ctx.charging, parried = h.mech.parries > this.parries;
    this.charging = h.ctx.charging;
    this.parries = h.mech.parries;
    if (!this.active) return;
    for (let i = 0; i < h.heroDef.paths.length; i++) {
      if (!(this.active & (1 << i))) continue;
      this.readyIn[i] -= dt;
      if (this.readyIn[i] > 0) continue;
      const p = h.heroDef.paths[i];
      let trigger: boolean;
      switch (p.trigger) {
        case 'release': trigger = released; break;
        case 'parry': trigger = parried; break;
        case 'ultimate': trigger = h.skill.ultT > 0; break;
        case 'dash': trigger = h.player.dashing; break;
        case 'brace': trigger = h.ctx.firing && h.player.speed < 0.6; break;
        case 'strafe': trigger = h.ctx.firing && h.player.speed > 2; break;
        case 'melee': trigger = h.ctx.firing; break;
      }
      if (trigger) this.readyIn[i] = this.fire(h, p) ? T.cooldown : 0.15;
    }
  }

  private fire(h: Hero, path: BuildPath): boolean {
    const { ctx, player } = h, { x, z } = player;
    if (path.effect === 'ward') {
      const b = ctx.bullets;
      let nearest = -1, best = 9;
      for (let i = 0; i < b.count; i++) {
        const d = (b.x[i] - x) ** 2 + (b.z[i] - z) ** 2;
        if (d < best && ctx.hostileBullet?.(i)) { best = d; nearest = i; }
      }
      if (nearest < 0) return false;
      ctx.fx.star(b.x[nearest], 1, b.z[nearest], 1.2, '#a7f070');
      b.kill(nearest);
      return true;
    }
    const near = path.trigger === 'melee' || path.effect === 'push';
    const aim = near ? 0 : player.landDist(0, 4);
    const target = ctx.nearest(x + player.aim.x * aim, z + player.aim.z * aim, near ? T.radius : 5);
    if (!target) return false;
    const tx = target.x, tz = target.z;
    if (path.effect === 'blast') {
      ctx.blast(tx, tz, 1.8, 12, '#ef7d57', 'path.' + path.id, explosive);
      return true;
    }
    if (path.effect === 'arc') {
      ctx.fx.star(tx, 1, tz, 0.8, '#ffcd75');
      ctx.zap(target, 2, 9);
      return true;
    }
    const cx = path.effect === 'push' ? x : tx, cz = path.effect === 'push' ? z : tz;
    ctx.fx.ring(cx, cz, 0.6, T.radius * 2, colors[path.effect], 0.3);
    let hits = 0;
    for (const e of ctx.inRadius(cx, cz, T.radius, this.targets)) {
      if (!e.targetable || e.roarT > 0 || e.shield > 0) continue;
      if (path.effect === 'mark') e.exposeT = Math.max(e.exposeT, 1.4);
      else if (path.effect === 'frost') e.frozen = Math.max(e.frozen, 0.65 * freezeMul(e));
      else {
        if (bossLike(e) || e.def.behavior === 'reaper') continue;
        const dx = e.x - cx, dz = e.z - cz, d = Math.hypot(dx, dz);
        if (d < 0.01) continue;
        const impulse = path.effect === 'push' ? 9 : -7;
        e.kx += impulse * dx / d;
        e.kz += impulse * dz / d;
      }
      if (++hits >= T.targets) break;
    }
    return true;
  }
}
