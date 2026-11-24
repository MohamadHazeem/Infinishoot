import { cheats, type Game } from '../game/game';
import { replayHash } from '../game/systems/ci2';
import { boardId, leaderboardEnabled } from '../net/leaderboard';
import { weeklyChallenge } from '../data/weekly';
import { gauntletScore } from '../data/ascension';
import { challengeState } from '../game/systems/gauntlet';
import { modSession } from '../mods/manager';
import { firstLink, checksum, MAX_ROWS, PERIOD } from '../../server/leaderboard/protocol/replayChain.js';

export class ScoreReplay {
  readonly format = 1;
  readonly rows: number[][] = [];
  constructor(readonly board: string, readonly build: string, readonly hero: string, readonly seed: number) {}
  record(fields: number[]): void {
    const previous = this.rows.at(-1)?.at(-1) ?? firstLink(this.board, this.build, this.hero, this.seed);
    fields.push(checksum(previous, fields));
    this.rows.push(fields);
  }
}
interface Recording { tape: ScoreReplay; next: number }
const active = new WeakMap<Game, Recording>();
function capture(g: Game, tape: ScoreReplay): void {
  const p = g.hero.player;
  const challenge = g.runMode === 'gauntlet' || g.runMode === 'bossrush';
  const seconds = challenge ? challengeState(g).time : g.runMode === 'raid' ? g.raidNet()?.time ?? g.runTime : g.runTime;
  const score = g.runMode === 'gauntlet' ? gauntletScore(seconds, g.kills) : g.runMode === 'raid' ? g.score : g.score * g.meta.multiplier;
  tape.record([Math.round(g.runTime * 1000), Math.round(seconds * 1000), g.stage, Math.floor(score), g.kills,
    Math.round(p.pos.x * 10), Math.round(p.pos.z * 10), Math.round(p.hp * 10), replayHash(g)]);
}
export function beginScoreReplay(g: Game): void {
  active.delete(g);
  if (!leaderboardEnabled || g.role === 'client' || g.squadRun || modSession.count || g.pvp || cheats.god || cheats.unlockAll) return;
  const board = g.meta.week ? weeklyChallenge(g.meta.week).board : boardId(g.runMode, g.difficulty.id, g.runDate);
  const tape = new ScoreReplay(board, __APP_VERSION__, g.hero.heroDef.id, g.seed);
  capture(g, tape);
  active.set(g, { tape, next: PERIOD });
}
export function sampleScoreReplay(g: Game): void {
  const r = active.get(g);
  if (r && (cheats.god || cheats.unlockAll)) { active.delete(g); return; }
  if (!r || g.runTime * 1000 < r.next) return;
  if (r.tape.rows.length >= MAX_ROWS - 1) { active.delete(g); return; }
  capture(g, r.tape);
  r.next += PERIOD;
}
export function finishScoreReplay(g: Game): ScoreReplay | undefined {
  const r = active.get(g);
  active.delete(g);
  if (!r || cheats.god || cheats.unlockAll) return;
  capture(g, r.tape);
  return r.tape;
}
