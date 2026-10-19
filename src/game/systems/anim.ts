/**
 * Animation lane: the smart camera's director and cosmetic enemy deaths.
 * Game methods (`this` is the Game), installed on the class as fields.
 * Everything here is cosmetic and runs on every machine from local or synced
 * state; corpses reach clients through the effects bus ('c' events).
 */
import type { Game } from '../game';
import { ENEMIES } from '../../data/enemies';
import { autoZoom, teamFrame, viewBand } from '../animMath';
import { settings } from '../settings';

const mates = new Float64Array(8);
const frame = { x: 0, z: 0, zoom: 1 };

/** Feed the camera rig this frame's auto zoom (swarm size, crowded edges, calm) and co-op framing. */
export function cameraDirector(this: Game): void {
  const cam = this.cam;
  cam.dynamic = settings.dynamicCamera !== false;
  if (this.mode === 'title' || this.mode === 'transition') {
    cam.resetDirector();
    return;
  }
  if (!this.isCombatMode) return; // level-up, shop, game over: hold the current framing
  // Count what the camera sees around the focus (the local hero, or the teammate watched while downed).
  const fx = this.playerPos.x;
  const fz = this.playerPos.z;
  const zoom = cam.zoom; // the wheel zoom only: counting in the auto-zoomed view would feed back on itself
  let near = 0;
  let edge = 0;
  let boss = false;
  for (const e of this.enemies.list) {
    if (!e.active || e.def.hidden || e.state === 'spawning') continue;
    if (e.def.boss) boss = true;
    const band = viewBand(e.x - fx, e.z - fz, zoom);
    if (band === 1) near++;
    else if (band === 2) {
      near++;
      edge++;
    }
  }
  cam.auto = autoZoom(near, edge, boss);
  // Co-op: keep living teammates in view (bounded; further ones keep their edge arrows).
  let n = 0;
  const me = this.hero;
  const watch = me.player.dead && this.heroes.length > 1 ? this.spectateTarget() : null;
  for (const h of this.heroes) {
    if (h === me || h.left || h.player.dead || n >= 4 || h.player === watch) continue;
    const r = h.player.rig.root.position;
    mates[n * 2] = r.x;
    mates[n * 2 + 1] = r.z;
    n++;
  }
  teamFrame(fx, fz, mates, n, frame);
  cam.frameTeam(frame.x, frame.z, frame.zoom);
}

/** An enemy died: fling its body (every machine), and boss kills get the kill-cam. */
export function onCorpse(this: Game, id: string, x: number, y: number, z: number, scale: number, facing: number, dirX: number, dirZ: number): void {
  const def = ENEMIES[id];
  if (!def) return;
  if (!def.hidden) this.enemies.fling(def, x, y, z, scale, facing, dirX, dirZ); // hidden ones (the Titan) have their own view
  if (def.boss) this.cam.killCam(x, z);
}
