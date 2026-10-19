/** Readable chaos: local presentation only; host simulation and effects recording stay untouched. */
import * as THREE from 'three';
import type { Game } from '../game';
import { noiseFor, readableMaterial } from '../../render/noiseGovernor';
import { gfxPostUniforms } from '../../render/graphicsPost';
import { reduceMotion } from '../../ui/hud';

interface Markers { hero: THREE.Mesh }
const markers = new WeakMap<Game, Markers>();
let styled = false;
function clarityCss(): void {
  if (styled) return;
  styled = true;
  const style = document.createElement('style');
  style.textContent = `
    .readable-chaos #banner { top: calc(24 * var(--p)); left: auto; right: calc(8 * var(--p)); max-width: calc(100 * var(--p)); text-align: right; }
    .readable-chaos #banner.show { animation: none; }
    .readable-chaos #banner .t { font-size: calc(12 * var(--p)); text-shadow: var(--outline); }
    .readable-chaos #banner .s { margin-top: calc(2 * var(--p)); padding: calc(2 * var(--p)) calc(4 * var(--p)); font-size: calc(6 * var(--p)); }
  `;
  document.head.appendChild(style);
}
function markersFor(g: Game): Markers {
  let s = markers.get(g);
  if (s) return s;
  const hero = new THREE.Mesh(new THREE.RingGeometry(0.78, 0.9, 24).rotateX(-Math.PI / 2), readableMaterial('#73eff7'));
  const rim = new THREE.Mesh(new THREE.RingGeometry(0.71, 0.97, 24).rotateX(-Math.PI / 2), readableMaterial('#1a1c2c'));
  rim.renderOrder = 89;
  hero.renderOrder = 90;
  hero.add(rim);
  g.scene.add(hero);
  s = { hero };
  markers.set(g, s);
  return s;
}

export function beginReadability(this: Game, dt: number): void {
  clarityCss();
  const noise = noiseFor(this.scene);
  const p = this.hero.player;
  noise.begin(dt, this.enemies.activeCount, this.bullets.count, this.heroes.length, p.x, p.z, reduceMotion());
  this.dmg.noise = this.juice.noise = this.hud.noise = noise;
  document.body.classList.toggle('readable-chaos', this.isCombatMode && noise.pressure >= 0.45);
}

export function renderReadability(this: Game): void {
  const noise = noiseFor(this.scene);
  const s = markersFor(this);
  const p = this.hero.player;
  s.hero.visible = this.isCombatMode && !p.dead;
  s.hero.position.set(p.rig.root.position.x, 0.09, p.rig.root.position.z);
  (s.hero.material as THREE.ShaderMaterial).uniforms.uColor.value.set(this.heroes.length > 1 ? this.hero.color : '#73eff7');
  // Anime impact frames share the screen-flash ceiling. Do not spend admission every held frame.
  gfxPostUniforms.uImpact.value.x = Math.min(gfxPostUniforms.uImpact.value.x, noise.calm ? 0 : noise.flashCap);
}
