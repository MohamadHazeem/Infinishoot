import { ELITE_MOD_IDS, type EliteModId } from '../data/eliteMods';
import { STAGE_EVENTS, type EventId } from '../data/stageEvents';
import { Rng } from '../core/rng';
import { ENEMIES } from '../data/enemies';
import { cheats, type Game } from '../game/game';
import { applySettings, settings } from '../game/settings';
import { lookOverrides } from '../game/systems/look';

/**
 * Test links: open the game straight into a situation, for quick playtests
 * and automated screenshots. Works in every build. Examples:
 *
 *   ?test&stage=4&boss                 stage 4, skip to the boss
 *   ?test&weapons=drones:6,aura:5      drones evolved, Zap Field level 5
 *   ?test&loadout=laser,well,meteor    left click, right click, special
 *   ?test&hero=ace&mode=endless&god    hero, mode, no damage
 *   ?test&elite=charger:shielded       spawn an elite with a modifier
 *   ?test&event=meteors&passives=armor:2,magnet:1&gold=200&seed=42
 *   ?test&spawn=shielder:3,medic:1&golden&time=90   enemies near you, the Goldbug, stage clock
 *   ?test&elite=shooter:fast&zoom=2.2   camera zoomed out (1-2.2)
 *
 * Animation and camera checks (cosmetic, for screenshots):
 *   &move=1,0  hold a move direction     &aim=0,1  hold an aim direction (fires)
 *   &circle    walk in circles           &cam=0.6  camera zoom (below 1 = close-up)
 *   &swarm=200 (or swarm=150:zippy) spawn a ring of enemies around the hero
 *   &killboss=3  kill the boss after 3 s (kill-cam, victory pose)
 *   &clear=3     clear the stage after 3 s (victory pose)
 *   &hurt=1.5    a small hit every 1.5 s (flinch)   &die=3  fall down after 3 s
 *   &frozen      stop enemies moving (close-ups)     &dashes=1  dash every second
 *   ?test&night&quality=high           force a night stage (or &day), pin quality (low|medium|high|auto)
 *   ?test&stage=2&bossnow&phase=2&god  boss right away, pushed into phase 2 (nointro skips the entrance)
 *   ?test&stage=3&miniboss             the stage's mini-boss lands now
 *
 * `?test` alone starts a solo run with the default kit and skips the starting shop.
 */
