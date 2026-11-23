import { RULE_BY_ID, RULE_CARDS, ruleTuning as T, type RuleId } from '../data/ruleCards';
import { PASSIVES } from '../data/passives';
import { Rng } from '../core/rng';
import type { Game } from './game';
import { MAX_PASSIVES, type Hero } from './hero';
import type { Enemy } from './enemies';
import { bossLike } from './bossRules';
import type { Offer } from '../ui/screens';
import type { LoadoutItem } from '../ui/hud';
import type { damageWithFeedback } from './juiceCombat';

export const draftTuning = {
  firstPurse: 5,
  scarceStage: 3,
  chance: 0.065,
  reroll: 4,
  geared: 2,
  banish: 5,
  rationGold: 4,
  rationFraction: 0.4,
  rationThreshold: 0.45,
  rationLimit: 2,
};

// Primitive fields are included in the existing HeroPlay migration checkpoint.
export const freshContracts = () => ({
  ruleId: '' as RuleId | '',
  ruleKills: 0,
  ruleTarget: -1,
  ruleSource: '',
  draftNumber: 0,
  rationStage: 0,
  rations: 0,
  pactBoots: 0,
  pactShop: 0,
  pactStage: 0,
  pactPaid: 0,
});

export function ruleOffer(id: string): Offer | undefined {
  const card = RULE_BY_ID.get(id);
  if (card)
    return {
      ...card,
      kind: 'gold',
      cardType: 'rule',
      slot: 'bonus',
      color: '#ffcd75',
      rarity: 'legendary',
      tag: 'RULE CARD',
      label: 'ONE RULE PER HERO',
    };
}

/** Never displace a fusion or either side of a two-way evolution. */
export function shapeHand(g: Game, h: Hero, force?: string): void {
  const hand = h.offers;
  const ordinary = (o: Offer) =>
    o.kind !== 'evo' && o.kind !== 'evolve' && o.kind !== 'fusion' && !o.cardType;
  let last = hand.length - 1;
  while (last >= 0 && !ordinary(hand[last])) last--;
  if (g.stage >= draftTuning.scarceStage && hand.length > 2) {
    if (last >= 0) hand.splice(last--, 1);
    while (last >= 0 && !ordinary(hand[last])) last--;
  }
  // A separate stream keeps unchanged hands from shifting combat or loot RNG.
  const n = ++h.play.draftNumber;
  if (n === 1) h.gold += draftTuning.firstPurse;
  if (g.pvp || last < 0) return;
  const rng = new Rng(g.seed ^ Math.imul(n, 0x85ebca6b) ^ Math.imul(h.index + 1, 0x9e3779b1));
  if (!h.play.ruleId && (force || rng.chance(draftTuning.chance))) {
    const offer = ruleOffer(force ?? rng.pick(RULE_CARDS).id);
    if (offer) {
      // Draw into any ordinary slot. A rare rule should not systematically
      // occupy the last keyboard shortcut or lose every equal-score bot pick.
      const slots = hand.map((card, i) => (ordinary(card) ? i : -1)).filter((i) => i >= 0);
      hand[rng.pick(slots)] = offer;
      while (last >= 0 && !ordinary(hand[last])) last--;
    }
  }
  // A scarce recovery choice spends an upgrade AND money from the Mod shop.
  if (
    last >= 0 &&
    canBuyRation(h, g.stage) &&
    h.player.hp < h.player.maxHp * draftTuning.rationThreshold &&
    !hand.some((o) => o.kind === 'heal')
  ) {
    hand[last] = {
      kind: 'heal',
      id: 'field_ration',
      name: 'Emergency Ration',
      icon: '✚',
      slot: 'bonus',
      tag: 'FIELD MEDIC',
      color: '#a7f070',
      text: canRankHeart(h)
        ? 'Spend 4 gold and this pick to rank up Heart Container (+20 max life), then heal 40% of max life. Two rations per stage.'
        : 'Spend 4 gold and this pick to heal 40% of max life. Two per stage.',
    };
  }
}

function canRankHeart(h: Hero): boolean {
  const rank = h.passives.heart ?? 0;
  return (
    rank < PASSIVES.heart.maxLevel &&
    !h.banished.has('p:heart') &&
    (rank > 0 || Object.keys(h.passives).length < MAX_PASSIVES)
  );
}

export function canBuyRation(h: Hero, stage: number): boolean {
  return (
    !h.player.dead &&
    h.play.ruleId !== 'tithe' &&
    h.gold >= draftTuning.rationGold &&
    (h.play.rationStage !== stage || h.play.rations < draftTuning.rationLimit)
  );
}

