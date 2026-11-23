import type { Scene, Object3D } from 'three';

/** Keep the flat world scene used by outlines, shadows and culling. Enemy factories
 * add batches here, including ones created lazily on the first spawn of a species. */
export function enemyPhotoSubjects(world: Scene): Scene {
  // A forwarding view avoids an extra Object3D (and its four UUID RNG draws).
  const add = (...objects: Object3D[]) => {
    for (const object of objects) object.userData.photoEnemy = true;
    return world.add(...objects);
  };
  return new Proxy(world, { get: (scene, key) => key === 'add' ? add : Reflect.get(scene, key) });
}

/** Hide only for the photo draw. Restore the original visibility even if the preview
 * is cached or the player closes the studio before the next game frame. */
export class PhotoVisibility {
  private hidden: Object3D[] = [];
  hide(scene: Scene): void {
    for (const o of scene.children) {
      if (o.userData.photoEnemy && o.visible) {
        this.hidden.push(o);
        o.visible = false;
      }
    }
  }
  restore(): void {
    for (const o of this.hidden) o.visible = true;
    this.hidden.length = 0;
  }
}
