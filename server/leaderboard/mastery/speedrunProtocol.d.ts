export function speedSeed(week: string): number;
export function linkSplit(
  previous: number,
  index: number,
  ms: number,
  tick: number,
  state: number,
): number;
export function currentWeek(now?: number): string;
export class ReplayChain {
  constructor(seed: number, keyCount: number, stringCount: number);
  chunk(values: number[]): void;
  finish(steps: number, terminal: number): number;
}
