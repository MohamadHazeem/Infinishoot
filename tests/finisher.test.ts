/**
 * Finisher lane: the finisher timeline and drawing helpers, portrait art and
 * HUD expressions (pure), the effects-bus events, and in the real game (jsdom,
 * no WebGL) the host holding a boss's death for the finisher, skipping it,
 * the opt-outs, and ping / boss pop-ins.
 */
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { ok } from './check';
import { burstRadius, finisherFrame, finisherLength, finisherTuning, focusLine, hash01, seamX } from '../src/game/finisher';
import { ANNOUNCER_LOOK, EXPRESSIONS, PORTRAIT, bossLook, heroLook, lookKey, paintPortrait } from '../src/ui/portraitArt';
import type { HudMood } from '../src/ui/portraits';
import { SKINS } from '../src/data/skins';
import { HEROES } from '../src/data/heroes';
import { ENEMIES } from '../src/data/enemies';

// ---------------------------------------------------------------- timeline
{
  const T = finisherTuning;
  const len = finisherLength(false);
  ok(len >= 1.5 && len <= 2.5, `a finisher lasts 1.5-2.5 s (${len} s)`);
  ok(finisherLength(true) < len, 'the calm (reduced motion) version is shorter');
  const f0 = finisherFrame(0.01, false);
  ok(f0.panel === 0 && f0.sinceHit < 0 && !f0.title && !f0.done, 'it opens on the freeze-frame: no panels, no hit, no title');
  const mid = finisherFrame(T.freeze + T.panelIn * 0.5, false);
  ok(mid.panel > 0 && mid.panel < 1, 'panels slide in over panelIn');
  ok([0.25, 0.5, 0.75, 1].includes(mid.panel), 'panel motion is stepped (4 steps)');
  ok(finisherFrame(T.strike - 0.01, false).sinceHit < 0 && finisherFrame(T.strike + 0.05, false).sinceHit > 0, 'the hit lands at `strike`');
  ok(finisherFrame(T.title + 0.1, false).title, 'the K.O. title is up after `title`');
  const end = finisherFrame(len - 0.05, false);
  ok(end.out > 0 && !end.done, 'the exit wipe plays at the end');
  ok(finisherFrame(len + 0.01, false).done, 'done after its length');
  let monotonic = true;
  let last = -1;
  for (let t = 0; t < len; t += 1 / 60) {
    const s = finisherFrame(t, false).sinceHit;
    if (s >= 0 && last >= 0 && s < last) monotonic = false;
    last = s;
  }
  ok(monotonic, 'time since the hit only grows');
  const calm = finisherFrame(0.1, true);
  ok(calm.panel === 1, 'calm: panels appear at once (no slide)');
  ok(finisherFrame(0.25, true).sinceHit >= 0 && finisherFrame(0.35, true).title, 'calm: the hit and title come early');
}

// ---------------------------------------------------------------- drawing helpers
{
  const tip = burstRadius(0, 8, 100, 0.3, Math.PI / 8);
  const notch = burstRadius(0, 8, 100, 0.3, 0);
  ok(tip > notch && notch >= 69 && tip <= 131, `burst tips stick out past the notches (${notch.toFixed(0)} / ${tip.toFixed(0)})`);
  const W = 320;
  const H = 180;
  ok(seamX(0, W, H) > seamX(H, W, H) && seamX(0, W, H) < W * 0.65 && seamX(H, W, H) > W * 0.35, 'the panel seam leans and stays mid-screen');
  let lines = 0;
  let inner = 0;
  for (let a = -Math.PI; a < Math.PI; a += 0.01) {
    if (focusLine(a, 120, 150, 50, 40, 3)) lines++;
    if (focusLine(a, 30, 150, 50, 40, 3)) inner++;
  }
  ok(inner === 0, 'no focus lines inside their start radius');
  ok(lines > 60 && lines < 520, `focus lines cover part of the circle at the edge (${lines}/628 samples)`);
  let spread = 0;
  for (let i = 0; i < 1000; i++) spread += hash01(i);
  ok(Math.abs(spread / 1000 - 0.5) < 0.05, 'hash01 is spread over 0..1');
}

