import { ELITE_MOD_IDS, type EliteModId } from '../data/eliteMods';
import { STAGE_EVENTS, type EventId } from '../data/stageEvents';
import { Rng } from '../core/rng';
import { cheats, type Game } from '../game/game';
import { settings } from '../game/settings';
import { OBJECTIVE_KINDS, type ObjectiveKind } from '../game/objectives';

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
 *   ?test&objective=totems&near=totem   force the stage objective, start next to an arena toy
 *     near: pad, turret, pillar, crate, totem, shard, beacon, lava, ice, quicksand, thorns
 *   ?test&stage=4&topple                topple the pillar nearest the hero
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
  const obj = q.get('objective');
  game.toys.force = OBJECTIVE_KINDS.includes(obj as ObjectiveKind) ? (obj as ObjectiveKind) : null;
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
  const near = q.get('near');
  if (near) nearToy(game, near);
  if (q.has('topple')) {
    const p = h.player;
    let best = null as (typeof game.toys.props)[number] | null;
    for (const t of game.toys.props) if (t.alive && t.def.kind === 'pillar' && (!best || Math.hypot(t.def.x - p.x, t.def.z - p.z) < Math.hypot(best.def.x - p.x, best.def.z - p.z))) best = t;
    if (best) game.damageProp(best, 1e6, 0, 0, 1);
  }
  return true;
}

/** Put the hero next to the nearest arena toy or hazard of a kind (a pad: right on it). */
function nearToy(game: Game, kind: string): void {
  const t = game.toys;
  const spots: { x: number; z: number }[] =
    kind === 'pad' ? t.pads
    : kind === 'turret' ? t.turrets
    : kind === 'pillar' || kind === 'crate' ? t.props.filter((p) => (kind === 'pillar' ? p.def.kind === 'pillar' : p.def.kind !== 'pillar')).map((p) => p.def)
    : kind === 'totem' ? t.totems
    : kind === 'shard' ? t.shards
    : kind === 'beacon' ? (t.beacon ? [t.beacon] : [])
    : game.arena.hazards.filter((z) => z.kind === kind);
  const s = spots[0];
  if (!s) return;
  const off = kind === 'pad' ? 0 : kind === 'lava' || kind === 'ice' || kind === 'quicksand' || kind === 'thorns' ? 4.5 : 3;
  game.hero.player.teleport(s.x, s.z + off);
}
