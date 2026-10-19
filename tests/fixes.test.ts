/**
 * Fixes lane: pure logic (line of sight, parry rewind, online hit-stop) plus
 * checks in the real game (jsdom, no WebGL): mini-boss rules, shooters and
 * walls, remote parries with lag.
 */
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { ok } from './check';
import { StaticBoxGrid } from '../src/core/spatialHash';

// ---- Line of sight over the static wall grid ----
{
  const wall = { minX: 4, maxX: 6, minZ: -3, maxZ: 3 };
  const far = { minX: 40, maxX: 42, minZ: 40, maxZ: 42 };
  const g = new StaticBoxGrid([wall, far]);
  ok(!g.segmentClear(0, 0, 10, 0), 'LOS: a wall between blocks the line');
  ok(g.segmentClear(0, 5, 10, 5), 'LOS: a line passing beside the wall is clear');
  ok(!g.segmentClear(0, 3.2, 10, 3.2, 0.3), 'LOS: the pad fattens the line (grazing the wall corner)');
  ok(g.segmentClear(0, 3.2, 10, 3.2, 0), 'LOS: without pad the grazing line is clear');
  ok(!g.segmentClear(10, 0, 0, 0), 'LOS: blocked both ways');
  ok(!g.segmentClear(5, -10, 5, 10), 'LOS: vertical line through the wall');
  ok(g.segmentClear(0, 0, 3.9, 0), 'LOS: stopping short of the wall is clear');
  ok(!g.segmentClear(-20, -20, 50, 50), 'LOS: a long diagonal through the far box is blocked');
  ok(g.segmentClear(-20, -20, 30, -5), 'LOS: a long diagonal that misses everything is clear');
  ok(!g.segmentClear(-7.3, 0.1, 13.9, -0.4), 'LOS: negative coordinates and cell crossings');
}

// ---- jsdom game harness ----
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

const NF = await import('../src/game/netFeel');

// ---- Parry rewind: pure judgement ----
{
  const T = NF.netFeelTuning;
  ok(NF.parryLag(0) === 0 && NF.parryLag(NaN) === 0, 'parry lag: unknown ping means no rewind');
  ok(Math.abs(NF.parryLag(100) - (0.05 + T.interp)) < 1e-9, 'parry lag: half the round trip plus interpolation');
  ok(NF.parryLag(2000) === T.maxRewind, 'parry lag: capped');
  const lo = NF.remoteParry(0.06, 1.15, 0.16);
  const hi = NF.remoteParry(0.25, 1.15, 0.16);
  ok(lo.reach > 1.15 && lo.reach < hi.reach && hi.reach <= 1.15 + T.reachMaxExtra + 1e-9, 'remote reach grows with ping, capped');
  ok(lo.window > 0.16 && hi.window <= 0.16 + T.windowMaxExtra + 1e-9, 'remote window grows with ping, capped');
  // Bullet now 3 m past the hero, flying away at 20 m/s: 0.15 s ago it was on the hero.
  ok(NF.bulletWasInReach(0, 0, 3, 0, 20, 0, 0.26, 1.2, 0.15), 'rewind: a bullet that crossed the hero within the lag counts');
  ok(!NF.bulletWasInReach(0, 0, 3, 0, 20, 0, 0.26, 1.2, 0), 'rewind: without lag it is out of reach');
  ok(!NF.bulletWasInReach(0, 0, 3, 0, 20, 0, 0.26, 1.2, 0.05), 'rewind: a short lag does not reach back far enough');
  ok(!NF.bulletWasInReach(0, 0, 3, 5, 20, 0, 0.26, 1.2, 0.25), 'rewind: a bullet whose path stayed wide never counts');
  ok(NF.bulletWasInReach(0, 0, 0.5, 0.5, 0, 0, 0.26, 1.2, 0.2), 'rewind: a slow bullet in reach now counts');
  const hits = [
    { at: 9.5, dmg: 10, vx: 1, vz: 0 },
    { at: 9.9, dmg: 0, vx: 1, vz: 0 },
    { at: 9.92, dmg: 7, vx: 1, vz: 0 },
  ];
  const got = NF.takeRewoundHits(hits, 10, 0.12);
  ok(got.length === 1 && got[0].dmg === 7 && hits.length === 2, 'rewind: only real hits inside the lag are undone (and only once)');
  ok(NF.onlineStopTime(0.5) === T.stopMax && NF.onlineStopTime(0.05) > 0, 'online hit-stop: same length as solo, capped');
  const fake = { online: true } as never;
  NF.onlineStop(fake, 0.06);
  ok(NF.tickOnlineStop(fake, 0.016) && NF.tickOnlineStop(fake, 0.016) && NF.tickOnlineStop(fake, 0.016), 'online hit-stop holds the picture for its length');
  NF.tickOnlineStop(fake, 0.016);
  ok(!NF.tickOnlineStop(fake, 0.016), 'online hit-stop ends');
  ok(!NF.tickOnlineStop({ online: false } as never, 0.016), 'no online hit-stop in solo');
}

