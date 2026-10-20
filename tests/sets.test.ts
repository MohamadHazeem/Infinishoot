/** Item sets: membership data, tiers, bonuses on the host, client counting, strings and card chips. */
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { ok } from './check';

const html = readFileSync(`${process.cwd()}/index.html`, 'utf8');
const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true });
const noop: any = new Proxy(function () {}, {
  get: (_t, k) =>
    k === 'data'
      ? new Uint8ClampedArray(4 * 64 * 64)
      : k === Symbol.toPrimitive
        ? () => 0
        : k === 'measureText'
          ? () => ({ width: 10 })
          : noop,
  apply: () => noop,
  set: () => true,
});
(dom.window.HTMLCanvasElement.prototype as any).getContext = function () {
  return new Proxy(noop, {
    get: (_t, k) =>
      k === 'createImageData' || k === 'getImageData'
        ? (w2: number, h2: number) => ({ data: new Uint8ClampedArray(4 * (w2 || 64) * (h2 || 64)) })
        : k === 'canvas'
          ? this
          : noop[k as never],
  });
};
(dom.window.HTMLCanvasElement.prototype as any).toDataURL = () => 'data:image/png;base64,';
for (const k of [
  'window',
  'document',
  'navigator',
  'localStorage',
  'HTMLElement',
  'HTMLCanvasElement',
  'HTMLInputElement',
  'Event',
  'KeyboardEvent',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'getComputedStyle',
  'innerWidth',
  'innerHeight',
  'addEventListener',
  'dispatchEvent',
  'Node',
  'MouseEvent',
  'PointerEvent',
]) {
  try {
    (globalThis as any)[k] = (dom.window as any)[k];
  } catch {
    Object.defineProperty(globalThis, k, { value: (dom.window as any)[k], configurable: true });
  }
}
(globalThis as any).Path2D = class {
  constructor(_d?: string) {}
};
(globalThis as any).__APP_VERSION__ = 'smoke';
(dom.window as any).Path2D = (globalThis as any).Path2D;
(dom.window.HTMLElement.prototype as any).scrollIntoView = () => {};
(globalThis as any).matchMedia = (dom.window as any).matchMedia = () => ({
  matches: false,
  addEventListener() {},
  removeEventListener() {},
});
process.on('unhandledRejection', (e) => {
  console.error('FAIL unhandled rejection', e);
  process.exit(1);
});
const errors: string[] = [];
process.on('uncaughtException', (e) => {
  console.error(e);
  process.exit(1);
});

const { Input } = await import('../src/core/input');
const { Game, cheats } = await import('../src/game/game');
const { unlockedWeapons } = await import('../src/game/save');
const { WEAPONS } = await import('../src/data/weapons');
const { PASSIVES } = await import('../src/data/passives');
const { RELIC_BY_ID } = await import('../src/data/relics');
const { MOD_BY_ID } = await import('../src/data/mods');
const { SPECIALS } = await import('../src/data/specials');
const { ENEMIES } = await import('../src/data/enemies');
const S = await import('../src/data/sets');
const Sys = await import('../src/game/systems/sets');
const UI = await import('../src/ui/setsUi');
const { en } = await import('../src/i18n/en');
const { ar } = await import('../src/i18n/ar');

// ---- data
const known = (id: string) =>
  !!(WEAPONS[id] || PASSIVES[id] || RELIC_BY_ID[id] || MOD_BY_ID[id] || (id.startsWith('sp_') && SPECIALS[id.slice(3)]));
for (const d of S.SETS) {
  const m = S.setMembers(d.id);
  const bad = m.filter((id) => !known(id));
  ok(bad.length === 0, `${d.id}: every member id exists${bad.length ? ' (missing ' + bad.join(', ') + ')' : ''}`);
  ok(new Set(m).size === m.length, `${d.id}: no duplicate members`);
  const solo = m.filter((id) => !(PASSIVES[id]?.coop || MOD_BY_ID[id]?.coop));
  ok(solo.length >= 9, `${d.id}: ${solo.length} solo pieces (6 reachable with room to choose)`);
  ok(!!en[`sets.${d.id}` as keyof typeof en] && [1, 2, 3].every((t) => !!en[`sets.${d.id}.${t}` as keyof typeof en]), `${d.id}: English name and 3 tier texts`);
}
ok(Object.values(S.SET_PIECES).every((s) => s.length <= 2), 'an item sits in at most two sets');
for (const k of Object.keys(en).filter((k) => k.startsWith('sets.')))
  ok(!!(ar as Record<string, string>)[k] && (ar as Record<string, string>)[k] !== (en as Record<string, string>)[k], `Arabic for ${k}`);
