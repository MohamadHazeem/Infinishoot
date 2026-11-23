import './jsdomEnv';
import assert from 'node:assert/strict';
import { Game } from '../src/game/game';
import { Input } from '../src/core/input';
import { HEROES } from '../src/data/heroes';
import { PASSIVES } from '../src/data/passives';
import { MOD_BY_ID } from '../src/data/mods';
import { WEAPONS } from '../src/data/weapons';
import { applyBuild, exportBuild } from '../src/game/pvp';
import { createWeapon } from '../src/game/weapons';
import { pathPoints, offerPathHints, pathPanel, pausePaths } from '../src/game/archetypes';
import { setLanguage, t } from '../src/i18n';
import type { Offer } from '../src/ui/screens';
import type { Enemy } from '../src/game/enemies';
import type { NetShop } from '../src/game/game';

const g = new Game(new Input(document.querySelector('canvas')!), 16 / 9, document.getElementById('hud')!, document.getElementById('reticle')!);
const h = g.hero;
const paths = HEROES.flatMap(d => d.paths);
assert.equal(new Set(paths.map(p => p.id)).size, paths.length);
assert.equal(new Set(paths.map(p => p.trigger + '/' + p.effect)).size, paths.length);
for (const hero of HEROES) {
  assert.ok(hero.paths.length >= 2 && hero.paths.length <= 3);
  for (const p of hero.paths) {
    assert.ok(PASSIVES[p.items[0]] && PASSIVES[p.items[1]] && MOD_BY_ID[p.items[2]]);
    assert.ok(Object.values(WEAPONS).some(w => w.tags.includes(p.tag) && !w.heroOnly && !w.fusion));
  }
}

g.startRun({ seed: 42, difficulty: 'normal' });
g.closeShop();
const mate = g.makeHero(1, 'Mate', h.unlocked, 'guest');
mate.startRun();
g.setHeroes([h, mate]);
const p = h.heroDef.paths[0];
const offer = (kind: Offer['kind'], id: string, pick?: string): Offer => ({ kind, id, pick, name: '', icon: '', color: '#fff', tag: '', text: '' });
const rank = () => offer('track', 'buster', 'buster|t|0');
assert.equal(pathPoints(h, p), 1, 'only the best matching weapon counts');
assert.deepEqual(offerPathHints(h, [rank()])[0].paths, [{ id: 'gunslinger', points: 2 }]);
h.applyOffer(rank());
h.applyOffer(rank());
assert.equal(offerPathHints(h, [rank()])[0].paths, undefined, 'no chip for ranks above the weapon threshold');
h.applyOffer(offer('passive', 'rapid_coil'));
assert.equal(pathPoints(h, p), 4);
assert.equal(pathPoints(mate, p), 1);

mate.shopOffers = [MOD_BY_ID.quick_draw];
let sent: any;
g.host = { send(_id: string, msg: unknown) { sent = JSON.parse(JSON.stringify(msg)); } } as typeof g.host;
g.presentShop(mate);
assert.deepEqual(g.shopFromNet(sent.view as NetShop).pathHints?.quick_draw, [{ id: 'gunslinger', points: 2 }]);
mate.offers = [rank()]; // an injected or restored hand can arrive without hints
g.presentLevelUp(mate);
assert.deepEqual(sent.offers[0].paths, [{ id: 'gunslinger', points: 2 }]);
h.shopOffers = [MOD_BY_ID.quick_draw];
h.gold = 60;
assert.equal(h.buy(0), '');
assert.equal(pathPoints(h, p), 5);
assert.equal(h.shopView(1).pathHints?.quick_draw, undefined);
const restored = g.makeHero(2, 'Returning seat', h.unlocked);
applyBuild(restored, exportBuild(h, g.level), g.scene);
assert.equal(pathPoints(restored, p), 5, 'the same serialized build reconstructs eligibility on a replacement host');
delete restored.passives.rapid_coil;
restored.recomputeStats();
assert.deepEqual(restored.shopView(1).pathHints?.quick_draw, [{ id: 'gunslinger', points: 5 }]);
restored.gold = 60;
assert.equal(restored.upgradeMod(0), '');
assert.equal(pathPoints(restored, p), 5);
restored.dispose();

