import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Where one tagged prop's triangles ended up in the merged meshes. */
export type MergedRange = { mesh: THREE.Mesh; start: number; count: number };

/**
 * Bake every plain (non-instanced) mesh under `root` into one mesh per
 * material, with world transforms applied. Turns hundreds of static props
 * into a handful of draw calls. Only for scenery that never moves.
 * Meshes under an object with `userData.cover` (any key object) are recorded
 * in `root.userData.coverRanges` (Map<key, MergedRange[]>) so that prop can be
 * hidden later (`hideMergedRanges`).
 */
export function mergeStatic(root: THREE.Group): void {
  root.updateMatrixWorld(true);
  const byMat = new Map<THREE.Material, { geo: THREE.BufferGeometry; tag: unknown }[]>();
  const remove: THREE.Object3D[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || (m as unknown as THREE.InstancedMesh).isInstancedMesh || Array.isArray(m.material)) return;
    const g = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()).applyMatrix4(m.matrixWorld);
    let tag: unknown = undefined;
    for (let a: THREE.Object3D | null = m; a && a !== root && tag === undefined; a = a.parent) tag = a.userData.cover;
    const list = byMat.get(m.material) ?? [];
    list.push({ geo: g, tag });
    byMat.set(m.material, list);
    remove.push(m);
  });
  for (const o of remove) o.removeFromParent();
  const ranges = new Map<unknown, MergedRange[]>();
  // Children of removed meshes were merged too; drop now-empty groups.
  for (const [mat, items] of byMat) {
    const geos = items.map((i) => i.geo);
    // Attributes must match to merge: keep only those every geometry has.
    const names = Object.keys(geos[0].attributes).filter((n) => geos.every((g) => g.getAttribute(n)));
    for (const g of geos) for (const n of Object.keys(g.attributes)) if (!names.includes(n)) g.deleteAttribute(n);
    const counts = geos.map((g) => g.getAttribute('position').count);
    const merged = mergeGeometries(geos);
    for (const g of geos) g.dispose();
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mat);
    root.add(mesh);
    let start = 0;
    items.forEach((it, k) => {
      if (it.tag !== undefined) {
        const r = ranges.get(it.tag) ?? [];
        r.push({ mesh, start, count: counts[k] });
        ranges.set(it.tag, r);
      }
      start += counts[k];
    });
  }
  if (ranges.size) root.userData.coverRanges = ranges;
}

/** Collapse a merged prop's triangles to a point under the ground so it disappears. */
export function hideMergedRanges(list: MergedRange[]): void {
  for (const r of list) {
    const pos = r.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const a = pos.array as Float32Array;
    for (let i = r.start * 3, end = (r.start + r.count) * 3; i < end; i += 3) {
      a[i] = 0;
      a[i + 1] = -50;
      a[i + 2] = 0;
    }
    pos.addUpdateRange(r.start * 3, r.count * 3);
    pos.needsUpdate = true;
  }
}
