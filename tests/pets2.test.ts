/** Pets2: bounded skills, growth, models, localization and real host/client replication. */
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { ok } from './check';
import {
  PETS,
  PET_BY_ID,
  PET_MAX_LEVEL,
  PET_SKILL_INFO,
  petRanks,
  pets2Tuning as T,
} from '../src/data/pets';
import { ACHIEVEMENTS } from '../src/data/meta';
import { localize, setLanguage } from '../src/i18n';

for (const id of ['robopup', 'owlbot', 'slimebuddy', 'hatchling', 'catdrone', 'minimech']) {
  const def = PET_BY_ID[id];
  ok(!!def && def.tree.length === PET_MAX_LEVEL, id + ': five-level tree');
  ok(
    ACHIEVEMENTS.some((a) => a.id === def.unlock),
    id + ': reachable achievement unlock',
  );
  for (let level = 1; level <= 5; level++)
    ok(
      Object.values(petRanks(def, level)).reduce((a, b) => a + b, 0) === level,
      id + ': one skill per level ' + level,
    );
  setLanguage('ar');
  ok(
    !/[a-z]{3}/i.test(localize(def.name) + localize(def.desc)),
    id + ': Arabic name and personality',
  );
  for (const skill of def.tree)
    ok(
      !/[a-z]{3}/i.test(
        localize(PET_SKILL_INFO[skill].name) + localize(PET_SKILL_INFO[skill].desc(1)),
      ),
      id + ': localized skill ' + skill,
    );
}
setLanguage('en');
ok(new Set(PETS.map((p) => p.id)).size === PETS.length, 'pet ids are unique');
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
process.on('uncaughtException', (e) => errors.push('uncaught ' + e.stack));

const { Input } = await import('../src/core/input');
const { Game, cheats } = await import('../src/game/game');
const { unlockedWeapons } = await import('../src/game/save');
const { ENEMIES } = await import('../src/data/enemies');
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
  send: (_id: string, msg: any) => q.push([B, msg]),
  broadcast: (msg: any) => q.push([B, msg]),
  close() {},
};
(B as any).role = 'client';
(B as any).client = { send: (msg: any) => q.push([A, msg]), close() {} };
const flush = () => {
  while (q.length) {
    const [g, msg] = q.shift()!;
    if (g === A) A.onHostMessage('peerB', structuredClone(msg));
    else B.onClientMessage(structuredClone(msg));
  }
};
cheats.god = false;
A.setHeroes([
  A.makeHero(0, 'Host', unlockedWeapons(), '', 'classic', 'minimech'),
  A.makeHero(1, 'Guest', [], 'peerB', 'classic', 'owlbot'),
]);
A.startRun();
flush();
if (A.mode === 'shop') A.closeShop();
flush();
const step = (n: number) => {
  for (let i = 0; i < n; i++) {
    A.update(1 / 60);
    flush();
    B.update(1 / 60);
    flush();
  }
};
const [hA, gA] = A.heroes;
step(6);
ok(
  B.heroes[0].pet === 'minimech' && B.heroes[1].pet === 'owlbot',
  'start message carries new pet identities',
);

const { PetView } = await import('../src/game/pet');
const { Pets2State, PETS2_IDS } = await import('../src/game/pets2');
const { updatePet2, petCone, pets2Light } = await import('../src/game/systems/pets2');
const { secretsState } = await import('../src/game/systems/secrets');
const CP = await import('../src/game/systems/coopplay');
const { Team } = await import('../src/game/bullets');
const { StaticBoxGrid } = await import('../src/core/spatialHash');
const { Scene, Group } = await import('three');
const { settings } = await import('../src/game/settings');
const { pet2Sound } = await import('../src/audio/pets2');
const { LightPicker } = await import('../src/render/lights');
const near = (a: number, b: number) => Math.abs(a - b) < 0.001;
let seed = 42;
Math.random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
A.xpNext = 1e12;
A.mode = 'fight';
A.modeT = 4;
A.walls = new StaticBoxGrid([]);
const clear = () => {
  for (const e of A.enemies.list) if (e.active) A.enemies.kill(e);
  A.hash.clear();
  A.bullets.clear();
  hA.player.teleport(0, 0);
  gA.player.teleport(30, 0);
  hA.player.invuln = gA.player.invuln = 999;
};
const equip = (id: string, level = 5) => {
  hA.setPet(id);
  hA.petState.reset();
  for (let i = 1; i < level; i++) hA.petState.levelUp();
  hA.recomputeStats();
  return hA.petState;
};
const enemy = (x = 4, z = 0, elite = false) => {
  const e = A.enemies.spawn(ENEMIES.chonk, x, z, { instant: true, hpMul: 1000, elite })!;
  e.state = 'move';
  e.speedMul = 0;
  A.hash.insert(e, e.x, e.z, e.radius);
  return e;
};
const tick = (dt = 0.1) => updatePet2.call(A, hA, dt);
for (const id of PETS2_IDS) {
  const st = equip(id);
  ok(st.level === 5 && !st.levelUp(), id + ': level cap');
  st.extra.turretT = 2;
  st.extra.splitT = 3;
  st.extra.stolen.add(33);
  st.stageRefresh();
  ok(
    st.extra.turretT === 0 && st.extra.splitT === 0 && st.extra.stolen.size === 0,
    id + ': stage clears transient state',
  );
  const scene = new Scene(),
    view = new PetView(scene, st.def, st);
  const socket = view.root.children.find((c) => c instanceof Group)!;
  const hat = new Group();
  hat.name = 'm2hat';
  socket.add(hat);
  st.extra.turretT = 2;
  st.extra.splitT = 2;
  view.render(0.016, 0, 0, 0, true);
  ok(hat.parent === socket && view.root.visible, id + ': retains cosmetic hat socket');
  view.render(0, 0, 0, 0, false);
  ok(scene.children.every((c) => !c.visible), id + ': hides pet and world turret when absent');
  view.dispose();
  ok(scene.children.length === 0, id + ': disposes world meshes');
}

