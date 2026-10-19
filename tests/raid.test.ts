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
(globalThis as any).Path2D = (dom.window as any).Path2D = class {
  constructor(_d?: string) {}
};
(globalThis as any).__APP_VERSION__ = 'test';
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

const R = await import('../src/game/raid/encounter');
const s = R.createRaid(4);
ok(R.raidScale(8) > R.raidScale(2), 'health scales for 2–8 players');
ok(R.raidHeadDamage(s, 0, 100) === 0, 'shield blocks fire head until plate is held');
s.plate = true;
ok(R.raidHeadDamage(s, 0, 100) === 100, 'plate exposes fire head');
ok(R.raidHeadDamage(s, 2, 100) === 0, 'interceptor rejects ordinary damage');
ok(R.raidHeadDamage(s, 2, 100, false, true) === 100, 'reflected volley penetrates interceptor');
R.raidHeadDamage(s, 0, 1e9);
R.stepRaid(s, 9.9);
ok(s.heads[0].stump > 0 && s.heads[0].hp === 0, 'stump remains burnable for ten seconds');
R.stepRaid(s, 0.11);
ok(s.heads[0].copies === 2 && s.heads[0].hp > 0, 'unburned stump regrows two smaller heads');
s.plate = true;
R.raidHeadDamage(s, 0, 1e9);
R.raidHeadDamage(s, 0, 1, true);
ok(s.heads[0].sealed, 'fire seals a severed stump');
const reflected = R.createRaid(4);
reflected.plate = true;
reflected.actors[1].x = 0;
reflected.actors[1].z = 6;
const parrier = reflected.actors[2];
parrier.x = 8;
parrier.z = 3;
parrier.parry = true;
const orb = reflected.orbs[0];
Object.assign(orb, { live: true, reflected: false, x: 8, z: 1, target: 2, life: 5 });
const interceptHp = reflected.heads[2].hp;
R.stepRaid(reflected, 1 / 60);
ok(
  orb.reflected && reflected.heads[2].hp === interceptHp,
  'parry sends missile back instead of applying instant damage',
);
for (let i = 0; i < 60; i++) R.stepRaid(reflected, 1 / 60);
ok(
  reflected.heads[2].hp < interceptHp && !orb.live,
  'returned missile damages interceptor on arrival',
);
const torch = R.createRaid(4);
torch.plate = true;
R.raidHeadDamage(torch, 1, 1e9);
torch.actors[0].x = R.BRAZIER.x;
torch.actors[0].z = R.BRAZIER.z;
R.stepRaid(torch, 1 / 60);
torch.actors[0].x = 0;
torch.actors[0].z = R.HEAD_Z;
R.stepRaid(torch, 1 / 60);
ok(torch.heads[1].sealed, 'brazier makes non-fire loadouts able to seal a stump');
const copy = structuredClone(s);
R.stepRaid(s, 0.1);
R.stepRaid(copy, 0.1);
ok(JSON.stringify(s) === JSON.stringify(copy), 'snapshot replay is deterministic');
const wipe = R.createRaid(8);
wipe.time = 899.99;
R.stepRaid(wipe, 0.02);
ok(wipe.phase === 'lost', 'hard enrage deadline ends encounter');
const carry = R.createRaid(4);
carry.phase = 'core';
carry.actors[0].x = -13;
carry.actors[0].z = 12;
R.stepRaid(carry, 1 / 60);
ok(carry.actors[0].cell, 'walking to energy rack picks up a cell');
carry.actors[0].x = -12;
carry.actors[0].z = -1;
R.stepRaid(carry, 1 / 60);
ok(!carry.actors[0].cell && carry.delivered === 1, 'carrying cell to cannon fires it exactly once');
R.stepRaid(carry, 1 / 60);
ok(carry.delivered === 1, 'empty cannon cannot farm progress');
// Every bot uses the same role intent as real autopilot, with a baseline 24 weapon DPS.
for (const n of [1, 2, 4, 8]) {
  const s = R.createRaid(n),
    out = { x: 0, z: 0, head: -1, parry: false };
  while (s.time < 901 && s.phase !== 'won' && s.phase !== 'lost') {
    for (const a of s.actors)
      if (a.alive) {
        R.raidPilot(s, a, out);
        const dx = out.x - a.x,
          dz = out.z - a.z,
          d = Math.hypot(dx, dz),
          step = Math.min(d, 7 / 60);
        if (d) {
          a.x += (dx / d) * step;
          a.z += (dz / d) * step;
        }
        a.parry = out.parry;
        if (out.head >= 0) R.raidHeadDamage(s, out.head, 24 / 60);
      }
    R.stepRaid(s, 1 / 60);
  }
  ok(
    s.phase === 'won',
    `${n} players with role bots clear all three phases (${s.time.toFixed(1)}s)`,
  );
  if (n === 4)
    ok(s.time >= 480 && s.time <= 720, 'four-bot Medium baseline clears in 8–12 minutes');
  ok(s.parries > 0 && s.delivered === 12, 'bot clear requires parries and twelve deliveries');
}
const { Input } = await import('../src/core/input');
const { Game } = await import('../src/game/game');
const { installBot } = await import('../src/dev/bot');
const { settings } = await import('../src/game/settings');
const { save, saveLock } = await import('../src/game/save');
const Raid = await import('../src/game/systems/raid');
const canvas = document.getElementById('game') as HTMLCanvasElement;
const input = new Input(canvas);
const g = new Game(
  input,
  16 / 9,
  document.getElementById('hud')!,
  document.getElementById('reticle')!,
);
settings.mode = 'raid';
settings.difficulty = 'normal';
settings.deathReplay = false;
settings.helpGhosts = false;
save.training.offered = true;
saveLock.on = true;
g.startSolo();
ok(
  g.runMode === 'raid' && g.mode === 'fight' && g.arena.halfSize === 27,
  'solo raid starts in purpose-built arena without a shop',
);
ok(g.enemies.list.filter((e) => e.active).length === 3, 'raid spawns three weapon hit targets');
installBot(g, input);
const result = (window as any).botRun(850, false);
console.log(
  'REAL RAID BOT',
  JSON.stringify({
    phase: Raid.raidRuntime(g).state?.phase,
    time: Raid.raidRuntime(g).state?.time,
    avgMs: result.avgMs,
    hp: g.hero.player.hp,
    damage: g.hero.damageBy,
  }),
);
ok(
  Raid.raidRuntime(g).state?.phase === 'won',
  'actual solo autopilot plus help ghosts clears Medium without god mode',
);
ok(
  (g.raidNet()?.time ?? 0) >= 480 && (g.raidNet()?.time ?? 0) <= 720,
  'real autopilot team clears Medium in 8–12 minutes',
);
g.leaveToTitle();
ok(Raid.raidRuntime(g).state === null, 'leaving clears raid state and visuals');

