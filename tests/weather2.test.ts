/** Weather gameplay on a real Game, including host-authoritative snapshots and movement. */
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
(globalThis as any).Path2D = class { constructor(_d?: string) {} };
(globalThis as any).__APP_VERSION__ = 'smoke';
(dom.window as any).Path2D = (globalThis as any).Path2D;
(dom.window.HTMLElement.prototype as any).scrollIntoView = () => {};
(globalThis as any).matchMedia = (dom.window as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
process.on('unhandledRejection', (e) => {
  console.error('FAIL unhandled rejection', e);
  process.exit(1);
});
const errors: string[] = [];
process.on('uncaughtException', (e) => errors.push('uncaught ' + e.stack));

const { Input } = await import('../src/core/input');
const { Game, cheats } = await import('../src/game/game');
const { settings } = await import('../src/game/settings');
const { ENEMIES } = await import('../src/data/enemies');
const W = await import('../src/game/systems/weather2');
const D = await import('../src/data/weather2');
const T = D.weather2Tuning;
const { Team } = await import('../src/game/bullets');
const { setLanguage, t } = await import('../src/i18n');

settings.autoFire = false;
const canvas = document.getElementById('game') as HTMLCanvasElement;
const mk = () => new Game(new Input(canvas), 16 / 9, document.getElementById('hud')!, document.getElementById('reticle')!);
type G = InstanceType<typeof Game>;
const solo = (seed: number): G => {
  const g = mk();
  g.startRun({ seed, difficulty: 'normal' });
  if (g.mode === 'shop') g.closeShop();
  return g;
};
ok(D.weatherForBiome('dunes:night') === 'sandstorm' && D.weatherForBiome('peaks') === 'blizzard' && D.weatherForBiome('magma') === 'heatwave', 'biome weather and remixes');
ok(D.weatherForBiome('neon') === 'lightning' && D.weatherForBiome('factory') === null, 'lightning biome eligibility');
ok(!D.weatherEligible('sandstorm', 'peaks', true) && !D.weatherEligible('blizzard', 'peaks', false) && D.weatherEligible('fog', 'peaks', false), 'wrong biome/off do not roll weather; classics still allowed');
let meter = 0;
for (let i = 0; i < 600; i++) meter = D.exposure(meter, true, 1 / 60, 5, 2);
ok(meter === 1 && D.exposure(meter, false, 2, 5, 2) === 0, 'exposure clamps and drains in specified seconds');
ok(Math.abs(D.weatherGust(T.gustPeriod / 4) - T.gust) < 1e-6 && D.weatherGust(T.gustPeriod * 0.75) < 0, 'gust alternates with bounded acceleration');
ok(D.segmentDistance2(0, 0, -5, 0, 5, 0) === 0 && D.segmentDistance2(0, 2, -5, 0, 5, 0) === 4, 'swept rod collision handles high bullet speeds');
ok(!D.hotTile(0, 0) && D.hotTile(10, 10) && !D.hotTile(10, 13), 'dark checker tiles and cool start plaza');

const g = solo(4242);
const step = (n: number, dt = 0.25) => { for (let i = 0; i < n; i++) W.updateWeather2.call(g, dt); };
const hash = () => { g.hash.clear(); for (const e of g.enemies.list) if (e.alive) g.hash.insert(e, e.x, e.z, e.radius); };
const bullet = (x: number, z: number, dx = 1, dz = 0, team = Team.Player) => g.bullets.spawn({ x, z, dirX: dx, dirZ: dz, speed: 60, life: 3, radius: 0.1, damage: 1, knockback: 0, team, color: '#ffcd75', width: 0.15, length: 0.4 });
settings.weatherEffects = true; settings.weather = false;
W.startWeather2(g, 'sandstorm');
ok(W.weather2Of(g).kind === 'sandstorm', 'cosmetic WEATHER off leaves combat weather on');
bullet(0, 0, 0, 1); const vx = g.bullets.vx[0]; step(4);
ok(g.bullets.vx[0] !== vx, 'host gust bends bullets');
g.render(1, 1 / 60);
const { retroGlobals } = await import('../src/render/retroMaterial');
ok(retroGlobals.uWeatherSight.value.w === T.silhouette, 'sandstorm installs radial sight');
settings.weatherEffects = false; step(1); g.render(1, 1 / 60);
ok(W.weather2Of(g).kind === null && g.runEvents.event === null && retroGlobals.uWeatherSight.value.w === 0, 'toggle cancels event and restores visibility');
settings.weatherEffects = true;
W.startWeather2(g, 'blizzard');
const bs = W.weather2Of(g), hero = g.hero.player;
// Keep the hero away from the initial brazier aura.
hero.teleport(-15, -15); hero.vel.x = hero.vel.z = 0;
step(20);
ok(bs.heroes[0].chill > 0.99, 'stationary hero chills fully in five seconds');
hero.prev.x = -15; hero.pos.x = -14; W.weather2Local(g);
ok(Math.abs(hero.pos.x - (-15 + 1 - T.heroSlow)) < 1e-5, 'chill slows local movement without multiplying persistent stats');
hero.dashT = 0.1; hero.pos.x = -14; W.weather2Local(g);
ok(hero.pos.x === -14, 'chill never shortens a dash'); hero.dashT = 0;
const brazier = bs.props[0]; hero.teleport(brazier.x, brazier.z); step(1);
ok(bs.heroes[0].warm > 0 && brazier.cooldown > 0, 'touching brazier grants portable warmth');
hero.teleport(-15, -15); step(8);
ok(bs.heroes[0].chill === 0 && bs.heroes[0].sheltered, 'carried warmth thaws a stationary hero');
bs.heroes[0].warm = 0;
const { createWeapon } = await import('../src/game/weapons');
const fireWeapon = createWeapon('fire', g.scene); g.hero.weapons.push(fireWeapon);
step(24); ok(bs.heroes[0].chill === 0 && bs.heroes[0].sheltered, 'active fire weapon supplies warmth');
g.hero.weapons.pop(); fireWeapon.dispose();
const slow = g.enemies.spawn(ENEMIES.chonk, -12, -12, { instant: true });
const nearby = g.enemies.spawn(ENEMIES.chonk, -11, -12, { instant: true });
slow.state = nearby.state = 'chase';
slow.hp = slow.maxHp = 10000; nearby.hp = nearby.maxHp = 10000;
hash(); step(29);
ok(slow.frozen > 0 && slow.slowAmt >= 0.6, 'slow enemies progressively slow then freeze');
const hp = nearby.hp;
g.damage(slow, 2, { source: 'buster', noStatus: true }, g.hero);
ok(slow.alive && slow.frozen === 0 && nearby.hp < hp, 'first hit shatters weather ice while the target survives');
const boss = g.enemies.spawn(ENEMIES.king, 0, 10, { instant: true });
if (boss) { boss.state = 'chase'; step(30); ok(!bs.cold.has(boss), 'bosses never receive weather freeze'); }

W.startWeather2(g, 'lightning');
const ls = W.weather2Of(g); const rod = ls.props[0];
g.bullets.clear();
const target = g.enemies.spawn(ENEMIES.chonk, rod.x + 2, rod.z, { instant: true });
target.state = 'chase';
target.hp = target.maxHp = 10000;
hash();
bullet(rod.x - 4, rod.z); ls.nextStrike = 0;
step(1, 0.1);
ok(ls.props[0].charges === T.rodCharges - 1 && ls.strikes.length === 1, 'shooting rod charges three redirects and consumes one for next warning');
const strike = ls.strikes[0];
ok(Math.abs(strike.x - target.x) < 0.01 && Math.abs(strike.z - target.z) < 0.01, 'rod targets nearest enemy at warning time');
hero.teleport(strike.x, strike.z); hero.invuln = 0; hero.hp = hero.maxHp; cheats.god = false;
const beforeHp = hero.hp, beforeEnemy = target.hp;
step(1, T.strikeWarning - 0.01);
ok(hero.hp === beforeHp && target.hp === beforeEnemy, 'warning gives the complete reaction window without damage');
step(1, 0.02);
ok(hero.hp < beforeHp && target.hp < beforeEnemy, 'strike hits heroes and enemies, including redirected strikes');
ok(ls.strikes[0].hit, 'strike resolves only once');
const afterHp = target.hp; step(1, 0.01); ok(target.hp === afterHp, 'resolved lightning never double hits');

// Full lane state, including a pending warning, survives a host/client snapshot round trip.
const client = solo(4242); client.role = 'client';
ls.nextStrike = 0; step(1, 0.01);
const snap = W.weather2Net(g); W.applyWeather2Net(client, JSON.parse(JSON.stringify(snap)));
ok(JSON.stringify(W.weather2Net(client)) === JSON.stringify(snap), 'client mirrors rods, charges, clock and persistent warning positions');
client.applySnapshot(g.buildSnapshot(g.hero, []));
ok(W.weather2Of(client).kind === 'lightning' && W.weather2Of(client).props.length === ls.props.length, 'lane field traverses the real compact snapshot and Game.applySnapshot hooks');
const cstate = W.weather2Of(client); const cclock = cstate.elapsed;
W.updateWeather2.call(client, 4);
ok(cstate.elapsed === cclock, 'client cannot simulate strikes, event time or damage');
settings.weatherEffects = false; W.applyWeather2Net(client, snap);
ok(cstate.kind === 'lightning', 'client local setting cannot override host gameplay');
settings.weatherEffects = true;

W.startWeather2(g, 'heatwave');
const hs = W.weather2Of(g);
let hx = 22, hz = 22;
while (!D.hotTile(hx, hz) || W.cooling(g, hs, hx, hz) || g.walls.hitCircle(hx, hz, 0.5)) { hx -= 3; if (hx < -30) { hx = 22; hz -= 3; } }
hero.teleport(hx, hz); hero.invuln = 0; hero.hp = hero.maxHp;
step(39); ok(hero.hp === hero.maxHp && hs.heroes[0].heat < 1, 'heat has ten seconds of exposure before damage');
step(1); ok(hero.hp < hero.maxHp && hs.heroes[0].heat === 1, 'full overheating damages hero');
hero.teleport(hs.props[0].x, hs.props[0].z); step(12);
ok(hs.heroes[0].heat === 0 && hs.heroes[0].sheltered, 'marked water pool cools fully within three seconds');
const fire = g.enemies.spawn(ENEMIES.chonk, 30, 30, { instant: true });
const catchFire = g.enemies.spawn(ENEMIES.chonk, 31, 30, { instant: true });
fire.state = catchFire.state = 'chase';
fire.hp = fire.maxHp = catchFire.hp = catchFire.maxHp = 10000;
g.ignite(fire, 10, g.hero); hash(); step(3);
ok(catchFire.burnT > 0 && catchFire.burnOwner === g.hero.index, 'heat wave spreads fire and preserves damage credit');
W.applyWeather2Net(client, W.weather2Net(g));
ok(W.weather2Of(client).heroes[0].sheltered, 'cooling state reaches client HUD');
g.runEvents.event = null; step(1); W.applyWeather2Net(client, W.weather2Net(g));
ok(!W.weather2Of(g).kind && !W.weather2Of(client).kind, 'event end clears both peers');
W.startWeather2(g, 'lightning'); g.loadStage(2);
ok(!W.weather2Of(g).kind && W.weather2Of(g).strikes.length === 0, 'stage transition clears pending strikes and pickups');
for (const kind of ['sandstorm', 'blizzard', 'lightning', 'heatwave'] as const) {
  setLanguage('ar'); ok(t(`weather2.${kind}.hint`) !== t(`weather2.${kind}.name`) && !t(`weather2.${kind}.hint`).startsWith('weather2.'), `${kind} Arabic HUD catalog present`);
}
setLanguage('en'); settings.weather = true;
ok(!errors.length, 'no runtime errors: ' + errors.join('\n'));
process.exit(process.exitCode || 0);
