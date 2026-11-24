import { loadJson, saveJson } from '../core/storage';
import {
  CORES,
  FRAMES,
  INTERACTIONS,
  MODIFIERS,
  PARTS,
  craftInteractions,
  craftTuning,
  partPrice,
  socketOf,
  type Part,
  type Recipe,
} from '../data/craftParts';
import { craftEn } from '../i18n/g5craft';
import { t } from '../i18n';
import type { Offer } from '../ui/screens';
import { saveLock } from './save';
import type { Game } from './game';
import { MAX_WEAPONS, type ChestFind, type Hero } from './hero';
import { createWeapon } from './weapons';
import { Crafted } from './weapons/crafted';

export const equippedCraft = (h: Hero) => h.weapons.find(isCrafted);
function isCrafted(w: Hero['weapons'][number]): w is Crafted {
  return w instanceof Crafted;
}
export interface BenchView {
  recipe: Recipe | null;
  room: boolean;
}
export function benchView(h: Hero): BenchView {
  return {
    recipe: equippedCraft(h)?.recipe ?? null,
    room: h.weapons.filter((w) => !w.def.slot).length < MAX_WEAPONS,
  };
}
export function fitPart(h: Hero, part: Part): boolean {
  if (!PARTS.includes(part)) return false;
  const socket = socketOf(part);
  let w = equippedCraft(h);
  if (!w) {
    if (socket !== 'frame' || !benchView(h).room) return false;
    w = createWeapon('crafted', h.ctx.scene) as Crafted;
    h.weapons.push(w);
  } else if (w.recipe[socket] === part) return false;
  w.configure({ ...w.recipe, [socket]: part });
  h.recomputeStats();
  h.loadoutDirty = true;
  return true;
}

// Free pieces never replace a fitted part. An unopened frame is offered as a
// treasure choice, so opening a chest cannot silently consume the last auto slot.
function missingPool(h: Hero) {
  const w = equippedCraft(h);
  if (!w) return benchView(h).room ? FRAMES : null;
  return !w.recipe.core ? CORES : !w.recipe.mod ? MODIFIERS : null;
}
export function treasurePart(h: Hero, offers: Offer[]): void {
  if (!h.chestsPending || h.banished.has('w:crafted') || !offers.length) return;
  const pool = missingPool(h);
  if (!pool) return;
  // Scarcity trims the last ordinary card. Put treasure in the first ordinary slot.
  const i = offers.findIndex(o => o.kind !== 'evo' && o.kind !== 'evolve' && o.kind !== 'fusion');
  if (i < 0) return;
  // Derive the free piece from this chest's ordinary roll; leaving it behind
  // doesn't advance the director/loot RNG stream.
  const part = pool[(h.level + h.chestsPending + h.index + offers[0].id.length) % pool.length];
  offers[i] = {
    kind: 'weapon',
    id: 'crafted',
    pick: part,
    name: craftEn[`craft.${part}`],
    text:
      craftEn[`craft.${part}.tip`] +
      (socketOf(part) === 'frame' ? ' ' + craftEn['craft.intro'] : ''),
    color: '#73eff7',
    icon: '⚙',
    tag: craftEn['craft.treasure'],
    slot: 'auto',
    rarity: 'rare',
  };
}
// A frame commits an auto slot. After levels 6 and 12, its next salvage gear
// trades the reroll for a core or modifier that suits the other equipped tags.
export function canSalvage(h: Hero): boolean {
  const r = equippedCraft(h)?.recipe;
  return (
    !!r &&
    ((!r.core && h.level >= craftTuning.coreLevel) ||
      (!!r.core && !r.mod && h.level >= craftTuning.modLevel))
  );
}
function salvagePart(h: Hero): Part {
  const w = equippedCraft(h)!;
  const pool = w.recipe.core ? MODIFIERS : CORES;
  const start = h.rng.int(0, pool.length - 1);
  let best: Part = pool[start],
    bestScore = -1;
  for (let i = 0; i < pool.length; i++) {
    const part = pool[(start + i) % pool.length];
    let mask = craftInteractions(
      { ...w.recipe, [socketOf(part)]: part },
      h.ctx.craftPartner ?? (() => false),
    );
    let score = 0;
    while (mask) {
      score++;
      mask &= mask - 1;
    }
    if (score > bestScore) {
      best = part;
      bestScore = score;
    }
  }
  return best;
}
export function salvageGear(g: Game, h: Hero): boolean {
  if (!g.authority || !canSalvage(h)) return false;
  const part = salvagePart(h);
  if (!fitPart(h, part)) return false;
  const item = partFind(part);
  if (h === g.hero) g.hud.chestReveal(item);
  else g.tell(h, { t: 'chestitem', item });
  g.vfx.sound('gear', h.player.x, h.player.z);
  return true;
}
function partFind(part: Part): ChestFind {
  return {
    id: part,
    name: craftEn[`craft.${part}`],
    color: '#73eff7',
    icon: '⚙',
    text: craftEn['craft.fitted'],
    rarity: 'rare',
  };
}
export function chestPart(h: Hero): ChestFind | null {
  if (!equippedCraft(h)) return null;
  const pool = missingPool(h);
  if (!pool || !h.rng.chance(craftTuning.dropChance)) return null;
  const part = pool[h.rng.int(0, pool.length - 1)];
  return fitPart(h, part) ? partFind(part) : null;
}

