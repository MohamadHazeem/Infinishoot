import * as THREE from 'three';
import type { Input } from '../core/input';
import { cheats, type Game } from '../game/game';
import { Autopilot } from '../game/autopilot';

/**
 * Dev-only autoplay bot for balance and performance testing. Installed on
 * `window` in dev builds:
 *   botRun(seconds, god?)  -> simulate that many seconds headlessly, returns a report
 *                             (per-stage level and loadout ranks, boss kill times,
 *                             first evolution; it resets when a new run starts)
 *   botStep()              -> one simulation step with bot input
 *   botAuto(on)            -> drive the live game loop with bot input (co-op tests:
 *                             works as host or client; clients pick cards and shop
 *                             through the UI messages)
 * The bot kites in a circle, dodges enemy bullets, shoots the boss (or the
 * nearest enemy), holds right click in bursts, dashes when cornered and
 * always picks the first card.
 */
export function installBot(game: Game, input: Input): void {
  const v = new THREE.Vector3();
  // Input internals are private; the bot drives them directly.
  const inp = input as unknown as {
    keys: Set<string>;
    pressed: Set<string>;
    mouseButtons: number;
    mouse: { ndcX: number; ndcY: number };
    device: string;
    poll(): void;
  };

  const pilot = new Autopilot();
  /** Balance tracking across botRun calls, for the current run. */
  const track = { runTime: 0, stage: 1, bossT: -1, bossName: '', bosses: [] as string[], stages: [] as string[], firstEvo: '' };
  const ranksOf = () => {
    const h = game.hero;
    let n = 0;
    let evos = 0;
    for (const b of [...h.weapons.map((w) => w.build), h.specialBuild]) {
      if (!b) continue;
      n += b.ranks.reduce((a, r) => a + r, 0);
      if (b.evo >= 0) evos++;
    }
    return { n, evos };
  };
  const trackStep = () => {
    const g = game;
    if (g.runTime < track.runTime) Object.assign(track, { stage: 1, bossT: -1, bosses: [], stages: [], firstEvo: '' });
    track.runTime = g.runTime;
    const boss = g.enemies.list.find((e) => e.active && e.def.boss);
    if (boss && track.bossT < 0) {
      track.bossT = g.runTime;
      track.bossName = boss.def.name;
    } else if (!boss && track.bossT >= 0) {
      track.bosses.push(`st${track.stage} ${track.bossName} ${Math.round(g.runTime - track.bossT)}s`);
      track.bossT = -1;
    }
    const r = ranksOf();
    if (r.evos && !track.firstEvo) track.firstEvo = `st${g.stage} lv${g.level}`;
    if (g.stage !== track.stage) {
      track.stages.push(`st${track.stage}: lv${g.level} ranks ${r.n} evos ${r.evos}`);
      track.stage = g.stage;
    }
  };
  /** Shop policy: buy affordable Mods left to right while slots remain, then continue. */
  const shop = () => {
    // Buying re-renders the offers, so look the buttons up again after each buy. Skips cursed Mods (Pacifist Core stalls a Buster-only bot).
    for (let k = 0; k < 5; k++) {
      const b = document.querySelector<HTMLElement>('#scr-shop [data-act=buy]:not(.cant):not(.cursed)');
      if (!b) break;
      b.click();
    }
    document.querySelector<HTMLElement>('#scr-shop [data-act=shop-done]')?.click();
    // Route map (and its encounters): take the first road.
    if (game.screens.current === 'route' && game.route.decided < 0) document.querySelector<HTMLElement>('#scr-route [data-ri]')?.click();
  };

  const poll = input.poll.bind(input);
  let uiT = 0;
  /** Sets this step's bot input (keys, mouse, presses) and polls it. The decisions live in src/game/autopilot.ts. */
  const drive = () => {
    const g = game;
    inp.keys.clear();
    const o = pilot.decide(g);
    const l = Math.hypot(o.mx, o.mz) || 1;
    if (Math.abs(o.mx / l) > 0.3) inp.keys.add(o.mx > 0 ? 'KeyD' : 'KeyA');
    if (Math.abs(o.mz / l) > 0.3) inp.keys.add(o.mz > 0 ? 'KeyS' : 'KeyW');
    if (o.target) {
      v.set(o.target.x, 1.05, o.target.z).project(g.cam.camera);
      inp.mouse.ndcX = v.x;
      inp.mouse.ndcY = v.y;
    }
    inp.mouseButtons = o.target ? 1 | (o.charge ? 4 : 0) : 0;
    if (o.dash) inp.pressed.add('Space');
    if (o.special) inp.pressed.add('KeyQ');
    if (o.ult) inp.pressed.add('KeyV');
    if (o.parry) inp.pressed.add('KeyC');
    if (o.cash >= 0) {
      g.hero.play.cashSel = o.cash; // cash in the combo (gameplay lane)
      inp.pressed.add('KeyX');
    }
    // The bot picks the first card straight away (it skips the human pick lock).
    const ui = (g as unknown as { ui(a: string, i: number): void }).ui.bind(g);
    if (g.role === 'client') {
      // Clients answer the host's menus through UI messages; throttled so they don't flood it.
      uiT -= 1 / 60;
      if (uiT <= 0 && g.screens.current === 'levelup') (ui('pick', 0), (uiT = 0.3));
      else if (uiT <= 0 && (g.screens.current === 'shop' || g.screens.current === 'route')) (shop(), (uiT = 0.5));
    } else {
      if (g.mode === 'levelup' && g.hero.needsPick) ui('pick', 0);
      if (g.mode === 'shop') shop();
    }
    poll();
    inp.device = 'kbm';
  };
  const step = () => {
    drive();
    game.update(1 / 60);
  };
  /** Live loop: every poll of the real game loop gets bot input instead. */
  const auto = (on: boolean) => {
    input.poll = on ? drive : poll;
  };

  const run = (seconds: number, god = false) => {
    cheats.god = god;
    const g = game;
    // A hidden tab pauses the game; the bot keeps going.
    if (g.paused) g.resume();
    const n = Math.round(seconds * 60);
    let total = 0;
    let worst = 0;
    let maxAlive = 0;
    let ran = 0;
    const log: string[] = [];
    for (let i = 0; i < n && g.mode !== 'dead' && g.mode !== 'title'; i++) {
      const t = performance.now();
      step();
      trackStep();
      ran++;
      const d = performance.now() - t;
      total += d;
      if (i > 60) worst = Math.max(worst, d);
      maxAlive = Math.max(maxAlive, g.enemies.activeCount);
      if (i % 10 === 0) g.render(1, 1 / 6);
      if (i % 1800 === 0) log.push(`st${g.stage} t=${g.director.time.toFixed(0)} lv=${g.level} kills=${g.kills} alive=${g.enemies.activeCount} hp=${g.player.hp.toFixed(0)}`);
    }
    cheats.god = false;
    return {
      log,
      mode: g.mode,
      stage: g.stage,
      t: Math.round(g.director.time),
      level: g.level,
      kills: g.kills,
      alive: g.enemies.activeCount,
      maxAlive,
      hp: Math.round(g.player.hp),
      weapons: g.hero.weapons.map((w) => w.def.id + w.level).join(' '),
      passives: JSON.stringify(g.hero.passives),
      avgMs: (total / Math.max(1, ran)).toFixed(2),
      worstMs: worst.toFixed(1),
      ranks: ranksOf().n,
      stages: [...track.stages],
      bosses: [...track.bosses],
      firstEvo: track.firstEvo,
    };
  };

  Object.assign(window, { botStep: step, botRun: run, botAuto: auto });
}