// ---------------------------------------------------------------- portrait art
{
  const looks = [
    ...HEROES.map((h, i) => heroLook(h.id, SKINS[i % SKINS.length])),
    heroLook('rookie', SKINS[0], '#22c76a'),
    ...['king', 'rex', 'queen', 'omega', 'prince', 'rexling', 'princess', 'reaper'].map((id) => bossLook(ENEMIES[id])),
    ANNOUNCER_LOOK,
  ];
  let allFilled = true;
  let allDistinct = true;
  let deterministic = true;
  let alphaClean = true;
  let outlined = true;
  for (const l of looks) {
    const seen = new Set<string>();
    for (const e of EXPRESSIONS) {
      const px = paintPortrait(l, e);
      let n = 0;
      for (let i = 3; i < px.length; i += 4) {
        if (px[i]) n++;
        if (px[i] !== 0 && px[i] !== 255) alphaClean = false;
      }
      if (n < PORTRAIT * PORTRAIT * 0.3) allFilled = false;
      const key = Buffer.from(px).toString('base64');
      if (seen.has(key)) allDistinct = false;
      seen.add(key);
      if (Buffer.from(paintPortrait(l, e)).toString('base64') !== key) deterministic = false;
      // The silhouette's outermost pixels are ink.
      for (let y = 0; y < PORTRAIT && outlined; y++) {
        for (let x = 0; x < PORTRAIT; x++) {
          const i = (y * PORTRAIT + x) * 4;
          if (!px[i + 3]) continue;
          if (x > 0 && !px[i - 1] && !(px[i] === 0x1a && px[i + 1] === 0x1c && px[i + 2] === 0x2c)) outlined = false;
          break;
        }
      }
    }
  }
  ok(allFilled, 'every portrait fills at least 30% of its 32x32 grid');
  ok(allDistinct, 'all six expressions differ for every hero, boss and the announcer');
  ok(deterministic, 'portraits paint the same every time');
  ok(alphaClean, 'pixels are fully opaque or fully clear (crisp pixel art)');
  ok(outlined, 'silhouettes have an ink outline');
  const blink = paintPortrait(looks[0], 'neutral', true);
  ok(Buffer.from(blink).toString('base64') !== Buffer.from(paintPortrait(looks[0], 'neutral')).toString('base64'), 'blinking closes the eyes');
  const a = heroLook('rookie', SKINS[0]);
  const b = heroLook('rookie', SKINS[1]);
  ok(lookKey(a) !== lookKey(b) && Buffer.from(paintPortrait(a, 'neutral')).toString('base64') !== Buffer.from(paintPortrait(b, 'neutral')).toString('base64'), 'skins repaint the portrait');
}

// ---------------------------------------------------------------- the real game (jsdom)
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

const { Input } = await import('../src/core/input');
const { Game, cheats } = await import('../src/game/game');
const { settings } = await import('../src/game/settings');
const { Vfx } = await import('../src/game/vfx');
const { portraits, blinkAt, hudExpression, portraitTuning, typedChars } = await import('../src/ui/portraits');

// ---------------------------------------------------------------- HUD expressions
{
  const m: HudMood = { dead: false, hp01: 1, sinceHurt: Infinity, won: false, hype: false, tense: false };
  ok(hudExpression(m) === 'neutral', 'calm: neutral');
  ok(hudExpression({ ...m, tense: true }) === 'determined', 'boss up or charging: determined');
  ok(hudExpression({ ...m, tense: true, hype: true }) === 'grinning', 'S rank / big combo: grinning');
  ok(hudExpression({ ...m, hype: true, hp01: 0.2 }) === 'shocked', 'low life beats hype: shocked');
  ok(hudExpression({ ...m, hp01: 0.2, sinceHurt: 0.1 }) === 'hurt', 'just hit: hurt');
  ok(hudExpression({ ...m, sinceHurt: portraitTuning.hurtHold + 0.1 }) === 'neutral', 'the hurt look wears off');
  ok(hudExpression({ ...m, won: true, sinceHurt: 0.1 }) === 'victorious', 'stage clear: victorious');
  ok(hudExpression({ ...m, dead: true, won: true }) === 'hurt', 'down: hurt');
  let closed = 0;
  for (let t = 0; t < 30; t += 0.01) if (blinkAt(t)) closed++;
  ok(closed > 30 && closed < 300, `blinks are brief (${closed}/3000 samples closed)`);
  ok(typedChars('HELLO', 0) === 0 && typedChars('HELLO', 10) === 5 && typedChars('HELLO', 0, true) === 5, 'speech types out (instantly with reduced motion)');
}


const input = new Input(document.getElementById('game') as HTMLCanvasElement);
const game = new Game(input, 16 / 9, document.getElementById('hud')!, document.getElementById('reticle')!);
cheats.unlockAll = true;
cheats.god = true;
const step = (n: number) => {
  for (let i = 0; i < n; i++) {
    game.update(1 / 60);
    if (game.mode === 'levelup') (game as unknown as { ui(a: string, i: number): void }).ui('pick', 0);
  }
};
const bossFight = () => {
  game.startSolo();
  if (game.mode === 'shop') game.closeShop();
  settings.bossIntros = false;
  game.debugBoss({ now: true, mini: false, phase: 0 });
  step(90);
  return game.enemies.list.find((e) => e.active && e.def.boss && !e.def.miniboss) ?? null;
};
const finEl = () => document.getElementById('finisher');

// Host: the killing blow holds, the finisher plays, then the boss dies.
{
  settings.finishers = true;
  const boss = bossFight();
  ok(!!boss, 'test setup: a boss is up');
  if (boss) {
    game.vfx.recording = true;
    game.vfx.drain();
    game.killEnemy(boss, 'buster', game.hero);
    const ev = game.vfx.drain();
    ok(boss.active && game.mode === 'fight', 'the killing blow holds the boss (still active, still fighting)');
    ok(ev.some((e) => e[0] === 'F' && e[1] === boss.def.id && e[2] === 0), 'a team-wide finisher event goes out with the boss and the hero');
    ok(!!finEl() && !finEl()!.hidden, 'the finisher overlay is up');
    const x = boss.x;
    step(30);
    ok(boss.active && boss.x === x, 'the world holds still during the finisher');
    game.killEnemy(boss, 'buster', game.hero);
    ok(boss.active, 'a second kill of the held boss is swallowed');
    step(Math.ceil(finisherLength(false) * 60) + 4);
    ok(!boss.active, 'after the finisher the boss dies');
    ok(game.mode === 'cleared', 'and the stage clears as usual');
  }
}

