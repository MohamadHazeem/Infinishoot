import * as THREE from 'three';
import { ok } from './check';
import { WEAPONS, isRightClick } from '../src/data/weapons';
import { PASSIVES } from '../src/data/passives';
import { ACHIEVEMENTS } from '../src/data/meta';
import { ICON_ART } from '../src/data/iconArt';
import { WEAPON_STEMS } from '../src/audio/stems';
import { codexEntries } from '../src/data/arsenal';
import { canEvolve } from '../src/data/tracks';
import { FUSIONS } from '../src/data/fusions';
import { Rng } from '../src/core/rng';
import { baseStats } from '../src/game/stats';
import { emptyFlags } from '../src/game/modTypes';
import { createWeapon, type WeaponCtx, type Weapon } from '../src/game/weapons';
import type { Enemy } from '../src/game/enemies';
import type { BulletSpawn } from '../src/game/bullets';
import { Bullets, Team } from '../src/game/bullets';
import { packBullets, unpackBullets } from '../src/net/codec';
import { SENTRY_BULLET_KIND } from '../src/game/weapons/sentry';
import { HitLedger, segmentDistanceSq } from '../src/game/weapons/weapons3Shared';
import { inWhipSweep } from '../src/game/weapons/whip';

const ids = ['crosswind', 'tesla', 'swarm', 'prism', 'whip', 'sentry'];
const scene = new THREE.Scene();
for (const id of ids) {
  const d = WEAPONS[id];
  ok(!!ICON_ART[id] && !!WEAPON_STEMS[id] && !!d.feel, `${id}: icon, music stem and feel`);
  ok(
    codexEntries().some((e) => e.key === `w:${id}`),
    `${id}: arsenal entry`,
  );
  if (!d.slot) {
    ok(
      d.levels.length === 5 && !!PASSIVES[d.evolution!.passive],
      `${id}: five visible levels and real partner`,
    );
    ok(
      FUSIONS.some((f) => f.parts.includes(id)),
      `${id}: fusion recipe`,
    );
  } else {
    ok(
      d.tracks!.length === 3 &&
        d.tracks!.every((t) => t.ranks.length === 4) &&
        d.evos!.length === 2,
      `${id}: full tree`,
    );
    ok(
      ACHIEVEMENTS.some(
        (a) =>
          a.unlockLoadout === id &&
          a.lifetime?.({ kills: 2000, elites: 20, bosses: 0, bestStage: 0, runs: 1 }),
      ),
      `${id}: earned by lifetime achievement`,
    );
    for (let evo = 0; evo < 2; evo++) {
      const w = createWeapon(id, scene);
      for (let i = 0; i < 7; i++) w.addRank(Math.floor(i / 4));
      ok(!canEvolve(d, w.build!), `${id}: cannot evolve at seven ranks`);
      w.addRank(1);
      ok(canEvolve(d, w.build!), `${id}: fork available at eight ranks`);
      w.evolve(evo);
      for (let t = 0; t < 3; t++) for (let r = 0; r < 4; r++) w.addRank(t);
      const before = w.p.dmg;
      w.overdrive();
      ok(
        w.maxed &&
          Math.abs(w.p.dmg / before - 1.08) < 1e-6 &&
          w.tags.includes(d.evos![evo].tags![0]),
        `${id}/${evo}: Overdrive and evolution tags`,
      );
      const copy = createWeapon(id, scene);
      copy.setBuildKey(w.buildKey);
      ok(
        JSON.stringify(copy.p) === JSON.stringify(w.p) &&
          copy.iconId === w.iconId &&
          !!ICON_ART[w.iconId],
        `${id}/${evo}: build and icon roundtrip`,
      );
      w.dispose();
      copy.dispose();
    }
  }
}
ok(
  isRightClick('sentry') && !isRightClick('whip'),
  'sentry hits use right-click Expose/Mod pipeline',
);
ok(
  segmentDistanceSq(3, 0.2, 0, 0, 6, 0) < 0.041 && segmentDistanceSq(7, 0, 0, 0, 6, 0) === 1,
  'swept collision covers the segment and clamps its ends',
);
ok(inWhipSweep(-3, -0.1, Math.PI, -0.2, 0.2, 4, 0.2), 'whip sweep wraps across minus pi');
ok(!inWhipSweep(8, 0, 0, -1, 1, 4, 0.2), 'whip does not hit beyond its reach');
const ledger = new HitLedger();
ok(ledger.add(9) && !ledger.add(9), 'hit ledger deduplicates within a pass');
ledger.clear();
ok(ledger.add(9), 'return pass can hit the same uid again');

