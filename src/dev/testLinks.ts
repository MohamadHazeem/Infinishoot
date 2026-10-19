import { cleanHeat } from '../data/heat';
import { meta2Links } from './meta2Links';
import { save } from '../game/save';
import { META_SCREENS, type MetaScreen } from '../ui/metaScreens';
import { companionLinks } from './companionLinks';
import { timeLinks } from './timeLinks';
import { coop2Links } from './coop2Links';
import { cinematicsLinks } from './cinematicsLinks';
import { sound2Links } from './sound2Links';
import { ELITE_MOD_IDS, type EliteModId } from '../data/eliteMods';
import { STAGE_EVENTS, type EventId } from '../data/stageEvents';
import { Rng } from '../core/rng';
import { ENEMIES } from '../data/enemies';
import { cheats, type Game } from '../game/game';
import { applySettings, settings } from '../game/settings';
import { lookOverrides } from '../game/systems/look';
import { OBJECTIVE_KINDS, type ObjectiveKind } from '../game/objectives';
import { weatherForce } from '../game/ambience';
import { STYLE_RANKS, styleTuning } from '../game/style';
import { Team } from '../game/bullets';
import { PickupType } from '../game/pickups';
import { prof, profReset } from '../core/prof';
import { renderQuality } from '../render/quality';
import { shopLinks } from './shopLinks';
import { mods2Links } from './mods2Links';
import { onboardingLinks } from './onboardingLinks';
import { hudLinks } from '../ui/hudLinks';
import { smashCover } from '../game/coverBreak';
import { contentLinks } from './contentLinks';
import { weapons3Links } from './weapons3Links';
import { graphicsLinks } from './graphicsLinks';
import { gameplayLinks } from './gameplayLinks';
import { bossLinks } from './bossLinks';
import { worldEventLinks } from './worldEventLinks';
import { modesLinks } from './modesLinks';
import { mpLinks } from './mpLinks';
import { allBiomeKeys, biomeForce } from '../data/biomes';
import { ROUTE_NODES, type NodeKind } from '../data/routeNodes';
import type { PhotoMode } from '../ui/photoMode';
import { charDebug } from '../game/systems/characters';
import { portraits, type Expression } from '../ui/portraits';
import { skyOverrides, skyTuning } from '../render/sky';
import { SCAR_COLORS } from '../game/scars';

