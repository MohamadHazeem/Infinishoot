/**
 * Readability lane: keeps every hero findable (merged outline, x-ray through
 * enemies and cover, ground ring in the player colour). Purely cosmetic and
 * derived locally from the heroes every machine already has, so co-op needs
 * no messages. Called from the look pass (systems/look.ts) every rendered frame.
 */
import type * as THREE from 'three';
import type { Game } from '../game';
import { heroMarkerTuning, RigOverlay } from '../../render/rigOverlay';
import { onScreen } from '../../render/lod';

const overlays = new WeakMap<THREE.Object3D, RigOverlay>();

export function updateHeroMarkers(game: Game): void {
  const coop = game.heroes.length > 1;
  for (const h of game.heroes) {
    const root = h.player.rig.root;
    let o = overlays.get(root);
    if (!o) {
      o = new RigOverlay(root);
      overlays.set(root, o);
    }
    const color = coop ? h.color : heroMarkerTuning.soloColor;
    o.detail = !coop || h === game.hero || onScreen(game.cam.camera, root.position.x, 1, root.position.z); // eightp: no outline/x-ray draws for teammates off screen
    o.update(color, !h.player.dead && !h.left && game.mode !== 'title');
  }
}
