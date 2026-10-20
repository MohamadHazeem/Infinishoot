/**
 * heroes4 lane: the Medic (mending beam, revive drone, regeneration aura,
 * Field Hospital) and the Brawler (punch combo, grab and throw, shoulder
 * charge, Wrecking Ball). Pure helpers and data first, then the real game in
 * jsdom (no WebGL).
 */
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { ok } from './check';

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
  try { (globalThis as any)[k] = (dom.window as any)[k]; } catch { Object.defineProperty(globalThis, k, { value: (dom.window as any)[k], configurable: true }); }
}
(globalThis as any).Path2D = (dom.window as any).Path2D = class { constructor(_d?: string) {} };
(globalThis as any).__APP_VERSION__ = 'test';
(dom.window.HTMLElement.prototype as any).scrollIntoView = () => {};
(globalThis as any).matchMedia = (dom.window as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });

const H4 = await import('../src/game/heroes4');
const { HEROES, heroOf, heroClicks } = await import('../src/data/heroes');
const { WEAPONS } = await import('../src/data/weapons');
const { loadoutOptions, validLoadout } = await import('../src/data/loadout');
const { ACHIEVEMENTS } = await import('../src/data/meta');
const { ULTS } = await import('../src/game/ultimates');
const { RECORDED_VOICES } = await import('../src/audio/voices');
const { HERO_VOICES } = await import('../src/audio/voice');
const { speaksRecorded } = await import('../src/audio/heroVoice');
const { WEAPON_STEMS } = await import('../src/audio/stems');
const { EVO_LAYERS } = await import('../src/audio/evoLayers');
const { weaponSamples, cueSamples } = await import('../src/audio/mix');
const { roleOf } = await import('../src/data/coopRoles');
const { ICON_ART } = await import('../src/data/iconArt');
const { paintPortrait, heroLook } = await import('../src/ui/portraitArt');
const { SKINS } = await import('../src/data/skins');
const { CODEX } = await import('../src/data/codex');
const { setLanguage, localize } = await import('../src/i18n');
const { storyEn, storyAr } = await import('../src/game/story/strings');
const { heroes4En } = await import('../src/i18n/heroes4');

const { segPoint, onBeam, leechHeal, nextPunch, punchShape, grabbable, pickDowned, hitAfterCare, heroes4Tuning } = H4;