export function buyPart(g: Game, h: Hero, index: number): void {
  if (!g.authority || g.mode !== 'shop' || h.shopDone || h.left || !Number.isInteger(index)) return;
  const part = PARTS[index];
  if (!part || h.relicOffers.length) return;
  const price = partPrice(part);
  if (h.gold >= price && fitPart(h, part)) {
    h.gold -= price;
    g.shopFx(h, 'buy');
  }
  g.presentShop(h);
}

const STORE = 'craft.discoveries.v1';
export type Journal = Partial<Record<(typeof INTERACTIONS)[number], number>>;
export function normalizeJournal(raw: unknown): Journal {
  const clean: Journal = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return clean;
  for (const id of INTERACTIONS) {
    const seed = (raw as Journal)[id];
    if (typeof seed === 'number' && Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff)
      clean[id] = seed;
  }
  return clean;
}
export const readJournal = () => normalizeJournal(loadJson<unknown>(STORE, null));
export function recordDiscoveries(mask: number, seed: number): string[] {
  const journal = readJournal(),
    fresh: string[] = [];
  for (let i = 0; i < INTERACTIONS.length; i++) {
    const id = INTERACTIONS[i];
    if (mask & (1 << i) && journal[id] === undefined) {
      journal[id] = seed >>> 0;
      fresh.push(id);
    }
  }
  if (fresh.length) saveJson(STORE, journal);
  return fresh;
}
const seenMask = new WeakMap<Crafted, number>();
export function observeDiscoveries(g: Game, owner = g.hero): void {
  if (!owner || saveLock.on || g.mode === 'title') return;
  const w = equippedCraft(owner);
  if (!w?.discoveries || seenMask.get(w) === w.discoveries) return;
  seenMask.set(w, w.discoveries);
  for (const id of recordDiscoveries(w.discoveries, g.seed))
    g.hud.toast(t('craft.found', { name: t('craft.' + id) }));
}
export function craftLink(g: Game, q: URLSearchParams): void {
  for (const id of q.get('craft')?.split(',') ?? []) {
    const part = PARTS.find((p) => p === id);
    if (part) fitPart(g.hero, part);
  }
  if (q.has('journal')) {
    g.paused = true;
    g.screens.discoveryUi.openBook();
  }
  if (q.has('bench')) {
    if (g.mode !== 'shop') g.openShop();
    g.presentShop(g.hero);
    g.screens.openWorkbench();
  }
}
