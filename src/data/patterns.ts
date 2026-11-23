/** The enemy team's three silhouette bits on both bullet wires. Zero is the ordinary gem. */
export const Shot = { Plain: 0, Delayed: 1, Bounce: 2, Curve: 3, Split: 4, Return: 5 } as const;
export type ShotKind = (typeof Shot)[keyof typeof Shot];
// Entries 24..28 follow the existing player, mech and relic entries in BULLET_KINDS.
export function enemyKind(shape = 0): number {
  return shape >= Shot.Delayed && shape <= Shot.Return ? 23 + shape : 0;
}
export type ShotFamily = 'blaster' | 'burst' | 'spiral' | 'marksman';

export const patternTuning = {
  hang: 0.8,
  splitAt: 0.85,
  forkAngle: 0.48,
  curveRate: 0.85,
  turnAt: 0.85,
  returnBrake: 0.6,
  minRange: 4,
  shotInterval: 2.5,
  splitSpeed: 6.5,
  maxSpeed: 11,
  life: 3.2,
};

export function shotFor(stage: number, family: ShotFamily | undefined): ShotKind {
  switch (family) {
    case 'blaster':
      return stage >= 7 ? Shot.Split : Shot.Delayed;
    case 'burst':
      return stage >= 3 ? Shot.Bounce : Shot.Plain;
    case 'spiral':
      return stage >= 5 ? Shot.Curve : Shot.Plain;
    case 'marksman':
      return stage >= 9 ? Shot.Return : Shot.Plain;
    default:
      return Shot.Plain;
  }
}

export const Zone = { Pool: 1, Mine: 2, Wall: 3, Ring: 4 } as const;
export type ZoneKind = (typeof Zone)[keyof typeof Zone];
export const zoneTuning = {
  cap: 2,
  interval: 6,
  tell: [0, 1.2, 1.6, 1.4, 1.4],
  duration: [0, 3.2, 0.28, 3, 2.6],
  poolR: 2,
  mineR: 2.35,
  wallHalf: 6.5,
  gapHalf: 1.65,
  sweep: 3,
  band: 0.28,
  ringR: 6.3,
};
export function zoneFor(stage: number): ZoneKind | 0 {
  return stage < 2
    ? 0
    : stage < 4
      ? Zone.Pool
      : stage < 6
        ? Zone.Mine
        : stage < 8
          ? Zone.Wall
          : Zone.Ring;
}
