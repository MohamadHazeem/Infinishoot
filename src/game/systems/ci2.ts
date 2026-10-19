/** Run recorder: boundary events only; never records client snapshots or sends network traffic. */
import type { Game } from '../game';
import { cheats } from '../game';
import { settings, applySettings } from '../settings';
import { save } from '../save';
import { binds } from '../../core/keybinds';
import { Rng, randomSeed } from '../../core/rng';
import { loadJson, saveJson } from '../../core/storage';
import { Tape, REPLAY_VERSION, parseReplay, hashNumber, type ReplayFile } from '../../dev/replay';
import { t } from '../../i18n';
import { dailySeed, today } from '../../data/modes';
import { sfx } from '../../audio/sfx';
import { soundLane } from './sound2';
import { worldRun } from './worldEvents';

const KEYS = [...new Set(['Escape', 'Enter', 'Space', 'Tab', 'Backspace', ...Array.from({ length: 10 }, (_, i) => `Digit${i}`), ...Array.from({ length: 26 }, (_, i) => `Key${String.fromCharCode(65 + i)}`), 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight', 'Backquote', 'Minus', 'Equal', 'BracketLeft', 'BracketRight', 'Backslash', 'Semicolon', 'Quote', 'Comma', 'Period', 'Slash', 'CapsLock', 'Insert', 'Delete', 'Home', 'End', 'PageUp', 'PageDown', ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`), ...Array.from({ length: 10 }, (_, i) => `Numpad${i}`), 'NumpadAdd', 'NumpadSubtract', 'NumpadMultiply', 'NumpadDivide', 'NumpadDecimal', 'NumpadEnter'])];
const COMMANDS = ['heroAction', 'routeVote', 'autoFireToggle', 'closeShop', 'pause', 'resume', 'onHostMessage', 'onClientLeft', 'loadStage', 'debugGiveWeapon', 'debugSpawnElite', 'debugSkipToBoss', 'quitRun', 'leaveToTitle'] as const;
const HERO_COMMANDS = new Set<string>(['heroAction', 'routeVote']);
const AUDIO_RANDOM = new Rng(0x41554449);
let audioIsolated = false;
/** Audio may be gesture-locked or muted. Its random draws must never change a shot or enemy. */
function isolateAudio(): void {
  if (audioIsolated) return;
  audioIsolated = true;
  const rand = () => AUDIO_RANDOM.next();
  for (const name of Object.getOwnPropertyNames(Object.getPrototypeOf(sfx))) {
    const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(sfx), name);
    if (name === 'constructor' || typeof descriptor?.value !== 'function') continue;
    const fn = descriptor.value;
    (sfx as any)[name] = function (a: any, b: any, c: any, d: any, e: any, f: any, h: any, i: any, j: any, k: any) { const old = Math.random; Math.random = rand; try { return fn.call(this, a, b, c, d, e, f, h, i, j, k); } finally { Math.random = old; } };
  }
}
const scalars = (value: object) => Object.fromEntries(Object.entries(value).filter(([, v]) => typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))));
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

export function replayHash(g: Game): number {
  let h = 2166136261;
  const add = (n: number) => { h = hashNumber(h, n); };
  add(g.stage); add(g.runTime); add(g.score); add(g.kills); add(g.level); add(g.xp); add(g.director.time); add(g.bullets.count);
  for (const hero of g.heroes) {
    const p = hero.player;
    add(p.x); add(p.z); add(p.hp); add(p.aim.x); add(p.aim.z); add(hero.gold); add(hero.bombCharge);
    for (const w of hero.weapons) { add(w.level); add(w.ready); }
  }
  for (const e of g.enemies.list) if (e.active) { add(e.x); add(e.z); add(e.hp); add(e.timerA); }
  for (let i = 0; i < g.bullets.count; i++) { add(g.bullets.x[i]); add(g.bullets.z[i]); add(g.bullets.vx[i]); add(g.bullets.vz[i]); add(g.bullets.life[i]); }
  for (let i = 0; i < g.pickups.count; i++) { add(g.pickups.x[i]); add(g.pickups.z[i]); add(g.pickups.value[i]); add(g.pickups.type[i]); }
  add((g.rng as unknown as { s: number }).s);
  return h;
}

