import type { Game } from '../game/game';
import { createWeapon } from '../game/weapons';

/** Full kit: weapons3=base (level 1), 5 (max normal), 0/1 (evolved, click fork).
 * weapons3lab isolates that kit from temporary weapons and keeps spawned targets alive.
 */
export function weapons3Links(game: Game, q: URLSearchParams): void {
  if (!q.has('weapons3')) return;
  const tier = q.get('weapons3');
  const h = game.hero;
  for (const w of h.weapons) w.dispose();
  h.weapons.length = 0;
  h.loadoutPick = { ...h.loadoutPick, primary: 'whip', secondary: 'sentry' };
  for (const id of ['whip', 'sentry', 'crosswind', 'tesla', 'swarm', 'prism']) {
    const w = createWeapon(id, game.scene);
    if (tier !== 'base') {
      if (w.build) for (let t = 0; t < 3; t++) for (let r = 0; r < 4; r++) w.addRank(t);
      else while (!w.maxed) w.levelUp();
      if (tier !== '5') w.evolve(w.build && tier === '1' ? 1 : 0);
    }
    h.weapons.push(w);
  }
  h.loadoutDirty = true;
  if (!q.has('weapons3lab')) return;
  game.xpNext = 1e12;
  game.director.hold = true;
  game.gameplayPreWeapons = () => {};
  game.updateGameplay = () => {};
  game.gpOnKill = () => {};
  game.gpCashIn = () => '';
  game.runEvents.update = () => {};
  game.runEvents.onKill = () => {};
  game.tryBomb = () => {};
  game.tryUlt = () => {};
  for (const e of game.enemies.list) if (e.active) e.hp = e.maxHp = 1e6;
  game.hud.showBanner('', '', 0.01);
  game.hud.toast('', 0.01);
}