// Eight heroes including a real client at index seven, through the actual snapshot codec.
const client = new Game(
  new Input(canvas),
  16 / 9,
  document.getElementById('hud')!,
  document.getElementById('reticle')!,
);
client.role = 'client';
(client as any).client = { send() {}, close() {} };
g.role = 'host';
g.lobbyKind = 'raid';
g.runMode = 'raid';
const queue: Record<string, unknown>[] = [];
(g as any).host = {
  code: 'RAID8',
  send(id: string, m: Record<string, unknown>) {
    if (id === 'peer7') queue.push(structuredClone(m));
  },
  broadcast(m: Record<string, unknown>) {
    queue.push(structuredClone(m));
  },
  close() {},
};
g.setHeroes(
  Array.from({ length: 8 }, (_, i) => g.makeHero(i, `Raider ${i}`, [], i ? 'peer' + i : '')),
);
g.local = 0;
g.startRun();
for (const m of queue.splice(0)) client.onClientMessage(m);
ok(
  client.runMode === 'raid' && client.heroes.length === 8 && client.local === 7,
  'raid start preserves mode and all eight hero slots',
);
ok(
  client.arena.halfSize === 27,
  'client reconstructs the dedicated arena before its first snapshot',
);
const hostState = g.raidNet()!;
hostState.actors[7].cell = true;
hostState.heads[0].copies = 2;
hostState.heads[1].stump = 7.5;
client.onClientMessage(structuredClone(g.buildSnapshot(g.heroes[7], [])));
ok(
  JSON.stringify(client.raidNet()) === JSON.stringify(hostState),
  'raid snapshot mirrors every head, orb, helper and carried cell',
);
const clockBefore = client.raidNet()!.time;
client.updateRaid(10);
ok(client.raidNet()!.time === clockBefore, 'client cannot advance encounter mechanics');
hostState.phase = 'core';
hostState.core = 0;
g.updateRaid(1 / 60);
client.onClientMessage(structuredClone(g.buildSnapshot(g.heroes[7], [])));
ok(client.raidNet()?.phase === 'overdrive', 'delta snapshot delivers phase transition');
const scaled = hostState.scale;
g.heroes[6].left = g.heroes[7].left = true;
g.updateRaid(1 / 60);
ok(hostState.players === 6 && hostState.scale < scaled, 'dropouts rescale remaining head health');
const hero = g.hero;
hostState.plate = true;
hostState.heads[0].hp = hostState.heads[0].max;
const before = hostState.heads[0].hp;
hero.skill.ult = hero.skill.ultT = 0;
g.damage(Raid.raidRuntime(g).proxies[0], 1e9, { source: 'nuke', fixed: true }, hero);
ok(
  before - hostState.heads[0].hp <= hostState.heads[0].max * 0.02001,
  'percent-health weapons cannot exploit proxy HP',
);
ok(hero.skill.ult > 0, 'damaging a raid head still charges the hero ultimate');
for (const h of hostState.heads) h.sealed = true;
g.updateRaid(1 / 60);
for (const m of queue.splice(0)) client.onClientMessage(m);
ok(
  hostState.phase === 'won' && client.raidNet()?.phase === 'won',
  'completion and reward message reach client before game over',
);
const { raidReward, raidRecords } = await import('../src/game/raid/ui');
saveLock.on = false;
raidReward(600, 4, 'normal', 30000);
ok(
  save.achievements.includes('hydra_engine') &&
    save.meta.rewards.includes('raid_skin') &&
    save.meta.rewards.includes('raid_ember'),
  'exclusive armour and achievement persist in existing profile schema',
);
ok(raidRecords()[0]?.time === 600, 'local raid leaderboard saves clear time');
const { normalize } = await import('../src/game/save');
ok(
  normalize({ ...save, version: 3 }).meta.rewards.includes('raid_skin'),
  'old profile normalization retains recognised raid cosmetics',
);

const worker = (await import('../server/leaderboard/worker.js')).default;
const kv = new Map<string, string>();
const env = {
  SCORES: {
    async get(k: string, type?: string) {
      const v = kv.get(k);
      return type === 'json' && v ? JSON.parse(v) : (v ?? null);
    },
    async put(k: string, v: string) {
      kv.set(k, v);
    },
  },
};
const posted = await worker.fetch(
  new Request('https://raid.test/scores', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      board: 'raid-normal',
      name: 'Raiders',
      score: 1500,
      stage: 1,
      kills: 0,
      time: 600,
    }),
  }),
  env,
);
ok(
  posted.status === 200,
  'configured online board accepts the raid completion score without kill farming',
);
const listed = await worker.fetch(new Request('https://raid.test/scores?board=raid-normal'), env);
ok(
  (await listed.json()).scores[0]?.time === 600,
  'online raid board returns clear records (in-memory KV)',
);
console.log('Raid tests complete');
process.exit(process.exitCode ?? 0);
