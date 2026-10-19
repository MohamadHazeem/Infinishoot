/** Route map: seeded layout, links between layers and the co-op vote (src/game/route.ts). */
import { ok } from './check';
import { routeChoices, routeEdges, routeEventFor, routeLayer, routeTally, routeWindow } from '../src/game/route';
import { ROUTE_EVENTS, ROUTE_NODES } from '../src/data/routeNodes';

// Same seed, same map.
ok(JSON.stringify(routeLayer(42, 3)) === JSON.stringify(routeLayer(42, 3)), 'a layer is the same for the same seed and stage');
let differs = 0;
for (let s = 1; s < 50; s++) if (JSON.stringify(routeLayer(s, 3)) !== JSON.stringify(routeLayer(s + 1000, 3))) differs++;
ok(differs > 25, 'different seeds draw different maps');
ok(routeLayer(7, 1).nodes.length === 1 && routeLayer(7, 1).nodes[0].kind === 'start', 'stage 1 is the start node');

let shapeOk = true;
let choicesOk = true;
let reachOk = true;
const kinds = new Set<string>();
for (let seed = 1; seed <= 200; seed++) {
  for (let stage = 1; stage <= 12; stage++) {
    const a = routeLayer(seed, stage);
    const b = routeLayer(seed, stage + 1);
    if (stage > 1) {
      const ks = a.nodes.map((n) => n.kind);
      if (a.nodes.length < 2 || a.nodes.length > 3 || new Set(ks).size !== ks.length) shapeOk = false;
      if (a.nodes.some((n) => n.col < 0 || n.col > 4 || ROUTE_NODES[n.kind].weight <= 0)) shapeOk = false;
      ks.forEach((k) => kinds.add(k));
    }
    const edges = routeEdges(a, b);
    const reached = new Set(edges.flat());
    if (reached.size !== b.nodes.length) reachOk = false;
    for (let from = 0; from < a.nodes.length; from++) {
      const c = routeChoices(seed, stage, from);
      if (c.length < 2 || c.length > 3 || c.some((j) => j < 0 || j >= b.nodes.length) || new Set(c).size !== c.length) choicesOk = false;
    }
  }
}
ok(shapeOk, 'layers hold 2-3 distinct rollable nodes in columns 0-4');
ok(choicesOk, 'every node offers 2-3 roads to the next stage');
ok(reachOk, 'every node of the next layer can be reached');
ok(['elite', 'shop', 'treasure', 'event', 'rest', 'hard'].every((k) => kinds.has(k)), 'every node kind shows up');

let evOk = true;
for (let s = 0; s < 300; s++) {
  const i = routeEventFor(s, 3);
  if (i < 0 || i >= ROUTE_EVENTS.length) evOk = false;
}
ok(evOk && routeEventFor(9, 4) === routeEventFor(9, 4), 'encounters are seeded and in range');

// Votes: strict majority at once; ties to the host; time-out to the host, else most votes, else the first road.
ok(routeTally([1], 1, 0, false) === 1, 'solo: your pick decides at once');
ok(routeTally([1, -1], 2, 0, false) === -1, 'two players: one vote waits');
ok(routeTally([1, 1], 2, 0, false) === 1, 'two players agree');
ok(routeTally([0, 2], 2, 0, false) === 0, 'tie when everyone voted goes to the host');
ok(routeTally([0, 2], 2, 1, false) === 2, 'the host index decides a tie');
ok(routeTally([-1, 2, 2], 3, 0, false) === 2, 'three players: two agreeing is a majority');
ok(routeTally([-1, 2, 1], 3, 0, false) === -1, 'three players split, one missing: wait');
ok(routeTally([-1, 2, 1], 3, 0, true) === 1, 'time up, host silent: most votes (lowest on a tie)');
ok(routeTally([0, 2, 1], 3, 0, false) === 0, 'three-way split: host decides');
ok(routeTally([1, 2, -1, -1], 4, 0, true) === 1, 'time up: the host pick decides');
ok(routeTally([-1, -1], 2, 0, true) === 0, 'time up, no votes: the first road');
ok(routeTally([-1, 1], 1, 0, false) === 1, 'a player who left does not block the vote');

ok(JSON.stringify(routeWindow(1, 3, 2)) === '[1,2,3,4]' && JSON.stringify(routeWindow(6, 3, 2)) === '[4,5,6,7,8,9]', 'the map shows 3 stages behind and 2 ahead of the choice');
