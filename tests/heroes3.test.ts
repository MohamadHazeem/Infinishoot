/**
 * heroes3 lane: the Ronin (sword combo, dash-strike, parry counter, Thousand
 * Cuts) and the Tinker (bots, turret beacon, Scrap Legion). Pure helpers first,
 * then the real game in jsdom (no WebGL).
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

const H3 = await import('../src/game/heroes3');
const { HEROES, heroOf, heroClicks } = await import('../src/data/heroes');
const { WEAPONS } = await import('../src/data/weapons');
const { loadoutOptions, validLoadout } = await import('../src/data/loadout');
const { ACHIEVEMENTS } = await import('../src/data/meta');
const { ULTS } = await import('../src/game/ultimates');
const { RECORDED_VOICES, barkSample, VOICE_PRIORITY } = await import('../src/audio/voices');
const { VOICE_TEXT } = await import('../src/audio/voiceText');
const { speaksRecorded } = await import('../src/audio/heroVoice');
const { WEAPON_STEMS } = await import('../src/audio/stems');
const { EVO_LAYERS } = await import('../src/audio/evoLayers');
const { roleOf } = await import('../src/data/coopRoles');
const { ICON_ART } = await import('../src/data/iconArt');
const { paintPortrait, heroLook } = await import('../src/ui/portraitArt');
const { SKINS } = await import('../src/data/skins');

const { inSwordArc, nextComboStep, swingShape, swingWaves, iaidoStrike, segDist, minionCap, legionCount, MinionPool, MinionKind, packMinions, unpackMinions, heroes3Tuning } = H3;

// ---------------------------------------------------------------- data
const ronin = heroOf('ronin');
const tinker = heroOf('tinker');
ok(ronin.id === 'ronin' && ronin.mech === 'ronin' && tinker.id === 'tinker' && tinker.mech === 'tinker', 'Ronin and Tinker are heroes with their mechanic');
ok(!!ULTS[ronin.ult] && !!ULTS[tinker.ult] && ULTS.cuts.name === 'THOUSAND CUTS' && ULTS.legion.name === 'SCRAP LEGION', 'both have an ultimate');
ok([ronin.unlock, tinker.unlock].every((u) => ACHIEVEMENTS.some((a) => a.id === u)), 'both unlock through new achievements');
ok(HEROES.every((h) => h.ult && ULTS[h.ult]), 'every hero has an ultimate');
const lo = { primary: 'laser', secondary: 'well', special: 'bomb' };
ok(heroClicks(ronin, lo).primary === 'katana' && heroClicks(ronin, lo).secondary === 'iaido', 'the Ronin always plays the katana and the dash-strike');
ok(heroClicks(tinker, lo).primary === 'laser' && heroClicks(tinker, lo).secondary === 'beacon', 'the Tinker keeps its left click and drops beacons on right click');
ok(heroClicks(heroOf('rookie'), lo).primary === 'laser', 'other heroes keep their loadout');
ok(!loadoutOptions('primary').includes('katana') && !loadoutOptions('secondary').includes('iaido') && !loadoutOptions('secondary').includes('beacon'), 'hero-only clicks never show on the LOADOUT screen');
ok(validLoadout({ primary: 'katana', secondary: 'beacon', special: 'bomb' }).primary === 'buster', 'a loadout can not smuggle a hero-only click');
for (const id of ['katana', 'iaido', 'beacon']) {
  const d = WEAPONS[id];
  ok(!!d && !!d.slot && !!d.heroOnly && d.tracks?.length === 3 && d.tracks.every((t) => t.ranks.length === 4) && d.evos?.length === 2 && !!d.feel, `${id}: 3 tracks of 4 ranks, 2 evolutions, feel`);
  ok(!!WEAPON_STEMS[id] && d.evos!.every((e) => !!EVO_LAYERS[`${id}.${e.id}`]), `${id}: a music stem and evolution sound layers`);
  ok(!!ICON_ART[id] && !!ICON_ART[`${id}_evo`] && !!ICON_ART[`${id}_evo2`], `${id}: icons for it and both evolutions`);
}
for (const id of ['duelist', 'furnace', 'twin', 'ronin', 'tinker']) {
  ok(RECORDED_VOICES.has(id), `${id} speaks with recorded barks`);
  const kinds = Object.keys(VOICE_PRIORITY.bark) as (keyof typeof VOICE_PRIORITY.bark)[];
  ok(kinds.every((k) => barkSample(id, k) === `bark_${id}_${k}` && !!VOICE_TEXT[`bark_${id}_${k}`]), `${id}: every bark has its sample and caption`);
}
// No samples load in Node: the synthesized voice is the fallback for every recorded line that is missing.
ok(!speaksRecorded('ronin', 'levelUp') && !speaksRecorded('duelist', 'victory'), 'a missing recorded line falls back to the synthesized voice');
ok(speaksRecorded('ronin', 'hurt'), 'moments without a recorded line stay quiet for recorded heroes (no mixed voices)');
ok(!speaksRecorded('robo', 'hurt'), 'heroes without recordings keep the synthesized voice');
ok(roleOf('ronin') === 'damage' && roleOf('tinker') === 'support', 'co-op roles: Ronin damage, Tinker support');
{
  const a = paintPortrait(heroLook('ronin', SKINS[0]), 'neutral');
  const b = paintPortrait(heroLook('rookie', SKINS[0]), 'neutral');
  const c = paintPortrait(heroLook('tinker', SKINS[0]), 'neutral');
  let da = 0;
  let dc = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) da++;
    if (c[i] !== b[i]) dc++;
  }
  ok(da > 200 && dc > 60, `portraits: the Ronin's kasa and the Tinker's goggles change the bust (${da}, ${dc} bytes)`);
}

// ---------------------------------------------------------------- sword math
ok(inSwordArc(2, 0, 0.4, 0, 130, 2.6), 'an enemy in front is in the arc');
ok(!inSwordArc(-2, 0, 0.4, 0, 130, 2.6), 'one behind is not');
ok(!inSwordArc(3.5, 0, 0.4, 0, 130, 2.6) && inSwordArc(2.9, 0, 0.4, 0, 130, 2.6), 'reach counts the enemy radius');
ok(inSwordArc(-0.5, 0.2, 0.4, 0, 130, 2.6), 'point-blank always counts');
ok(inSwordArc(-2, 0, 0.4, 0, 360, 2.6), 'a full-circle cleave hits behind');
ok(inSwordArc(1.2, 1.9, 0.4, 0, 130, 2.6) === true && inSwordArc(0.6, 2.2, 0.2, 0, 130, 2.6) === false, 'the arc edge is about 65 degrees each side');
ok(nextComboStep(-1, 0) === 0 && nextComboStep(0, 0.2) === 1 && nextComboStep(1, 0.2) === 2 && nextComboStep(2, 0.2) === 0, 'the combo goes 1, 2, cleave, then starts over');
ok(nextComboStep(1, heroes3Tuning.ronin.comboReset + 0.1) === 0, 'a pause resets the combo');
const kp = WEAPONS.katana.levels[0].p;
const s0 = swingShape(kp, 0, 1, false);
const s2 = swingShape(kp, 2, 1, false);
ok(s2.reach > s0.reach && s2.arc > s0.arc && s2.mul > 2, 'the cleave reaches further, wider and harder');
ok(swingShape(kp, 2, 1, true).arc === 360, 'Crimson Edge: the cleave goes all the way round');
ok(!swingWaves(0, 2) && swingWaves(1, 2) && !swingWaves(1, 0) && swingWaves(2, 0), 'sword waves: rank 1 on the cleave, rank 3 / Tempest on every swing');
const ip = WEAPONS.iaido.levels[0].p;
const lo0 = iaidoStrike(ip, 0.15);
const hi = iaidoStrike(ip, 1);
ok(hi.dist > lo0.dist && hi.cut > lo0.cut && hi.pass > lo0.pass && Math.abs(hi.dist - ip.dist) < 1e-6, 'more focus dashes further and cuts harder');
ok(Math.abs(segDist(1, 1, 0, 0, 2, 0) - 1) < 1e-6 && Math.abs(segDist(3, 0, 0, 0, 2, 0) - 1) < 1e-6, 'segment distance');

// ---------------------------------------------------------------- bots
ok(minionCap(1, 1) === 3 && minionCap(11, 1) === 5 && minionCap(60, 1) === 6, 'the bot cap grows with the team level (3 > 5 > 6)');
ok(minionCap(60, 8) === 3 && minionCap(60, 4) === 6, 'eight Tinkers share the team budget (3 each)');
ok(legionCount(1) === 6 && legionCount(8) === 2 && legionCount(4) <= 5, 'Scrap Legion shrinks in big parties');
{
  const m = new MinionPool();
  const a = m.spawn(0, MinionKind.Bot, 1, 2);
  const b = m.spawn(1, MinionKind.Mech, -3, 4, 9);
  m.zapT[b] = 0.1;
  m.zx[b] = 5;
  m.zz[b] = 6;
  ok(m.countOf(0, MinionKind.Bot) === 1 && m.countOf(1, MinionKind.Mech) === 1 && m.count === 2, 'the pool counts per owner and kind');
  const wire = packMinions(m, () => true, []);
  const c = new MinionPool();
  const born: number[] = [];
  unpackMinions(c, wire, born);
  ok(c.count === 2 && born.length === 2 && c.kind[b] === MinionKind.Mech && c.owner[b] === 1 && Math.abs(c.vx[a] - 1) < 0.05 && c.zapT[b] > 0 && Math.abs(c.zx[b] - 5) < 0.05, 'bots round-trip through the snapshot by slot');
  m.free(a);
  unpackMinions(c, packMinions(m, () => true, []), born);
  ok(c.count === 1 && !c.alive[a] && born.length === 0, 'a bot that is gone disappears on the client');
  ok(packMinions(m, (x) => x > 100, []).length === 0, 'bots out of interest are not sent');
}

// ---------------------------------------------------------------- the real game
const { Input } = await import('../src/core/input');
const { Game, cheats } = await import('../src/game/game');
const { Team } = await import('../src/game/bullets');
const { ENEMIES } = await import('../src/data/enemies');
const { settings } = await import('../src/game/settings');
const { h3World, heroes3Net, heroes3Achievements, heroes3StrikeMsg } = await import('../src/game/systems/heroes3');

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
const spawn = (id: string, x: number, z: number) => {
  const e = game.enemies.spawn(ENEMIES[id], x, z, game.spawnOpts({ instant: true }));
  e.hp = e.maxHp = 5000;
  return e;
};
// Freeze the hero's own input: firing/charging come from these flags.
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

// Ronin: the kit replaces the loadout clicks.
fresh('ronin');
let h = game.hero;
let p = h.player;
ok(h.weapons[0].def.id === 'katana' && h.weapons[1].def.id === 'iaido', 'a Ronin run starts with the katana and the dash-strike');
p.setAimDir(1, 0);
const e1 = spawn('bopper', p.x + 1.8, p.z);
const behind = spawn('bopper', p.x - 2.2, p.z);
behind.frozen = 99; // stays put behind the Ronin
const katana = h.weapons[0] as import('../src/game/weapons/katana').Katana;
FIRE = true;
let steps = 0;
let sawCleave = false;
step(70, () => {
  steps++;
  p.setAimDir(1, 0);
  if (katana.step === 2) sawCleave = true;
});
FIRE = false;
ok(e1.hp < e1.maxHp && (h.damageBy.katana ?? 0) > 0, 'the sword combo hits an enemy in front');
ok(behind.hp === behind.maxHp || !behind.active, 'and not one behind (before any cleave turns round)');
ok(sawCleave && katana.seq >= 3, `the combo reaches its third hit, the cleave (${katana.seq} swings in ${steps} steps)`);
// Swings cut enemy bullets.
game.enemies.clear();
step(60);
game.bullets.spawn({ x: p.x + 1.5, z: p.z, dirX: -1, dirZ: 0, speed: 1, life: 4, radius: 0.26, damage: 10, knockback: 6, team: Team.Enemy, color: '#ff3df0', width: 0.5, length: 0.5 });
const enemyBullets = () => {
  let n = 0;
  for (let i = 0; i < game.bullets.count; i++) if (game.bullets.team[i] === Team.Enemy) n++;
  return n;
};
FIRE = true;
step(3, () => p.setAimDir(1, 0));
FIRE = false;
ok(enemyBullets() === 0, 'a swing cuts an enemy bullet out of the air');

// Sword waves at rank: the cleave throws a wave that reaches far.
katana.addRank(2);
const far = spawn('bopper', p.x + 7, p.z);
step(50);
FIRE = true;
step(80, () => p.setAimDir(1, 0));
FIRE = false;
ok(far.hp < far.maxHp, 'Sword Waves: the cleave throws a wave that hits 7 m away');

// Dash-strike: focus, release, dash through a line of enemies; the cut lands a beat later.
game.enemies.clear();
step(10);
const x0 = p.x;
const line = [spawn('bopper', p.x + 2.5, p.z), spawn('bopper', p.x + 4.5, p.z + 0.4)];
const iaido = h.weapons[1] as import('../src/game/weapons/iaido').Iaido;
CHARGE = true;
step(45, () => p.setAimDir(1, 0));
const focus = iaido.focus;
CHARGE = false;
step(2, () => p.setAimDir(1, 0));
step(12, () => p.setAimDir(1, 0));
const passHp = line.map((e) => e.hp);
step(40, () => p.setAimDir(1, 0));
ok(focus >= 0.99, 'holding right click builds focus');
ok(p.x - x0 > 5, `releasing dashes the Ronin forward (${(p.x - x0).toFixed(1)} m)`);
ok(line.every((e) => e.hp < e.maxHp), 'everything the dash passes through is cut');
ok(line.every((e, i) => e.hp < passHp[i] - 50), 'and cut again, harder, a beat later');
ok(iaido.ready < 1, 'the dash-strike recharges');

// Online: a client dashes its own Ronin and reports the path it travelled (`iai`); the host cuts along exactly
// that path (no longer from the client's right-click release seen through its input stream, which a jittery or
// bunched link could hide or delay past the sweep).
game.enemies.clear();
step(120); // recharged
const onPath = [spawn('bopper', p.x + 1.5, p.z + 3), spawn('bopper', p.x + 3.5, p.z + 3.3)];
const offPath = spawn('bopper', p.x + 2.5, p.z - 3);
for (const e of [...onPath, offPath]) e.frozen = 99;
step(2); // in the spatial hash
h.remote = { x: p.x, z: p.z, vx: 0, vz: 0, ax: 1, az: 0, ad: -1, firing: false, charging: false, dashing: false };
const applied = iaido.remoteStrikes;
heroes3StrikeMsg(game, h, { t: 'iai', f: 1, sx: p.x - 1, sz: p.z + 3, ex: p.x + 5, ez: p.z + 3 });
step(1);
const passHp2 = onPath.map((e) => e.hp);
step(30);
ok(iaido.remoteStrikes === applied + 1 && onPath.every((e) => e.hp < e.maxHp) && offPath.hp === offPath.maxHp, 'a reported dash-strike path cuts what lies on it, and nothing else');
ok(onPath.every((e, i) => e.hp < passHp2[i] - 50), 'and the reported strike cuts again a beat later');
step(120);
const refused = iaido.remoteRefused;
heroes3StrikeMsg(game, h, { t: 'iai', f: 0.2, sx: p.x, sz: p.z, ex: p.x + 15, ez: p.z });
step(2);
ok(iaido.remoteRefused === refused + 1 && iaido.remoteStrikes === applied + 1, 'a path longer than the focus allows is refused');
h.remote = null;

// Parry: the Ronin's counter-slash.
game.enemies.clear();
step(120);
const near = spawn('bopper', p.x + 2, p.z + 1);
step(2); // alive and in the spatial hash
p.invuln = 0;
game.bullets.spawn({ x: p.x + 1.1, z: p.z, dirX: -1, dirZ: 0, speed: 20, life: 4, radius: 0.26, damage: 10, knockback: 6, team: Team.Enemy, color: '#ff3df0', width: 0.5, length: 0.5 });
const hp0 = near.hp;
game.tryParry(h);
ok(near.hp < hp0, 'a parry answers with a counter-slash around the Ronin');

// Thousand Cuts runs to the end and cuts a ring of enemies.
game.enemies.clear();
const ring = Array.from({ length: 8 }, (_, i) => {
  const a = (i / 8) * Math.PI * 2;
  return game.enemies.spawn(ENEMIES.bopper, p.x + Math.cos(a) * 2.2, p.z + Math.sin(a) * 2.2, game.spawnOpts({ instant: true }));
});
void ring;
const kills0 = game.kills;
const close0 = h.mech.closeKills;
step(2);
h.skill.ult = 1;
game.tryUlt(h);
ok(h.skill.ultT > 0, 'Thousand Cuts starts');
step(260); // 3 s, plus its opening beat of real slow motion
ok(h.skill.ultT === 0 && game.kills - kills0 >= 8, `Thousand Cuts slashes the ring down (${game.kills - kills0} kills)`);

// Point Blank counts close kills.
const ck = h.mech.closeKills - close0;
ok(ck >= 6, `close kills count toward Point Blank (${ck})`);
h.mech.closeKills = 150;
ok(heroes3Achievements(game).find(([id]) => id === 'point_blank')?.[1] === true, 'Point Blank unlocks at 150');

// Tinker: bots assemble up to the cap and zap.
fresh('tinker');
h = game.hero;
p = h.player;
ok(h.weapons[1].def.id === 'beacon' && h.weapons[0].def.id === 'buster', 'a Tinker run keeps the left click and gets the beacon');
const w = h3World(game);
step(60 * 12);
ok(w.minions.countOf(h.index, MinionKind.Bot) === minionCap(game.level, 1), `bots assemble up to the cap (${w.minions.countOf(h.index, MinionKind.Bot)})`);
const target = spawn('bopper', p.x + 3, p.z + 3);
step(120);
ok(target.hp < target.maxHp && (h.damageBy.minion ?? 0) > 0, 'bots zap nearby enemies');
// Bots soak enemy bullets.
let bot = -1;
for (let i = 0; i < w.minions.top; i++) if (w.minions.alive[i] && w.minions.kind[i] === MinionKind.Bot) bot = i;
game.enemies.clear();
step(1);
const botHp = () => {
  let s = 0;
  for (let i = 0; i < w.minions.top; i++) if (w.minions.alive[i] && w.minions.kind[i] === MinionKind.Bot) s += w.minions.hp[i];
  return s;
};
const hpBots = botHp();
const nBots = w.minions.countOf(h.index, MinionKind.Bot);
game.bullets.spawn({ x: w.minions.x[bot], z: w.minions.z[bot], dirX: -1, dirZ: 0, speed: 0.1, life: 4, radius: 0.26, damage: 10, knockback: 6, team: Team.Enemy, color: '#ff3df0', width: 0.5, length: 0.5 });
const soakAt = game.bullets.count - 1;
w.minions.vx[bot] = w.minions.vz[bot] = 0;
step(1);
step(1);
ok(game.bullets.team[soakAt] !== Team.Enemy || game.bullets.count <= soakAt, 'a bot soaks an enemy bullet (the bullet is gone)');
ok(botHp() < hpBots || w.minions.countOf(h.index, MinionKind.Bot) < nBots, 'and it costs the bot a hit');
// Beacon: press right click to drop it; its field repairs.
const beacon = h.weapons[1] as import('../src/game/weapons/beacon').Beacon;
p.setAimDir(1, 0);
CHARGE = true;
step(2);
CHARGE = false;
ok(beacon.active && beacon.ready < 1, 'right click drops a beacon');
p.teleport(beacon.x, beacon.z);
p.hp = p.maxHp - 30;
const hpHero = p.hp;
step(60);
ok(p.hp > hpHero + 2, `the Repair Field heals (${(p.hp - hpHero).toFixed(1)} in 1 s)`);
const zapTarget = spawn('bopper', beacon.x + 4, beacon.z);
step(90);
ok(zapTarget.hp < zapTarget.maxHp && (h.damageBy.beacon ?? 0) > 0, 'the beacon zaps enemies in range');
// Scrap Legion drops mechs that fight, then leave.
game.enemies.clear();
const foes = Array.from({ length: 6 }, (_, i) => spawn('bopper', p.x + 6 + i * 0.5, p.z - 2 + i));
h.skill.ult = 1;
game.tryUlt(h);
step(90);
ok(w.minions.countOf(h.index, MinionKind.Mech) === legionCount(1), `Scrap Legion drops ${legionCount(1)} mechs`);
step(120);
ok(foes.some((e) => e.hp < e.maxHp), 'the mechs blast enemies');
step(60 * 10);
ok(w.minions.countOf(h.index, MinionKind.Mech) === 0, 'the mechs leave after their time');
// Snapshot: bots near a client are packed.
const snap = heroes3Net(game, h, 50);
ok(!!snap && Array.isArray(snap.m) && snap.m.length === 6 * w.minions.count, 'the h3 snapshot field carries every bot nearby');
h.weapons.find((x) => x.def.id === 'buster')!.level = 1;
ok(heroes3Achievements(game).find(([id]) => id === 'workshop')?.[1] === false, 'Workshop needs 4 auto weapons at level 5');
// A new run clears the bots.
fresh('rookie');
step(2);
ok(w.minions.count === 0, 'a new run clears the bots');
console.log('heroes3 checks done');
process.exit(process.exitCode ?? 0);
