/**
 * The fusion moment (src/data/fusions.ts): Game methods, installed on the
 * class as fields like the other systems.
 */
import type { Game } from '../game';
import type { Hero } from '../hero';
import { FUSION_BY_ID } from '../../data/fusions';
import { showFusionMerge } from '../../ui/fusionUi';

/** Two weapons became one: spiralling sparks in both colours, a flash, the 'fusion' sound and a banner; the fusing player also sees the icons merge. */
export function fusionFx(this: Game, h: Hero, id: string): void {
  const f = FUSION_BY_ID[id];
  if (!f) return;
  const p = h.player;
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    const c = k % 2 ? f.color2 : f.color;
    this.vfx.burst(p.x + Math.cos(a) * 3, 1.2, p.z + Math.sin(a) * 3, { count: 8, color: c, color2: '#ffffff', speed: [2, 6], size: [0.14, 0.3], life: [0.4, 0.8], up: 5, gravity: 8, dir: { x: -Math.cos(a), z: -Math.sin(a), spread: 0.6 } });
  }
  this.vfx.ring(p.x, p.z, 1, 11, f.color, 0.55);
  this.vfx.ring(p.x, p.z, 0.6, 7, f.color2, 0.45);
  this.vfx.ring(p.x, p.z, 0.4, 4, '#ffffff', 0.3);
  this.vfx.star(p.x, 1.4, p.z, 3.2, '#ffffff', 0.25);
  this.vfx.burst(p.x, 1, p.z, { count: 46, color: f.color, color2: f.color2, speed: [4, 12], size: [0.15, 0.38], life: [0.5, 1.1], up: 10, gravity: 10 });
  this.vfx.shake(p.x, p.z, 0.45);
  this.vfx.flash(0.4);
  this.vfx.sound('fusion', NaN, NaN);
  p.happyT = 2.5;
  if (h === this.hero) {
    this.input.rumble(0.5, 1, 600);
    showFusionMerge(f.parts, id);
  } else this.tell(h, { t: 'fusefx', id });
  this.vfx.banner('FUSION!', (this.role === 'solo' ? '' : `${h.name.toUpperCase()}: `) + f.name.toUpperCase(), 2);
}
