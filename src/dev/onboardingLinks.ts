import { codexEntries } from '../data/codex';
import { cheats, type Game } from '../game/game';
import { save } from '../game/save';
import { TIPS, type TipId } from '../game/tips';
import { drawBuildCard } from '../ui/buildCard';

/**
 * Test-link options for the onboarding lane (see src/dev/testLinks.ts):
 *   &training=4        start the TRAINING field at step 4 (1-based; &training alone = step 1)
 *   &trainingdone      the "you're ready" screen
 *   &tip=boss          show a first-time tip now (any id in src/game/tips.ts)
 *   &lvlup             a level-up now (&lvlup&tip=levelup: the tip over the cards)
 *   &discover=all      mark every codex entry discovered (or &discover=40: the first 40)
 *   &recap             a sample 4-stage run timeline, then game over (unlock progress + recap + BUILD CARD)
 *   &offer             the title screen with the first-time training offer
 *   &recap&card        ...and the BUILD CARD drawn on top (what the PNG looks like)
 *   ?test&screen=codex opens the Codex (any screen name works with &screen)
 */
export function onboardingLinks(game: Game, q: URLSearchParams): void {
  const ob = game.onboarding;
  const disc = q.get('discover');
  if (disc) {
    const all = codexEntries().map((e) => e.key);
    save.discovered = disc === 'all' ? all : all.filter((_, i) => i % 2 === 0).slice(0, Number(disc) || 40);
    if (game.screens.current === 'codex') ob.ui.renderCodex(save.discovered);
  }
  if (q.has('training')) ob.startTraining(Math.max(0, (Number(q.get('training')) || 1) - 1));
  if (q.has('trainingdone')) {
    ob.startTraining(8);
    ob.advance();
  }
  // &lvlup: a level-up now (with &tip=levelup, the level-up tip over the cards).
  if (q.has('lvlup')) game.debugLevelUp();
  const tip = q.get('tip') as TipId | null;
  if (tip && TIPS[tip]) {
    save.tips = save.tips.filter((t) => t !== tip);
    ob.want(tip);
  }
  if (q.has('offer')) {
    game.leaveToTitle();
    ob.ui.setOffer(true);
    game.screens.show('title');
    ob.ui.setOffer(true);
  }
  if (q.has('recap')) {
    // A made-up four-stage run for the game-over screen (dev only).
    const r = ob.recorder;
    r.reset();
    const stages = [
      { stage: 1, level: 14, kills: 812, damage: 61000, gold: 64, time: 262, bossTime: 31 },
      { stage: 2, level: 23, kills: 1490, damage: 214000, gold: 81, time: 268, bossTime: 27 },
      { stage: 3, level: 31, kills: 2133, damage: 520000, gold: 96, time: 275, bossTime: 44 },
      { stage: 4, level: 37, kills: 1720, damage: 610000, gold: 40, time: 190, bossTime: -1 },
    ];
    r.stages.push(...stages);
    game.stage = 4;
    game.level = 37;
    game.kills = stages.reduce((a, s) => a + s.kills, 0);
    game.score = 1234567;
    game.runTime = stages.reduce((a, s) => a + s.time, 0);
    const h = game.hero;
    for (const id of ['drones:6', 'lightning:3']) {
      const [w, n] = id.split(':');
      for (let i = 0; i < Number(n); i++) game.debugGiveWeapon(w);
    }
    h.passives.armor = 3;
    h.passives.magnet = 2;
    h.passives.power_cell = 4;
    for (const m of ['demolition', 'glass_cannon', 'echo']) game.debugGiveMod(m);
    h.relics.push('r_dashbomb', 'r_crown');
    h.recomputeStats();
    // Keep the made-up timeline: game over reads it as recorded.
    r.sample = () => {};
    cheats.god = false;
    const p = h.player;
    p.invuln = 0;
    h.revivesLeft = 0;
    if (p.hurt(p.hp + 1, 0, 1)) game.onHeroDown(h);
    if (q.has('card')) {
      const show = () => {
        if (!ob.card) return void setTimeout(show, 200);
        void drawBuildCard(ob.card).then((cv) => {
          const img = document.createElement('img');
          img.src = cv.toDataURL();
          img.style.cssText = 'position:fixed;inset:0;margin:auto;width:min(100vw,1280px);z-index:99;image-rendering:pixelated';
          document.body.appendChild(img);
        });
      };
      show();
    }
  }
}
