// Stamina starts with the base charge in Stats. Dash Cells still add one each.
export const handsTuning = {
  basePips: 3,
  slideTime: 0.24,
  slideSpeed: 1.55,
  hoverTime: 0.44, // from takeoff, including the dash
  hoverHeight: 0.55,
  bounceTail: 0.09,
  // Only the first six frames of the original 160 ms swing can catch a hit.
  // The Gate 2 pilot still anticipates the whole swing plus its reaction delay.
  parryActiveFraction: 0.625,
  parryHeal: 4,
  // Extra gold chance on ordinary kills, before the director's drop thinning.
  styleGold: [0, 0, 0, 0.001, 0.002, 0.003],
};

export function hoverClears(cause: string | undefined): boolean {
  return cause === 'Lava' || cause === 'Burning ground' || cause === 'Lava Slug';
}