// ---- Lifesteal budget (Vampire Fang) ----
{
  const LS = await import('../src/game/lifesteal');
  const T = LS.lifestealTuning;
  const b = new LS.LifestealBudget();
  // Fang 3 at 100 max life: 0.15 a kill, full rate up to killsPerSec kills a second.
  const rate = 0.15 * T.killsPerSec;
  let got = 0;
  for (let i = 0; i < 100; i++) got += b.take(0.15, rate, i * 0.01); // 100 kills in one second
  // Full rate: one second in reserve plus the 0.99 s refill; the rest at the overflow rate.
  const full = rate * 1.99;
  ok(Math.abs(got - (full + (15 - full) * T.overflow)) < 0.05, `a burst of 100 kills heals ${got.toFixed(2)} instead of 15`);
  const b2 = new LS.LifestealBudget();
  let slow = 0;
  for (let i = 0; i < 10; i++) slow += b2.take(0.15, rate, i * 0.5); // two kills a second
  ok(Math.abs(slow - 1.5) < 1e-9, 'a trickle of kills heals in full');
  const b3 = new LS.LifestealBudget();
  b3.take(5, 5, 50);
  ok(b3.take(1, 5, 1) === 1, 'a new run (clock went back) starts with a full budget');
  // Glass Cannon: x0.4 max life means x0.4 healing.
  const hero = (max: number) => ({ player: { maxHp: max } }) as never;
  ok(Math.abs(LS.vampHeal(hero(40), 0.15, 0) - 0.06) < 1e-9 && Math.abs(LS.vampHeal(hero(100), 0.15, 0) - 0.15) < 1e-9, 'the heal scales with max life');
}