// ---------------------------------------------------------------- data
const medic = heroOf('medic');
const brawler = heroOf('brawler');
ok(medic.id === 'medic' && medic.mech === 'medic' && brawler.id === 'brawler' && brawler.mech === 'brawler', 'Medic and Brawler are heroes with their mechanic');
ok(ULTS[medic.ult]?.name === 'FIELD HOSPITAL' && ULTS[brawler.ult]?.name === 'WRECKING BALL', 'both have their own ultimate');
ok([medic.unlock, brawler.unlock].every((u) => ACHIEVEMENTS.some((a) => a.id === u)), 'both unlock through new achievements');
ok(new Set(HEROES.map((h) => h.ult)).size === HEROES.length, 'ultimates stay unique');
const lo = { primary: 'laser', secondary: 'well', special: 'bomb' };
ok(heroClicks(medic, lo).primary === 'medbeam' && heroClicks(medic, lo).secondary === 'revdrone', 'the Medic plays the mending beam and the revive drone');
ok(heroClicks(brawler, lo).primary === 'fists' && heroClicks(brawler, lo).secondary === 'grab', 'the Brawler plays the fists and the grab');
ok(['medbeam', 'fists'].every((id) => !loadoutOptions('primary').includes(id)) && ['revdrone', 'grab'].every((id) => !loadoutOptions('secondary').includes(id)), 'hero-only clicks never show on the LOADOUT screen');
ok(validLoadout({ primary: 'fists', secondary: 'revdrone', special: 'bomb' }).primary === 'buster', 'a loadout can not smuggle a hero-only click');
for (const id of ['medbeam', 'revdrone', 'fists', 'grab']) {
  const d = WEAPONS[id];
  ok(!!d && !!d.slot && !!d.heroOnly && d.tracks?.length === 3 && d.tracks.every((t) => t.ranks.length === 4) && d.evos?.length === 2 && !!d.feel, `${id}: 3 tracks of 4 ranks, 2 evolutions, feel`);
  ok(!!WEAPON_STEMS[id] && d.evos!.every((e) => !!EVO_LAYERS[`${id}.${e.id}`]), `${id}: a music stem and evolution sound layers`);
  ok(!!ICON_ART[id] && !!ICON_ART[`${id}_evo`] && !!ICON_ART[`${id}_evo2`], `${id}: icons for it and both evolutions`);
}
ok(!!weaponSamples.punchHeavy && !!weaponSamples.grab && !!weaponSamples.throw && !!cueSamples.fieldHospital && !!cueSamples.wreckingBall, 'new cues have recorded samples layered on the synth');
// Voices: no recordings for these two, so the synthesized voice speaks every moment.
ok(!RECORDED_VOICES.has('medic') && !RECORDED_VOICES.has('brawler'), 'Medic and Brawler have no recorded barks');
ok(!!HERO_VOICES.medic && !!HERO_VOICES.brawler && HERO_VOICES.medic.f0 !== HERO_VOICES.brawler.f0, 'both have their own synthesized voice');
ok(!speaksRecorded('medic', 'levelUp') && !speaksRecorded('brawler', 'hurt'), 'the synthesized voice covers them (the recorded-voice fallback)');
ok(roleOf('medic') === 'healer' && roleOf('brawler') === 'tank', 'co-op roles: Medic healer, Brawler tank');
{
  const a = paintPortrait(heroLook('medic', SKINS[0]), 'neutral');
  const b = paintPortrait(heroLook('rookie', SKINS[0]), 'neutral');
  const c = paintPortrait(heroLook('brawler', SKINS[0]), 'neutral');
  let da = 0;
  let dc = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) da++;
    if (c[i] !== b[i]) dc++;
  }
  ok(da > 100 && dc > 100, `portraits: the Medic's cap and the Brawler's crest change the bust (${da}, ${dc} bytes)`);
}
// Copy: codex, story and Arabic.
for (const id of ['medic', 'brawler']) {
  const cx = CODEX.find((c) => c.id === `hero:${id}`);
  ok(!!cx && cx.text.length > heroOf(id).desc.length + 30, `${id}: a codex entry with lore`);
  ok(!!(storyEn as Record<string, string>)[`story.hero.${id}`] && !!(storyAr as Record<string, string>)[`story.end.${id}`], `${id}: story bio and ending in English and Arabic`);
  ok(cx!.text === (heroes4En as Record<string, string>)[`heroes4.${id}.codex`] && heroOf(id).desc === (heroes4En as Record<string, string>)[`heroes4.${id}.desc`], `${id}: the catalog matches the data copy exactly`);
}
setLanguage('ar');
{
  const strings: string[] = [medic.name, brawler.name, medic.desc, brawler.desc, ULTS.hospital.name, ULTS.hospital.desc, ULTS.wrecking.name, ULTS.wrecking.desc];
  for (const id of ['medbeam', 'revdrone', 'fists', 'grab']) {
    const d = WEAPONS[id];
    strings.push(d.name, d.desc, d.levels[0].text, ...d.tracks!.flatMap((t) => [t.name, ...t.ranks.map((r) => r.text)]), ...d.evos!.flatMap((e) => [e.name, e.text]));
  }
  for (const a of ACHIEVEMENTS.filter((x) => x.id === 'lifesaver' || x.id === 'wrecking_crew')) strings.push(a.name, a.desc);
  for (const id of ['medic', 'brawler']) strings.push(CODEX.find((c) => c.id === `hero:${id}`)!.text);
  const missed = strings.filter((s) => /[a-z]{3}/i.test(localize(s)));
  ok(missed.length === 0, 'every new string translates to Arabic: ' + missed.join(' || '));
}
setLanguage('en');