clear();
let st = equip('robopup');
for (let i = 0; i < 4; i++) enemy(4, i * 0.4);
st.tauntCd = 0;
A.updatePets(0.1);
ok(
  st.tauntT > 0 && st.ranks.fetch === 2 && st.ranks.taunt === 2,
  'Robo-Pup fetch II and bark decoy',
);

clear();
st = equip('owlbot');
const elite = enemy(24, 0, true);
enemy(3, 0);
const sec = secretsState(A);
sec.room = {
  x: 21,
  z: 18,
  kind: 'wall',
  open: false,
  done: false,
  progress: 0,
  mask: 0,
  occupied: 0,
  clock: 0,
  ice: 0,
  blocked: false,
};
tick();
ok(
  st.extra.scoutKind === 2 && st.extra.scoutX === elite.x,
  'Owl prefers elites over ordinary close threats',
);
ok(
  st.extra.secret && st.extra.secretX === 21 && !sec.room.open,
  'Owl reveals the relay location without solving it',
);
const lights = new LightPicker();
lights.begin(0, 0);
pets2Light(A, lights, 1);
ok(lights.n === 1, 'Owl II adds a steady night-vision light');
st.extra.scanT = 0;
sec.room.done = true;
tick();
ok(!st.extra.secret, 'completed relay marker disappears');

clear();
st = equip('slimebuddy');
const shoot = (team: 0 | 1, x = 1) =>
  A.bullets.spawn({
    x,
    z: 0,
    dirX: 0,
    dirZ: 1,
    speed: 1,
    life: 8,
    radius: 0.15,
    damage: 3,
    knockback: 0,
    team,
    color: '#ffcd75',
    width: 0.1,
    length: 0.2,
  });
shoot(Team.Player);
shoot(Team.Enemy);
shoot(Team.Enemy);
tick();
ok(
  A.bullets.count === 2 && Array.from(A.bullets.team).slice(0, 2).includes(Team.Player),
  'Slime absorbs exactly one hostile bullet, keeping friendly shots',
);
tick();
ok(A.bullets.count === 2, 'absorb has a cooldown');
st.extra.supportT = 0;
st.extra.scanT = 0;
tick();
ok(A.bullets.count === 1, 'absorb rearms');
const jellyTarget = enemy();
st.extra.actionT = 0;
const hp = jellyTarget.hp;
tick();
ok(
  st.extra.splitT > 0 && jellyTarget.hp < hp,
  'two split helpers attack during their bounded lifetime',
);
for (let i = 0; i < 70; i++) tick();
ok(st.extra.splitT === 0, 'helpers expire before their next summon');

clear();
st = equip('hatchling', 4);
const front = enemy(5, 0),
  back = enemy(-6, 0),
  side = enemy(0, 6),
  far = enemy(8.5, 0);
const fh = front.hp,
  bh = back.hp,
  sh = side.hp,
  dh = far.hp;
