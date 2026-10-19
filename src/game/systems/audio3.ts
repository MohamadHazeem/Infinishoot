/** Local audio decisions use existing mirrored state; no gameplay or snapshot changes. */
import type { Hero } from '../hero';
import { playBanter } from '../../audio/teammateVoice';
import type { Game } from '../game';
import type { TrackId } from '../../audio/music/composition';
import { sfx } from '../../audio/sfx';

export function encounterTrack(track: TrackId | null, mode: string, boss: boolean, haunted: boolean, pvp: boolean): TrackId | null {
  if (track === 'title') return 'titleRemix';
  if (track === null || track === 'shop') return track;
  if (pvp) return 'pvp';
  if (boss && haunted) return 'pumpking';
  if (mode === 'raid' && boss) return 'raid';
  if (mode === 'gauntlet' && !boss) return 'gauntlet';
  return track;
}
interface State { mode: string; screen: string }
const states = new WeakMap<Game, State>();
const dead = new WeakMap<Hero, boolean>();
/** Rewards are local profile events; initializing/loading a save never plays a backlog. */
export function updateAudio3(g: Game): void {
  let state = states.get(g);
  if (!state) { states.set(g, { mode: g.mode, screen: g.screens.current }); return; }
  if (g.screens.current === 'mvp' && state.screen !== 'mvp') sfx.named('trophy');
  if (g.mode === 'dead' && state.mode !== 'dead' && !g.pvp) sfx.named('defeatSting');
  state.mode = g.mode; state.screen = g.screens.current;
  for (const h of g.heroes) {
    const wasDead = dead.get(h);
    dead.set(h, h.player.dead);
    if (!wasDead || h.player.dead || h.left || g.heroes.length < 2 || !g.isCombatMode) continue;
    const dx = h.player.x - g.hero.player.x, dz = h.player.z - g.hero.player.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 40) playBanter(`banter:${h.heroDef.id}:thanks`, h.player.x, h.player.z, dx / 14, Math.max(0.35, 1 - distance / 40));
  }
}
