export const spatialSettings = { headphones: false };
export const spatialTuning = { hrtfVoices: 12, rearCutoff: 4200 };
/** Cosine behind the hero's facing direction, not just left/right screen position. */
export function rearAmount(dx: number, dz: number, forwardX: number, forwardZ: number): number {
  const length = Math.hypot(dx, dz) * Math.hypot(forwardX, forwardZ);
  return length > 0.001 ? Math.max(0, -(dx * forwardX + dz * forwardZ) / length) : 0;
}
let listenerX = 0, listenerZ = 0, facingX = 0, facingZ = -1;
let hrtfVoices = 0;
const listenerOut = { x: 0, z: 0, fx: 0, fz: -1 };
/** Where the listener is and faces (the local hero), for sounds that move around it (src/audio/surround.ts). */
export function listenerState(): { readonly x: number; readonly z: number; readonly fx: number; readonly fz: number } {
  listenerOut.x = listenerX;
  listenerOut.z = listenerZ;
  listenerOut.fx = facingX;
  listenerOut.fz = facingZ;
  return listenerOut;
}
export function updateListener(ctx: AudioContext | null, x: number, z: number, fx: number, fz: number): void {
  listenerX = x; listenerZ = z;
  const length = Math.hypot(fx, fz);
  if (length > 0.001) { facingX = fx / length; facingZ = fz / length; }
  if (!ctx || !spatialSettings.headphones) return;
  const l = ctx.listener;
  const t = ctx.currentTime;
  l.positionX.setTargetAtTime(x, t, 0.025);
  l.positionY.setTargetAtTime(0, t, 0.025);
  l.positionZ.setTargetAtTime(z, t, 0.025);
  l.forwardX.setTargetAtTime(facingX, t, 0.025);
  l.forwardY.setTargetAtTime(0, t, 0.025);
  l.forwardZ.setTargetAtTime(facingZ, t, 0.025);
  l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
}
/** Only allocated after acquiring a shared sample/synth voice lease. */
export function spatialRoute(ctx: AudioContext, dest: AudioNode, pan: number, x = NaN, z = NaN): { node: AudioNode; rear: number; dispose(): void } {
  const positioned = spatialSettings.headphones && Number.isFinite(x) && Number.isFinite(z);
  const rear = positioned ? rearAmount(x - listenerX, z - listenerZ, facingX, facingZ) : 0;
  if (positioned && hrtfVoices < spatialTuning.hrtfVoices) {
    const node = ctx.createPanner();
    node.panningModel = 'HRTF';
    // The game's existing distance gain owns attenuation, so don't apply it twice.
    node.rolloffFactor = 0;
    node.positionX.value = x; node.positionY.value = 0; node.positionZ.value = z;
    node.connect(dest);
    hrtfVoices++;
    let disposed = false;
    return { node, rear, dispose() {
      if (disposed) return;
      disposed = true;
      node.disconnect();
      hrtfVoices--;
    } };
  }
  const node = ctx.createStereoPanner();
  node.pan.value = Math.max(-1, Math.min(1, pan));
  node.connect(dest);
  return { node, rear, dispose() { node.disconnect(); } };
}