// ---------------------------------------------------------------- pure helpers
ok(Math.abs(segPoint(1, 1, 0, 0, 2, 0).d - 1) < 1e-6 && Math.abs(segPoint(1, 1, 0, 0, 2, 0).t - 0.5) < 1e-6, 'segment distance and position');
ok(onBeam(5, 0.4, 0.3, 0, 0, 0, 10, 0.5) && !onBeam(5, 1.2, 0.3, 0, 0, 0, 10, 0.5), 'the beam hits what is on it, not beside it');
ok(!onBeam(-2, 0, 0.3, 0, 0, 0, 10, 0.5) && !onBeam(11.5, 0, 0.3, 0, 0, 0, 10, 0.5), 'nothing behind the hand or past the end');
ok(leechHeal(100, 0.05, 0) === 5 && leechHeal(1000, 0.05, 0) === heroes4Tuning.medic.leechCap && leechHeal(100, 0.05, heroes4Tuning.medic.leechCap) === 0, 'the beam mends 5% of its damage, within a per-second budget');
ok(nextPunch(-1, 0) === 0 && nextPunch(0, 0.1) === 1 && nextPunch(1, 0.1) === 2 && nextPunch(2, 0.1) === 0 && nextPunch(1, 5) === 0, 'jab, cross, haymaker, then over; a pause resets');
const fp = WEAPONS.fists.levels[0].p;
const j = punchShape(fp, 0, 1, 1);
const hm = punchShape(fp, 2, 1, 1.25);
ok(hm.reach > j.reach && hm.mul > 2 && hm.knock > j.knock * 3 && hm.knock <= heroes4Tuning.brawler.launchMax, 'the haymaker reaches further, hits harder and launches (capped)');
ok(hm.knock > 4, 'a haymaker launch is fast enough to count as knocked into a hazard');
const mk = (o: Partial<{ boss: boolean; miniboss: string; behavior: string; hidden: boolean; pvp: number }>) => ({ def: { boss: o.boss, miniboss: o.miniboss, behavior: o.behavior ?? 'lunge', hidden: o.hidden }, pvpOwner: o.pvp ?? -1 });
ok(grabbable(mk({})) && !grabbable(mk({ boss: true })) && !grabbable(mk({ miniboss: 'king' })) && !grabbable(mk({ behavior: 'reaper' })) && !grabbable(mk({ pvp: 1 })), 'bosses, mini-bosses, the Reaper and PvP stand-ins can not be lifted');
{
  const list = [{ x: 10, z: 0, ok: true, id: 'a' }, { x: 3, z: 3, ok: true, id: 'b' }, { x: 2, z: 0, ok: false, id: 'c' }, { x: 40, z: 0, ok: true, id: 'd' }];
  ok(pickDowned(list, 0, 0, 9, 0, 16)?.id === 'a' && pickDowned(list, 0, 0, 3, 4, 16)?.id === 'b', 'the drone goes to the downed teammate closest to the cursor');
  ok(pickDowned(list, 0, 0, 40, 0, 16)?.id !== 'd' && pickDowned([list[3]], 0, 0, 40, 0, 16) === null, 'only within range');
}
ok(hitAfterCare(30, 50, 2, false).dmg === 0 && hitAfterCare(30, 50, 2, false).blocked, 'a shield blocks a hit');
ok(hitAfterCare(80, 50, 0, true).dmg === 49 && hitAfterCare(80, 50, 0, true).saved && hitAfterCare(20, 50, 0, true).dmg === 20, 'Field Hospital: a lethal hit leaves 1 life, others land');
ok(hitAfterCare(80, 50, 0, false).dmg === 80, 'outside the ward hits land');

// ---------------------------------------------------------------- the real game
const { Input } = await import('../src/core/input');
const { Game, cheats } = await import('../src/game/game');
const { Team } = await import('../src/game/bullets');
const { ENEMIES } = await import('../src/data/enemies');
const { settings } = await import('../src/game/settings');
const { unlockedWeapons } = await import('../src/game/save');
const { h4World, heroes4Net, applyHeroes4Net, heroes4Achievements } = await import('../src/game/systems/heroes4');
const { DroneMode } = await import('../src/game/weapons/revdrone');

