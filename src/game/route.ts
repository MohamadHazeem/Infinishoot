/**
 * The route map between stages: pure, seeded layout and vote logic (no Game access).
 * Layer s holds the nodes you can pick for stage s (stage 1 is the start). Each layer is rolled
 * from the run seed and its stage alone, so the same seed always draws the same map and clients
 * can rebuild any part of it. Nodes sit in columns 0..4; a node links to the next layer's nodes
 * within two columns (at least two of them when the next layer has two), so each pick offers 2-3 roads.
 */
import { Rng } from '../core/rng';
import { ROLLABLE, ROUTE_EVENTS, ROUTE_NODES, type NodeKind } from '../data/routeNodes';

export interface RouteNode {
  kind: NodeKind;
  /** Column 0..4 (the map's vertical position). */
  col: number;
}

export interface RouteLayer {
  stage: number;
  nodes: RouteNode[];
}

const COLS_2 = [
  [0, 2],
  [1, 3],
  [2, 4],
];

function layerRng(seed: number, stage: number, salt: number): Rng {
  let h = (seed ^ Math.imul(stage + 1, 0x85ebca6b) ^ Math.imul(salt, 0xc2b2ae35)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  return new Rng(h ^ (h >>> 15));
}

/** The nodes for `stage` (stage 1 = the start). `finalEvery`: every n-th stage ends with the final boss. */
export function routeLayer(seed: number, stage: number, finalEvery = 4): RouteLayer {
  if (stage <= 1) return { stage, nodes: [{ kind: 'start', col: 2 }] };
  const rng = layerRng(seed, stage, 1);
  const n = rng.chance(0.55) ? 3 : 2;
  const cols = n === 3 ? [0, 2, 4] : rng.pick(COLS_2);
  const pool = ROLLABLE.slice();
  const weight = (k: NodeKind) => {
    let w = ROUTE_NODES[k].weight;
    // Before the final boss a campfire is more welcome; a Danger Zone less so on stage 2.
    if (stage % finalEvery === 0 && k === 'rest') w *= 2;
    if (stage === 2 && k === 'hard') w *= 0.5;
    return w;
  };
  const nodes: RouteNode[] = [];
  for (const col of cols) {
    let r = rng.next() * pool.reduce((a, k) => a + weight(k), 0);
    let i = 0;
    while (i < pool.length - 1 && (r -= weight(pool[i])) > 0) i++;
    nodes.push({ kind: pool.splice(i, 1)[0], col });
  }
  return { stage, nodes };
}

/** For each node of `a`, the indices of the nodes of `b` (the next layer) it leads to. */
export function routeEdges(a: RouteLayer, b: RouteLayer): number[][] {
  return a.nodes.map((na) => {
    const out: number[] = [];
    b.nodes.forEach((nb, j) => {
      if (Math.abs(na.col - nb.col) <= 2) out.push(j);
    });
    if (out.length < 2 && b.nodes.length >= 2) {
      // Always a real choice: add the nearest other node.
      let best = -1;
      let bd = Infinity;
      b.nodes.forEach((nb, j) => {
        const d = Math.abs(na.col - nb.col);
        if (!out.includes(j) && d < bd) {
          bd = d;
          best = j;
        }
      });
      if (best >= 0) out.push(best);
      out.sort((x, y) => x - y);
    }
    return out;
  });
}

/** Indices into layer `stage + 1` you can pick after clearing `stage` from node `from` of its layer. */
export function routeChoices(seed: number, stage: number, from: number, finalEvery = 4): number[] {
  const a = routeLayer(seed, stage, finalEvery);
  const b = routeLayer(seed, stage + 1, finalEvery);
  return routeEdges(a, b)[Math.min(from, a.nodes.length - 1)] ?? [0];
}

/** Which encounter an Event node on `stage` holds (index into ROUTE_EVENTS). */
export function routeEventFor(seed: number, stage: number): number {
  return Math.floor(layerRng(seed, stage, 7).next() * ROUTE_EVENTS.length);
}

/**
 * Co-op vote. `votes[i]` is player i's option (-1 = none yet), `voters` the players still in,
 * `host` the host's index in `votes`. A strict majority decides at once; when everyone has voted
 * the most votes win (ties go to the host's pick, else the first option); when time runs out the
 * host's pick decides, else the most votes cast, else the first option. -1 = undecided.
 */
export function routeTally(votes: readonly number[], voters: number, host: number, timeUp: boolean): number {
  const counts = new Map<number, number>();
  let cast = 0;
  for (const v of votes) {
    if (v < 0) continue;
    cast++;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  for (const [opt, c] of counts) if (c * 2 > voters) return opt;
  const hostVote = votes[host] ?? -1;
  const plurality = () => {
    let best = -1;
    let bc = 0;
    for (const [opt, c] of counts) if (c > bc || (c === bc && opt < best)) (best = opt), (bc = c);
    const tied = [...counts].filter(([, c]) => c === bc).map(([o]) => o);
    if (tied.length > 1 && tied.includes(hostVote)) return hostVote;
    return best;
  };
  if (cast >= voters && cast > 0) return plurality();
  if (!timeUp) return -1;
  if (hostVote >= 0) return hostVote;
  return cast > 0 ? plurality() : 0;
}

/** Stages the map view draws: a few behind the choice, the choice, and a few ahead. */
export function routeWindow(cleared: number, behind: number, ahead: number): number[] {
  const out: number[] = [];
  for (let s = Math.max(1, cleared - behind + 1); s <= cleared + 1 + ahead; s++) out.push(s);
  return out;
}
