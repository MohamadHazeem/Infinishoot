import * as THREE from 'three';
import type { Game } from '../game';
import { settings, access } from '../settings';
import { DynamicShadows, shadowTuning, shadowsEnabled } from '../../render/shadows';
import { retroGlobals } from '../../render/retroMaterial';
import { renderQuality } from '../../render/quality';
import { muzzleProfile, muzzleGeometry } from '../fx';

interface State { shadows: DynamicShadows; arena: unknown; heroes: WeakSet<THREE.Object3D> }
const states = new WeakMap<Game, State>();

/** Called after all poses are drawn. No gameplay or wire state belongs here. */
export function renderGfx3(g: Game): void {
  let s = states.get(g);
  const enabled = shadowsEnabled(settings.dynamicShadows, renderQuality.level);
  if (!s && !enabled) return; // no shadow resources until explicitly requested on HIGH
  if (!s) { s = { shadows: new DynamicShadows(g.scene), arena: null, heroes: new WeakSet() }; states.set(g, s); }
  if (enabled) {
    for (const h of g.heroes) {
      const root = h.player.rig.root;
      if (s.heroes.has(root)) continue;
      root.traverse(o => {
        const m = o as THREE.Mesh;
        if (m.isMesh && !Array.isArray(m.material) && (m.material as THREE.ShaderMaterial).uniforms?.uSunDir && !m.material.transparent) m.castShadow = true;
      });
      s.heroes.add(root);
    }
    if (s.arena !== g.arena) {
      s.arena = g.arena;
      let batches = 0;
      // Props are already merged by material. Ground/sea and under-island geometry never cast.
      g.arena.group.traverse(o => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || Array.isArray(m.material) || m.material.transparent) return;
        m.geometry.computeBoundingBox();
        const b = m.geometry.boundingBox;
        m.castShadow = !!b && b.max.y > 1 && b.min.y >= -0.5 && batches < shadowTuning.propBatches;
        if (m.castShadow) batches++;
      });
    }
  }
  s.shadows.update(enabled, g.playerPos.x, g.playerPos.z, retroGlobals.uSunDir.value);
}

/** The existing four hero flash meshes are reused, including on snapshot clients. */
export function styleMuzzles(g: Game): void {
  for (let i = 0; i < g.flashes.length; i++) {
    const m = g.flashes[i], h = g.heroes[i];
    if (!m.visible || !h) continue;
    let weapon = h.weapons[0];
    for (const w of h.weapons) if (w.muzzleT > (weapon?.muzzleT ?? 0)) weapon = w;
    if (!weapon) continue;
    const profile = muzzleProfile(weapon.def.id, weapon.tags);
    const geo = muzzleGeometry(profile.family);
    const mat = m.material as THREE.MeshBasicMaterial;
    if (m.geometry !== geo) {
      if (!m.userData.gfx3Geometry) m.geometry.dispose();
      m.geometry = geo; m.userData.gfx3Geometry = true;
      mat.color.set(profile.color);
    }
    if (profile.family === 'spread' || profile.family === 'arc') {
      // Flat stars face the viewer and sit clear of the cannon instead of hiding inside it.
      m.quaternion.copy(g.cam.camera.quaternion);
      m.position.x += h.player.aim.x * 0.22;
      m.position.z += h.player.aim.z * 0.22;
      m.position.y += 0.12;
    } else m.rotation.set(0, Math.atan2(h.player.aim.x, h.player.aim.z), 0);
    const calm = access.reduceFlash || settings.reduceScreenEffects || !!g.juice.noise?.calm;
    const size = g.muzzleScale(h) * (calm ? 0.45 : 1) * (renderQuality.level <= 1 ? 0.75 : 1);
    m.scale.set(size * profile.width, size * profile.width, size * profile.length);
  }
}
