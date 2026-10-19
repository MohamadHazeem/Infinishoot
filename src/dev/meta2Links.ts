import type { Game } from '../game/game';
import { save } from '../game/save';
import { xpForLevel } from '../data/profile';
import { ACHIEVEMENTS } from '../data/meta';
import { QUEST_BY_ID } from '../data/quests';
import { meta2Ui, ensureQuests } from '../game/systems/meta2';

/**
 * meta2 test links (profile, quests, achievements):
 * - `m2screen=profile|achievements` opens that screen; `m2screen=title` shows the title with its quest panel.
 * - `m2lv=37` sets the profile level; `m2demo` fills lifetime stats, kills, best runs and a few achievements (screenshots).
 * - `m2quests=0.5` sets today's quest progress to that fraction (1 = all done).
 * - `m2pet=bit` gives this hero a pet (to see the hat).
 * - `m2equip=hat_party,tr_ember,h_lime,b_plum,t_ranger` equips cosmetics (needs the level: use with m2lv).
 */
export function meta2Links(game: Game, q: URLSearchParams): void {
  const P = save.profile;
  if (q.has('m2lv')) P.xp = xpForLevel(Math.max(1, Math.min(100, Number(q.get('m2lv')) || 1))) + 10;
  if (q.has('m2demo')) {
    Object.assign(P.stats, { runs: 64, time: 52_000, kills: 48_210, bosses: 71, stages: 160, k_elite: 410, chests: 520, evolutions: 88, parries: 140, perfectDashes: 380, ultimates: 61, flawless: 4, stage: 9, level: 63, combo: 412, b_king: 22, b_rex: 19, b_queen: 17, b_omega: 9, b_titan: 2, b_remix: 3, k_mini: 31, k_reaper: 1, coopRuns: 12, coopStages: 30, revives: 14, pvpDuels: 5, pvpWins: 2, k_fire: 6400, quests: 12 });
    Object.assign(P.killsBy, { swarmer: 18_000, bopper: 9_400, zippy: 6_100, v_swarmer: 2_300, shooter: 2_900, chonk: 1_700, charger: 1_400, splitter: 1_100, golden: 38 });
    P.heroRuns = { rookie: 30, ace: 18, duelist: 9, bulwark: 7 };
    P.kitRuns = { 'scatter/grenade/thunder': 22, 'buster/charge/bomb': 18 };
    P.sets.heroes = ['rookie', 'ace', 'duelist', 'bulwark'];
    P.sets.biomes = ['meadow', 'dunes', 'peaks', 'magma', 'neon', 'factory'];
    const run = (date: string, mode: string, label: string, hero: string, score: number, stage: number) => ({ date, mode, label, hero, score, stage, kills: Math.round(score / 40), time: stage * 260 });
    P.timeline = [run('2026-10-02', 'standard', 'STANDARD', 'Rookie', 182_000, 4), run('2026-10-06', 'endless', 'ENDLESS', 'Ace', 240_500, 6), run('2026-10-11', 'standard', 'STANDARD · HARD', 'Duelist', 410_200, 7), run('2026-10-15', 'daily', 'DAILY', 'Ace', 96_400, 3), run('2026-10-18', 'standard', 'STANDARD', 'Rookie', 520_900, 9)];
    P.best = { standard: P.timeline[4], endless: P.timeline[1], daily: P.timeline[3] };
    for (const a of ACHIEVEMENTS.slice(0, 40)) if (!save.achievements.includes(a.id)) {
      save.achievements.push(a.id);
      save.achDates[a.id] = '2026-10-1' + (a.id.length % 9);
    }
  }
  if (q.has('m2quests')) {
    ensureQuests();
    const f = Math.max(0, Math.min(1, Number(q.get('m2quests')) || 0));
    save.quests.done = save.quests.ids.map(() => f >= 1);
    save.quests.prog = save.quests.ids.map((id) => Math.floor(f * QUEST_BY_ID[id].goal));
  }
  const eq = q.get('m2equip');
  if (eq) for (const id of eq.split(',')) {
    const kind = id.startsWith('hat_') ? 'hat' : id.startsWith('tr_') ? 'trail' : id.startsWith('h_') ? 'hud' : id.startsWith('b_') ? 'banner' : id.startsWith('t_') ? 'title' : '';
    if (kind) P.equip[kind] = id;
  }
  const pet = q.get('m2pet');
  if (pet) game.hero.setPet(pet);
  const scr = q.get('m2screen');
  if (scr === 'profile' || scr === 'achievements') {
    // Opened a moment later: the run's opening (sky fall, starting shop) may still switch screens.
    const open = () => {
      game.paused = true;
      const ui = meta2Ui(game);
      if (scr === 'profile') ui.profile.open();
      else ui.ach.open();
    };
    open();
    setTimeout(open, 1500);
  }
}