/**
 * Test links: open the game straight into a situation, for quick playtests
 * and automated screenshots. Works in every build. Examples:
 *
 *   ?test&stage=4&boss                 stage 4, skip to the boss
 *   ?test&weapons=drones:6,aura:5      drones evolved, Zap Field level 5
 *   ?test&loadout=laser,well,meteor    left click, right click, special
 *   ?test&hero=ace&mode=endless&god    hero, mode, no damage
 *   ?test&elite=charger:shielded       spawn an elite with a modifier
 *   ?test&event=meteors&passives=armor:2,magnet:1&gold=200&seed=42
 *   ?test&spawn=shielder:3,medic:1&golden&time=90   enemies near you, the Goldbug, stage clock
 *   ?test&elite=shooter:fast&zoom=2.2   camera zoomed out (1-2.2)
 *
 * Animation and camera checks (cosmetic, for screenshots):
 *   &move=1,0  hold a move direction     &aim=0,1  hold an aim direction (fires)
 *   &circle    walk in circles           &cam=0.6  camera zoom (below 1 = close-up)
 *   &swarm=200 (or swarm=150:zippy) spawn a ring of enemies around the hero
 *   &killboss=3  kill the boss after 3 s (kill-cam, victory pose)
 *   &clear=3     clear the stage after 3 s (victory pose)
 *   &hurt=1.5    a small hit every 1.5 s (flinch)   &die=3  fall down after 3 s
 *   &frozen      stop enemies moving (close-ups)     &dashes=1  dash every second
 *   ?test&night&quality=high           force a night stage (or &day), pin quality (low|medium|high|auto)
 *   ?test&stage=2&bossnow&phase=2&god  boss right away, pushed into phase 2 (nointro skips the entrance)
 *   ?test&stage=3&miniboss             the stage's mini-boss lands now
 *   ?test&objective=totems&near=totem   force the stage objective, start next to an arena toy
 *     near: pad, turret, pillar, crate, totem, shard, beacon, lava, ice, quicksand, thorns
 *   ?test&stage=4&topple                topple the pillar nearest the hero
 *   ?test&stage=2&smash=2              stand by the nearest ruin wall/rock/tree and smash it after 2 s (Rex's cover break)
 *   ?test&stage=3&rain                 force rain (meadow/peaks); `dry` forces no rain
 *   ?test&biome=neon&day               pin the biome: meadow, dunes, peaks, magma, neon, factory, sky,
 *     or a remix: meadow:autumn, dunes:night, peaks:aurora, magma:ashen (src/data/biomes.ts)
 *   ?test&stage=4&at=lava              start next to a lava pool (also at=water, at=ice, at=12,-30)
 *     Neon City / Sky Fortress: at=holo, at=vent, at=sign, at=flag, at=gap (a chasm)
 *   ?test&hero=bulwark&ultgo=2&god      ultimate charged, fired after 2 s (`ult` only charges it)
 *   ?test&style=S&spawn=shooter:6       style rank; enemies in a ring 7 m around you
 *   ?test&parrygo=2 / &dashgo=2         a parry / a perfect dash after 2 s (for screenshots)
 *   ?test&captions&arrows&spawn=sniper:2&spawnr=26&hurt=1   caption strip and sound arrows on (off-screen snipers)
 *   ?test&stage=3&route                the route map opens now (choice for stage 4); &path=1,0 picks those roads first
 *   ?test&stage=2&node=treasure        this stage plays as a route node (elite, shop, treasure, event, rest, hard)
 *   ?test&encounter=altar              a route encounter right away (altar, gambler, idol, spring, dojo, shrine)
 *   ?test&weapons=drones:6,lightning:6&fuse   a level-up with the FUSION card (`fuse=go` picks it: the fusion moment)
 *   ?test&weapons=storm_drones&god&swarm=80     start with a fused weapon (any id in src/data/fusions.ts)
 *   ?test&photo=2                     photo mode after 2 s (pauses first); with &photofilter=neon (normal, crt, sepia,
 *     comic, neon, bw), &photoframe=film (none, snapshot, film, arcade, comic), &stickers=star@0.3,0.4;pow@0.7,0.3
 *     (star, heart, bolt, crown, skull, pow, gg, wow, oneup), &nologo, &photocam=yaw,pitch,dist (0.6,40,18),
 *     &photohide (hide the photo UI), &photosnap (save a PNG)
 *   ?test&stage=2&bossnow&nointro&killboss=2&finat=0.7   boss finisher, pinned 0.7 s in (screenshots); `nofinish` turns finishers off, `calm` = reduce flashing
 *   ?test&face=shocked&pops            force the HUD face's expression; pop in the announcer, the boss and a ping
 *   ?test&tod=0.9&scars=30             sky lane: time of day (0 midday .. 1 sunset), 30 craters/scorch/frost
 *     around the hero after 0.5 s (`scars=30:crater` for one kind), `clouds=0.6` cloud shadow strength
 *   ?test&bench&hold=180               phase timers on (`window.__prof`, scripts/bench.mjs), no level-ups; keep 180
 *     swarmers alive by topping them up around the hero every 0.5 s (`hold=150,20:spinner` mixes types);
 *     &bullets=500 keeps 500 enemy bullets in flight around the hero (use with god)
 *   ?test&pad=ps&ui=125&levelup        HUD: button prompts (pad=xbox|ps|kbm|touch), UI scale %, open a level-up;
 *     &dmgnums=mine|off, &charge=toggle, &noweather (settings for this session)
 *
 * Onboarding (src/dev/onboardingLinks.ts): &training=4, &trainingdone, &tip=boss, &discover=all, &recap, &offer, &screen=codex
 *
 * Bosses lane (src/dev/bossLinks.ts): &titan, &titanphase=3, &titanmove=beam, &remix, &duel.
 *
 * Content lane (src/dev/contentLinks.ts): &foe=shark:windup:4:1 pins biome foes in a state; &evo=scatter:1 evolves.
 *
 * Modes lane (src/dev/modesLinks.ts): &rhythm, &pacifist&pact=40, &minigame=gallery|coins|whack&mgt=6, &ghost=demo&ghostlead=3, &modescreen=ghosts.
 *
 * World events (src/dev/worldEventLinks.ts): &wev=collapse|flood|split|giant|eclipse|flower|volcano|stealth, &wevt=6 (jump its clock), &wevoff.
 * Cinematics lane (src/dev/cinematicsLinks.ts): &skyfall=1&skyat=0.5, &ending=1&endat=0.3, &reveal=starfall, &jackpot=1&jackkind=gold, &flawless=1&portalnow, &titleplay, &cine=short.
 * Time lane (src/dev/timeLinks.ts): &rewindgo=3&rewindat=0.5, &standgo=2, &btgo=2&btat=0.5, &replaygo=3&replayat=1,
 *   &mate&clutchgo=2&clutchat=0.5, &mate&votego=2.
 * Coop2 lane (src/dev/coop2Links.ts): &mate&emote=wave, &mate&mateemote=cheer, &mate&wheel=emotes, &mate&pool&downme=2,
 *   &mate&autopilot, &joincode=K7P2Q, &mate&teamult=2, &ghostgo=2.
 * MP lane (src/dev/mpLinks.ts): &versus (vs the AI Overlord), &versus=ol&god (you are the Overlord), &vstime=, &vspts=, &vsgo=,
 *   &localcoop[=run]&lcpads=2, &browse=fake, &teamboard=fake, &lobby=versus|weekly.
 *
 * `?test` alone starts a solo run with the default kit and skips the starting shop.
 */