const input = new Input(document.getElementById('game') as HTMLCanvasElement);
const game = new Game(input, 16 / 9, document.getElementById('hud')!, document.getElementById('reticle')!);
cheats.unlockAll = true;
cheats.god = true;
const step = (n: number, each?: () => void) => {
  for (let i = 0; i < n; i++) {
    each?.();
    game.update(1 / 60);
    if (game.mode === 'levelup') (game as unknown as { ui(a: string, i: number): void }).ui('pick', 0);
  }
};
const fresh = (hero: string) => {
  settings.hero = hero;
  settings.loadout = { primary: 'buster', secondary: 'charge', special: 'bomb' };
  game.applyLocalSkin();
  game.startSolo();
  if (game.mode === 'shop') game.closeShop();
  game.enemies.clear();
  game.bullets.clear();
  game.director.time = 0;
  game.xpNext = 1e12;
  step(1);
};
const spawn = (id: string, x: number, z: number, hp = 5000) => {
  const e = game.enemies.spawn(ENEMIES[id], x, z, game.spawnOpts({ instant: true }));
  e.hp = e.maxHp = hp;
  return e;
};
let FIRE = false;
let CHARGE = false;
const origUpdateHero = game.updateHero.bind(game);
game.updateHero = (h, dt, local) => {
  origUpdateHero(h, dt, local);
  if (h === game.hero) {
    h.ctx.firing = FIRE;
    h.ctx.charging = CHARGE;
  }
};
/** A dummy teammate (like the `&mate` test link). */
const addMate = () => {
  const h = game.hero;
  const mate = game.makeHero(1, 'Buddy', unlockedWeapons(), '', 'classic', 'bit');
  mate.startRun();
  game.setHeroes([h, mate]);
  mate.player.teleport(h.player.x + 3, h.player.z);
  mate.player.invuln = 0;
  return mate;
};

// ---- Medic
fresh('medic');
let h = game.hero;
let p = h.player;
ok(h.weapons[0].def.id === 'medbeam' && h.weapons[1].def.id === 'revdrone', 'a Medic run starts with the mending beam and the revive drone');
p.setAimDir(1, 0);
const a1 = spawn('bopper', p.x + 4, p.z);
const a2 = spawn('bopper', p.x + 7, p.z + 0.2);
const off = spawn('bopper', p.x + 4, p.z + 4);
off.frozen = 99;
p.hp = p.maxHp - 40;
const hpBefore = p.hp;
FIRE = true;
step(60, () => p.setAimDir(1, 0));
FIRE = false;
ok(a1.hp < a1.maxHp && a2.hp < a2.maxHp && (h.damageBy.medbeam ?? 0) > 0, 'the beam burns through the enemies on it');
ok(off.hp === off.maxHp, 'and not one beside it');
ok(p.hp > hpBefore + 2, `every hit mends the Medic (${(p.hp - hpBefore).toFixed(1)} in 1 s)`);
// The beam heals a teammate it passes through; the aura heals nearby teammates.
game.enemies.clear();
const mate = addMate();
mate.player.teleport(p.x + 3, p.z);
mate.player.hp = mate.player.maxHp - 60;
const mateHp = mate.player.hp;
FIRE = true;
step(60, () => {
  p.setAimDir(1, 0);
  mate.player.teleport(p.x + 3, p.z);
});
FIRE = false;
const healed = mate.player.hp - mateHp;
ok(healed > 10, `the beam (and the aura) heal a teammate on it (${healed.toFixed(1)} in 1 s)`);
mate.player.hp = mate.player.maxHp - 60;
const auraHp = mate.player.hp;
step(120, () => mate.player.teleport(p.x + 3, p.z + 2));
ok(mate.player.hp > auraHp + 2 && mate.player.hp < auraHp + 6, `a teammate near the Medic regenerates (${(mate.player.hp - auraHp).toFixed(1)} in 2 s)`);
// The revive drone picks up a downed teammate from range.
mate.player.teleport(p.x + 12, p.z);
mate.player.invuln = 0;
mate.player.hurt(mate.player.hp + 1, 1, 0);
game.onHeroDown(mate);
ok(mate.player.dead, 'the teammate is down');
const drone = h.weapons[1] as import('../src/game/weapons/revdrone').RevDrone;
p.setAimPoint(p.x + 12, p.z);
CHARGE = true;
step(2, () => p.setAimPoint(mate.player.x, mate.player.z));
CHARGE = false;
ok(drone.mode === DroneMode.Flying && drone.target === mate.index && drone.ready < 1, 'right click sends the drone to the downed teammate');
step(120, () => p.setAimPoint(mate.player.x, mate.player.z));
ok(!mate.player.dead && drone.mode === DroneMode.Idle, `the drone revives them from 12 m away`);
// Solo use: the drone shields; a shielded hit is blocked.
step(60 * 21);
CHARGE = true;
step(2, () => p.setAimDir(1, 0));
CHARGE = false;
ok(drone.mode === DroneMode.Shield && drone.target === h.index && drone.hits === WEAPONS.revdrone.levels[0].p.hits, 'with nobody down the drone shields the Medic');
cheats.god = false;
p.invuln = 0;
const shieldHp = p.hp;
game.hurtHero(h, 30, p.x + 1, p.z, null, 'test');
ok(p.hp === shieldHp && drone.hits === WEAPONS.revdrone.levels[0].p.hits - 1, 'the shield blocks a hit');
cheats.god = true;
// Field Hospital: heals, kills enemy shots, wears enemies down, keeps everyone at 1 life.
game.setHeroes([h]);
game.enemies.clear();
step(20);
const foe = spawn('bopper', p.x + 4, p.z, 400);
h.skill.ult = 1;
game.tryUlt(h);
ok(h.skill.ultT > 0, 'Field Hospital starts');
const zw = h4World(game);
step(2);
ok(zw.zones.length === 1, 'the ward opens where the Medic stands');
game.bullets.spawn({ x: p.x + 2, z: p.z, dirX: -1, dirZ: 0, speed: 0.1, life: 4, radius: 0.26, damage: 10, knockback: 6, team: Team.Enemy, color: '#ff3df0', width: 0.5, length: 0.5 });
const ebAt = game.bullets.count - 1;
p.hp = 10;
step(4);
ok(game.bullets.team[ebAt] !== Team.Enemy || game.bullets.count <= ebAt, 'enemy shots fizzle inside the ward');
step(60);
ok(p.hp > 15, `the ward heals (${p.hp.toFixed(1)})`);
ok(foe.hp < foe.maxHp || !foe.active, 'the ward wears down the enemies inside');
cheats.god = false;
p.invuln = 0;
p.hp = 5;
game.hurtHero(h, 999, p.x + 1, p.z, null, 'test');
ok(!p.dead && p.hp >= 1, 'nobody inside can drop below 1 life');
cheats.god = true;
// The ward reaches clients.
const net = heroes4Net(game, h);
ok(!!net?.z && net.z.length === 5, 'the h4 snapshot field carries the ward');
const zones = zw.zones.slice();
applyHeroes4Net(game, { z: [0, 1, 2, 3, 6] });
ok(zw.zones.length === 1 && zw.zones[0].x === 1 && zw.zones[0].t === 3, 'clients mirror the ward');
zw.zones = zones;
step(60 * 7);
ok(h.skill.ultT === 0 && zw.zones.length === 0, 'Field Hospital closes');

