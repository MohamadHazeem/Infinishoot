/**
 * Banish (level-up cards) and lock (shop Mods), shop lane. Run-only state on
 * the Hero; nothing persists past the run.
 *
 * Banish: a charge removes a card's item from this hero's offer pool for the
 * rest of the run and redraws just that card. Charges: `start` per run, plus
 * `perShop` at every stage-clear shop, up to `max`.
 * Lock: a locked shop Mod stays on its card through rerolls and into the next
 * shop, until bought or unlocked.
 */
import type { Offer } from '../ui/screens';

export const banishTuning = {
  start: 2, // charges at the start of a run
  perShop: 1, // more at every stage-clear shop (not the starting shop)
  max: 5,
};

/** Pool key of a level-up card: the item (or the track) it would add. Unique per card in one draw. */
export function offerKey(o: Pick<Offer, 'kind' | 'id' | 'pick'>): string {
  const [ref, what, k] = (o.pick ?? '').split('|');
  switch (o.kind) {
    case 'weapon':
      return 'w:' + o.id.replace(/_evo$/, '');
    case 'passive':
      return 'p:' + o.id;
    case 'special':
      return 'sp';
    case 'track':
      return `t:${ref}|${k}`;
    case 'overdrive':
      return 'od:' + ref;
    case 'evo':
      return `e:${ref}|${what}|${k}`;
    default:
      return `${o.kind}:${o.id}`;
  }
}

/** Evolution choices and bonus cards can't be banished (a fork is a forced choice; bonus cards only show when the pool is dry). */
export function canBanish(o: Pick<Offer, 'kind'>): boolean {
  return o.kind === 'weapon' || o.kind === 'passive' || o.kind === 'special' || o.kind === 'track' || o.kind === 'overdrive';
}
