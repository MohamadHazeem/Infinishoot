import assert from 'node:assert/strict';
import { jsdomErrors } from './jsdomEnv';
const { Input } = await import('../src/core/input');
const { Game } = await import('../src/game/game');
const { RULE_CARDS } = await import('../src/data/ruleCards');
const { ruleOffer, shapeHand, hitFactor, ruleKill, prepareRejoins, buyRation } =
  await import('../src/game/ruleCards');
const { payPacts, signPact, pactHeat } = await import('../src/game/pacts');
const { en } = await import('../src/i18n/en');
const { ar } = await import('../src/i18n/ar');
const { MODS } = await import('../src/data/mods');
const { buildMig, restoreRun } = await import('../src/game/systems/hostmig');
const { canBanish } = await import('../src/game/banish');
const g = new Game(
  new Input(document.querySelector('canvas')!),
  16 / 9,
  document.getElementById('hud')!,
  document.getElementById('reticle')!,
);
g.startRun({ seed: 70, difficulty: 'normal' });
if (g.mode === 'shop') g.closeShop();
const h = g.hero,
  mate = g.makeHero(1, 'Guest', [], 'guest');
mate.startRun();
g.setHeroes([h, mate]);
const act = (action: string, i = 0) => g.heroAction(h, action, i, 1);
const bind = (id: string) => {
  h.play.ruleId = '';
  h.applyOffer(ruleOffer(id)!);
  assert.equal(h.play.ruleId, id);
};
assert.equal(new Set(RULE_CARDS.map((c) => c.id)).size, 20);
for (const card of RULE_CARDS) {
  for (const [field, english] of [
    ['name', card.name],
    ['desc', card.text],
  ]) {
    const key = `g5.${card.id}.${field}` as keyof typeof en;
    assert.equal(en[key], english);
    assert.ok(ar[key] && ar[key] !== en[key]);
  }
  const o = ruleOffer(card.id)!;
  assert.equal(o.rarity, 'legendary');
  assert.equal(o.cardType, 'rule');
  bind(card.id);
}
h.startRun();
g.stage = 3;
const hand = h.buildOffers();
h.offers = [
  { ...hand[0], kind: 'evo' },
  { ...hand[1], kind: 'evo' },
  { ...hand[2], kind: 'fusion' },
];
shapeHand(g, h, 'relay');
assert.deepEqual(
  h.offers.map((o) => o.kind),
  ['evo', 'evo', 'fusion'],
);
assert.equal(h.gold, 5);
h.offers = hand;
shapeHand(g, h, 'relay');
assert.equal(h.offers.length, 2);
const binding = h.offers.find((o) => o.cardType === 'rule');
assert.ok(binding);
h.applyOffer(binding);
h.applyOffer(ruleOffer('pawn')!);
assert.equal(h.play.ruleId, 'relay', 'one binding per run');
assert.equal(mate.play.ruleId, '');

