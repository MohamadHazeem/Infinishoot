import { ENEMIES } from '../data/enemies';
import { buildKey } from '../data/tracks';
import { syncSub } from '../game/biomeFoes';
import type { Enemy, EnemyState } from '../game/enemies';
import type { Game } from '../game/game';

/**
 * Test-link options for the content lane (biome foes, evolutions, heroes), for
 * screenshots of states that are otherwise hard to catch:
 *
 *   &foe=shark:windup     spawn a ring of 4 (`foe=bee:windup:6` for 6) and pin them in that
 *                         state, aimed at the hero (windup shows the telegraph)
 *   &foe=roller:move:5    a third number pins the biome sub-state (snowball size step, 1 = shark under)
 *   &evo=scatter:1        take a loadout item's evolution (0 or 1; `sp` = the special)
 *   &nolevel              no level-up menus (screenshots)
 *   &rclick=1.2           hold right click, releasing every 1.2 s
 *   &special=2            fire the special after 2 s
 *   &slowmo               run the world at 35% speed (catch short effects in a screenshot)
 */
export function contentLinks(game: Game, q: URLSearchParams): void {
  if (q.has('nolevel')) game.xpNext = 1e12; // no level-up menus in the way of a screenshot
  if (q.get('special')) {
    // Fire the special (Q/E) after `special` seconds.
    setTimeout(
      () => {
        game.hero.bombCharge = 1;
        game.tryBomb(game.hero);
      },
      Number(q.get('special')) * 1000,
    );
  }
  if (q.has('slowmo')) game.slowMoT = 1e6; // the world at 35% speed: short-lived effects are easier to catch
  if (q.get('rclick')) {
    // Hold right click (pad X) for `rclick` seconds, let go briefly, repeat (charge shots fire on release).
    const v = game.input.virtual;
    const hold = Number(q.get('rclick')) * 1000 || 1200;
    v.active = true;
    v.buttons[2] = true;
    setInterval(() => {
      v.buttons[2] = false;
      setTimeout(() => (v.buttons[2] = true), 120);
    }, hold);
  }
  for (const e of (q.get('evo') ?? '').split(',').filter(Boolean)) {
    const [id, k] = e.split(':');
    const h = game.hero;
    const i = Number(k) || 0;
    if (id === 'sp') {
      if (h.specialBuild && h.specialBuild.evo < 0)
        h.setSpecialBuild(buildKey({ ...h.specialBuild, evo: i }));
    } else h.weapons.find((w) => w.def.id === id)?.evolve(i);
    h.loadoutDirty = true;
  }
  const foe = q.get('foe');
  if (foe) {
    const [id, state, a, b] = foe.split(':');
    const def = ENEMIES[id];
    if (!def) return;
    const n = Number(a) || 4;
    const sub = b !== undefined ? Number(b) : NaN;
    const p = game.hero.player;
    const list: Enemy[] = [];
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2 + 0.4;
      list.push(
        game.enemies.spawn(
          def,
          p.x + Math.cos(ang) * 6,
          p.z + Math.sin(ang) * 6,
          game.spawnOpts({ instant: true }),
        ),
      );
    }
    const pin = () => {
      for (const e of list) {
        if (!e.active) continue;
        const dx = p.x - e.x;
        const dz = p.z - e.z;
        const d = Math.hypot(dx, dz) || 1;
        e.state = state as EnemyState;
        e.t = state === 'windup' ? 0.45 : 1;
        e.lungeX = dx / d;
        e.lungeZ = dz / d;
        e.facing = Math.atan2(dx, dz);
        e.targetX = p.x + 1;
        e.targetZ = p.z + 0.5;
        e.timerA = 9;
        if (!Number.isNaN(sub)) {
          e.sub = sub;
          syncSub(e);
        }
      }
    };
    setInterval(pin, 30);
    pin();
  }
}
