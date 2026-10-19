import type * as THREE from 'three';

/** A dedicated typed-buffer copy keeps Matrix4.toArray's mixed JS-array / typed-
 * array call sites out of the hot instance loops (and avoids boxed doubles). */
export function instanceMatrix(mesh: THREE.InstancedMesh, index: number, matrix: THREE.Matrix4): void {
  const out = mesh.instanceMatrix.array as Float32Array;
  const elements = matrix.elements;
  const offset = index * 16;
  for (let i = 0; i < 16; i++) out[offset + i] = elements[i];
}

/**
 * Mark only the first `count` instances of an attribute for upload. Without
 * an update range three.js re-uploads the whole buffer (sized for the pool's
 * capacity) every frame, which is the main cost with many big pools.
 */
export function commit(attr: THREE.BufferAttribute, count: number): void {
  attr.clearUpdateRanges();
  attr.addUpdateRange(0, Math.max(1, count) * attr.itemSize);
  attr.needsUpdate = true;
}