const e = g.enemies.spawn((await import('../src/data/enemies')).ENEMIES.swarmer, 3, 3, {
  instant: true,
});
assert.ok(e);
e.x = h.player.x + 10;
e.z = h.player.z;
e.hp = e.maxHp = 100;
e.exposeT = 0;
e.elite = false;
const factor = (id: string) => {
  bind(id);
  return hitFactor(h, e, 'buster');
};
assert.equal(factor('longshot'), 1.4);
assert.equal(factor('infield'), 0.85);
e.x = h.player.x;
assert.equal(factor('longshot'), 0.8);
assert.equal(factor('infield'), 1.45);
assert.equal(factor('quarry'), 0.85);
e.elite = true;
assert.equal(factor('quarry'), 1.3);
assert.equal(factor('opener'), 2);
assert.equal(factor('finish'), 0.9);
e.hp = 20;
assert.equal(factor('opener'), 0.85);
assert.equal(factor('finish'), 1.6);
assert.equal(factor('exposed'), 0.88);
e.exposeT = 1;
assert.equal(factor('exposed'), 1.45);
h.play.ruleSource = 'buster';
assert.equal(factor('relay'), 0.85);
assert.equal(hitFactor(h, e, 'charge'), 1.4);
h.play.ruleTarget = e.uid;
assert.equal(factor('lockon'), 1.3);
h.play.ruleTarget = -1;
assert.equal(hitFactor(h, e, 'buster'), 0.8);
h.player.hp = 20;
bind('tithe');
assert.equal(h.player.heal(20), 0);
for (let i = 0; i < 9; i++) ruleKill.call(g, e, h);
assert.equal(h.player.hp, 20);
ruleKill.call(g, e, h);
assert.equal(h.player.hp, 23);
assert.equal(h.heal(), 'HEALING SEALED');
bind('reserve');
h.gold = 20;
ruleKill.call(g, e, h);
assert.equal(h.gold, 24);
assert.equal(h.interest, 0);
bind('capacitor');
h.bombCharge = 0;
ruleKill.call(g, e, h);
assert.equal(h.bombCharge, 1);
assert.equal(h.stats.specialCooldownMul, 2);
bind('salvage');
h.rerollsLeft = 0;
ruleKill.call(g, e, h);
assert.equal(h.rerollsLeft, 1);
const mod = MODS[0];
assert.equal(h.price(mod), mate.price(mod) + 2);
bind('pawn');
assert.equal(h.sellPrice(7), 7);
assert.equal(h.interest, 0);
h.player.hp = h.player.maxHp;
bind('redline');
const slow = h.stats.cooldownMul;
h.player.hp = 10;
h.refreshLive();
assert.ok(h.stats.cooldownMul < slow);
h.player.vel.x = 0;
bind('anchor');
const fast = h.stats.cooldownMul;
h.player.vel.x = 4;
h.refreshLive();
assert.ok(h.stats.cooldownMul > fast);
h.passives.armor = 2;
h.recomputeStats();
bind('kiln');
assert.equal(h.stats.armor, 0);
h.player.vel.x = 0;
h.refreshLive();
assert.ok(h.stats.armor > 0);
bind('steady');
assert.equal(h.stats.critChance, 0);

h.startRun();
g.mode = 'levelup';
h.pendingLevels = 3;
h.offers = h.buildOffers();
h.gold = 1;
h.rerollsLeft = 1;
const before = h.offers;
act('reroll');
act('banish');
assert.equal(h.gold, 1);
assert.equal(h.offers, before);
assert.equal(h.rerollsLeft, 1);
h.play.draftNumber = 1;
h.gold = 10;
act('reroll');
assert.equal(h.gold, 8);
assert.equal(h.rerollsLeft, 0);
act('reroll');
assert.equal(h.gold, 4);
bind('warrant');
h.gold = 12;
const charges = h.banishLeft;
act('banish', -1);
assert.equal(h.gold, 12);
act('banish', h.offers.findIndex(canBanish));
assert.equal(h.gold, 4);
assert.equal(h.banishLeft, charges);
bind('loaded');
h.rerollsLeft = 1;
act('reroll');
assert.equal(h.gold, 3);
assert.equal(h.rerollsLeft, 1);
act('skip');
assert.equal(h.gold, 3);
bind('fieldkit');
h.player.hp = 20;
act('skip');
assert.equal(h.gold, 3);
assert.equal(h.player.hp, 38);

