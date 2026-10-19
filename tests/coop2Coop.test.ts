/**
 * Coop2 lane online, in one process (host + clients, messages passed by hand
 * like tests/timeCoop.test.ts): a friend joins a run in progress (waits for a
 * safe moment, gets a hero built to the team's level, spawns next to a mate
 * with spawn protection, everyone's roster grows, the joiner mirrors the
 * world), drops (autopilot grace) and reclaims the hero, quits on purpose and
 * comes back to a rebuilt hero, a grace period that runs out, the shared
 * revive pool (buy-back with split gold, a team wipe saved), role bonuses,
 * the team ultimate (inside and outside the window) on both screens, the emote
 * rate limit and the help ghost mirrored on a client.
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
process.on('unhandledRejection', (e) => {
  console.error('FAIL unhandled rejection', e);
  process.exit(1);
});

const { Input } = await import('../src/core/input');
const { Game, cheats } = await import('../src/game/game');
const { unlockedWeapons } = await import('../src/game/save');
const { settings } = await import('../src/game/settings');
const { ENEMIES } = await import('../src/data/enemies');
const C2 = await import('../src/game/systems/coop2');
const { joinTuning, poolTuning, poolCost, splitCost, emoteTuning, addToInbox, ghostInbox, saveInbox } = await import('../src/game/coop2');
const { totalRanks } = await import('../src/data/tracks');

settings.deathReplay = false;
settings.coopJoinable = true;
settings.coopPool = false;
settings.helpGhosts = true;
const canvas = document.getElementById('game') as HTMLCanvasElement;
const mk = () => new Game(new Input(canvas), 16 / 9, document.getElementById('hud')!, document.getElementById('reticle')!);

// ---- Router: the host talks to clients by peer id; clients talk to the host.
type G = InstanceType<typeof Game>;
const A = mk();
const peers = new Map<string, G>();
const q: [G, any, string][] = [];
(A as any).role = 'host';
(A as any).host = {
  code: 'K7P2Q',
  send: (id: string, m: any) => {
    const g = peers.get(id);
    if (g) q.push([g, m, '']);
  },
  broadcast: (m: any) => {
    for (const g of new Set(peers.values())) q.push([g, m, '']);
  },
  close() {},
};
const connect = (g: G, id: string) => {
  peers.set(id, g);
  (g as any).role = 'client';
  (g as any).client = { send: (m: any) => q.push([A, m, id]), close() {} };
};
const drop = (id: string) => {
  peers.delete(id);
  A.onClientLeft(id);
};
const flush = () => {
  for (let guard = 0; q.length && guard < 5000; guard++) {
    const [g, m, from] = q.shift()!;
    if (g === A) A.onHostMessage(from, structuredClone(m));
    else if ([...peers.values()].includes(g)) g.onClientMessage(structuredClone(m));
  }
};
const clients = () => [...new Set(peers.values())];
const step = (n: number, extra: G[] = []) => {
  for (let i = 0; i < n; i++) {
    A.update(1 / 60);
    flush();
    for (const c of new Set([...clients(), ...extra])) {
      c.update(1 / 60);
      flush();
    }
    if (i % 6 === 0) {
      A.render(1, 1 / 60);
      for (const c of clients()) c.render(1, 1 / 60);
    }
    if (A.mode === 'levelup') {
      (A as any).ui('pick', 0);
      for (const c of clients()) (c as any).ui('pick', 0);
      flush();
    }
    if (A.mode === 'shop') {
      (A as any).ui('done');
      for (const c of clients()) (c as any).ui('done');
      flush();
    }
  }
};

const B = mk();
connect(B, 'peerB');
A.setHeroes([A.makeHero(0, 'Host', unlockedWeapons(), '', 'classic', 'none', 'bulwark'), A.makeHero(1, 'Guest', [], 'peerB', 'classic', 'none', 'ace')]);
A.lobby = [{ peerId: '', name: 'Host', unlocked: [], skin: 'classic', pet: 'none', hero: 'bulwark', loadout: A.hero.loadoutPick }, { peerId: 'peerB', name: 'Guest', unlocked: [], skin: 'classic', pet: 'none', hero: 'ace', loadout: A.hero.loadoutPick }];
A.startRun();
flush();
if (A.mode === 'shop') A.closeShop();
flush();
cheats.god = true;
A.xpNext = 1e9;
step(30);
ok(A.mode === 'fight' && B.mode === 'fight' && B.heroes.length === 2, 'host and first guest are in the run');

// ---- Roles: Bulwark (tank) + Ace (damage) = a team bonus on the host
const sA = C2.coop2Debug(A);
const bonus = C2.teamBonus(A);
ok(bonus.distinct === 2 && bonus.armor === 1 && Math.abs(bonus.damageMul - 0.08) < 1e-9, `2 roles: +1 armor, +8% damage (${JSON.stringify({ d: bonus.distinct, a: bonus.armor, m: bonus.damageMul })})`);
const armorWith = A.hero.stats.armor;
ok(armorWith >= 2, `the host's Bulwark has its own armor + the tank gift (${armorWith})`);

// ---- A friend joins mid-run
A.level = 13;
A.heroes[0].gold = 40;
A.heroes[1].gold = 60;
const C = mk();
connect(C, 'peerC');
C.netName = 'Late';
q.push([A, { t: 'hello', pid: 'pidlate0001', name: 'Late', unlocked: unlockedWeapons(), loadout: A.hero.loadoutPick, skin: 'classic', pet: 'none', hero: 'dash', look: '---00' }, 'peerC']);
// Not a safe moment yet: the host is on a level-up menu.
A.mode = 'levelup';
flush();
ok(sA.pending.length === 1, 'the joiner waits while the host is on a menu');
A.mode = 'fight';
step(2);
ok(A.heroes.length === 3 && A.heroes[2].peerId === 'peerC' && A.heroes[2].name === 'Late', 'admitted at the next safe moment as hero 3');
const late = A.heroes[2];
const spRanks = late.specialBuild ? totalRanks(late.specialBuild) + (late.specialBuild.evo >= 0 ? 1 : 0) + late.specialBuild.od : late.special.level - 1;
const ranks = spRanks + late.weapons.reduce((n, w) => n + (w.build ? totalRanks(w.build) + (w.build.evo >= 0 ? 1 : 0) + w.build.od : w.level - 1), 0) + Object.values(late.passives).reduce((a, b) => a + b, 0) - 1; // Dash starts with Blaze Boots at level 1
// Some catch-up picks become filler or card kinds this count doesn't see (fusions, new Mods): 6+ means it was built up.
ok(ranks >= 6, `the joiner's hero is built to the team's level (${ranks} picks for team level 13)`);
ok(late.gold === Math.round(50 * joinTuning.goldShare), `and gets a share of the team's gold (${late.gold})`);
ok(late.player.invuln > joinTuning.spawnProtect - 0.2, `with spawn protection (${late.player.invuln.toFixed(2)} s)`);
const near = Math.min(...A.heroes.slice(0, 2).map((h) => Math.hypot(h.player.x - late.player.x, h.player.z - late.player.z)));
ok(near < 5, `next to a teammate (${near.toFixed(1)} m)`);
ok(A.director.players === 3, 'enemy scaling counts 3 players');
ok(C.mode === 'fight' && C.heroes.length === 3 && C.local === 2, 'the joiner is in the run as hero 3');
ok(Math.hypot(C.player.x - late.player.x, C.player.z - late.player.z) < 0.5, "the joiner's own hero starts where the host put it");
ok(B.heroes.length === 3 && B.heroes[2].name === 'Late', 'the other guest gets the new roster');
for (let i = 0; i < 6; i++) A.enemies.spawn(ENEMIES.swarmer, late.player.x + 4 + i, late.player.z, { ...A.spawnOpts(), instant: true });
step(20);
ok(C.netEnemies.size > 0, `the joiner mirrors the enemies (${C.netEnemies.size})`);
ok(Math.abs(C.heroes[2].player.hp - late.player.hp) < 1.01, 'and its own life');
ok(C.stage === A.stage && C.level === A.level, 'and the team state');

// ---- The joiner drops: autopilot for the grace period
const lx = late.player.x;
drop('peerC');
ok(!late.left && sA.grace.some((g) => g.index === 2) && late.peerId === '', 'a dropped player\'s hero stays on autopilot');
for (let i = 0; i < 4; i++) A.enemies.spawn(ENEMIES.bopper, late.player.x + 6, late.player.z + i, { ...A.spawnOpts(), instant: true });
step(90);
ok(!!late.remote && (Math.abs(late.player.x - lx) > 0.3 || late.remote.firing), 'the autopilot moves and fights');
ok(A.heroes.length === 3 && A.director.players === 3, 'scaling unchanged while on autopilot');

// ---- ...and comes back with a new peer id: reclaims the same hero
C.leaveToTitle();
flush();
connect(C, 'peerC2');
q.push([A, { t: 'hello', pid: 'pidlate0001', name: 'Late', unlocked: unlockedWeapons(), loadout: A.hero.loadoutPick, skin: 'classic', pet: 'none', hero: 'dash', look: '---00' }, 'peerC2']);
step(3);
ok(A.heroes[2] === late && late.peerId === 'peerC2' && !sA.grace.length, 'rejoining reclaims the hero on autopilot');
ok(C.mode === 'fight' && C.local === 2 && C.heroes.length === 3, 'the returning player plays hero 3 again');

// ---- Quits on purpose (bye): the hero leaves at once, the build is kept
const keepIds = late.weapons.map((w) => w.def.id).join();
C.leaveToTitle(); // sends bye first
flush();
drop('peerC2');
ok(late.left && sA.stash.length === 1, 'a player who quits leaves at once (build kept)');
ok(A.director.players === 2, 'enemy scaling drops back to 2 players');
step(10);
ok(B.heroes[2].left, 'clients see the hero gone');
connect(C, 'peerC3');
q.push([A, { t: 'hello', pid: 'pidlate0001', name: 'Late', unlocked: unlockedWeapons(), loadout: A.hero.loadoutPick, skin: 'classic', pet: 'none', hero: 'dash', look: '---00' }, 'peerC3']);
step(3);
ok(!late.left && late.peerId === 'peerC3' && late.weapons.map((w) => w.def.id).join() === keepIds, 'coming back later rebuilds the kept build');
ok(A.director.players === 3 && !sA.stash.length, 'and scaling counts them again');

// ---- An old client (no player id) is matched by name; a 5th player is refused
const D = mk();
connect(D, 'peerD');
q.push([A, { t: 'hello', name: 'Fourth', unlocked: [], hero: 'twin' }, 'peerD']);
step(2);
ok(A.heroes.length === 4 && D.local === 3, 'a fourth player joins');
const E = mk();
connect(E, 'peerE');
let refused = '';
const origE = E.onClientMessage.bind(E);
E.onClientMessage = (m: any) => {
  if (m.t === 'full') refused = String(m.reason);
  origE(m);
};
settings.spectators = false; // with spectator seats on, the fifth would watch instead (tests/spectateCoop.test.ts)
q.push([A, { t: 'hello', name: 'Fifth', unlocked: [] }, 'peerE']);
step(1);
settings.spectators = true;
ok(refused.includes('full') && A.heroes.length === 4, `a fifth is refused (${refused})`);
peers.delete('peerE');

// ---- A grace period that runs out
joinTuning.grace = 1.5;
drop('peerD');
step(60 * 2);
ok(A.heroes[3].left && sA.stash.some((x) => x.name === 'Fourth'), "the hero leaves when the grace runs out (build kept)");
joinTuning.grace = 45;
peers.delete('peerD');

// ---- Shared revive pool
sA.pool.on = true;
sA.pool.lives = poolTuning.start;
const guest = A.heroes[1];
cheats.god = false;
for (const h of A.heroes) h.gold = 30;
guest.revivesLeft = 0;
guest.petState.reviveUsed = true;
guest.player.invuln = 0;
guest.player.teleport(A.hero.player.x + 20, A.hero.player.z + 20);
late.player.teleport(A.hero.player.x - 20, A.hero.player.z - 20);
if (guest.player.hurt(guest.player.hp + 1, 1, 0)) A.onHeroDown(guest);
cheats.god = true;
step(5);
ok(guest.player.dead, 'the guest is down');
B.input.pressed.add('KeyT');
step(1);
ok(guest.player.dead, 'buying back is refused before the wait');
step(Math.ceil(poolTuning.wait * 60) + 5);
ok(!!C2.coop2Debug(B).net.buy?.[1], 'the downed client sees BUY BACK ready');
const golds = A.heroes.filter((h) => !h.left).map((h) => h.gold);
const cost = poolCost(A.stage);
B.input.pressed.add('KeyT');
step(2);
ok(!guest.player.dead && sA.pool.lives === poolTuning.start - 1, `the client bought back in (${sA.pool.lives} lives left)`);
const paid = golds.reduce((a, b) => a + b, 0) - A.heroes.filter((h) => !h.left).reduce((a, h) => a + h.gold, 0);
ok(paid === cost, `the team paid ${paid} (cost ${cost}), split ${JSON.stringify(splitCost(golds, cost))}`);
// Team wipe: the last hero down is saved by the pool.
cheats.god = false;
for (const h of A.heroes) {
  if (h.left) continue;
  h.revivesLeft = 0;
  h.petState.reviveUsed = true;
  h.phoenixUsed = true;
  h.player.invuln = 0;
  if (h.player.hurt(h.player.hp + 1, 1, 0)) A.onHeroDown(h);
}
cheats.god = true;
ok(A.mode !== 'dead' && A.aliveHeroes.length === 1, 'a team wipe is saved by a pool life');
for (const h of A.heroes) if (!h.left && h.player.dead) A.reviveHero(h, 1, false);
sA.pool.on = false;
step(10);

// ---- Team ultimate: everyone fires within the window
for (const h of A.heroes) if (!h.left) h.skill.ult = 1;
const n0 = sA.ult.count;
A.tryUlt(A.hero);
step(30);
B.client!.send({ t: 'ult' });
q.push([A, { t: 'ult' }, 'peerC3']);
step(3);
ok(sA.ult.count === n0 + 1, 'three ultimates within 2 s combine into a TEAM ULTIMATE');
ok(C2.coop2Debug(B).beatT > 0 && C2.coop2Debug(C).beatT > 0, 'both clients play the team-ultimate beat');
step(120);
for (const h of A.heroes) if (!h.left) h.skill.ult = 1;
A.tryUlt(A.hero);
step(60 * 3);
B.client!.send({ t: 'ult' });
q.push([A, { t: 'ult' }, 'peerC3']);
step(3);
ok(sA.ult.count === n0 + 1, 'ultimates 3 s apart stay separate');

// ---- Emotes: rate-limited on the host
const before = sA.seq;
for (let i = 0; i < 6; i++) B.client!.send({ t: 'emote', k: 'wave' });
step(1);
const ems = () => sA.events.filter((e) => e.ev[1] === 'em' && e.ev[2] === 1).length;
ok(ems() === 1 && sA.seq === before + 1, 'six emotes at once: one gets through');
const times: number[] = [A.stepN / 60];
for (let k = 0; k < 14; k++) {
  const sq = sA.seq;
  B.client!.send({ t: 'emote', k: 'cheer' });
  step(Math.ceil(emoteTuning.minGap * 60) + 2);
  if (sA.seq > sq) times.push(A.stepN / 60);
}
const worst = Math.max(...times.map((t) => times.filter((u) => u >= t && u < t + emoteTuning.burstWindow).length));
ok(worst <= emoteTuning.burst && times.length >= emoteTuning.burst + 2, `spaced emotes: never more than ${emoteTuning.burst} in ${emoteTuning.burstWindow} s (${times.length} sent in ~15 s, worst window ${worst})`);
ok(C2.coop2Debug(B).bubbles.has(1) || C2.coop2Debug(A).bubbles.has(1), 'the emote shows as a bubble');
q.push([A, { t: 'emote', k: 'nope' }, 'peerB']);
const s2 = sA.seq;
step(130);
q.push([A, { t: 'emote', k: 'nope' }, 'peerB']);
step(1);
ok(sA.seq === s2, 'unknown emotes are ignored');

// ---- A help ghost shows on clients too
saveInbox([]);
addToInbox({ v: 1, name: 'Ghosty', hero: 'ace', color: '#73eff7', look: '---00', level: 9, stage: 1, boss: 'King Bopper', kit: ['buster'], date: '2026-10-19' });
sA.ghostsUsed = 0;
C2.debugGhost(A);
step(10);
ok(!!sA.ghost && !ghostInbox().length, 'a ghost from the inbox comes to help');
ok(!!C2.coop2Debug(B).net.ghostP && C2.coop2Debug(B).net.ghost?.name === 'Ghosty', 'clients draw the ghost');

console.log('coop2 online checks done');