const target = { x: 1, z: 2, targetable: true, roarT: 0, shield: 0, exposeT: 0 } as Enemy;
h.ctx.nearest = () => target;
h.ctx.inRadius = () => [target];
h.ctx.fx = { star() {}, ring() {}, scar() {} };
h.ctx.firing = true;
h.player.vel.x = 3;
h.paths.step(h, 7);
assert.equal(target.exposeT, 0, 'a freshly rebuilt capstone charges first');
h.paths.step(h, 1);
assert.equal(target.exposeT, 1.4);
target.exposeT = 0;
h.paths.step(h, 7);
assert.equal(target.exposeT, 0);
h.sell(0);
h.paths.step(h, 10);
assert.equal(target.exposeT, 0, 'selling the required support deactivates the effect');
assert.equal(pathPoints(h, p), 4);
assert.match(pathPanel(h, [{ def: MOD_BY_ID.quick_draw, level: 1 }]), /★ Gunslinger/, 'pause respects the supplied client Mod snapshot');
assert.doesNotMatch(pathPanel(mate, []), /★/);
const sharedPause = pausePaths([h, mate], []);
assert.match(sharedPause, /PLAYER 1/);
assert.match(sharedPause, /PLAYER 2/);

// An evolution can introduce a new qualifying tag. Fusions inherit the strength of their ingredients.
h.setHeroDef('tinker');
const evo = offer('evo', 'buster_evo2', 'buster|e|1');
evo.tags = ['shock'];
assert.equal(offerPathHints(h, [evo])[0].paths?.find(p => p.id === 'scrapper')?.points, 3);
h.applyOffer(evo);
assert.equal(pathPoints(h, h.heroDef.paths[0]), 3);
h.weapons.push(createWeapon('glass_gale', g.scene));
assert.equal(pathPoints(h, h.heroDef.paths[1]), 4);
assert.equal(offerPathHints(h, [offer('gold', 'gold')])[0].paths, undefined);
h.startRun();
assert.equal(pathPoints(h, h.heroDef.paths[1]), 0);

// Drive each combat trigger against a focused fixture. A shielded neighbour must retain its status.
const foe = (x: number) => ({ x, z: 0, kx: 0, kz: 0, shield: 0, exposeT: 0, frozen: 0,
  roarT: 0, targetable: true, def: { behavior: 'chase' } }) as Enemy;
for (const hero of HEROES) for (const path of hero.paths) {
  h.setHeroDef(hero.id);
  h.startRun();
  const gun = Object.values(WEAPONS).find(w => w.tags.includes(path.tag) && !w.slot && !w.fusion)!;
  const owned = createWeapon(gun.id, g.scene);
  owned.level = 3;
  h.weapons.push(owned);
  h.passives[path.items[0]] = 2;
  h.recomputeStats();
  const a = foe(1), b = foe(2), shielded = foe(3);
  shielded.shield = 20;
  h.ctx.nearest = () => a;
  h.ctx.inRadius = () => [a, b, shielded];
  let blasts = 0, arcs = 0;
  h.ctx.blast = () => { blasts++; };
  h.ctx.zap = () => { arcs++; };
  const bullets = h.ctx.bullets;
  bullets.count = 2;
  bullets.x[0] = bullets.z[0] = bullets.x[1] = bullets.z[1] = 0;
  h.ctx.hostileBullet = i => i === 1;
  h.player.teleport(0, 0);
  h.ctx.firing = h.ctx.charging = false;
  if (path.trigger === 'release') { h.ctx.charging = true; h.paths.step(h, 0); h.ctx.charging = false; }
  if (path.trigger === 'strafe') h.player.vel.x = 3;
  if (['brace', 'strafe', 'melee'].includes(path.trigger)) h.ctx.firing = true;
  if (path.trigger === 'dash') h.player.netSet(0, 0, 1, 0, 1, 0, true);
  if (path.trigger === 'parry') h.mech.parries++;
  if (path.trigger === 'ultimate') h.skill.ultT = 1;
  h.paths.step(h, 8);
  switch (path.effect) {
    case 'mark': assert.ok(b.exposeT > 0 && !shielded.exposeT, path.id); break;
    case 'frost': assert.ok(b.frozen > 0 && !shielded.frozen, path.id); break;
    case 'pull': assert.ok(b.kx < 0 && !shielded.kx, path.id); break;
    case 'push': assert.ok(b.kx > 0 && !shielded.kx, path.id); break;
    case 'blast': assert.equal(blasts, 1, path.id); break;
    case 'arc': assert.equal(arcs, 1, path.id); break;
    case 'ward': assert.equal(bullets.count, 1, path.id); break;
  }
  bullets.count = 0;
}

await setLanguage('ar');
for (const p of paths) for (const key of ['paths.' + p.id, 'paths.desc.' + p.id]) assert.match(t(key), /[\u0600-\u06ff]/);
g.screens.showLevelUp(mate.offers, '', 0, mate.loadout());
assert.match(document.querySelector('#scr-levelup .set-chip')!.textContent!, /رامي المسدس/);
await setLanguage('en');
console.log('ok   hero paths: catalog, real picks, sales, capstone cooldown, fusion, co-op menu messages, client progress and Arabic');