ok(S.setTier(1) === 0 && S.setTier(2) === 1 && S.setTier(3) === 1 && S.setTier(4) === 2 && S.setTier(6) === 3 && S.setTier(9) === 3, 'tiers at 2 / 4 / 6');
ok(S.nextTierAt(0) === 2 && S.nextTierAt(2) === 4 && S.nextTierAt(5) === 6 && S.nextTierAt(7) === 6, 'next tier goal');

// ---- game
cheats.god = true;
const canvas = document.getElementById('game') as HTMLCanvasElement;
const hudB = document.createElement('div');
document.body.appendChild(hudB);
const A = new Game(new Input(canvas), 16 / 9, document.getElementById('hud')!, document.getElementById('reticle')!);
const B = new Game(new Input(canvas), 16 / 9, hudB, document.createElement('div'));
const q: [any, any][] = [];
(A as any).role = 'host';
(A as any).host = { send: (_id: string, m: any) => q.push([B, m]), broadcast: (m: any) => q.push([B, m]), close() {} };
(B as any).role = 'client';
(B as any).client = { send: (m: any) => q.push([A, m]), close() {} };
const flush = () => {
  while (q.length) {
    const [g, m] = q.shift()!;
    if (g === A) A.onHostMessage('peerB', structuredClone(m));
    else B.onClientMessage(structuredClone(m));
  }
};
A.setHeroes([A.makeHero(0, 'Host', unlockedWeapons()), A.makeHero(1, 'Guest', unlockedWeapons(), 'peerB')]);
A.startRun();
flush();
if (A.mode === 'shop') A.closeShop();
flush();
const h = A.hero;
const guest = A.heroes[1];
const I = S.SET_INDEX;
const step = (hero = h) => A.setsStep(hero, 1 / 60);
function clear(hero = h) {
  hero.passives = {};
  hero.relics.length = 0;
  hero.synergy.reset();
  hero.recomputeStats();
  step(hero);
}
function give(hero: typeof h, ids: string[]) {
  for (const id of ids) {
    if (RELIC_BY_ID[id]) hero.relics.push(id);
    else if (PASSIVES[id]) hero.passives[id] = 1;
    else if (MOD_BY_ID[id]) hero.synergy.add(MOD_BY_ID[id], 0);
  }
  hero.recomputeStats();
  step(hero);
}
clear();
const base = Sys.countPieces(h, new Int8Array(S.SET_COUNT));
const baseInf = base[I.inferno];
give(h, ['r_cinder']);
ok(h.sets.counts[I.inferno] === baseInf + 1 && h.sets.counts[I.boomsmith] === base[I.boomsmith] + 1, 'a two-set relic counts for both sets');

// Static stats: Speedster 2 (move), 4 (+1 dash); Duelist 2 crit.
clear();
const move0 = h.stats.moveSpeedMul;
const dash0 = h.stats.dashCharges;
give(h, ['sneakers', 'thrusters']);
ok(h.sets.tiers[I.speedster] >= 1, 'two Speedster items reach tier 1');
const move1 = h.stats.moveSpeedMul;
ok(move1 > move0 + S.setsTuning.speedMove * 0.99 + 0, 'Speedster 2: move speed above the passives alone');
give(h, ['dash_cells', 'r_feather']);
ok(h.sets.tiers[I.speedster] >= 2 && h.stats.dashCharges >= dash0 + 2, 'Speedster 4: an extra dash in a row (on top of Dash Cells)');
clear();
const crit0 = h.stats.critChance;
give(h, ['r_crown', 'r_glassclock']);
ok(h.sets.tiers[I.duelist] >= 1 && h.stats.critChance >= crit0 + S.setsTuning.duelCrit - 1e-9, 'Duelist 2: crit chance');

// Inferno 2 / 4: burning enemies take more and explode on death.
clear();
const spawn = (dx: number, hp = 100000) => {
  const e = A.enemies.spawn(ENEMIES.chonk, h.player.x + dx, h.player.z, A.spawnOpts({ instant: true }));
  e.hp = e.maxHp = hp;
  e.state = 'move';
  rehash();
  return e;
};
function rehash() {
  A.hash.clear();
  for (const o of A.enemies.list) if (o.alive) A.hash.insert(o, o.x, o.z, o.radius);
}
const e1 = spawn(3);
const raw = () => {
  const before = e1.hp;
  A.damage(e1, 100, { source: 'test', tags: [], noStatus: true, noCrit: true } as any, h);
  return before - e1.hp;
};
const plain = raw();
e1.burnT = 3;
const burnOff = raw();
give(h, ['pyromaniac', 'kindling']);
ok(h.sets.tiers[I.inferno] >= 1, 'two Inferno Mods reach tier 1');
const burnOn = raw();
ok(burnOn > burnOff * 1.15, `Inferno 2: hits on Burning enemies harder (${burnOff} -> ${burnOn}, plain ${plain})`);
give(h, ['r_cinder', 'wildfire']);
ok(h.sets.tiers[I.inferno] >= 2, 'four Inferno pieces reach tier 2');
const victim = spawn(5, 10);
const by = spawn(5.6);
victim.burnT = 2;
h.sets.budget = 10;
const byHp = by.hp;
A.damage(victim, 1000, { source: 'test', tags: [], noStatus: true } as any, h);
ok(!victim.active || victim.hp <= 0, 'victim dies');
ok(by.hp < byHp && (h.damageBy['set_inferno'] ?? 0) > 0, 'Inferno 4: the burning kill explodes on its neighbour');
ok(A.sourceName('set_inferno') === 'Inferno Set', 'damage breakdown names the set blast');

