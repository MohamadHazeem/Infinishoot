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

const { ENEMIES, bossForStage, biomeAllows } = await import('../src/data/enemies');
const { BIOME_BY_ID, biomeForStage, biomeForce } = await import('../src/data/biomes');
const { createFieldArena } = await import('../src/world/fieldArena');
const { heroGroundMul } = await import('../src/game/hazards');
const { biome3Attack, biome3Force, biome3Tuning } = await import('../src/game/biome3Brain');
const S = await import('../src/game/systems/biome3');
const { packValue, unpackValue } = await import('../src/net/snapCodec');
const { phaseGate } = await import('../src/game/bosses');
const { enemyGeometry } = await import('../src/game/enemies');
const { TRACK_BY_ID, bossTrack } = await import('../src/audio/music/composition');
const { setLanguage, localize } = await import('../src/i18n');
const { STORY_BOSSES } = await import('../src/data/story');
const { paintPortrait, EXPRESSIONS } = await import('../src/ui/portraitArt');
const { CODEX } = await import('../src/data/codex');
ok(
  [1, 2, 3, 4].map((s) => biomeForStage(s).id).join() === 'meadow,dunes,peaks,magma',
  'classic first loop unchanged',
);
ok(
  biomeForStage(9).id === 'candy' && biomeForStage(10).id === 'ruins',
  'both new areas arrive in loop three',
);
ok(
  bossForStage(9).id === 'cake' &&
    bossForStage(10).id === 'kraken' &&
    bossForStage(12, 'candy').id === 'omega',
  'native stage bosses keep Omega at every loop end',
);
for (const id of ['candy', 'ruins']) {
  const a = createFieldArena(42, BIOME_BY_ID[id]),
    b = createFieldArena(42, BIOME_BY_ID[id]);
  ok(
    JSON.stringify(a.hazards) === JSON.stringify(b.hazards) &&
      JSON.stringify(a.conveyors) === JSON.stringify(b.conveyors),
    id + ': host/client seeded hazards match',
  );
  ok(heroGroundMul(a.hazards, 0, 0) === 1, id + ': start is clear');
  if (id === 'candy') {
    const h = a.hazards.find((h) => h.kind === 'chocolate')!;
    ok(
      !!h &&
        heroGroundMul(a.hazards, h.x, h.z) === 0.65 &&
        a.hazards.every((h) => h.kind !== 'quicksand'),
      'chocolate slows without quicksand sinking',
    );
  } else
    ok(
      a.conveyors.length === 2 && a.conveyors.every((c) => c.kind === 'wind' && c.speed === 0.85),
      'ruins have two slow opposed currents',
    );
  ok(!!TRACK_BY_ID[BIOME_BY_ID[id].music], id + ': music exists');
}
for (const id of ['gummy', 'gumlet', 'jellyfish', 'cake', 'kraken', 'cupcake', 'princeling']) {
  const d = ENEMIES[id];
  ok(
    !!d && d.material === 'slime' && enemyGeometry(d).getAttribute('position').count > 30,
    id + ': real instanced geometry and material',
  );
  setLanguage('ar');
  ok(/[\u0600-\u06ff]/.test(localize(d.name)), id + ': Arabic name');
  const c = CODEX.find((c) => c.id === 'enemy:' + id)!;
  ok(/[\u0600-\u06ff]/.test(localize(c.text)), id + ': Arabic lore and tip');
  setLanguage('en');
  if (d.boss || d.miniboss) {
    ok(
      STORY_BOSSES.some((b) => b.id === id),
      id + ': story chapter',
    );
    const hashes = new Set(
      EXPRESSIONS.map((expr) =>
        Array.from(
          paintPortrait(
            { kind: 'boss', model: d.model, colors: { body: d.bodyColor, accent: d.accentColor } },
            expr,
          ),
        ).join(','),
      ),
    );
    ok(hashes.size >= 5, id + ': expressive comic portrait');
  }
}
ok(
  biomeAllows(ENEMIES.gummy, 'candy') &&
    !biomeAllows(ENEMIES.gummy, 'ruins') &&
    biomeAllows(ENEMIES.jellyfish, 'ruins'),
  'native spawn filters',
);
ok(
  ENEMIES.gummy.split?.into === 'gumlet' && ENEMIES.gummy.split.count === 3,
  'brute splits into three gummies',
);
ok(bossTrack(9) === 'cake' && bossTrack(10) === 'kraken', 'boss music follows native stage bosses');
ok(
  biome3Attack('cake', 1, 0) === 'frosting' &&
    biome3Attack('kraken', 3, 0) === 'whirlpool' &&
    biome3Attack('kraken', 2, 1, true) === 'ink',
  'phase attack sets',
);
const force = { x: 0, z: 0 };
S.whirlForce(8, 0, force);
ok(force.x > 0 && force.z > 0, 'whirlpool pulls and swirls');
S.whirlForce(1, 0, force);
ok(force.x === 0 && force.z === 0, 'whirlpool has a safe inner zone');
S.whirlForce(20, 0, force);
ok(force.x === 0, 'whirlpool stops at its boundary');
const gate = { hp: 1, maxHp: 1000, phase: 1, def: ENEMIES.cake };
ok(phaseGate(gate) === 2 && gate.hp === 660, 'burst damage cannot skip cake layers');

