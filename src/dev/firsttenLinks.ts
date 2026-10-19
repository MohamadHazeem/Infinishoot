import { GOALS, type GoalId } from '../game/firstten';
import { cheats, type Game } from '../game/game';
import { save } from '../game/save';
import { settings } from '../game/settings';

/**
 * Test-link options for the firstten lane (see src/dev/testLinks.ts):
 *   &fresh                 a brand-new save in memory (no runs, tips, unlocks), back on the title: FIRST STEPS + training offer
 *   &ftgoals=run,chest     ...with these FIRST STEPS goals ticked (&ftgoals=all: the reward panel)
 *   &ftmodes               PLAY SOLO as a new player (QUICK START strip)
 *   &ftshop                a new player's first starting shop (curated Mods, GOOD FIRST PICK, helper strip)
 *   &ftlvl                 a new player's first level-up (helper strip, blinking ribbons)
 *   &ftdie=Rhino           game over after 1.5 s, killed by that cause (enemy name or 'Enemy fire', 'Lava'...): NEXT TRY card
 *     &ftat=50             ...at that stage time (seconds), &ftdash=10 with that many dashes
 *   &ftguided              this run counts as a new player's (stage-1 heads-ups, early chest toast)
 */
export function firsttenLinks(game: Game, q: URLSearchParams): void {
  const ft = game.firstten;
  const fresh = q.has('fresh') || q.has('ftmodes') || q.has('ftshop') || q.has('ftlvl') || q.has('ftdie') || q.has('ftguided');
  if (fresh) {
    save.lifetime.runs = 0;
    save.tips = [];
    save.firstten = { done: [], hidden: false, claimed: false, seen: [] };
    save.training = { offered: false, done: false };
    cheats.unlockAll = false;
  }
  const goals = q.get('ftgoals');
  if (goals) save.firstten.done = goals === 'all' ? GOALS.map((g) => g.id) : (goals.split(',') as GoalId[]);
  if (q.has('fresh')) game.leaveToTitle(); // shows the title (and the training offer, once)
  if (q.has('ftmodes')) {
    game.leaveToTitle();
    game.screens.show('modes');
  }
  if (fresh && !q.has('fresh') && !q.has('ftmodes')) ft.guided = true;
  if (q.has('ftshop')) {
    const h = game.hero;
    game.preShop = true;
    h.gold = 15;
    game.openShop();
  }
  if (q.has('ftlvl')) game.debugLevelUp();
  const cause = q.get('ftdie');
  if (cause) {
    settings.deathReplay = false;
    setTimeout(() => {
      const h = game.hero;
      const p = h.player;
      game.director.time = Number(q.get('ftat') ?? 50);
      h.dashes = Number(q.get('ftdash') ?? 10);
      cheats.god = false;
      p.invuln = 0;
      h.revivesLeft = 0;
      h.lastHitBy = cause;
      if (p.hurt(p.hp + 1, 0, 1)) game.onHeroDown(h);
    }, 1500);
  }
}