export function buyRation(h: Hero, stage: number): boolean {
  if (!canBuyRation(h, stage) || h.player.hp >= h.player.maxHp) return false;
  if (h.play.rationStage !== stage) {
    h.play.rationStage = stage;
    h.play.rations = 0;
  }
  h.play.rations++;
  h.gold -= draftTuning.rationGold;
  if (canRankHeart(h)) {
    h.passives.heart = (h.passives.heart ?? 0) + 1;
    h.recomputeStats();
  }
  h.player.heal(h.player.maxHp * draftTuning.rationFraction);
  return true;
}

export function draftPrices(h: Hero) {
  const id = h.play.ruleId;
  return {
    gold: h.gold,
    reroll: id === 'loaded' ? 1 : h.rerollsLeft ? draftTuning.geared : draftTuning.reroll,
    gear: id !== 'loaded' && h.rerollsLeft > 0,
    banish: draftTuning.banish + (id === 'warrant' ? T.warrantSurcharge : 0),
    healSkip: id === 'fieldkit',
  };
}

export function ruleLoadout(h: Hero): LoadoutItem[] {
  const card = RULE_BY_ID.get(h.play.ruleId);
  return card
    ? [
        {
          ...card,
          desc: card.text,
          kind: 'passive',
          slot: 'bonus',
          rarity: 'legendary',
          color: '#ffcd75',
          max: false,
          level: 1,
        },
      ]
    : [];
}

export function ruleLive(h: Hero): void {
  const s = h.stats;
  switch (h.play.ruleId) {
    case 'anchor':
      s.cooldownMul *= h.player.speed > 1.2 ? 1.15 : 1 / 1.3;
      break;
    case 'redline':
      s.cooldownMul *= h.player.hp < s.maxHp / 2 ? 1 / 1.35 : 1 / 0.9;
      break;
    case 'steady':
      s.damageMul *= 1 + Math.min(0.4, 2 * s.critChance);
      s.critChance = 0;
      break;
    case 'kiln':
      if (h.player.speed > 1.2) {
        s.damageMul *= 1 + Math.min(0.3, Math.max(0, s.armor) * 0.05);
        s.armor = Math.min(s.armor, 0);
      }
      break;
    case 'capacitor':
      s.specialCooldownMul *= 2;
      break;
  }
}

export function hitFactor(h: Hero, e: Enemy, source: string): number {
  const p = h.play;
  switch (p.ruleId) {
    case 'longshot':
      return (e.x - h.player.x) ** 2 + (e.z - h.player.z) ** 2 > T.longshot.range ** 2
        ? T.longshot.far
        : T.longshot.close;
    case 'infield':
      return (e.x - h.player.x) ** 2 + (e.z - h.player.z) ** 2 <= T.infield.range ** 2
        ? T.infield.close
        : T.infield.far;
    case 'quarry':
      return e.elite || bossLike(e) ? T.quarry.big : T.quarry.ordinary;
    case 'opener':
      return e.hp >= e.maxHp ? T.opener.fresh : T.opener.wounded;
    case 'finish':
      return e.hp < e.maxHp * T.finish.threshold ? T.finish.low : T.finish.high;
    case 'relay':
      return !p.ruleSource ? 1 : source !== p.ruleSource ? T.relay.switched : T.relay.repeated;
    case 'lockon':
      return p.ruleTarget === e.uid ? T.lockon.repeated : T.lockon.first;
    case 'exposed':
      return e.exposeT > 0 ? T.exposed.marked : T.exposed.unmarked;
    default:
      return 1;
  }
}

export function withRuleDamage(damage: typeof damageWithFeedback): typeof damageWithFeedback {
  return function (e, base, o, h) {
    if (!h.play.ruleId || o.fixed) return damage.call(this, e, base, o, h);
    const factor = hitFactor(h, e, o.source);
    if (h.play.ruleId !== 'relay' && h.play.ruleId !== 'lockon')
      return damage.call(this, e, base * factor, o, h);
    // Commit before callbacks so a nested zap sees its triggering hit. Rejected hits never advance the chain.
    const target = h.play.ruleTarget,
      source = h.play.ruleSource;
    h.play.ruleTarget = e.uid;
    h.play.ruleSource = o.source;
    const dealt = damage.call(this, e, base * factor, o, h);
    if (!dealt) {
      h.play.ruleTarget = target;
      h.play.ruleSource = source;
    }
    return dealt;
  };
}

