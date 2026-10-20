/**
 * Item sets test links (called from applyTestLink, src/dev/testLinks.ts):
 *
 *   &relics=r_cinder,r_keg       own these relics
 *   &set=inferno:4,storm:2       own that many pieces of each set (relics, then items, Mods, auto weapons)
 *   &setpause=2                  open the pause screen (build + SETS panel) after 2 s
 *
 *   ?test&god&set=inferno:6&setpause=3      ?test&set=boomsmith:3&levelup      ?test&set=storm:3&shop&gold=60
 */
import { MOD_BY_ID } from '../data/mods';
import { PASSIVES } from '../data/passives';
import { RELIC_BY_ID } from '../data/relics';
import { WEAPONS } from '../data/weapons';
import { setMembers, type SetId, SETS } from '../data/sets';
import { countPieces } from '../game/systems/sets';
import { SET_INDEX } from '../data/sets';
import { setsView } from '../ui/setsUi';
import type { Game } from '../game/game';

export function setsLinks(game: Game, q: URLSearchParams): void {
  const h = game.hero;
  const list = (k: string) => (q.get(k) ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  for (const id of list('relics')) if (RELIC_BY_ID[id] && !h.relics.includes(id)) h.relics.push(id);
  for (const s of list('set')) {
    const [id, n] = s.split(':');
    if (!SETS.some((d) => d.id === id)) continue;
    const want = Number(n) || 2;
    const idx = SET_INDEX[id as SetId];
    const members = setMembers(id as SetId);
    const order = [
      ...members.filter((m) => RELIC_BY_ID[m]),
      ...members.filter((m) => PASSIVES[m] && !PASSIVES[m].coop),
      ...members.filter((m) => MOD_BY_ID[m] && !MOD_BY_ID[m].coop),
      ...members.filter((m) => WEAPONS[m] && !WEAPONS[m].slot),
    ];
    for (const m of order) {
      if (countPieces(h, h.sets.scratch)[idx] >= want) break;
      if (RELIC_BY_ID[m] && !h.relics.includes(m)) h.relics.push(m);
      else if (PASSIVES[m] && !h.passives[m]) h.passives[m] = 1;
      else if (MOD_BY_ID[m] && !h.synergy.owns(m) && !h.synergy.full) h.synergy.add(MOD_BY_ID[m], MOD_BY_ID[m].price);
      else if (WEAPONS[m] && !h.weapons.some((w) => w.def.id === m)) game.debugGiveWeapon(m);
    }
  }
  if (q.has('relics') || q.has('set')) {
    h.recomputeStats();
    h.loadoutDirty = true;
  }
  countPieces(h, h.sets.counts);
  setsView.counts = h.sets.counts; // the level-up/shop chips may render before the first frame
  const p = Number(q.get('setpause'));
  if (p > 0) setTimeout(() => game.pause(), p * 1000);
}