// Fixed telegraph timing: harmless before expiry, one hit at eruption, no lingering hits.
{
  let hits = 0;
  const enemy = { active: true, uid: 42, hp: 100, dmgMul: 1, def: ENEMIES.kraken };
  const fake: any = {
    arena: {},
    enemies: { list: [enemy] },
    aliveHeroes: [{ player: { x: 0, z: 0, radius: 0.5 } }],
    bossApi: { open: () => true },
    vfx: { zone() {}, sound() {}, ring() {} },
    hurtHero: () => hits++,
  };
  const api = S.makeBiome3Api.call(fake);
  api.tentacle(enemy as any, 0, 0);
  S.updateBiome3.call(fake, 1);
  ok(hits === 0, 'tentacle telegraph cannot damage early');
  S.updateBiome3.call(fake, 0.11);
  ok(hits === 1, 'tentacle damages once at eruption');
  S.updateBiome3.call(fake, 0.1);
  ok(hits === 1, 'tentacle recovery does not repeat damage');
  enemy.active = false;
  S.updateBiome3.call(fake, 0.1);
  ok(!S.biome3Net.call(fake), 'killing the source cancels remaining tentacles');
}

const { Input } = await import('../src/core/input');
const { Game, cheats } = await import('../src/game/game');
const { unlockedWeapons } = await import('../src/game/save');
const { settings } = await import('../src/game/settings');

cheats.god = true;
settings.bossIntros = false;
settings.finishers = false;
const canvas = document.getElementById('game') as HTMLCanvasElement;
const mk = () =>
  new Game(
    new Input(canvas),
    16 / 9,
    document.getElementById('hud')!,
    document.getElementById('reticle')!,
  );
const A = mk();
const B = mk();
const q: [any, any][] = [];
(A as any).role = 'host';
(A as any).host = {
  send: (_id: string, m: any) => q.push([B, m]),
  broadcast: (m: any) => q.push([B, m]),
  close() {},
};
(B as any).role = 'client';
(B as any).client = { send: (m: any) => q.push([A, m]), close() {} };
const flush = () => {
  while (q.length) {
    const [g, m] = q.shift()!;
    if (g === A) A.onHostMessage('peerB', structuredClone(m));
    else B.onClientMessage(structuredClone(m));
  }
};
A.setHeroes([A.makeHero(0, 'Host', unlockedWeapons()), A.makeHero(1, 'Guest', [], 'peerB')]);
A.startRun();
flush();
if (A.mode === 'shop') A.closeShop();
flush();
A.xpNext = B.xpNext = 1e12;
const step = (n: number, until?: () => boolean) => {
  for (let i = 0; i < n; i++) {
    A.update(1 / 60);
    flush();
    B.update(1 / 60);
    flush();
    if (A.mode === 'levelup')
      for (const h of A.heroes) if (h.offers.length) A.heroAction(h, 'pick', 0, 1);
    if (until?.()) return true;
  }
  return false;
};

