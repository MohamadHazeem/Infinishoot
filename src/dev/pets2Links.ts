/** Posed companion QA without stage banners hiding the little model. No profile writes. */
import { Vector3 } from 'three';
import type { Game } from '../game/game';
import { PETS } from '../data/pets';
import { save } from '../game/save';

export function pets2Links(g: Game, q: URLSearchParams): void {
  if (!q.has('petpose') && !q.has('petwardrobe')) return;
  g.paused = true;
  const style = document.createElement('style');
  style.textContent = '#banner,#toast,#ob-tip,#ob-firstten { display:none!important; }';
  document.head.append(style);
  const s = g.hero.petState;
  if (s.ranks.split) s.extra.splitT = 6;
  if (s.ranks.turret) {
    s.extra.turretT = 7;
    s.extra.turretX = g.hero.player.x + 1.5;
    s.extra.turretZ = g.hero.player.z + 1;
  }
  const p = g.hero.player;
  g.playerPos.set(p.x, 0, p.z);
  g.cam.resetDirector();
  g.cam.update(new Vector3(p.x, 0, p.z), new Vector3(), 1);
  g.hero.petView?.render(1, p.x, p.z, p.rig.root.rotation.y, true, true);
  if (q.has('petwardrobe')) {
    for (const pet of PETS) if (pet.unlock && !save.achievements.includes(pet.unlock)) save.achievements.push(pet.unlock);
    g.screens.show('wardrobe');
  }
}
