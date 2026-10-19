import type { Game } from '../game/game';
import { settings } from '../game/settings';
import { materialHit } from '../game/particles';
import { RARITY, type Rarity } from '../data/rarity';
import { CinematicCamera } from '../render/cinematicCamera';

/** Unsaved visual fixtures. Regular play never installs timers or overrides. */
export function gfx3Links(g: Game, q: URLSearchParams): void {
  if (q.has('shadows')) settings.dynamicShadows = q.get('shadows') !== '0';
  const fx = q.get('gfx3');
  if (fx) {
    const emit = () => {
      const p = g.hero.player, x = p.x + 3, z = p.z;
      if (fx === 'level' || fx === 'evolution') g.vfx.burst(x, 0.2, z, { flourish: fx, count: 18, color: fx === 'level' ? '#73eff7' : '#ffcd75', color2: '#f4f4f4', speed: [1, 3], size: [0.1, 0.2], life: [0.5, 0.8], up: 7, gravity: 5 });
      else if (fx === 'hits') {
        const materials = ['metal', 'slime', 'stone'] as const;
        materials.forEach((m, i) => g.vfx.burst(p.x - 3 + i * 3, 1, p.z - 3, materialHit(m, m === 'slime' ? '#38b764' : '#94b0c2')));
      } else if (fx === 'chest') {
        const rarity = q.get('rarity') as Rarity;
        g.vfx.burst(x, 0.4, z, { flourish: 'chest', count: 18, color: (RARITY[rarity] ?? RARITY.rare).color, speed: [2, 5], size: [0.12, 0.24], life: [0.4, 0.8], up: 6, gravity: 12 });
      } else if (fx === 'explosion') g.vfx.burst(x, 0.5, z, { count: 20, color: '#ef7d57', color2: '#ffcd75', speed: [4, 8], size: [0.15, 0.3], life: [0.4, 0.7], up: 6, gravity: 14, smoke: 8, debris: 6 });
    };
    setInterval(emit, fx === 'hits' ? 250 : 1100);
  }
  if (q.has('gfx3camera')) {
    const p = g.hero.player, camera = new CinematicCamera(g.cam.camera);
    camera.play([
      { time: 0, position: [p.x + 9, 7, p.z + 10], target: [p.x, 1, p.z], fov: 45 },
      { time: 5, position: [p.x - 7, 4, p.z + 8], target: [p.x, 1, p.z], fov: 40 },
    ]);
    const render = g.render.bind(g);
    g.render = (a, dt) => { render(a, dt); camera.seek(Number(q.get('gfx3camera')) || 2.5, settings.reduceScreenEffects); };
  }
}