g.stage = 1;
g.mode = 'shop';
g.route.open = true;
g.route.phase = 'map';
g.route.decided = -1;
assert.equal(signPact(g, h, 0), false);
assert.equal(signPact(g, h, 1), true);
assert.equal(signPact(g, h, 1), false);
assert.equal(pactHeat(h), 2);
assert.equal(pactHeat(mate), 0);
assert.ok(h.stats.dashCooldownMul > mate.stats.dashCooldownMul);
g.stage = 2;
const gold = h.gold;
payPacts.call(g);
payPacts.call(g);
assert.equal(h.gold, gold + 6);
assert.ok(signPact(g, h, 2));
assert.equal(h.price(mod), Math.round(mate.price(mod) * 1.5));
g.stage = 3;
payPacts.call(g);
assert.equal(h.gold, gold + 15);
assert.ok(signPact(g, h, 3));
g.stage = 4;
assert.equal(signPact(g, h, 4), false);
g.role = 'client';
assert.equal(signPact(g, mate, 4), false);
g.role = 'solo';
h.play.ruleId = '';
h.player.hp = 10;
h.gold = 12;
g.mode = 'levelup';
h.pendingLevels = 4;
for (let k = 0; k < 2; k++) {
  h.player.hp = 10;
  h.offers = h.buildOffers();
  shapeHand(g, h);
  const ration = h.offers.findIndex((o) => o.id === 'field_ration');
  assert.ok(ration >= 0);
  const wallet = h.gold;
  act('pick', ration);
  assert.equal(h.gold, wallet - 4);
  assert.equal(h.player.hp, 10 + h.player.maxHp * 0.4);
  assert.equal(h.passives.heart, k + 1);
}
h.player.hp = 10;
h.offers = h.buildOffers();
shapeHand(g, h);
assert.ok(!h.offers.some((o) => o.id === 'field_ration'));
mate.gold = 20;
mate.player.hp = 10;
mate.banished.add('p:heart');
assert.ok(buyRation(mate, 4));
assert.equal(mate.passives.heart, undefined);
mate.banished.clear();
Object.assign(mate.passives, {
  armor: 1,
  magnet: 1,
  nanobots: 1,
  sneakers: 1,
  lucky_star: 1,
  growth: 1,
});
mate.player.hp = 10;
assert.ok(buyRation(mate, 4));
assert.equal(Object.keys(mate.passives).length, 6);
mate.passives.heart = 5;
delete mate.passives.armor;
mate.player.hp = 10;
assert.ok(buyRation(mate, 5));
assert.equal(mate.passives.heart, 5);
g.mode = 'shop';
bind('fieldkit');
const snapshot = g.buildSnapshot(h, []);
assert.deepEqual(snapshot.contract, ['fieldkit', 2, 1, 3]);
const clientRoot = document.createElement('div');
document.body.append(clientRoot);
const client = new Game(
  new Input(document.querySelector('canvas')!),
  16 / 9,
  clientRoot,
  document.createElement('div'),
);
client.role = 'client';
client.clientStart(
  g.seed,
  0,
  g.heroes.map((hero) => ({ name: hero.name })),
);
client.applySnapshot(structuredClone(snapshot));
assert.equal(client.hero.play.ruleId, 'fieldkit');
assert.equal(pactHeat(client.hero), 5);
assert.equal(pactHeat(client.heroes[1]), 0);
client.hud.setLoadout(client.hero.loadout());
assert.equal(clientRoot.querySelector('.pact-heat')?.textContent, 'HEAT 5');
const checkpoint = buildMig(g);
h.startRun();
assert.equal(pactHeat(h), 0);
restoreRun(g, checkpoint);
assert.equal(h.play.ruleId, 'fieldkit');
assert.equal(pactHeat(h), 5);

const roster = {
  pending: [{ pid: 'stable', peerId: 'guest', entry: { name: 'Guest' } }],
  stash: [{ pid: 'stable', name: 'Guest' }],
  pids: ['', 'stable'],
};
mate.play.ruleId = 'quarry';
mate.play.pactBoots = 1;
mate.left = true;
const restore = prepareRejoins(g, roster as any);
mate.startRun();
mate.left = false;
(mate as any).peerId = 'guest';
restore?.();
assert.equal(mate.play.ruleId, 'quarry');
assert.equal(mate.play.pactBoots, 1);

// The guest signs with the route screen button over the same UI message as a real peer.
g.role = 'host';
g.mode = 'shop';
g.stage = 4;
g.route.options = [0];
g.route.open = true;
g.route.phase = 'map';
g.route.decided = -1;
g.route.votes = [-1, -1];
client.local = 1;
client.client = {
  send: (m: Record<string, unknown>) => g.onHostMessage('guest', m),
} as typeof client.client;
client.routeFromNet({
  open: true,
  phase: 'map',
  stage: 4,
  seed: g.seed,
  path: [],
  options: [0],
  votes: [-1, -1],
});
const pactButton = () => clientRoot.querySelector<HTMLButtonElement>('.pact-row button')!;
assert.equal(pactButton().disabled, false);
pactButton().click();
assert.equal(mate.play.pactShop, 1);
assert.deepEqual(g.route.votes, [-1, -1]);
assert.equal(client.hero.play.pactShop, 0, 'client waits for authority');
client.applySnapshot(structuredClone(g.buildSnapshot(mate, [])));
assert.equal(client.hero.play.pactShop, 1);
assert.equal(pactButton().disabled, true);
assert.ok(pactButton().textContent?.includes('3 HEAT'));
g.localCoop = {} as NonNullable<typeof g.localCoop>;
g.hud.setLoadout(g.hero.loadout());
const couchBadge = document.querySelector('.pact-heat')!.textContent;
assert.ok(couchBadge?.includes('P1 HEAT 5') && couchBadge.includes('P2 HEAT 3'));
assert.deepEqual(jsdomErrors, []);
console.log(
  'ok   20 legendary rules, personal kill rewards, priced drafts, reserved evolutions, stacked Heat, snapshots, migration and reclaim',
);
