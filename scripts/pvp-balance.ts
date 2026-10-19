/**
 * pvp2 lane: bot duels for the PvP balance pass. Headless, one host Game, the
 * duel brain from src/game/systems/pvp2.ts on every hero, builds from the
 * bots' automatic picks at a given level. Prints time-to-kill, who won, how
 * much the ring decided, per scenario. Run:
 *   npx rolldown scripts/pvp-balance.ts --format esm --platform node --external jsdom --inline-dynamic-imports -o node_modules/.tests/pvp-balance.mjs && node node_modules/.tests/pvp-balance.mjs [quick]
 * Env: PVP_SCALE=<damageScale> to try another damage scale.
 */
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

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
(globalThis as any).setTimeout = (dom.window as any).setTimeout = () => 0;

const { Input } = await import('../src/core/input');
const { Game, cheats } = await import('../src/game/game');
const { settings } = await import('../src/game/settings');
const P = await import('../src/game/pvp');
const P2 = await import('../src/game/systems/pvp2');
const { exportBuild } = P;
settings.deathReplay = false;
cheats.god = false;
if (process.env.PVP_SCALE) P.pvpTuning.damageScale = Number(process.env.PVP_SCALE);
const quick = process.argv.includes('quick');
const canvas = document.getElementById('game') as HTMLCanvasElement;
const game = new Game(new Input(canvas), 16 / 9, document.getElementById('hud')!, document.getElementById('reticle')!);

type Kit = { primary: string; secondary: string; special: string };
const KITS: Record<string, Kit> = {
  buster: { primary: 'buster', secondary: 'charge', special: 'bomb' },
  scatter: { primary: 'scatter', secondary: 'grenade', special: 'storm' },
  laser: { primary: 'laser', secondary: 'well', special: 'blizzard' },
  rail: { primary: 'rail', secondary: 'orbital', special: 'meteor' },
  orb: { primary: 'orb', secondary: 'shield', special: 'storm' },
};

interface Result {
  t: number;
  winner: number;
  ring: boolean;
  dealt: number[];
}

/** One round between bots with these kits and levels; returns who won and when. */
function duel(kits: Kit[], levels: number[], seed: number, arena = 'garden'): Result {
  const g = game;
  g.leaveToTitle();
  (g as any).role = 'host';
  (g as any).host = { code: 'BAL01', max: 7, clientIds: [], send() {}, broadcast() {}, close() {} };
  g.lobbyKind = 'pvp';
  P2.setPvpRules(g, { format: 'ffa', rounds: 1, arena });
  g.lobby = [{ peerId: '', name: 'HOST', unlocked: [], skin: 'classic', pet: 'none', hero: 'rookie', loadout: kits[0] }];
  kits.forEach((k, i) => g.lobby.push({ peerId: `bot:${i + 1}:${seed}`, name: `B${i + 1}`, unlocked: [], skin: 'classic', pet: 'none', hero: 'rookie', loadout: k }));
  g.pvpBegin('host', seed, 'normal', P2.pvpRules(g));
  if (g.mode === 'shop') g.closeShop();
  // The host sits out (dead from the start); its build only sets the bots' level.
  const b = exportBuild(g.hero, 1);
  const pvp = g.pvp!;
  pvp.ready.set('', b);
  pvp.phase = 'wait';
  b.level = levels[0]; // bots are built for the average ready level; the others are rebuilt below
  g.pvpStartDuel();
  // Rebuild bots 2..n at their own level (pvpStartDuel used the average of the ready builds).
  for (let i = 1; i <= kits.length; i++) {
    const h = g.heroes[i];
    if (levels[i - 1] !== levels[0]) {
      P2.botHero(g, h, kits[i - 1], levels[i - 1]);
      h.revivesLeft = 0;
    }
  }
  const host = g.heroes[0];
  host.player.dead = true;
  host.player.hp = 0;
  g.pvpCheckWinner();
  pvp.countdown = 0;
  let t = 0;
  const t0 = pvp.round;
  while (g.pvp && g.pvp.phase === 'duel' && g.pvp.roundEnd <= 0 && g.pvp.round === t0 && t < 240 * 60) {
    g.update(1 / 60);
    t++;
    if (process.env.PVP_TRACE && t % 120 === 0) {
      const [h1, h2] = [g.heroes[1], g.heroes[2]];
      console.log(`  t=${(t / 60).toFixed(0)} d=${Math.hypot(h1.player.x - h2.player.x, h1.player.z - h2.player.z).toFixed(1)} hp=${h1.player.hp.toFixed(0)}/${h2.player.hp.toFixed(0)} acc=${g.pvp!.acc[1].toFixed(1)}/${g.pvp!.acc[2].toFixed(1)} dealt=${g.pvp!.stats[1].dealt.toFixed(0)}/${g.pvp!.stats[2].dealt.toFixed(0)} zone=${g.pvp!.zoneR.toFixed(0)} w=${h1.weapons.map((w) => w.def.id + w.level).join(',')}`);
    }
  }
  const alive = g.heroes.slice(1).filter((h) => !h.player.dead).map((h) => h.index - 1);
  const ring = (g.pvp?.zoneT ?? 0) > P.pvpTuning.zoneDelay + 5 && (g.pvp?.zoneR ?? 99) < 12;
  return { t: t / 60, winner: alive.length === 1 ? alive[0] : -1, ring, dealt: g.pvp ? g.pvp.stats.slice(1).map((s) => Math.round(s.dealt)) : [] };
}

