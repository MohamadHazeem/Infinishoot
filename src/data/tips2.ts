import { t } from '../i18n';
import { tips2En } from '../i18n/tips2';
import { promptText, type PromptId } from '../ui/prompts';
import type { TipDef } from '../game/tips';

/**
 * tips2 lane: first-time tips for the mechanics added in Milestones 9-11 and
 * the overnight lanes. Text and rules only; detection lives in
 * src/game/systems/tips2.ts and they run through the same queue as the
 * original tips (src/game/tips.ts, src/game/onboarding.ts): one at a time,
 * a gap between in-fight tips, off with SETTINGS > TIPS, once per save.
 */
export const TIP2_IDS = [
  // time, gameplay
  'rewind', 'laststand', 'cashin', 'mech', 'crate', 'mutation', 'overload',
  // co-op
  'teammove', 'teamult', 'revivepool', 'carry', 'tether', 'trading', 'pingwheel', 'roles', 'dropin', 'coopobj',
  // skill
  'parry', 'perfectdash',
  // build, run and modes
  'fusion', 'route', 'heat', 'gauntlet', 'ascension', 'rhythm', 'pacifist', 'minigame',
  // raid
  'raid', 'raidparry', 'raidstump', 'raidcore', 'raidover',
  // competitive
  'race', 'pvp', 'pvpteams', 'pvprounds',
  // secrets, seasons, pets
  'secret', 'goldbug', 'candy', 'petskill',
  // heroes
  'ronin', 'tinker',
  // bosses and enemies
  'glitch', 'boxer', 'gale', 'pumpking', 'titan', 'omega', 'remix', 'miniboss', 'secretboss', 'reaper', 'swarmqueen', 'mirror', 'burrower', 'ghost',
  // world events
  'collapse', 'flood', 'split', 'giant', 'eclipse', 'flower', 'volcano', 'stealth',
] as const;
export type Tip2Id = (typeof TIP2_IDS)[number];

/** Button label for a prompt id, following the device; pads without a glyph for it fall back to the key. */
export function btn(id: PromptId): string {
  return promptText(id) || promptText(id, 'kbm');
}

/** Which prompts a tip names (⟪k⟫, ⟪k2⟫ in its text). */
const KEYS: Partial<Record<Tip2Id, [PromptId, PromptId?]>> = {
  rewind: ['rewind'],
  cashin: ['cash', 'cashpick'],
  mech: ['dash'],
  teammove: ['team'],
  teamult: ['ult'],
  revivepool: ['team'],
  carry: ['interact'],
  trading: ['trade'],
  pingwheel: ['ping'],
  parry: ['parry'],
  perfectdash: ['dash'],
  raidparry: ['parry'],
  ronin: ['fire', 'charge'],
  tinker: ['charge'],
};

/** Seconds on screen for the longer ones (the rest go by length, 5-9 s). */
const TIME: Partial<Record<Tip2Id, number>> = { raid: 10, cashin: 9, teammove: 9, stealth: 9, ronin: 9, trading: 9 };

/** Queue priority (lower first; the original tips use 0-4, unlisted ones 9): danger first, trivia last. */
export const TIP2_PRIORITY: Partial<Record<Tip2Id, number>> = {
  collapse: 0, volcano: 1, giant: 1, raidstump: 0, raidparry: 1, raidcore: 1, raidover: 1, raid: 1,
  reaper: 1, glitch: 1, boxer: 1, gale: 1, pumpking: 1, titan: 1, omega: 1, secretboss: 1, swarmqueen: 2,
  revivepool: 0, carry: 1, laststand: 2, rewind: 3, mech: 3, crate: 3, pvp: 0, race: 0, stealth: 2,
};

/** Tips that belong to a menu (shown only while it is open, ahead of the rest). */
export const TIP2_MENUS: Partial<Record<Tip2Id, 'route'>> = { route: 'route' };

function def(id: Tip2Id): TipDef {
  const keys = KEYS[id];
  return {
    // Titles stay canonical English; the tip panel localizes them (the catalog holds the Arabic).
    title: tips2En[`tips2.${id}.title`],
    text: () => t(`tips2.${id}.text`, keys ? { k: btn(keys[0]), k2: keys[1] ? btn(keys[1]) : '' } : {}),
    time: TIME[id],
  };
}

export const TIPS2 = Object.fromEntries(TIP2_IDS.map((id) => [id, def(id)])) as Record<Tip2Id, TipDef>;
