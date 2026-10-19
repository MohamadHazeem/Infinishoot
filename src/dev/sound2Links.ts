import type { Game } from '../game/game';
import { INSTRUMENT_IDS, maskOf, type InstrumentId } from '../audio/instruments';
import { crowd, type CrowdReaction } from '../audio/crowd';
import { radio, radioScript, emptyHighlights } from '../audio/radio';
import { soundLane, soundLaneForce } from '../game/systems/sound2';

/**
 * Test-link options for the sound lane, wave 2:
 * - `band=cowbell,sax` (or `band=all`): the run's soundtrack already has these instruments.
 * - `instrument=steel`: that instrument pickup lands near you after a second.
 * - `duelmusic`: hold the boss duel music on (any boss track; try with `bossnow`).
 * - `tension`: hold the comeback music on.
 * - `djnow`: the radio DJ keeps doing sample breaks (a no-hit boss, a big combo) for screenshots of the ON AIR panel.
 * - `audio`: unlock audio without a click (any of these links does it too; headless screenshots).
 * - `crowd=cheer`: the crowd reacts after a second (cheer, roar, applause, whistle, ooh, gasp, boo, aww).
 */
export function sound2Links(game: Game, q: URLSearchParams): void {
  const band = q.get('band');
  if (band) {
    const ids = band === 'all' ? [...INSTRUMENT_IDS] : (band.split(',').filter((b) => INSTRUMENT_IDS.includes(b as InstrumentId)) as InstrumentId[]);
    soundLane(game).band = maskOf(ids);
  }
  const ins = q.get('instrument') as InstrumentId | null;
  if (ins && INSTRUMENT_IDS.includes(ins)) setTimeout(() => (soundLaneForce.instrument = ins), 1000);
  if (q.has('duelmusic')) soundLaneForce.duel = true;
  if (q.has('tension')) soundLaneForce.tension = true;
  // Audio unlocks on the first key press; links that need it running fake one (headless screenshots).
  if (['djnow', 'crowd', 'duelmusic', 'tension', 'band', 'instrument', 'audio'].some((k) => q.has(k))) window.dispatchEvent(new Event('pointerdown'));
  if (q.has('djnow')) {
    const hl = emptyHighlights(game.stage);
    hl.boss = 'Rampage Rex';
    hl.bossTime = 28;
    hl.maxCombo = 312;
    // Keeps the DJ on air (a new break whenever one ends), so screenshots catch the panel.
    setInterval(() => {
      if (!radio.active) radio.start(radioScript(hl));
    }, 500);
  }
  const c = q.get('crowd') as CrowdReaction | null;
  if (c) setTimeout(() => crowd.react(c, 1, true), 1000);
}
