import type { Game } from '../game/game';
import { PET_BY_ID } from '../data/pets';
import { unlockedWeapons } from '../game/save';

/**
 * Test-link options for the companion lane (called from applyTestLink):
 * - `pet=bit|guardian|sparky`: this hero's pet; `petlv=1..5`: its level
 * - `mate` (or `mate=sparky`): a standing dummy teammate (with that pet) next
 *   to you, so co-op things show in a solo test (TEAM meter, high-fives)
 * - `teamfull`: the TEAM meter starts full; `teamgo=<s>`: fire a team move
 *   after <s> seconds (with `mate`); `teammove=beam|nova|meteor` picks which
 * - `teamloop=<s>`: refill and fire a team move every <s> seconds (no level-up menus)
 * - `taunt`: the pet taunts right away (needs 3 enemies nearby, e.g. `spawn=chonk:6`)
 * - `downmate=<s>`: the dummy teammate goes down after <s> seconds (revive it for a high-five)
 */
export function companionLinks(game: Game, q: URLSearchParams): void {
  const h = game.hero;
  const pet = q.get('pet');
  if (pet && PET_BY_ID[pet]) h.setPet(pet);
  const lv = Number(q.get('petlv')) || 1;
  for (let i = 1; i < lv; i++) h.petState.levelUp();
  h.recomputeStats();
  if (q.has('mate')) {
    const mp = q.get('mate') || 'bit';
    const mate = game.makeHero(1, 'Buddy', unlockedWeapons(), '', 'classic', PET_BY_ID[mp] ? mp : 'bit');
    mate.startRun();
    for (let i = 1; i < lv; i++) mate.petState.levelUp();
    game.setHeroes([h, mate]);
    mate.player.teleport(h.player.x + 2, h.player.z + 0.5);
    mate.player.showWhenDead = true;
    mate.player.invuln = 0;
    // The dummy has no input: tick its timers so flashes and i-frames wear off.
    setInterval(() => mate.player.tickTimers(1 / 30), 33);
    h.player.showWhenDead = true;
  }
  const s = game.companionState();
  const order = ['beam', 'nova', 'meteor'];
  const mv = order.indexOf(q.get('teammove') ?? '');
  if (mv >= 0) s.meter.next = mv;
  if (q.has('teamfull')) s.meter.charge = 1;
  if (q.has('taunt')) h.petState.tauntCd = 0.05;
  const go = Number(q.get('teamgo'));
  if (go > 0) {
    setTimeout(() => {
      s.meter.charge = 1;
      game.tryTeamMove(h);
    }, go * 1000);
  }
  // teamloop=<s>: refill and fire a team move every <s> seconds (screenshots); no level-up menus meanwhile.
  const loop = Number(q.get('teamloop'));
  if (loop > 0) {
    game.xpNext = 1e12;
    setInterval(() => {
      s.meter.charge = 1;
      if (!s.move) game.tryTeamMove(h);
    }, loop * 1000);
  }
  const down = Number(q.get('downmate'));
  if (down > 0 && game.heroes[1]) {
    setTimeout(() => {
      const m = game.heroes[1];
      m.revivesLeft = 0;
      m.petState.reviveUsed = true;
      m.player.invuln = 0;
      if (m.player.hurt(m.player.hp + 1, 1, 0)) game.onHeroDown(m);
    }, down * 1000);
  }
}
