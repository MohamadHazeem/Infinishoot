import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { ok } from './check';
import {
  CHALLENGES, CHALLENGE_BY_ID, CHALLENGE_XP, SEASON_EMOTES, SEASON_HATS, SEASON_ITEMS, SEASON_ITEM_BY_ID, SEASON_SKINS, SEASON_STICKERS, THEMES, TIER_SLOTS,
  addSeasonXp, applyChallenges, challengeText, claimAll, claimNext, freshSeasonPass, itemId, normalizeSeasonPass, rollSeasonPass, seasonFeeds, seasonKey,
  seasonRunXp, seasonTrack, seasonTuning, themeFor, tierOf, unclaimed, weeklyChallenges, xpForTier,
} from '../src/data/season';
import { SWEETIE16, ENEMY_MAGENTA } from '../src/data/customise';
import { PROFILE_REWARDS, REWARD_BY_ID, rewardOpen } from '../src/data/profile';
import { SKINS } from '../src/data/skins';
import { isoWeek } from '../src/data/weekly';
import { normalize, save, resetSave } from '../src/game/save';
import { localize, setLanguage } from '../src/i18n';

// ---------------------------------------------------------------- data
ok(THEMES.length === 12 && new Set(THEMES.map((t) => t.id)).size === 12, 'twelve themes, one per month of a year');
ok(SEASON_ITEMS.length === 12 * 11 && new Set(SEASON_ITEMS.map((i) => i.id)).size === SEASON_ITEMS.length, 'eleven unique cosmetics per theme');
const palette = new Set<string>(SWEETIE16);
const colours = THEMES.flatMap((t) => [t.color, t.hud ?? t.color, ...t.trail, t.hat.color, t.hat.trim, t.emote.color, ...Object.values(t.skin).filter((v) => v.startsWith('#')), ...Object.values(t.set).filter((v) => v.startsWith('#')), ...t.stickers.flatMap((s) => [s[1], s[2]].filter(Boolean))]);
ok(colours.every((c) => palette.has(c)) && !colours.includes(ENEMY_MAGENTA), 'every season colour is on the Sweetie 16 palette (never the enemy magenta)');
ok(THEMES.every((t) => t.emote.glyph.length === 8 && t.emote.glyph.every((r) => r.length === 8 && /^[.#o]+$/.test(r))), 'emote glyphs are 8x8');
ok(SEASON_SKINS.length === 24 && SEASON_SKINS.every((s) => SKINS.includes(s) && s.season), 'season skins join the wardrobe list');
ok(SEASON_EMOTES.length === 12 && Object.keys(SEASON_STICKERS).length === 24 && Object.keys(SEASON_HATS).length === 12, 'emotes, stickers and hats for every theme');
ok(SEASON_ITEMS.filter((i) => ['title', 'banner', 'hud', 'trail', 'hat'].includes(i.kind)).every((i) => REWARD_BY_ID[i.id]?.season === i.theme), 'profile-kind items resolve as profile rewards (equips, lobby cards)');
ok(REWARD_BY_ID[itemId('neon', 'trail')].colors?.length === 3, 'season trails carry their colours');

// ---------------------------------------------------------------- calendar
ok(seasonKey(new Date(2026, 9, 20)) === '2026-10' && seasonKey(new Date(2027, 0, 1)) === '2027-01', 'season key is the local month');
for (const y of [2026, 2027, 2031]) {
  const ids = Array.from({ length: 12 }, (_, m) => themeFor(`${y}-${String(m + 1).padStart(2, '0')}`).id);
  ok(new Set(ids).size === 12, `every theme once in ${y}`);
}
ok(themeFor('2026-10').id === themeFor('2026-10').id, 'theme is seeded (same month, same theme)');
const order = (y: number) => Array.from({ length: 12 }, (_, m) => themeFor(`${y}-${String(m + 1).padStart(2, '0')}`).id).join();
ok(order(2026) !== order(2027), 'years shuffle the order');

// ---------------------------------------------------------------- track and tiers
const track = seasonTrack('2026-10');
ok(track.length === 50 && track.every((r, i) => r.tier === i + 1), '50 tiers');
ok(track.filter((r) => r.item).length === Object.keys(TIER_SLOTS).length && track.filter((r) => !r.item).every((r) => r.xp >= 100 && r.xp % 10 === 0), 'cosmetic tiers at fixed spots, profile XP elsewhere');
ok(track[49].item?.slot === 'champion' && track[0].item?.kind === 'sticker', 'tier 1 is a sticker, tier 50 the champion title');
ok(xpForTier(0) === 0 && xpForTier(5) === 1250 && xpForTier(50) === 19250, `tier curve: 5 quick tiers, then 400 each (${xpForTier(50)} for all 50)`);
let mono = true;
for (let n = 1; n <= 50; n++) if (tierOf(xpForTier(n)).tier !== n || tierOf(xpForTier(n) - 1).tier !== n - 1) mono = false;
ok(mono, 'tierOf inverts xpForTier');
ok(tierOf(1e9).tier === 50 && tierOf(1e9).frac === 1 && tierOf(0).tier === 0, 'tiers stop at 50');
ok(seasonRunXp(500, false) === 500 && seasonRunXp(500, true) === 550 && seasonRunXp(-3, true) === 0, 'season XP = profile XP, +10% in co-op');

// ---------------------------------------------------------------- weekly challenges
let fine = true;
let trials = 0;
for (let w = 1; w <= 52; w++) {
  const week = `2026-W${String(w).padStart(2, '0')}`;
  const c = weeklyChallenges(week);
  if (c.length !== 3 || c.map((x) => x.group).join() !== 'feature,medium,hard' || new Set(c.map((x) => x.stat)).size !== 3 || c.some((x) => x.needs)) fine = false;
  if (weeklyChallenges(week).map((x) => x.id).join() !== c.map((x) => x.id).join()) fine = false;
  if (weeklyChallenges(week, new Set([...seasonFeeds, 'trialGolds'])).some((x) => x.id === 'c_trials')) trials++;
}
ok(fine, 'every week: one feature, one medium, one hard challenge on different stats; seeded; no trials without a feed');
ok(trials > 0, `trial challenges join once a lane feeds them (${trials} of 52 weeks)`);
ok(CHALLENGES.some((c) => c.id === 'c_raid') && CHALLENGES.some((c) => c.id === 'c_race') && CHALLENGES.some((c) => c.id === 'c_style' && c.goal === 5), 'raid, race and SS style challenges exist');

// ---------------------------------------------------------------- progress (pure)
const sp = freshSeasonPass();
const oct = new Date(2026, 9, 20, 12);
let roll = rollSeasonPass(sp, oct);
ok(sp.season === '2026-10' && sp.week === isoWeek(oct) && sp.ch.length === 3 && roll.newWeek && !roll.ended, 'a fresh pass starts the month and the week');
ok(claimNext(sp) === null && unclaimed(sp) === 0, 'nothing to claim at tier 0');
const up = addSeasonXp(sp, 1300);
ok(up.from === 0 && up.to === 5 && unclaimed(sp) === 5, 'XP opens tiers');
const c1 = claimNext(sp)!;
ok(c1.tier === 1 && c1.item?.kind === 'sticker' && sp.owned.includes(c1.item.id) && c1.xp === 0, 'claiming tier 1 owns its sticker');
const c2 = claimNext(sp)!;
ok(c2.tier === 2 && !c2.item && c2.xp > 0, 'filler tiers pay profile XP');
const rest = claimAll(sp);
ok(rest.length === 3 && sp.claimed === 5 && rest.some((r) => r.item?.slot === 'banner'), 'claim all claims up to the tier reached, in order');
// A dupe: own tier 8's title already.
sp.owned.push(itemId(themeFor('2026-10').id, 'title'));
addSeasonXp(sp, xpForTier(8) - sp.xp);
const c8 = claimAll(sp).find((r) => r.tier === 8)!;
ok(c8.dup && c8.xp === seasonTuning.dupXp, 'a cosmetic you already own pays profile XP instead');
// Challenges.
sp.ch = ['c_race', 'c_combo200', 'c_kill5000'];
sp.prog = [0, 0, 0];
sp.done = [false, false, false];
let ch = applyChallenges(sp, { combo: 150, kills: 3000 });
ok(ch.done.length === 0 && sp.prog[1] === 150 && sp.prog[2] === 3000, 'challenge progress: peaks keep the best, sums add');
ch = applyChallenges(sp, { combo: 120, kills: 2500, raceWins: 1 });
ok(ch.done.map((c) => c.id).join() === 'c_race,c_kill5000' && sp.prog[1] === 150 && ch.xp === CHALLENGE_XP.feature + CHALLENGE_XP.hard, 'finished challenges pay season XP');
ok(applyChallenges(sp, { raceWins: 5, kills: 9999 }).xp === 0, 'challenges pay once');
ok(challengeText(CHALLENGE_BY_ID.c_kill1500) === 'Defeat 1,500 enemies', 'challenge text fills the goal');
// Month rollover: earned tiers are claimed for you, the season restarts.
const tierBefore = tierOf(sp.xp).tier;
addSeasonXp(sp, xpForTier(26) - sp.xp);
const ownedBefore = sp.owned.length;
roll = rollSeasonPass(sp, new Date(2026, 10, 2, 12));
ok(!!roll.ended && roll.ended.tier === 26 && roll.ended.claims.length === 26 - 8 && sp.owned.length > ownedBefore && sp.owned.includes(itemId(themeFor('2026-10').id, 'skin')), `a finished season claims what you earned (${tierBefore} -> 26)`);
ok(sp.season === '2026-11' && sp.xp === 0 && sp.claimed === 0 && sp.past[0].season === '2026-10' && sp.past[0].tier === 26, 'the new season starts at tier 0; the old one is in PAST SEASONS');
ok(sp.total >= xpForTier(26), 'lifetime season XP kept');
ok(!rollSeasonPass(sp, new Date(2026, 10, 3, 12)).ended, 'same month: nothing ends');

// ---------------------------------------------------------------- save
const clean = normalizeSeasonPass({ season: '2026-10', xp: 900, claimed: 40, owned: ['sp_neon_hat', 'nope', 'sp_neon_hat'], emote: 'sp_frost_emote', week: '2026-W43', ch: ['c_race', 'c_boss3', 'c_loop'], prog: [5, -1, 'x'], done: [false, false, true], past: [{ season: '2026-09', theme: 'neon', tier: 99 }, { season: 'bad' }], total: 'x' });
ok(clean.claimed === tierOf(900).tier && clean.owned.join() === 'sp_neon_hat' && clean.emote === '', 'normalize: claims never pass the tier reached, unknown items dropped, emote must be owned');
ok(clean.prog.join() === '1,0,0' && clean.done.join() === 'true,false,true' && clean.past.length === 1 && clean.past[0].tier === 50 && clean.total === 900, 'normalize: challenge progress, past seasons and totals are cleaned');
ok(JSON.stringify(normalizeSeasonPass(normalizeSeasonPass(clean))) === JSON.stringify(clean), 'season pass survives a round trip');
ok(JSON.stringify(normalizeSeasonPass(null)) === JSON.stringify(freshSeasonPass()) && JSON.stringify(normalizeSeasonPass('junk')) === JSON.stringify(freshSeasonPass()), 'missing or junk pass = fresh');
const v8 = normalize({ version: 8, achievements: ['first_steps'], lifetime: { runs: 3, kills: 100 }, profile: { xp: 500, equip: { title: 'sp_neon_title' } } });
ok(v8.version >= 9 && v8.seasonPass.season === '' && v8.seasonPass.owned.length === 0 && v8.achievements.join() === 'first_steps' && v8.profile.xp === 500, 'v8 saves load at v9 with an empty season pass');
ok(v8.profile.equip.title === 'sp_neon_title', 'a season title stays equipped through normalize (the id resolves)');
const v9 = normalize(JSON.parse(JSON.stringify({ ...v8, seasonPass: clean })));
ok(JSON.stringify(v9.seasonPass) === JSON.stringify(clean), 'v9 season pass round-trips through the whole save');

// ---------------------------------------------------------------- profile ownership
resetSave();
const hatId = itemId('neon', 'hat');
ok(!rewardOpen(REWARD_BY_ID[hatId], 100, 999), 'season items are not owned by profile level');
save.seasonPass.owned.push(hatId);
ok(rewardOpen(REWARD_BY_ID[hatId], 1, 0), 'owning it on the track opens it');
normalizeSeasonPass(save.seasonPass);
ok(PROFILE_REWARDS.includes(REWARD_BY_ID[hatId]) && !PROFILE_REWARDS.includes(REWARD_BY_ID[itemId('frost', 'hat')]), 'owned season items join the PROFILE picker (only owned ones)');
resetSave();

// ---------------------------------------------------------------- Arabic
await setLanguage('ar');
const texts = [...THEMES.flatMap((t) => [t.name, t.tagline, t.title, t.champion, t.hat.name, t.skin.name, t.set.name, t.emote.label, t.emote.say, t.stickers[0][0], t.stickers[1][0]]), ...CHALLENGES.map(challengeText)];
const missing = texts.filter((x) => /[a-z]{3}/i.test(localize(x)) || !/[؀-ۿ]/.test(localize(x)));
ok(missing.length === 0, `every season name, line and challenge translates (${missing.slice(0, 4).join(' | ')})`);
await setLanguage('en');

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


// ---------------------------------------------------------------- real Game
resetSave();
const { Input } = await import('../src/core/input');
const { Game } = await import('../src/game/game');
const { settings } = await import('../src/game/settings');
const { ENEMIES } = await import('../src/data/enemies');
const { meta2State, equipped, profileSummary } = await import('../src/game/systems/meta2');
const S = await import('../src/game/systems/season');
const { emoteOf } = await import('../src/game/coop2');
const { raidRuntime } = await import('../src/game/systems/raid');
const canvas = document.getElementById('game') as HTMLCanvasElement;
const mk = () => new Game(new Input(canvas), 16 / 9, document.getElementById('hud')!, document.getElementById('reticle')!);
const g = mk();
settings.mode = 'standard';
settings.difficulty = 'normal';
settings.hero = 'rookie';
g.startSolo();
g.closeShop();
const h = g.hero;
for (let i = 0; i < 30; i++) {
  const e = g.enemies.spawn(ENEMIES.swarmer, h.player.x + 3, h.player.z, g.spawnOpts({ instant: true }));
  g.killEnemy(e, 'buster', h);
}
S.seasonRoll(g);
const sxp0 = save.seasonPass.xp;
g.runTime = 600;
g.endRun();
const bank = S.seasonState(g).last;
const m2 = meta2State(g).last!;
ok(!!bank && bank.runXp === m2.xp.total + m2.questXp && save.seasonPass.xp >= sxp0 + bank.runXp, `a finished run's profile XP is season XP (+${bank?.runXp})`);
ok(!!document.querySelector('#scr-gameover .sp-strip') && /SEASON XP/.test(document.querySelector('#scr-gameover .sp-strip')!.textContent ?? ''), 'game-over strip shows the season XP');
const again = save.seasonPass.xp;
g.bankAndShow(g.summary(h));
ok(save.seasonPass.xp === again, 'banking is once per run');
// Co-op bonus (pure part of the bank).
const fakeRes = { xp: { time: 0, kills: 0, bosses: 0, stages: 0, coop: 0, total: 400 }, questXp: 100, from: 1, to: 1, rewards: [], quests: [], achievements: [] };
const before = save.seasonPass.xp;
const cb = S.seasonBank(g, { coopRuns: 1 }, fakeRes)!;
ok(cb.coop && cb.runXp === 550 && save.seasonPass.xp === before + 550, 'co-op runs earn 10% more season XP');
// Live counters: a raid clear and a race win advance this machine's challenges right away.
save.seasonPass.ch = ['c_raid', 'c_boss3', 'c_kill5000'];
save.seasonPass.prog = [0, 0, 0];
save.seasonPass.done = [false, false, false];
g.screens.show('none');
const rr = raidRuntime(g);
const realState = rr.state;
const x0 = save.seasonPass.xp;
rr.state = { phase: 'won' } as never;
S.seasonFrame(g, 1 / 60);
S.seasonFrame(g, 1 / 60);
rr.state = realState;
ok(save.seasonPass.done[0] && save.seasonPass.xp === x0 + CHALLENGE_XP.feature, 'a raid clear completes "Clear a raid" once');
save.seasonPass.ch[0] = 'c_race';
save.seasonPass.done[0] = false;
save.seasonPass.prog[0] = 0;
const row = { n: 'me' };
(g as any).race = { phase: 'over', rows: [row, { n: 'you' }], you: 0, final: [{ row, place: 1 }, { row: { n: 'you' }, place: 2 }] };
S.seasonFrame(g, 1 / 60);
S.seasonFrame(g, 1 / 60);
(g as any).race = null;
ok(save.seasonPass.done[0], 'winning a race completes "Win a race"');
ok(S.seasonCount(g, 'trialGolds').length === 0, 'unknown counters are harmless');
// Claims and wearing things.
save.seasonPass.claimed = 0;
save.seasonPass.xp = xpForTier(40);
const pxp = save.profile.xp;
const claimed = S.seasonClaim(g, true);
const theme = themeFor(save.seasonPass.season);
ok(claimed.length === 40 && save.seasonPass.claimed === 40 && save.profile.xp > pxp, 'claim all: 40 tiers, filler tiers pay profile XP');
ok(['sticker1', 'banner', 'title', 'sticker2', 'hud', 'trail', 'skin', 'hat', 'emote', 'set'].every((s) => save.seasonPass.owned.includes(itemId(theme.id, s as never))), 'every cosmetic up to tier 40 is owned');
ok(S.equipSeasonItem(g, itemId(theme.id, 'title')) && equipped('title') === itemId(theme.id, 'title') && profileSummary().title === itemId(theme.id, 'title'), 'a season title can be worn and shows on the lobby card');
ok(S.equipSeasonItem(g, itemId(theme.id, 'skin')) && settings.skin === itemId(theme.id, 'skin') && g.hero.skin.id === itemId(theme.id, 'skin'), 'a season skin dresses the hero');
ok(!S.equipSeasonItem(g, itemId(theme.id, 'skin')) && settings.skin === 'classic', 'wearing it again takes it off');
ok(!S.equipSeasonItem(g, itemId(theme.id, 'champion')), 'unowned items cannot be worn');
const { skinUnlocked } = await import('../src/ui/screens');
ok(skinUnlocked(itemId(theme.id, 'set')) && !skinUnlocked(itemId(THEMES.find((t) => t.id !== theme.id)!.id, 'set')), 'wardrobe: owned season skins only');
// Emotes: the seventh slice, accepted by the host.
ok(S.emoteWheel().length === 6, 'six emotes before a season emote is worn');
S.equipSeasonItem(g, itemId(theme.id, 'emote'));
ok(S.emoteWheel().length === 7 && S.emoteWheel()[6].id === itemId(theme.id, 'emote') && S.emoteWheelKey() === itemId(theme.id, 'emote'), 'the worn season emote is the seventh slice');
ok(emoteOf(itemId('storm', 'emote'))?.say === 'SHOCKING!', 'every machine knows the season emotes (host validation, bubbles)');
const { wheelSlice } = await import('../src/game/teamPlay');
ok(wheelSlice(0, -50, 20, 7) === 0 && wheelSlice(-40, -30, 20, 7) === 6, 'the wheel picks among seven slices');
// Pet hats and trails.
ok(Object.keys(SEASON_HATS).every((id) => { const m = S.seasonHatMesh(id); return !!m && m.children.length > 0 && m.name === 'm2hat'; }), 'every season hat builds a mesh');
S.equipSeasonItem(g, itemId(theme.id, 'hat'));
g.hero.setPet('bit');
g.meta2Frame(1 / 60);
ok(!!meta2State(g).hat && meta2State(g).hatId === itemId(theme.id, 'hat'), 'the season hat sits on the pet');
S.equipSeasonItem(g, itemId(theme.id, 'trail'));
ok(equipped('trail') === itemId(theme.id, 'trail'), 'season trail worn');
// The screen and the title banner.
g.screens.show('title');
S.seasonFrame(g, 1 / 60);
const ui = S.seasonUi(g);
ok(!!document.querySelector('#sp-title') && /TIER 40/.test(document.querySelector('#sp-title')!.textContent ?? ''), 'title banner shows the tier');
ok(!!document.querySelector('#scr-extras [data-act=sp-season]'), 'EXTRAS has a SEASON button');
save.seasonPass.xp = xpForTier(43);
ui.open();
ok(g.screens.current === 'season' && document.querySelectorAll('#scr-season .sp-cell').length === 50 && document.querySelectorAll('#scr-season .sp-cell.ready').length === 3, 'SEASON screen: 50 tiers, three ready to claim');
ok(document.querySelectorAll('#scr-season .sp-ch').length === 3, 'SEASON screen lists the week\'s challenges');
(document.querySelector('#scr-season [data-sp=claim]') as HTMLElement).click();
ok(save.seasonPass.claimed === 43 && !!document.querySelector('#scr-season .sp-reveal') && document.querySelectorAll('#scr-season .sp-cell.pop').length === 3, 'CLAIM: tiers claimed, cells pop, the reveal shows');
ui.tick();
ok(!!document.querySelector('#scr-season .sp-detail b')?.textContent, 'detail panel follows the focused tier');
// Arabic screen.
await setLanguage('ar');
ui.open();
const arText = document.querySelector('#scr-season')!.textContent ?? '';
ok(/[؀-ۿ]/.test(arText) && !/WEEKLY CHALLENGES|HOW TO EARN|PAST SEASONS/.test(arText), 'SEASON screen in Arabic');
await setLanguage('en');
// Per-frame cost.
g.screens.show('none');
{
  const t0 = performance.now();
  for (let i = 0; i < 6000; i++) S.seasonFrame(g, 1 / 60);
  const per = (performance.now() - t0) / 6000;
  console.log(`     seasonFrame: ${(per * 1000).toFixed(2)} us per frame`);
  ok(per < 0.05, 'season tracking is cheap per frame');
}
// The title demo never counts.
const { saveLock } = await import('../src/game/save');
saveLock.on = true;
const lockXp = save.seasonPass.xp;
S.seasonCount(g, 'raceWins');
saveLock.on = false;
ok(save.seasonPass.xp === lockXp, 'locked profile (title demo) earns nothing');
resetSave();