function summary(g: Game): string {
  let enemyHash = 2166136261;
  for (const e of g.enemies.list) if (e.active) for (const n of [e.x, e.z, e.hp, e.timerA]) enemyHash = hashNumber(enemyHash, n);
  return JSON.stringify({ stage: g.stage, level: g.level, kills: g.kills, director: g.director.time, enemyHash, t: g.runTime, xp: g.xp, score: g.score, rng: (g.rng as unknown as { s: number }).s,
    heroes: g.heroes.map(h => [h.player.x, h.player.z, h.player.hp, h.player.aim.x, h.player.aim.z, h.gold, h.bombCharge, h.weapons.map(w => [w.def.id, w.level, w.ready])]),
    enemies: g.enemies.list.filter(e => e.active).slice(0, 3).map(e => [e.uid, e.def.id, e.x, e.z, e.hp, e.timerA]), bullets: Array.from({ length: Math.min(6, g.bullets.count) }, (_, i) => [g.bullets.x[i], g.bullets.z[i], g.bullets.vx[i], g.bullets.vz[i], g.bullets.life[i]]), pickups: g.pickups.count });
}

async function packed(r: ReplayFile): Promise<string> {
  const bytes = new Uint8Array(await new Response(new Blob([JSON.stringify(r)]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
async function unpacked(value: string | ReplayFile): Promise<ReplayFile> {
  if (typeof value !== 'string') return parseReplay(JSON.stringify(value));
  const bytes = Uint8Array.from(atob(value), c => c.charCodeAt(0));
  return parseReplay(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text());
}
async function keepReplay(key: string, r: ReplayFile): Promise<void> { saveJson(key, await packed(r)); }

export function installReplay(g: Game): void {
  isolateAudio();
  let keys = KEYS;
  const input = g.input as any;
  const rawUpdate = g.update.bind(g), rawRender = g.render.bind(g), rawStart = g.startRun.bind(g);
  let tape = new Tape(), strings: string[] = [], ids = new Map<string, number>();
  let header: Record<string, any> | null = null, steps = 0, depth = 0, clock = 0, event = 0;
  let playing = false, cursor = 0, done = false, failed = '', crash = '';
  let terminalHash: number | undefined;
  let checks: Record<number, string> = {};
  const pending = loadJson<string | null>('replay.watch', null);
  let booting = !!pending;
  let loaded: ReplayFile | null = null;
  let random = new Rng(1), viewRandom = new Rng(2);
  let settingKey = '';
  const controlState = () => JSON.stringify({ settings, binds });
  const NativeDate = Date;
  const SimDate = function (...args: unknown[]) {
    if (!new.target) return new NativeDate((header?.date ?? NativeDate.now()) + clock).toString();
    return Reflect.construct(NativeDate, args.length ? args : [(header?.date ?? NativeDate.now()) + clock]);
  } as unknown as DateConstructor;
  Object.setPrototypeOf(SimDate, NativeDate);
  Object.defineProperty(SimDate, 'prototype', { value: NativeDate.prototype });
  SimDate.now = () => (header?.date ?? NativeDate.now()) + clock;
  const cosmeticRandom = () => viewRandom.next();
  // Particle budgets and audio readiness vary with quality/hardware. Decorative random
  // draws live on their own stream, including mesh creation inside the enemy batch cache.
  const isolate = (object: any, names: string[]) => {
    for (const name of names) {
      const fn = object[name];
      if (typeof fn !== 'function') continue;
      object[name] = function (a: any, b: any, c: any, d: any, e: any, f: any, h: any, i: any, j: any, k: any) {
        const old = Math.random; Math.random = cosmeticRandom;
        try { return fn.call(this, a, b, c, d, e, f, h, i, j, k); } finally { Math.random = old; }
      };
    }
  };
  isolate(g.particles, ['burst', 'smoke', 'dust', 'sparks']);
  isolate(g.fx, ['ring', 'star']);
  isolate(g.scars, ['add']);
  isolate(g.enemies, ['batch', 'fling']);
  isolate(g.vfx, ['playSound']);
  let nextEnemy = 1;
  const spawn = g.enemies.spawn.bind(g.enemies);
  g.enemies.spawn = (def, x, z, options) => {
    const enemy = spawn(def, x, z, options);
    if (playing) enemy.uid = nextEnemy++;
    else if (header && header.firstUid === undefined && g.role !== 'client') header.firstUid = enemy.uid;
    return enemy;
  };
  const resetPool = () => {
    g.recycleT = 0; // The half-second teleport schedule otherwise leaks across retries.
    worldRun(g).prev = null; // Do not exclude the previous run's planned world event.
    // Title-demo enemies and earlier runs must not affect pool iteration order.
    // Keep live ids monotonic: other lanes retain uid-keyed caches; replay starts at the recorded base.
    g.enemies.clear(); g.enemies.list.length = 0; (g.enemies as any).free.length = 0; nextEnemy = header?.firstUid ?? 1;
    // Hearing retained the previous run's shots and installed hooks one step earlier
    // on retries. Reset both so a fresh page and a retry start with identical noise.
    const sound = soundLane(g);
    sound.noise.clear(); sound.heard.clear(); sound.shown.clear(); sound.anchors.clear();
    sound.seed = NaN; sound.runTime = 0; sound.stage = -1; sound.steps = 0; sound.band = 0; sound.drop = null;
    g.enemyCtx.hear = undefined; g.vfx.onSound = null;
  };
  const rand = () => random.next();
  const now = () => (header?.origin ?? 0) + clock;
  const intern = (s: string) => { let i = ids.get(s); if (i === undefined) { i = strings.length; strings.push(s); ids.set(s, i); } return i; };
  const scope = <T>(fn: () => T): T => {
    const old = Math.random, oldNow = performance.now, oldDate = globalThis.Date;
    Math.random = rand;
    globalThis.Date = SimDate as DateConstructor;
    // Only synchronous game callbacks see the simulation clock; browser timers and profiling keep wall time.
    performance.now = now;
    depth++;
    try { return fn(); } finally { depth--; Math.random = old; performance.now = oldNow; globalThis.Date = oldDate; }
  };
  let stepDt = 0, renderAlpha = 1, renderDt = 0;
  const step = () => rawUpdate(stepDt);
  const frame = () => rawRender(renderAlpha, renderDt);
  const active = () => header !== null && g.role !== 'client' && !done;
  const file = (): ReplayFile => ({ version: REPLAY_VERSION, header: header!, strings, checks, data: tape.json(), steps, complete: !crash, hash: terminalHash ?? replayHash(g), ...(crash ? { crash } : {}) });
  const persistCrash = (reason: string) => {
    if (!header || playing) return;
    crash = reason;
    // Keep a synchronous fallback first; compression replaces it before the next task.
    const r = file(); saveJson('replay.crash', r); void keepReplay('replay.crash', r).catch(() => {});
  };
  const download = async () => {
    const stored = loadJson<string | ReplayFile | null>('replay.last', null) ?? loadJson<string | ReplayFile | null>('replay.crash', null);
    const r = header ? file() : stored ? await unpacked(stored) : null;
    if (!r) { g.hud.toast(t('replay.empty')); return; }
    const stream = new Blob([JSON.stringify(r)]).stream().pipeThrough(new CompressionStream('gzip'));
    const url = URL.createObjectURL(await new Response(stream).blob());
    const a = document.createElement('a'); a.href = url; a.download = `InfiniShoot-${r.header.seed}.isr`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const writeInput = () => {
    tape.push(input.device === 'pad' ? 1 : 0);
    tape.push(input.move.x); tape.push(input.move.y); tape.push(input.padAim.x); tape.push(input.padAim.y);
    tape.push(input.mouse.ndcX); tape.push(input.mouse.ndcY); tape.push(input.mouse.x); tape.push(input.mouse.y);
    tape.push(+input.mouse.inside); tape.push(input.mouseButtons); tape.push(input.mousePressedBits);
    for (let kind = 0; kind < 2; kind++) {
      const set = kind ? input.pressed : input.keys;
      for (let block = 0; block < keys.length; block += 26) {
        let bits = 0; for (let i = 0; i < 26 && block + i < keys.length; i++) if (set.has(keys[block + i])) bits |= 1 << i;
        tape.push(bits);
      }
    }
    let held = 0, pressed = 0;
    for (let i = 0; i < 20; i++) { if (input.padButtons[i]) held |= 1 << i; if (input.padPressed.has(i)) pressed |= 1 << i; }
    tape.push(held); tape.push(pressed);
    tape.push(input.accessiblePresses.size ? intern(Array.from(input.accessiblePresses).join(',')) : intern(''));
    tape.push(+cheats.god); tape.push(g.hero.play.cashSel);
    // Mouse aim depends on the interpolated camera, including wheel zoom and resize.
    for (const n of g.cam.camera.matrixWorld.elements) tape.push(n);
    for (const n of g.cam.camera.projectionMatrixInverse.elements) tape.push(n);
  };
  const read = () => tape.at(cursor++);
  const readInput = () => {
    input.device = read() ? 'pad' : 'kbm';
    input.move.x = read(); input.move.y = read(); input.padAim.x = read(); input.padAim.y = read();
    input.mouse.ndcX = read(); input.mouse.ndcY = read(); input.mouse.x = read(); input.mouse.y = read(); input.mouse.inside = !!read(); input.mouseButtons = read(); input.mousePressedBits = read();
    for (let kind = 0; kind < 2; kind++) {
      const set = kind ? input.pressed : input.keys;
      set.clear();
      for (let block = 0; block < keys.length; block += 26) { const bits = read(); for (let i = 0; i < 26 && block + i < keys.length; i++) if (bits & (1 << i)) set.add(keys[block + i]); }
    }
    const held = read(), pressed = read(); input.padPressed.clear();
    for (let i = 0; i < 20; i++) { input.padButtons[i] = !!(held & (1 << i)); if (pressed & (1 << i)) input.padPressed.add(i); }
    input.accessiblePresses.clear(); for (const a of strings[read()].split(',')) if (a) input.accessiblePresses.add(a);
    cheats.god = !!read(); g.hero.play.cashSel = read();
    for (let i = 0; i < 16; i++) g.cam.camera.matrixWorld.elements[i] = read();
    for (let i = 0; i < 16; i++) g.cam.camera.projectionMatrixInverse.elements[i] = read();
    g.cam.camera.matrixWorldInverse.copy(g.cam.camera.matrixWorld).invert();
  };
  g.startRun = fixed => {
    if (g.role === 'client' || playing) { rawStart(fixed); return; }
    const q = new URLSearchParams(location.search);
    const seed = fixed?.seed ?? (q.has('seed') ? Number(q.get('seed')) : g.runMode === 'daily' ? dailySeed(today()) : randomSeed());
    keys = [...new Set([...KEYS, ...Object.values(binds).flat().filter(Boolean)])];
    header = { seed, randomSeed: seed, keys, firstten: scalars(g.firstten), settings: clone(settings), save: clone(save), binds: clone(binds), cheats: clone(cheats), mode: g.runMode, role: g.role, lobby: clone(g.lobby), lobbyKind: g.lobbyKind, origin: performance.now(), stepN: g.stepN, date: Date.now(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, query: location.search, difficulty: fixed?.difficulty ?? g.pickDifficulty().id,
      heroes: g.heroes.map(h => ({ name: h.name, unlocked: h.unlocked, peerId: h.peerId, skin: h.skin.id, pet: h.pet, hero: h.heroDef.id, aim: [h.player.aim.x, h.player.aim.z, Number.isFinite(h.player.aimDist) ? h.player.aimDist : -1], look: h.player.look, remote: clone(h.remote), loadout: clone(h.loadoutPick) })), camera: g.cam.camera.matrixWorld.toArray(), projection: g.cam.camera.projectionMatrix.toArray() };
    tape = new Tape(); strings = []; ids = new Map(); steps = event = clock = 0; done = false; crash = ''; terminalHash = undefined; checks = {}; random = new Rng(seed); viewRandom = new Rng(seed ^ 0x56494557); settingKey = controlState();
    resetPool();
    scope(() => rawStart({ seed, difficulty: header!.difficulty }));
    // Daily/weekly rules may select a derived seed.
    header.seed = g.seed; header.initial = summary(g); header.initialRandom = (random as unknown as { s: number }).s;
  };
  const originals = new Map<string, (...args: any[]) => any>();
  for (const name of COMMANDS) {
    const original = (g[name] as (...args: any[]) => any).bind(g); originals.set(name, original);
    (g as any)[name] = (...args: any[]) => {
      if (!active() || depth || playing) return original(...args);
      const encoded = HERO_COMMANDS.has(name) ? [args[0].index, ...args.slice(1)] : args;
      tape.push(2); tape.push(intern(JSON.stringify([name, encoded]))); event++;
      const result = scope(() => original(...args));
      if (g.mode === 'title') { terminalHash = replayHash(g); done = true; void keepReplay('replay.last', file()).catch(() => {}); }
      return result;
    };
  }
  const rawShow = g.screens.show.bind(g.screens);
  g.screens.show = name => {
    if (!active() || depth || playing) { rawShow(name); return; }
    tape.push(4); tape.push(intern(name)); event++;
    scope(() => rawShow(name));
  };
  g.update = dt => {
    if (booting) return;
    if (playing) { if (!done) advance(true); return; }
    if (!active()) { rawUpdate(dt); return; }
    if (g.screens.current === 'settings' || g.screens.current === 'controls') {
      const next = controlState();
      if (next !== settingKey) { tape.push(3); tape.push(intern(next)); settingKey = next; }
    }
    const currentTape = tape;
    tape.push(0); tape.push(dt); writeInput(); clock += dt * 1000; event++;
    try { (stepDt = dt, scope(step)); } catch (e) { persistCrash(String(e)); throw e; }
    if (tape !== currentTape) return; // a menu started a new run inside this update
    steps++; tape.push(steps % 60 === 0 ? replayHash(g) : -1);
    if (steps % 60 === 0) checks[steps] = summary(g) + ' random=' + (random as unknown as { s: number }).s;
    if (g.mode === 'title' || (g.mode === 'dead' && g.gameOverShown)) {
      terminalHash = replayHash(g); done = true; void keepReplay('replay.last', file()).catch(() => {});
    }
  };
  g.render = (alpha, dt) => {
    if (booting) return;
    if (playing) return; // The tape renders at the original cadence; the outer loop submits the resulting scene.
    if (!active()) { rawRender(alpha, dt); return; }
    tape.push(1); tape.push(alpha); tape.push(dt); event++;
    const simRandom = random; random = viewRandom;
    try { (renderAlpha = alpha, renderDt = dt, scope(frame)); } finally { random = simRandom; }
  };
  function advance(oneStep: boolean): void {
    let updated = false;
    try {
      while (cursor < tape.length) {
        const kind = read(); event++;
        if (kind === 0) {
          if (updated && oneStep) { cursor--; event--; return; }
          const dt = read(); readInput(); clock += dt * 1000;
          (stepDt = dt, scope(step)); steps++; updated = true;
          const expected = read();
          if (expected >= 0) { const actual = replayHash(g); if (expected !== actual) throw new Error(`Divergence at step ${steps}: expected ${expected}, got ${actual}\nExpected ${loaded?.checks?.[steps] ?? '(older recording)'}\nActual ${summary(g)} random=${(random as unknown as { s: number }).s}`); }
        } else if (kind === 1) { const alpha = read(), dt = read(); const simRandom = random; random = viewRandom; try { (renderAlpha = alpha, renderDt = dt, scope(frame)); } finally { random = simRandom; } }
        else if (kind === 2) {
          const [name, args] = JSON.parse(strings[read()]);
          const fn = originals.get(name); if (!fn) throw new Error(`Unknown replay command ${name}`);
          if (HERO_COMMANDS.has(name)) args[0] = g.heroes[args[0]];
          scope(() => fn(...args));
        } else if (kind === 4) scope(() => rawShow(strings[read()] as Parameters<typeof rawShow>[0]));
        else if (kind === 3) { const state = JSON.parse(strings[read()]); Object.assign(settings, state.settings); Object.assign(binds, state.binds); applySettings(); }
        else throw new Error(`Unknown event ${kind}`);
      }
      if (steps !== loaded?.steps) throw new Error(`Step count mismatch: ${steps}/${loaded?.steps}`);
      if (loaded?.hash !== undefined && replayHash(g) !== loaded.hash) throw new Error(`Divergence at final step ${steps}`);
      done = true;
    } catch (e) { failed = String(e); done = true; if (!oneStep) throw e; g.hud.toast(failed, 20); }
  }
  const play = (r: ReplayFile) => {
    loaded = parseReplay(JSON.stringify(r)); header = loaded.header;
    g.host?.close(); g.client?.close(); g.host = null; g.client = null;
    Object.assign(settings, clone(header.settings)); Object.assign(save, clone(header.save)); Object.assign(binds, header.binds); Object.assign(cheats, header.cheats); applySettings();
    keys = header.keys ?? KEYS;
    if (!playing) {
      const fetch = window.fetch.bind(window);
      window.fetch = (url, init) => {
        const path = new URL(typeof url === 'string' ? url : url instanceof URL ? url.href : url.url, location.href);
        if (path.origin !== location.origin || /scores|leaderboard|ghost|lobby/.test(path.pathname)) return Promise.resolve(new Response('null', { status: 503 }));
        return fetch(url, init);
      };
      const setItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key: string, value: string) { if (!key.startsWith('infinishoot.')) setItem.call(this, key, value); };
    }
    playing = true; done = false; failed = ''; clock = steps = cursor = event = 0; random = new Rng(header.randomSeed ?? header.seed); viewRandom = new Rng((header.randomSeed ?? header.seed) ^ 0x56494557);
    tape = Tape.from(loaded.data); strings = loaded.strings;
    Object.assign(g.firstten, header.firstten ?? {});
    g.lobby = clone(header.lobby ?? []); g.lobbyKind = header.lobbyKind ?? 'coop';
    g.role = header.role; g.runMode = header.mode; g.stepN = header.stepN;
    // Playback is entirely offline, including host recordings.
    if (g.role === 'host') g.host = { send() {}, broadcast() {}, close() {}, clientIds: header.heroes.filter((h: any) => h.peerId).map((h: any) => h.peerId), code: 'REPLAY', kick() {} } as any;
    scope(() => {
      g.setHeroes(header!.heroes.map((h: any, i: number) => { const hero = g.makeHero(i, h.name, h.unlocked, h.peerId, h.skin, h.pet, h.hero); hero.loadoutPick = h.loadout; hero.remote = h.remote ?? null; if (h.look) { hero.player.look = h.look; hero.player.setSkin(hero.skin.armor, hero.skin); } if (h.aim) { hero.player.aim.x = h.aim[0]; hero.player.aim.z = h.aim[1]; hero.player.aimDist = h.aim[2] < 0 ? Infinity : h.aim[2]; } return hero; }));
      resetPool();
      random = new Rng(header!.randomSeed ?? header!.seed);
      rawStart({ seed: header!.seed, difficulty: header!.difficulty });
      if (header!.initial && header!.initial !== summary(g)) throw new Error(`Initial state divergence\nExpected ${header!.initial}\nActual ${summary(g)} random=${(random as unknown as { s: number }).s}`);
      if (header!.initialRandom !== undefined && header!.initialRandom !== (random as unknown as { s: number }).s) throw new Error(`Initial random state divergence: ${header!.initialRandom} vs ${(random as unknown as { s: number }).s}`);
    });
    g.cam.camera.matrixWorld.fromArray(header.camera); g.cam.camera.matrixWorldInverse.copy(g.cam.camera.matrixWorld).invert();
    g.cam.camera.projectionMatrix.fromArray(header.projection); g.cam.camera.projectionMatrixInverse.copy(g.cam.camera.projectionMatrix).invert();
  };
  const api = { export: file, play, run: () => { advance(false); return { steps, events: event, hash: replayHash(g), failed, done }; }, status: () => ({ steps, events: event, failed, done }), download };
  Object.assign(window, { replay: api });
  window.addEventListener('error', e => persistCrash(e.message));
  window.addEventListener('unhandledrejection', e => persistCrash(String(e.reason)));
  window.addEventListener('pagehide', () => { if (header && !playing) saveJson('replay.last', file()); });
  installHelp(g, download);
  if (pending) {
    saveJson('replay.watch', null);
    void unpacked(pending).then(r => play(r)).catch(e => {
      failed = String(e); done = playing = true; g.hud.toast(failed, 20);
    }).finally(() => { booting = false; showWatchControls(); });
  }
}

function installHelp(g: Game, download: () => Promise<void>): void {
  const el = document.createElement('div'); el.id = 'scr-replay-help'; el.className = 'screen dim';
  el.innerHTML = `<h1>${t('replay.help')}</h1><div class="menu"><button data-nav data-save>${t('replay.save')}</button><button data-nav data-watch>${t('replay.watch')}</button><button data-nav data-crash>${t('replay.crash')}</button><button data-nav data-back>${t('replay.back')}</button></div><p role="status"></p>`;
  g.screens.addScreen('replay-help', el, { onBack: () => g.screens.show('settings') });
  const b = document.createElement('button'); b.dataset.nav = ''; b.textContent = t('replay.help'); b.onclick = () => g.screens.show('replay-help');
  document.querySelector('#scr-settings .settings-footer')?.prepend(b);
  el.querySelector('[data-save]')!.addEventListener('click', () => void download());
  el.querySelector('[data-back]')!.addEventListener('click', () => g.screens.show('settings'));
  const watch = async (r: ReplayFile) => {
    // A fresh page also resets module-owned pools and WeakMap state from a previous run.
    const value = await packed(r); saveJson('replay.watch', value);
    if (loadJson('replay.watch', '') !== value) throw new Error(t('replay.storage'));
    const q = new URLSearchParams(); q.set('seed', String(r.header.seed));
    const season = new URLSearchParams(r.header.query).get('season'); if (season) q.set('season', season);
    location.search = q.toString();
  };
  el.querySelector('[data-crash]')!.addEventListener('click', async () => {
    try { const value = loadJson<string | ReplayFile | null>('replay.crash', null); if (value) await watch(await unpacked(value)); else g.hud.toast(t('replay.empty')); }
    catch (e) { el.querySelector('[role=status]')!.textContent = String(e); }
  });
  el.querySelector('[data-watch]')!.addEventListener('click', () => {
    const picker = document.createElement('input'); picker.type = 'file'; picker.accept = '.isr,.json,.gz';
    picker.onchange = async () => {
      try {
        const f = picker.files?.[0]; if (!f) return;
        if (f.size > 32 * 1024 * 1024) throw new Error('Replay exceeds 32 MiB');
        const bytes = new Uint8Array(await f.arrayBuffer());
        const text = bytes[0] === 31 && bytes[1] === 139 ? await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text() : new TextDecoder().decode(bytes);
        await watch(parseReplay(text));
      } catch (e) { el.querySelector('[role=status]')!.textContent = String(e); }
    }; picker.click();
  });
}

function showWatchControls(): void {
  const bar = document.createElement('div'); bar.id = 'replay-controls';
  const exit = document.createElement('button'); exit.dataset.nav = ''; exit.textContent = t('replay.exit');
  exit.onclick = () => { location.search = ''; };
  window.addEventListener('keydown', e => { if (e.code === 'Escape') { e.preventDefault(); location.search = ''; } }, { capture: true });
  bar.append(exit); document.body.append(bar);
  const css = document.createElement('style');
  css.textContent = `#replay-controls { position:fixed; inset-block-start:calc(4 * var(--p)); inset-inline-end:calc(54 * var(--p)); z-index:10000; }
    #replay-controls button { border:0; border-radius:0; padding:calc(2 * var(--p)) calc(3 * var(--p)); font:calc(8 * var(--p)) var(--font); color:var(--white); background:var(--blue); cursor:pointer; text-shadow:var(--p) var(--p) var(--ink); box-shadow:inset var(--p) var(--p) var(--sky),inset calc(-1 * var(--p)) calc(-1 * var(--p)) var(--navy),0 0 0 var(--p) var(--ink),var(--p) calc(2 * var(--p)) var(--ink); }
    #replay-controls button:focus-visible,#replay-controls button:hover { background:var(--orange); outline:var(--p) solid var(--white); }`;
  document.head.append(css);
}
