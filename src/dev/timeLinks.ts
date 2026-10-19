import { cheats, type Game } from '../game/game';
import { timeDebug, timeTuning } from '../game/timeRules';
import { debugBulletTime, forceClutch, timeState } from '../game/systems/time';

/**
 * Test-link options for the time lane (called from applyTestLink, after the
 * companion lane's `mate`). Times are seconds of play:
 * - `rewindgo=<s>`: press REWIND after s seconds (`rewindat=<0..1>` pins the
 *   backward playback there, for screenshots). Try with `swarm=80`.
 * - `standgo=<s>`: a killing blow lands after s seconds with a x60 combo
 *   going: the LAST STAND (`standkills=<n>` starts its counter at n).
 * - `btgo=<s>`: a bullet-time dodge after s seconds (`btat=<0..1>` pins the
 *   camera swing).
 * - `replaygo=<s>`: die after s seconds; the death replay follows
 *   (`replayat=<0..1>` pins it, 1 = the "so close" card).
 * - `clutchgo=<s>` (with `mate`): the teammate goes down next to you at s,
 *   you're at low life, and the revive 3 s later is a clutch save
 *   (`clutchat=<0..1>` pins the cutscene).
 * - `votego=<s>` (with `mate`): press REWIND at s: the TEAM REWIND vote opens
 *   (the dummy teammate never agrees).
 */
export function timeLinks(game: Game, q: URLSearchParams): void {
  // Seconds of play (not wall time: a slow headless browser runs the game slower than real time).
  const later = (key: string, fn: () => void) => {
    const s = Number(q.get(key));
    if (!(s > 0)) return;
    const t0 = game.runTime;
    const id = setInterval(() => {
      if (game.runTime - t0 < s) return;
      clearInterval(id);
      fn();
    }, 16);
  };
  const pinWhen = (key: string, ready: () => boolean) => {
    const at = q.get(key);
    if (at === null) return;
    const id = setInterval(() => {
      if (!ready()) return;
      timeDebug.pin = Math.max(0, Math.min(1, Number(at) || 0));
      clearInterval(id);
    }, 16);
  };
  const lethal = () => {
    cheats.god = false;
    const h = game.hero;
    const p = h.player;
    h.revivesLeft = 0;
    p.invuln = 0;
    p.hp = 1;
    game.hurtHero(h, 999, p.x + p.aim.x, p.z + p.aim.z, null, 'Test link');
  };
  later('rewindgo', () => game.requestRewind(game.hero));
  pinWhen('rewindat', () => timeState(game).hold?.kind === 'rewind');
  later('standgo', () => {
    game.combo = Math.max(game.combo, timeTuning.standCombo + 10);
    timeState(game).lastCombo = game.combo;
    lethal();
    const n = Number(q.get('standkills'));
    const ht = timeState(game).heroes[game.local];
    if (n > 0 && ht) ht.standKills = n;
  });
  later('btgo', () => debugBulletTime(game));
  pinWhen('btat', () => timeState(game).view?.kind === 'bt');
  later('replaygo', () => {
    game.combo = 0;
    timeState(game).lastCombo = 0;
    lethal();
  });
  pinWhen('replayat', () => timeState(game).hold?.kind === 'replay');
  later('clutchgo', () => {
    const mate = game.heroes[1];
    if (!mate) return;
    const me = game.hero.player;
    const p = mate.player;
    p.invuln = 0;
    if (p.hurt(p.hp + 1, 1, 0)) game.onHeroDown(mate);
    me.teleport(p.x - 1.2, p.z + 0.4);
    me.hp = Math.min(me.hp, me.maxHp * 0.2);
    forceClutch.on = true;
  });
  pinWhen('clutchat', () => timeState(game).view?.kind === 'revive');
  later('votego', () => game.requestRewind(game.hero));
}
