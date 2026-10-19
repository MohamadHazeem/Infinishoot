import type { Game } from '../game/game';
import { startWorldEvent, worldEventForce, worldEventOf } from '../game/systems/worldEvents';
import { WORLD_EVENT_KINDS, worldEventTuning, type WorldEventKind } from '../game/worldEvents';

/**
 * World-events lane test links (called from src/dev/testLinks.ts):
 *   &wev=<kind>     this stage's world event is <kind> (collapse, flood, split, giant, eclipse, flower,
 *                   volcano, stealth), starting `wevat` stage seconds in (default 1; stealth starts at once).
 *                   It stays forced for later stages too.
 *   &wevnow         start it right away instead (skips the stage clock)
 *   &wevt=<s>       once it runs, jump its clock to <s> (screenshots: holes open, water up, giant mid-walk)
 *   &wevoff         no world events at all (classic stage events only)
 * Examples: ?test&god&wev=collapse&wevt=6   ?test&god&stage=2&wev=flood&wevt=12   ?test&god&wev=stealth&night
 */
export function worldEventLinks(game: Game, q: URLSearchParams): void {
  if (q.has('wevoff')) worldEventTuning.enabled = false;
  const k = q.get('wev') as WorldEventKind | null;
  if (!k || !WORLD_EVENT_KINDS.includes(k)) return;
  worldEventForce.kind = k;
  worldEventForce.at = Number(q.get('wevat') ?? 1) || 0;
  if (q.has('wevnow')) startWorldEvent(game, k);
  const jump = Number(q.get('wevt'));
  if (!(jump > 0)) return;
  const iv = setInterval(() => {
    const ev = worldEventOf(game);
    if (!ev) return;
    ev.t = Math.max(ev.t, jump);
    clearInterval(iv);
  }, 50);
}