export function applyTestLink(game: Game, search = location.search): boolean {
  const q = new URLSearchParams(search);
  if (!q.has('test')) return false;
  const list = (k: string) => (q.get(k) ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  const pair = (s: string): [string, number] => {
    const [id, n] = s.split(':');
    return [id, Number(n ?? 1) || 1];
  };
  cheats.unlockAll = true;
  cheats.god = q.has('god');
  const ql = q.get('quality');
  const qi = ql ? ['low', 'medium', 'high', 'auto'].indexOf(ql) : -1;
  if (qi >= 0) {
    settings.graphics = qi;
    applySettings();
  }
  if (q.has('fps')) settings.showFps = true;
  if (q.has('night')) lookOverrides.night = true;
  else if (q.has('day')) lookOverrides.night = false;
  if (q.get('hero')) settings.hero = q.get('hero')!;
  if (q.get('mode')) settings.mode = q.get('mode')!;
  if (q.get('difficulty')) settings.difficulty = q.get('difficulty')!;
  const lo = list('loadout');
  if (lo.length) settings.loadout = { primary: lo[0] ?? settings.loadout.primary, secondary: lo[1] ?? settings.loadout.secondary, special: lo[2] ?? settings.loadout.special };
  game.startSolo();
  if (q.get('seed')) game.rng = new Rng(Number(q.get('seed')));
  // Skip the starting shop.
  if (game.mode === 'shop') game.closeShop();
  const stage = Number(q.get('stage'));
  if (stage > 1) game.loadStage(stage);
  for (const w of list('weapons')) {
    const [id, n] = pair(w);
    for (let i = 0; i < n; i++) game.debugGiveWeapon(id);
  }
  const h = game.hero;
  for (const p of list('passives')) {
    const [id, n] = pair(p);
    h.passives[id] = n;
  }
  h.recomputeStats();
  h.loadoutDirty = true;
  if (q.get('gold')) h.gold = Number(q.get('gold'));
  for (const e of list('elite')) {
    const [id, mod] = e.split(':');
    game.debugSpawnElite(id, (ELITE_MOD_IDS.includes(mod as EliteModId) ? mod : ELITE_MOD_IDS[0]) as EliteModId);
  }
  // Enemies in a ring 9 m out (spawnr=<m>), the Goldbug, and the stage clock (seconds).
  if (q.get('zoom')) game.cam.zoom = Math.max(1, Number(q.get('zoom')));
  if (q.get('time')) game.director.time = Number(q.get('time'));
  const spawns = list('spawn').map(pair);
  const total = spawns.reduce((a, [, n]) => a + n, 0);
  let k = 0;
  for (const [id, n] of spawns) {
    const def = ENEMIES[id];
    for (let i = 0; i < n && def; i++, k++) {
      const a = (k / Math.max(1, total)) * Math.PI * 2;
      const r = Number(q.get('spawnr') ?? 9);
      game.enemies.spawn(def, h.player.x + Math.cos(a) * r, h.player.z + Math.sin(a) * r, game.spawnOpts());
    }
  }
  if (q.has('golden')) game.spawnEnemy(ENEMIES.golden);
  const ev = q.get('event');
  if (ev && STAGE_EVENTS[ev as EventId]) game.runEvents.forceEvent(ev as EventId);
  if (q.has('boss')) game.debugSkipToBoss();
  animLinks(game, q);
  // &screen=settings: open a menu screen on top (for screenshots of menus).
  const scr = q.get('screen');
  if (scr) game.screens.show(scr as Parameters<typeof game.screens.show>[0]);
  // &boom: an explosion near the hero every 0.7 s (checks lights, bloom and shockwaves).
  if (q.has('boom')) {
    let n = 0;
    setInterval(() => {
      if (game.paused) return;
      const p = game.hero.player;
      const a = n++ * 2.4;
      const x = p.x + Math.cos(a) * 5;
      const z = p.z + Math.sin(a) * 4;
      game.vfx.ring(x, z, 1, 10, '#ff7a2f', 0.45);
      game.vfx.star(x, 1.2, z, 3, '#ffb627', 0.2);
      game.vfx.burst(x, 0.6, z, { count: 18, color: '#ffb627', color2: '#ff5e3a', speed: [3, 9], size: [0.2, 0.45], life: [0.3, 0.7], up: 4, gravity: 12 });
    }, 700);
  }
  // Bosses: `bossnow` (boss right away), `phase=2` (push it into a phase), `miniboss`, `nointro`.
  if (q.has('nointro')) settings.bossIntros = false;
  game.debugBoss({ now: q.has('bossnow'), mini: q.has('miniboss'), phase: Number(q.get('phase')) || 0 });
  return true;
}

/** Test-link options for checking animation and the camera (see the header). */
function animLinks(game: Game, q: URLSearchParams): void {
  const vec = (k: string) => (q.get(k) ?? '').split(',').map(Number) as [number, number];
  const v = game.input.virtual;
  if (q.get('move')) {
    const [x, z] = vec('move');
    v.active = true;
    v.move.x = x || 0;
    v.move.y = z || 0;
  }
  if (q.get('aim')) {
    const [x, z] = vec('aim');
    v.active = true;
    v.aim.x = x || 0;
    v.aim.y = z || 0;
  }
  if (q.has('circle')) {
    v.active = true;
    const t0 = performance.now();
    setInterval(() => {
      const a = (performance.now() - t0) / 900;
      v.move.x = Math.cos(a);
      v.move.y = Math.sin(a);
    }, 16);
  }
  if (q.get('dashes')) {
    v.active = true;
    setInterval(() => {
      v.buttons[0] = true;
      setTimeout(() => (v.buttons[0] = false), 50);
    }, (Number(q.get('dashes')) || 1) * 1000);
  }
  if (q.get('cam')) game.cam.zoom = Number(q.get('cam')) || 1;
  if (q.get('swarm')) {
    const [n, id] = (q.get('swarm') ?? '').split(':');
    const def = ENEMIES[id ?? 'swarmer'] ?? ENEMIES.swarmer;
    const p = game.hero.player;
    const count = Math.min(400, Number(n) || 100);
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 * 3;
      const r = 6 + (i / count) * 16;
      game.enemies.spawn(def, p.x + Math.cos(a) * r, p.z + Math.sin(a) * r, { instant: true });
    }
  }
  if (q.has('frozen')) for (const e of game.enemies.list) e.speedMul = 0;
  const later = (k: string, fn: () => void) => {
    if (q.get(k)) setTimeout(fn, (Number(q.get(k)) || 1) * 1000);
  };
  later('killboss', () => {
    const b = game.enemies.list.find((e) => e.active && e.def.boss);
    if (b) game.killEnemy(b, 'buster', game.hero);
  });
  later('clear', () => game.stageClear());
  later('die', () => {
    cheats.god = false;
    const p = game.hero.player;
    p.invuln = 0;
    game.hero.revivesLeft = 0;
    if (p.hurt(p.hp + 1, -p.aim.x, -p.aim.z)) game.onHeroDown(game.hero);
  });
  if (q.get('hurt')) {
    const every = (Number(q.get('hurt')) || 1.5) * 1000;
    setInterval(() => {
      const p = game.hero.player;
      p.invuln = 0;
      p.hurt(1, -p.aim.x, -p.aim.z);
    }, every);
  }
}