// ---- Brawler
fresh('brawler');
h = game.hero;
p = h.player;
ok(h.weapons[0].def.id === 'fists' && h.weapons[1].def.id === 'grab', 'a Brawler run starts with the fists and the grab');
const fists = h.weapons[0] as import('../src/game/weapons/fists').Fists;
const f1 = spawn('bopper', p.x + 1.6, p.z);
let sawHay = false;
let launched = 0;
FIRE = true;
step(60, () => {
  p.setAimDir(1, 0);
  if (fists.step === 2) sawHay = true;
  launched = Math.max(launched, Math.hypot(f1.kx, f1.kz));
});
FIRE = false;
ok(f1.hp < f1.maxHp && (h.damageBy.fists ?? 0) > 0, 'the punch combo hits');
ok(sawHay && launched > 15, `the haymaker launches (${launched.toFixed(1)} m/s)`);
// Punches knock bullets away.
game.enemies.clear();
step(40);
game.bullets.spawn({ x: p.x + 1.2, z: p.z, dirX: -1, dirZ: 0, speed: 1, life: 4, radius: 0.26, damage: 10, knockback: 6, team: Team.Enemy, color: '#ff3df0', width: 0.5, length: 0.5 });
const pb = game.bullets.count - 1;
FIRE = true;
step(3, () => p.setAimDir(1, 0));
FIRE = false;
ok(game.bullets.team[pb] !== Team.Enemy || game.bullets.count <= pb, 'a punch swats an enemy bullet');
// Grab, carry, throw through a line of enemies.
game.enemies.clear();
step(60);
const grabbed = spawn('bopper', p.x + 1.4, p.z);
const pins = [spawn('bopper', p.x + 5, p.z), spawn('bopper', p.x + 7, p.z + 0.3)];
step(2);
const grab = h.weapons[1] as import('../src/game/weapons/grab').Grab;
CHARGE = true;
step(20, () => p.setAimDir(1, 0));
ok(grab.held === grabbed && grab.holding, 'right click grabs the enemy in front');
ok(Math.hypot(grabbed.x - p.x, grabbed.z - p.z) < 3, 'and carries it');
CHARGE = false;
step(40, () => p.setAimDir(1, 0));
ok(!grab.holding && grabbed.hp < grabbed.maxHp, 'letting go throws it, and the landing hurts');
ok(pins.every((e) => e.hp < e.maxHp), 'the thrown enemy smashes the ones in its way');
ok(grab.ready < 1, 'the grab recharges');
// Bosses get an uppercut instead.
game.enemies.clear();
step(120);
const boss = spawn('king', p.x + 2, p.z, 20000);
step(2);
CHARGE = true;
step(2, () => p.setAimDir(1, 0));
CHARGE = false;
ok(!grab.holding && boss.hp < boss.maxHp && grab.upSeq > 0, 'a boss gets an uppercut, not a grab');
// Shoulder charge: the dash bowls enemies over.
game.enemies.clear();
step(60);
const bowl = spawn('bopper', p.x + 1.5, p.z);
step(2);
p.lunge(1, 0, 0.16, 24);
step(10);
ok(bowl.hp < bowl.maxHp && (h.damageBy.shoulder ?? 0) > 0, 'the dash is a shoulder charge that hits');
// Wrecking Ball: pound, spin, launch.
game.enemies.clear();
const ring = Array.from({ length: 8 }, (_, i) => spawn('bopper', p.x + Math.cos(i) * 2, p.z + Math.sin(i) * 2, 200));
const kills0 = game.kills;
h.skill.ult = 1;
game.tryUlt(h);
step(3);
ok(h.skill.ultT > 0 && p.ultSpeed > 1, 'Wrecking Ball starts and speeds the Brawler up');
step(60 * 4 + 30);
ok(h.skill.ultT === 0 && p.ultSpeed === 1 && game.kills - kills0 >= 6, `Wrecking Ball smashes the ring (${game.kills - kills0} kills)`);
void ring;
// Environmental kills count for Wrecking Crew.
const w = h4World(game);
w.envKills[h.index] = 0;
const doomed = spawn('bopper', p.x + 3, p.z, 50);
game.envHit(doomed, 'lava', 999);
ok((w.envKills[h.index] ?? 0) === 1, 'an environmental kill counts for Wrecking Crew');
w.envKills[h.index] = heroes4Tuning.brawler.envKills;
ok(heroes4Achievements(game).find(([id]) => id === 'wrecking_crew')?.[1] === true, 'Wrecking Crew unlocks at 20');
ok(heroes4Achievements(game).find(([id]) => id === 'lifesaver')?.[1] === false || w.lifesaver, 'Lifesaver waits for a clutch stage clear');
// A thrown enemy into lava dies there: an environmental kill (the arena's own rule, src/game/hazards.ts).
game.enemies.clear();
step(120);
w.envKills[h.index] = 0;
game.arena.hazards.push({ x: p.x + 6, z: p.z, r: 2.2, kind: 'lava' });
const victim = spawn('bopper', p.x + 1.4, p.z, 3000);
step(2);
CHARGE = true;
step(10, () => p.setAimDir(1, 0));
CHARGE = false;
step(40, () => p.setAimDir(1, 0));
ok(!victim.active || victim.hp <= 0, 'an enemy thrown into lava burns up');
ok((w.envKills[h.index] ?? 0) >= 1, `and it counts as an environmental kill (${w.envKills[h.index] ?? 0})`);
game.arena.hazards.pop();
// Lifesaver: a dip under 20% life, then the stage cleared alive.
const { renderHeroes4 } = await import('../src/game/systems/heroes4');
w.lifesaver = false;
game.mode = 'fight';
p.hp = p.maxHp * 0.1;
renderHeroes4(game, 1 / 60);
game.mode = 'cleared';
renderHeroes4(game, 1 / 60);
ok(w.lifesaver && heroes4Achievements(game).find(([id]) => id === 'lifesaver')?.[1] === true, 'Lifesaver: clearing a stage after dropping under 20% life');
game.mode = 'fight';
console.log('heroes4 checks done');
process.exit(process.exitCode ?? 0);