st.extra.actionT = 0;
tick();
ok(
  front.hp < fh && front.burnT > 0 && back.hp === bh && side.hp === sh && far.hp === dh,
  'dragon fire hits and burns only its forward cone at level 4',
);
st.levelUp();
st.extra.actionT = 0;
tick();
ok(st.ranks.wings === 1 && far.hp < dh, 'level 5 wings extend fire range');
ok(
  petCone(3, 0, 1, 0, 7) && !petCone(-3, 0, 1, 0, 7) && !petCone(9, 0, 1, 0, 7),
  'cone rejects rear and distant targets',
);

clear();
st = equip('catdrone');
const crit = hA.stats.critChance;
hA.setPet('none');
hA.recomputeStats();
ok(
  near(crit - hA.stats.critChance, T.luckyCrit * 2),
  'Lucky II adds ten percentage points of crit chance',
);
st = equip('catdrone');
const gold = hA.gold;
enemy();
st.extra.actionT = 0;
tick();
st.extra.actionT = 0;
tick();
ok(hA.gold === gold + 1, 'one gold per enemy, no repeat farming');
for (let i = 0; i < 25; i++) {
  enemy(5, 0.1);
  st.extra.actionT = 0;
  tick();
}
ok(hA.gold === gold + T.stealPerStage, 'theft stops at its stage cap');
st.stageRefresh();
st.extra.actionT = 0;
tick();
ok(hA.gold === gold + T.stealPerStage + 1, 'stage refresh restores theft budget');

clear();
st = equip('minimech');
const botTarget = enemy();
const mh = botTarget.hp;
st.extra.actionT = 0;
tick();
ok(st.extra.turretT > 0 && botTarget.hp < mh, 'Mini Mech plants a damaging turret');
hA.player.teleport(5, 3);
tick();
ok(st.extra.turretX === 0 && st.extra.turretZ === 0, 'turret stays where planted');
for (let i = 0; i < 75; i++) tick();
ok(st.extra.turretT === 0, 'turret expires');
clear();
st = equip('minimech');
const cp = CP.coopPlayState(A);
cp.bomb.by = 0;
hA.player.pos.x = 1;
hA.player.prev.x = 0;
CP.coopPlayStep(A, 0.01);
ok(near(hA.player.x, 1), 'Porter removes bomb carry slowdown');
hA.setPet('none');
hA.player.pos.x = 1;
hA.player.prev.x = 0;
CP.coopPlayStep(A, 0.01);
ok(hA.player.x < 1, 'ordinary bomb carrier still slows');
cp.bomb.by = -1;

// New state rides its own additive cp.p2 field; old cp packets still work.
for (const id of PETS2_IDS) {
  st = equip(id);
  B.heroes[0].setPet(id);
  st.extra.splitT = 5;
  st.extra.turretT = 4;
  st.extra.turretX = 12;
  st.extra.scoutKind = 2;
  st.extra.scoutX = 41;
  st.extra.secret = true;
  st.extra.secretX = 22;
  B.applyCompanionNet(structuredClone(A.companionNet()));
  // Exercise the actual world snapshot/codec path as well as the section API.
  B.onClientMessage(structuredClone(A.buildSnapshot(gA, [])) as any);
  const remote = B.heroes[0].petState;
  ok(
    remote.level === 5 &&
      remote.extra.splitT === 5 &&
      remote.extra.turretX === 12 &&
      remote.extra.secret &&
      remote.extra.scoutX === 41,
    id + ': complete client presentation snapshot',
  );
  const before = JSON.stringify(remote.extra.net());
  updatePet2.call(B, B.heroes[0], 10);
  ok(JSON.stringify(remote.extra.net()) === before, id + ': client never simulates pet skills');
}
B.applyCompanionNet({ p: [hA.petState.net()] });
ok(B.heroes[0].petState.level === 5, 'legacy cp payload remains readable');
const extra = new Pets2State();
extra.setNet([NaN]);
ok(extra.turretT === 0 && !extra.secret, 'malformed extension safely clears presentation');
clear();
st = equip('catdrone');
enemy();
st.extra.actionT = 0;
const holdGold = hA.gold;
A.modes.holster = true;
tick();
A.modes.holster = false;
ok(hA.gold === holdGold, 'pacifist mode disables theft');
A.pvp = {} as any;
tick();
A.pvp = null;
ok(hA.gold === holdGold, 'PvP cannot farm pet gold');
settings.petSounds = false;
ok(pet2Sound('flame') === null && pet2Sound('bark') === null, 'pet mute applies to new cues');
settings.petSounds = true;
ok(!!pet2Sound('flame') && !!pet2Sound('bark'), 'pet cues reuse existing sounds');
ok(errors.length === 0, 'no runtime errors: ' + errors.join('\n'));
process.exit(process.exitCode ?? 0);