// ---- TURN relay config ----
{
  const ICE = await import('../src/net/ice');
  const { noRouteError } = await import('../src/net/peer');
  ok(JSON.stringify(ICE.parseRelay('')) === '[]', 'relay: empty text is no relay');
  const r = ICE.parseRelay('turn:relay.example.com:3478 alice s3cret');
  ok(!!r && r[0].urls === 'turn:relay.example.com:3478' && r[0].username === 'alice' && r[0].credential === 's3cret', 'relay: url user password');
  const r2 = ICE.parseRelay('turn:a.example:3478,turns:a.example:5349 u p');
  ok(!!r2 && Array.isArray(r2[0].urls) && r2[0].urls.length === 2, 'relay: several URLs');
  ok(ICE.parseRelay('turn:relay.example.com:3478') === null, 'relay: TURN without a login is rejected');
  ok(ICE.parseRelay('http://x.com u p') === null, 'relay: an http URL is rejected');
  ok(!!ICE.parseRelay('stun:stun.example.com:3478'), 'relay: a STUN server needs no login');
  ok(ICE.parseRelay('turn:a:1 u p extra') === null, 'relay: extra words are rejected');
  const j = ICE.parseRelay('{"urls":"turns:x.example:5349","username":"u","credential":"c"}');
  ok(!!j && j[0].urls === 'turns:x.example:5349', 'relay: JSON form');
  const cf = ICE.serversFromJson({ iceServers: { urls: ['stun:stun.cloudflare.com:3478', 'turn:turn.cloudflare.com:3478?transport=udp'], username: 'x', credential: 'y' } });
  ok(cf.length === 1 && (cf[0].urls as string[]).length === 2 && cf[0].username === 'x', 'credentials API: Cloudflare shape { iceServers: {...} }');
  const mt = ICE.serversFromJson([{ urls: 'stun:stun.relay.metered.ca:80' }, { urls: 'turn:global.relay.metered.ca:80', username: 'a', credential: 'b' }, { urls: 'ftp://nope' }]);
  ok(mt.length === 2, 'credentials API: metered list shape, junk dropped');
  ok(ICE.serversFromJson(null).length === 0 && ICE.serversFromJson('x').length === 0, 'credentials API: junk response gives nothing');
  const bt = ICE.buildTimeServers({ VITE_TURN_URLS: 'turn:t.example:3478, turns:t.example:5349 ,junk', VITE_TURN_USERNAME: 'u', VITE_TURN_CREDENTIAL: 'c' });
  ok(bt.length === 1 && (bt[0].urls as string[]).length === 2 && bt[0].credential === 'c', 'build-time TURN variables');
  ok(ICE.buildTimeServers({}).length === 0, 'no build-time TURN without VITE_TURN_URLS');
  ok(!ICE.hasRelay() && !ICE.setCustomRelay('turn:nope'), 'no relay by default; a bad custom relay is refused');
  ok(ICE.setCustomRelay('turn:relay.example.com:3478 alice s3cret') && ICE.hasRelay(), 'a custom relay is saved');
  const cfg = ICE.iceConfig();
  ok(cfg.iceServers[0].urls === ICE.DEFAULT_ICE[0].urls && cfg.iceServers.some((s) => s.username === 'alice'), 'ICE config keeps the PeerJS defaults first and adds the relay');
  ok(noRouteError(false).includes('CUSTOM RELAY') && !noRouteError(true).includes('CUSTOM RELAY'), 'no-route error points at the relay setting when there is none');
  ICE.setCustomRelay('');
  ok(!ICE.hasRelay(), 'clearing the custom relay');
}

// ---- The real game ----
const { Input } = await import('../src/core/input');
const { Game, cheats } = await import('../src/game/game');
const { Team } = await import('../src/game/bullets');
const { ENEMIES } = await import('../src/data/enemies');
const { settings } = await import('../src/game/settings');
const { bossLike, freezeMul } = await import('../src/game/bossRules');

const input = new Input(document.getElementById('game') as HTMLCanvasElement);
const game = new Game(input, 16 / 9, document.getElementById('hud')!, document.getElementById('reticle')!);
cheats.unlockAll = true;
const step = (n: number) => {
  for (let i = 0; i < n; i++) {
    game.update(1 / 60);
    if (game.mode === 'levelup') (game as unknown as { ui(a: string, i: number): void }).ui('pick', 0);
  }
};
const fresh = () => {
  settings.hero = 'rookie';
  game.applyLocalSkin();
  game.startSolo();
  if (game.mode === 'shop') game.closeShop();
  game.enemies.clear();
  game.bullets.clear();
  game.director.time = 0;
  step(1);
};
const enemyBullet = (x: number, z: number, dx: number, dz: number, speed = 20) =>
  game.bullets.spawn({ x, z, dirX: dx, dirZ: dz, speed, life: 4, radius: 0.26, damage: 10, knockback: 6, team: Team.Enemy, color: '#ff3df0', width: 0.5, length: 0.5 });