export function applyTestLink(game: Game, search = location.search): boolean {
  const q = new URLSearchParams(search);
  if (!q.has('test')) return false;
  const list = (k: string) => (q.get(k) ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  const pair = (s: string): [string, number] => {
    const [id, n] = s.split(':');
    return [id, Number(n ?? 1) || 1];
  };
  cheats.unlockAll = true;
  cheats.god = q.has('god');
  const ql = q.get('quality');
  const qi = ql ? ['low', 'medium', 'high', 'auto', 'potato'].indexOf(ql) : -1;
  if (qi >= 0) {
    settings.graphics = qi;
    applySettings();
  }
  if (q.has('fps')) settings.showFps = true;
  // Audio accessibility overlays: &captions (caption strip), &arrows (sound arrows).
  if (q.has('captions') || q.has('arrows')) {
    settings.captions ||= q.has('captions');
    settings.soundArrows ||= q.has('arrows');
    applySettings();
  }
  if (q.has('bench')) {
    prof.on = true;
    Object.assign(window, { __prof: prof, __profReset: profReset, __game: game, __quality: renderQuality });
  }
  if (q.has('night')) lookOverrides.night = true;
  else if (q.has('day')) lookOverrides.night = false;
  if (q.get('hero')) {
    settings.hero = q.get('hero')!;
    game.applyLocalSkin(); // the hero was made before the link was read
  }
  if (q.get('mode')) settings.mode = q.get('mode')!;
  if (q.get('difficulty')) settings.difficulty = q.get('difficulty')!;
  const lo = list('loadout');
  if (lo.length) settings.loadout = { primary: lo[0] ?? settings.loadout.primary, secondary: lo[1] ?? settings.loadout.secondary, special: lo[2] ?? settings.loadout.special };
  const obj = q.get('objective');
  game.toys.force = OBJECTIVE_KINDS.includes(obj as ObjectiveKind) ? (obj as ObjectiveKind) : null;
  weatherForce.mode = q.has('rain') ? 'rain' : q.has('dry') ? 'clear' : null;
  if (q.has('heat')) save.meta.heat = cleanHeat(list('heat'));
  // &biome=factory or &biome=meadow:autumn: pin the stage's biome (or remix); see BIOME_ORDER.
  const bk = q.get('biome');
  biomeForce.key = bk && allBiomeKeys().includes(bk) ? bk : null;
  game.startSolo();
  if (q.get('seed')) game.rng = new Rng(Number(q.get('seed')));
  // Skip the starting shop.
  if (game.mode === 'shop') game.closeShop();
  const stage = Number(q.get('stage'));
  if (stage > 1) game.loadStage(stage);
  for (const w of list('weapons')) {
    const [id, n] = pair(w);
    for (let i = 0; i < n; i++) game.debugGiveWeapon(id);
  }
  const h = game.hero;
  for (const p of list('passives')) {
    const [id, n] = pair(p);
    h.passives[id] = n;
  }
  h.recomputeStats();
  h.loadoutDirty = true;
  // Weapon fusion: open a level-up (its first card is the fusion) and, with fuse=go, take it.
  // Deferred like `ultgo`: the stage intro would close a menu opened right away.
  if (q.has('fuse')) {
    setTimeout(() => {
      h.pendingLevels = Math.max(1, h.pendingLevels);
      game.openLevelUp();
      const i = h.offers.findIndex((o) => o.kind === 'fusion');
      if (q.get('fuse') === 'go' && i >= 0) game.heroAction(h, 'pick', i, 1);
    }, Number(q.get('fusein') ?? 1) * 1000);
  }
  if (q.has('bench')) {
    game.xpNext = 1e12; // no level-up menus: the load stays steady
    // Special/elite stress scenes drop chests too; those must not pause the benchmark for cards.
    const collect = game.collect;
    game.collect = (hero, type, value) => { if (type !== PickupType.Chest) collect.call(game, hero, type, value); };
  }
  if (q.get('gold')) h.gold = Number(q.get('gold'));
  for (const e of list('elite')) {
    const [id, mod] = e.split(':');
    game.debugSpawnElite(id, (ELITE_MOD_IDS.includes(mod as EliteModId) ? mod : ELITE_MOD_IDS[0]) as EliteModId);
  }
  // Enemies in a ring 9 m out (spawnr=<m>), the Goldbug, and the stage clock (seconds).
  if (q.get('zoom')) game.cam.zoom = Math.max(1, Number(q.get('zoom')));
  if (q.get('time')) game.director.time = Number(q.get('time'));
  const spawns = list('spawn').map(pair);
  const total = spawns.reduce((a, [, n]) => a + n, 0);
  let k = 0;
  for (const [id, n] of spawns) {
    const def = ENEMIES[id];
    for (let i = 0; i < n && def; i++, k++) {
      const a = (k / Math.max(1, total)) * Math.PI * 2;
      const r = Number(q.get('spawnr') ?? 9);
      game.enemies.spawn(def, h.player.x + Math.cos(a) * r, h.player.z + Math.sin(a) * r, game.spawnOpts());
    }
  }
  if (q.has('golden')) game.spawnEnemy(ENEMIES.golden);
  const ev = q.get('event');
  if (ev && STAGE_EVENTS[ev as EventId]) game.runEvents.forceEvent(ev as EventId);
  if (q.has('boss')) game.debugSkipToBoss();
  routeLinks(game, q);
  animLinks(game, q);
  hudLinks(game, q);
  contentLinks(game, q);
  weapons3Links(game, q);
  companionLinks(game, q); // pet=, petlv=, mate, teamfull, teamgo=, teammove=, taunt, downmate=
  // Readability stress: &heroes=4 (up to 8), with real rigs, weapons and local effect replay.
  const heroCount = Math.min(8, Math.max(1, Number(q.get('heroes')) || 1));
  if (heroCount > game.heroes.length) {
    const team = [...game.heroes];
    for (let i = team.length; i < heroCount; i++) {
      const mate = game.makeHero(i, `P${i + 1}`, h.unlocked, '', 'classic', 'none');
      mate.startRun();
      mate.player.teleport(h.player.x + (i % 3 - 1) * 2.5, h.player.z + 2 + Math.floor(i / 3) * 2.5);
      mate.player.invuln = 1e6;
      team.push(mate);
    }
    game.setHeroes(team);
  }
  const numbers = q.get('numbers');
  if (numbers && ['auto', 'all', 'mine', 'off'].includes(numbers)) settings.damageNumbers = numbers as typeof settings.damageNumbers;
  coop2Links(game, q); // emote=, mateemote=, wheel=emotes, pool, downme=, autopilot, joincode=, teamult=, ghostgo= (src/dev/coop2Links.ts)
  worldEventLinks(game, q); // world events: wev=<kind>, wevat=, wevnow, wevt=, wevoff (src/dev/worldEventLinks.ts)
  timeLinks(game, q); // rewindgo=, standgo=, btgo=, replaygo=, clutchgo=, votego= (src/dev/timeLinks.ts)
  modesLinks(game, q); // rhythm, pacifist, pact=, minigame=, mgt=, ghost=demo, ghostlead=, modescreen=ghosts (src/dev/modesLinks.ts)
  cinematicsLinks(game, q); // skyfall=, ending=, reveal=, jackpot=, flawless=, titleplay=, cine= (src/dev/cinematicsLinks.ts)
  mpLinks(game, q); // MP lane: versus, localcoop, browse, teamboard, lobby= (src/dev/mpLinks.ts)
  sound2Links(game, q); // band=, instrument=, duelmusic, tension, djnow, crowd= (src/dev/sound2Links.ts)
  meta2Links(game, q); // m2screen=profile|achievements, m2lv=, m2demo, m2quests=, m2equip= (src/dev/meta2Links.ts)
  // &screen=settings: open a menu screen on top (for screenshots of menus).
  const scr = q.get('screen');
  if (scr) game.screens.show(scr as Parameters<typeof game.screens.show>[0]);
  // Settings lane: &settingstab=0..5, &vision=protanopia|deuteranopia|tritanopia, &textsize=150, &reduceeffects.
  if (q.has('settingstab')) game.screens.settingsScreen.selectTab(Number(q.get('settingstab')) || 0);
  if (q.has('assist')) settings.aimAssist = q.get('assist') !== 'off';
  const vision = q.get('vision');
  if (vision === 'protanopia' || vision === 'deuteranopia' || vision === 'tritanopia' || vision === 'off') settings.colorblindMode = vision;
  if (q.has('textsize')) settings.textScale = Number(q.get('textsize'));
  if (q.has('reduceeffects')) settings.reduceScreenEffects = true;
  if (q.has('vision') || q.has('textsize') || q.has('reduceeffects')) { applySettings(); game.screens.settingsScreen.sync(); }
  // &boom: an explosion near the hero every 0.7 s (checks lights, bloom and shockwaves).
  if (q.has('boom')) {
    let n = 0;
    setInterval(() => {
      if (game.paused) return;
      const p = game.hero.player;
      const a = n++ * 2.4;
      const x = p.x + Math.cos(a) * 5;
      const z = p.z + Math.sin(a) * 4;
      game.vfx.ring(x, z, 1, 10, '#ff7a2f', 0.45);
      game.vfx.star(x, 1.2, z, 3, '#ffb627', 0.2);
      game.vfx.burst(x, 0.6, z, { count: 18, color: '#ffb627', color2: '#ff5e3a', speed: [3, 9], size: [0.2, 0.45], life: [0.3, 0.7], up: 4, gravity: 12 });
    }, 700);
  }
  skyLinks(game, q);
  graphicsLinks(game, q); // anime, look=, customise, shatter=, impact=, fog=, puddles=, cine= (src/dev/graphicsLinks.ts)
  // Bosses: `bossnow` (boss right away), `phase=2` (push it into a phase), `miniboss`, `nointro`.
  if (q.has('nointro')) settings.bossIntros = false;
  bossLinks(game, q); // bosses lane: &titan, &titanphase=N, &titanmove=, &remix, &duel (src/dev/bossLinks.ts)
  game.debugBoss({ now: q.has('bossnow'), mini: q.has('miniboss'), phase: Number(q.get('phase')) || 0 });
  const near = q.get('near');
  if (near) nearToy(game, near);
  if (q.has('topple')) {
    const p = h.player;
    let best = null as (typeof game.toys.props)[number] | null;
    for (const t of game.toys.props) if (t.alive && t.def.kind === 'pillar' && (!best || Math.hypot(t.def.x - p.x, t.def.z - p.z) < Math.hypot(best.def.x - p.x, best.def.z - p.z))) best = t;
    if (best) game.damageProp(best, 1e6, 0, 0, 1);
  }
  const at = q.get('at');
  if (at) {
    let x = NaN;
    let z = NaN;
    if (/^-?[\d.]+,-?[\d.]+$/.test(at)) [x, z] = at.split(',').map(Number);
    else if (game.arena.deco && ['holo', 'vent', 'flag', 'sign', 'gap'].includes(at)) {
      // Neon City / Sky Fortress dressing: stand just south of (in front of) it.
      const d = game.arena.deco;
      const g = d.gaps.find((b) => b.maxX - b.minX < 10 && b.maxZ - b.minZ < 10) ?? d.gaps[0];
      const t = at === 'holo' ? d.holos[0] : at === 'vent' ? d.vents[0] : at === 'flag' ? d.flags[0] : at === 'sign' ? d.lights[0] : g ? { x: (g.minX + g.maxX) / 2, z: g.maxZ } : undefined;
      if (t) [x, z] = [t.x, t.z + 3];
    } else {
      game.worldFx(0); // builds the stage's surfaces now
      const p = game.ambience.surfaces.patches.find((s) => s.kind === at);
      if (p) [x, z] = [p.x, p.z + p.r + 1.5];
    }
    if (!Number.isNaN(x)) {
      const pl = game.hero.player;
      pl.pos.x = pl.prev.x = x;
      pl.pos.z = pl.prev.z = z;
    }
  }
  // Finisher lane (src/game/systems/characters.ts).
  if (q.get('finat')) charDebug.holdAt = Number(q.get('finat')) || 0.7;
  if (q.has('nofinish')) settings.finishers = false;
  if (q.has('calm')) {
    settings.reduceFlash = true; // also the game's reduce-motion switch
    applySettings();
  }
  const face = q.get('face');
  if (face) charDebug.face = face as Expression;
  if (q.has('pops')) {
    setTimeout(() => {
      portraits.popIn('announcer', 'grinning', 'S RANK! STYLISH!', 30);
      const b = game.enemies.list.find((e) => e.active && e.def.boss);
      portraits.popIn(`boss:${b?.def.id ?? 'king'}`, 'determined', 'OFF WITH YOUR HEAD!', 30);
    }, 600);
    setTimeout(() => portraits.popIn('hero:0', 'determined', 'CHEST!', 30), 900);
  }
  // Skill layer (src/game/systems/skill.ts).
  const rank = STYLE_RANKS.indexOf((q.get('style') ?? '').toUpperCase() as (typeof STYLE_RANKS)[number]);
  if (rank >= 0) {
    const t = styleTuning.thresholds;
    h.skill.style.add(t[rank] + ((t[rank + 1] ?? styleTuning.cap) - t[rank]) * 0.9, 'TEST LINK');
  }
  if (q.has('ult') || q.has('ultgo')) h.skill.ult = 1;
  const go = Number(q.get('ultgo'));
  if (go > 0) setTimeout(() => game.tryUlt(game.hero), go * 1000);
  // `parrygo=<s>`: a ring of enemy bullets closes in and gets parried; `dashgo=<s>`: one flies at you as you dash (perfect).
  const shootAt = (d: number, n: number) => {
    const p = game.hero.player;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      game.bullets.spawn({ x: p.x + Math.cos(a) * d, z: p.z + Math.sin(a) * d, dirX: -Math.cos(a), dirZ: -Math.sin(a), speed: 12, life: 3, radius: 0.26, damage: 10, knockback: 6, team: Team.Enemy, color: '#ff3df0', width: 0.5, length: 0.5 });
    }
  };
  const pg = Number(q.get('parrygo'));
  if (pg > 0) setTimeout(() => (shootAt(1.5, 8), game.tryParry(game.hero)), pg * 1000);
  const dg = Number(q.get('dashgo'));
  if (dg > 0) setTimeout(() => (shootAt(2.2, 1), game.onDash(game.hero)), dg * 1000);
  shopLinks(game, q); // shop lane: &mods, &shop, &levelup, &focus, &armban, &locked
  mods2Links(game, q);
  // Onboarding: &training=N, &tip=id, &discover=all, &recap, &offer (src/dev/onboardingLinks.ts).
  onboardingLinks(game, q);
  gameplayLinks(game, q); // mech, mechdrop, crate, super, mutate, overload, combo, cashgo, finale, comeback, relic (src/dev/gameplayLinks.ts)
  const metaScreen = q.get('metascreen') as MetaScreen;
  if (META_SCREENS.includes(metaScreen)) { game.paused = true; game.screens.show(metaScreen); }
  return true;
}