export function ruleKill(this: Game, e: Enemy, h: Hero | null): void {
  if (!h || h.player.dead) return;
  const p = h.play;
  if (p.ruleId === 'tithe' && ++p.ruleKills % T.tithe.every === 0) {
    // Use the same rolling healing budget as every other on-kill effect.
    const hp = Math.min(T.tithe.heal, h.player.maxHp - h.player.hp);
    h.player.hp += h.synergy.killHealing.grant(this.runTime, hp, h.player.maxHp);
  }
  if (!e.elite && !bossLike(e)) return;
  if (p.ruleId === 'reserve') {
    h.gold += T.reserveGold;
    this.goldFx(h, T.reserveGold);
  }
  if (p.ruleId === 'capacitor') h.bombCharge = 1;
  if (p.ruleId === 'salvage') h.rerollsLeft = Math.min(5, h.rerollsLeft + 1);
}

type ContractView = [RuleId | '', number, number, number];
const privateViews = new WeakMap<Hero, ContractView>();
export function contractView(h: Hero): ContractView | undefined {
  const p = h.play;
  if (!p.ruleId && !p.pactStage) return;
  const cached = privateViews.get(h);
  if (
    cached &&
    cached[0] === p.ruleId &&
    cached[3] === p.pactStage &&
    cached[1] === p.pactBoots &&
    cached[2] === p.pactShop
  )
    return cached;
  const view: ContractView = [p.ruleId, p.pactBoots, p.pactShop, p.pactStage];
  privateViews.set(h, view);
  return view;
}

/** An older host sends no contract. Client movement stats already travel in the private snapshot. */
export function mirrorContracts(h: Hero, packet: unknown): boolean {
  const c = Array.isArray(packet) ? packet : undefined;
  const id = RULE_BY_ID.get(c?.[0])?.id ?? '';
  const boots = c?.[1] ?? 0,
    shop = c?.[2] ?? 0,
    stage = c?.[3] ?? 0;
  const p = h.play;
  if (id === p.ruleId && stage === p.pactStage && boots === p.pactBoots && shop === p.pactShop)
    return false;
  p.ruleId = id;
  p.pactBoots = boots;
  p.pactShop = shop;
  p.pactStage = stage;
  h.loadoutDirty = true;
  return true;
}

type CoopRoster = ReturnType<typeof import('./systems/coop2').coopState>;
type Contracts = ReturnType<typeof freshContracts>;
type Admission = {
  stash: CoopRoster['stash'];
  peers: CoopRoster['pending'];
  restore: (() => void) | undefined;
};
const admissions = new WeakMap<CoopRoster, Admission>();
const stashed = new WeakMap<CoopRoster['stash'][number], Contracts>();
const contractKeys = Object.keys(freshContracts()) as (keyof Contracts)[];

/** Long disconnects can rebuild the hero on a different seat. Keep the run
 * contract with the existing identity-matched stash across that admission. */
export function prepareRejoins(g: Game, roster: CoopRoster): (() => void) | undefined {
  if (!roster.pending.length || !roster.stash.length) return;
  const cached = admissions.get(roster);
  if (cached?.stash === roster.stash && cached.peers.length === roster.pending.length) {
    let i = 0;
    while (i < cached.peers.length && cached.peers[i] === roster.pending[i]) i++;
    if (i === cached.peers.length) return cached.restore;
  }
  for (const entry of roster.stash) {
    if (stashed.has(entry)) continue;
    const old = g.heroes.find(
      (h) => h.left && (entry.pid ? roster.pids[h.index] === entry.pid : h.name === entry.name),
    );
    if (old)
      stashed.set(
        entry,
        Object.fromEntries(contractKeys.map((k) => [k, old.play[k]])) as Contracts,
      );
  }
  const matches = roster.pending.flatMap((peer) => {
    const entry = roster.stash.find((s) =>
      peer.pid && s.pid ? s.pid === peer.pid : s.name === peer.entry.name,
    );
    const state = entry && stashed.get(entry);
    return state ? [{ id: peer.peerId, state }] : [];
  });
  const restore = matches.length
    ? () => {
        for (const { id, state } of matches) {
          const h = g.heroByPeer(id);
          if (h && !h.left) {
            Object.assign(h.play, state);
            h.loadoutDirty = true;
            h.refreshLive();
          }
        }
      }
    : undefined;
  admissions.set(roster, { stash: roster.stash, peers: [...roster.pending], restore });
  return restore;
}