function fixture(
  positions: number[][] = [
    [4, 0],
    [5, 1],
    [6, -1],
  ],
) {
  const targets = positions.map(
    ([x, z], i) =>
      ({
        x,
        z,
        radius: 0.5,
        uid: i + 1,
        hp: 1e8,
        alive: true,
        active: true,
        targetable: true,
      }) as Enemy,
  );
  const damage: { uid: number; amount: number; source: string }[] = [];
  const shots: BulletSpawn[] = [];
  const sounds: string[] = [];
  const ctx = {
    scene,
    player: {
      x: 0,
      z: 0,
      aim: { x: 1, z: 0 },
      dead: false,
      dashing: false,
      recoil: 0,
      landDist: (_min: number, max: number) => max,
      muzzle: (out: { x: number; z: number }) => {
        out.x = 0;
        out.z = 0;
      },
    },
    stats: baseStats(),
    rng: new Rng(42),
    flags: emptyFlags(),
    owner: 1,
    time: 0,
    firing: true,
    charging: true,
    combos: new Set(),
    fx: { star() {}, ring() {}, scar() {} },
    particles: { burst() {} },
    shake() {},
    sound: (s: string) => sounds.push(s),
    hitBarrels() {},
    zap() {},
    damage: (e: Enemy, amount: number, opts: { source: string }) => {
      damage.push({ uid: e.uid, amount, source: opts.source });
      return amount;
    },
    nearest: (x: number, z: number, r: number, skip?: (e: Enemy) => boolean) => {
      let found: Enemy | null = null,
        d = r * r;
      for (const e of targets) {
        const dist = (x - e.x) ** 2 + (z - e.z) ** 2;
        if (e.alive && e.hp > 0 && !skip?.(e) && dist < d) {
          found = e;
          d = dist;
        }
      }
      return found;
    },
    inRadius: (x: number, z: number, r: number, out: Enemy[]) => {
      out.length = 0;
      for (const e of targets)
        if (e.alive && Math.hypot(e.x - x, e.z - z) <= r + e.radius) out.push(e);
      return out;
    },
    bullets: { spawn: (s: BulletSpawn) => shots.push(s) },
    blast: (x: number, z: number, r: number, amount: number, _c: string, source: string) => {
      for (const e of targets)
        if (Math.hypot(e.x - x, e.z - z) < r + e.radius)
          damage.push({ uid: e.uid, amount, source });
    },
  } as unknown as WeaponCtx;
  return { ctx, targets, damage, shots, sounds };
}
function step(w: Weapon, ctx: WeaponCtx, seconds: number, dt = 1 / 60) {
  for (let t = 0; t < seconds - 1e-6; t += dt) {
    ctx.time += dt;
    w.update(dt, ctx);
  }
}
for (const id of ids) {
  const f = fixture(),
    w = createWeapon(id, scene);
  step(w, f.ctx, 5);
  ok(f.damage.length + f.shots.length > 0, `${id}: deals damage or fires in simulation`);
  const replica = createWeapon(id, scene);
  replica.setNet(w.net());
  ok(
    JSON.stringify(replica.net()) === JSON.stringify(w.net()),
    `${id}: active visual state roundtrips`,
  );
  const before = f.damage.length + f.shots.length;
  for (let i = 0; i < 20; i++) replica.draw(0.5, f.ctx);
  ok(f.damage.length + f.shots.length === before, `${id}: client rendering never deals damage`);
  const state = w.net();
  w.setNet([]);
  w.draw(1, f.ctx);
  replica.setNet(state);
  w.dispose();
  replica.dispose();
}
{
  const f = fixture([[4, 0]]),
    def = {
      ...WEAPONS.crosswind,
      levels: [{ text: '', p: { ...WEAPONS.crosswind.levels[0].p, count: 1, cd: 99, size: 2 } }],
    };
  const w = createWeapon('crosswind', scene, def);
  step(w, f.ctx, 2);
  ok(f.damage.length === 2, 'crosswind hits exactly once outward and once returning');
  w.dispose();
}
{
  const f = fixture([
      [3, 0],
      [3.5, 1],
      [3.5, -1],
      [4.5, 0],
    ]),
    w = createWeapon('prism', scene);
  step(w, f.ctx, 1.4);
  ok(
    f.damage.some((d) => d.amount === w.p.dmg * 0.45),
    'prism children deal reduced damage',
  );
  ok(f.damage.length <= 6, 'one parent and two children cannot recursively split');
  w.dispose();
}
{
  const f = fixture(),
    w = createWeapon('swarm', scene);
  step(w, f.ctx, 0.52);
  const first = w.net().length / 3;
  step(w, f.ctx, 0.12);
  ok(
    first === 1 && w.net().length / 3 > first,
    'swarm releases staggered missiles rather than an instant volley',
  );
  w.dispose();
}
{
  const f = fixture([[3, 0]]),
    w = createWeapon('whip', scene);
  step(w, f.ctx, 0.51);
  f.ctx.firing = false;
  step(w, f.ctx, 0.4);
  ok(f.damage.length === 1, 'whip has only one hit per enemy per swing');
  f.ctx.flags.busterDisabled = true;
  f.ctx.firing = true;
  step(w, f.ctx, 2);
  ok(f.damage.length === 1, 'Pacifist Core disables whip');
  w.dispose();
  const m = fixture([[3, 0]]),
    mega = createWeapon('whip', scene);
  m.ctx.flags.busterMegaEvery = 1;
  step(mega, m.ctx, 0.85);
  ok(
    m.damage.some((d) => d.amount === mega.p.dmg * 4),
    'whip honors Hair Trigger',
  );
  mega.dispose();
}
{
  const f = fixture(),
    w = createWeapon('sentry', scene);
  f.ctx.stats.chargeDmg = 2;
  f.ctx.stats.chargeSpeed = 2;
  f.ctx.flags.overcharge = true;
  f.ctx.flags.chargeSplit = 1;
  step(w, f.ctx, 0.55);
  ok(
    f.shots.length === 2 &&
      f.shots.every((s) => s.owner === 1 && s.kind === SENTRY_BULLET_KIND && s.damage === 66),
    'sentry honors owner, source, Plasma Core, Overcharge and split',
  );
  ok(w.ready < 0.1, 'sentry deploy starts the reload meter');
  f.ctx.charging = false;
  step(w, f.ctx, 1.6);
  ok(w.ready === 1, 'Quick Draw speeds sentry cooldown');
  const before = f.shots.length;
  f.ctx.flags.busterDisabled = true;
  step(w, f.ctx, 1);
  ok(f.shots.length === before, 'Pacifist Core silences already deployed sentries');
  w.dispose();
}
ok(scene.children.length === 0, 'all weapon render resources are removed on disposal');
// Bullet colour, silhouette and owner survive the real compact co-op codec.
const hostBullets = new Bullets(scene),
  clientBullets = new Bullets(scene);
