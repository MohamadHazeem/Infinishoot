/**
 * Spectate lane, pure rules (src/game/spectate.ts): seat choice, follow cycling,
 * free camera clamp, the auto director's scores and cuts.
 */
import { ok } from './check';
import { AutoDirector, clampView, cycleFollow, directorScore, seatFor, slotOpen, spectateTuning, watchingText, type DirectorInput } from '../src/game/spectate';

// ---- Seats
const seat = (o: Partial<Parameters<typeof seatFor>[0]>) => seatFor({ asked: false, allowed: true, wasSpectator: false, full: false, closed: false, reclaim: false, ...o });
ok(seat({}) === null, 'a free lobby: you join as a player');
ok(seat({ asked: true }) === 'chosen', 'JOIN AS SPECTATOR always spectates');
ok(seat({ full: true }) === 'full', 'a full game makes you a spectator');
ok(seat({ closed: true }) === 'closed', 'a run closed to new players makes you a spectator');
ok(seat({ full: true, reclaim: true }) === null, "a player coming back to their own hero isn't turned into a spectator");
ok(seat({ wasSpectator: true }) === 'back', 'a spectator who reconnects keeps watching');
ok(seat({ asked: true, allowed: false }) === null && seat({ full: true, allowed: false }) === null, 'host setting SPECTATORS off: the old rules');
ok(slotOpen(3) && !slotOpen(4) && slotOpen(1, 2) && !slotOpen(2, 2), 'slot rule: fewer than 4 players');
ok(spectateTuning.max === 8 && spectateTuning.snapEvery === 2, 'up to 8 spectators at half the snapshot rate');

// ---- Following
ok(cycleFollow(0, [true, true, true], 1) === 1 && cycleFollow(2, [true, true, true], 1) === 0, 'next wraps around');
ok(cycleFollow(0, [true, false, true], 1) === 2, 'skips a downed hero');
ok(cycleFollow(0, [true, true, false], -1) === 1, 'previous wraps backwards past a downed one');
ok(cycleFollow(1, [false, false, false], 1) === 1, 'nobody to watch: stays put');
ok(cycleFollow(0, [], 1) === 0, 'no heroes: no change');
ok(clampView(999, 55) === 55 - spectateTuning.freeEdge && clampView(-999, 55) === -(55 - spectateTuning.freeEdge) && clampView(3, 55) === 3, 'free camera stays inside the arena');
ok(watchingText(0) === '' && watchingText(3) === '3 WATCHING', 'badge text');

// ---- Director scores
const base: DirectorInput = { alive: true, hp01: 1, bossDist: Infinity, crowd: 0, rank: 0, ult: false, hurt: false };
const sc = (o: Partial<DirectorInput>) => directorScore({ ...base, ...o });
ok(sc({ alive: false }) === -Infinity, "a downed hero can't be watched");
ok(sc({ bossDist: 5 }) > sc({}) + 3, 'next to the boss is the show');
ok(sc({ bossDist: 5 }) > sc({ bossDist: 20 }), 'closer to the boss scores more');
ok(sc({ hp01: 0.1 }) > sc({ hp01: 0.5 }) && sc({ hp01: 0.5 }) === sc({}), 'low life is exciting, half life is not');
ok(sc({ crowd: 24 }) > sc({ crowd: 4 }) && sc({ crowd: 240 }) === sc({ crowd: 24 }), 'crowds score, capped');
ok(sc({ rank: 5 }) > sc({ rank: 2 }) && sc({ ult: true }) > sc({}), 'style rank and ultimates score');

// ---- Director cuts
const d = new AutoDirector();
ok(d.step(0.016, [1, 2, 1]) === 1 && d.cuts === 1, 'starts on the most exciting hero');
ok(d.step(1, [1, 9, 1]) === 1, 'holds the shot');
let pick = 1;
for (let i = 0; i < 60; i++) pick = d.step(0.04, [9, 1, 1]); // 1 + 2.4 s: still under cutMin
ok(pick === 1, `no cut before ${spectateTuning.cutMin} s even for a much better shot`);
for (let i = 0; i < 20; i++) pick = d.step(0.05, [9, 1, 1]);
ok(pick === 0 && d.cuts === 2, 'after cutMin, a much more exciting hero gets the cut');
const d2 = new AutoDirector();
d2.step(0.01, [3, 2.5]);
for (let i = 0; i < Math.ceil(spectateTuning.cutEvery / 0.1) + 1; i++) pick = d2.step(0.1, [3, 2.5]);
ok(pick === 1 && d2.cuts === 2, 'after cutEvery it cuts to the other hero for variety');
const d3 = new AutoDirector();
d3.step(0.01, [9, 1]);
for (let i = 0; i < Math.ceil(spectateTuning.cutEvery / 0.1) + 1; i++) pick = d3.step(0.1, [9, 1]);
ok(pick === 0 && d3.cuts === 1, 'but not to a far duller one');
ok(d3.step(0.1, [-Infinity, 1]) === 1, 'the watched hero goes down: cut at once');
ok(d3.step(0.1, [-Infinity, -Infinity]) === 1, 'nobody standing: keep the last shot');
console.log('spectate rules done');