/** Put the hero next to the nearest arena toy or hazard of a kind (a pad: right on it). */
function nearToy(game: Game, kind: string): void {
  const t = game.toys;
  const spots: { x: number; z: number }[] =
    kind === 'pad' ? t.pads
    : kind === 'turret' ? t.turrets
    : kind === 'pillar' || kind === 'crate' ? t.props.filter((p) => (kind === 'pillar' ? p.def.kind === 'pillar' : p.def.kind !== 'pillar')).map((p) => p.def)
    : kind === 'totem' ? t.totems
    : kind === 'shard' ? t.shards
    : kind === 'beacon' ? (t.beacon ? [t.beacon] : [])
    : game.arena.hazards.filter((z) => z.kind === kind);
  const s = spots[0];
  if (!s) return;
  const off = kind === 'pad' ? 0 : kind === 'lava' || kind === 'ice' || kind === 'quicksand' || kind === 'thorns' ? 4.5 : 3;
  game.hero.player.teleport(s.x, s.z + off);
}

/** Test-link options for checking animation and the camera (see the header). */
function animLinks(game: Game, q: URLSearchParams): void {
  const vec = (k: string) => (q.get(k) ?? '').split(',').map(Number) as [number, number];
  const v = game.input.virtual;
  if (q.get('move')) {
    const [x, z] = vec('move');
    v.active = true;
    v.move.x = x || 0;
    v.move.y = z || 0;
  }
  if (q.get('aim')) {
    const [x, z] = vec('aim');
    v.active = true;
    v.aim.x = x || 0;
    v.aim.y = z || 0;
  }
  if (q.has('circle')) {
    v.active = true;
    const t0 = performance.now();
    setInterval(() => {
      const a = (performance.now() - t0) / 900;
      v.move.x = Math.cos(a);
      v.move.y = Math.sin(a);
    }, 16);
  }
  if (q.get('dashes')) {
    v.active = true;
    setInterval(() => {
      v.buttons[0] = true;
      setTimeout(() => (v.buttons[0] = false), 50);
    }, (Number(q.get('dashes')) || 1) * 1000);
  }
  if (q.get('cam')) game.cam.zoom = Number(q.get('cam')) || 1;
  if (q.get('swarm')) {
    const [n, id] = (q.get('swarm') ?? '').split(':');
    const def = ENEMIES[id ?? 'swarmer'] ?? ENEMIES.swarmer;
    const p = game.hero.player;
    const count = Math.min(400, Number(n) || 100);
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 * 3;
      const r = 6 + (i / count) * 16;
      game.enemies.spawn(def, p.x + Math.cos(a) * r, p.z + Math.sin(a) * r, { instant: true });
    }
  }
  if (q.get('hold')) {
    // hold=180 (swarmers) or hold=150,20:spinner: top each type back up to its count.
    const want = (q.get('hold') ?? '').split(',').filter(Boolean).map((x) => {
      const [n, id] = x.split(':');
      return { def: ENEMIES[id ?? 'swarmer'] ?? ENEMIES.swarmer, n: Math.min(400, Number(n) || 150) };
    });
    let k = 0;
    setInterval(() => {
      if (game.paused || !game.isCombatMode) return;
      const p = game.hero.player;
      for (const w of want) {
        for (let i = game.enemies.countOf(w.def.id); i < w.n; i++, k++) {
          const a = k * 2.399; // golden angle: spread around the hero
          const r = 10 + (k % 7) * 2;
          game.enemies.spawn(w.def, p.x + Math.cos(a) * r, p.z + Math.sin(a) * r, { instant: true });
        }
      }
    }, 500);
  }
  if (q.get('bullets')) {
    // bullets=500: keep that many enemy bullets in flight (spirals around the hero; god mode recommended).
    const want = Math.min(2000, Number(q.get('bullets')) || 300);
    let k = 0;
    setInterval(() => {
      if (game.paused || !game.isCombatMode) return;
      const p = game.hero.player;
      for (let i = game.bullets.count; i < want; i++, k++) {
        const a = k * 2.399;
        const r = 6 + (k % 11);
        const x = p.x + Math.cos(a) * r;
        const z = p.z + Math.sin(a) * r;
        game.bullets.spawn({ x, z, dirX: -Math.sin(a), dirZ: Math.cos(a), speed: 5, life: 2.5, radius: 0.26, damage: 1, knockback: 0, team: Team.Enemy, color: '#ff3df0', width: 0.5, length: 0.5 });
      }
    }, 100);
  }
  if (q.has('frozen')) for (const e of game.enemies.list) e.speedMul = 0;
  const later = (k: string, fn: () => void) => {
    if (q.get(k)) setTimeout(fn, (Number(q.get(k)) || 1) * 1000);
  };
  later('killboss', () => {
    const b = game.enemies.list.find((e) => e.active && e.def.boss);
    if (b) game.killEnemy(b, 'buster', game.hero);
  });
  later('clear', () => game.stageClear());
  // `smash=<s>`: stand next to the nearest smashable cover and break it after s seconds (fixes lane).
  if (q.get('smash')) {
    const map = game.arena.group.userData.coverRanges as Map<unknown, unknown> | undefined;
    const p = game.hero.player;
    let best = null as null | { x: number; z: number };
    for (const b of game.arena.colliders) {
      if (!map?.has(b)) continue;
      const c = { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 };
      if (!best || Math.hypot(c.x - p.x, c.z - p.z) < Math.hypot(best.x - p.x, best.z - p.z)) best = c;
    }
    if (best) {
      const c = best;
      p.teleport(c.x + 1, c.z + 3.5);
      later('smash', () => smashCover(game, c.x, c.z, 1));
    }
  }
  later('photo', () => {
    const ph = game.photo as PhotoMode | null;
    if (!ph) return;
    game.pause();
    if (!ph.open()) return;
    const cam = (q.get('photocam') ?? '').split(',').filter(Boolean).map(Number);
    ph.configure({
      filter: q.get('photofilter') ?? undefined,
      frame: q.get('photoframe') ?? undefined,
      stickers: (q.get('stickers') ?? '').split(';').filter(Boolean).map((s) => {
        const [id, at = '0.5,0.5'] = s.split('@');
        const [u, v] = at.split(',').map(Number);
        return { id, u: u || 0.5, v: v || 0.5 };
      }),
      logo: !q.has('nologo'),
      yaw: Number.isFinite(cam[0]) ? cam[0] : undefined,
      pitch: Number.isFinite(cam[1]) ? cam[1] : undefined,
      dist: Number.isFinite(cam[2]) ? cam[2] : undefined,
      hideUi: q.has('photohide'),
    });
    if (q.has('photosnap')) setTimeout(() => ph.snap(), 600);
  });
  later('die', () => {
    cheats.god = false;
    const p = game.hero.player;
    p.invuln = 0;
    game.hero.revivesLeft = 0;
    if (p.hurt(p.hp + 1, -p.aim.x, -p.aim.z)) game.onHeroDown(game.hero);
  });
  if (q.get('hurt')) {
    const every = (Number(q.get('hurt')) || 1.5) * 1000;
    setInterval(() => {
      const p = game.hero.player;
      p.invuln = 0;
      p.hurt(1, -p.aim.x, -p.aim.z);
    }, every);
  }
}