for (const color of ['#a7f070', '#9fe8ff', '#ff7a2f'])
  hostBullets.spawn({
    x: 1,
    z: 2,
    dirX: 1,
    dirZ: 0,
    speed: 27,
    life: 1,
    radius: 0.2,
    damage: 22,
    knockback: 3,
    team: Team.Player,
    color,
    width: 0.3,
    length: 0.6,
    owner: 1,
    kind: SENTRY_BULLET_KIND,
    shape: 4,
  });
unpackBullets(packBullets(hostBullets, [0, 1, 2]), clientBullets);
ok(
  [0, 1, 2].every(
    (i) =>
      clientBullets.colorOf(i) === hostBullets.colorOf(i) &&
      clientBullets.owner[i] === 1 &&
      clientBullets.shape[i] === 4,
  ),
  'sentry base and both fork bullets survive wire codec',
);
hostBullets.clear();
clientBullets.clear();

// The real host snapshot, compact codec, client factory and source attribution together.
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

const html = readFileSync(`${process.cwd()}/index.html`, 'utf8');
const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true });
const w = dom.window as unknown as Record<string, unknown>;
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
// Any crash must fail the test (a rejected top-level await can otherwise exit 0 silently).
process.on('unhandledRejection', (e) => {
  console.error('FAIL unhandled rejection', e);
  process.exit(1);
});

