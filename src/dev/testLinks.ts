import { ELITE_MOD_IDS, type EliteModId } from '../data/eliteMods';
import { STAGE_EVENTS, type EventId } from '../data/stageEvents';
import { Rng } from '../core/rng';
import { ENEMIES } from '../data/enemies';
import { cheats, type Game } from '../game/game';
import { settings } from '../game/settings';

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
  return true;
}