/** Route map links: &route (open the map now, &path=1,0 for the roads taken so far), &node=<kind>, &encounter=<id>. */
function routeLinks(game: Game, q: URLSearchParams): void {
  const node = q.get('node');
  if (node && node in ROUTE_NODES) {
    game.route.force = node as NodeKind;
    game.routeStageStart();
  }
  const path = (q.get('path') ?? '').split(',').filter(Boolean).map(Number);
  path.forEach((p, i) => (game.route.path[i + 2] = p));
  if (q.has('route')) {
    game.route.on = true;
    game.mode = 'shop';
    game.openRoute();
  }
  const enc = q.get('encounter');
  if (enc) game.routeTestEvent(enc);
}

/** Sky lane options: `tod=<0..1>` pins the time of day, `scars=<n>[:kind]` leaves battle damage around the hero, `clouds=<0..1>`. */
function skyLinks(game: Game, q: URLSearchParams): void {
  const tod = q.get('tod');
  if (tod !== null) skyOverrides.tod = Math.max(0, Math.min(1, Number(tod) || 0));
  const cl = q.get('clouds');
  if (cl !== null) skyTuning.cloudStrength = Math.max(0, Math.min(1, Number(cl) || 0));
  const sc = q.get('scars');
  if (!sc) return;
  const [n, kind] = sc.split(':');
  const colors = kind === 'crater' ? [SCAR_COLORS.crater] : kind === 'frost' ? [SCAR_COLORS.frost] : kind === 'scorch' ? [SCAR_COLORS.scorch] : [SCAR_COLORS.crater, SCAR_COLORS.scorch, SCAR_COLORS.scorch, SCAR_COLORS.frost];
  setTimeout(() => {
    const p = game.hero.player;
    const count = Math.min(300, Number(n) || 20);
    for (let i = 0; i < count; i++) {
      const a = i * 2.39996;
      const r = 2.5 + Math.sqrt(i / count) * 13;
      game.vfx.scar(p.x + Math.cos(a) * r, p.z + Math.sin(a) * r * 0.75, 1 + ((i * 7) % 5) * 0.45, colors[i % colors.length], 8 + (i % 4) * 6);
    }
  }, 500);
}
