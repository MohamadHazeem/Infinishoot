import { ELITE_MOD_IDS, type EliteModId } from '../data/eliteMods';
import { STAGE_EVENTS, type EventId } from '../data/stageEvents';
import { Rng } from '../core/rng';
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
 *   ?test&night&quality=high           force a night stage (or &day), pin quality (low|medium|high|auto)
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
  const ev = q.get('event');
  if (ev && STAGE_EVENTS[ev as EventId]) game.runEvents.forceEvent(ev as EventId);
  if (q.has('boss')) game.debugSkipToBoss();
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
  return true;
}
