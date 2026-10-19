import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { ok } from './check';
import { PEAK_STATS, PROFILE_REWARDS, REWARD_BY_ID, STAT_NAMES, cleanSummary, levelOf, profileTuning, rewardsBetween, runXp, xpForLevel } from '../src/data/profile';
import { QUESTS, QUEST_ALL_BONUS, QUEST_BY_ID, QUEST_XP, dailyQuests, questText } from '../src/data/quests';
import { ACHIEVEMENTS, ACH_CATS } from '../src/data/meta';
import { normalize, save, resetSave, SET_KEYS, grantAchievement } from '../src/game/save';

// ---------------------------------------------------------------- profile levels and XP
ok(xpForLevel(1) === 0 && xpForLevel(2) === 100 && xpForLevel(3) === 225, 'level curve starts at 100 XP, +25 per level');
ok(xpForLevel(100) === 131175, 'level 100 needs 131,175 XP');
let mono = true;
for (let l = 2; l <= 100; l++) if (xpForLevel(l) <= xpForLevel(l - 1) || levelOf(xpForLevel(l)).level !== l || levelOf(xpForLevel(l) - 1).level !== l - 1) mono = false;
ok(mono, 'levelOf inverts xpForLevel for every level');
ok(levelOf(1e9).level === 100 && levelOf(1e9).frac === 1, 'levels stop at 100');
const xp = runXp({ time: 600, kills: 1000, k_elite: 10, bosses: 2, stages: 2 });
ok(xp.time === 60 && xp.kills === 150 && xp.bosses === 100 && xp.stages === 80 && xp.coop === 0 && xp.total === 390, `run XP adds time, kills, bosses and stages (${JSON.stringify(xp)})`);
const coopXp = runXp({ time: 600, kills: 1000, k_elite: 10, bosses: 2, stages: 2, coopRuns: 1 });
ok(coopXp.coop === 97 && coopXp.total === 487, 'co-op runs earn 25% more');
ok(runXp({ time: 1e7, kills: 1e7 }).total === profileTuning.runCap, 'one run is capped');
ok(rewardsBetween(1, 10).map((r) => r.id).join() === 't_cadet,tr_dust,b_teal,t_scrapper,hat_cap,h_lime,t_gunner,b_plum', 'level rewards between 1 and 10');
ok(new Set(PROFILE_REWARDS.map((r) => r.id)).size === PROFILE_REWARDS.length && PROFILE_REWARDS.filter((r) => r.level === 100).length === 1, 'reward ids unique, one capstone at 100');
ok(['title', 'banner', 'hud', 'hat', 'trail'].every((k) => PROFILE_REWARDS.filter((r) => r.kind === k).length >= 5), 'at least five rewards of every kind');
ok(PROFILE_REWARDS.every((r) => r.kind === 'title' || r.kind === 'trail' || /^#[0-9a-f]{6}$/i.test(r.color ?? '')), 'coloured rewards carry a colour');
ok(cleanSummary({ lv: 12, title: 't_ranger', banner: '#257179' })?.title === 'Ranger' && cleanSummary({ lv: 400 }) === null && cleanSummary({ lv: 3, title: 'x', banner: 'red' })?.banner === '#29366f', 'lobby summaries are cleaned');

// ---------------------------------------------------------------- quests
const q1 = dailyQuests('2026-10-19');
ok(q1.map((q) => q.tier).join() === 'easy,medium,hard' && new Set(q1.map((q) => q.stat)).size === 3, 'three quests a day: easy, medium, hard, on different stats');
ok(dailyQuests('2026-10-19').map((q) => q.id).join() === q1.map((q) => q.id).join(), 'quests are seeded by the date');
const seen = new Set<string>();
for (let d = 1; d <= 28; d++) for (const q of dailyQuests(`2026-11-${String(d).padStart(2, '0')}`)) seen.add(q.id);
ok(seen.size >= 15, `quests rotate over a month (${seen.size} different)`);
ok(QUESTS.every((q) => q.stat in STAT_NAMES), 'every quest reads a known stat');
ok(questText(QUEST_BY_ID.q_fire500) === 'Defeat 500 enemies with fire' && questText(QUEST_BY_ID.q_time10) === 'Survive 10 minutes in total', 'quest text fills in the goal');

// ---------------------------------------------------------------- achievements
ok(ACHIEVEMENTS.length >= 95 && ACHIEVEMENTS.length <= 110, `about 100 achievements (${ACHIEVEMENTS.length})`);
ok(new Set(ACHIEVEMENTS.map((a) => a.id)).size === ACHIEVEMENTS.length, 'achievement ids unique');
ok(new Set(ACHIEVEMENTS.map((a) => a.name)).size === ACHIEVEMENTS.length, 'achievement names unique');
ok(ACHIEVEMENTS.every((a) => a.tier && a.cat && ACH_CATS.some((c) => c.id === a.cat)), 'every achievement has a medal and a category');
for (const t of ['bronze', 'silver', 'gold']) ok(ACHIEVEMENTS.filter((a) => a.tier === t).length >= 15, `enough ${t} medals`);
ok(ACHIEVEMENTS.filter((a) => a.hidden).length >= 5, 'hidden achievements');
ok(ACHIEVEMENTS.every((a) => !a.track || (a.track.scope === 'plevel' ? true : a.track.scope === 'set' || a.track.scope === 'has' ? (SET_KEYS as string[]).includes(a.track.stat) : a.track.stat in STAT_NAMES)), 'measured achievements read known stats and sets');
ok(ACHIEVEMENTS.every((a) => !a.track || (a.track.scope === 'run') === PEAK_STATS.has(a.track.stat) || a.track.scope !== 'run' && a.track.scope !== 'life'), 'one-run goals read peak stats, lifetime goals read sums');
ok(ACHIEVEMENTS.filter((a) => a.track).every((a) => !a.unlockWeapon && !a.unlockLoadout), 'new achievements are cosmetic only (no unlocks)');
for (const c of ['combat', 'bosses', 'modes', 'ascension', 'coop', 'skill', 'builds', 'world', 'secrets', 'profile']) ok(ACHIEVEMENTS.some((a) => a.cat === c), 'category ' + c);

// ---------------------------------------------------------------- save migration
const v4 = normalize({
  version: 4,
  achievements: ['first_steps', 'stage_2'],
  lifetime: { runs: 20, kills: 9000, elites: 40, bosses: 12, bestStage: 5, bestLevel: 44, playTime: 14400 },
  history: [
    { date: '2026-10-01', label: 'STANDARD', hero: 'Ace', stage: 4, score: 120000, kills: 2000, time: 1300, level: 30, cause: 'Rex', weapons: [] },
    { date: '2026-10-02', label: 'STANDARD', hero: 'Rookie', stage: 2, score: 40000, kills: 900, time: 600, level: 15, cause: 'Quit', weapons: [] },
  ],
  meta: { codex: ['biome:meadow', 'biome:dunes'] },
});
ok(v4.version === 5 && v4.achievements.join() === 'first_steps,stage_2', 'v4 saves move to v5 and keep achievements');
ok(v4.profile.stats.kills === 9000 && v4.profile.stats.runs === 20 && v4.profile.stats.stage === 5 && v4.profile.stats.k_elite === 40, 'old lifetime stats seed the profile');
const retro = 240 * 6 + 900 + 40 * 5 + 12 * 50 + 12 * 40;
ok(v4.profile.xp === retro && levelOf(v4.profile.xp).level > 1, `old saves get retroactive XP (${v4.profile.xp})`);
ok(normalize({ version: 4, lifetime: { kills: 1e8, playTime: 1e8, runs: 9 } }).profile.xp === xpForLevel(40), 'retroactive XP stops at level 40');
ok(v4.profile.sets.heroes.join() === 'ace,rookie' && v4.profile.heroRuns.ace === 1, 'heroes played come from run history');
ok(v4.profile.timeline[0].score === 120000 && v4.profile.timeline.length === 2, 'best runs come from run history');
ok(v4.profile.sets.biomes.join() === 'meadow,dunes', 'islands visited come from the codex');
ok(Object.keys(v4.achDates).length === 0 && v4.quests.ids.length === 0, 'no invented dates or quests');
const round = normalize(JSON.parse(JSON.stringify(v4)));
ok(JSON.stringify(round.profile) === JSON.stringify(v4.profile), 'v5 profile survives a save/load round trip');
const junk = normalize({ version: 5, profile: { xp: -5, stats: { kills: 'x', parries: 7 }, sets: { heroes: [1, 'ace'] }, equip: { title: 'b_navy', hat: 'hat_cap', trail: '' }, timeline: [{ score: 'nope' }, { score: 10, date: 'bad' }] }, quests: { day: '2026-10-19', ids: ['q_kill300'], prog: [-3], done: [true], streak: 4 }, achDates: { first_steps: '2026-10-19', ghost: '2026-10-19' }, achievements: ['first_steps'] });
ok(junk.profile.xp === 0 && junk.profile.stats.parries === 7 && !('kills' in junk.profile.stats), 'junk profile numbers are dropped');
ok(junk.profile.sets.heroes.join() === 'ace' && junk.profile.equip.title === 't_rookie' && junk.profile.equip.hat === 'hat_cap', 'junk sets and wrong-kind cosmetics are fixed');
ok(junk.profile.timeline.length === 1 && junk.profile.timeline[0].date === '', 'bad timeline entries are dropped or cleaned');
ok(junk.quests.prog[0] === 0 && junk.quests.done[0] && junk.quests.streak === 4 && Object.keys(junk.achDates).join() === 'first_steps', 'quests and dates are cleaned');
ok(normalize(null).version === 5 && normalize(null).profile.equip.banner === 'b_navy', 'fresh saves start at level 1 with default cosmetics');

// ---------------------------------------------------------------- DOM for the modules that need one
const html = readFileSync(`${process.cwd()}/index.html`, 'utf8');
const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true });
const noop: any = new Proxy(function () {}, {
  get: (_t, k) => (k === 'data' ? new Uint8ClampedArray(4 * 64 * 64) : k === Symbol.toPrimitive ? () => 0 : k === 'measureText' ? () => ({ width: 10 }) : noop),
  apply: () => noop,
  set: () => true,
});
(dom.window.HTMLCanvasElement.prototype as any).getContext = function () {
  return new Proxy(noop, { get: (_t, k) => (k === 'createImageData' || k === 'getImageData' ? (w2: number, h2: number) => ({ data: new Uint8ClampedArray(4 * (w2 || 64) * (h2 || 64)) }) : k === 'canvas' ? this : noop[k as never]) });
};
(dom.window.HTMLCanvasElement.prototype as any).toDataURL = () => 'data:image/png;base64,';
for (const k of ['window', 'document', 'navigator', 'localStorage', 'HTMLElement', 'HTMLCanvasElement', 'HTMLInputElement', 'Event', 'KeyboardEvent', 'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle', 'innerWidth', 'innerHeight', 'addEventListener', 'dispatchEvent', 'Node', 'MouseEvent', 'PointerEvent']) {
  try {
    (globalThis as any)[k] = (dom.window as any)[k];
  } catch {
    Object.defineProperty(globalThis, k, { value: (dom.window as any)[k], configurable: true });
  }
}
(globalThis as any).Path2D = (dom.window as any).Path2D = class {
  constructor(_d?: string) {}
};
(globalThis as any).__APP_VERSION__ = 'test';
(dom.window.HTMLElement.prototype as any).scrollIntoView = () => {};
(globalThis as any).matchMedia = (dom.window as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
process.on('unhandledRejection', (e) => {
  console.error('FAIL unhandled rejection', e);
  process.exit(1);
});

// ---------------------------------------------------------------- banking (pure on the save)
resetSave();
const { bankTally, bankQuests, achValue, checkMeta2Achievements, mergeTally } = await import('../src/game/systems/meta2');
ok(mergeTally({ kills: 5, parries: 2 }, { kills: 9, chests: 1 }).kills === 9 && mergeTally({ kills: 5 }, { kills: 9, chests: 1 }).chests === 1, 'tallies merge by max');
const info = { hero: 'ace', heroName: 'Ace', kit: 'buster/charge/bomb', mode: 'standard', label: 'STANDARD', score: 5000, stage: 2, kills: 600, time: 400, date: '2026-10-19' };
const r1 = bankTally({ runs: 1, kills: 600, k_fire: 520, stages: 1, combo: 120, 'e:swarmer': 400, 'e:v_swarmer': 20, 's:heroes:ace': 1, 's:biomes:meadow': 1, time: 400 }, info);
const P = save.profile;
ok(P.stats.kills === 600 && P.stats.combo === 120 && P.killsBy.swarmer === 400 && P.sets.heroes.join() === 'ace' && P.sets.biomes.join() === 'meadow', 'a run banks sums, peaks, kills by enemy and sets');
ok(P.heroRuns.ace === 1 && P.kitRuns['buster/charge/bomb'] === 1 && P.best.standard.score === 5000 && P.timeline.length === 1, 'favourites and best runs');
bankTally({ runs: 1, kills: 100, combo: 80, time: 100 }, { ...info, score: 9000 });
ok(P.stats.kills === 700 && P.stats.combo === 120 && P.stats.runs === 2 && P.best.standard.score === 9000 && P.timeline[0].score === 9000, 'sums add, peaks keep the best, best run updates');
ok(r1.xp.total > 0 && P.xp >= r1.xp.total, 'XP is banked');
// Quests: today's ids forced.
save.quests.day = '2026-10-19';
save.quests.ids = ['q_kill300', 'q_fire500', 'q_boss3'];
save.quests.prog = [0, 0, 0];
save.quests.done = [false, false, false];
save.quests.all = false;
save.quests.streak = 2;
save.quests.lastAll = '2026-10-18';
P.stats.quests = 0;
const qa = bankQuests({ kills: 200, k_fire: 600 }, '2026-10-19');
ok(qa.done.map((d) => d.id).join() === 'q_fire500' && qa.xp === QUEST_XP.medium && save.quests.prog[0] === 200, 'quest progress adds up; finished quests pay XP');
const qb = bankQuests({ kills: 150, bosses: 3 }, '2026-10-19');
ok(qb.done.map((d) => d.id).join() === 'q_kill300,q_boss3' && qb.xp === QUEST_XP.easy + QUEST_XP.hard + QUEST_ALL_BONUS && save.quests.streak === 3, 'all three done: bonus XP and a streak');
ok(bankQuests({ kills: 9999 }, '2026-10-19').xp === 0, 'finished quests pay once');
ok(P.stats.quests === 3, 'quests done counted for achievements and quest rewards');
// Achievements from profile stats.
P.stats.parries = 99;
const deflector = ACHIEVEMENTS.find((a) => a.id === 'm2_parry100')!;
ok(achValue(deflector) === 99 && achValue(deflector, { parries: 1 }) === 100, 'lifetime goals add this run');
ok(achValue(ACHIEVEMENTS.find((a) => a.id === 'm2_combo300')!, { combo: 50 }) === 120, 'one-run goals take the best');
ok(achValue(ACHIEVEMENTS.find((a) => a.id === 'm2_raid')!, { 's:events:stealth': 1 }) === 1, 'set membership goals');
const got = checkMeta2Achievements(null, { parries: 1 }).map((a) => a.id);
ok(got.includes('m2_parry100') && got.includes('m2_quest1') && save.achDates.m2_parry100?.length === 10, `met goals are granted with a date (${got.join()})`);
ok(checkMeta2Achievements(null, { parries: 1 }).length === 0, 'granted once');
ok(grantAchievement('m2_parry100') === null, 'grant is idempotent');
void REWARD_BY_ID;

// ---------------------------------------------------------------- real Game: tally, events, banking, co-op merge
resetSave();
const { Input } = await import('../src/core/input');
const { Game } = await import('../src/game/game');
const { settings } = await import('../src/game/settings');
const { ENEMIES } = await import('../src/data/enemies');
const { meta2State, meta2Ui, currentTally, profileSummary } = await import('../src/game/systems/meta2');
const { cycleCosmetic } = await import('../src/ui/profileScreen');
const canvas = document.getElementById('game') as HTMLCanvasElement;
const mk = () => new Game(new Input(canvas), 16 / 9, document.getElementById('hud')!, document.getElementById('reticle')!);
const g = mk();
settings.mode = 'standard';
settings.difficulty = 'normal';
settings.hero = 'rookie';
g.startSolo();
g.closeShop();
g.debugGiveWeapon('fire');
const h = g.hero;
const kill = (id: string, source: string, elite = false) => {
  const e = g.enemies.spawn(ENEMIES[id], h.player.x + 3, h.player.z, g.spawnOpts({ instant: true }));
  if (elite) e.elite = true;
  g.killEnemy(e, source, h);
};
for (let i = 0; i < 5; i++) kill('swarmer', 'fire');
kill('bopper', 'buster', true);
kill('golden', 'buster');
g.mods2Event(h, 'parry');
g.mods2Event(h, 'cashIn');
settings.finishers = false; // the boss dies on the spot (no finisher hold)
kill('king', 'buster');
let t = currentTally(g);
ok(t.kills === 8 && t.k_fire === 5 && t.k_trail === 5 && t.k_elite === 1 && t.k_goldbug === 1 && t['e:swarmer'] === 5, `host counts kills by tag and enemy (${JSON.stringify(t)})`);
ok(t.parries === 1 && t.cashIns === 1 && t.bosses === 1 && t.b_king === 1 && t['s:bossKinds:king'] === 1, 'hero events and bosses count');
// Polling: a flawless stage clear and the run's facts.
const tick = () => {
  meta2State(g).pollT = 0;
  g.render(1, 1 / 60);
};
tick();
g.stage = 2;
tick();
t = currentTally(g);
ok(t.stages === 1 && t.flawless === 1 && t['s:heroes:rookie'] === 1 && t['s:biomes:meadow'] === 1 && t['s:modes:standard'] === 1, `polling sees a flawless stage clear, hero, island and mode (${JSON.stringify(t)})`);
h.player.hp -= 10;
tick();
g.stage = 3;
tick();
ok(currentTally(g).stages === 2 && currentTally(g).flawless === 1, 'a hit stage is not flawless');
// Per-frame cost of the tracker (polls at 10 Hz, checks at 1 Hz).
{
  const t0 = performance.now();
  for (let i = 0; i < 6000; i++) g.meta2Frame(1 / 60);
  const per = (performance.now() - t0) / 6000;
  console.log(`     meta2Frame: ${(per * 1000).toFixed(1)} us per frame`);
  ok(per < 0.2, 'tracker stays cheap per frame (generous bound for loaded CI machines)');
}
// The attract demo and training never count.
const before = currentTally(g).kills;
const { saveLock } = await import('../src/game/save');
saveLock.on = true;
kill('swarmer', 'fire');
saveLock.on = false;
ok(currentTally(g).kills === before, 'locked profile (title demo) counts nothing');
// Bank at game over.
const xp0 = save.profile.xp;
g.runTime = 300;
g.endRun();
const st = meta2State(g);
ok(st.banked && !!st.last && save.profile.stats.kills === 8 && save.profile.stats.b_king === 1 && save.profile.stats.runs === 1 && save.profile.stats.time === 300, 'game over banks the tally into the profile');
ok(save.profile.xp > xp0 && save.profile.xp === xp0 + st.last!.xp.total + st.last!.questXp, 'profile XP banked');
ok(!!document.querySelector('#scr-gameover .m2-strip') && /XP/.test(document.querySelector('#scr-gameover .m2-strip')!.textContent ?? ''), 'game-over strip shows the XP');
ok(save.achievements.includes('m2_comeback') === false && save.profile.best.standard?.score >= 0, 'best run per mode stored');
const kills1 = save.profile.stats.kills;
g.bankAndShow(g.summary(h));
ok(save.profile.stats.kills === kills1, 'banking is idempotent');
// Co-op: a client merges the host's counters for its hero from the game-over summary.
const c = mk();
c.startSolo();
c.closeShop();
(c as any).role = 'client';
const k0 = save.profile.stats.kills;
c.meta.banked = false;
c.bankAndShow({ ...c.summary(c.hero), m2: { kills: 42, parries: 3, k_shock: 40 } });
ok(save.profile.stats.kills === k0 + 42 && (save.profile.stats.k_shock ?? 0) >= 40, 'client banks the host counters from the summary');
(c as any).role = 'solo';
// UI: screens build, EXTRAS gets PROFILE / ACHIEVEMENTS, cosmetics cycle.
const ui = meta2Ui(g);
ui.profile.open();
ok(g.screens.current === 'profile' && (document.getElementById('scr-profile')?.textContent ?? '').includes('LIFETIME'), 'PROFILE screen renders');
ui.ach.open();
ok(g.screens.current === 'achievements' && document.querySelectorAll('#scr-achievements .ac').length === ACHIEVEMENTS.length, 'ACHIEVEMENTS screen lists every achievement');
ok(!!document.querySelector('#scr-extras [data-act=m2-profile]') && !!document.querySelector('#scr-extras [data-act=m2-achievements]'), 'EXTRAS has PROFILE and ACHIEVEMENTS');
const hidden = ACHIEVEMENTS.find((a) => a.hidden && !save.achievements.includes(a.id))!;
ok(!(document.getElementById('scr-achievements')?.textContent ?? '').includes(hidden.name), 'hidden achievements stay hidden');
g.screens.show('title');
g.render(1, 1 / 60);
ok(/DAILY QUESTS/.test(document.getElementById('m2-title')?.textContent ?? ''), 'title shows the quest panel');
save.profile.xp = xpForLevel(20);
ok(cycleCosmetic('title') === 't_cadet' && cycleCosmetic('hat') === 'hat_cap' && cycleCosmetic('hat') === 'hat_party' && cycleCosmetic('hat') === '', 'cosmetics cycle through unlocked options');
ok(profileSummary().lv === 20 && profileSummary().title === 't_cadet', 'lobby summary');
ok(!cycleCosmetic('banner') || REWARD_BY_ID[save.profile.equip.banner].level <= 20, 'locked cosmetics are skipped');
// Pet hat on this machine's pet.
settings.pet = 'bit';
h.setPet('bit');
save.profile.equip.hat = 'hat_party';
g.render(1, 1 / 60);
ok(!!h.petView?.root.getObjectByName('m2hat'), 'pet wears its hat');
console.log('ok   meta2: profile levels, quests, achievements, migration, banking, co-op merge and screens');
