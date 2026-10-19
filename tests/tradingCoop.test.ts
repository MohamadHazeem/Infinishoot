/**
 * Trading lane online, in one process (host + 2 clients, messages passed by
 * hand like tests/coop2Coop.test.ts): gold, gear and relic gifts from the
 * host and from clients, mirrored on every screen; the host's rate limit;
 * refusals; a shop pool that three players fund (the Mod lands in the
 * owner's slots), a pool refunded when the shop closes or the offer goes;
 * co-op titles from `hello` reaching the lobby and the snapshot; co-op
 * achievements; LEGEND scaling for 3 players and the lobby's co-op-only rule.
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
const { unlockedWeapons, save } = await import('../src/game/save');
const { settings } = await import('../src/game/settings');
const { MAX_GEARS } = await import('../src/game/hero');
const { RELICS } = await import('../src/data/relics');
const { MODS } = await import('../src/data/mods');
const { legendTuning } = await import('../src/game/trading');
const TR = await import('../src/game/systems/trading');

settings.deathReplay = false;
settings.coopJoinable = false;
settings.helpGhosts = false;
const canvas = document.getElementById('game') as HTMLCanvasElement;
const mk = () => new Game(new Input(canvas), 16 / 9, document.getElementById('hud')!, document.getElementById('reticle')!);
type G = InstanceType<typeof Game>;

const A = mk();
const peers = new Map<string, G>();
const q: [G, any, string][] = [];
const sent: any[] = [];
(A as any).role = 'host';
(A as any).host = {
  code: 'TRADE',
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
  (g as any).client = { send: (m: any) => (sent.push(m), q.push([A, m, id])), close() {} };
};
const flush = () => {
  for (let guard = 0; q.length && guard < 5000; guard++) {
    const [g, m, from] = q.shift()!;
    if (g === A) A.onHostMessage(from, structuredClone(m));
    else if ([...peers.values()].includes(g)) g.onClientMessage(structuredClone(m));
  }
};
const clients = () => [...new Set(peers.values())];
let autoMenus = true;
const step = (n: number) => {
  for (let i = 0; i < n; i++) {
    A.update(1 / 60);
    flush();
    for (const c of clients()) {
      c.update(1 / 60);
      flush();
    }
    if (autoMenus && A.mode === 'levelup') {
      (A as any).ui('pick', 0);
      for (const c of clients()) (c as any).ui('pick', 0);
      flush();
    }
    if (autoMenus && A.mode === 'shop') {
      (A as any).ui('done');
      for (const c of clients()) (c as any).ui('done');
      flush();
    }
  }
};

// ---- Lobby: titles from hello, LEGEND needs 2+ players in co-op
const B = mk();
const C = mk();
connect(B, 'peerB');
connect(C, 'peerC');
save.achievements = save.achievements.filter((id) => !id.startsWith('co_'));
if (!save.achievements.includes('hard_stage3')) save.achievements.push('hard_stage3');
settings.difficulty = 'legend';
A.lobby = [{ peerId: '', name: 'Host', unlocked: [], skin: 'classic', pet: 'none', hero: 'rookie', loadout: A.hero.loadoutPick }];
ok(A.lobbyDifficulty().id === 'nightmare', 'LEGEND falls back to Nightmare with 1 player in the lobby');
A.mode = 'title';
q.push([A, { t: 'hello', pid: 'pidB', name: 'Bea', title: 'co_patron', unlocked: unlockedWeapons(), loadout: A.hero.loadoutPick, skin: 'classic', pet: 'none', hero: 'ace' }, 'peerB']);
q.push([A, { t: 'hello', pid: 'pidC', name: 'Cid', title: '<img src=x>', unlocked: unlockedWeapons(), loadout: A.hero.loadoutPick, skin: 'classic', pet: 'none', hero: 'dash' }, 'peerC']);
flush();
ok(A.lobby.length === 3, 'two guests joined the lobby');
ok(A.lobbyTitle('peerB') === 'co_patron' && A.lobbyTitle('peerC') === '', 'titles come from hello, unknown ones are dropped');
ok(A.lobbyDifficulty().id === 'legend', 'LEGEND with 3 players in co-op');
A.lobbyKind = 'pvp';
ok(A.lobbyDifficulty().id !== 'legend', 'no LEGEND in PvP');
A.lobbyKind = 'coop';
const lobbyHtml = document.querySelector('#scr-online .players')?.innerHTML ?? '';
ok(lobbyHtml.includes('tr-title') && lobbyHtml.includes('PATRON'), 'the lobby card shows the guest title');
const legendBtn = document.querySelector<HTMLElement>('#scr-online [data-diff=legend]');
ok(!!legendBtn && !legendBtn.classList.contains('locked') && legendBtn.classList.contains('on'), 'the lobby difficulty row shows LEGEND, picked');

// ---- Run on LEGEND with 3 heroes
A.setHeroes([A.makeHero(0, 'Host', unlockedWeapons(), '', 'classic', 'none', 'rookie'), A.makeHero(1, 'Bea', [], 'peerB', 'classic', 'none', 'ace'), A.makeHero(2, 'Cid', [], 'peerC', 'classic', 'none', 'dash')]);
A.startRun();
flush();
autoMenus = false;
step(2);
ok(A.difficulty.id === 'legend' && A.difficulty.enemyHp === legendTuning.hp[3] && A.difficulty.enemyDmg === legendTuning.dmg[3], `LEGEND scaled for 3 players (hp x${A.difficulty.enemyHp}, dmg x${A.difficulty.enemyDmg})`);
ok(B.difficulty.id === 'legend', 'clients know it is LEGEND');
ok(A.mode === 'shop', 'the starting shop is open');

// ---- A pool in the starting shop: Cid's offer, funded by all three
const hA = A.heroes[0], hB = A.heroes[1], hC = A.heroes[2];
for (const h of A.heroes) h.gold = 40;
// A pricey, non-cursed Mod in Cid's first slot, so the pool takes several chips.
const slot = 0;
hC.shopOffers[slot] = MODS.filter((m) => !m.cursed && !m.coop && m.price >= 12 && m.price <= 30).sort((a, b) => b.price - a.price)[0];
const mod = hC.shopOffers[slot]!;
const price = hC.price(mod);
C.tradeAct({ a: 'pool', i: slot });
flush();
step(1);
const st = TR.tradingDebug(A);
ok(st.pools.list.length === 1 && st.pools.list[0].owner === 2 && st.pools.list[0].mod === mod.id, `Cid opened a pool for ${mod.name} (${price} gold)`);
step(16);
ok(TR.tradingDebug(B).net?.p.length === 1 && TR.tradingDebug(B).net?.p[0].mod === mod.id, 'Bea sees the pool in her snapshot');
B.tradeAct({ a: 'chip', p: st.pools.list[0].id, n: 5 });
flush();
ok(hB.gold === 35 && st.pools.list[0].paid[1] === 5, 'Bea chipped 5 (held in the pool)');
B.tradeAct({ a: 'chip', p: st.pools.list[0].id, n: 5 });
flush();
ok(hB.gold === 35, 'a second chip within 0.25 s is rate-limited');
step(20);
const left = price - 5;
const fromHost = Math.min(left - 1, 25);
A.tradeAct({ a: 'chip', p: st.pools.list[0].id, n: fromHost });
const before = hC.synergy.slots.length;
C.tradeAct({ a: 'chip', p: st.pools.list[0].id, n: 99 });
flush();
ok(st.pools.list.length === 0 && hC.synergy.owns(mod.id) && hC.synergy.slots.length === before + 1, `the full pool bought ${mod.name} for Cid`);
ok(hA.gold === 40 - fromHost && hC.gold === 40 - (left - fromHost), `everyone paid their chip (host ${40 - hA.gold}, Cid ${40 - hC.gold}, Bea 5)`);
ok(hC.shopOffers[slot] === null, 'the offer is sold');
step(40);
ok(save.achievements.includes('co_pool'), 'Crowdfunded earned');

// ---- A pool refunded when the offer goes (the owner rerolls)
const s2 = 1;
hA.shopOffers[s2] = MODS.filter((m) => !m.cursed && !m.coop && m.price >= 12)[0];
A.tradeAct({ a: 'pool', i: s2 });
step(20);
B.tradeAct({ a: 'chip', p: st.pools.list[0]?.id ?? -1, n: 5 });
flush();
const bGold = hB.gold;
hA.shopOffers[s2] = null; // as if bought or rerolled away
step(1);
ok(st.pools.list.length === 0 && hB.gold === bGold + 5, 'the pool closed and Bea got her 5 back');

// ---- Gifts in the fight
(A as any).ui('done');
for (const c of clients()) (c as any).ui('done');
flush();
step(2);
ok(A.mode === 'fight', 'the stage started');
cheats.god = true;
A.xpNext = 1e9;
for (const h of A.heroes) h.gold = 50;
A.tradeAct({ a: 'give', k: 'gold', to: 1, n: 25 });
ok(hA.gold === 25 && hB.gold === 75, 'host gave Bea 25 gold');
step(10);
ok(B.hero.gold === 75, "Bea's screen shows it");
ok(TR.tradingDebug(B).lastSeq >= TR.tradingDebug(A).seq - 0 && TR.tradingDebug(B).lastSeq > 0, 'the trade event reached Bea');
ok(TR.tradingDebug(C).net?.w[1]?.[0] === 75, "Cid sees Bea's wallet");
// Rate limit: a burst of 10 from a client
step(20);
for (let i = 0; i < 10; i++) B.tradeAct({ a: 'give', k: 'gold', to: 2, n: 1 });
flush();
ok(hC.gold === 51, `a burst of 10 gives in one step lands once (${hC.gold - 50})`);
let landed = 0;
for (let i = 0; i < 40; i++) {
  B.tradeAct({ a: 'give', k: 'gold', to: 2, n: 1 });
  step(12); // 0.2 s apart: some hit the gap
}
landed = hC.gold - 51;
ok(landed > 0 && landed <= 6 * 2 + 1, `spaced gives stay under the burst cap (${landed} in 8 s)`);
// Gears (after the burst window has rolled on)
step(320);
hB.rerollsLeft = 2;
hC.rerollsLeft = MAX_GEARS;
step(20);
B.tradeAct({ a: 'give', k: 'gear', to: 2 });
flush();
ok(hB.rerollsLeft === 2 && hC.rerollsLeft === MAX_GEARS, "a full gear bag can't take more");
hC.rerollsLeft = 1;
step(20);
B.tradeAct({ a: 'give', k: 'gear', to: 2 });
flush();
ok(hB.rerollsLeft === 1 && hC.rerollsLeft === 2, 'Bea gave Cid a gear');
// Relics
const r = RELICS.find((x) => !hB.relics.includes(x.id) && !hC.relics.includes(x.id))!;
hB.relics.push(r.id);
hB.recomputeStats();
step(20);
B.tradeAct({ a: 'give', k: 'relic', to: 2, id: r.id });
flush();
ok(!hB.relics.includes(r.id) && hC.relics.includes(r.id), `Bea gave Cid ${r.name}`);
step(20);
B.tradeAct({ a: 'give', k: 'relic', to: 2, id: r.id });
flush();
ok(hC.relics.filter((x) => x === r.id).length === 1, "can't give a relic you no longer have");
step(10);
ok(C.heroes[2].relics.includes(r.id) && !C.heroes[1].relics.includes(r.id), "Cid's screen shows the relic moved");
ok(save.achievements.includes('co_gift') && save.achievements.includes('co_heirloom'), 'Sharing Is Caring and Heirloom earned');
// Bad messages
const g0 = hA.gold;
q.push([A, { t: 'tr', a: 'give', k: 'gold', to: 0, n: 1e9 }, 'peerB']);
q.push([A, { t: 'tr', a: 'give', k: 'gold', to: 7, n: 5 }, 'peerC']);
q.push([A, { t: 'tr', a: 'chip', p: 999, n: 5 }, 'peerB']);
q.push([A, { t: 'tr', a: 'nonsense' }, 'peerC']);
flush();
step(2);
ok(hA.gold <= g0 + 75 && hB.gold >= 0 && hC.gold >= 0, 'junk messages never mint gold or go negative');

// ---- Titles in the snapshot
step(10);
ok(TR.tradingDebug(C).net?.ti[1] === 'co_patron', "Bea's title reaches Cid's screen");
const view = C.tradeView();
ok(view.heroes[1].title === 'co_patron' && view.heroes.length === 3, 'the TRADE menu view has teammates and titles');

// ---- The quick menu opens on a client and closes back to the fight
C.openTrade();
ok(C.screens.current === 'trade' && C.paused, 'TRADE opens on a client (the world keeps going)');
const btn = [...document.querySelectorAll<HTMLElement>('#scr-trade [data-tr=gold]')];
ok(btn.length >= 2, 'with GIVE buttons per teammate');
(C as any).resume();
ok(C.screens.current === 'none', 'and closes');

// ---- LEGEND rewards: a boss kill gives every hero a bounty relic
const relicsBefore = A.heroes.map((h) => h.relics.length);
A.bossesRun++;
step(1);
ok(A.heroes.every((h, i) => h.relics.length === relicsBefore[i] + 1), 'LEGEND bounty: one more relic each per boss');
step(40);
ok(save.achievements.includes('co_buddy'), 'Better Together earned (boss in co-op)');

console.log('tradingCoop: done');
process.exit(process.exitCode ?? 0);