const bySource: Record<string, number> = {};
{
  const orig = game.pvpHit;
  game.pvpHit = function (e, base, o, by) {
    const a0 = this.pvp ? this.pvp.acc[e.pvpOwner] : 0;
    const r = orig.call(this, e, base, o, by);
    if (this.pvp) {
      const k = `${Object.keys(KITS).find((n) => KITS[n].primary === by.loadoutPick.primary) ?? '?'}:${o.source}`;
      bySource[k] = (bySource[k] ?? 0) + (this.pvp.acc[e.pvpOwner] - a0);
    }
    return r;
  };
}
if (process.argv.includes('sources')) {
  for (let i = 0; i < 8; i++) { const r = duel([KITS.scatter, KITS.buster], [15, 15], 900 + i); console.log('scatter vs buster', r.winner, r.t.toFixed(1), r.dealt.join('/')); }
  for (let i = 0; i < 8; i++) duel([KITS.buster, KITS.laser], [15, 15], 950 + i);
  console.log(Object.entries(bySource).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${Math.round(v)}`).join('\n'));
  process.exit(0);
}
const med = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const N = quick ? 4 : 10;
console.log(`damageScale ${P.pvpTuning.damageScale}, maxDps ${P.pvpTuning.maxDps}, landEvery ${P.pvpTuning.landEvery}, iframes ${P.pvpTuning.iframes}, ${N} duels per row`);

// 1. Mirror matches by level: how long a fair 1v1 lasts.
for (const lv of [5, 15, 25]) {
  for (const kit of quick ? ['buster'] : ['buster', 'scatter']) {
    const rs = Array.from({ length: N }, (_, i) => duel([KITS[kit], KITS[kit]], [lv, lv], 100 + i));
    const ts = rs.map((r) => r.t);
    console.log(`mirror ${kit} lv${lv}: TTK median ${med(ts).toFixed(1)} s (min ${Math.min(...ts).toFixed(1)}, max ${Math.max(...ts).toFixed(1)}), ring decided ${rs.filter((r) => r.ring).length}/${N}, draws ${rs.filter((r) => r.winner < 0).length}`);
  }
}

// 2. Level gap: does a stronger build win, and how fast?
for (const [a, b] of [[20, 10], [15, 10], [12, 10]]) {
  const rs = Array.from({ length: N }, (_, i) => duel([KITS.buster, KITS.buster], [a, b], 300 + i));
  console.log(`buster lv${a} vs lv${b}: higher level wins ${rs.filter((r) => r.winner === 0).length}/${N}, median ${med(rs.map((r) => r.t)).toFixed(1)} s`);
}

// 3. Kits at level 15, round robin.
if (!quick) {
  const names = Object.keys(KITS);
  const wins: Record<string, number> = Object.fromEntries(names.map((n) => [n, 0]));
  const games: Record<string, number> = Object.fromEntries(names.map((n) => [n, 0]));
  for (let i = 0; i < names.length; i++)
    for (let j = i + 1; j < names.length; j++) {
      for (let s = 0; s < 6; s++) {
        const swap = s % 2 === 1;
        const [x, y] = swap ? [names[j], names[i]] : [names[i], names[j]];
        const r = duel([KITS[x], KITS[y]], [15, 15], 500 + s * 7 + i * 31 + j);
        games[x]++;
        games[y]++;
        if (r.winner === 0) wins[x]++;
        else if (r.winner === 1) wins[y]++;
      }
    }
  console.log('kits at lv15, win rate: ' + names.map((n) => `${n} ${Math.round((wins[n] / games[n]) * 100)}%`).join(', '));
}

// 4. Free-for-all with 6 at level 15: length of a round.
{
  const rs = Array.from({ length: quick ? 2 : 5 }, (_, i) => duel(Array.from({ length: 6 }, (_, k) => Object.values(KITS)[k % 5]), Array(6).fill(15), 700 + i, 'frost'));
  console.log(`ffa 6 bots lv15: round median ${med(rs.map((r) => r.t)).toFixed(1)} s, ring decided ${rs.filter((r) => r.ring).length}/${rs.length}`);
}
process.exit(0);