// Bulwark 6: a barrier blocks one hit completely.
clear();
give(h, S.setMembers('bulwark').filter((id) => RELIC_BY_ID[id]).slice(0, 6));
ok(h.sets.tiers[I.bulwark] === 3, 'six Bulwark relics reach tier 3');
h.sets.barrierT = 0;
step();
ok(h.sets.barrier, 'barrier forms after its cooldown');
cheats.god = false;
h.player.invuln = 0;
const hp0 = h.player.hp;
A.hurtHero(h, 30, h.player.x + 1, h.player.z);
ok(h.player.hp === hp0 && !h.sets.barrier, 'Bulwark 6: the barrier eats the hit');
h.player.invuln = 0;
A.hurtHero(h, 30, h.player.x + 1, h.player.z);
ok(h.player.hp < hp0, 'the next hit lands');
h.player.hp = h.player.maxHp;
cheats.god = true;

// Stormcaller 6: every Nth hit calls a storm.
clear();
give(h, S.setMembers('storm').filter((id) => RELIC_BY_ID[id] || (PASSIVES[id] && !PASSIVES[id].coop) || (MOD_BY_ID[id] && !MOD_BY_ID[id].coop)).slice(0, 6));
ok(h.sets.tiers[I.storm] === 3, 'six Stormcaller pieces reach tier 3');
h.sets.stormCd = 0;
h.sets.hits = 0;
spawn(4);
spawn(-4);
const st0 = h.damageBy['set_storm'] ?? 0;
for (let i = 0; i < S.setsTuning.stormEvery; i++) A.damage(e1, 1, { source: 'test', tags: [] } as any, h);
ok((h.damageBy['set_storm'] ?? 0) > st0, `Stormcaller 6: hit ${S.setsTuning.stormEvery} calls lightning`);

// Machinist 4: the support bot zaps.
clear();
give(h, S.setMembers('machinist').filter((id) => RELIC_BY_ID[id] || (PASSIVES[id] && !PASSIVES[id].coop)).slice(0, 4));
ok(h.sets.tiers[I.machinist] >= 2, 'four Machinist pieces reach tier 2');
const bot0 = h.damageBy['set_bot'] ?? 0;
for (let i = 0; i < 90; i++) step();
ok((h.damageBy['set_bot'] ?? 0) > bot0, 'Machinist 4: the support bot hits the nearest enemy');

// Each hero counts its own sets; the client counts its own hero from snapshots.
clear();
clear(guest);
give(guest, ['pyromaniac', 'kindling', 'r_cinder']);
ok(guest.sets.counts[I.inferno] >= 3 && h.sets.counts[I.inferno] === baseInf, 'sets are per hero');
for (let i = 0; i < 30; i++) {
  A.update(1 / 60);
  flush();
}
for (let i = 0; i < 4; i++) {
  B.update(1 / 60);
  Sys.setsFrame(B);
  flush();
}
ok(B.hero.sets.counts[I.inferno] === guest.sets.counts[I.inferno], `client counts its own set pieces (${B.hero.sets.counts[I.inferno]} vs host ${guest.sets.counts[I.inferno]})`);

// Card chips.
UI.setsView.counts = new Int8Array(S.SET_COUNT);
(UI.setsView.counts as Int8Array)[I.inferno] = 1;
const chip = UI.setChipsHtml('r_cinder', true);
ok(chip.includes('INFERNO') && chip.includes('2/2') && chip.includes(' on'), 'chip shows INFERNO 2/2 and lights up when the card completes a tier');
ok(UI.setChipsHtml('r_cinder', false).includes('1/2'), 'owned piece shows the current count');
ok(UI.setChipsHtml('no_such_item', true) === '', 'no chip for set-less items');
ok(UI.tierText('storm', 3).includes(String(S.setsTuning.stormEvery)), 'tier text carries the tuning numbers');
ok(UI.setsPanelHtml().includes('INFERNO'), 'pause SETS panel lists held sets');
process.exit(process.exitCode ?? 0);