// ---- Mini-bosses get boss rules (not the boss bar) ----
{
  fresh();
  const p = game.hero.player;
  const mini = game.enemies.spawn(ENEMIES.prince, p.x + 6, p.z, game.spawnOpts({ instant: true }));
  ok(bossLike(mini) && !mini.def.boss && freezeMul(mini) < 0.5, 'mini-boss is boss-like but not a boss');
  // The Nuke takes a fixed bite instead of killing it.
  const hp = mini.hp;
  game.nuke(game.hero);
  step(90);
  ok(mini.active && mini.hp > 0 && mini.hp < hp, `the Nuke bites a mini-boss instead of killing it (${Math.round((100 * (hp - mini.hp)) / mini.maxHp)}% of its life)`);
  // Far away: never recycled closer.
  mini.x = mini.px = p.x + 90;
  mini.z = mini.pz = p.z;
  const sw = game.enemies.spawn(ENEMIES.swarmer, p.x + 90, p.z + 2, game.spawnOpts({ instant: true }));
  step(70);
  ok(Math.abs(mini.x - p.x) > 60, 'far-away mini-boss is not recycled closer');
  ok(Math.abs(sw.x - p.x) < 60 || !sw.active, 'a far-away swarmer is recycled closer');
  ok(game.boss === null || game.boss !== mini, 'a mini-boss never becomes the stage boss');
}

// ---- Shooters don't fire into walls ----
{
  fresh();
  const p = game.hero.player;
  // Build a wall right between the hero and a shooter.
  const wall = { minX: p.x + 3, maxX: p.x + 3.6, minZ: p.z - 4, maxZ: p.z + 4 };
  const saved = game.arena.colliders.slice();
  game.arena.colliders.push(wall);
  game.walls = new StaticBoxGrid(game.arena.colliders);
  const s = game.enemies.spawn(ENEMIES.shooter, p.x + 8, p.z, game.spawnOpts({ instant: true }));
  let fired = 0;
  for (let k = 0; k < 240; k++) {
    s.x = s.px = p.x + 8; // pin it behind the wall
    s.z = s.pz = p.z;
    const before = game.bullets.count;
    step(1);
    for (let i = before; i < game.bullets.count; i++) if (game.bullets.team[i] === Team.Enemy) fired++;
    if (s.state === 'windup' || s.state === 'attack') fired += 0.001;
  }
  ok(fired === 0, `a shooter with a wall in the way holds fire (${fired})`);
  game.arena.colliders.length = 0;
  game.arena.colliders.push(...saved);
  game.walls = new StaticBoxGrid(game.arena.colliders);
  let fired2 = 0;
  for (let k = 0; k < 300; k++) {
    s.x = s.px = p.x + 8;
    s.z = s.pz = p.z;
    const before = game.bullets.count;
    step(1);
    for (let i = before; i < game.bullets.count; i++) if (game.bullets.team[i] === Team.Enemy) fired2++;
  }
  ok(fired2 > 0, `with the wall gone it fires (${fired2} bullets)`);
}

