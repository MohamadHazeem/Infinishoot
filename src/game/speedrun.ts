import { loadJson, saveJson } from '../core/storage';
import { currentWeek, speedSeed, linkSplit, ReplayChain } from '../../server/leaderboard/mastery/speedrunProtocol.js';
import type { ReplayFile } from '../dev/replay';
import { shareReplay } from '../net/telemetryReport';
import { onlineServer } from '../net/onlineServer';
import { GhostRecorder, GhostEv, ghostCode, readGhostCodeSync } from './modes/ghost';
import type { Game } from './game';
import { replayHash } from './systems/ci2';
import { ModesView } from '../render/modesView';

export { currentWeek, speedSeed };
export interface Split { ms: number; tick: number; state: number; link: number }
interface Best { week: string; ms: number; splits: number[]; code: string }
const key = 'speedrun.best.v1';
export function speedBest(week = currentWeek()): Best | null {
  const r = loadJson<Best | null>(key,null);
  return r && r.week === week && Number.isSafeInteger(r.ms) && r.ms > 0 && r.ms <= 3600000 &&
    Array.isArray(r.splits) && r.splits.length === 8 && r.splits.every((n,i) => Number.isSafeInteger(n) && n > (r.splits[i-1] ?? 0)) &&
    r.splits[7] === r.ms && typeof r.code === 'string' && r.code.length <= 800000 ? r : null;
}
export function clockText(ms: number) {
  const tenths = Math.floor(ms / 100);
  return Math.floor(tenths / 600) + ':' + String(Math.floor(tenths / 10) % 60).padStart(2,'0') + '.' + tenths % 10;
}
export class SpeedAttempt {
  readonly week = currentWeek();
  readonly seed = speedSeed(this.week);
  readonly splits: Split[] = [];
  private recorder = new GhostRecorder(this.week, '', 'rookie');
  readonly best = speedBest(this.week);
  readonly rival = this.best && readGhostCodeSync(this.best.code);
  private stage = 0;
  private startStep: number;
  clock = 0;
  constructor(g: Game) { this.startStep = g.stepN; }
  step(g: Game, dt: number) {
    if (g.player.dead || this.splits.length === 8) return;
    this.clock += dt;
    if (this.stage !== g.stage) {
      this.stage = g.stage;
      this.recorder.event(this.clock,GhostEv.StageStart,g.stage);
    }
    const p = g.player;
    this.recorder.step(this.clock,p.x,p.z,Math.atan2(p.aim.x,p.aim.z),g.score,g.stage);
  }
  split(g: Game, bossDown: boolean) {
    const index = (g.stage - 1) * 2 + Number(bossDown);
    if (this.splits.length !== index || index >= 8) return;
    const ms = Math.round(this.clock*1000), tick = g.stepN-this.startStep, state = replayHash(g);
    this.splits.push({ms,tick,state,link:linkSplit(this.splits.at(-1)?.link ?? this.seed,index,ms,tick,state)});
  }
  render(g: Game, dt: number) {
    if (!this.rival) return;
    const view = g.modes.view ??= new ModesView(g.scene);
    const pose = view.ghostPose(this.rival,this.clock);
    view.renderGhost(g.isCombatMode && pose.visible && pose.stage === g.stage ? pose : null,dt);
  }
  saveBest(g: Game): boolean {
    const ms = this.splits[7]?.ms;
    if (!ms || ms > 3600000 || (speedBest(this.week)?.ms ?? Infinity) <= ms) return false;
    const ghost = this.recorder.finish(g.score,g.stage,this.clock);
    saveJson(key,{week:this.week,ms,splits:this.splits.map(s=>s.ms),code:ghostCode(ghost)});
    return true;
  }
  async submit(file: ReplayFile): Promise<boolean> {
    if (!onlineServer || !file.header || file.header.seed !== this.seed || this.splits.length !== 8) return false;
    const body = await packSpeedrun(this.week,this.splits,file);
    if (body.size > 16*1024*1024) return false;
    return (await fetch(onlineServer+'/speedrun',{method:'POST',body,credentials:'omit'})).ok;
  }
}
/** A line-delimited gzip tape keeps multi-million-value runs off the JSON string size ceiling.
 * Only the shareable projection enters the archive. Original inputs, render events and
 * once-per-second simulation hashes retain their existing replay format and order. */
export async function packSpeedrun(week: string, splits: Split[], file: ReplayFile) {
  const {data,strings,...replay} = shareReplay(file);
  const chain = new ReplayChain(speedSeed(week),replay.header.keys.length,strings.length);
  for (const chunk of data) chain.chunk(chunk);
  const tapeChain = chain.finish(replay.steps,replay.hash!);
  const head = {format:1,tapeChain,week,seed:speedSeed(week),ms:splits.at(-1)!.ms,chain:splits.at(-1)!.link,splits,replay};
  const enc = new TextEncoder();
  let line = -2;
  const stream = new ReadableStream<Uint8Array<ArrayBuffer>>({
    pull(controller) {
      if (line === data.length) { controller.close(); return; }
      controller.enqueue(enc.encode(JSON.stringify(line === -2 ? head : line === -1 ? strings : data[line])+'\n'));
      line++;
    },
  }).pipeThrough(new CompressionStream('gzip'));
  const bytes = await new Response(stream).arrayBuffer();
  const hash = await crypto.subtle.digest('SHA-256',bytes);
  return new Blob([Array.from(new Uint8Array(hash),v=>v.toString(16).padStart(2,'0')).join(''),bytes],{type:'application/octet-stream'});
}