// Skipping ends it early (host skip releases the hold).
{
  const boss = bossFight();
  if (boss) {
    game.killEnemy(boss, 'buster', game.hero);
    game.renderCharacters(0.45); // the overlay's own clock (render side)
    window.dispatchEvent(new (window as any).KeyboardEvent('keydown', { code: 'Space' }));
    step(Math.ceil(finisherTuning.out * 60) + 3);
    ok(game.mode === 'cleared', 'a skip releases the boss within the exit wipe');
    game.renderCharacters(0.5);
    ok(finEl()!.hidden, 'the overlay is gone after the skip');
  }
}

// Opt-out: no finisher, the boss dies on the spot.
{
  settings.finishers = false;
  const boss = bossFight();
  if (boss) {
    game.killEnemy(boss, 'buster', game.hero);
    ok(!boss.active, 'BOSS FINISHERS off: the boss dies at once');
    step(30);
    ok(game.mode === 'cleared', 'and the stage clears');
  }
  settings.finishers = true;
}

// Mini-bosses don't get a finisher.
{
  game.startSolo();
  if (game.mode === 'shop') game.closeShop();
  game.loadStage(2);
  game.debugBoss({ now: false, mini: true, phase: 0 });
  step(200);
  const mini = game.enemies.list.find((e) => e.active && e.def.miniboss);
  if (mini) {
    game.killEnemy(mini, 'buster', game.hero);
    ok(!mini.active, 'a mini-boss dies at once (no finisher)');
  } else ok(true, 'no mini-boss in this setup (skipped)');
}

// Effects bus: finisher and portrait events survive JSON and replay on a client.
{
  const got: unknown[][] = [];
  const host = new Vfx({ finisher: (...a: unknown[]) => got.push(['F', ...a]), portrait: (...a: unknown[]) => got.push(['P', ...a]) } as any);
  host.recording = true;
  host.finisher('king', 1, 3.456, -2.5);
  host.portrait('hero:1', 'determined', 'CHEST!', 1.8);
  const wire = JSON.parse(JSON.stringify(host.drain()));
  ok(Number.isNaN(Vfx.position(wire[0])[0]) && Number.isNaN(Vfx.position(wire[1])[0]), 'both events are team-wide (not distance-filtered)');
  const seen: unknown[][] = [];
  const client = new Vfx({ finisher: (...a: unknown[]) => seen.push(['F', ...a]), portrait: (...a: unknown[]) => seen.push(['P', ...a]) } as any);
  for (const e of wire) client.apply(e);
  ok(JSON.stringify(seen) === JSON.stringify([['F', 'king', 1, 3.46, -2.5], ['P', 'hero:1', 'determined', 'CHEST!', 1.8]]), 'clients replay the finisher and the pop-in');
}

// Pings pop the pinging player's portrait in; bosses pop in on entrance.
{
  game.startSolo();
  if (game.mode === 'shop') game.closeShop();
  portraits.clear();
  const h = game.hero;
  h.pingAt = -1e9; // pings are rate-limited by wall time
  game.renderCharacters(0); // pop-ins follow the setting
  game.ping(h, h.player.x + 3, h.player.z);
  ok(portraits.showing('hero:0'), `a ping pops the pinger's portrait in (pops on: ${portraits.enabled}, now ${performance.now().toFixed(0)}, last ping ${h.pingAt.toFixed(0)})`);
  game.renderCharacters(1);
  const pop = [...document.querySelectorAll('.pp-pop')].find((el) => !(el as HTMLElement).hidden);
  ok(!!pop && /HERE|CHEST|ELITE|BOSS|PORTAL/.test(pop.querySelector('.pp-tx')?.textContent ?? ''), 'with the ping label in the bubble');
  ok(!!document.getElementById('hudface') && !document.getElementById('hudface')!.hidden, 'the HUD shows the hero face in a run');
  settings.bossIntros = false;
  game.debugBoss({ now: true, mini: false, phase: 0 });
  step(5);
  game.renderCharacters(0.1);
  const boss = game.enemies.list.find((e) => e.active && e.def.boss && !e.def.miniboss);
  ok(!!boss && portraits.showing(`boss:${boss.def.id}`), 'a boss pops in when it arrives');
  settings.portraitPops = false;
  game.renderCharacters(0.1);
  portraits.clear();
  portraits.popIn('announcer', 'grinning', 'GO!');
  ok(!portraits.showing('announcer'), 'CHARACTER POP-INS off: nothing pops in');
  settings.portraitPops = true;
  game.renderCharacters(0.1);
  portraits.popIn('nobody:x', 'neutral', '');
  ok(!portraits.showing('nobody:x'), 'unknown speakers are ignored');
}
