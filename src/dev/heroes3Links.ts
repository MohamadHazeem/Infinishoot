import type { Game } from '../game/game';
import { MinionKind, minionsOf } from '../game/heroes3';

/**
 * Test-link options for the heroes3 lane (Ronin, Tinker), for screenshots:
 *
 *   &hero=ronin&aim=0,-1      the sword swings (a held stick aim fires the left click)
 *   &rank=katana:2:3          take 3 ranks of the katana's track 2 (Sword Waves); any loadout item
 *   &strikego=2               hold right click 0.7 s from 2 s in, then let go (the Ronin's dash-strike)
 *   &beacongo=1               press right click after 1 s (the Tinker's beacon)
 *   &bots=5                   5 bots for your hero at once (any hero)
 *   &ultgo=2, &parrygo=2      (testLinks.ts) Thousand Cuts / Scrap Legion, and the Ronin's counter-slash
 */
export function heroes3Links(game: Game, q: URLSearchParams): void {
  const h = game.hero;
  for (const r of (q.get('rank') ?? '').split(',').filter(Boolean)) {
    const [id, t, n] = r.split(':');
    const w = h.weapons.find((x) => x.def.id === id);
    for (let i = 0; i < (Number(n) || 1); i++) w?.addRank(Number(t) || 0);
    h.loadoutDirty = true;
  }
  const v = game.input.virtual;
  const press = (at: number, hold: number) =>
    setTimeout(() => {
      v.active = true;
      v.buttons[2] = true;
      setTimeout(() => (v.buttons[2] = false), hold * 1000);
    }, at * 1000);
  const sg = Number(q.get('strikego'));
  if (sg > 0) press(sg, 0.7);
  const bg = Number(q.get('beacongo'));
  if (bg > 0) press(bg, 0.1);
  const n = Number(q.get('bots'));
  if (n > 0) {
    const p = h.player;
    const pool = minionsOf(game);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      pool.spawn(h.index, MinionKind.Bot, p.x + Math.cos(a) * 2, p.z + Math.sin(a) * 2);
    }
  }
}
