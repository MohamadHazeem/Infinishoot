import { ELITE_MOD_IDS, type EliteModId } from '../data/eliteMods';
import { STAGE_EVENTS, type EventId } from '../data/stageEvents';
import { Rng } from '../core/rng';
import { cheats, type Game } from '../game/game';
import { settings } from '../game/settings';
import { ENEMIES } from '../data/enemies';
import { STYLE_RANKS, styleTuning } from '../game/style';
import { Team } from '../game/bullets';

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
 *   ?test&hero=bulwark&ultgo=2&god      ultimate charged, fired after 2 s (`ult` only charges it)
 *   ?test&style=S&spawn=shooter:6       style rank; enemies in a ring 7 m around you
 *   ?test&parrygo=2 / &dashgo=2         a parry / a perfect dash after 2 s (for screenshots)
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
  if (q.get('hero')) {
    settings.hero = q.get('hero')!;
    game.applyLocalSkin(); // the hero was made before the link was read
  }
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
  // Skill layer (src/game/systems/skill.ts).
  for (const e of list('spawn')) {
    const [id, n] = pair(e);
    const def = ENEMIES[id];
    if (!def) continue;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      game.enemies.spawn(def, h.player.x + Math.cos(a) * 7, h.player.z + Math.sin(a) * 7, game.spawnOpts());
    }
  }
  const rank = STYLE_RANKS.indexOf((q.get('style') ?? '').toUpperCase() as (typeof STYLE_RANKS)[number]);
  if (rank >= 0) {
    const t = styleTuning.thresholds;
    h.skill.style.add(t[rank] + ((t[rank + 1] ?? styleTuning.cap) - t[rank]) * 0.9, 'TEST LINK');
  }
  if (q.has('ult') || q.has('ultgo')) h.skill.ult = 1;
  const go = Number(q.get('ultgo'));
  if (go > 0) setTimeout(() => game.tryUlt(game.hero), go * 1000);
  // `parrygo=<s>`: a ring of enemy bullets closes in and gets parried; `dashgo=<s>`: one flies at you as you dash (perfect).
  const shootAt = (d: number, n: number) => {
    const p = game.hero.player;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      game.bullets.spawn({ x: p.x + Math.cos(a) * d, z: p.z + Math.sin(a) * d, dirX: -Math.cos(a), dirZ: -Math.sin(a), speed: 12, life: 3, radius: 0.26, damage: 10, knockback: 6, team: Team.Enemy, color: '#ff3df0', width: 0.5, length: 0.5 });
    }
  };
  const pg = Number(q.get('parrygo'));
  if (pg > 0) setTimeout(() => (shootAt(1.5, 8), game.tryParry(game.hero)), pg * 1000);
  const dg = Number(q.get('dashgo'));
  if (dg > 0) setTimeout(() => (shootAt(2.2, 1), game.onDash(game.hero)), dg * 1000);
  return true;
}