// ---- Remote parry with lag: rewind and refund ----
{
  fresh();
  const h = game.hero;
  const p = h.player;
  p.invuln = 0;
  h.remote = { x: p.x, z: p.z, vx: 0, vz: 0, ax: 1, az: 0, ad: -1, firing: false, charging: false, dashing: false };
  // Without a measured ping, a bullet that already flew past is out of reach.
  enemyBullet(p.x + 3.2, p.z, 1, 0);
  h.skill.parryCd = 0;
  game.tryParry(h);
  ok(game.bullets.team[game.bullets.count - 1] === Team.Enemy, 'unknown ping: no rewind');
  game.bullets.clear();
  // With 250 ms round trip the host looks back 0.175 s: the bullet was on the hero.
  NF.noteParryLag(game, h, 250);
  ok(NF.heroParryLag(game, h) > 0.15, 'host keeps the parry lag per hero');
  enemyBullet(p.x + 3.2, p.z, 1, 0);
  h.skill.parryCd = 0;
  game.tryParry(h);
  const i = game.bullets.count - 1;
  ok(game.bullets.team[i] === Team.Player && game.bullets.kind[i] === 13, 'lagged parry: rewound bullet is reflected');
  // A bullet that already hit within the lag is undone and reflected.
  game.bullets.clear();
  step(60);
  p.invuln = 0;
  const hp0 = p.hp;
  p.hp -= 10;
  NF.noteBulletHit(game, h, 10, -20, 0);
  h.skill.parryCd = 0;
  h.skill.parried = 0;
  game.tryParry(h);
  ok(p.hp === hp0, 'lagged parry refunds a hit that landed within the lag');
  ok(h.skill.parried >= 1 && game.bullets.count > 0 && game.bullets.team[game.bullets.count - 1] === Team.Player, 'the refunded hit comes back as a reflected shot');
  // ...but a hit older than the lag stays.
  step(60);
  p.hp -= 10;
  const hp1 = p.hp;
  NF.noteBulletHit(game, h, 10, -20, 0);
  step(30); // 0.5 s later
  h.skill.parryCd = 0;
  game.tryParry(h);
  ok(p.hp === hp1, 'an old hit is not refunded');
  h.remote = null;
}

// ---- Rex smashes static cover for real ----
{
  const CB = await import('../src/game/coverBreak');
  fresh();
  game.loadStage(2);
  if (game.mode === 'shop') game.closeShop();
  const st = CB.coverStats(game);
  ok(st.total > 5 && st.broken === 0, `the arena has breakable cover (${st.total})`);
  const map = game.arena.group.userData.coverRanges as Map<unknown, { mesh: any; start: number; count: number }[]>;
  const box = game.arena.colliders.find((b) => map.has(b))!;
  const cx = (box.minX + box.maxX) / 2;
  const cz = (box.minZ + box.maxZ) / 2;
  ok(game.walls.hitCircle(cx, cz, 0.1), 'cover blocks before it breaks');
  const n = CB.smashCover(game, cx, cz, 1);
  ok(n >= 1 && !game.arena.colliders.includes(box) && !game.walls.hitCircle(cx, cz, 0.05), 'a charge smashes the cover: collider gone, wall grid rebuilt');
  const r = map.get(box)![0];
  const pos = r.mesh.geometry.getAttribute('position');
  let hidden = true;
  for (let i = r.start; i < r.start + r.count; i++) if (pos.getY(i) > -10) hidden = false;
  ok(hidden && r.count > 0, 'its triangles in the merged mesh collapse out of sight');
  ok(CB.smashCover(game, cx, cz, 1) === 0, 'broken cover stays broken');
  // A client applies the host's message for another prop.
  const before = CB.coverStats(game).broken;
  CB.onCoverMsg(game, { t: 'cover', i: before + 3, s: game.arenaStage });
  ok(CB.coverStats(game).broken === before + 1, 'the client hides the cover the host broke');
  CB.onCoverMsg(game, { t: 'cover', i: before + 4, s: game.arenaStage + 1 });
  ok(CB.coverStats(game).broken === before + 1, 'a cover message for another arena is ignored');
  // Rex charging through the field breaks what it runs into.
  fresh();
  game.loadStage(2);
  if (game.mode === 'shop') game.closeShop();
  const rex = game.enemies.spawn(ENEMIES.rex, 0, 0, game.spawnOpts({ instant: true }));
  const target = game.arena.colliders.find((b) => (game.arena.group.userData.coverRanges as Map<unknown, unknown>).has(b))!;
  rex.x = (target.minX + target.maxX) / 2;
  rex.z = (target.minZ + target.maxZ) / 2;
  game.bossApi.rampage(rex, false);
  ok(!game.arena.colliders.includes(target), 'Rex mid-charge smashes the cover it is in');
}