for (const [stage, id, move] of [
  [9, 'cake', 'frosting'],
  [10, 'kraken', 'tentacles'],
] as const) {
  A.loadStage(stage);
  flush();
  step(5);
  biome3Force.move = move;
  A.debugBoss({ now: true });
  step(10);
  ok(A.boss?.def.id === id, id + ': real host spawn');
  ok(
    step(900, () =>
      id === 'cake' ? B.bossField.waves.length > 0 : !!S.biome3Net.call(B)?.tentacles.length,
    ),
    id + ': attack reaches the client',
  );
  if (id === 'cake')
    ok(
      B.bossField.waves.some((w) => w.color === '#ff7eb6'),
      'frosting palette reaches the client',
    );
  if (id === 'kraken') {
    const boss = A.boss!;
    const p = A.hero.player;
    boss.x = p.x + 8;
    boss.z = p.z;
    const api = A.bossApi.biome3!;
    api.ink(boss);
    api.whirlpool(boss);
    const n = unpackValue(packValue(S.biome3Net.call(A))) as ReturnType<typeof S.biome3Net>;
    S.applyBiome3Net.call(B, n);
    ok(
      S.biome3Net.call(B)?.ink === biome3Tuning.inkTime &&
        S.biome3Net.call(B)?.whirl[2] === biome3Tuning.whirlTime,
      'ink and whirlpool clocks round-trip',
    );
    S.renderBiome3.call(B, 0.1, false);
    ok(
      (S.biome3Net.call(B)?.ink ?? 0) < biome3Tuning.inkTime,
      'client presentation advances between snapshots',
    );
    // Pool is bounded even when a mod/debug caller floods requests.
    for (let i = 0; i < 80; i++) api.tentacle(boss, 0, 0);
    ok((S.biome3Net.call(A)?.tentacles.length ?? 0) <= 24, 'tentacle pool is bounded');
  }
  biome3Force.move = '';
  for (let i = 0; i < 4 && A.boss?.active; i++) {
    step(110);
    A.damage(A.boss!, 1e9, { source: 'buster' }, A.heroes[0]);
  }
  step(60);
  ok(A.mode === 'cleared' || A.mode === 'portal', id + ': death clears the stage');
  ok(!S.biome3Net.call(A) && !S.biome3Net.call(B), id + ': encounter hazards clear on both peers');
}
// Native behaviours in the real simulation, with weapons removed for an isolated ring.
A.loadStage(10);
flush();
A.hero.weapons.length = 0;
const fish = A.enemies.spawn(
  ENEMIES.jellyfish,
  A.hero.player.x + 6,
  A.hero.player.z,
  A.spawnOpts({ instant: true }),
);
fish.timerA = 0;
const beforeShots = A.bullets.count;
step(65);
ok(A.bullets.count > beforeShots, 'jellyfish completes its wind-up and fires a ring');
A.loadStage(9);
flush();
const gummy = A.enemies.spawn(ENEMIES.gummy, 4, 0, A.spawnOpts({ instant: true }));
A.damage(gummy, 1e9, { source: 'buster' }, A.hero);
ok(A.enemies.countOf('gumlet') === 3, 'a killed brute really spawns three gummies');
// Stage changes clear all lane state even if a clock was still active.
A.loadStage(1);
flush();
ok(!S.biome3Net.call(A) && !S.biome3Net.call(B), 'world reset clears the snapshot');
biomeForce.key = null;
