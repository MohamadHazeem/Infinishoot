/** Pure encounter rules. Fixed-size fields are shared by the host, view and snapshots. */
export const architectTuning = {
  stage: 12, hp: 450000, coreShare: 0.075, teamHp: 0.65,
  entrance: 3, transition: 2, warning: 1.6, cycle: 8,
  tile: 4, grid: 9, half: 18, orbit: 5.8, orbitSpeed: 0.16,
  bulletSpeed: 6, bulletDamage: 14, pulseEvery: 1.25,
  hazardDamage: 25, fallDamage: 18, desperationAt: 0.1,
  desperationWarn: 2.8, desperationSpeed: 16, hazardCap: 24,
};
export type ArchitectPhase = 1 | 2 | 3;
export interface Danger {
  /** 1 slam, 2 charge/laser, 3 hive, 4 expanding final pulse. */
  kind: number; x: number; z: number; dx: number; dz: number; r: number;
  age: number; warn: number; life: number; hit: number;
}
export function emptyDanger(): Danger { return { kind: 0, x: 0, z: 0, dx: 1, dz: 0, r: 1, age: 0, warn: 0, life: 0, hit: 0 }; }
export class ArchitectState {
  active = false; done = false; sawOmega = false; preview = false;
  uid = 0; phase: ArchitectPhase = 1; time = 0; phaseTime = 0;
  pause = architectTuning.entrance; pattern = 0; cycleTime = 0; pulse = 1;
  core = 0; coreUids = [0, 0, 0]; coreHp = [1, 1, 1];
  rescues = Array.from({ length: 8 }, () => [0, 0, 0]); // revision, safe x, safe z
  hp = 1; desperate = false; desperationDone = false;
  dangers = Array.from({ length: architectTuning.hazardCap }, emptyDanger);
  layout = 0; layoutTime = 0; echo = -1; echoTime = 0;
  /** The echo's locked target; movement never retargets after a warning. */
  tx = 0; tz = 0;
}
export function architectEligible(stage: number, mode: string, pvp: boolean, sawOmega: boolean): boolean {
  return stage === architectTuning.stage && ['standard', 'endless'].includes(mode) && !pvp && sawOmega;
}
/** Fixed at arrival; disconnecting cannot make existing health jump. */
export function architectHp(players: number, difficulty = 1): number {
  const n = Math.max(1, Math.min(8, Math.floor(players) || 1));
  return Math.round(architectTuning.hp * (1 + (n - 1) * architectTuning.teamHp) * Math.max(0.5, difficulty));
}
/** Damage gates discard overkill, including a 10% gate before the compulsory final pulse. */
export function hpGate(phase: number, hp: number, max: number, desperate: boolean): number {
  const floor = phase === 1 ? 0.66 : phase === 2 ? 0.33 : !desperate ? architectTuning.desperationAt : 0;
  return Math.max(max * floor, hp);
}
/** Two layouts: broken corner islands / broken side strips. The central cross is always safe. */
export function missingTile(col: number, row: number, layout: number): boolean {
  if (!layout || Math.abs(col) <= 1 || Math.abs(row) <= 1) return false;
  return layout % 2 === 1 ? Math.abs(col) >= 3 && Math.abs(row) >= 3 : Math.abs(col) === 2;
}
export function tileAt(x: number, z: number, layout: number): boolean {
  if (Math.abs(x) >= architectTuning.half || Math.abs(z) >= architectTuning.half) return false;
  return !missingTile(Math.round(x / 4), Math.round(z / 4), layout);
}
export function corePosition(index: number, time: number, out: { x: number; z: number }): void {
  const a = time * architectTuning.orbitSpeed + index * Math.PI * 2 / 3;
  out.x = Math.cos(a) * architectTuning.orbit;
  out.z = -3 + Math.sin(a) * architectTuning.orbit;
}
export function dangerHits(d: Danger, x: number, z: number, radius = 0.5): boolean {
  const age = d.age - d.warn;
  if (age < 0 || age > d.life) return false;
  if (d.kind === 4) return Math.abs(Math.hypot(x, z + 3) - age * architectTuning.desperationSpeed) < 0.65 + radius;
  const px = x - d.x, pz = z - d.z;
  if (d.kind === 2) {
    const along = px * d.dx + pz * d.dz;
    return Math.abs(along) < 19 + radius && Math.abs(px * -d.dz + pz * d.dx) < d.r + radius;
  }
  return px * px + pz * pz < (d.r + radius) ** 2;
}
/** Only the first living core is open; the body opens once all three are broken. */
export function activeCore(hp: readonly number[]): number {
  for (let i = 0; i < 3; i++) if (hp[i] > 0) return i;
  return 3;
}
export interface ArchitectNet {
  u: number; p: ArchitectPhase; t: number; pt: number; wait: number; hp: number;
  c: number; cu: number[]; ch: number[]; l: number; lt: number; e: number; et: number;
  rs: number[][]; tx: number; tz: number; d: boolean; dd: boolean; done: boolean; preview: boolean; hz: number[][];
}
const r = (n: number) => Math.round(n * 1000) / 1000;
export function packArchitect(s: ArchitectState): ArchitectNet {
  return { u: s.uid, p: s.phase, t: r(s.time), pt: r(s.phaseTime), wait: r(s.pause), hp: r(s.hp), c: s.core,
    cu: [...s.coreUids], ch: s.coreHp.map(r), l: s.layout, lt: r(s.layoutTime), e: s.echo, et: r(s.echoTime),
    rs: s.rescues.map(a => a.map(r)), tx: r(s.tx), tz: r(s.tz), d: s.desperate, dd: s.desperationDone, done: s.done, preview: s.preview,
    hz: s.dangers.filter(d => d.kind).map(d => [d.kind, r(d.x), r(d.z), r(d.dx), r(d.dz), r(d.r), r(d.age), r(d.warn), r(d.life), d.hit]) };
}
export function unpackArchitect(n: ArchitectNet, s: ArchitectState): void {
  s.active = !n.done; s.done = n.done; s.uid = n.u; s.phase = n.p; s.time = n.t; s.phaseTime = n.pt;
  s.pause = n.wait; s.hp = n.hp; s.core = n.c; s.layout = n.l; s.layoutTime = n.lt;
  s.echo = n.e; s.echoTime = n.et; s.tx = n.tx; s.tz = n.tz; s.desperate = n.d; s.desperationDone = n.dd; s.preview = n.preview;
  for (let i = 0; i < 8; i++) for (let j = 0; j < 3; j++) s.rescues[i][j] = n.rs[i][j];
  for (let i = 0; i < 3; i++) { s.coreUids[i] = n.cu[i]; s.coreHp[i] = n.ch[i]; }
  for (let i = 0; i < s.dangers.length; i++) {
    const d = s.dangers[i], a = n.hz[i];
    d.kind = a?.[0] ?? 0;
    if (a) { d.x = a[1]; d.z = a[2]; d.dx = a[3]; d.dz = a[4]; d.r = a[5]; d.age = a[6]; d.warn = a[7]; d.life = a[8]; d.hit = a[9]; }
  }
}
/** Wall poses change only between patterns; no collision during the airborne warning. */
export function wallPose(index: number, layout: number, out: { x: number; z: number; w: number; d: number }): void {
  const horizontal = layout % 2 === 0;
  out.x = (index & 1 ? 1 : -1) * (horizontal ? 8 : 10);
  out.z = (index & 2 ? 1 : -1) * (horizontal ? 10 : 8);
  out.w = horizontal ? 6 : 1.1;
  out.d = horizontal ? 1.1 : 6;
}