const { Game, BULLET_KINDS, cheats } = await import('../src/game/game');
const { Input } = await import('../src/core/input');
const { ENEMIES } = await import('../src/data/enemies');
const { settings } = await import('../src/game/settings');
const canvas = document.getElementById('game') as HTMLCanvasElement;
const makeGame = () =>
  new Game(
    new Input(canvas),
    16 / 9,
    document.getElementById('hud')!,
    document.getElementById('reticle')!,
  );
cheats.god = cheats.unlockAll = true;
settings.loadout = { primary: 'whip', secondary: 'sentry', special: 'bomb' };
const A = makeGame(),
  B = makeGame();
const messages: [InstanceType<typeof Game>, any][] = [];
A.role = 'host';
B.role = 'client';
A.host = {
  send: (_id: string, m: any) => messages.push([B, m]),
  broadcast: (m: any) => messages.push([B, m]),
  close() {},
} as any;
B.client = { send: (m: any) => messages.push([A, m]), close() {} } as any;
const flush = () => {
  while (messages.length) {
    const [g, m] = messages.shift()!;
    if (g === A) A.onHostMessage('guest', structuredClone(m));
    else B.onClientMessage(structuredClone(m));
  }
};
A.setHeroes([
  A.makeHero(0, 'Host', Object.keys(WEAPONS)),
  A.makeHero(1, 'Guest', Object.keys(WEAPONS), 'guest'),
]);
A.startRun({ seed: 42, difficulty: 'normal' });
flush();
if (A.mode === 'shop') A.closeShop();
flush();
A.director.hold = true;
A.update(1 / 60);
flush();
for (const h of A.heroes) {
  for (const w of h.weapons) w.dispose();
  h.weapons.length = 0;
  for (const id of ids) {
    const w = createWeapon(id, A.scene);
    if (w.build) {
      for (let t = 0; t < 3; t++) for (let r = 0; r < 4; r++) w.addRank(t);
      w.evolve(h.index);
      w.overdrive();
    } else {
      while (!w.maxed) w.levelUp();
      w.evolve();
    }
    h.weapons.push(w);
  }
  const pl = h.player;
  pl.aim.x = 1;
  pl.aim.z = 0;
  for (let i = 0; i < 5; i++) {
    const e = A.enemies.spawn(ENEMIES.chonk, pl.x + 3 + i * 0.3, pl.z + i * 0.2, { instant: true });
    e.hp = e.maxHp = 1e6;
  }
}
A.update(1 / 60);
flush();
A.hash.clear();
for (const e of A.enemies.list) if (e.alive) A.hash.insert(e, e.x, e.z, e.radius);
for (let n = 0; n < 80; n++) {
  for (const h of A.heroes) {
    h.ctx.firing = h.ctx.charging = true;
    for (const w of h.weapons) w.update(1 / 60, h.ctx);
  }
}
B.onClientMessage(structuredClone(A.buildSnapshot(A.heroes[1], [])));
for (let hero = 0; hero < 2; hero++) {
  const ah = A.heroes[hero],
    bh = B.heroes[hero];
  ok(
    bh.weapons.map((w) => w.def.id).join() === ids.join(),
    `hero ${hero}: all six weapons created by the real client snapshot`,
  );
  ok(
    ah.weapons.every(
      (w, i) =>
        w.buildKey === bh.weapons[i].buildKey &&
        w.level === bh.weapons[i].level &&
        JSON.stringify(w.net()) === JSON.stringify(bh.weapons[i].net()),
    ),
    `hero ${hero}: fork, Overdrive, level and active state survive compact snapshot`,
  );
}
ok(
  BULLET_KINDS[SENTRY_BULLET_KIND].source === 'sentry',
  'appended bullet kind credits Pocket Sentry after gameplay kinds register',
);
ok(
  A.bullets.count > 0 && B.bullets.count > 0,
  `deployed sentry bullets reach the real client (${A.bullets.count}/${B.bullets.count})`,
);
const e = A.enemies.list.find((e) => e.alive)!;
e.shield = 0;
A.damage(e, 22, { source: BULLET_KINDS[SENTRY_BULLET_KIND].source, canCrit: false }, A.heroes[0]);
ok(
  e.exposeT > 0 && A.heroes[0].damageBy.sentry > 0,
  'sentry hits expose and credit the owning hero through real combat',
);
process.exit(process.exitCode ?? 0);
